/**
 * Authoritative world simulation. Owns ALL game state — positions, weights,
 * bites, food, round lifecycle. Clients (WebSocket or HTTP agents) only ever
 * submit inputs; nothing they send is trusted as state.
 *
 * Pure logic: no sockets, no timers. The host calls tick(now) and drains
 * emitted events, which makes every rule unit-testable with a fake clock.
 */
import { randomUUID } from 'node:crypto';
import {
  TANK_HALF, INITIAL_WEIGHT, MIN_WEIGHT, FOOD_WEIGHT, MAX_FOOD, FOOD_SPAWN_MS,
  BITE_COOLDOWN_MS, SPAWN_IMMUNITY_MS, MIN_PLAYERS, COUNTDOWN_MS, ROUND_MS,
  RESULTS_MS, FRENZY_MS, AGENT_TIMEOUT_MS, ENTRY_COST_TOKENS,
  RESPAWN_GRACE_MS,
  speedFor, eatRadiusFor, biteRangeFor, biteDamage, decayPerSecond,
} from '../../shared/constants';
import type { GameEvent, NetFood, NetPlayer, Phase, SnapshotMsg, Standing } from '../../shared/protocol';

export interface Vec3 { x: number; y: number; z: number }

export interface BiteRecord { attacker: string; damage: number; at: number }

export interface Player {
  id: string;               // public id, shown in snapshots
  secret: string | null;    // auth token for HTTP agents (null for ws players)
  name: string;
  color: string;
  isBot: boolean;
  /** Solana wallet (base58). Required for humans; optional for agents. */
  wallet: string | null;
  pos: Vec3;
  vel: Vec3;
  desired: Vec3;            // unit direction the player wants to swim
  moveTarget: Vec3 | null;  // agents steer toward a point; cleared on arrival
  weight: number;
  maxWeight: number;
  kills: number;
  /** Entry-token balance. Demo top-up at join until on-chain deposits land. */
  tokens: number;
  dead: boolean;
  spectator: boolean;       // joined mid-round, waiting for the next one
  participant: boolean;     // counted in the current round
  immuneUntil: number;
  lastBiteAt: number;
  killerName: string;
  joinedAt: number;
  lastSeenAt: number;       // agents only — drives the inactivity timeout
  biteQueued: { targetId: string | null } | null;
  pendingBites: BiteRecord[]; // inbox drained by the agent "status" action
}

export interface Food extends NetFood {}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function dist(a: Vec3, b: Vec3) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function randomPos(): Vec3 {
  return {
    x: (Math.random() - 0.5) * TANK_HALF.x * 1.6,
    y: (Math.random() - 0.5) * TANK_HALF.y * 0.8,
    z: (Math.random() - 0.5) * TANK_HALF.z * 1.6,
  };
}

export class World {
  players = new Map<string, Player>();
  food: Food[] = [];
  phase: Phase = 'lobby';
  phaseEndsAt = 0;
  roundStartedAt = 0;
  /** How many fish the current round STARTED with (leavers don't shrink it). */
  roundStartedCount = 0;
  /** Tokens staked in the current round (entries + re-entries). Winner takes it. */
  pot = 0;
  /** While one fish remains: deadline for buy-backs before the round ends (0 = inactive). */
  graceEndsAt = 0;
  /** Recent round winners — the new all-time ranks source (server lifetime). */
  hallOfFame: { name: string; wallet: string; weight: number; kills: number; pot: number; at: number }[] = [];

  private events: GameEvent[] = [];
  private lastTickAt = 0;
  private lastFoodSpawnAt = 0;
  private foodSeq = 0;
  private secretIndex = new Map<string, string>(); // secret → player id
  /** Token balances of signed-in wallets, kept across disconnects. */
  private walletBalances = new Map<string, number>();

  // ─── joining / leaving ───────────────────────────────────────────

