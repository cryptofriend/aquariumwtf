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

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center"
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
    </div>
  );
}
