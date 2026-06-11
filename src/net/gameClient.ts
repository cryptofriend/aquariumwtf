/**
 * WebSocket client for the authoritative game server.
 *
 * The server owns all game state. This module keeps a mutable mirror of the
 * latest snapshot (`net`) that the three.js render loop reads at 60fps and
 * interpolates, plus a tiny pub/sub for events, chat, and phase changes.
 * Nothing here mutates game state locally — inputs go up, snapshots come down.
 */
import type { GameEvent, NetFood, NetPlayer, Phase, ServerMsg, SnapshotMsg } from '../../shared/protocol';

export interface RenderPlayer extends NetPlayer {
  /** Interpolated render position, advanced by the render loop. */
  cx: number;
  cy: number;
  cz: number;
}

export interface NetState {
  status: 'idle' | 'connecting' | 'open' | 'closed';
  joined: boolean;
  selfId: string | null;
  selfName: string;
  selfColor: string;
  /** Base58 wallet bound to this session ('' = guest). */
  selfWallet: string;
  phase: Phase;
  phaseEndsAt: number;
  /** offset so that serverTime ≈ Date.now() + clockSkew */
  clockSkew: number;
  players: Map<string, RenderPlayer>;
  food: NetFood[];
  alive: number;
  needed: number;
  pot: number;
  graceEndsAt: number;
  lastBiteSentAt: number;
  /** Last server error worth surfacing (e.g. respawn rejected). */
  lastError: string;
}

export const net: NetState = {
  status: 'idle',
  joined: false,
  selfId: null,
  selfName: '',
  selfColor: '#70a1ff',
  selfWallet: '',
  phase: 'lobby',
  phaseEndsAt: 0,
  clockSkew: 0,
  players: new Map(),
  food: [],
  alive: 0,
  needed: 2,
  pot: 0,
  graceEndsAt: 0,
  lastBiteSentAt: 0,
  lastError: '',
};

export function self(): RenderPlayer | null {
  return net.selfId ? net.players.get(net.selfId) ?? null : null;
}

/** Server clock → ms remaining for the current phase. */
export function phaseMsLeft(): number {
  if (net.phaseEndsAt <= 0) return 0;
  return Math.max(0, net.phaseEndsAt - (Date.now() + net.clockSkew));
}

export interface ChatMessage { from: string; color: string; text: string; ts: number; system?: boolean }

type Listener<T> = (v: T) => void;

const listeners = {
  event: new Set<Listener<GameEvent>>(),
  chat: new Set<Listener<ChatMessage>>(),
  snapshot: new Set<Listener<SnapshotMsg>>(),
  status: new Set<Listener<NetState['status']>>(),
};

export function on<K extends keyof typeof listeners>(
  kind: K,
  fn: typeof listeners[K] extends Set<infer L> ? L : never,
): () => void {
  listeners[kind].add(fn as never);
  return () => listeners[kind].delete(fn as never);
}

function fire<K extends keyof typeof listeners>(kind: K, value: unknown) {
  for (const fn of listeners[kind]) (fn as Listener<unknown>)(value);
}

export function serverUrl(): { ws: string; http: string } {
  const raw = (import.meta.env.VITE_GAME_SERVER_URL as string | undefined) || 'http://localhost:8787';
  const http = raw.replace(/\/$/, '');
  const ws = http.replace(/^http/, 'ws') + '/ws';
  return { ws, http };
}

let socket: WebSocket | null = null;
let joinResolve: ((err: string | null) => void) | null = null;
let reconnectTimer: number | null = null;
let shouldReconnect = false;

export function connect(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  shouldReconnect = true;
  net.status = 'connecting';
  fire('status', net.status);

  const ws = new WebSocket(serverUrl().ws);
  socket = ws;

  ws.onopen = () => {
    net.status = 'open';
    fire('status', net.status);
    // Guests rejoin automatically after a reconnect. Wallet sessions can't —
    // the login signature is single-use — so they go back to the entry screen.
    if (net.joined && net.selfName && !net.selfWallet) {
      ws.send(JSON.stringify({ t: 'join', name: net.selfName, color: net.selfColor }));
    }
  };

  ws.onmessage = (e) => {
    let msg: ServerMsg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handleMessage(msg);
  };

  ws.onclose = () => {
    net.status = 'closed';
    net.selfId = null;
    if (net.selfWallet) {
      net.joined = false;   // wallet sessions must re-sign — back to entry
      net.selfWallet = '';
    }
    fire('status', net.status);
    if (joinResolve) { joinResolve('Connection lost'); joinResolve = null; }
    if (shouldReconnect && reconnectTimer === null) {
      reconnectTimer = window.setTimeout(() => { reconnectTimer = null; connect(); }, 2000);
    }
  };
}

