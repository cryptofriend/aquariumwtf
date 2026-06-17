import { describe, it, expect, beforeEach } from 'vitest';
import { World, Player } from './world';
import {
  INITIAL_WEIGHT, SPAWN_IMMUNITY_MS, BITE_COOLDOWN_MS,
  EVENT_DURATION_MS, AGENT_TIMEOUT_MS, FOOD_WEIGHT,
  BASE_PRIZE_FISH, TICKET_PRICE_FISH, prizePoolFish,
  biteDamage,
} from '../../shared/constants';

const START = 1_000_000;            // event start (fake clock)
const END = START + EVENT_DURATION_MS;
const LIVE = START + 1000;          // a moment inside the live window
const FUND = 5;                     // tickets each test player is funded with

/** A world whose survival window is [START, END]. */
function freshWorld(): World {
  const w = new World({ startsAt: START, endsAt: END });
  w.tick(START + 1); // → live
  return w;
}

/** Join a funded player (fake wallet + FUND tickets) — auto-enters. */
function joinPlayer(world: World, name: string, now = LIVE, isBot = false): Player {
  if (!isBot) world.creditDeposit(`WALLET_${name}`, FUND);
  const result = world.join(name, '#fff', isBot, now, isBot ? null : `WALLET_${name}`);
  if ('error' in result) throw new Error(result.error);
  if (isBot) { result.player.tokens = FUND; world.enter(result.player.id, now); }
  return result.player;
}

function setUpFight(a: Player, b: Player, now: number) {
  a.pos = { x: 0, y: 0, z: 0 };
  b.pos = { x: 1, y: 0, z: 0 };
  a.immuneUntil = now - 1;
  b.immuneUntil = now - 1;
  a.lastBiteAt = 0;
  b.lastBiteAt = 0;
}

describe('event lifecycle', () => {
  it('is upcoming before start, live during, ended after', () => {
    const w = new World({ startsAt: START, endsAt: END });
    expect(w.phase).toBe('upcoming');
    w.tick(START - 1000);
    expect(w.phase).toBe('upcoming');
    w.tick(START + 1);
    expect(w.phase).toBe('live');
    w.tick(END + 1);
    expect(w.phase).toBe('ended');
  });

  it('emits event_start when combat opens and event_end at the buzzer', () => {
    const w = new World({ startsAt: START, endsAt: END });
    w.tick(START + 1);
    expect(w.drainEvents().some((e) => e.kind === 'event_start')).toBe(true);
    joinPlayer(w, 'A'); joinPlayer(w, 'B');
    w.drainEvents();
    w.tick(END + 1);
    const end = w.drainEvents().find((e) => e.kind === 'event_end');
    expect(end && end.kind === 'event_end').toBe(true);
  });

  it('grants fresh immunity to pre-entered fish when the event goes live', () => {
    const w = new World({ startsAt: START, endsAt: END });
    // pre-enter during 'upcoming'
    w.creditDeposit('WALLET_Early', FUND);
    const r = w.join('Early', '#fff', false, START - 5000, 'WALLET_Early');
    if ('error' in r) throw new Error(r.error);
    expect(r.player.participant).toBe(true);
    w.tick(START + 1);  // → live, beginLive resets immunity
    expect(r.player.immuneUntil).toBeGreaterThanOrEqual(START + SPAWN_IMMUNITY_MS);
  });
});

describe('joining & entering', () => {
  let world: World;
  beforeEach(() => { world = freshWorld(); });

  it('rejects duplicate names', () => {
    joinPlayer(world, 'Nemo');
    expect(world.join('nemo', '#fff', false, LIVE, 'WALLET_x')).toHaveProperty('error');
  });

  it('rejects wallet-less humans (no dev bypass)', () => {
    expect(world.join('NoWallet', '#fff', false, LIVE, null)).toHaveProperty('error');
  });

  it('a ticket-holder auto-enters as a participant on join', () => {
    const p = joinPlayer(world, 'A');
    expect(p.participant).toBe(true);
    expect(p.spectator).toBe(false);
    expect(p.tokens).toBe(FUND - 1);          // spent one entering
    expect(world.ticketsStaked).toBe(1);
  });

  it('a wallet with no tickets joins as a spectator', () => {
    world.join('Broke', '#fff', false, LIVE, 'WALLET_BROKE');
    const broke = [...world.players.values()].find((p) => p.name === 'Broke')!;
    expect(broke.spectator).toBe(true);
    expect(broke.participant).toBe(false);
    expect(world.ticketsStaked).toBe(0);
  });
});

describe('prize pool', () => {
  let world: World;
  beforeEach(() => { world = freshWorld(); });

  it('starts at the 100M base and grows by each staked ticket', () => {
    expect(prizePoolFish(0)).toBe(BASE_PRIZE_FISH);
    joinPlayer(world, 'A');           // +1 ticket
    joinPlayer(world, 'B');           // +1 ticket
    expect(world.snapshot(LIVE).prizeFish).toBe(BASE_PRIZE_FISH + 2 * TICKET_PRICE_FISH);
  });

  it('counts re-entries toward the pool too', () => {
    const a = joinPlayer(world, 'A');
    a.dead = true;
    world.respawn(a.id, LIVE + 100);
    expect(world.ticketsStaked).toBe(2);
  });
});

