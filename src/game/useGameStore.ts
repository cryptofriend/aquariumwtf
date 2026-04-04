import * as THREE from 'three';
import { PlayerState, FoodOrb, GamePhase } from './types';
import { FISH_COLORS, TANK_HALF, INITIAL_WEIGHT } from './constants';

export interface GameStore {
  phase: GamePhase;
  name: string;
  color: string;
  weight: number;
  kills: number;
  dead: boolean;
  killerName: string;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  remotePlayers: Map<string, PlayerState & { mesh?: THREE.Group }>;
  food: FoodOrb[];
  lastBiteTime: number;
  flashUntil: number;
  spectate: boolean;
  spawnTime: number;
  immuneUntil: number;
}

function createGameStore(): GameStore {
  return {
    phase: 'entry',
    name: '',
    color: FISH_COLORS[Math.floor(Math.random() * FISH_COLORS.length)],
    weight: INITIAL_WEIGHT,
    kills: 0,
    dead: false,
    killerName: '',
    position: new THREE.Vector3(
      (Math.random() - 0.5) * TANK_HALF.x,
      (Math.random() - 0.5) * TANK_HALF.y * 0.5,
      (Math.random() - 0.5) * TANK_HALF.z
    ),
    velocity: new THREE.Vector3(),
    remotePlayers: new Map(),
    food: [],
    lastBiteTime: 0,
    flashUntil: 0,
    spectate: false,
    spawnTime: 0,
    immuneUntil: 0,
  };
}

let store: GameStore | null = null;

export function getStore(): GameStore {
  if (!store) store = createGameStore();
  return store;
}

export function resetStore(): GameStore {
  store = createGameStore();
  return store;
}
