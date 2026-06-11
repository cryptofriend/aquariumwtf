import { describe, it, expect } from 'vitest';
import { verifyDeposit, RpcFetch } from './deposits';
import { MYTH_MINT, PRIZE_POOL_WALLET } from '../../shared/constants';

const NOW = 1_750_000_000_000;
const BUYER = 'BuyerWa11et1111111111111111111111111111111';

let sigCounter = 0;
function freshSig() {
  // valid-looking base58 (no 0/O/I/l), unique per test
  const id = String(sigCounter++).replace(/0/g, '9').padStart(4, '1');
  return ('5'.repeat(20) + id + 'a'.repeat(40)).slice(0, 64);
}

/** Builds a fake getTransaction RPC response for a MYTH transfer. */
function fakeTx(opts: {
  amountRaw?: bigint;
  to?: string;
  from?: string;
  err?: unknown;
  blockTime?: number;
  missing?: boolean;
}): RpcFetch {
  const {
    amountRaw = 1_000_000n,
    to = PRIZE_POOL_WALLET,
    from = BUYER,
    err = null,
    blockTime = Math.floor(NOW / 1000) - 60,
    missing = false,
  } = opts;
  const result = missing ? null : {
    blockTime,
    meta: {
      err,
      preTokenBalances: [
        { accountIndex: 1, mint: MYTH_MINT, owner: from, uiTokenAmount: { amount: String(10_000_000n) } },
        { accountIndex: 2, mint: MYTH_MINT, owner: to, uiTokenAmount: { amount: '0' } },
      ],
      postTokenBalances: [
        { accountIndex: 1, mint: MYTH_MINT, owner: from, uiTokenAmount: { amount: String(10_000_000n - amountRaw) } },
        { accountIndex: 2, mint: MYTH_MINT, owner: to, uiTokenAmount: { amount: String(amountRaw) } },
      ],
    },
  };
  return async () => ({ json: async () => ({ result }) });
}

describe('on-chain ticket verification', () => {
  it('accepts a valid 1 $MYTH transfer and credits the sender', async () => {
    const r = await verifyDeposit(freshSig(), fakeTx({}), NOW);
    expect(r).toEqual({ ok: true, wallet: BUYER, tickets: 1 });
  });

  it('credits multiple tickets for larger transfers', async () => {
    const r = await verifyDeposit(freshSig(), fakeTx({ amountRaw: 3_500_000n }), NOW);
    expect(r).toEqual({ ok: true, wallet: BUYER, tickets: 3 }); // floor(3.5)
  });

  it('rejects double-redemption of the same signature', async () => {
    const sig = freshSig();
    const rpc = fakeTx({});
    expect((await verifyDeposit(sig, rpc, NOW)).ok).toBe(true);
    const replay = await verifyDeposit(sig, rpc, NOW);
    expect(replay.ok).toBe(false);
  });

  it('rejects transfers below the ticket price', async () => {
    const r = await verifyDeposit(freshSig(), fakeTx({ amountRaw: 999_999n }), NOW);
    expect(r.ok).toBe(false);
  });

  it('rejects transfers to the wrong destination', async () => {
    const r = await verifyDeposit(freshSig(), fakeTx({ to: 'SomeOtherWa11et111111111111111111111111111' }), NOW);
    expect(r.ok).toBe(false);
  });

  it('rejects failed transactions', async () => {
    const r = await verifyDeposit(freshSig(), fakeTx({ err: { InstructionError: [0, 'Custom'] } }), NOW);
    expect(r.ok).toBe(false);
  });

  it('rejects transactions older than the redemption window', async () => {
    const r = await verifyDeposit(freshSig(), fakeTx({ blockTime: Math.floor(NOW / 1000) - 2 * 3600 }), NOW);
    expect(r.ok).toBe(false);
  });

  it('rejects unknown transactions', async () => {
    const r = await verifyDeposit(freshSig(), fakeTx({ missing: true }), NOW);
    expect(r.ok).toBe(false);
  });

  it('rejects malformed signatures without calling the RPC', async () => {
    let called = false;
    const rpc: RpcFetch = async () => { called = true; return { json: async () => ({}) }; };
    const r = await verifyDeposit('not-a-signature!!', rpc, NOW);
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });
});
