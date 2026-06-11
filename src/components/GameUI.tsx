import { useEffect, useState } from 'react';
import { TANK_HALF, BITE_COOLDOWN_MS } from '../game/constants';
import { biteRequest } from './TankScene';
import { Move, ArrowUpDown, Bug, Info, X, Smartphone } from 'lucide-react';
import { useIsMobile } from '../hooks/use-mobile';
import VirtualJoystick from './VirtualJoystick';
import ChatLeaderboardPanel from './ChatLeaderboardPanel';
import DeathScreen from './DeathScreen';
import { net, self, phaseMsLeft, on, sendRespawn } from '../net/gameClient';
import type { Standing } from '../../shared/protocol';
import { toast } from 'sonner';

function fmtTime(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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

/** Top-center banner: lobby / countdown / round timer / frenzy warning. */
function RoundBanner() {
  const msLeft = phaseMsLeft();
  const playing = [...net.players.values()].filter((p) => !p.spectator).length;

  let content: JSX.Element;
  switch (net.phase) {
    case 'lobby':
      content = (
        <span className="text-cyan-300">
          🐟 Warm-up — waiting for fish ({playing}/{net.needed})
        </span>
      );
      break;
    case 'countdown':
      content = (
        <span className="text-amber-300 text-lg font-bold animate-pulse">
          ⚔️ Round starts in {Math.ceil(msLeft / 1000)}…
        </span>
      );
      break;
    case 'round': {
      const frenzy = msLeft < 60_000;
      content = (
        <span className={frenzy ? 'text-red-400 font-bold animate-pulse' : 'text-zinc-200'}>
          {frenzy ? '🔥 FRENZY ' : '⏱ '}{fmtTime(msLeft)} · {net.alive} alive · <span className="text-amber-300">🏆 pot {net.pot}🪙</span>
        </span>
      );
      break;
    }
    case 'results':
      content = <span className="text-emerald-300">🏆 Round over — next one in {Math.ceil(msLeft / 1000)}s</span>;
      break;
  }

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none">
      <div className="bg-black/70 backdrop-blur-sm border border-zinc-700 rounded-lg px-5 py-2 font-mono text-sm text-center">
        {content}
      </div>
    </div>
  );
}

function ResultsOverlay({ standings, pot }: { standings: Standing[]; pot: number }) {
  const winner = standings[0];
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-auto bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-950/95 border border-zinc-700 rounded-2xl p-8 font-mono text-center min-w-[320px]">
        <div className="text-6xl mb-3">🏆</div>
        {winner ? (
          <>
            <h2 className="text-2xl font-bold text-amber-300 mb-1">{winner.name} wins!</h2>
            <p className="text-amber-200 text-lg font-bold mb-1">+{pot} 🪙 — winner takes the pot</p>
            <p className="text-zinc-400 text-sm mb-5">{winner.weight.toFixed(1)}kg · {winner.kills} kills</p>
          </>
        ) : (
          <h2 className="text-2xl font-bold text-zinc-300 mb-5">Round over</h2>
        )}
        <div className="space-y-1 text-left mb-5">
          {standings.slice(0, 8).map((s, i) => (
            <div key={s.name} className={`flex items-center gap-2 text-xs ${i === 0 ? 'text-amber-300' : s.alive ? 'text-zinc-300' : 'text-zinc-600 line-through'}`}>
              <span className="w-5 text-zinc-500">{i + 1}.</span>
              <span className="flex-1 truncate">{s.name}{s.bot ? ' 🤖' : ''}</span>
              <span>{s.weight.toFixed(1)}kg</span>
              <span className="text-red-400">{s.kills}🗡</span>
            </div>
          ))}
        </div>
        <p className="text-zinc-500 text-xs animate-pulse">Next round starting in {Math.ceil(phaseMsLeft() / 1000)}s…</p>
      </div>
    </div>
  );
}

/** Highlighted banner for plankton-mode players. */
function GuestBanner() {
  return (
    <div className="absolute top-16 left-1/2 -translate-x-1/2 pointer-events-auto">
      <div className="bg-amber-500/15 backdrop-blur-sm border-2 border-amber-400 rounded-lg px-5 py-2 font-mono text-center shadow-lg shadow-amber-900/40 animate-pulse">
        <span className="text-amber-300 text-xs font-bold uppercase tracking-wider">
          🦐 Guest mode — swim &amp; eat plankton only · no bites, no prizes
        </span>
        <div className="text-zinc-300 text-[10px] mt-0.5">
          Connect a Solana wallet on the entry screen to hunt and win the pot
        </div>
      </div>
    </div>
  );
}

