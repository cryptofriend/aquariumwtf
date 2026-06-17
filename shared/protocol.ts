/** WebSocket + agent-API message types shared by server and client. */

// One-time 24h survival event:
//   upcoming → (event start) → live → (event end) → ended
export type Phase = 'upcoming' | 'live' | 'ended';

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
  /** Joined but not in the event (no ticket spent yet) — a watching ghost. */
  spectator: boolean;
  immune: boolean;
  bot: boolean;
  /** Entry tickets left — 1 ticket per entry / re-entry. */
  tokens: number;
  /** Shortened Solana address ("2Whs…pump") when signed in; '' for agents without one. */
  wallet: string;
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
  wallet: string;
}

export type GameEvent =
  | { kind: 'bite'; attacker: string; victim: string; victimId: string; attackerId: string; damage: number }
  | { kind: 'kill'; attacker: string; victim: string; victimId: string; killerId: string }
  | { kind: 'eat'; playerId: string; name: string; weight: number }
  | { kind: 'join'; name: string }
  | { kind: 'leave'; name: string }
  | { kind: 'respawn'; name: string; playerId: string }
  | { kind: 'event_start'; endsAt: number }
  | {
      kind: 'event_end';
      survivors: Standing[];      // fish alive at the buzzer (empty = nobody)
      standings: Standing[];      // full final board
      prizeFish: number;          // total $FISH pool
      sharePerSurvivor: number;   // prizeFish / survivors (0 if none)
    };

// ─── client → server ───
export type ClientMsg =
  | {
      t: 'join'; name: string; color: string;
      /** Sign-In-With-Solana (all three required together; omit for guest). */
      wallet?: string; nonce?: string; signature?: string;
    }
  | { t: 'input'; x: number; y: number; z: number; bite?: boolean }
  | { t: 'respawn' }
  /** Claim an on-chain $FISH ticket purchase (tx signature, base58). */
  | { t: 'deposit'; signature: string }
  | { t: 'chat'; text: string }
  | { t: 'ping'; ts: number };

// ─── server → client ───
export interface SnapshotMsg {
  t: 'snapshot';
  now: number;               // server clock (for countdown sync)
  phase: Phase;
  eventStartsAt: number;     // epoch ms — survival window opens
  eventEndsAt: number;       // epoch ms — buzzer; survivors split the pool
  players: NetPlayer[];
  food: NetFood[];
  alive: number;             // fish currently alive in the event
  prizeFish: number;         // total prize pool in $FISH (base + tickets)
}

export type ServerMsg =
  | { t: 'welcome'; id: string; tankHalf: { x: number; y: number; z: number }; wallet: string }
  | SnapshotMsg
  | { t: 'event'; e: GameEvent }
  | { t: 'chat'; from: string; color: string; text: string; ts: number }
  | { t: 'deposit_result'; ok: boolean; message: string; tickets?: number; balance?: number }
  | { t: 'pong'; ts: number }
  | { t: 'error'; code: string; message: string };
