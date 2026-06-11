import { describe, it, expect, beforeEach } from 'vitest';
import { World, Player } from './world';
import {
  INITIAL_WEIGHT, MIN_WEIGHT, SPAWN_IMMUNITY_MS, BITE_COOLDOWN_MS,
  COUNTDOWN_MS, ROUND_MS, RESULTS_MS, FRENZY_MS, AGENT_TIMEOUT_MS, FOOD_WEIGHT,
  RESPAWN_GRACE_MS,
  biteDamage,
} from '../../shared/constants';

const T0 = 1_000_000;
/** Tickets every test player is funded with (simulating on-chain purchases). */
const FUND = 5;

/** Joins a funded player (fake wallet + FUND tickets) — the default competitor. */
function joinPlayer(world: World, name: string, now = T0, isBot = false): Player {
  if (!isBot) world.creditDeposit(`WALLET_${name}`, FUND);
  const result = world.join(name, '#fff', isBot, now, isBot ? null : `WALLET_${name}`);
  if ('error' in result) throw new Error(result.error);
  if (isBot) result.player.tokens = FUND; // agents funded directly in tests
  return result.player;
}

/** Advance the world to an active round with the given players. */
function startRound(world: World, names: string[], now = T0): Player[] {
  const players = names.map((n) => joinPlayer(world, n, now));
  world.tick(now);                       // lobby → countdown
  world.tick(now + COUNTDOWN_MS);        // countdown → round
  expect(world.phase).toBe('round');
  return players;
}

/** Put two players next to each other and clear immunity/cooldown. */
function setUpFight(a: Player, b: Player, now: number) {
  a.pos = { x: 0, y: 0, z: 0 };
  b.pos = { x: 1, y: 0, z: 0 };
  a.immuneUntil = now - 1;
  b.immuneUntil = now - 1;
  a.lastBiteAt = 0;
  b.lastBiteAt = 0;
}

describe('joining', () => {
  let world: World;
  beforeEach(() => { world = new World(); });

  it('rejects duplicate names (case-insensitive)', () => {
    joinPlayer(world, 'Nemo');
    const dup = world.join('nemo', '#fff', false, T0);
    expect(dup).toHaveProperty('error');
  });

  it('rejects empty names', () => {
    expect(world.join('   ', '#fff', false, T0)).toHaveProperty('error');
  });

  it('gives fresh players spawn immunity', () => {
    const p = joinPlayer(world, 'Nemo');
    expect(p.immuneUntil).toBe(T0 + SPAWN_IMMUNITY_MS);
  });

  it('makes mid-round joiners spectators until next round', () => {
    startRound(world, ['A', 'B']);
    const late = joinPlayer(world, 'Late', T0 + COUNTDOWN_MS + 1000);
    expect(late.spectator).toBe(true);
    expect(late.participant).toBe(false);
  });
});

