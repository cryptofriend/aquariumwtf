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

// Movement (halved from the original 14 — deliberate, more tactical pace)
export const MAX_SPEED = 7;

// ─── 24h survival event ───
// One-time event with a FIXED wall-clock window. The server resolves the
// actual start/end (env-overridable: EVENT_START_AT / EVENT_END_AT as ISO or
// epoch-ms); these are the defaults/duration. Set the real launch time when
// $FISH goes live. The big countdown ticks toward the end; all fish ALIVE at
// the buzzer split the prize pool equally.
export const EVENT_DURATION_MS = 24 * 60 * 60 * 1000;  // 24 hours
export const RESULTS_MS = 60_000;   // how long the 'ended' results screen lingers (cosmetic)

// Agents (HTTP API) are dropped from the tank if silent for this long
export const AGENT_TIMEOUT_MS = 10_000;

// ─── $FISH economy ───
// 1 game ticket = TICKET_PRICE_FISH $FISH sent to the prize-pool wallet,
// verified on-chain. No ticket → spectator only. Every ticket's $FISH is
// added to the prize pool on top of the 100M base; survivors split it.
//
// ⚠️ PLACEHOLDERS until the $FISH token launches — set FISH_MINT (and confirm
// FISH_DECIMALS) and ticket purchases go live. Until then, on-chain buys can't
// verify; gameplay is testable via the server's DEV_ALLOW_NO_WALLET flag.
export const ENTRY_COST_TOKENS = 1;          // tickets charged per entry / re-entry
export const TICKET_PRICE_FISH = 21_000;     // $FISH per ticket
export const FISH_DECIMALS = 6;              // TODO: confirm against the real mint
export const FISH_MINT = 'FISH_MINT_ADDRESS_TBD';
export const BASE_PRIZE_FISH = 100_000_000;  // 100M $FISH sponsored base prize
export const PRIZE_POOL_WALLET = 'BUZkgjP1QjYd9YJcUNhpFXFvQBPiqwGMaZNBecuGvR4M';
/** Total prize $FISH = base + every ticket staked into the event. */
export function prizePoolFish(ticketsStaked: number): number {
  return BASE_PRIZE_FISH + ticketsStaked * TICKET_PRICE_FISH;
}

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
 * Passive mass decay per second. Above 3kg fish slowly shrink (anti-camping) —
 * size is instrumental (survive/kill) in the survival event, not the win
 * condition, so a gentle ceiling pressure is all that's needed.
 */
export function decayPerSecond(weight: number): number {
  return weight > 3 ? (weight - 3) * 0.002 : 0;
}
