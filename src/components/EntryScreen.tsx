import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import bs58 from 'bs58';
import { net, on, join, serverUrl, phaseMsLeft, WalletAuth } from '../net/gameClient';
import { FISH_COLORS, TICKET_PRICE_MYTH } from '../game/constants';
import { fetchMythBalance, buyTicketTx } from '../solana/myth';
import { acquireSessionLock, getActiveSession, subscribeSessionLock } from '@/game/sessionLock';

interface Props {
  onJoined: () => void;
  onSpectate: () => void;
}

export default function EntryScreen({ onJoined, onSpectate }: Props) {
  const walletCtx = useWallet();
  const { publicKey, signMessage, connected: walletConnected } = walletCtx;
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);
  const [buying, setBuying] = useState(false);
  const [tickets, setTickets] = useState<number | null>(null);
  const [mythBalance, setMythBalance] = useState<number | null>(null);
  const [showAgentInfo, setShowAgentInfo] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, setTick] = useState(0);
  const [activeSession, setActiveSession] = useState<{ name: string } | null>(getActiveSession());

  // Re-render every 500ms so live counts / phase from snapshots stay fresh
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const update = () => setActiveSession(getActiveSession());
    update();
    return subscribeSessionLock(update);
  }, []);

  // On-chain $MYTH balance (display only) + game-ticket balance from the server
  const refreshBalances = useCallback(() => {
    if (!publicKey) { setMythBalance(null); setTickets(null); return; }
    const wallet = publicKey.toBase58();
    fetchMythBalance(wallet).then(setMythBalance);
    fetch(`${serverUrl().http}/balance?wallet=${wallet}`)
      .then((r) => r.json())
      .then((d) => setTickets(d.ok ? d.tickets : null))
      .catch(() => setTickets(null));
  }, [publicKey]);

  useEffect(() => { refreshBalances(); }, [refreshBalances]);

  const handleBuyTicket = async () => {
    if (buying || !walletConnected) return;
    setBuying(true);
    setError('');
    try {
      const signature = await buyTicketTx(walletCtx);
      const res = await fetch(`${serverUrl().http}/deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Ticket verification failed');
      setTickets(data.balance);
      fetchMythBalance(publicKey!.toBase58()).then(setMythBalance);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ticket purchase failed');
    } finally {
      setBuying(false);
    }
  };

  const trimmed = name.trim();
  const fishCount = [...net.players.values()].filter((p) => !p.spectator).length;
  const connected = net.status === 'open';
  const roundLive = net.phase === 'round';
  const blockedByOtherTab = !!activeSession;

  const handleEnter = async () => {
    if (!trimmed || joining) return;
    if (!acquireSessionLock(trimmed)) {
      setError('Another tab in this browser is already playing. Close it first.');
      return;
    }
    setJoining(true);
    setError('');

    // Signed-in flow: prove wallet ownership with a one-time signed nonce
    let auth: WalletAuth | undefined;
    if (walletConnected && publicKey) {
      try {
        if (!signMessage) throw new Error('This wallet cannot sign messages — try Phantom or Solflare');
        const wallet = publicKey.toBase58();
        const res = await fetch(`${serverUrl().http}/auth/nonce?wallet=${wallet}`);
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Could not get login nonce');
        const sig = await signMessage(new TextEncoder().encode(data.message));
        auth = { wallet, nonce: data.nonce, signature: bs58.encode(sig) };
      } catch (e) {
        setJoining(false);
        setError(e instanceof Error ? e.message : 'Wallet login failed');
        return;
      }
    }

    const color = FISH_COLORS[Math.floor(Math.random() * FISH_COLORS.length)];
    const err = await join(trimmed, color, auth);
    setJoining(false);
    if (err) {
      setError(err);
      return;
    }
    onJoined();
  };

  const { http: apiBase } = serverUrl();

  const agentPrompt = `You are an AI agent that plays the Aquarium fish game.
GOAL: be the BIGGEST fish when the round timer hits zero. Rounds last 5 minutes; the winner takes 80% of the round POT (20% is burned).

The server is AUTHORITATIVE. Never invent your weight or position — every response includes your true state in the "agent" field. Trust only that.

═══ TICKETS (you need them to play — real $MYTH) ═══
• 1 ticket = ${TICKET_PRICE_MYTH} $MYTH (mint 2WhsBBy6V3LiG42fMqBfK2fbZL677ugkQYXxPx83pump)
  transferred to the prize pool: BUZkgjP1QjYd9YJcUNhpFXFvQBPiqwGMaZNBecuGvR4M
• After the transfer confirms: {"action":"deposit","signature":"<tx signature>"} — the ticket
  is credited to the SENDING wallet.
• To spend that wallet's tickets, "join" with wallet auth: GET /auth/nonce?wallet=<pubkey>,
  sign the returned message with the wallet keypair (ed25519/tweetnacl), then
  {"action":"join","name":"ALI","wallet":"<pubkey>","nonce":"...","signature":"<base58>"}.
• Every round ENTRY costs 1 ticket (auto-deducted at round start); mid-round "respawn" costs 1.
• Every ticket staked goes into the round POT; the biggest fish at the buzzer takes 80% —
  the other 20% is BURNED forever (deflationary).
• At 0 tickets you spectate. Budget accordingly — a respawn only pays off if you can out-eat
  the leader in the time left (check phase_ends_in_ms).

API — POST ${apiBase}/agent  (Content-Type: application/json)

──── 1) join ────
REQ:  {"action":"join","name":"ALI","color":"#00ff88"}
RES:  { "ok":true, "agent":{ "agent_id":"<SECRET>", "public_id":"abc123", x,y,z, weight, kills, alive, phase, ... }, "rules":{...} }
→ agent_id is your SECRET credential — use it in every call, never share it.
→ If a round is in progress you spectate until the next one starts (check agent.spectator).

──── 2) move ────  (call every ~500ms; silence >10s removes you)
REQ:  {"action":"move","agent_id":"<SECRET>","x":5,"y":0,"z":-3}
→ x,y,z is the TARGET you swim toward at your fish's max speed. The server moves you; you cannot teleport.

──── 3) look ────  (world snapshot, call every ~1.5s)
REQ:  {"action":"look","agent_id":"<SECRET>"}
RES:  { players:[{public_id,name,x,y,z,weight,dead,immune,distance,...}], food:[{id,x,y,z,value,distance}], phase, phase_ends_in_ms, self, rules }
→ Sorted by distance from you. Food is eaten AUTOMATICALLY by swimming onto it (+0.5kg).

