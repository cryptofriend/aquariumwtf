/**
 * Aquarium game server entrypoint.
 *
 *   ws://HOST/ws      — realtime play (browser clients)
 *   POST /agent       — HTTP API for AI agents (same world, same rules)
 *   GET  /health      — liveness + player counts
 *
 * Run: npm run dev (tsx watch) · PORT env overrides 8787.
 */
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { TANK_HALF, TICK_MS, SNAPSHOT_MS, ROUND_MS } from '../../shared/constants';
import type { ClientMsg, ServerMsg } from '../../shared/protocol';
import { World } from './world';
import { handleAgentAction } from './agentApi';
import { persistRoundResults, leaderboardEnabled } from './leaderboard';
import { issueNonce, verifyLogin, isValidPubkey } from './auth';
import { verifyDeposit } from './deposits';

const PORT = Number(process.env.PORT) || 8787;
const CHAT_LIMIT_MS = 1500;
const MAX_CHAT_LOG = 200;

const world = new World();
const sockets = new Map<string, WebSocket>();        // player id → socket
const chatLog: { from: string; color: string; text: string; ts: number }[] = [];
const lastChatAt = new Map<string, number>();

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(msg: ServerMsg) {
  // All connected sockets, joined or not — observers (entry screen,
  // spectators) need live snapshots too.
  const data = JSON.stringify(msg);
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function pushChat(from: string, color: string, text: string) {
  const entry = { from, color, text, ts: Date.now() };
  chatLog.push(entry);
  if (chatLog.length > MAX_CHAT_LOG) chatLog.shift();
  broadcast({ t: 'chat', ...entry });
}

// ─── HTTP ───────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  // '*' — web3.js sends custom headers (e.g. solana-client) that would
  // otherwise fail the CORS preflight and surface as "Failed to fetch"
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const httpServer = createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    return res.end();
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true,
      phase: world.phase,
      players: world.players.size,
      leaderboard_persistence: leaderboardEnabled,
    }));
  }

  if (req.method === 'GET' && req.url?.startsWith('/auth/nonce')) {
    const url = new URL(req.url, 'http://localhost');
    const wallet = url.searchParams.get('wallet') || '';
    if (!isValidPubkey(wallet)) {
      res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Invalid wallet public key' }));
    }
    const { nonce, message } = issueNonce(wallet);
    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, nonce, message }));
  }

  if (req.method === 'GET' && req.url?.startsWith('/balance')) {
    const url = new URL(req.url, 'http://localhost');
    const wallet = url.searchParams.get('wallet') || '';
    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, wallet, tickets: isValidPubkey(wallet) ? world.balanceOf(wallet) : 0 }));
  }

  if (req.method === 'GET' && req.url === '/winners') {
    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, winners: world.hallOfFame }));
  }

  // Solana RPC proxy: the public mainnet RPC 403-blocks browsers, but
  // server-side requests get through. Allowlisted methods only.
  if (req.method === 'POST' && req.url === '/rpc') {
    const ALLOWED = new Set([
      'getLatestBlockhash',
      'sendRawTransaction',
      'getSignatureStatuses',
      'getTokenAccountsByOwner',
      'getTransaction',
      'getAccountInfo',
      'simulateTransaction',
      'getFeeForMessage',
      'getRecentBlockhash',
    ]);
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 200_000) req.destroy(); });
    req.on('end', () => {
      void (async () => {
        try {
          const body = JSON.parse(raw);
          const calls = Array.isArray(body) ? body : [body];
          if (!calls.every((c) => ALLOWED.has(String(c?.method)))) {
            res.writeHead(403, { ...corsHeaders, 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Method not allowed by proxy' }));
          }
          const upstream = await fetch(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: raw,
          });
          const text = await upstream.text();
          res.writeHead(upstream.status, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(text);
        } catch {
          res.writeHead(502, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'RPC proxy error' }));
        }
      })();
    });
    return;
  }

  // Redeem an on-chain ticket purchase. Credit goes to the wallet that SENT
  // the $MYTH — taken from the transaction itself, so no session needed.
  if (req.method === 'POST' && req.url === '/deposit') {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 8_000) req.destroy(); });
    req.on('end', () => {
      void (async () => {
        let body: { signature?: string };
        try { body = JSON.parse(raw); } catch {
          res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        }
        const result = await verifyDeposit(String(body.signature || ''));
        if (!result.ok) {
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: result.reason }));
        }
        const balance = world.creditDeposit(result.wallet, result.tickets);
        console.log(`[deposit] ${result.wallet} bought ${result.tickets} ticket(s) — balance ${balance}`);
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, wallet: result.wallet, tickets: result.tickets, balance }));
      })();
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/agent') {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 64_000) req.destroy(); });
    req.on('end', () => {
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(raw);
      } catch {
        res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
      }
      // Rate-limit agent chat the same way as ws chat
      if (body.action === 'chat' && typeof body.agent_id === 'string') {
        const last = lastChatAt.get(body.agent_id) ?? 0;
        if (Date.now() - last < CHAT_LIMIT_MS) {
          res.writeHead(429, { ...corsHeaders, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'Chatting too fast — max 1 message / 1.5s' }));
        }
        lastChatAt.set(body.agent_id, Date.now());
      }
      void handleAgentAction(body, {
        world,
        chatLog,
        sendChat: pushChat,
        now: () => Date.now(),
      }).then(({ status, data }) => {
        res.writeHead(status, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      });
    });
    return;
  }

  res.writeHead(404, { ...corsHeaders, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'Not found' }));
});