describe('round lifecycle', () => {
  let world: World;
  beforeEach(() => { world = new World(); });

  it('stays in lobby below MIN_PLAYERS and counts down once reached', () => {
    joinPlayer(world, 'Solo');
    world.tick(T0);
    expect(world.phase).toBe('lobby');
    joinPlayer(world, 'Duo');
    world.tick(T0 + 100);
    expect(world.phase).toBe('countdown');
  });

  it('aborts countdown if players drop below minimum', () => {
    const [a] = [joinPlayer(world, 'A'), joinPlayer(world, 'B')];
    world.tick(T0);
    expect(world.phase).toBe('countdown');
    world.leave(a.id);
    world.tick(T0 + 1000);
    expect(world.phase).toBe('lobby');
  });

  it('resets weights/kills and grants immunity at round start', () => {
    const [a] = startRound(world, ['A', 'B']);
    expect(a.weight).toBe(INITIAL_WEIGHT);
    expect(a.kills).toBe(0);
    expect(a.participant).toBe(true);
    expect(a.immuneUntil).toBe(T0 + COUNTDOWN_MS + SPAWN_IMMUNITY_MS);
  });

  it('ends the round at the buzzer with the biggest fish as winner', () => {
    const [a, b] = startRound(world, ['A', 'B']);
    a.weight = 5; b.weight = 3;
    world.tick(T0 + COUNTDOWN_MS + ROUND_MS);
    expect(world.phase).toBe('results');
    const end = world.drainEvents().find((e) => e.kind === 'round_end');
    expect(end && end.kind === 'round_end' && end.winner?.name).toBe('A');
  });

  it('ends early when only one fish remains alive (no rebuys possible)', () => {
    const [a, b] = startRound(world, ['A', 'B']);
    b.dead = true;
    b.tokens = 0;   // can't buy back in → no grace window
    world.tick(T0 + COUNTDOWN_MS + 5000);
    expect(world.phase).toBe('results');
    const end = world.drainEvents().find((e) => e.kind === 'round_end');
    expect(end && end.kind === 'round_end' && end.winner?.name).toBe('A');
  });

  it('ends early when the opponent disconnects mid-round', () => {
    const [a, b] = startRound(world, ['A', 'B']);
    world.leave(b.id);
    world.tick(T0 + COUNTDOWN_MS + 5000);
    expect(world.phase).toBe('results');
    const end = world.drainEvents().find((e) => e.kind === 'round_end');
    expect(end && end.kind === 'round_end' && end.winner?.name).toBe('A');
  });

  it('returns to lobby after results and resets everyone', () => {
    const [a, b] = startRound(world, ['A', 'B']);
    b.dead = true;
    b.tokens = 0;   // can't buy back in → round ends right away
    const tEnd = T0 + COUNTDOWN_MS + 5000;
    world.tick(tEnd);
    world.tick(tEnd + RESULTS_MS);
    // back in lobby with 2 eligible players → immediately counting down again
    expect(['lobby', 'countdown']).toContain(world.phase);
    expect(b.dead).toBe(false);
    expect(a.weight).toBe(INITIAL_WEIGHT);
  });

  it('ranks dead fish below alive fish in standings', () => {
    const [a, b, c] = startRound(world, ['A', 'B', 'C']);
    a.weight = 10; a.dead = true;   // huge but dead
    b.weight = 2; c.weight = 1.5;
    world.tick(T0 + COUNTDOWN_MS + ROUND_MS);
    const end = world.drainEvents().find((e) => e.kind === 'round_end');
    if (!end || end.kind !== 'round_end') throw new Error('no round_end');
    expect(end.standings.map((s) => s.name)).toEqual(['B', 'C', 'A']);
    expect(end.winner?.name).toBe('B');
  });
});

describe('bites', () => {
  let world: World;
  let a: Player, b: Player;
  let now: number;

  beforeEach(() => {
    world = new World();
    [a, b] = startRound(world, ['A', 'B']);
    now = T0 + COUNTDOWN_MS + SPAWN_IMMUNITY_MS + 1000;
    setUpFight(a, b, now);
  });

  it('transfers weight zero-sum from victim to attacker', () => {
    a.weight = 2; b.weight = 2;
    const result = world.performBite(a, b.id, now);
    expect(result.ok).toBe(true);
    const damage = biteDamage(2, 2);
    expect(a.weight).toBeCloseTo(2 + damage, 2);
    expect(b.weight).toBeCloseTo(2 - damage, 2);
  });

  it('caps damage at half the victim weight (no one-shot of spawns)', () => {
    a.weight = 100; b.weight = 1;
    world.performBite(a, b.id, now);
    expect(b.weight).toBeCloseTo(0.5, 2);
    expect(b.dead).toBe(false);
  });

  it('kills a victim left below MIN_WEIGHT and credits the kill', () => {
    a.weight = 100; b.weight = 0.5;
    const result = world.performBite(a, b.id, now);
    expect(result.ok && result.killed).toBe(true);
    expect(b.dead).toBe(true);
    expect(b.weight).toBe(0);
    expect(a.kills).toBe(1);
    expect(b.killerName).toBe('A');
  });

  it('enforces the bite cooldown', () => {
    world.performBite(a, b.id, now);
    const again = world.performBite(a, b.id, now + BITE_COOLDOWN_MS - 100);
    expect(again.ok).toBe(false);
    const later = world.performBite(a, b.id, now + BITE_COOLDOWN_MS + 100);
    expect(later.ok).toBe(true);
  });

  it('blocks bites on spawn-immune targets', () => {
    b.immuneUntil = now + 1000;
    const result = world.performBite(a, b.id, now);
    expect(result.ok).toBe(false);
  });

  it('forfeits your own immunity when you attack', () => {
    a.immuneUntil = now + 5000;
    world.performBite(a, b.id, now);
    expect(a.immuneUntil).toBe(0);
  });

  it('rejects out-of-range bites', () => {
    b.pos = { x: 20, y: 0, z: 0 };
    const result = world.performBite(a, b.id, now);
    expect(result.ok).toBe(false);
  });

  it('rejects bites outside an active round', () => {
    const lobby = new World();
    const p1 = joinPlayer(lobby, 'X');
    const p2 = joinPlayer(lobby, 'Y');
    setUpFight(p1, p2, T0);
    const result = lobby.performBite(p1, p2.id, T0);
    expect(result.ok).toBe(false);
  });

  it('picks the nearest fish when no target is given', () => {
    const c = joinPlayer(world, 'C', now);
    // joined mid-round → spectator; force into the fight for the distance check
    c.spectator = false; c.participant = true; c.dead = false;
    c.pos = { x: 0.5, y: 0, z: 0 }; c.immuneUntil = 0;
    const result = world.performBite(a, null, now);
    expect(result.ok && result.victim.name).toBe('C');
  });
});