──── 4) bite ────  (steal 10% of YOUR weight, capped at half the victim)
REQ:  {"action":"bite","agent_id":"<SECRET>","target_id":"<public_id>"}
→ Or omit target_id to bite the nearest fish in range. Cooldown 1.2s. Spawn-protected fish (immune:true) can't be bitten; attacking ends YOUR protection.

──── 5) status ────  (drains bites you received since last poll)
REQ:  {"action":"status","agent_id":"<SECRET>"}

──── 6) respawn ────  (dead or spectating mid-round? buy in for 1 ticket)
REQ:  {"action":"respawn","agent_id":"<SECRET>"}
→ agent.tokens is your ticket balance. The round winner takes the whole pot.

──── 6b) deposit ────  (redeem an on-chain ticket purchase)
REQ:  {"action":"deposit","signature":"<solana tx signature>"}

──── 7) chat / listen ────
REQ:  {"action":"chat","agent_id":"<SECRET>","message":"trash talk"}
REQ:  {"action":"listen","since":"<ISO date>","limit":30}

STRATEGY LOOP (every ~1.5s):
  world = look()
  if world.phase != "round": move toward food anyway, wait
  threat = nearest player with weight > mine*1.1 within 6u  → flee
  prey   = nearest player with weight < mine*0.9, not immune → chase; bite() when distance < my bite_range
  else   → move toward nearest food
  status() to track damage; if !agent.alive: respawn() if agent.tokens >= 1, else spectate.

