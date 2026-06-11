import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { issueNonce, verifyLogin, loginMessage, isValidPubkey } from './auth';
import { World } from './world';

function makeWallet() {
  const kp = nacl.sign.keyPair();
  return {
    pubkey: bs58.encode(kp.publicKey),
    sign: (message: string) =>
      bs58.encode(nacl.sign.detached(Uint8Array.from(new TextEncoder().encode(message)), kp.secretKey)),
  };
}

describe('Sign-In-With-Solana', () => {
  it('accepts a valid signed nonce, exactly once', () => {
    const w = makeWallet();
    const { nonce, message } = issueNonce(w.pubkey);
    const signature = w.sign(message);
    expect(verifyLogin(w.pubkey, nonce, signature).ok).toBe(true);
    // single-use: replaying the same nonce+signature fails
    expect(verifyLogin(w.pubkey, nonce, signature).ok).toBe(false);
  });

  it('rejects a signature from a different wallet', () => {
    const real = makeWallet();
    const attacker = makeWallet();
    const { nonce, message } = issueNonce(real.pubkey);
    const forged = attacker.sign(message);
    expect(verifyLogin(real.pubkey, nonce, forged).ok).toBe(false);
  });

  it('rejects a tampered message', () => {
    const w = makeWallet();
    const { nonce } = issueNonce(w.pubkey);
    const otherSig = w.sign(loginMessage(w.pubkey, 'different-nonce'));
    expect(verifyLogin(w.pubkey, nonce, otherSig).ok).toBe(false);
  });

  it('rejects expired nonces', () => {
    const w = makeWallet();
    const t0 = 1_000_000;
    const { nonce, message } = issueNonce(w.pubkey, t0);
    const signature = w.sign(message);
    expect(verifyLogin(w.pubkey, nonce, signature, t0 + 6 * 60_000).ok).toBe(false);
  });

  it('rejects nonces issued for another wallet', () => {
    const a = makeWallet();
    const b = makeWallet();
    const { nonce } = issueNonce(a.pubkey);
    const sig = b.sign(loginMessage(b.pubkey, nonce));
    expect(verifyLogin(b.pubkey, nonce, sig).ok).toBe(false);
  });

  it('validates pubkey encoding', () => {
    expect(isValidPubkey(makeWallet().pubkey)).toBe(true);
    expect(isValidPubkey('not-base58-!!!')).toBe(false);
    expect(isValidPubkey('abc')).toBe(false);
  });
});

describe('wallet-bound balances', () => {
  const T0 = 1_000_000;

  it('persists a wallet balance across leave/rejoin', () => {
    const world = new World();
    const w = makeWallet();
    const r1 = world.join('Fish1', '#fff', false, T0, w.pubkey);
    if ('error' in r1) throw new Error(r1.error);
    r1.player.tokens = 2;            // spent some
    world.leave(r1.player.id);

    const r2 = world.join('Fish1', '#fff', false, T0 + 1000, w.pubkey);
    if ('error' in r2) throw new Error(r2.error);
    expect(r2.player.tokens).toBe(2);  // balance survived, no demo reset
    expect(r2.player.wallet).toBe(w.pubkey);
  });

  it('starts new wallets at zero tickets and rejects wallet-less humans', () => {
    const world = new World();
    const w = makeWallet();
    const r = world.join('Fresh', '#fff', false, T0, w.pubkey);
    if ('error' in r) throw new Error(r.error);
    expect(r.player.tokens).toBe(0);
    expect(world.join('NoWallet', '#fff', false, T0)).toHaveProperty('error');
  });

  it('blocks the same wallet from joining twice concurrently', () => {
    const world = new World();
    const w = makeWallet();
    const r1 = world.join('TabOne', '#fff', false, T0, w.pubkey);
    expect('player' in r1).toBe(true);
    const r2 = world.join('TabTwo', '#fff', false, T0, w.pubkey);
    expect(r2).toHaveProperty('error');
  });

  it('never leaks full wallet addresses in snapshots', () => {
    const world = new World();
    const w = makeWallet();
    const r = world.join('Whale', '#fff', false, T0, w.pubkey);
    if ('error' in r) throw new Error(r.error);
    const snap = JSON.stringify(world.snapshot(T0));
    expect(snap).not.toContain(w.pubkey);
    expect(snap).toContain(`${w.pubkey.slice(0, 4)}…${w.pubkey.slice(-4)}`);
  });
});
