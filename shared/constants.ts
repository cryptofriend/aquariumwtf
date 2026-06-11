/**
 * Single source of truth for all gameplay rules.
 * Imported by BOTH the authoritative server (server/) and the client (src/).
 * The client uses these only for rendering/UX hints — the server is the
 * only place where they change game state.
 */

export const TANK_HALF = { x: 24, y: 10, z: 20 };

// Simulation
export const TICK_MS = 50;        // 20 Hz server simulation
export const SNAPSHOT_MS = 100;   // 10 Hz state broadcast

// Weights
export const INITIAL_WEIGHT = 1;
export const MIN_WEIGHT = 0.3;    // a bite leaving you below this kills you
export const FOOD_WEIGHT = 0.5;
export const MAX_FOOD = 24;
export const FOOD_SPAWN_MS = 2000;

// Combat
export const BITE_COOLDOWN_MS = 1200;
export const SPAWN_IMMUNITY_MS = 5000;

// Movement
export const MAX_SPEED = 14;

// Round lifecycle
export const MIN_PLAYERS = 2;
export const COUNTDOWN_MS = 10_000;
export const ROUND_MS = 5 * 60_000;
export const RESULTS_MS = 15_000;
export const FRENZY_MS = 60_000;  // final stretch of a round: decay ramps up

// Agents (HTTP API) are dropped from the tank if silent for this long
export const AGENT_TIMEOUT_MS = 10_000;

// ─── Token economy (real tickets) ───
// 1 game ticket = 1 $MYTH sent to the prize-pool wallet, verified on-chain by
// the server. No ticket → spectator only. The winner takes the round pot
// (credited as tickets; on-chain payout is the next milestone).
export const ENTRY_COST_TOKENS = 1;   // charged per round entry AND per re-entry
export const TICKET_PRICE_MYTH = 1;   // $MYTH per ticket ($MYTH has 6 decimals)
export const MYTH_DECIMALS = 6;
export const MYTH_MINT = '2WhsBBy6V3LiG42fMqBfK2fbZL677ugkQYXxPx83pump';
export const PRIZE_POOL_WALLET = 'BUZkgjP1QjYd9YJcUNhpFXFvQBPiqwGMaZNBecuGvR4M';
/** When one fish remains, dead players get this long to buy back in before the round ends. */
export const RESPAWN_GRACE_MS = 10_000;

/** Visual scale of a fish — also drives reach/speed so size matters. */
export function scaleFor(weight: number): number {
  return 0.6 + Math.log2(Math.max(1, weight)) * 0.25;
}

/** Bigger fish swim slower — counterweight to snowballing. */
export function speedFor(weight: number): number {
  const factor = 1.1 - 0.06 * Math.log2(Math.max(1, weight));
  return MAX_SPEED * Math.min(1.1, Math.max(0.6, factor));
}

/** Food is eaten automatically on contact within this radius. */
export function eatRadiusFor(weight: number): number {
  return 1.2 + scaleFor(weight) * 0.5;
}

/** Bite reach grows with the fish. */
export function biteRangeFor(weight: number): number {
  return 2.0 + scaleFor(weight) * 0.6;
}

/**
 * Zero-sum bite: attacker steals 10% of own weight, but never more than
 * half the victim per bite — a whale can't one-shot a fresh spawn.
 */
export function biteDamage(attackerWeight: number, victimWeight: number): number {
  return Math.max(0.1, Math.min(attackerWeight * 0.1, victimWeight * 0.5));
}

/**
 * Passive mass decay per second. Above 3kg fish slowly shrink (anti-camping);
 * during the end-of-round frenzy everyone shrinks toward 1kg proportionally,
 * which pressures the field without reordering the standings.
 */
export function decayPerSecond(weight: number, frenzy: boolean): number {
  let d = weight > 3 ? (weight - 3) * 0.002 : 0;
  if (frenzy) d += Math.max(0, weight - 1) * 0.01;
  return d;
}
