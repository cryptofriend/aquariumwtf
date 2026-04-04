import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  killerName: string;
  kills: number;
  survivalTime: number;
  onSpectate: () => void;
  onPlayAgain: () => void;
}

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export default function DeathScreen({ killerName, kills, survivalTime, onSpectate, onPlayAgain }: Props) {
  const [topScores, setTopScores] = useState<{ player_name: string; survival_seconds: number; kills: number }[]>([]);

  useEffect(() => {
    supabase
      .from('leaderboard')
      .select('player_name, survival_seconds, kills')
      .order('survival_seconds', { ascending: false })
      .limit(10)
      .then(({ data }) => {
        if (data) setTopScores(data as any);
      });
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{ background: 'radial-gradient(ellipse at center, #3b0a0a 0%, #1a0505 100%)' }}>
      <div className="text-8xl mb-4">💀</div>
      <h1 className="text-4xl font-mono font-bold text-red-400 mb-2">You were eaten</h1>
      {killerName && (
        <p className="text-zinc-400 font-mono text-lg mb-1">
          by <span className="text-red-300 font-bold">{killerName}</span>
        </p>
      )}
      <p className="text-zinc-500 font-mono text-sm mb-1">
        Final kills: <span className="text-zinc-300 font-bold">{kills}</span>
      </p>
      <p className="text-zinc-500 font-mono text-sm mb-6">
        Survived: <span className="text-cyan-400 font-bold">{formatTime(survivalTime)}</span>
      </p>

      {/* Best Runs */}
      {topScores.length > 0 && (
        <div className="bg-black/40 border border-zinc-700 rounded-lg p-4 mb-6 min-w-[280px]">
          <div className="text-amber-400 text-xs font-mono font-bold mb-2 uppercase tracking-wider text-center">🏆 Best Runs</div>
          {topScores.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-xs font-mono py-0.5">
              <span className="text-zinc-400 w-4">{i + 1}</span>
              <span className="text-zinc-200 truncate flex-1">{s.player_name}</span>
              <span className="text-cyan-400">{formatTime(s.survival_seconds)}</span>
              <span className="text-red-400">{s.kills}🗡</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-4">
        <button
          onClick={onPlayAgain}
          className="px-8 py-3 rounded-lg bg-red-800 hover:bg-red-700 border border-red-600 text-zinc-200 font-mono font-bold text-lg transition-colors"
        >
          Play Again 🐟
        </button>
        <button
          onClick={onSpectate}
          className="px-8 py-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-zinc-200 font-mono font-bold text-lg transition-colors"
        >
          Watch →
        </button>
      </div>
    </div>
  );
}
