export interface PlayerState {
  name: string;
  color: string;
  x: number;
  y: number;
  z: number;
  hp: number;
  kills: number;
  dead: boolean;
}

export interface FoodOrb {
  id: string;
  x: number;
  y: number;
  z: number;
}

export type GamePhase = 'entry' | 'playing' | 'dead' | 'spectate';
