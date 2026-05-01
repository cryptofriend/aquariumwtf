/**
 * Leaderboard tracking for EVERY player & agent that enters the tank.
 *
 * Strategy: insert a row at spawn (weight=1, kills=0, survival=0) keyed by a
 * stable session_id, then UPDATE that same row as the player grows / dies /
 * leaves. This guarantees every join shows up — not just deaths.
 */
import { supabase } from '@/integrations/supabase/client';
import { getStore } from './useGameStore';

let inserted = false;

export async function registerOnLeaderboard() {
  if (inserted) return;
  const store = getStore();
  if (!store.name || !store.sessionId) return;
  inserted = true;
  const { error } = await supabase.from('leaderboard').insert({
    session_id: store.sessionId,
    player_name: store.name,
    weight: store.maxWeight || 1,
    kills: store.kills || 0,
    survival_seconds: 0,
    is_bot: store.isBot,
  } as any);
  if (error) {
    console.error('[Leaderboard] insert failed:', error);
    inserted = false; // allow retry
  }
}

/** Update via PostgREST so the score keeps climbing while alive. */
export async function updateLeaderboard() {
  const store = getStore();
  if (!inserted || !store.sessionId) return;
  const survivalSecs = store.spawnTime > 0
    ? Math.floor((Date.now() - store.spawnTime) / 1000)
    : 0;
  await supabase
    .from('leaderboard')
    .update({
      weight: store.maxWeight,
      kills: store.kills,
      survival_seconds: survivalSecs,
    } as any)
    .eq('session_id', store.sessionId);
}

/** Fire-and-forget update on tab close — uses sendBeacon so it survives unload. */
export function beaconUpdateLeaderboard() {
  const store = getStore();
  if (!inserted || !store.sessionId || !store.name) return;
  const survivalSecs = store.spawnTime > 0
    ? Math.floor((Date.now() - store.spawnTime) / 1000)
    : 0;
  // PATCH via sendBeacon: apikey must be a query param (no custom headers allowed)
  const url =
    `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/leaderboard` +
    `?session_id=eq.${store.sessionId}` +
    `&apikey=${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`;
  // sendBeacon only does POST, but PostgREST honors X-HTTP-Method-Override.
  // Simpler: just re-insert is wrong (unique constraint). Use fetch with keepalive.
  try {
    fetch(url, {
      method: 'PATCH',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        weight: store.maxWeight,
        kills: store.kills,
        survival_seconds: survivalSecs,
      }),
    });
  } catch (e) {
    // best-effort
  }
}

export function resetLeaderboardTracker() {
  inserted = false;
}