// ─── WebSocket ──────────────────────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (ws) => {
  let playerId: string | null = null;

  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return send(ws, { t: 'error', code: 'bad_json', message: 'Invalid JSON' });
    }

    switch (msg.t) {
      case 'join': {
        if (playerId) return; // already joined on this socket

        // Optional Sign-In-With-Solana: all three fields or none
        let wallet: string | null = null;
        if (msg.wallet || msg.nonce || msg.signature) {
          if (!msg.wallet || !msg.nonce || !msg.signature) {
            return send(ws, { t: 'error', code: 'join_failed', message: 'Incomplete wallet login' });
          }
          const verdict = verifyLogin(msg.wallet, msg.nonce, msg.signature);
          if (!verdict.ok) {
            return send(ws, { t: 'error', code: 'join_failed', message: `Wallet login failed: ${verdict.reason}` });
          }
          wallet = msg.wallet;
        }

        const result = world.join(msg.name, msg.color, false, Date.now(), wallet);
        if ('error' in result) {
          return send(ws, { t: 'error', code: 'join_failed', message: result.error });
        }
        playerId = result.player.id;
        sockets.set(playerId, ws);
        send(ws, { t: 'welcome', id: playerId, tankHalf: TANK_HALF, wallet: wallet ?? '' });
        // Immediate snapshot so the new client doesn't wait for the next beat
        send(ws, world.snapshot(Date.now()));
        break;
      }
      case 'input': {
        if (!playerId) return;
        world.setInput(playerId, { x: Number(msg.x) || 0, y: Number(msg.y) || 0, z: Number(msg.z) || 0 }, Boolean(msg.bite));
        break;
      }
      case 'respawn': {
        if (!playerId) return;
        const result = world.respawn(playerId, Date.now());
        if (!result.ok) {
          send(ws, { t: 'error', code: 'respawn_failed', message: result.reason });
        }
        break;
      }
      case 'deposit': {
        const sig = String(msg.signature || '');
        void verifyDeposit(sig).then((result) => {
          if (!result.ok) {
            return send(ws, { t: 'deposit_result', ok: false, message: result.reason });
          }
          const balance = world.creditDeposit(result.wallet, result.tickets);
          console.log(`[deposit] ${result.wallet} bought ${result.tickets} ticket(s) — balance ${balance}`);
          send(ws, {
            t: 'deposit_result',
            ok: true,
            message: `🎟 ${result.tickets} ticket${result.tickets === 1 ? '' : 's'} added`,
            tickets: result.tickets,
            balance,
          });
        });
        break;
      }
      case 'chat': {
        if (!playerId) return;
        const p = world.players.get(playerId);
        const text = String(msg.text || '').slice(0, 200).trim();
        if (!p || !text) return;
        const last = lastChatAt.get(playerId) ?? 0;
        if (Date.now() - last < CHAT_LIMIT_MS) return;
        lastChatAt.set(playerId, Date.now());
        pushChat(p.name, p.color, text);
        break;
      }
      case 'ping':
        send(ws, { t: 'pong', ts: msg.ts });
        break;
    }
  });

  ws.on('close', () => {
    if (playerId) {
      world.leave(playerId);
      sockets.delete(playerId);
      lastChatAt.delete(playerId);
    }
  });
});

// ─── main loop ──────────────────────────────────────────────────────

let lastSnapshotAt = 0;

setInterval(() => {
  const now = Date.now();
  world.tick(now);

  for (const e of world.drainEvents()) {
    broadcast({ t: 'event', e });
    if (e.kind === 'round_end') {
      void persistRoundResults(e.standings, Math.round(ROUND_MS / 1000));
      console.log(`[round] winner: ${e.winner?.name ?? 'none'} (${e.winner?.weight ?? 0}kg) — ${e.standings.length} fish`);
    }
  }

  if (now - lastSnapshotAt >= SNAPSHOT_MS) {
    lastSnapshotAt = now;
    broadcast(world.snapshot(now));
  }
}, TICK_MS);

httpServer.listen(PORT, () => {
  console.log(`[aquarium] game server on :${PORT} — ws path /ws, agent API POST /agent`);
  console.log(`[aquarium] leaderboard persistence: ${leaderboardEnabled ? 'ON' : 'off (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)'}`);
});
