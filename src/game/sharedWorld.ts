import { MAX_FOOD, TANK_HALF } from './constants';
import { FoodOrb } from './types';

const WORLD_SEED = 48271;
const KELP_COUNT = 18;

function mulberry32(seed: number) {
  return function seededRandom() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function getSharedKelpPositions(): [number, number, number][] {
  const random = mulberry32(WORLD_SEED);

  return Array.from({ length: KELP_COUNT }, () => [
    (random() - 0.5) * TANK_HALF.x * 1.6,
    0,
    (random() - 0.5) * TANK_HALF.z * 1.6,
  ] as [number, number, number]);
}

export function createRandomFoodOrb(): FoodOrb {
  return {
    id: crypto.randomUUID(),
    x: (Math.random() - 0.5) * TANK_HALF.x * 1.6,
    y: (Math.random() - 0.5) * TANK_HALF.y * 0.8,
    z: (Math.random() - 0.5) * TANK_HALF.z * 1.6,
  };
}

export function addFoodIfMissing(food: FoodOrb[], orb: FoodOrb): boolean {
  if (food.some((entry) => entry.id === orb.id) || food.length >= MAX_FOOD) {
    return false;
  }

  food.push(orb);
  return true;
}

export function replaceFoods(target: FoodOrb[], next: FoodOrb[]) {
  const deduped = next.filter((orb, index) => next.findIndex((entry) => entry.id === orb.id) === index);
  target.splice(0, target.length, ...deduped.slice(0, MAX_FOOD));
}

export function removeFoodById(food: FoodOrb[], foodId: string): boolean {
  const index = food.findIndex((entry) => entry.id === foodId);
  if (index === -1) {
    return false;
  }

  food.splice(index, 1);
  return true;
}