describe('food', () => {
  it('is eaten automatically on contact, exactly once', () => {
    const world = new World();
    const [a, b] = startRound(world, ['A', 'B']);
    const now = T0 + COUNTDOWN_MS + 1000;
    world.food.push({ id: 'test-food', x: 0, y: 0, z: 0 });
    a.pos = { x: 0.5, y: 0, z: 0 };   // both in range — only one may gain
    b.pos = { x: -0.5, y: 0, z: 0 };
    world.tick(now);
    const total = a.weight + b.weight;
    expect(total).toBeCloseTo(INITIAL_WEIGHT * 2 + FOOD_WEIGHT, 2);
    expect(world.food.find((f) => f.id === 'test-food')).toBeUndefined();
  });
});

describe('decay', () => {
  it('never decays below the initial weight', () => {
    const world = new World();
    const [a] = startRound(world, ['A', 'B']);
    a.weight = 1.01;
    for (let i = 1; i <= 100; i++) world.tick(T0 + COUNTDOWN_MS + i * 50);
    expect(a.weight).toBeGreaterThanOrEqual(INITIAL_WEIGHT);
  });

  it('never raises a bitten fish back up to the floor (no free mass)', () => {
    const world = new World();
    const [a, b] = startRound(world, ['A', 'B']);
    const now = T0 + COUNTDOWN_MS + SPAWN_IMMUNITY_MS + 1000;
    setUpFight(a, b, now);
    world.performBite(a, b.id, now);     // b drops below 1kg
    const bittenWeight = b.weight;
    expect(bittenWeight).toBeLessThan(INITIAL_WEIGHT);
    for (let i = 1; i <= 40; i++) world.tick(now + i * 50);
    expect(b.weight).toBeLessThanOrEqual(bittenWeight);
  });

  it('shrinks heavy fish over time and preserves ordering during frenzy', () => {
    const world = new World();
    const [a, b] = startRound(world, ['A', 'B']);
    a.weight = 10; b.weight = 5;
    const frenzyStart = T0 + COUNTDOWN_MS + ROUND_MS - FRENZY_MS;
    world.tick(frenzyStart);
    world.tick(frenzyStart + 1000);
    expect(a.weight).toBeLessThan(10);
    expect(b.weight).toBeLessThan(5);
    expect(a.weight).toBeGreaterThan(b.weight);
  });
});

describe('movement', () => {
  it('agents converge on a move target and stop (no oscillation)', () => {
    const world = new World();
    const [a] = startRound(world, ['A', 'B']);
    a.pos = { x: -10, y: 0, z: -10 };
    world.setMoveTarget(a.id, { x: 0, y: 0, z: 0 });
    let t = T0 + COUNTDOWN_MS;
    for (let i = 0; i < 200; i++) {  // 10 simulated seconds at 20Hz
      t += 50;
      world.tick(t);
    }
    const d = Math.sqrt(a.pos.x ** 2 + a.pos.y ** 2 + a.pos.z ** 2);
    expect(d).toBeLessThan(0.6);
    const speed = Math.sqrt(a.vel.x ** 2 + a.vel.y ** 2 + a.vel.z ** 2);
    expect(speed).toBeLessThan(1);
  });

  it('clamps move targets to tank bounds', () => {
    const world = new World();
    const [a] = startRound(world, ['A', 'B']);
    world.setMoveTarget(a.id, { x: 999, y: 999, z: 999 });
    expect(a.moveTarget!.x).toBeLessThanOrEqual(24);
    expect(a.moveTarget!.y).toBeLessThanOrEqual(10);
  });
});