export default function GameUI() {
  const [, setTick] = useState(0);
  const [showRules, setShowRules] = useState(false);
  const [showMobileControls, setShowMobileControls] = useState(true);
  const [standings, setStandings] = useState<Standing[] | null>(null);
  const [lastPot, setLastPot] = useState(0);
  const [killerName, setKillerName] = useState('');
  const [dismissedDeath, setDismissedDeath] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 200);
    return () => clearInterval(id);
  }, []);

  // Surface server-side rejections (e.g. respawn with 0 tokens)
  useEffect(() => on('status', () => {
    if (net.lastError) {
      toast.error(net.lastError);
      net.lastError = '';
    }
  }), []);

  useEffect(() => on('event', (e) => {
    if (e.kind === 'round_end') { setStandings(e.standings); setLastPot(e.pot); }
    if (e.kind === 'round_start') { setStandings(null); setKillerName(''); setDismissedDeath(false); }
    if (e.kind === 'kill' && e.victimId === net.selfId) { setKillerName(e.attacker); setDismissedDeath(false); }
    if (e.kind === 'respawn' && e.playerId === net.selfId) {
      toast.success('🪙 Re-entered the round — fresh fish, 5s protection');
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
  const inRound = net.phase === 'round';

  const liveEntries = [...net.players.values()]
    .filter((p) => !p.spectator)
    .map((p) => ({ name: p.name, kills: p.kills, dead: p.dead, weight: p.weight, isMe: p.id === net.selfId, bot: p.bot, guest: p.guest }))
    .sort((a, b) => Number(a.guest) - Number(b.guest) || Number(!b.dead) - Number(!a.dead) || b.weight - a.weight);

  const canBite = me && !me.dead && !me.spectator && !me.guest && inRound;
  const biteReady = Date.now() - net.lastBiteSentAt > BITE_COOLDOWN_MS;

  return (
    <div className="fixed inset-0 z-40 pointer-events-none font-mono">
      <RoundBanner />
      {me?.guest && <GuestBanner />}

      {/* Live standings */}
      <div className="absolute top-4 left-4 pointer-events-auto bg-black/60 backdrop-blur-sm border border-zinc-800 rounded-lg p-3 min-w-[200px]">
        <div className="text-purple-400 text-xs font-bold mb-2 uppercase tracking-wider">
          {inRound ? '🔴 Eat or Get Eaten' : '🐟 In the Tank'}
        </div>
        {liveEntries.slice(0, 8).map((e, i) => (
          <div key={i} className={`flex items-center gap-2 text-xs py-0.5 ${e.dead ? 'opacity-40 line-through' : ''} ${e.isMe ? 'bg-white/10 rounded px-1 -mx-1' : ''}`}>
            <span className="text-zinc-400 w-4">{i + 1}</span>
            <span className={`truncate flex-1 ${e.isMe ? 'text-yellow-300 font-bold' : e.guest ? 'text-zinc-500' : 'text-zinc-200'}`}>
              {e.name}{e.bot ? ' 🤖' : ''}{e.guest ? ' 🦐' : ''}{e.isMe ? ' (you)' : ''}
            </span>
            <span className="text-amber-400">{e.weight.toFixed(1)}kg</span>
            <span className="text-red-400">{e.kills}🗡</span>
          </div>
        ))}
        {liveEntries.length === 0 && <div className="text-zinc-600 text-xs">No players yet</div>}
      </div>

      {/* My stats */}
      <div className="absolute top-4 right-4 flex flex-col items-end gap-2 pointer-events-auto">
        {me && (
          <div className="bg-black/60 backdrop-blur-sm border border-zinc-800 rounded-lg px-4 py-2 text-right">
            {me.guest ? (
              <span className="text-amber-300 text-sm font-bold">🦐 guest</span>
            ) : (
              <>
                <span className="text-amber-300 text-xl font-bold">{me.tokens}</span>
                <span className="text-zinc-500 text-xs ml-1">🪙 tokens</span>
              </>
            )}
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
              {!me.guest && <span className="text-zinc-600 text-[10px] ml-2">bite: {(me.weight * 0.1).toFixed(1)}kg</span>}
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
            <span className="text-cyan-300 text-[10px] font-bold uppercase tracking-wider">👻 Spectating — you play next round</span>
            {inRound && me.tokens >= 1 && (
              <button
                onClick={() => sendRespawn()}
                className="px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold transition-colors"
              >
                🪙 Buy in now — 1 token
              </button>
            )}
          </div>
        )}
      </div>

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
              Rounds last 5 minutes. The <span className="text-amber-300 font-bold">biggest fish at the buzzer takes the pot</span>.
            </p>
          </div>

          <div className="mb-3 p-2 rounded-md bg-yellow-500/10 border border-yellow-500/30">
            <div className="text-yellow-300 text-[10px] font-bold uppercase tracking-wider mb-1">🪙 Tokens</div>
            <ul className="text-zinc-300 text-[11px] space-y-1 list-disc list-inside">
              <li>Entering a round costs <span className="text-yellow-300">1 token</span> — it goes into the pot</li>
              <li>Died? <span className="text-yellow-300">Re-enter for 1 token</span> — as many times as you can afford</li>
              <li>The winner takes the <span className="text-amber-300 font-bold">whole pot</span></li>
              <li>You start with 5 demo tokens (real $MYTH coming soon)</li>
              <li>🦐 <span className="text-zinc-400">Guests (no wallet) swim &amp; eat plankton only — no bites, no prizes</span></li>
            </ul>
          </div>

          <div className="mb-3">
            <div className="text-emerald-300 text-[10px] font-bold uppercase tracking-wider mb-1">📈 How to grow</div>
            <ul className="text-zinc-300 text-[11px] space-y-1 list-disc list-inside">
              <li>Swim into <span className="text-emerald-300">🌿 food orbs</span> (+0.5kg, automatic)</li>
              <li><span className="text-red-400">Bite</span> to steal <span className="text-amber-400">10% of your weight</span> from a victim (max half of theirs per bite)</li>
              <li>Fresh spawns have <span className="text-emerald-300">5s 🛡 protection</span> — attacking ends yours</li>
              <li>Big fish swim slower and slowly shrink — keep hunting</li>
              <li>In the final minute (<span className="text-red-400">🔥 frenzy</span>) everyone shrinks — defend your lead</li>
              <li>If a bite drops you below 0.3kg you're <span className="text-red-400">dead</span> — you spectate until next round</li>
            </ul>
          </div>

          <div>
            <div className="text-cyan-300 text-[10px] font-bold uppercase tracking-wider mb-1">🎮 Controls</div>
            <ul className="text-zinc-300 text-[11px] space-y-1 list-disc list-inside">
              <li>Swim with <span className="text-yellow-300">WASD</span>, rise/dive with <span className="text-yellow-300">Q/E</span></li>
              <li>Or just point the mouse where you want to go</li>
              <li><span className="text-yellow-300">Space</span> / BITE button — bite the nearest fish in range</li>
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

      {/* Death overlay — re-enter for 1 token, or spectate; results replace it */}
      {me?.dead && inRound && !dismissedDeath && (
        <DeathScreen
          killerName={killerName || '...'}
          kills={me.kills}
          weight={me.weight}
          tokens={me.tokens}
          isGuest={me.guest}
          graceMsLeft={net.graceEndsAt > 0 ? Math.max(0, net.graceEndsAt - (Date.now() + net.clockSkew)) : 0}
          onRespawn={() => sendRespawn()}
          onSpectate={() => setDismissedDeath(true)}
        />
      )}

      {/* Dismissed the death screen but still want back in? Floating buy-back. */}
      {me?.dead && inRound && dismissedDeath && me.tokens >= 1 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-auto">
          <button
            onClick={() => sendRespawn()}
            className="px-5 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-mono font-bold text-sm shadow-lg shadow-red-900/50 transition-colors"
          >
            🪙 Re-enter — 1 token ({me.tokens} left)
          </button>
        </div>
      )}

      {net.phase === 'results' && standings && <ResultsOverlay standings={standings} pot={lastPot} />}
    </div>
  );
}
