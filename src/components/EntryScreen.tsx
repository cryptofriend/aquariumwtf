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
  const [copied, setCopied] = useState(false);
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

  const gameUrl = 'https://aquarium.wtf';

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
        🤖 {showAgentInfo ? 'Hide' : 'Show'} Agent Instructions
      </button>

      {showAgentInfo && (() => {
        const agentPrompt = `You are an AI agent that can join and play in the Aquarium fish game at ${gameUrl}.

To enter the game, navigate to this URL:
${gameUrl}/?portal=true&username=YOUR_NAME&color=YOUR_COLOR&hp=YOUR_HP

Parameters:
- portal=true (REQUIRED) — skips the entry screen and spawns you instantly
- username — your agent name, max 16 characters (optional, random if omitted)
- color — fish color as hex (%23ff0000) or name (red, cyan, etc.) (optional)
- hp — starting health/weight 1-100 (optional, default 1)
- speed — movement speed in m/s (optional)
- ref — a return URL so a portal appears to go back (optional)

Example:
${gameUrl}/?portal=true&username=AgentSmith&color=%2300ff88&hp=50

Game rules:
- You are a fish in a 3D aquarium with other players
- Swim close to enemies to BITE them and steal 10% of your weight from them
- Grow heavier to climb the leaderboard
- If your weight drops to 0, you die
- There is a Vibe Jam Portal in the center — entering it takes you to the next game in the webring

Controls (if you have browser control):
- WASD to swim, Q/E to rise/dive
- Mouse movement attracts your fish
- Auto-bite when near enemies

Join now and become the biggest fish in the tank!`;

        const handleCopy = () => {
          navigator.clipboard.writeText(agentPrompt).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        };

        return (
          <div className="mt-4 w-[90vw] max-w-lg bg-zinc-900/90 border border-zinc-700 rounded-lg p-5 text-left font-mono text-xs space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-purple-400 text-sm font-bold">🤖 Agent Instructions</h2>
              <button
                onClick={handleCopy}
                className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all ${
                  copied
                    ? 'bg-emerald-600 text-white'
                    : 'bg-purple-600 hover:bg-purple-500 text-white'
                }`}
              >
                {copied ? '✓ Copied!' : '📋 Copy Prompt'}
              </button>
            </div>
            <p className="text-zinc-400 text-[11px]">
              Copy this prompt and paste it to your AI agent. The agent will know how to join the aquarium and play.
            </p>
            <pre className="bg-zinc-950 rounded-lg p-3 text-[10px] text-zinc-300 whitespace-pre-wrap break-words max-h-60 overflow-y-auto border border-zinc-800 leading-relaxed">
              {agentPrompt}
            </pre>
            <div className="pt-2 border-t border-zinc-800 text-zinc-500 text-[10px]">
              Part of the <a href="https://jam.pieter.com" target="_blank" rel="noopener" className="text-purple-400 hover:text-purple-300 underline">Vibe Jam 2026</a> Webring 🌀
            </div>
          </div>
        );
      })()}
    </div>
  );
}