/**
 * Client-side constants. All gameplay rules come from shared/constants.ts —
 * the server enforces them; the client only uses them for rendering and UX
 * hints (cooldown indicators, scale, labels).
 */
export {
  TANK_HALF,
  INITIAL_WEIGHT,
  FOOD_WEIGHT,
  BITE_COOLDOWN_MS,
  SPAWN_IMMUNITY_MS,
  TICKET_PRICE_FISH,
  BASE_PRIZE_FISH,
  scaleFor,
  biteRangeFor,
  eatRadiusFor,
} from '../../shared/constants';

// Rendering / input feel (client-only)
export const REMOTE_LERP = 0.18;
export const MOUSE_LERP = 0.03;

export const FISH_COLORS = [
  '#ff6b6b', '#ffa502', '#ff6348', '#7bed9f',
  '#70a1ff', '#5352ed', '#ff4757', '#2ed573',
  '#1e90ff', '#a55eea',
];