  /** Returns an error string or the created player. */
  join(name: string, color: string, isBot: boolean, now: number, wallet: string | null = null): { error: string } | { player: Player } {
    const trimmed = (name || '').trim().slice(0, 16);
    if (!trimmed) return { error: 'Name required' };
    const taken = [...this.players.values()].some(
      (p) => p.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (taken) return { error: 'Name already taken' };
    if (!isBot && !wallet) {
      return { error: 'A Solana wallet is required to play — or just spectate' };
    }
    if (wallet) {
      const walletInUse = [...this.players.values()].some((p) => p.wallet === wallet);
      if (walletInUse) return { error: 'This wallet is already in the tank (another tab or device?)' };
    }

    const player: Player = {
      id: randomUUID().slice(0, 8),
      secret: isBot ? randomUUID() : null,
      name: trimmed,
      color: color || '#70a1ff',
      isBot,
      wallet,
      pos: randomPos(),
      vel: { x: 0, y: 0, z: 0 },
      desired: { x: 0, y: 0, z: 0 },
      moveTarget: null,
      weight: INITIAL_WEIGHT,
      maxWeight: INITIAL_WEIGHT,
      kills: 0,
      // Tickets are bought on-chain (1 $MYTH each). Wallets resume their
      // saved balance; everyone else starts at zero and spectates.
      tokens: wallet ? this.walletBalances.get(wallet) ?? 0 : 0,
      dead: false,
      spectator: this.phase === 'round',  // mid-round joiners spectate or buy in
      participant: false,
      immuneUntil: now + SPAWN_IMMUNITY_MS,
      lastBiteAt: 0,
      killerName: '',
      joinedAt: now,
      lastSeenAt: now,
      biteQueued: null,
      pendingBites: [],
    };
    this.players.set(player.id, player);
    if (player.secret) this.secretIndex.set(player.secret, player.id);
    this.emit({ kind: 'join', name: player.name });
    return { player };
  }

  leave(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.wallet) this.walletBalances.set(p.wallet, p.tokens);
    this.players.delete(id);
    if (p.secret) this.secretIndex.delete(p.secret);
    this.emit({ kind: 'leave', name: p.name });
  }

  bySecret(secret: string): Player | undefined {
    const id = this.secretIndex.get(secret);
    return id ? this.players.get(id) : undefined;
  }

  /** Credit verified on-chain ticket purchases to the paying wallet. */
  creditDeposit(wallet: string, tickets: number): number {
    const live = [...this.players.values()].find((p) => p.wallet === wallet);
    if (live) {
      live.tokens += tickets;
      this.walletBalances.set(wallet, live.tokens);
      return live.tokens;
    }
    const balance = (this.walletBalances.get(wallet) ?? 0) + tickets;
    this.walletBalances.set(wallet, balance);
    return balance;
  }

  balanceOf(wallet: string): number {
    const live = [...this.players.values()].find((p) => p.wallet === wallet);
    return live ? live.tokens : this.walletBalances.get(wallet) ?? 0;
  }

  // ─── inputs (the ONLY way clients influence the world) ───────────

  /** Set desired swim direction. Normalized server-side. */
  setInput(id: string, dir: Vec3, bite?: boolean) {
    const p = this.players.get(id);
    if (!p || p.dead || p.spectator) return;
    p.moveTarget = null; // direct steering overrides any point target
    const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    if (len > 1e-6) {
      const s = 1 / Math.max(1, len); // allow sub-unit input for analog sticks
      p.desired = { x: dir.x * s, y: dir.y * s, z: dir.z * s };
    } else {
      p.desired = { x: 0, y: 0, z: 0 };
    }
    if (bite) p.biteQueued = { targetId: null };
  }

  /**
   * Agents steer by target coordinates. The server re-aims every tick and
   * stops on arrival, so agents converge instead of overshooting.
   */
  setMoveTarget(id: string, target: Vec3) {
    const p = this.players.get(id);
    if (!p || p.dead || p.spectator) return;
    p.moveTarget = {
      x: clamp(target.x, -TANK_HALF.x, TANK_HALF.x),
      y: clamp(target.y, -TANK_HALF.y, TANK_HALF.y),
      z: clamp(target.z, -TANK_HALF.z, TANK_HALF.z),
    };
  }

  requestBite(id: string, targetId: string | null = null) {
    const p = this.players.get(id);
    if (!p || p.dead || p.spectator) return;
    p.biteQueued = { targetId };
  }

  touch(id: string, now: number) {
    const p = this.players.get(id);
    if (p) p.lastSeenAt = now;
  }

  // ─── simulation ───────────────────────────────────────────────────

  tick(now: number) {
    const dt = this.lastTickAt === 0 ? 0.05 : clamp((now - this.lastTickAt) / 1000, 0, 0.25);
    this.lastTickAt = now;

    this.updatePhase(now);
    this.dropStaleAgents(now);
    this.movePlayers(now, dt);
    this.applyDecay(now, dt);
    this.processBites(now);
    this.eatFood(now);
    this.spawnFood(now);
  }

  drainEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  snapshot(now: number): SnapshotMsg {
    return {
      t: 'snapshot',
      now,
      phase: this.phase,
      phaseEndsAt: this.phaseEndsAt,
      players: [...this.players.values()].map((p): NetPlayer => ({
        id: p.id,
        name: p.name,
        color: p.color,
        x: round2(p.pos.x), y: round2(p.pos.y), z: round2(p.pos.z),
        weight: round2(p.weight),
        kills: p.kills,
        dead: p.dead,
        spectator: p.spectator,
        immune: p.immuneUntil > now,
        bot: p.isBot,
        tokens: p.tokens,
        wallet: p.wallet ? `${p.wallet.slice(0, 4)}…${p.wallet.slice(-4)}` : '',
      })),
      food: this.food,
      alive: this.aliveParticipants().length,
      needed: MIN_PLAYERS,
      pot: this.pot,
      graceEndsAt: this.graceEndsAt,
    };
  }

  // ─── round lifecycle ──────────────────────────────────────────────

  private updatePhase(now: number) {
    // Only fish that can pay the entry fee count toward starting a round
    const eligible = [...this.players.values()].filter(
      (p) => !p.spectator && p.tokens >= ENTRY_COST_TOKENS,
    );

    switch (this.phase) {
      case 'lobby':
        if (eligible.length >= MIN_PLAYERS) {
          this.phase = 'countdown';
          this.phaseEndsAt = now + COUNTDOWN_MS;
        }
        break;

      case 'countdown':
        if (eligible.length < MIN_PLAYERS) {
          this.phase = 'lobby';
          this.phaseEndsAt = 0;
        } else if (now >= this.phaseEndsAt) {
          this.startRound(now);
        }
        break;

      case 'round': {
        const alive = this.aliveParticipants();
        const lastFish = this.roundStartedCount >= MIN_PLAYERS && alive.length <= 1;
        if (lastFish) {
          // Hold the round open briefly so the dead can buy back in —
          // unless nobody left can afford a re-entry.
          const someoneCanRebuy = [...this.players.values()].some(
            (p) => (p.dead || p.spectator) && p.tokens >= ENTRY_COST_TOKENS,
          );
          if (!someoneCanRebuy) {
            this.endRound(now);
            break;
          }
          if (this.graceEndsAt === 0) this.graceEndsAt = now + RESPAWN_GRACE_MS;
        } else {
          this.graceEndsAt = 0;
        }
        if (now >= this.phaseEndsAt || (this.graceEndsAt > 0 && now >= this.graceEndsAt)) {
          this.endRound(now);
        }
        break;
      }

      case 'results':
        if (now >= this.phaseEndsAt) {
          this.toLobby(now);
        }
        break;
    }
  }

  private startRound(now: number) {
    this.phase = 'round';
    this.roundStartedAt = now;
    this.phaseEndsAt = now + ROUND_MS;
    this.food = [];
    this.pot = 0;
    for (const p of this.players.values()) {
      // Entry fee: 1 ticket per round. No ticket → spectate until you buy
      // another or win a pot.
      if (p.tokens >= ENTRY_COST_TOKENS) {
        p.tokens -= ENTRY_COST_TOKENS;
        this.pot += ENTRY_COST_TOKENS;
        p.participant = true;
        p.spectator = false;
      } else {
        p.participant = false;
        p.spectator = true;
      }
      p.dead = false;
      p.weight = INITIAL_WEIGHT;
      p.maxWeight = INITIAL_WEIGHT;
      p.kills = 0;
      p.killerName = '';
      p.pos = randomPos();
      p.vel = { x: 0, y: 0, z: 0 };
      p.immuneUntil = now + SPAWN_IMMUNITY_MS;
      p.lastBiteAt = 0;
      p.biteQueued = null;
      p.pendingBites = [];
    }
    this.roundStartedCount = [...this.players.values()].filter((p) => p.participant).length;
    this.emit({ kind: 'round_start', endsAt: this.phaseEndsAt, pot: this.pot });
  }

  /**
   * Mid-round (re-)entry for 1 token: dead fish buy back in, spectators buy
   * in late. As many re-entries as the balance allows.
   */
  respawn(id: string, now: number): { ok: true; tokensLeft: number } | { ok: false; reason: string } {
    const p = this.players.get(id);
    if (!p) return { ok: false, reason: 'Unknown player' };
    if (this.phase !== 'round') return { ok: false, reason: 'No active round — you join the next one automatically' };
    if (p.participant && !p.dead) return { ok: false, reason: 'You are still alive' };
    if (p.tokens < ENTRY_COST_TOKENS) return { ok: false, reason: 'Out of tokens' };

    p.tokens -= ENTRY_COST_TOKENS;
    this.pot += ENTRY_COST_TOKENS;
    p.participant = true;
    p.spectator = false;
    p.dead = false;
    p.weight = INITIAL_WEIGHT;
    p.maxWeight = Math.max(p.maxWeight, INITIAL_WEIGHT);
    p.killerName = '';
    p.pos = randomPos();
    p.vel = { x: 0, y: 0, z: 0 };
    p.desired = { x: 0, y: 0, z: 0 };
    p.moveTarget = null;
    p.immuneUntil = now + SPAWN_IMMUNITY_MS;
    p.lastBiteAt = 0;
    p.biteQueued = null;
    this.roundStartedCount++;   // keeps the early-end check correct
    this.emit({ kind: 'respawn', name: p.name, playerId: p.id });
    return { ok: true, tokensLeft: p.tokens };
  }

