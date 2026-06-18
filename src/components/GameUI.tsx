import { useEffect, useState } from 'react';
import { TANK_HALF, BITE_COOLDOWN_MS, TICKET_PRICE_FISH, BASE_PRIZE_FISH, payoutSplit } from '../game/constants';
import { biteRequest } from './TankScene';
import { Move, ArrowUpDown, Bug, Info, X, Smartphone } from 'lucide-react';
import { useIsMobile } from '../hooks/use-mobile';
import VirtualJoystick from './VirtualJoystick';
import ChatLeaderboardPanel from './ChatLeaderboardPanel';
import DeathScreen from './DeathScreen';
import ShareCard from './ShareCard';
import { net, self, eventMsLeft, startMsLeft, on, sendRespawn } from '../net/gameClient';
import { fetchFishPriceUsd } from '../solana/fish';
import type { Standing } from '../../shared/protocol';
import { toast } from 'sonner';

/** Dd HH:MM:SS for the long survival countdown (days shown when ≥24h). */
function fmtClock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

function Minimap() {
  const mapW = 160;
  const mapH = 120;
  const me = self();

  const toMap = (x: number, z: number) => ({
    mx: ((x + TANK_HALF.x) / (TANK_HALF.x * 2)) * mapW,
    my: ((z + TANK_HALF.z) / (TANK_HALF.z * 2)) * mapH,
  });
  const normY = (y: number) => (y + TANK_HALF.y) / (TANK_HALF.y * 2);

  const dots = [...net.players.values()]
    .filter((p) => !p.spectator)
    .map((p) => {
      const { mx, my } = toMap(p.x, p.z);
      return { mx, my, depth: normY(p.y), color: p.color, isPlayer: p.id === net.selfId, dead: p.dead };
    });

  return (
    <div className="absolute bottom-20 right-4 pointer-events-auto">
      <div className="bg-black/70 backdrop-blur-sm border border-zinc-700 rounded-lg p-2">
        <div className="text-zinc-500 text-[9px] uppercase tracking-wider mb-1 text-center font-bold">Radar</div>
        <div
          className="relative border border-zinc-700/50 rounded"
          style={{ width: mapW, height: mapH, background: 'rgba(5,5,16,0.8)' }}
        >
          <svg className="absolute inset-0 w-full h-full opacity-20" viewBox={`0 0 ${mapW} ${mapH}`}>
            <line x1={mapW / 2} y1={0} x2={mapW / 2} y2={mapH} stroke="#444" strokeWidth={0.5} />
            <line x1={0} y1={mapH / 2} x2={mapW} y2={mapH / 2} stroke="#444" strokeWidth={0.5} />
            <rect x={1} y={1} width={mapW - 2} height={mapH - 2} fill="none" stroke="#555" strokeWidth={0.5} />
          </svg>
          {dots.map((d, i) => {
            const baseSize = d.isPlayer ? 8 : 5;
            const size = baseSize + d.depth * 4;
            return (
              <div key={i} className="absolute" style={{ left: d.mx - size / 2, top: d.my - size / 2, width: size, height: size }}>
                <div
                  className="w-full h-full rounded-full"
                  style={{
                    backgroundColor: d.dead ? '#666' : d.color,
                    opacity: d.dead ? 0.4 : (0.5 + d.depth * 0.5),
                    boxShadow: d.isPlayer ? `0 0 6px ${d.color}` : 'none',
                    border: d.isPlayer ? '1px solid rgba(255,255,255,0.6)' : 'none',
                  }}
                />
                {d.isPlayer && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[7px] text-white whitespace-nowrap font-bold">YOU</div>
                )}
              </div>
            );
          })}
          <div className="absolute -right-5 top-0 bottom-0 w-3 flex flex-col items-center justify-between">
            <div className="text-[6px] text-zinc-500">⬆</div>
            <div className="w-1.5 flex-1 rounded-full mx-auto my-0.5 overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <div
                className="w-full rounded-full transition-all duration-200"
                style={{
                  height: `${(1 - (me ? normY(me.y) : 0.5)) * 100}%`,
                  background: 'rgba(100,200,255,0.4)',
                }}
              />
            </div>
            <div className="text-[6px] text-zinc-500">⬇</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function fmtFish(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}M`;
  if (n >= 1_000) return `${(n / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}K`;
  return n.toLocaleString();
}

/** Big prize-pool readout: total $FISH pool (+ USD once $FISH is listed). */
function PrizePoolBanner() {
  const [price, setPrice] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => fetchFishPriceUsd().then((p) => { if (!cancelled) setPrice(p); });
    load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const fish = net.prizeFish;
  const usd = price !== null ? fish * price : null;
  // Burn == pool contribution per ticket, so burned so far == pool above base.
  const burned = Math.max(0, fish - BASE_PRIZE_FISH);

  return (
    <div className="bg-black/75 backdrop-blur-sm border-2 border-amber-400/70 rounded-xl px-6 py-2 text-center shadow-lg shadow-amber-900/30 pointer-events-none">
      <div className="text-amber-400/90 text-[10px] font-bold uppercase tracking-[0.2em]">🏆 Prize Pool</div>
      <div className="text-amber-300 text-2xl font-bold leading-tight">
        {fmtFish(fish)} <span className="text-base">$FISH</span>
        {usd !== null && (
          <span className="text-emerald-300 text-lg font-bold ml-2">
            (${usd >= 100 ? Math.round(usd).toLocaleString() : usd.toFixed(2)})
          </span>
        )}
      </div>
      <div className="text-zinc-500 text-[9px]">
        survivors split the pool 🐟{burned > 0 && <span className="text-orange-400"> · 🔥 {fmtFish(burned)} $FISH burned</span>}
      </div>
    </div>
  );
}

/** The BIG survival countdown — the centerpiece of the screen. */
function CountdownBanner() {
  let label: string;
  let ms: number;
  let danger = false;
  if (net.phase === 'upcoming') {
    label = 'EVENT STARTS IN';
    ms = startMsLeft();
  } else if (net.phase === 'live') {
    label = `SURVIVE · ${net.alive} ALIVE`;
    ms = eventMsLeft();
    danger = ms < 60 * 60_000; // final hour
  } else {
    label = 'EVENT OVER';
    ms = 0;
  }

  return (
    <div className="bg-black/75 backdrop-blur-sm border border-zinc-700 rounded-lg px-6 py-1.5 text-center pointer-events-none">
      <div className={`text-[10px] font-bold uppercase tracking-[0.2em] ${danger ? 'text-red-400' : 'text-cyan-300'}`}>{label}</div>
      <div className={`font-mono font-bold tabular-nums leading-none ${danger ? 'text-red-400 animate-pulse' : 'text-zinc-100'} text-3xl`}>
        {net.phase === 'ended' ? '00:00:00' : fmtClock(ms)}
      </div>
    </div>
  );
}

function EventEndedOverlay({ survivors, prizeFish, meName }: {
  survivors: Standing[]; prizeFish: number; meName: string;
}) {
  const mine = survivors.find((s) => s.name === meName);
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-auto bg-black/70 backdrop-blur-sm">
      <div className="bg-zinc-950/95 border border-zinc-700 rounded-2xl p-8 font-mono text-center min-w-[340px] max-w-[90vw]">
        <div className="text-6xl mb-3">🏁</div>
        <h2 className="text-2xl font-bold text-amber-300 mb-1">Event over</h2>
        {survivors.length > 0 ? (
          <p className="text-zinc-300 text-sm mb-1">
            {survivors.length} survivor{survivors.length === 1 ? '' : 's'} split <span className="text-amber-300 font-bold">{fmtFish(prizeFish)} $FISH</span>
          </p>
        ) : (
          <p className="text-zinc-400 text-sm mb-3">No survivors — the {fmtFish(prizeFish)} $FISH pool goes unclaimed.</p>
        )}
        {mine && <p className="text-emerald-400 text-base font-bold mb-3">🎉 You placed #{survivors.indexOf(mine) + 1} — won {fmtFish(mine.share ?? 0)} $FISH!</p>}
        <div className="space-y-1 text-left mb-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">🏆 Payouts</div>
          {survivors.slice(0, 12).map((s, i) => (
            <div key={s.name} className={`flex items-center gap-2 text-xs ${s.name === meName ? 'text-amber-300 font-bold' : i === 0 ? 'text-amber-200' : 'text-zinc-300'}`}>
              <span className="w-5 text-zinc-500">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`}</span>
              <span className="flex-1 truncate">{s.name}{s.bot ? ' 🤖' : ''}</span>
              <span className="text-red-400 w-10 text-right">{s.kills}🗡</span>
              <span className="text-emerald-300 w-20 text-right">{fmtFish(s.share ?? 0)}</span>
            </div>
          ))}
          {survivors.length === 0 && <div className="text-zinc-600 text-xs">— none —</div>}
        </div>
      </div>
    </div>
  );
}

