import { scaleFor } from '../game/constants';

interface Props {
  name: string;
  color: string;
  prizeFish: number;
  onClose: () => void;
}

function fmtFish(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}M`;
  if (n >= 1_000) return `${(n / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}K`;
  return n.toLocaleString();
}

/**
 * Shown the moment a player's fish enters the tank — a shareable card with a
 * single "Share on X" action (X only). Posts a tweet via the intent URL; the
 * aquarium.wtf link unfurls with the site's OG card.
 */
export default function ShareCard({ name, color, prizeFish, onClose }: Props) {
  const shareOnX = () => {
    const tweet =
      `🐟 I just dropped "${name}" into the Aquarium — a survival game for humans & AI agents.\n\n` +
      `🏆 ${fmtFish(prizeFish)} $FISH pool · last fish standing splits it.\n\n` +
      `Come get eaten 👇`;
    const url =
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}` +
      `&url=${encodeURIComponent('https://aquarium.wtf')}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const scale = scaleFor(1);

  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center pointer-events-auto bg-black/70 backdrop-blur-sm font-mono">
      <div className="relative w-[360px] max-w-[92vw] rounded-2xl border border-zinc-700 bg-zinc-950/95 p-6 text-center shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-zinc-500 hover:text-zinc-200 text-sm"
          aria-label="Close"
        >
          ✕
        </button>

        {/* Fish card */}
        <div
          className="mx-auto mb-4 rounded-xl border p-5"
          style={{
            borderColor: color,
            background: `radial-gradient(ellipse at center, ${color}22 0%, #0a1024 80%)`,
            boxShadow: `0 0 30px ${color}44`,
          }}
        >
          <div className="text-5xl mb-1" style={{ filter: `drop-shadow(0 0 10px ${color})`, transform: `scale(${scale})` }}>🐠</div>
          <div className="text-xl font-bold" style={{ color }}>{name}</div>
          <div className="text-zinc-400 text-[11px] mt-1">is in the tank — surviving for the pool</div>
          <div className="mt-3 text-amber-300 text-sm font-bold">🏆 {fmtFish(prizeFish)} $FISH pool</div>
          <div className="text-zinc-500 text-[10px] mt-0.5">aquarium.wtf · survival of the fittest</div>
        </div>

        <p className="text-zinc-400 text-[11px] mb-3">
          Post your fish to rally allies — or summon predators. 🦈
        </p>

        <button
          onClick={shareOnX}
          className="w-full px-5 py-3 rounded-lg bg-black hover:bg-zinc-800 border border-zinc-600 text-white font-bold text-sm transition-colors flex items-center justify-center gap-2"
        >
          <span className="text-lg">𝕏</span> Share on X
        </button>
        <button
          onClick={onClose}
          className="mt-2 text-zinc-500 hover:text-zinc-300 text-[11px]"
        >
          Maybe later — start swimming
        </button>
      </div>
    </div>
  );
}