  private endRound(now: number) {
    const participants = [...this.players.values()].filter((p) => p.participant);
    const standings: Standing[] = participants
      .map((p) => ({
        name: p.name,
        weight: round2(p.weight),
        kills: p.kills,
        alive: !p.dead,
        bot: p.isBot,
      }))
      .sort((a, b) =>
        Number(b.alive) - Number(a.alive) || b.weight - a.weight || b.kills - a.kills,
      );
    const winner = standings[0] ?? null;

    // Winner takes the whole pot, credited as tickets (on-chain $MYTH payout
    // is the next milestone — the accounting stays identical).
    if (winner) {
      const winnerPlayer = participants.find((p) => p.name === winner.name);
      if (winnerPlayer) {
        winnerPlayer.tokens += this.pot;
        if (winnerPlayer.wallet) this.walletBalances.set(winnerPlayer.wallet, winnerPlayer.tokens);
        this.hallOfFame.unshift({
          name: winner.name,
          wallet: winnerPlayer.wallet ? `${winnerPlayer.wallet.slice(0, 4)}…${winnerPlayer.wallet.slice(-4)}` : '',
          weight: winner.weight,
          kills: winner.kills,
          pot: this.pot,
          at: now,
        });
        if (this.hallOfFame.length > 50) this.hallOfFame.pop();
      }
    }

    this.phase = 'results';
    this.phaseEndsAt = now + RESULTS_MS;
    this.graceEndsAt = 0;
    this.emit({ kind: 'round_end', winner, standings, pot: this.pot });
  }

  private toLobby(now: number) {
    this.phase = 'lobby';
    this.phaseEndsAt = 0;
    this.food = [];
    this.pot = 0;
    this.graceEndsAt = 0;
    for (const p of this.players.values()) {
      p.participant = false;
      p.spectator = false;
      p.dead = false;
      p.weight = INITIAL_WEIGHT;
      p.maxWeight = INITIAL_WEIGHT;
      p.kills = 0;
      p.killerName = '';
      p.pos = randomPos();
      p.immuneUntil = now + SPAWN_IMMUNITY_MS;
      p.biteQueued = null;
    }
  }

  private aliveParticipants(): Player[] {
    return [...this.players.values()].filter((p) => p.participant && !p.dead);
  }

  // ─── per-tick systems ─────────────────────────────────────────────

  private dropStaleAgents(now: number) {
    for (const p of [...this.players.values()]) {
      if (p.isBot && now - p.lastSeenAt > AGENT_TIMEOUT_MS) this.leave(p.id);
    }
  }

