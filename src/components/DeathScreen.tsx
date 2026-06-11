interface Props {
  killerName: string;
  kills: number;
  weight: number;
  tokens: number;
  graceMsLeft: number;   // >0 → round ends soon unless someone buys back in
  onRespawn: () => void;
  onSpectate: () => void;
}

/**
 * Shown when you die mid-round. Re-enter for 1 ticket (as many times as your
 * balance allows) or spectate until the next round.
 */
export default function DeathScreen({ killerName, kills, weight, tokens, graceMsLeft, onRespawn, onSpectate }: Props) {
  const canRespawn = tokens >= 1;
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center pointer-events-auto"
      style={{ background: 'radial-gradient(ellipse at center, rgba(59,10,10,0.92) 0%, rgba(26,5,5,0.92) 100%)' }}>
      <div className="text-8xl mb-4">💀</div>
      <h1 className="text-4xl font-mono font-bold text-red-400 mb-2">You were eaten</h1>
      {killerName && (
        <p className="text-zinc-400 font-mono text-lg mb-1">
          by <span className="text-red-300 font-bold">{killerName}</span>
        </p>
      )}
      <p className="text-zinc-500 font-mono text-sm mb-1">
        Kills this round: <span className="text-zinc-300 font-bold">{kills}</span>
      </p>
      <p className="text-zinc-500 font-mono text-sm mb-4">
        Final weight: <span className="text-amber-400 font-bold">{weight.toFixed(1)}kg</span>
      </p>

      {graceMsLeft > 0 && (
        <p className="text-red-300 font-mono text-sm mb-3 animate-pulse">
          ⏳ Round ends in {Math.ceil(graceMsLeft / 1000)}s unless someone buys back in!
        </p>
      )}

      <div className="flex gap-4 mt-2">
        <button
          onClick={onRespawn}
          disabled={!canRespawn}
          className="px-8 py-3 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed border border-red-500 text-white font-mono font-bold text-lg transition-colors"
        >
          🎟 Re-enter — 1 ticket
        </button>
        <button
          onClick={onSpectate}
          className="px-8 py-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-zinc-200 font-mono font-bold text-lg transition-colors"
        >
          Watch →
        </button>
      </div>
      <p className="font-mono text-xs mt-3 text-zinc-500">
        {canRespawn
          ? `${tokens} ticket${tokens === 1 ? '' : 's'} left — every re-entry grows the pot`
          : 'Out of tickets — buy more on the entry screen or win a pot'}
      </p>
    </div>
  );
}
