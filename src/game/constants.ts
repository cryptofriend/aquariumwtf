export const MAX_HP = 100;
export const BITE_RANGE = 3.2;
export const BITE_COOLDOWN_MS = 1200;
export const BITE_DAMAGE = 22; // fallback, actual = weight * 0.1
export const FOOD_HP = 12;
export const FOOD_WEIGHT = 5;
export const FOOD_SPAWN_MS = 3500;
export const MAX_FOOD = 14;
export const BROADCAST_MS = 60;
export const TANK_HALF = { x: 24, y: 10, z: 20 };
export const MAX_SPEED = 14;
export const DAMPING = 0.86;
export const MOUSE_LERP = 0.03;
export const REMOTE_LERP = 0.12;
export const DEATH_DELAY_MS = 4000;
export const INITIAL_WEIGHT = 100;

export const FISH_COLORS = [
  '#ff6b6b', '#ffa502', '#ff6348', '#7bed9f',
  '#70a1ff', '#5352ed', '#ff4757', '#2ed573',
  '#1e90ff', '#a55eea',
];

export const uid = crypto.randomUUID();