describe('survival payout', () => {
  it('splits the pool equally among fish alive at the buzzer', () => {
    const world = freshWorld();
    const a = joinPlayer(world, 'A');
    const b = joinPlayer(world, 'B');
    const c = joinPlayer(world, 'C');
    c.dead = true;                    // C does not survive
    world.drainEvents();
    world.tick(END + 1);
    const end = world.drainEvents().find((e) => e.kind === 'event_end');
    if (!end || end.kind !== 'event_end') throw new Error('no event_end');
    expect(end.survivors.map((s) => s.name).sort()).toEqual(['A', 'B']);
    const pool = prizePoolFish(3);    // 3 entries staked
    expect(end.prizeFish).toBe(pool);
    expect(end.sharePerSurvivor).toBe(Math.floor(pool / 2));
  });

  it('pays nobody when there are no survivors (pool unclaimed)', () => {
    const world = freshWorld();
    const a = joinPlayer(world, 'A');
    const b = joinPlayer(world, 'B');
    a.dead = true; b.dead = true;
    world.drainEvents();
    world.tick(END + 1);
    const end = world.drainEvents().find((e) => e.kind === 'event_end');
    if (!end || end.kind !== 'event_end') throw new Error('no event_end');
    expect(end.survivors).toHaveLength(0);
    expect(end.sharePerSurvivor).toBe(0);
  });

  it('records survivors in the hall of fame', () => {
    const world = freshWorld();
    joinPlayer(world, 'A');
    joinPlayer(world, 'B');
    world.tick(END + 1);
    expect(world.hallOfFame.map((h) => h.name).sort()).toEqual(['A', 'B']);
    expect(world.hallOfFame[0].share).toBeGreaterThan(0);
  });
});

describe('bites', () => {
  let world: World;
  let a: Player, b: Player;
  let now: number;

  beforeEach(() => {
    world = freshWorld();
    a = joinPlayer(world, 'A');
    b = joinPlayer(world, 'B');
    now = LIVE + SPAWN_IMMUNITY_MS + 1000;
    setUpFight(a, b, now);
  });

  it('transfers weight zero-sum', () => {
    a.weight = 2; b.weight = 2;
    const r = world.performBite(a, b.id, now);
    expect(r.ok).toBe(true);
    const dmg = biteDamage(2, 2);
    expect(a.weight).toBeCloseTo(2 + dmg, 2);
    expect(b.weight).toBeCloseTo(2 - dmg, 2);
  });

  it('kills a victim dropped below the floor', () => {
    a.weight = 100; b.weight = 0.5;
    const r = world.performBite(a, b.id, now);
    expect(r.ok && r.killed).toBe(true);
    expect(b.dead).toBe(true);
    expect(a.kills).toBe(1);
  });

  it('enforces the cooldown', () => {
    world.performBite(a, b.id, now);
    expect(world.performBite(a, b.id, now + BITE_COOLDOWN_MS - 100).ok).toBe(false);
    expect(world.performBite(a, b.id, now + BITE_COOLDOWN_MS + 100).ok).toBe(true);
  });

  it('blocks bites on spawn-immune targets', () => {
    b.immuneUntil = now + 1000;
    expect(world.performBite(a, b.id, now).ok).toBe(false);
  });

  it('refuses combat outside the live window', () => {
    const w = new World({ startsAt: START, endsAt: END });
    w.tick(START - 1000); // upcoming
    const p1 = joinPlayer(w, 'X', START - 1000);
    const p2 = joinPlayer(w, 'Y', START - 1000);
    setUpFight(p1, p2, START - 1000);
    expect(w.performBite(p1, p2.id, START - 1000).ok).toBe(false);
  });
});

describe('food', () => {
  it('is eaten on contact, exactly once', () => {
    const world = freshWorld();
    const a = joinPlayer(world, 'A');
    const b = joinPlayer(world, 'B');
    world.food.push({ id: 'test-food', x: 0, y: 0, z: 0 });
    a.pos = { x: 0.5, y: 0, z: 0 };
    b.pos = { x: -0.5, y: 0, z: 0 };
    world.tick(LIVE + 100);
    expect(a.weight + b.weight).toBeCloseTo(INITIAL_WEIGHT * 2 + FOOD_WEIGHT, 2);
    expect(world.food.find((f) => f.id === 'test-food')).toBeUndefined();
  });
});

describe('agents', () => {
  it('removes agents that go silent past the timeout', () => {
    const world = freshWorld();
    const bot = joinPlayer(world, 'Bot', LIVE, true);
    joinPlayer(world, 'Human', LIVE);
    world.tick(LIVE + AGENT_TIMEOUT_MS - 1000);
    expect(world.players.has(bot.id)).toBe(true);
    world.tick(LIVE + AGENT_TIMEOUT_MS + 1000);
    expect(world.players.has(bot.id)).toBe(false);
  });

  it('never exposes agent secrets in snapshots', () => {
    const world = freshWorld();
    const bot = joinPlayer(world, 'Bot', LIVE, true);
    expect(JSON.stringify(world.snapshot(LIVE))).not.toContain(bot.secret!);
  });
});
