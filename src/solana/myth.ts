/** $MYTH (Mythos 5) — the entry token. Pump.fun mint, 6 decimals. */
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  TOKEN_2022_PROGRAM_ID,
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

import { serverUrl } from '../net/gameClient';

// Browsers get 403'd by the public mainnet RPC, so all RPC traffic goes
// through the game server's allowlisted /rpc proxy by default.
export const SOLANA_RPC =
  (import.meta.env.VITE_SOLANA_RPC as string | undefined) ||
  `${serverUrl().http}/rpc`;

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

/** $MYTH/USD price via DexScreener (free, no key). Returns null on failure. */
let priceCache: { value: number; at: number } | null = null;
export async function fetchMythPriceUsd(): Promise<number | null> {
  if (priceCache && Date.now() - priceCache.at < 60_000) return priceCache.value;
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${MYTH_MINT}`);
    const json = await res.json();
    const price = Number(json?.pairs?.[0]?.priceUsd);
    if (!Number.isFinite(price) || price <= 0) return priceCache?.value ?? null;
    priceCache = { value: price, at: Date.now() };
    return price;
  } catch {
    return priceCache?.value ?? null;
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

  if (buyer.toBase58() === PRIZE_POOL) {
    throw new Error('You are connected with the prize-pool wallet — switch to a personal wallet to buy a ticket');
  }

  // $MYTH is a Token-2022 mint (newer pump.fun launches) — every spl-token
  // helper must be told so, or the ATAs and program id are wrong and the
  // transfer fails on-chain.
  const fromAta = getAssociatedTokenAddressSync(mint, buyer, false, TOKEN_2022_PROGRAM_ID);
  const toAta = getAssociatedTokenAddressSync(mint, pool, false, TOKEN_2022_PROGRAM_ID);
  const rawAmount = BigInt(TICKET_PRICE_MYTH) * BigInt(10 ** MYTH_DECIMALS);

  const tx = new Transaction().add(
    // ensure the pool's token account exists (no-op if it already does)
    createAssociatedTokenAccountIdempotentInstruction(buyer, toAta, pool, mint, TOKEN_2022_PROGRAM_ID),
    createTransferCheckedInstruction(fromAta, mint, toAta, buyer, rawAmount, MYTH_DECIMALS, [], TOKEN_2022_PROGRAM_ID),
  );

  // Fresh blockhash at send time — cached ones expire in wallet popups
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = buyer;

  const signature = await wallet.sendTransaction(tx, connection);

  // Poll for confirmation over plain HTTP — confirmTransaction() relies on
  // WebSocket subscriptions, which the /rpc proxy doesn't carry.
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(SOLANA_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getSignatureStatuses',
        params: [[signature]],
      }),
    });
    const json = await res.json();
    const st = json?.result?.value?.[0];
    if (st?.err) throw new Error('Transaction failed on-chain');
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) {
      return signature;
    }
  }
  throw new Error('Transaction not confirmed in time — check your wallet and retry the redeem');
}
