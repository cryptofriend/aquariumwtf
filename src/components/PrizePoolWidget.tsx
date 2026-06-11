import { useEffect, useState } from 'react';
import { getPrizePoolBalance } from '@/lib/solana';

export default function PrizePoolWidget() {
  const [balance, setBalance] = useState<number | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancel = false;
    const fetchOnce = async () => {
      try {
        const b = await getPrizePoolBalance();
        if (!cancel) { setBalance(b); setErr(false); }
      } catch {
        if (!cancel) setErr(true);
      }
    };
    fetchOnce();
    const id = setInterval(fetchOnce, 20_000);
    return () => { cancel = true; clearInterval(id); };
  }, []);

  return (
    <div className="bg-black/60 backdrop-blur-sm border border-amber-500/40 rounded-lg px-4 py-2">
      <div className="text-amber-300 text-[10px] font-bold uppercase tracking-wider">🏆 Prize Pool</div>
      <div className="flex items-baseline gap-1">
        <span className="text-amber-300 text-xl font-bold tabular-nums">
          {balance === null ? (err ? '—' : '…') : balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </span>
        <span className="text-zinc-400 text-[10px]">$MYTH</span>
      </div>
    </div>
  );
}
