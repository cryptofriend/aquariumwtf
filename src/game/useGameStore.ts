import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import { PlayerState, FoodOrb, GamePhase } from './types';
import { MAX_HP, FISH_COLORS, uid, TANK_HALF, MAX_FOOD } from './constants';

// Simple global mutable store (no re-renders needed for frame-level data)
export interface GameStore {
  phase: GamePhase;
  name: string;
  color: string;
  hp: number;
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
}

export function createGameStore(): GameStore {
  return {
    phase: 'entry',
    name: '',
    color: FISH_COLORS[Math.floor(Math.random() * FISH_COLORS.length)],
    hp: MAX_HP,
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
  };
}

// Singleton
let store: GameStore | null = null;
export function getStore(): GameStore {
  if (!store) store = createGameStore();
  return store;
}

export function resetStore() {
  store = createGameStore();
  return store;
}

export function spawnFood(food: FoodOrb[]) {
  if (food.length >= MAX_FOOD) return;
  food.push({
    id: crypto.randomUUID(),
    x: (Math.random() - 0.5) * TANK_HALF.x * 1.6,
    y: (Math.random() - 0.5) * TANK_HALF.y * 0.8,
    z: (Math.random() - 0.5) * TANK_HALF.z * 1.6,
  });
}