export function disconnect(): void {
  shouldReconnect = false;
  if (reconnectTimer !== null) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  net.joined = false;
  net.selfId = null;
  socket?.close();
  socket = null;
}

function handleMessage(msg: ServerMsg) {
  switch (msg.t) {
    case 'welcome':
      net.selfId = msg.id;
      net.joined = true;
      net.selfWallet = msg.wallet || '';
      if (joinResolve) { joinResolve(null); joinResolve = null; }
      break;

    case 'snapshot': {
      net.clockSkew = msg.now - Date.now();
      net.phase = msg.phase;
      net.phaseEndsAt = msg.phaseEndsAt;
      net.food = msg.food;
      net.alive = msg.alive;
      net.needed = msg.needed;
      net.pot = msg.pot;
      net.graceEndsAt = msg.graceEndsAt;
      const seen = new Set<string>();
      for (const p of msg.players) {
        seen.add(p.id);
        const existing = net.players.get(p.id);
        if (existing) {
          Object.assign(existing, p);
        } else {
          net.players.set(p.id, { ...p, cx: p.x, cy: p.y, cz: p.z });
        }
      }
      for (const id of net.players.keys()) {
        if (!seen.has(id)) net.players.delete(id);
      }
      fire('snapshot', msg);
      break;
    }

    case 'event':
      fire('event', msg.e);
      break;

    case 'chat':
      fire('chat', { from: msg.from, color: msg.color, text: msg.text, ts: msg.ts });
      break;

    case 'error':
      if (msg.code === 'join_failed' && joinResolve) {
        joinResolve(msg.message);
        joinResolve = null;
      } else {
        net.lastError = msg.message;
        fire('status', net.status); // nudge subscribers to re-read state
      }
      break;
  }
}

export interface WalletAuth {
  wallet: string;     // base58 pubkey
  nonce: string;      // from GET /auth/nonce
  signature: string;  // base58 ed25519 signature over the nonce message
}

/** Resolves with null on success or an error message. */
export function join(name: string, color: string, auth?: WalletAuth): Promise<string | null> {
  net.selfName = name;
  net.selfColor = color;
  connect();
  const payload = JSON.stringify({ t: 'join', name, color, ...(auth ?? {}) });
  return new Promise((resolve) => {
    joinResolve = resolve;
    const trySend = () => {
      if (!socket) return resolve('Not connected');
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
      } else if (socket.readyState === WebSocket.CONNECTING) {
        socket.addEventListener('open', () => {
          socket?.send(payload);
        }, { once: true });
      } else {
        resolve('Not connected');
      }
    };
    trySend();
    window.setTimeout(() => {
      if (joinResolve === resolve) { joinResolve = null; resolve('Server not responding'); }
    }, 8000);
  });
}

let lastInputSentAt = 0;
let lastInputKey = '';

/** Throttled — safe to call every frame. Bite requests always go through. */
export function sendInput(x: number, y: number, z: number, bite = false): void {
  if (!socket || socket.readyState !== WebSocket.OPEN || !net.joined) return;
  const now = Date.now();
  const key = `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`;
  if (!bite && now - lastInputSentAt < 90 && key === lastInputKey) return;
  if (!bite && now - lastInputSentAt < 45) return;
  lastInputSentAt = now;
  lastInputKey = key;
  if (bite) net.lastBiteSentAt = now;
  socket.send(JSON.stringify({ t: 'input', x, y, z, bite: bite || undefined }));
}

export function sendChat(text: string): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ t: 'chat', text }));
}

/** Buy back into the current round for 1 token (dead or spectating). */
export function sendRespawn(): void {
  if (!socket || socket.readyState !== WebSocket.OPEN || !net.joined) return;
  socket.send(JSON.stringify({ t: 'respawn' }));
}
