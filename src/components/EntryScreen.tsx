import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  onEnter: (name: string) => void;
}

export default function EntryScreen({ onEnter }: Props) {
  const [name, setName] = useState('');
  const [fishCount, setFishCount] = useState<number | null>(null);

  useEffect(() => {
    // Use a dedicated read-only channel to observe game presence
    // This MUST be a different channel name from 'aquarium-live' to avoid conflicts
    const channel = supabase.channel('lobby-observer');

    const updateCount = () => {
      const state = channel.presenceState();
      const count = Object.values(state).flat().length;
      setFishCount(count);
    };

    channel
      .on('presence', { event: 'sync' }, updateCount)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{ background: 'radial-gradient(ellipse at center, #1a1a3e 0%, #0a0a1a 100%)' }}>
      <div className="text-8xl mb-4">🐠</div>
      <h1 className="text-5xl font-mono font-bold text-purple-400 mb-2 tracking-tight">
        Aquarium
      </h1>
      <p className="text-zinc-500 font-mono text-sm mb-2">The Hunger Fish</p>

      {fishCount !== null && (
        <div className="flex items-center gap-2 text-zinc-400 font-mono text-sm mb-6">
          <span>🐟</span>
          <span className="text-purple-300 font-bold">{fishCount}</span>
          <span>fish in the tank</span>
        </div>
      )}

      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && name.trim() && onEnter(name.trim())}
        placeholder="Name your agent..."
        maxLength={16}
        className="w-72 px-4 py-3 rounded-lg bg-zinc-900/80 border border-zinc-700 text-zinc-100 font-mono text-center text-lg placeholder:text-zinc-600 focus:outline-none focus:border-purple-500 mb-4"
      />

      <button
        disabled={!name.trim()}
        onClick={() => onEnter(name.trim())}
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
