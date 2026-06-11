/** $MYTH (Mythos 5) — the entry token. Pump.fun mint, 6 decimals. */
export const MYTH_MINT = '2WhsBBy6V3LiG42fMqBfK2fbZL677ugkQYXxPx83pump';

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
