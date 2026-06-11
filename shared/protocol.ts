/** WebSocket + agent-API message types shared by server and client. */

export type Phase = 'lobby' | 'countdown' | 'round' | 'results';

export interface NetPlayer {
  id: string;          // public id — NOT an auth credential
  name: string;
  color: string;
  x: number;
  y: number;
  z: number;
  weight: number;
  kills: number;
  dead: boolean;
  /** Joined mid-round; swims out the round as a ghost, plays next round. */
  spectator: boolean;
  immune: boolean;
  bot: boolean;
  /** Entry tokens left — 1 token per round entry / re-entry. */
  tokens: number;
  /** Shortened Solana address ("2Whs…pump") when signed in; '' for guests. */
  wallet: string;
  /** Plankton mode: no wallet — swims and eats only, can't bite or win. */
  guest: boolean;
}

export interface NetFood {
  id: string;
  x: number;
  y: number;
  z: number;
}

export interface Standing {
  name: string;
  weight: number;
  kills: number;
  alive: boolean;
  bot: boolean;
}

export type GameEvent =
  | { kind: 'bite'; attacker: string; victim: string; victimId: string; attackerId: string; damage: number }
  | { kind: 'kill'; attacker: string; victim: string; victimId: string; killerId: string }
  | { kind: 'eat'; playerId: string; name: string; weight: number }
  | { kind: 'join'; name: string }
  | { kind: 'leave'; name: string }
  | { kind: 'respawn'; name: string; playerId: string }
  | { kind: 'round_start'; endsAt: number; pot: number }
  | { kind: 'round_end'; winner: Standing | null; standings: Standing[]; pot: number };

// ─── client → server ───
export type ClientMsg =
  | {
      t: 'join'; name: string; color: string;
      /** Sign-In-With-Solana (all three required together; omit for guest). */
      wallet?: string; nonce?: string; signature?: string;
    }
  | { t: 'input'; x: number; y: number; z: number; bite?: boolean }
  | { t: 'respawn' }
  | { t: 'chat'; text: string }
  | { t: 'ping'; ts: number };

// ─── server → client ───
export interface SnapshotMsg {
  t: 'snapshot';
  now: number;
  phase: Phase;
  phaseEndsAt: number;       // 0 = open-ended (lobby waiting for players)
  players: NetPlayer[];
  food: NetFood[];
  alive: number;             // alive participants in current round
  needed: number;            // min players to start
  pot: number;               // tokens staked in the current round
  graceEndsAt: number;       // >0: one fish left, buy-back deadline (server clock)
}

export type ServerMsg =
  | { t: 'welcome'; id: string; tankHalf: { x: number; y: number; z: number }; wallet: string }
  | SnapshotMsg
  | { t: 'event'; e: GameEvent }
  | { t: 'chat'; from: string; color: string; text: string; ts: number }
  | { t: 'pong'; ts: number }
  | { t: 'error'; code: string; message: string };
