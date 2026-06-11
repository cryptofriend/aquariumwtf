/** $MYTH (Mythos 5) — the entry token. Pump.fun mint, 6 decimals. */
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from '@solana/spl-token';
import type { WalletContextState } from '@solana/wallet-adapter-react';
import {
  MYTH_MINT as MYTH_MINT_STR,
  PRIZE_POOL_WALLET,
  TICKET_PRICE_MYTH,
  MYTH_DECIMALS,
} from '../../shared/constants';

export const MYTH_MINT = MYTH_MINT_STR;
export const PRIZE_POOL = PRIZE_POOL_WALLET;

export const SOLANA_RPC =
  (import.meta.env.VITE_SOLANA_RPC as string | undefined) ||
  'https://api.mainnet-beta.solana.com';

/**
 * On-chain $MYTH balance for a wallet (display only — the game server never
 * trusts the client about balances). Returns null on RPC failure.
 */
export async function fetchMythBalance(owner: string): Promise<number | null> {
  try {
    const res = await fetch(SOLANA_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTokenAccountsByOwner',
        params: [owner, { mint: MYTH_MINT }, { encoding: 'jsonParsed' }],
      }),
    });
    const json = await res.json();
    const accounts: any[] = json?.result?.value ?? [];
    return accounts.reduce(
      (sum, a) => sum + (a?.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0),
      0,
    );
  } catch {
    return null;
  }
}

/**
 * Buy a game ticket: transfer TICKET_PRICE_MYTH $MYTH to the prize pool.
 * The USER signs and sends via their wallet — we only assemble the
 * transaction. Returns the tx signature for the server to verify.
 */
export async function buyTicketTx(wallet: WalletContextState): Promise<string> {
  if (!wallet.publicKey || !wallet.sendTransaction) {
    throw new Error('Wallet not connected');
  }
  const connection = new Connection(SOLANA_RPC, 'confirmed');
  const mint = new PublicKey(MYTH_MINT);
  const pool = new PublicKey(PRIZE_POOL);
  const buyer = wallet.publicKey;

  const fromAta = getAssociatedTokenAddressSync(mint, buyer);
  const toAta = getAssociatedTokenAddressSync(mint, pool);
  const rawAmount = BigInt(TICKET_PRICE_MYTH) * BigInt(10 ** MYTH_DECIMALS);

  const tx = new Transaction().add(
    // ensure the pool's token account exists (no-op if it already does)
    createAssociatedTokenAccountIdempotentInstruction(buyer, toAta, pool, mint),
    createTransferCheckedInstruction(fromAta, mint, toAta, buyer, rawAmount, MYTH_DECIMALS),
  );

  // Fresh blockhash at send time — cached ones expire in wallet popups
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = buyer;

  const signature = await wallet.sendTransaction(tx, connection);
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  return signature;
}
