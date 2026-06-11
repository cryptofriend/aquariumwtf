/**
 * Optional all-time leaderboard persistence. Round results are written to the
 * Supabase `leaderboard` table using the SERVICE ROLE key — clients can no
 * longer write to it at all (see the RLS lockdown migration).
 *
 * If SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set, this is a no-op
 * and the game runs fine without any database.
 */
import type { Standing } from '../../shared/protocol';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const leaderboardEnabled = Boolean(SUPABASE_URL && SERVICE_KEY);

export async function persistRoundResults(standings: Standing[], roundSeconds: number): Promise<void> {
  if (!leaderboardEnabled || standings.length === 0) return;
  try {
    const rows = standings.map((s) => ({
      player_name: s.name,
      weight: s.weight,
      kills: s.kills,
      survival_seconds: roundSeconds,
      is_bot: s.bot,
    }));
    const res = await fetch(`${SUPABASE_URL}/rest/v1/leaderboard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(rows),
    });
    if (!res.ok) {
      console.error('[leaderboard] insert failed:', res.status, await res.text());
    }
  } catch (err) {
    console.error('[leaderboard] insert error:', err);
  }
}
