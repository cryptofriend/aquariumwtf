import { TANK_HALF } from './constants';

/**
 * Deterministic scenery layout — purely decorative, but seeded so every
 * client renders the SAME underwater kingdom ("meet me behind the arch"
 * means the same place for everyone).
 */
const WORLD_SEED = 48271;

export function mulberry32(seed: number) {
  return function seededRandom() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function worldRandom() {
  return mulberry32(WORLD_SEED);
}

export interface KelpStrand { x: number; z: number; height: number; phase: number; lean: number }

/** Three dense kelp forests — classic hiding spots. */
export function getKelpForests(): KelpStrand[] {
  const random = mulberry32(WORLD_SEED);
  const clusters: { cx: number; cz: number; count: number }[] = [
    { cx: -16, cz: 12, count: 12 },
    { cx: 17, cz: -13, count: 10 },
    { cx: 2, cz: 16, count: 9 },
  ];
  const strands: KelpStrand[] = [];
  for (const c of clusters) {
    for (let i = 0; i < c.count; i++) {
      strands.push({
        x: c.cx + (random() - 0.5) * 7,
        z: c.cz + (random() - 0.5) * 7,
        height: 6 + random() * 9,
        phase: random() * Math.PI * 2,
        lean: (random() - 0.5) * 0.25,
      });
    }
  }
  return strands;
}

export interface CoralPiece { x: number; z: number; scale: number; rot: number; kind: number; hue: number }

/** Coral gardens scattered in patches across the floor. */
export function getCoralGarden(): CoralPiece[] {
  const random = mulberry32(WORLD_SEED ^ 0x5eed);
  const patches: { cx: number; cz: number; count: number }[] = [
    { cx: 10, cz: 10, count: 16 },
    { cx: -8, cz: -14, count: 14 },
    { cx: 20, cz: 4, count: 10 },
    { cx: -20, cz: -2, count: 12 },
    { cx: 4, cz: -6, count: 8 },
  ];
  const pieces: CoralPiece[] = [];
  for (const p of patches) {
    for (let i = 0; i < p.count; i++) {
      pieces.push({
        x: p.cx + (random() - 0.5) * 8,
        z: p.cz + (random() - 0.5) * 8,
        scale: 0.5 + random() * 1.3,
        rot: random() * Math.PI * 2,
        kind: Math.floor(random() * 4),   // branch / brain / tube / fan
        hue: random(),
      });
    }
  }
  return pieces;
}

export interface Rock { x: number; z: number; scale: number; rot: number; squash: number }

export function getRocks(): Rock[] {
  const random = mulberry32(WORLD_SEED ^ 0xabcd);
  return Array.from({ length: 22 }, () => ({
    x: (random() - 0.5) * TANK_HALF.x * 1.9,
    z: (random() - 0.5) * TANK_HALF.z * 1.9,
    scale: 0.6 + random() * 2.2,
    rot: random() * Math.PI * 2,
    squash: 0.55 + random() * 0.5,
  }));
}
