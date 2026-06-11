import { useEffect, useState, useCallback } from 'react';
import {
  getPhantom,
  getMythBalance,
  payEntryFee,
  shortAddr,
  ENTRY_FEE,
  MYTH_MINT,
  type PhantomProvider,
} from '@/lib/solana';

interface Props {
  onPaid: (wallet: string, signature: string) => void;
}

type Step = 'idle' | 'connecting' | 'checking' | 'no_balance' | 'ready' | 'paying' | 'error';

export default function WalletGate({ onPaid }: Props) {
  const [provider, setProvider] = useState<PhantomProvider | null>(null);
  const [wallet, setWallet] = useState<string>('');
  const [balance, setBalance] = useState<number | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    setProvider(getPhantom());
  }, []);

  const refreshBalance = useCallback(async (pubkey: any) => {
    setStep('checking');
    try {
      const bal = await getMythBalance(pubkey);
      setBalance(bal);
      setStep(bal >= ENTRY_FEE ? 'ready' : 'no_balance');
    } catch (e: any) {
      setError(e?.message || 'Failed to read balance');
      setStep('error');
    }
  }, []);

  const handleConnect = async () => {
    setError('');
    const p = getPhantom();
    if (!p) {
      window.open('https://phantom.app/', '_blank', 'noopener');
      setError('Phantom wallet not detected. Install it and refresh.');
      setStep('error');
      return;
    }
    setProvider(p);
    setStep('connecting');
    try {
      const { publicKey } = await p.connect();
      setWallet(publicKey.toBase58());
      await refreshBalance(publicKey);
    } catch (e: any) {
      setError(e?.message || 'Connection rejected');
      setStep('error');
    }
  };

  const handlePay = async () => {
    if (!provider) return;
    setError('');
    setStep('paying');
    try {
      const sig = await payEntryFee(provider);
      onPaid(wallet, sig);
    } catch (e: any) {
      const msg = e?.message || 'Payment failed';
      setError(msg);
      setStep('ready');
    }
  };

  // Status pill
  const Pill = ({ children, tone = 'zinc' }: { children: any; tone?: string }) => (
    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-${tone}-500/15 text-${tone}-300 border border-${tone}-500/30`}>
      {children}
    </span>
  );

  return (
    <div className="w-80 mt-2 mb-3 px-4 py-3 rounded-lg bg-zinc-900/80 border border-purple-500/30 font-mono">
      <div className="flex items-center justify-between mb-2">
        <span className="text-purple-300 text-xs font-bold uppercase tracking-wider">🔐 $MYTH Entry</span>
        {wallet && <span className="text-zinc-400 text-[10px]">{shortAddr(wallet)}</span>}
      </div>

      {!wallet && (
        <>
          <p className="text-zinc-400 text-[11px] mb-3 leading-snug">
            Connect your Phantom wallet and pay <span className="text-amber-300 font-bold">1 $MYTH</span> to the prize pool to enter the aquarium.
          </p>
          <button
            onClick={handleConnect}
            disabled={step === 'connecting'}
            className="w-full px-4 py-2.5 rounded-md bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold text-sm transition-colors"
          >
            {step === 'connecting' ? 'Connecting…' : '👻 Connect Phantom'}
          </button>
        </>
      )}

      {wallet && (
        <>
          <div className="flex items-center justify-between mb-2 text-[11px]">
            <span className="text-zinc-500">$MYTH balance</span>
            <span className="text-amber-300 font-bold">
              {balance === null ? '…' : balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}
            </span>
          </div>

          {step === 'checking' && <p className="text-zinc-400 text-[11px]">Checking balance…</p>}

          {step === 'no_balance' && (
            <>
              <p className="text-red-300 text-[11px] mb-2 leading-snug">
                You need at least {ENTRY_FEE} $MYTH to play.
              </p>
              <a
                href={`https://jup.ag/swap/SOL-${MYTH_MINT.toBase58()}`}
                target="_blank" rel="noopener noreferrer"
                className="block text-center w-full px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors"
              >
                Buy $MYTH on Jupiter ↗
              </a>
              <button
                onClick={() => refreshBalance((provider as any).publicKey)}
                className="mt-2 w-full text-[11px] text-zinc-400 hover:text-zinc-200"
              >
                Refresh balance
              </button>
            </>
          )}

          {(step === 'ready' || step === 'paying') && (
            <button
              onClick={handlePay}
              disabled={step === 'paying'}
              className="w-full px-4 py-2.5 rounded-md bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white font-bold text-sm transition-colors"
            >
              {step === 'paying' ? 'Sending 1 $MYTH…' : `Pay ${ENTRY_FEE} $MYTH & Enter 🩸`}
            </button>
          )}
        </>
      )}

      {error && (
        <p className="mt-2 text-red-400 text-[10px] leading-snug break-words">⚠ {error}</p>
      )}
      <p className="mt-2 text-zinc-600 text-[9px] leading-snug">
        Prize pool: <span className="font-mono">{shortAddr('BUZkgjP1QjYd9YJcUNhpFXFvQBPiqwGMaZNBecuGvR4M')}</span> · Mainnet
      </p>
    </div>
  );
}
