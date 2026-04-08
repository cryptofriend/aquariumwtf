import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Trophy } from 'lucide-react';

interface LeaderboardEntry {
  player_name: string;
  weight: number;
  kills: number;
  survival_seconds: number;
}

export default function Leaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from('leaderboard')
        .select('player_name, weight, kills, survival_seconds')
        .order('weight', { ascending: false })
        .limit(10);
      if (data) setEntries(data);
      setLoading(false);
    };
    fetch();
    const interval = setInterval(fetch, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-black/60 backdrop-blur-sm border border-zinc-800 rounded-lg p-3 min-w-[200px] max-w-[220px]">
      <div className="text-amber-400 text-xs font-bold mb-2 uppercase tracking-wider flex items-center gap-1.5">
        <Trophy size={12} /> All-Time Best
      </div>
      {loading ? (
        <div className="text-zinc-600 text-xs">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="text-zinc-600 text-xs">No scores yet</div>
      ) : (
        entries.map((e, i) => (
          <div key={i} className="flex items-center gap-2 text-xs py-0.5">
            <span className={`w-4 ${i < 3 ? 'text-amber-400 font-bold' : 'text-zinc-500'}`}>
              {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
            </span>
            <span className="truncate flex-1 text-zinc-200">{e.player_name}</span>
            <span className="text-amber-400">{Number(e.weight).toFixed(1)}kg</span>
            <span className="text-red-400">{e.kills}🗡</span>
          </div>
        ))
      )}
    </div>
  );
}
