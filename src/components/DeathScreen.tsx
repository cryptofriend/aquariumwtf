interface Props {
  killerName: string;
  kills: number;
  onSpectate: () => void;
}

export default function DeathScreen({ killerName, kills, onSpectate }: Props) {
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
      <p className="text-zinc-500 font-mono text-sm mb-8">
        Final kills: <span className="text-zinc-300 font-bold">{kills}</span>
      </p>
      <button
        onClick={onSpectate}
        className="px-8 py-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-zinc-200 font-mono font-bold text-lg transition-colors"
      >
        Watch the tank →
      </button>
    </div>
  );
}
