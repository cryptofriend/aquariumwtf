/**
 * On-chain ticket purchases. A ticket = TICKET_PRICE_MYTH $MYTH transferred
 * to the prize-pool wallet. The client (or an agent) submits the transaction
 * SIGNATURE; this module verifies the transfer on-chain and reports who paid
 * and how many tickets they bought.
 *
 * Security model:
 *  - Credit goes to the wallet that SENT the $MYTH (read from the tx itself),
 *    so a stolen/observed signature can never credit anyone else.
 *  - Each signature is single-use (in-memory used-set).
 *  - Only recent transactions count (MAX_AGE), which bounds the replay window
 *    after a server restart to "reclaim what you paid for".
 */
import {
  MYTH_MINT, PRIZE_POOL_WALLET, TICKET_PRICE_MYTH, MYTH_DECIMALS,
} from '../../shared/constants';

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const MAX_AGE_MS = 60 * 60 * 1000; // accept txs up to 1h old
const TICKET_RAW = BigInt(TICKET_PRICE_MYTH) * BigInt(10 ** MYTH_DECIMALS);

const usedSignatures = new Set<string>();

export type DepositResult =
  | { ok: true; wallet: string; tickets: number }
  | { ok: false; reason: string };

interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
}

export type RpcFetch = (url: string, init: RequestInit) => Promise<{ json(): Promise<unknown> }>;

export async function verifyDeposit(
  signature: string,
  rpcFetch: RpcFetch = fetch,
  now = Date.now(),
): Promise<DepositResult> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature)) {
    return { ok: false, reason: 'That does not look like a Solana transaction signature' };
  }
  if (usedSignatures.has(signature)) {
    return { ok: false, reason: 'This transaction was already redeemed' };
  }

  let tx: any;
  try {
    const res = await rpcFetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: [signature, {
          encoding: 'jsonParsed',
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        }],
      }),
    });
    tx = ((await res.json()) as any)?.result;
  } catch {
    return { ok: false, reason: 'Could not reach Solana RPC — try again in a moment' };
  }

  if (!tx) return { ok: false, reason: 'Transaction not found (yet) — wait for confirmation and retry' };
  if (tx.meta?.err) return { ok: false, reason: 'Transaction failed on-chain' };
  if (typeof tx.blockTime === 'number' && now - tx.blockTime * 1000 > MAX_AGE_MS) {
    return { ok: false, reason: 'Transaction too old — tickets must be redeemed within an hour' };
  }

  const pre: TokenBalance[] = tx.meta?.preTokenBalances ?? [];
  const post: TokenBalance[] = tx.meta?.postTokenBalances ?? [];

  const balanceOf = (list: TokenBalance[], index: number) => {
    const e = list.find((b) => b.accountIndex === index && b.mint === MYTH_MINT);
    return e ? BigInt(e.uiTokenAmount.amount) : 0n;
  };

  // How much $MYTH did the prize pool receive, and who paid it?
  let received = 0n;
  let sender: string | null = null;
  const indices = new Set([...pre, ...post].filter((b) => b.mint === MYTH_MINT).map((b) => b.accountIndex));
  for (const idx of indices) {
    const owner = (post.find((b) => b.accountIndex === idx)?.owner) ?? (pre.find((b) => b.accountIndex === idx)?.owner);
    const delta = balanceOf(post, idx) - balanceOf(pre, idx);
    if (owner === PRIZE_POOL_WALLET && delta > 0n) received += delta;
    if (delta < 0n && owner && owner !== PRIZE_POOL_WALLET) sender = owner;
  }

  if (received < TICKET_RAW) {
    return { ok: false, reason: `No ticket payment found — send at least ${TICKET_PRICE_MYTH} $MYTH to the prize pool` };
  }
  if (!sender) {
    return { ok: false, reason: 'Could not determine the paying wallet from the transaction' };
  }

  usedSignatures.add(signature);
  if (usedSignatures.size > 10_000) {
    // drop the oldest half — anything that old is past MAX_AGE anyway
    const keep = [...usedSignatures].slice(-5_000);
    usedSignatures.clear();
    keep.forEach((s) => usedSignatures.add(s));
  }

  return { ok: true, wallet: sender, tickets: Number(received / TICKET_RAW) };
}
