import { useEffect, useState } from 'react';
import { getStore } from '../game/useGameStore';
import { MAX_HP } from '../game/constants';
import { PlayerState } from '../game/types';

function hpColor(hp: number) {
  const pct = hp / MAX_HP;
  if (pct > 0.55) return '#22c55e';
  if (pct > 0.3) return '#eab308';
  return '#ef4444';
}

export default function GameUI() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 200);
    return () => clearInterval(id);
  }, []);

  const store = getStore();
  const hpPct = Math.max(0, store.hp / MAX_HP) * 100;

  // Build leaderboard
  const entries: { name: string; kills: number; hp: number; dead: boolean }[] = [];
  if (!store.spectate) {
    entries.push({ name: store.name, kills: store.kills, hp: store.hp, dead: store.dead });
  }
  store.remotePlayers.forEach(p => {
    entries.push({ name: p.name, kills: p.kills, hp: p.hp, dead: p.dead });
  });
  entries.sort((a, b) => b.kills - a.kills);

  return (
    <div className="fixed inset-0 z-40 pointer-events-none font-mono">
      {/* Leaderboard */}
      <div className="absolute top-4 left-4 pointer-events-auto bg-black/60 backdrop-blur-sm border border-zinc-800 rounded-lg p-3 min-w-[180px]">
        <div className="text-purple-400 text-xs font-bold mb-2 uppercase tracking-wider">Leaderboard</div>
        {entries.slice(0, 8).map((e, i) => (
          <div key={i} className={`flex items-center gap-2 text-xs py-0.5 ${e.dead ? 'opacity-40 line-through' : ''}`}>
            <span className="text-zinc-400 w-4">{i + 1}</span>
            <span className="text-zinc-200 truncate flex-1">{e.name}</span>
            <span className="text-red-400">{e.kills}🗡</span>
            <span className="text-zinc-500">{e.hp}</span>
          </div>
        ))}
        {entries.length === 0 && <div className="text-zinc-600 text-xs">No players yet</div>}
      </div>

      {/* Kill counter */}
      {!store.spectate && (
        <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-sm border border-zinc-800 rounded-lg px-4 py-2">
          <span className="text-red-400 text-2xl font-bold">{store.kills}</span>
          <span className="text-zinc-500 text-xs ml-1">kills</span>
        </div>
      )}

      {/* HP bar */}
      {!store.spectate && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 w-64">
          <div className="bg-black/60 backdrop-blur-sm border border-zinc-800 rounded-full h-5 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-200"
              style={{ width: `${hpPct}%`, backgroundColor: hpColor(store.hp) }}
            />
          </div>
          <div className="text-center text-zinc-500 text-xs mt-1">{store.hp} / {MAX_HP}</div>
        </div>
      )}

      {/* Controls hint */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-zinc-600 text-xs text-center">
        WASD move · Q/E up/down · Mouse attract · Auto-bite nearby
      </div>
    </div>
  );
}
