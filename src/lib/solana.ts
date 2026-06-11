import {
  Connection,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from '@solana/spl-token';

export const MYTH_MINT = new PublicKey('2WhsBBy6V3LiG42fMqBfK2fbZL677ugkQYXxPx83pump');
export const PRIZE_POOL = new PublicKey('BUZkgjP1QjYd9YJcUNhpFXFvQBPiqwGMaZNBecuGvR4M');
export const ENTRY_FEE = 1; // 1 MYTH per entry

// Public Solana mainnet RPC (rate-limited)
export const RPC_URL = 'https://api.mainnet-beta.solana.com';

export const connection = new Connection(RPC_URL, 'confirmed');

let cachedDecimals: number | null = null;
export async function getMythDecimals(): Promise<number> {
  if (cachedDecimals !== null) return cachedDecimals;
  const info = await connection.getParsedAccountInfo(MYTH_MINT);
  // @ts-ignore
  const d = info.value?.data?.parsed?.info?.decimals;
  cachedDecimals = typeof d === 'number' ? d : 6;
  return cachedDecimals;
}

export type PhantomProvider = {
  isPhantom?: boolean;
  publicKey: PublicKey | null;
  isConnected: boolean;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: PublicKey }>;
  disconnect: () => Promise<void>;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  signAndSendTransaction?: (tx: Transaction) => Promise<{ signature: string }>;
};

export function getPhantom(): PhantomProvider | null {
  const w = window as any;
  if (w?.phantom?.solana?.isPhantom) return w.phantom.solana;
  if (w?.solana?.isPhantom) return w.solana;
  return null;
}

export async function getMythBalance(owner: PublicKey): Promise<number> {
  const res = await connection.getParsedTokenAccountsByOwner(owner, { mint: MYTH_MINT });
  let total = 0;
  for (const { account } of res.value) {
    // @ts-ignore
    const amt = account.data.parsed.info.tokenAmount.uiAmount;
    if (typeof amt === 'number') total += amt;
  }
  return total;
}

export async function getPrizePoolBalance(): Promise<number> {
  return getMythBalance(PRIZE_POOL);
}

export async function payEntryFee(provider: PhantomProvider): Promise<string> {
  if (!provider.publicKey) throw new Error('Wallet not connected');
  const owner = provider.publicKey;
  const decimals = await getMythDecimals();

  const fromATA = getAssociatedTokenAddressSync(MYTH_MINT, owner);
  const toATA = getAssociatedTokenAddressSync(MYTH_MINT, PRIZE_POOL);

  const amount = BigInt(Math.round(ENTRY_FEE * 10 ** decimals));

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }));
  // Ensure recipient ATA exists (idempotent — no-op if it already does)
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      owner,        // payer
      toATA,
      PRIZE_POOL,
      MYTH_MINT,
      TOKEN_PROGRAM_ID,
    ),
  );
  tx.add(
    createTransferCheckedInstruction(
      fromATA,
      MYTH_MINT,
      toATA,
      owner,
      amount,
      decimals,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = owner;

  let signature: string;
  if (provider.signAndSendTransaction) {
    const res = await provider.signAndSendTransaction(tx);
    signature = res.signature;
  } else {
    const signed = await provider.signTransaction(tx);
    signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  }

  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  return signature;
}

export function shortAddr(addr: string): string {
  return addr.slice(0, 4) + '…' + addr.slice(-4);
}