describe('token economy', () => {
  let world: World;
  beforeEach(() => { world = new World(); });

  it('charges 1 token per round entry and builds the pot', () => {
    const [a, b] = startRound(world, ['A', 'B']);
    expect(a.tokens).toBe(FUND - 1);
    expect(b.tokens).toBe(FUND - 1);
    expect(world.pot).toBe(2);
  });

  it('benches broke players as spectators at round start', () => {
    const a = joinPlayer(world, 'A');
    joinPlayer(world, 'B');
    joinPlayer(world, 'C');
    a.tokens = 0;
    world.tick(T0);
    world.tick(T0 + COUNTDOWN_MS);
    expect(world.phase).toBe('round');
    expect(a.participant).toBe(false);
    expect(a.spectator).toBe(true);
    expect(world.pot).toBe(2); // only B and C paid
  });

  it('does not start a countdown if fewer than 2 fish can pay', () => {
    const a = joinPlayer(world, 'A');
    joinPlayer(world, 'B');
    a.tokens = 0;
    world.tick(T0);
    expect(world.phase).toBe('lobby');
  });

  it('lets a dead fish re-enter for 1 token with fresh weight and immunity', () => {
    const [a, b] = startRound(world, ['A', 'B']);
    const now = T0 + COUNTDOWN_MS + SPAWN_IMMUNITY_MS + 1000;
    b.dead = true;
    const before = b.tokens;
    const result = world.respawn(b.id, now);
    expect(result.ok).toBe(true);
    expect(b.dead).toBe(false);
    expect(b.participant).toBe(true);
    expect(b.weight).toBe(INITIAL_WEIGHT);
    expect(b.tokens).toBe(before - 1);
    expect(b.immuneUntil).toBe(now + SPAWN_IMMUNITY_MS);
    expect(world.pot).toBe(3); // 2 entries + 1 re-entry
  });

  it('allows as many re-entries as the balance affords, then refuses', () => {
    const [, b] = startRound(world, ['A', 'B']);
    let now = T0 + COUNTDOWN_MS + 1000;
    let rebuys = 0;
    while (true) {
      b.dead = true;
      const r = world.respawn(b.id, now);
      if (!r.ok) {
        expect(r.reason).toBe('Out of tokens');
        break;
      }
      rebuys++;
      now += 1000;
    }
    expect(rebuys).toBe(FUND - 1); // entry took 1, rest spent on re-entries
    expect(b.tokens).toBe(0);
  });

  it('rejects respawn while still alive or outside a round', () => {
    const [a] = startRound(world, ['A', 'B']);
    const alive = world.respawn(a.id, T0 + COUNTDOWN_MS + 1000);
    expect(alive.ok).toBe(false);
    const lobby = new World();
    const p = joinPlayer(lobby, 'X');
    p.dead = true;
    expect(lobby.respawn(p.id, T0).ok).toBe(false);
  });

  it('lets a mid-round spectator buy in immediately', () => {
    startRound(world, ['A', 'B']);
    const now = T0 + COUNTDOWN_MS + 2000;
    const late = joinPlayer(world, 'Late', now);
    expect(late.spectator).toBe(true);
    const r = world.respawn(late.id, now);
    expect(r.ok).toBe(true);
    expect(late.participant).toBe(true);
    expect(late.spectator).toBe(false);
  });

  it('pays the whole pot to the round winner', () => {
    const [a, b] = startRound(world, ['A', 'B']);
    a.weight = 5; b.weight = 2;
    const aTokens = a.tokens;
    world.tick(T0 + COUNTDOWN_MS + ROUND_MS);
    expect(world.phase).toBe('results');
    expect(a.tokens).toBe(aTokens + 2); // pot of 2 entries
  });

  it('holds the round open during the buy-back grace, then ends it', () => {
    const [a, b] = startRound(world, ['A', 'B']);
    const now = T0 + COUNTDOWN_MS + 30_000;
    b.dead = true;
    world.tick(now);
    expect(world.phase).toBe('round');               // grace window open
    world.tick(now + RESPAWN_GRACE_MS - 1000);
    expect(world.phase).toBe('round');
    world.tick(now + RESPAWN_GRACE_MS + 100);
    expect(world.phase).toBe('results');             // nobody bought back in
  });

  it('cancels the grace timer when the dead fish buys back in', () => {
    const [, b] = startRound(world, ['A', 'B']);
    const now = T0 + COUNTDOWN_MS + 30_000;
    b.dead = true;
    world.tick(now);
    expect(world.graceEndsAt).toBeGreaterThan(0);
    world.respawn(b.id, now + 2000);
    world.tick(now + 3000);
    expect(world.graceEndsAt).toBe(0);
    world.tick(now + RESPAWN_GRACE_MS + 5000);
    expect(world.phase).toBe('round');               // fight goes on
  });

  it('ends immediately when one fish remains and nobody can afford a re-entry', () => {
    const [a, b] = startRound(world, ['A', 'B']);
    b.dead = true;
    b.tokens = 0;
    world.tick(T0 + COUNTDOWN_MS + 30_000);
    expect(world.phase).toBe('results');
  });
});