/** Highlighted banner for watch-only spectators. */
function SpectatorBanner({ onExit }: { onExit: () => void }) {
  return (
    <div className="absolute top-44 left-1/2 -translate-x-1/2 pointer-events-auto">
      <div className="bg-cyan-500/15 backdrop-blur-sm border-2 border-cyan-400 rounded-lg px-5 py-2 font-mono text-center shadow-lg shadow-cyan-900/40">
        <span className="text-cyan-300 text-xs font-bold uppercase tracking-wider">
          👀 Spectating the survival event
        </span>
        <div className="text-zinc-300 text-[10px] mt-0.5">
          Want in? <button onClick={onExit} className="underline text-amber-300 hover:text-amber-200">Buy a ticket ({TICKET_PRICE_FISH.toLocaleString()} $FISH) on the entry screen</button>
        </div>
      </div>
    </div>
  );
}

interface GameUIProps {
  spectateOnly?: boolean;
  onExit?: () => void;
}

export default function GameUI({ spectateOnly = false, onExit = () => {} }: GameUIProps) {
  const [, setTick] = useState(0);
  const [showRules, setShowRules] = useState(false);
  const [showMobileControls, setShowMobileControls] = useState(true);
  const [end, setEnd] = useState<{ survivors: Standing[]; prizeFish: number } | null>(null);
  const [killerName, setKillerName] = useState('');
  const [dismissedDeath, setDismissedDeath] = useState(false);
  // Show the share-to-X card once, the moment our fish enters the tank.
  const [shareShown, setShareShown] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 200);
    return () => clearInterval(id);
  }, []);

  // Surface server-side rejections (e.g. respawn with 0 tickets)
  useEffect(() => on('status', () => {
    if (net.lastError) {
      toast.error(net.lastError);
      net.lastError = '';
    }
  }), []);

  // Ticket purchases redeemed mid-session
  useEffect(() => on('deposit', (d) => {
    if (d.ok) toast.success(`${d.message} — balance ${d.balance}🎟`);
    else toast.error(d.message);
  }), []);

  useEffect(() => on('event', (e) => {
    if (e.kind === 'event_end') { setEnd({ survivors: e.survivors, prizeFish: e.prizeFish }); }
    if (e.kind === 'event_start') { setEnd(null); setKillerName(''); setDismissedDeath(false); }
    if (e.kind === 'kill' && e.victimId === net.selfId) { setKillerName(e.attacker); setDismissedDeath(false); }
    if (e.kind === 'respawn' && e.playerId === net.selfId) {
      toast.success('🎟 In the tank — fresh fish, 5s protection. Survive!');
    }
    // Personal toasts
    if (e.kind === 'bite' && e.victimId === net.selfId) {
      toast.error(`🦷 Bitten by ${e.attacker}! -${e.damage.toFixed(1)}kg`);
    }
    if (e.kind === 'bite' && e.attackerId === net.selfId) {
      toast(`🦷 Bit ${e.victim}! +${e.damage.toFixed(1)}kg`);
    }
    if (e.kind === 'eat' && e.playerId === net.selfId) {
      toast.success(`🌿 +0.5kg`, { duration: 1200 });
    }
  }), []);

  const me = self();
  const inRound = net.phase === 'live';

  // First time our fish is actually in the tank (not a watcher) → share card.
  useEffect(() => {
    if (!spectateOnly && !shareShown && me && !me.spectator) {
      setShareShown(true);
      setShowShare(true);
    }
  }, [me?.spectator, spectateOnly, shareShown]);

  // Live payout projection: rank ALIVE fish (kills, then size) and split the
  // current pool on the poker curve. Dead/eliminated fish drop to the bottom
  // with no share. Updates every render as kills land and fish die.
  const inTank = [...net.players.values()].filter((p) => !p.spectator);
  const aliveRanked = inTank.filter((p) => !p.dead)
    .sort((a, b) => b.kills - a.kills || b.weight - a.weight);
  const projShares = payoutSplit(net.prizeFish, aliveRanked.length);
  const liveEntries = [
    ...aliveRanked.map((p, i) => ({ name: p.name, kills: p.kills, weight: p.weight, dead: false, isMe: p.id === net.selfId, bot: p.bot, share: projShares[i] })),
    ...inTank.filter((p) => p.dead).sort((a, b) => b.kills - a.kills)
      .map((p) => ({ name: p.name, kills: p.kills, weight: p.weight, dead: true, isMe: p.id === net.selfId, bot: p.bot, share: 0 })),
  ];

  const canBite = me && !me.dead && !me.spectator && inRound;
  const biteReady = Date.now() - net.lastBiteSentAt > BITE_COOLDOWN_MS;

  return (
    <div className="fixed inset-0 z-40 pointer-events-none font-mono">
      <div className="absolute top-3 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5">
        <PrizePoolBanner />
        <CountdownBanner />
      </div>
      {spectateOnly && <SpectatorBanner onExit={onExit} />}

      {/* Live survivors + projected payouts */}
      <div className="absolute top-4 left-4 pointer-events-auto bg-black/60 backdrop-blur-sm border border-zinc-800 rounded-lg p-3 min-w-[240px]">
        <div className="text-purple-400 text-xs font-bold mb-2 uppercase tracking-wider">
          {inRound ? '🩸 Survivors · live payout' : '🐟 In the Tank'}
        </div>
        {liveEntries.slice(0, 10).map((e, i) => (
          <div key={i} className={`flex items-center gap-2 text-xs py-0.5 ${e.dead ? 'opacity-40' : ''} ${e.isMe ? 'bg-white/10 rounded px-1 -mx-1' : ''}`}>
            <span className="w-5 text-center">{e.dead ? '💀' : i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : <span className="text-zinc-500">{i + 1}</span>}</span>
            <span className={`truncate flex-1 ${e.isMe ? 'text-yellow-300 font-bold' : e.dead ? 'text-zinc-500 line-through' : 'text-zinc-200'}`}>
              {e.name}{e.bot ? ' 🤖' : ''}{e.isMe ? ' (you)' : ''}
            </span>
            <span className="text-red-400 w-8 text-right">{e.kills}🗡</span>
            <span className="text-emerald-300 w-16 text-right">{e.dead ? '—' : fmtFish(e.share)}</span>
          </div>
        ))}
        {liveEntries.length === 0 && <div className="text-zinc-600 text-xs">No fish in the tank yet</div>}
        {inRound && aliveRanked.length > 0 && (
          <div className="text-zinc-500 text-[9px] mt-1.5 pt-1.5 border-t border-zinc-700/50">survive to the buzzer to claim your $FISH 🏆</div>
        )}
      </div>

      {/* My stats */}
      <div className="absolute top-4 right-4 flex flex-col items-end gap-2 pointer-events-auto">
        {me && (
          <div className="bg-black/60 backdrop-blur-sm border border-zinc-800 rounded-lg px-4 py-2 text-right">
            <span className="text-amber-300 text-xl font-bold">{me.tokens}</span>
            <span className="text-zinc-500 text-xs ml-1">🎟 tickets</span>
            {me.wallet && (
              <div className="text-emerald-400 text-[10px] mt-0.5">◎ {me.wallet}</div>
            )}
          </div>
        )}
        {me && !me.spectator && (
          <>
            <div className="bg-black/60 backdrop-blur-sm border border-zinc-800 rounded-lg px-4 py-2">
              <span className="text-red-400 text-2xl font-bold">{me.kills}</span>
              <span className="text-zinc-500 text-xs ml-1">kills</span>
            </div>
            <div className="bg-black/60 backdrop-blur-sm border border-zinc-800 rounded-lg px-4 py-2">
              <span className="text-amber-400 text-xl font-bold">{me.weight.toFixed(1)}</span>
              <span className="text-zinc-500 text-xs ml-1">kg</span>
              <span className="text-zinc-600 text-[10px] ml-2">bite: {(me.weight * 0.1).toFixed(1)}kg</span>
            </div>
            {me.immune && !me.dead && (
              <div className="bg-emerald-500/15 border border-emerald-500/40 rounded-lg px-3 py-1.5">
                <span className="text-emerald-300 text-[10px] font-bold uppercase tracking-wider">🛡 Spawn protection</span>
              </div>
            )}
          </>
        )}
        {me?.spectator && (
          <div className="bg-cyan-500/15 border border-cyan-500/40 rounded-lg px-3 py-1.5 flex flex-col items-end gap-1.5">
            <span className="text-cyan-300 text-[10px] font-bold uppercase tracking-wider">
              {me.tokens >= 1 ? '👻 Spectating — jump in to start surviving' : '🎟 No tickets — buy one on the entry screen'}
            </span>
            {net.phase !== 'ended' && me.tokens >= 1 && (
              <button
                onClick={() => sendRespawn()}
                className="px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold transition-colors"
              >
                🎟 Dive in — 1 ticket
              </button>
            )}
          </div>
        )}
      </div>

      {/* FPV crosshair — your bite hits the nearest fish in range */}
      {me && !me.dead && !me.spectator && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="w-4 h-4 border border-white/35 rounded-full flex items-center justify-center">
            <div className="w-1 h-1 bg-white/60 rounded-full" />
          </div>
        </div>
      )}

      <Minimap />

      {/* Info & mobile toggle */}
      <div className="absolute bottom-20 right-[calc(1rem+180px)] pointer-events-auto flex flex-col gap-2">
        <button
          onClick={() => setShowRules((s) => !s)}
          className="bg-black/60 backdrop-blur-sm border border-zinc-700 rounded-lg p-2 hover:bg-black/80 transition-colors"
          title="Game Rules"
        >
          <Info size={18} className="text-zinc-300" />
        </button>
        {isMobile && (
          <button
            onClick={() => setShowMobileControls((s) => !s)}
            className={`bg-black/60 backdrop-blur-sm border rounded-lg p-2 hover:bg-black/80 transition-colors ${showMobileControls ? 'border-purple-500' : 'border-zinc-700'}`}
            title="Toggle Mobile Controls"
          >
            <Smartphone size={18} className={showMobileControls ? 'text-purple-400' : 'text-zinc-300'} />
          </button>
        )}
      </div>

      {/* Rules */}
      {showRules && (
        <div className="absolute bottom-36 right-4 pointer-events-auto bg-black/80 backdrop-blur-md border border-zinc-700 rounded-lg p-4 w-72 max-h-[70vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-purple-400 text-xs font-bold uppercase tracking-wider">Game Rules</span>
            <button onClick={() => setShowRules(false)} className="text-zinc-500 hover:text-zinc-300">
              <X size={14} />
            </button>
          </div>

          <div className="mb-3 p-2 rounded-md bg-amber-500/10 border border-amber-500/30">
            <div className="text-amber-300 text-[10px] font-bold uppercase tracking-wider mb-1">🏆 Goal</div>
            <p className="text-zinc-200 text-[11px] leading-snug">
              <span className="text-amber-300 font-bold">Survive to the buzzer.</span> Survivors are ranked by kills &amp; size and paid a <span className="text-amber-300 font-bold">poker-style payout</span> — everyone alive cashes, the top take the most.
            </p>
          </div>

          <div className="mb-3 p-2 rounded-md bg-yellow-500/10 border border-yellow-500/30">
            <div className="text-yellow-300 text-[10px] font-bold uppercase tracking-wider mb-1">🎟 Tickets &amp; prize</div>
            <ul className="text-zinc-300 text-[11px] space-y-1 list-disc list-inside">
              <li>1 ticket = <span className="text-yellow-300">{TICKET_PRICE_FISH.toLocaleString()} $FISH</span>, bought on the entry screen</li>
              <li>Half of each ticket <span className="text-amber-300">grows the prize pool</span>, half is <span className="text-orange-400">burned 🔥</span></li>
              <li>Died? <span className="text-yellow-300">Re-enter for 1 ticket</span> — as many times as you can afford</li>
              <li>👀 <span className="text-zinc-400">No ticket? Spectate for free</span></li>
            </ul>
          </div>

          <div className="mb-3">
            <div className="text-emerald-300 text-[10px] font-bold uppercase tracking-wider mb-1">🩸 How to survive</div>
            <ul className="text-zinc-300 text-[11px] space-y-1 list-disc list-inside">
              <li>Eat <span className="text-emerald-300">🌿 food</span> (+0.5kg) to grow — bigger = harder to kill</li>
              <li><span className="text-red-400">Bite</span> rivals to <span className="text-amber-400">thin the survivor pool</span> — fewer survivors = a bigger share for you</li>
              <li>Fresh spawns have <span className="text-emerald-300">5s 🛡 protection</span> — attacking ends yours</li>
              <li>If a bite drops you below 0.3kg you <span className="text-red-400">die</span> — re-enter for a ticket to stay in the hunt</li>
              <li>Be <span className="text-amber-300">alive at the buzzer</span> to claim your split 🏆</li>
            </ul>
          </div>

          <div>
            <div className="text-cyan-300 text-[10px] font-bold uppercase tracking-wider mb-1">🎮 Controls</div>
            <ul className="text-zinc-300 text-[11px] space-y-1 list-disc list-inside">
              <li>You see through your fish's eyes — <span className="text-yellow-300">W</span> swims forward, <span className="text-yellow-300">S</span> brakes</li>
              <li><span className="text-yellow-300">A/D</span> turn left/right · <span className="text-yellow-300">Q/E</span> pitch up/dive</li>
              <li>On mobile: joystick steers &amp; thrusts, buttons pitch</li>
              <li><span className="text-yellow-300">Space</span> / BITE button — bite the nearest fish in range</li>
              <li>Watch the <span className="text-yellow-300">radar</span> — danger comes from behind 👀</li>
            </ul>
          </div>
        </div>
      )}

      {/* Bug report */}
      <div className="absolute bottom-4 left-4 pointer-events-auto">
        <a
          href="https://x.com/boogaav"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 bg-black/60 backdrop-blur-sm border border-zinc-700 rounded-lg px-3 py-2 hover:bg-black/80 transition-colors"
        >
          <Bug size={14} className="text-red-400" />
          <span className="text-zinc-400 text-[10px] uppercase tracking-wider">Bug Report</span>
        </a>
      </div>

      {/* Bite + controls */}
      {canBite && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-auto flex items-center gap-3">
          <div className="bg-black/50 backdrop-blur-sm border border-zinc-700 rounded-lg p-2 flex items-center gap-1">
            <Move size={16} className="text-zinc-400" />
            <span className="text-zinc-500 text-[10px]">WASD</span>
          </div>
          <button
            className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-all ${
              biteReady
                ? 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/50 active:scale-95'
                : 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
            }`}
            onPointerDown={() => { biteRequest.pending = true; }}
          >
            🦷 BITE
          </button>
          <div className="bg-black/50 backdrop-blur-sm border border-zinc-700 rounded-lg p-2 flex items-center gap-1">
            <ArrowUpDown size={16} className="text-zinc-400" />
            <span className="text-zinc-500 text-[10px]">Q/E</span>
          </div>
        </div>
      )}

      {/* Mobile joystick */}
      {isMobile && showMobileControls && me && !me.dead && !me.spectator && <VirtualJoystick />}

      <ChatLeaderboardPanel />

      {/* Death overlay — re-enter for a ticket to keep surviving, or spectate */}
      {me?.dead && inRound && !dismissedDeath && !end && (
        <DeathScreen
          killerName={killerName || '...'}
          kills={me.kills}
          weight={me.weight}
          tokens={me.tokens}
          onRespawn={() => sendRespawn()}
          onSpectate={() => setDismissedDeath(true)}
        />
      )}

      {/* Dismissed the death screen but still want back in? Floating buy-back. */}
      {me?.dead && inRound && dismissedDeath && me.tokens >= 1 && !end && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-auto">
          <button
            onClick={() => sendRespawn()}
            className="px-5 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-mono font-bold text-sm shadow-lg shadow-red-900/50 transition-colors"
          >
            🎟 Re-enter — 1 ticket ({me.tokens} left)
          </button>
        </div>
      )}

      {net.phase === 'ended' && end && (
        <EventEndedOverlay survivors={end.survivors} prizeFish={end.prizeFish} meName={me?.name ?? ''} />
      )}

      {showShare && me && !end && (
        <ShareCard name={me.name} color={me.color} prizeFish={net.prizeFish} onClose={() => setShowShare(false)} />
      )}
    </div>
  );
}
