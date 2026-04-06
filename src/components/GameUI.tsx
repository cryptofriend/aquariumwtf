import { useEffect, useState } from 'react';
import { getStore } from '../game/useGameStore';
import { TANK_HALF, BITE_COOLDOWN_MS } from '../game/constants';

import { biteRequest } from './TankScene';
import { Move, ArrowUpDown, Bug, Info, X } from 'lucide-react';

function Minimap() {
  const store = getStore();
  const mapW = 160;
  const mapH = 120;

  const toMap = (x: number, z: number) => ({
    mx: ((x + TANK_HALF.x) / (TANK_HALF.x * 2)) * mapW,
    my: ((z + TANK_HALF.z) / (TANK_HALF.z * 2)) * mapH,
  });

  const normY = (y: number) => (y + TANK_HALF.y) / (TANK_HALF.y * 2);

  const dots: { mx: number; my: number; depth: number; color: string; name: string; isPlayer: boolean; dead: boolean }[] = [];

  if (!store.spectate) {
    const { mx, my } = toMap(store.position.x, store.position.z);
    dots.push({ mx, my, depth: normY(store.position.y), color: store.color, name: store.name, isPlayer: true, dead: store.dead });
  }

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
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 200);
    return () => clearInterval(id);
  }, []);

  const store = getStore();

  const liveEntries: { name: string; kills: number; dead: boolean; weight: number; isMe: boolean }[] = [];
  if (!store.spectate) {
    liveEntries.push({ name: store.name, kills: store.kills, dead: store.dead, weight: store.weight, isMe: true });
  }
  store.remotePlayers.forEach(p => {
    liveEntries.push({ name: p.name, kills: p.kills, dead: p.dead, weight: p.weight, isMe: false });
  });
  liveEntries.sort((a, b) => b.weight - a.weight);

  return (
    <div className="fixed inset-0 z-40 pointer-events-none font-mono">
      {/* Live Players */}
      <div className="absolute top-4 left-4 pointer-events-auto bg-black/60 backdrop-blur-sm border border-zinc-800 rounded-lg p-3 min-w-[200px]">
        <div className="text-purple-400 text-xs font-bold mb-2 uppercase tracking-wider">🔴 Live Players</div>
        {liveEntries.slice(0, 8).map((e, i) => (
          <div key={i} className={`flex items-center gap-2 text-xs py-0.5 ${e.dead ? 'opacity-40 line-through' : ''} ${e.isMe ? 'bg-white/10 rounded px-1 -mx-1' : ''}`}>
            <span className="text-zinc-400 w-4">{i + 1}</span>
            <span className={`truncate flex-1 ${e.isMe ? 'text-yellow-300 font-bold' : 'text-zinc-200'}`}>{e.name}{e.isMe ? ' (you)' : ''}</span>
            <span className="text-amber-400">{e.weight.toFixed(1)}kg</span>
            <span className="text-red-400">{e.kills}🗡</span>
          </div>
        ))}
        {liveEntries.length === 0 && <div className="text-zinc-600 text-xs">No players yet</div>}
      </div>

      {/* Kill counter + Weight + Immunity */}
      {!store.spectate && (
        <div className="absolute top-4 right-4 flex flex-col items-end gap-2">
          <div className="bg-black/60 backdrop-blur-sm border border-zinc-800 rounded-lg px-4 py-2">
            <span className="text-red-400 text-2xl font-bold">{store.kills}</span>
            <span className="text-zinc-500 text-xs ml-1">kills</span>
          </div>
          <div className="bg-black/60 backdrop-blur-sm border border-zinc-800 rounded-lg px-4 py-2">
            <span className="text-amber-400 text-xl font-bold">{store.weight.toFixed(1)}</span>
            <span className="text-zinc-500 text-xs ml-1">kg</span>
            <span className="text-zinc-600 text-[10px] ml-2">bite: {(store.weight * 0.1).toFixed(1)}kg</span>
          </div>
        </div>
      )}


      <Minimap />

      {/* Bite + Nav controls */}
      {!store.spectate && !store.dead && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-auto flex items-center gap-3">
          <div className="bg-black/50 backdrop-blur-sm border border-zinc-700 rounded-lg p-2 flex items-center gap-1">
            <Move size={16} className="text-zinc-400" />
            <span className="text-zinc-500 text-[10px]">WASD</span>
          </div>
          <button
            className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-all ${
              Date.now() - store.lastBiteTime > BITE_COOLDOWN_MS
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
    </div>
  );
}
