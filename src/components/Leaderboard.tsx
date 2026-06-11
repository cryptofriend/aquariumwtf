import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { serverUrl } from '../net/gameClient';

interface Winner {
  name: string;
  wallet: string;
  weight: number;
  kills: number;
  pot: number;
  at: number;
}

interface Props {
  /** When false, render without the outer card chrome (for embedding inside another panel). */
  chrome?: boolean;
}

/**
 * Hall of fame: recent round winners straight from the game server.
 * (The legacy Supabase table from the client-authoritative era is retired —
 * every entry here came out of a real, server-adjudicated round.)
 */
export default function Leaderboard({ chrome = true }: Props = {}) {
  const [winners, setWinners] = useState<Winner[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch(`${serverUrl().http}/winners`)
        .then((r) => r.json())
        .then((d) => { if (!cancelled && d.ok) setWinners(d.winners); })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    load();
    const id = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const list = (
    <div className="space-y-1">
      {loading && <div className="text-zinc-600 text-[11px] text-center py-4">Loading…</div>}
      {!loading && winners.length === 0 && (
        <div className="text-zinc-600 text-[11px] text-center py-4">
          No champions yet — win a round to make history 🏆
        </div>
      )}
      {winners.map((w, i) => (
        <div key={`${w.at}-${i}`} className="flex items-center gap-2 text-xs py-0.5">
          <span className="w-5 text-center">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : <span className="text-zinc-500">{i + 1}</span>}</span>
          <span className="truncate flex-1 text-zinc-200">
            {w.name}
            {w.wallet && <span className="text-emerald-500 text-[9px] ml-1">◎{w.wallet}</span>}
          </span>
          <span className="text-amber-400">{w.weight.toFixed(1)}kg</span>
          <span className="text-yellow-300">+{w.pot}🎟</span>
          <span className="text-red-400">{w.kills}🗡</span>
        </div>
      ))}
    </div>
  );

  if (!chrome) return list;

  return (
    <div className="bg-black/60 backdrop-blur-sm border border-zinc-800 rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Trophy size={12} className="text-amber-400" />
        <span className="text-amber-300 text-xs font-bold uppercase tracking-wider">Round Winners</span>
      </div>
      {list}
    </div>
  );
}