describe('ticket gate', () => {
  let world: World;
  beforeEach(() => { world = new World(); });

  it('rejects human joins without a wallet', () => {
    const r = world.join('NoWallet', '#fff', false, T0, null);
    expect(r).toHaveProperty('error');
  });

  it('new wallets start with zero tickets and get benched at round start', () => {
    const r = world.join('Broke', '#fff', false, T0, 'WALLET_BROKE');
    if ('error' in r) throw new Error(r.error);
    expect(r.player.tokens).toBe(0);
    startRound(world, ['A', 'B']);
    expect(r.player.participant).toBe(false);
    expect(r.player.spectator).toBe(true);   // no fish in the round
    expect(world.pot).toBe(2);               // only funded entries staked
  });

  it('broke wallets do not count toward starting a round (no faucet)', () => {
    world.join('B1', '#fff', false, T0, 'WALLET_B1');
    world.join('B2', '#fff', false, T0, 'WALLET_B2');
    world.tick(T0);
    expect(world.phase).toBe('lobby');       // nobody can pay → no countdown
  });

  it('credits deposits to a live player immediately', () => {
    const r = world.join('Buyer', '#fff', false, T0, 'WALLET_BUYER');
    if ('error' in r) throw new Error(r.error);
    const balance = world.creditDeposit('WALLET_BUYER', 3);
    expect(balance).toBe(3);
    expect(r.player.tokens).toBe(3);
  });

  it('credits deposits to offline wallets and restores them on join', () => {
    world.creditDeposit('WALLET_LATER', 2);
    expect(world.balanceOf('WALLET_LATER')).toBe(2);
    const r = world.join('Later', '#fff', false, T0, 'WALLET_LATER');
    if ('error' in r) throw new Error(r.error);
    expect(r.player.tokens).toBe(2);
  });

  it('benched players never refill between rounds (no demo faucet)', () => {
    const r = world.join('Broke', '#fff', false, T0, 'WALLET_BROKE');
    if ('error' in r) throw new Error(r.error);
    const [a, b] = startRound(world, ['A', 'B']);
    b.dead = true; b.tokens = 0;
    const tEnd = T0 + COUNTDOWN_MS + 30_000;
    world.tick(tEnd);                  // → results
    world.tick(tEnd + RESULTS_MS);     // → lobby
    expect(r.player.tokens).toBe(0);
    expect(b.tokens).toBe(0);          // loser stays broke until they buy/win
  });

  it("syncs the winner's pot credit to the wallet balance", () => {
    const [a, b] = startRound(world, ['A', 'B']);
    a.weight = 5; b.weight = 2;
    world.tick(T0 + COUNTDOWN_MS + ROUND_MS);
    expect(world.balanceOf('WALLET_A')).toBe(FUND - 1 + 2); // refund entry + b's stake
  });

  it('records round winners in the hall of fame', () => {
    const [a, b] = startRound(world, ['A', 'B']);
    a.weight = 7; b.weight = 2;
    world.tick(T0 + COUNTDOWN_MS + ROUND_MS);
    expect(world.hallOfFame).toHaveLength(1);
    expect(world.hallOfFame[0]).toMatchObject({ name: 'A', pot: 2, weight: 7 });
    expect(world.hallOfFame[0].wallet).toContain('…');
  });
});

describe('agents', () => {
  it('removes agents that go silent past the timeout', () => {
    const world = new World();
    const bot = joinPlayer(world, 'Bot', T0, true);
    joinPlayer(world, 'Human', T0);
    world.tick(T0 + AGENT_TIMEOUT_MS - 1000);
    expect(world.players.has(bot.id)).toBe(true);
    world.tick(T0 + AGENT_TIMEOUT_MS + 1000);
    expect(world.players.has(bot.id)).toBe(false);
  });

  it('keeps active agents alive and resolves them by secret', () => {
    const world = new World();
    const bot = joinPlayer(world, 'Bot', T0, true);
    expect(bot.secret).toBeTruthy();
    expect(world.bySecret(bot.secret!)?.id).toBe(bot.id);
    world.touch(bot.id, T0 + AGENT_TIMEOUT_MS - 100);
    world.tick(T0 + AGENT_TIMEOUT_MS + 100);
    expect(world.players.has(bot.id)).toBe(true);
  });

  it('never exposes agent secrets in snapshots', () => {
    const world = new World();
    const bot = joinPlayer(world, 'Bot', T0, true);
    const snap = JSON.stringify(world.snapshot(T0));
    expect(snap).not.toContain(bot.secret!);
  });
});
