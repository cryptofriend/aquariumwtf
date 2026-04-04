import { useEffect, useState } from 'react';
import { getStore } from '../game/useGameStore';
import { MAX_HP, TANK_HALF } from '../game/constants';
import { PlayerState } from '../game/types';
import { supabase } from '@/integrations/supabase/client';

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function hpColor(hp: number) {
  const pct = hp / MAX_HP;
  if (pct > 0.55) return '#22c55e';
  if (pct > 0.3) return '#eab308';
  return '#ef4444';
}

function Minimap() {
  const store = getStore();
  const mapW = 160;
  const mapH = 120;

  // Map 3D coords to 2D minimap (top-down: x → x, z → y)
  const toMap = (x: number, z: number) => ({
    mx: ((x + TANK_HALF.x) / (TANK_HALF.x * 2)) * mapW,
    my: ((z + TANK_HALF.z) / (TANK_HALF.z * 2)) * mapH,
  });

  const dots: { mx: number; my: number; depth: number; color: string; name: string; isPlayer: boolean; dead: boolean }[] = [];

  // Normalize Y to 0..1 (bottom to top of tank)
  const normY = (y: number) => (y + TANK_HALF.y) / (TANK_HALF.y * 2);

  // Local player
  if (!store.spectate) {
    const { mx, my } = toMap(store.position.x, store.position.z);
    dots.push({ mx, my, depth: normY(store.position.y), color: store.color, name: store.name, isPlayer: true, dead: store.dead });
  }

  // Remote players
  store.remotePlayers.forEach((p) => {
    const { mx, my } = toMap(p.x, p.z);
    dots.push({ mx, my, depth: normY(p.y), color: p.color, name: p.name, isPlayer: false, dead: p.dead });
  });

  return (
    <div className="absolute bottom-20 right-4 pointer-events-auto">
      <div className="bg-black/70 backdrop-blur-sm border border-zinc-700 rounded-lg p-2">
        <div className="text-zinc-500 text-[9px] uppercase tracking-wider mb-1 text-center font-bold">Radar</div>
        <div
          className="relative border border-zinc-700/50 rounded"
          style={{ width: mapW, height: mapH, background: 'rgba(5,5,16,0.8)' }}
        >
          {/* Grid lines */}
          <svg className="absolute inset-0 w-full h-full opacity-20" viewBox={`0 0 ${mapW} ${mapH}`}>
            <line x1={mapW / 2} y1={0} x2={mapW / 2} y2={mapH} stroke="#444" strokeWidth={0.5} />
            <line x1={0} y1={mapH / 2} x2={mapW} y2={mapH / 2} stroke="#444" strokeWidth={0.5} />
            <rect x={1} y={1} width={mapW - 2} height={mapH - 2} fill="none" stroke="#555" strokeWidth={0.5} />
          </svg>

          {/* Fish dots */}
          {dots.map((d, i) => {
            // Dot size scales with depth (higher = bigger)
            const baseSize = d.isPlayer ? 8 : 5;
            const size = baseSize + d.depth * 4;
            return (
              <div
                key={i}
                className="absolute"
                style={{
                  left: d.mx - size / 2,
                  top: d.my - size / 2,
                  width: size,
                  height: size,
                }}
              >
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
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[7px] text-white whitespace-nowrap font-bold">
                    YOU
                  </div>
                )}
              </div>
            );
          })}

          {/* Depth scale bar */}
          <div className="absolute -right-5 top-0 bottom-0 w-3 flex flex-col items-center justify-between">
            <div className="text-[6px] text-zinc-500">⬆</div>
            <div
              className="w-1.5 flex-1 rounded-full mx-auto my-0.5 overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.08)' }}
            >
              <div
                className="w-full rounded-full transition-all duration-200"
                style={{
                  height: `${(1 - (dots.find(d => d.isPlayer)?.depth ?? 0.5)) * 100}%`,
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

export default function GameUI() {
  const [, setTick] = useState(0);
  const [topScores, setTopScores] = useState<{ player_name: string; weight: number; kills: number }[]>([]);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 200);
    return () => clearInterval(id);
  }, []);

  // Fetch top scores on mount and every 30s
  useEffect(() => {
    const fetchScores = async () => {
      const { data } = await supabase
        .from('leaderboard')
        .select('player_name, weight, kills')
        .order('weight', { ascending: false })
        .limit(5);
      if (data) setTopScores(data as any);
    };
    fetchScores();
    const id = setInterval(fetchScores, 30000);
    return () => clearInterval(id);
  }, []);

  const store = getStore();
  const hpPct = Math.max(0, store.hp / MAX_HP) * 100;

  // Survival timer
  const elapsed = store.spawnTime > 0 ? Math.floor((Date.now() - store.spawnTime) / 1000) : 0;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timerStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  // Build live player list
  const liveEntries: { name: string; kills: number; hp: number; dead: boolean }[] = [];
  if (!store.spectate) {
    liveEntries.push({ name: store.name, kills: store.kills, hp: store.hp, dead: store.dead });
  }
  store.remotePlayers.forEach(p => {
    liveEntries.push({ name: p.name, kills: p.kills, hp: p.hp, dead: p.dead });
  });
  liveEntries.sort((a, b) => b.kills - a.kills);

  return (
    <div className="fixed inset-0 z-40 pointer-events-none font-mono">
      {/* Live Players */}
      <div className="absolute top-4 left-4 pointer-events-auto bg-black/60 backdrop-blur-sm border border-zinc-800 rounded-lg p-3 min-w-[200px]">
        <div className="text-purple-400 text-xs font-bold mb-2 uppercase tracking-wider">🔴 Live Players</div>
        {liveEntries.slice(0, 8).map((e, i) => (
          <div key={i} className={`flex items-center gap-2 text-xs py-0.5 ${e.dead ? 'opacity-40 line-through' : ''}`}>
            <span className="text-zinc-400 w-4">{i + 1}</span>
            <span className="text-zinc-200 truncate flex-1">{e.name}</span>
            <span className="text-red-400">{e.kills}🗡</span>
            <span className="text-zinc-500">{e.hp}</span>
          </div>
        ))}
        {liveEntries.length === 0 && <div className="text-zinc-600 text-xs">No players yet</div>}

        {/* Best Runs */}
        {topScores.length > 0 && (
          <>
            <div className="text-amber-400 text-xs font-bold mt-3 mb-1 uppercase tracking-wider border-t border-zinc-700 pt-2">🏆 Best Runs</div>
            {topScores.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-xs py-0.5">
                <span className="text-zinc-400 w-4">{i + 1}</span>
                <span className="text-zinc-200 truncate flex-1">{s.player_name}</span>
                <span className="text-cyan-400">{formatTime(s.survival_seconds)}</span>
                <span className="text-red-400">{s.kills}🗡</span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Kill counter + Survival timer */}
      {!store.spectate && (
        <div className="absolute top-4 right-4 flex flex-col items-end gap-2">
          <div className="bg-black/60 backdrop-blur-sm border border-zinc-800 rounded-lg px-4 py-2">
            <span className="text-red-400 text-2xl font-bold">{store.kills}</span>
            <span className="text-zinc-500 text-xs ml-1">kills</span>
          </div>
          <div className="bg-black/60 backdrop-blur-sm border border-zinc-800 rounded-lg px-4 py-2">
            <span className="text-cyan-400 text-2xl font-bold">{timerStr}</span>
            <span className="text-zinc-500 text-xs ml-1">survived</span>
          </div>
          <div className="bg-black/60 backdrop-blur-sm border border-zinc-800 rounded-lg px-4 py-2">
            <span className="text-amber-400 text-xl font-bold">{store.weight}</span>
            <span className="text-zinc-500 text-xs ml-1">kg</span>
            <span className="text-zinc-600 text-[10px] ml-2">bite: {Math.max(1, Math.round(store.weight * 0.1))}</span>
          </div>
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

      {/* Minimap / Radar */}
      <Minimap />

      {/* Controls hint */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-zinc-600 text-xs text-center">
        WASD move · Q/E up/down · Mouse attract · Auto-bite nearby
      </div>
    </div>
  );
}