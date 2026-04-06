import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  onEnter: (name: string) => void;
}

export default function EntryScreen({ onEnter }: Props) {
  const [name, setName] = useState('');
  const [fishCount, setFishCount] = useState(0);
  const [takenNames, setTakenNames] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [showAgentInfo, setShowAgentInfo] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    const channel = supabase.channel('lobby-stats');
    channelRef.current = channel;
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        setFishCount(Object.keys(state).length);
        const names = new Set<string>();
        Object.values(state).forEach((presences: any[]) => {
          presences.forEach((p) => {
            if (p.name) names.add(p.name.toLowerCase());
          });
        });
        setTakenNames(names);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ role: 'observer' });
        }
      });
    return () => { supabase.removeChannel(channel); };
  }, []);

  const trimmed = name.trim();
  const isTaken = trimmed.length > 0 && takenNames.has(trimmed.toLowerCase());

  const handleEnter = () => {
    if (!trimmed) return;
    if (isTaken) {
      setError('Name already taken!');
      return;
    }
    channelRef.current?.track({ role: 'player', name: trimmed });
    onEnter(trimmed);
  };

  const gameUrl = window.location.origin;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto py-8"
      style={{ background: 'radial-gradient(ellipse at center, #1a1a3e 0%, #0a0a1a 100%)' }}>
      <div className="text-8xl mb-4">🐠</div>
      <h1 className="text-5xl font-mono font-bold text-purple-400 mb-2 tracking-tight">
        Aquarium
      </h1>
      <p className="text-zinc-500 font-mono text-sm mb-1">The Hunger Fish</p>
      <p className="text-emerald-400 font-mono text-sm mb-4 animate-pulse">
        🐟 {fishCount} fish swimming right now
      </p>

      <input
        autoFocus
        value={name}
        onChange={e => { setName(e.target.value); setError(''); }}
        onKeyDown={e => e.key === 'Enter' && handleEnter()}
        placeholder="Name your agent..."
        maxLength={16}
        className={`w-72 px-4 py-3 rounded-lg bg-zinc-900/80 border ${isTaken ? 'border-red-500' : 'border-zinc-700'} text-zinc-100 font-mono text-center text-lg placeholder:text-zinc-600 focus:outline-none focus:border-purple-500 mb-1`}
      />
      {isTaken && <p className="text-red-400 text-xs font-mono mb-2">⚠ This name is already in use</p>}
      {error && !isTaken && <p className="text-red-400 text-xs font-mono mb-2">{error}</p>}
      {!isTaken && !error && <div className="mb-3" />}

      <button
        disabled={!trimmed || isTaken}
        onClick={handleEnter}
        className="px-8 py-3 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-mono font-bold text-lg transition-colors"
      >
        Enter the Tank 🩸
      </button>

      <div className="mt-8 text-zinc-600 font-mono text-xs text-center space-y-1">
        <p>WASD / Arrows — swim &nbsp;·&nbsp; Q/E — up/down</p>
        <p>Mouse — attract &nbsp;·&nbsp; Auto-bite nearby enemies</p>
      </div>

      {/* Agent / Portal API section */}
      <button
        onClick={() => setShowAgentInfo(!showAgentInfo)}
        className="mt-6 px-4 py-2 rounded-md border border-zinc-700 bg-zinc-900/60 text-zinc-400 font-mono text-xs hover:border-purple-500 hover:text-purple-300 transition-colors"
      >
        🤖 {showAgentInfo ? 'Hide' : 'Show'} Agent / Portal API
      </button>

      {showAgentInfo && (
        <div className="mt-4 w-[90vw] max-w-lg bg-zinc-900/90 border border-zinc-700 rounded-lg p-5 text-left font-mono text-xs space-y-4">
          <h2 className="text-purple-400 text-sm font-bold">🤖 Agent API — Join via URL</h2>
          <p className="text-zinc-400">
            Agents (bots or other games) can drop players directly into the tank by navigating to:
          </p>

          <div className="bg-zinc-950 rounded p-3 overflow-x-auto">
            <code className="text-emerald-400 text-[11px] break-all">
              {gameUrl}/?portal=true&username=MyBot&color=red&hp=80&speed=5&ref=yourgame.com
            </code>
          </div>

          <div className="space-y-2">
            <h3 className="text-zinc-300 font-bold">Query Parameters</h3>
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-zinc-500 border-b border-zinc-800">
                  <th className="text-left py-1 pr-2">Param</th>
                  <th className="text-left py-1">Description</th>
                </tr>
              </thead>
              <tbody className="text-zinc-400">
                <tr className="border-b border-zinc-800/50">
                  <td className="py-1 pr-2 text-cyan-400">portal</td>
                  <td className="py-1">Must be <code className="text-emerald-400">true</code> — skips entry screen</td>
                </tr>
                <tr className="border-b border-zinc-800/50">
                  <td className="py-1 pr-2 text-cyan-400">username</td>
                  <td className="py-1">Player name (max 16 chars)</td>
                </tr>
                <tr className="border-b border-zinc-800/50">
                  <td className="py-1 pr-2 text-cyan-400">color</td>
                  <td className="py-1">Fish color — hex (<code className="text-emerald-400">#ff0000</code>) or name (<code className="text-emerald-400">red</code>)</td>
                </tr>
                <tr className="border-b border-zinc-800/50">
                  <td className="py-1 pr-2 text-cyan-400">hp</td>
                  <td className="py-1">Health / weight (1–100)</td>
                </tr>
                <tr className="border-b border-zinc-800/50">
                  <td className="py-1 pr-2 text-cyan-400">speed</td>
                  <td className="py-1">Movement speed (m/s)</td>
                </tr>
                <tr>
                  <td className="py-1 pr-2 text-cyan-400">ref</td>
                  <td className="py-1">Return URL — spawns a "Return Portal" back to sender</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="space-y-2">
            <h3 className="text-zinc-300 font-bold">Example</h3>
            <div className="bg-zinc-950 rounded p-3 overflow-x-auto">
              <code className="text-[11px] text-zinc-300 break-all">
                <span className="text-zinc-500">// Send a player named "AgentSmith" with 50 HP</span>{'\n'}
                <span className="text-purple-400">window.location.href</span> = <span className="text-emerald-400">"{gameUrl}/?portal=true&username=AgentSmith&color=%2300ff88&hp=50&ref=yourgame.com"</span>;
              </code>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-zinc-300 font-bold">Portal Behavior</h3>
            <ul className="text-zinc-400 space-y-1 list-disc list-inside">
              <li>Player spawns instantly — no entry screen</li>
              <li>If <code className="text-cyan-400">ref</code> is set, a Return Portal appears so the player can go back</li>
              <li>On exit via the Vibe Jam Portal, all params are forwarded to the next game</li>
              <li>All params except <code className="text-cyan-400">portal</code> are optional</li>
            </ul>
          </div>

          <div className="pt-2 border-t border-zinc-800 text-zinc-500 text-[10px]">
            Part of the <a href="https://jam.pieter.com" target="_blank" rel="noopener" className="text-purple-400 hover:text-purple-300 underline">Vibe Jam 2026</a> Webring 🌀
          </div>
        </div>
      )}
    </div>
  );
}