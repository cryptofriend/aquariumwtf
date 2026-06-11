/**
 * Sign-In-With-Solana for the game server.
 *
 * Flow:
 *   1. Client: GET /auth/nonce?wallet=<pubkey>  → { nonce, message }
 *   2. Wallet signs `message` (signMessage, ed25519 over UTF-8 bytes).
 *   3. Client sends the ws `join` with { wallet, nonce, signature(base58) }.
 *   4. verifyLogin() checks the nonce is fresh/unused and the signature is
 *      valid for that exact message and pubkey.
 *
 * Nonces are single-use and expire after 5 minutes. Everything is in-memory —
 * a server restart just means signing in again.
 */
import { randomUUID } from 'node:crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const NONCE_TTL_MS = 5 * 60_000;

interface IssuedNonce { wallet: string; nonce: string; issuedAt: number }

const issued = new Map<string, IssuedNonce>(); // nonce → record

export function loginMessage(wallet: string, nonce: string): string {
  return `Sign in to Aquarium\nWallet: ${wallet}\nNonce: ${nonce}`;
}

export function isValidPubkey(wallet: string): boolean {
  try {
    return bs58.decode(wallet).length === 32;
  } catch {
    return false;
  }
}

export function issueNonce(wallet: string, now = Date.now()): { nonce: string; message: string } {
  // GC expired nonces opportunistically
  for (const [key, rec] of issued) {
    if (now - rec.issuedAt > NONCE_TTL_MS) issued.delete(key);
  }
  const nonce = randomUUID();
  issued.set(nonce, { wallet, nonce, issuedAt: now });
  return { nonce, message: loginMessage(wallet, nonce) };
}

export function verifyLogin(
  wallet: string,
  nonce: string,
  signatureB58: string,
  now = Date.now(),
): { ok: true } | { ok: false; reason: string } {
  const rec = issued.get(nonce);
  if (!rec) return { ok: false, reason: 'Unknown or already-used nonce — request a new one' };
  if (rec.wallet !== wallet) return { ok: false, reason: 'Nonce was issued for a different wallet' };
  if (now - rec.issuedAt > NONCE_TTL_MS) {
    issued.delete(nonce);
    return { ok: false, reason: 'Login expired — request a new nonce' };
  }

  let pubkeyBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    // Uint8Array.from guards against cross-realm typed arrays (e.g. jsdom),
    // which tweetnacl rejects with an instanceof check.
    pubkeyBytes = Uint8Array.from(bs58.decode(wallet));
    sigBytes = Uint8Array.from(bs58.decode(signatureB58));
  } catch {
    return { ok: false, reason: 'Malformed wallet or signature encoding' };
  }
  if (pubkeyBytes.length !== 32 || sigBytes.length !== 64) {
    return { ok: false, reason: 'Malformed wallet or signature length' };
  }

  const msgBytes = Uint8Array.from(new TextEncoder().encode(loginMessage(wallet, nonce)));
  const valid = nacl.sign.detached.verify(msgBytes, sigBytes, pubkeyBytes);
  if (!valid) return { ok: false, reason: 'Invalid signature' };

  issued.delete(nonce); // single use
  return { ok: true };
}