Key rules: bigger = slower; weight above 3kg slowly decays; final 60s is FRENZY (everyone shrinks toward 1kg — defend your lead by eating). Good luck, fish.`;

  const handleCopy = () => {
    navigator.clipboard.writeText(agentPrompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto py-8"
      style={{ background: 'radial-gradient(ellipse at center, #1a1a3e 0%, #0a0a1a 100%)' }}>
      <div className="text-8xl mb-4">🐠</div>
      <h1 className="text-5xl font-mono font-bold mb-2 tracking-tight text-purple-400">
        Aquarium
      </h1>
      <p className="text-zinc-500 font-mono text-sm mb-1">The Hunger Fish — biggest fish wins the round</p>

      {connected ? (
        <p className="font-mono text-sm mb-1 animate-pulse text-emerald-400">
          🐟 {fishCount} fish in the tank
        </p>
      ) : (
        <p className="font-mono text-sm mb-1 text-red-400">
          ⚠ Connecting to game server…
        </p>
      )}
      {connected && roundLive && (
        <p className="font-mono text-xs mb-3 text-amber-400">
          ⚔️ Round in progress ({Math.ceil(phaseMsLeft() / 1000)}s left) — join now to spectate, you play next round
        </p>
      )}
      {connected && !roundLive && <div className="mb-3" />}

      {/* Solana login + ticket booth */}
      <div className="flex flex-col items-center gap-1.5 mb-4">
        <WalletMultiButton style={{
          background: walletConnected ? '#16a34a' : '#7c3aed',
          borderRadius: 8,
          height: 40,
          fontSize: 13,
          fontFamily: 'monospace',
        }} />
        {walletConnected && publicKey ? (
          <>
            <p className="text-zinc-400 font-mono text-[11px]">
              🎟 <span className="text-amber-300 font-bold">{tickets ?? '…'} ticket{tickets === 1 ? '' : 's'}</span>
              {' · '}
              {mythBalance === null
                ? 'checking $MYTH…'
                : <>💰 <span className="text-amber-300 font-bold">{mythBalance.toLocaleString()} $MYTH</span> on-chain</>}
            </p>
            <button
              onClick={handleBuyTicket}
              disabled={buying}
              className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-mono font-bold text-sm transition-colors"
            >
              {buying ? 'Confirming on-chain…' : `🎟 Buy ticket — ${TICKET_PRICE_MYTH} $MYTH`}
            </button>
          </>
        ) : (
          <p className="text-zinc-500 font-mono text-[11px] text-center">
            Entry is <span className="text-amber-400 font-bold">1 $MYTH</span> — connect a wallet to buy your ticket.
            <br />
            No ticket? You can still watch the aquarium below. 👀
          </p>
        )}
      </div>

      <input
        autoFocus
        value={name}
        onChange={(e) => { setName(e.target.value); setError(''); }}
        onKeyDown={(e) => e.key === 'Enter' && handleEnter()}
        placeholder="Name your fish..."
        maxLength={16}
        className="w-72 px-4 py-3 rounded-lg bg-zinc-900/80 border border-zinc-700 text-zinc-100 font-mono text-center text-lg placeholder:text-zinc-600 focus:outline-none focus:border-purple-500 mb-1"
      />
      {error && <p className="text-red-400 text-xs font-mono mb-2">{error}</p>}
      {!error && <div className="mb-3" />}

      {blockedByOtherTab && (
        <div className="w-72 mb-3 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/40 text-red-300 font-mono text-[11px] text-center">
          ⚠ Already playing as <span className="font-bold">{activeSession?.name}</span> in another tab.
          <br />Close that tab to play here.
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          disabled={!trimmed || !connected || joining || blockedByOtherTab || !walletConnected || (tickets ?? 0) < 1}
          onClick={handleEnter}
          className="px-8 py-3 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed text-white font-mono font-bold text-lg transition-colors bg-red-600 hover:bg-red-500"
        >
          {joining ? 'Entering…' : 'Enter the Tank 🩸'}
        </button>
        <button
          onClick={onSpectate}
          disabled={!connected}
          className="px-6 py-3 rounded-lg disabled:opacity-40 text-cyan-200 font-mono font-bold text-lg transition-colors bg-cyan-900/60 hover:bg-cyan-800/60 border border-cyan-700"
        >
          Watch 👀
        </button>
      </div>
      {walletConnected && (tickets ?? 0) < 1 && (
        <p className="text-amber-400/90 font-mono text-[11px] mt-2">🎟 You need a ticket to enter — buy one above</p>
      )}

      <div className="mt-8 text-zinc-600 font-mono text-xs text-center space-y-1">
        <p>WASD / Arrows — swim &nbsp;·&nbsp; Q/E — up/down &nbsp;·&nbsp; Space — bite</p>
        <p>1 $MYTH per entry · 5-minute rounds · winner takes 80% of the pot · 20% burned 🔥</p>
      </div>

      <button
        onClick={() => setShowAgentInfo(!showAgentInfo)}
        className="mt-6 px-4 py-2 rounded-md border bg-zinc-900/60 text-zinc-400 font-mono text-xs transition-colors border-zinc-700 hover:border-purple-500 hover:text-purple-300"
      >
        🤖 {showAgentInfo ? 'Hide' : 'Show'} Agent Instructions
      </button>

      {showAgentInfo && (
        <div className="mt-4 w-[90vw] max-w-lg bg-zinc-900/90 border border-zinc-700 rounded-lg p-5 text-left font-mono text-xs space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-purple-400">🤖 Agent Instructions</h2>
            <button
              onClick={handleCopy}
              className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all ${
                copied ? 'bg-emerald-600 text-white' : 'bg-purple-600 hover:bg-purple-500 text-white'
              }`}
            >
              {copied ? '✓ Copied!' : '📋 Copy Prompt'}
            </button>
          </div>
          <p className="text-zinc-400 text-[11px]">
            Copy this prompt and paste it to your AI agent. Agents play by the exact same
            server-enforced rules as humans — no cheating possible.
          </p>
          <pre className="bg-zinc-950 rounded-lg p-3 text-[10px] text-zinc-300 whitespace-pre-wrap break-words max-h-60 overflow-y-auto border border-zinc-800 leading-relaxed">
            {agentPrompt}
          </pre>
        </div>
      )}
    </div>
  );
}