  private movePlayers(now: number, dt: number) {
    for (const p of this.players.values()) {
      if (p.dead || p.spectator) continue;
      const speed = speedFor(p.weight);
      // Point-target steering (agents): re-aim each tick, brake near arrival
      if (p.moveTarget) {
        const dx = p.moveTarget.x - p.pos.x, dy = p.moveTarget.y - p.pos.y, dz = p.moveTarget.z - p.pos.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 0.3) {
          p.desired = { x: 0, y: 0, z: 0 };
        } else {
          const brake = Math.min(1, d / 3); // ease in over the last 3 units
          p.desired = { x: (dx / d) * brake, y: (dy / d) * brake, z: (dz / d) * brake };
        }
      }
      const target = { x: p.desired.x * speed, y: p.desired.y * speed, z: p.desired.z * speed };
      const k = Math.min(1, dt * 6); // smooth acceleration
      p.vel.x += (target.x - p.vel.x) * k;
      p.vel.y += (target.y - p.vel.y) * k;
      p.vel.z += (target.z - p.vel.z) * k;
      p.pos.x = clamp(p.pos.x + p.vel.x * dt, -TANK_HALF.x, TANK_HALF.x);
      p.pos.y = clamp(p.pos.y + p.vel.y * dt, -TANK_HALF.y, TANK_HALF.y);
      p.pos.z = clamp(p.pos.z + p.vel.z * dt, -TANK_HALF.z, TANK_HALF.z);
    }
  }

  private applyDecay(now: number, dt: number) {
    if (this.phase !== 'round') return;
    const frenzy = this.phaseEndsAt - now < FRENZY_MS;
    for (const p of this.players.values()) {
      if (p.dead || !p.participant) continue;
      // Floor at 1kg, but never RAISE weight — a bitten fish below 1kg must
      // stay bitten, otherwise bites against small fish print free mass.
      const floor = Math.min(p.weight, INITIAL_WEIGHT);
      p.weight = Math.max(floor, p.weight - decayPerSecond(p.weight, frenzy) * dt);
    }
  }

  private processBites(now: number) {
    for (const p of this.players.values()) {
      const req = p.biteQueued;
      if (!req) continue;
      p.biteQueued = null;
      this.performBite(p, req.targetId, now);
    }
  }

  /** All bite rules live here. Returns a result for the agent API. */
  performBite(attacker: Player, targetId: string | null, now: number):
    { ok: false; reason: string } | { ok: true; victim: Player; damage: number; killed: boolean } {
    if (this.phase !== 'round') return { ok: false, reason: 'No active round — bites only count during a round' };
    if (attacker.dead || attacker.spectator) return { ok: false, reason: 'You are not in the round' };
    if (now - attacker.lastBiteAt < BITE_COOLDOWN_MS) return { ok: false, reason: 'Bite on cooldown' };

    const range = biteRangeFor(attacker.weight);
    let victim: Player | undefined;
    if (targetId) {
      victim = this.players.get(targetId);
    } else {
      let best = Infinity;
      for (const q of this.players.values()) {
        if (q.id === attacker.id || q.dead || q.spectator) continue;
        const d = dist(attacker.pos, q.pos);
        if (d < range && d < best) { best = d; victim = q; }
      }
    }
    if (!victim || victim.id === attacker.id || victim.dead || victim.spectator) {
      return { ok: false, reason: 'No fish in range' };
    }
    if (dist(attacker.pos, victim.pos) > range) return { ok: false, reason: 'Target out of range' };
    if (victim.immuneUntil > now) return { ok: false, reason: 'Target has spawn protection' };

    attacker.immuneUntil = 0; // attacking forfeits your own spawn protection
    attacker.lastBiteAt = now;

    const damage = round2(biteDamage(attacker.weight, victim.weight));
    victim.weight = round2(victim.weight - damage);
    attacker.weight = round2(attacker.weight + damage);
    victim.pendingBites.push({ attacker: attacker.name, damage, at: now });
    if (victim.pendingBites.length > 50) victim.pendingBites.shift();

    this.emit({
      kind: 'bite',
      attacker: attacker.name, attackerId: attacker.id,
      victim: victim.name, victimId: victim.id,
      damage,
    });

    let killed = false;
    if (victim.weight < MIN_WEIGHT) {
      killed = true;
      attacker.weight = round2(attacker.weight + Math.max(0, victim.weight));
      victim.weight = 0;
      victim.dead = true;
      victim.killerName = attacker.name;
      attacker.kills++;
      this.emit({
        kind: 'kill',
        attacker: attacker.name, killerId: attacker.id,
        victim: victim.name, victimId: victim.id,
      });
    }
    attacker.maxWeight = Math.max(attacker.maxWeight, attacker.weight);
    return { ok: true, victim, damage, killed };
  }

  private eatFood(now: number) {
    if (this.food.length === 0) return;
    for (const p of this.players.values()) {
      if (p.dead || p.spectator) continue;
      const radius = eatRadiusFor(p.weight);
      for (let i = this.food.length - 1; i >= 0; i--) {
        const f = this.food[i];
        if (dist(p.pos, f) < radius) {
          this.food.splice(i, 1);
          p.weight = round2(p.weight + FOOD_WEIGHT);
          p.maxWeight = Math.max(p.maxWeight, p.weight);
          this.emit({ kind: 'eat', playerId: p.id, name: p.name, weight: p.weight });
        }
      }
    }
  }

  private spawnFood(now: number) {
    if (this.phase === 'results') return;
    if (this.food.length >= MAX_FOOD) return;
    if (now - this.lastFoodSpawnAt < FOOD_SPAWN_MS) return;
    this.lastFoodSpawnAt = now;
    const pos = randomPos();
    this.food.push({ id: `f${this.foodSeq++}`, x: round2(pos.x), y: round2(pos.y), z: round2(pos.z) });
  }

  private emit(e: GameEvent) {
    this.events.push(e);
  }
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}
