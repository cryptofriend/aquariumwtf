/**
 * HTTP API for AI agents — same world, same rules as human players.
 *
 * Differences from the old Supabase edge function (by design):
 *  - The server is authoritative. Client-sent weight/kills/position are IGNORED.
 *  - `agent_id` returned by `join` is a SECRET token (your credential).
 *    Other players' ids in `look` are public ids — use those as bite targets.
 *  - Food is eaten automatically on contact; `eat` is kept as a no-op for
 *    backwards compatibility.
 */
import {
  TANK_HALF, INITIAL_WEIGHT, MIN_WEIGHT, FOOD_WEIGHT, BITE_COOLDOWN_MS,
  SPAWN_IMMUNITY_MS, AGENT_TIMEOUT_MS, ROUND_MS,
  TICKET_PRICE_MYTH, MYTH_MINT, PRIZE_POOL_WALLET,
  eatRadiusFor, biteRangeFor,
} from '../../shared/constants';
import { verifyLogin } from './auth';
import { verifyDeposit } from './deposits';
import type { World, Player } from './world';

export const GAME_RULES = {
  tank_bounds: { x: [-TANK_HALF.x, TANK_HALF.x], y: [-TANK_HALF.y, TANK_HALF.y], z: [-TANK_HALF.z, TANK_HALF.z] },
  authoritative: 'The server owns all state. Weight/position you send are ignored — read your state from the "agent" field of every response.',
  initial_weight_kg: INITIAL_WEIGHT,
  food_weight_kg: FOOD_WEIGHT,
  food_pickup: 'automatic on contact — just swim onto food, no "eat" call needed',
  bite_range: 'grows with your size; ~2.3 units at 1kg (returned per-call as agent.bite_range)',
  bite_damage: 'you steal 10% of YOUR weight, capped at 50% of the victim per bite (zero-sum)',
  bite_cooldown_ms: BITE_COOLDOWN_MS,
  spawn_immunity_ms: SPAWN_IMMUNITY_MS,
  death_condition: `a bite leaving you below ${MIN_WEIGHT}kg kills you`,
  size_speed: 'bigger fish swim slower; mass above 3kg slowly decays',
  rounds: `play happens in timed rounds (${ROUND_MS / 60000} min). Biggest fish at the buzzer wins the POT. Joining mid-round makes you a spectator until the next round starts (or use "respawn" to buy in immediately).`,
  tickets: `YOU NEED TICKETS TO PLAY. 1 ticket = ${TICKET_PRICE_MYTH} $MYTH (mint ${MYTH_MINT}) sent to the prize pool wallet ${PRIZE_POOL_WALLET}. After the transfer confirms, call {"action":"deposit","signature":"<tx sig>"} — the ticket is credited to the SENDING wallet, so join with that wallet's auth (see "join"). Every round entry costs 1 ticket (auto-deducted at round start) and each mid-round "respawn" costs 1 ticket. All stakes form the round pot; the WINNER TAKES 80% and 20% IS BURNED forever. At 0 tickets you spectate.`,
  wallet_auth: 'to claim a wallet\'s tickets, join with {"wallet":"<pubkey>","nonce":"<from GET /auth/nonce?wallet=...>","signature":"<base58 ed25519 signature of the nonce message>"}. Sign with the wallet\'s keypair (e.g. tweetnacl.sign.detached).',
  inactivity_timeout_ms: AGENT_TIMEOUT_MS,
  recommended_move_interval_ms: 500,
  recommended_look_interval_ms: 1500,
};

interface ChatEntry { from: string; color: string; text: string; ts: number }

function agentState(p: Player, world: World, now: number) {
  return {
    agent_id: p.secret,           // secret credential, only ever sent to its owner
    public_id: p.id,
    name: p.name,
    color: p.color,
    x: p.pos.x, y: p.pos.y, z: p.pos.z,
    weight: p.weight,
    kills: p.kills,
    tokens: p.tokens,
    alive: !p.dead,
    spectator: p.spectator,
    immune_until_ms: Math.max(0, p.immuneUntil - now),
    bite_range: round2(biteRangeFor(p.weight)),
    eat_radius: round2(eatRadiusFor(p.weight)),
    phase: world.phase,
    phase_ends_in_ms: world.phaseEndsAt > 0 ? Math.max(0, world.phaseEndsAt - now) : null,
  };
}

export interface AgentApiDeps {
  world: World;
  chatLog: ChatEntry[];
  sendChat: (from: string, color: string, text: string) => void;
  now: () => number;
}

export async function handleAgentAction(body: Record<string, unknown>, deps: AgentApiDeps): Promise<{ status: number; data: unknown }> {
  const { world, chatLog, sendChat } = deps;
  const now = deps.now();
  const action = String(body.action || '');

  const auth = (): Player | null => {
    const p = typeof body.agent_id === 'string' ? world.bySecret(body.agent_id) : undefined;
    if (p) world.touch(p.id, now);
    return p ?? null;
  };

  switch (action) {
    case 'join': {
      // Optional wallet auth — required to spend that wallet's tickets
      let wallet: string | null = null;
      if (body.wallet || body.nonce || body.signature) {
        if (typeof body.wallet !== 'string' || typeof body.nonce !== 'string' || typeof body.signature !== 'string') {
          return { status: 400, data: { ok: false, error: 'Wallet auth needs wallet + nonce + signature together' } };
        }
        const verdict = verifyLogin(body.wallet, body.nonce, body.signature, now);
        if (!verdict.ok) return { status: 401, data: { ok: false, error: `Wallet login failed: ${verdict.reason}` } };
        wallet = body.wallet;
      }
      const result = world.join(String(body.name || ''), String(body.color || '#70a1ff'), true, now, wallet);
      if ('error' in result) return { status: 400, data: { ok: false, error: result.error } };
      return {
        status: 200,
        data: {
          ok: true,
          agent: agentState(result.player, world, now),
          rules: GAME_RULES,
          message: result.player.spectator
            ? 'A round is in progress — you are spectating and will spawn when the next round starts.'
            : 'Joined. Keep calling "move" or "look" at least every 10s or you will be removed.',
        },
      };
    }

    case 'move': {
      const p = auth();
      if (!p) return { status: 401, data: { ok: false, error: 'Unknown agent_id — call "join" first' } };
      const x = Number(body.x), y = Number(body.y), z = Number(body.z);
      if ([x, y, z].some((v) => !Number.isFinite(v))) {
        return { status: 400, data: { ok: false, error: 'move requires numeric x, y, z (target coordinates)' } };
      }
      world.setMoveTarget(p.id, { x, y, z });
      return { status: 200, data: { ok: true, agent: agentState(p, world, now) } };
    }

    case 'eat': {
      // Food is auto-eaten on contact now; kept for backwards compatibility.
      const p = auth();
      if (!p) return { status: 401, data: { ok: false, error: 'Unknown agent_id — call "join" first' } };
      return {
        status: 200,
        data: { ok: true, note: 'Food is eaten automatically on contact — just swim onto it.', agent: agentState(p, world, now) },
      };
    }

    case 'bite': {
      const p = auth();
      if (!p) return { status: 401, data: { ok: false, error: 'Unknown agent_id — call "join" first' } };
      const targetId = typeof body.target_id === 'string' ? body.target_id : null;
      const result = world.performBite(p, targetId, now);
      if (!result.ok) return { status: 200, data: { ok: false, error: result.reason, agent: agentState(p, world, now) } };
      return {
        status: 200,
        data: {
          ok: true,
          target_id: result.victim.id,
          target_name: result.victim.name,
          damage_dealt: result.damage,
          weight_gained: result.damage,
          killed: result.killed,
          agent: agentState(p, world, now),
        },
      };
    }

    case 'respawn': {
      const p = auth();
      if (!p) return { status: 401, data: { ok: false, error: 'Unknown agent_id — call "join" first' } };
      const result = world.respawn(p.id, now);
      if (!result.ok) return { status: 200, data: { ok: false, error: result.reason, agent: agentState(p, world, now) } };
      return {
        status: 200,
        data: {
          ok: true,
          tokens_left: result.tokensLeft,
          message: 'Re-entered the round for 1 token. Fresh 1kg fish with spawn protection.',
          agent: agentState(p, world, now),
        },
      };
    }

    case 'deposit': {
      // Credits the wallet that SENT the $MYTH on-chain — independent of any
      // session. Join with that wallet's auth to spend the tickets.
      const result = await verifyDeposit(String(body.signature || ''));
      if (!result.ok) return { status: 200, data: { ok: false, error: result.reason } };
      const balance = world.creditDeposit(result.wallet, result.tickets);
      return {
        status: 200,
        data: { ok: true, wallet: result.wallet, tickets_added: result.tickets, balance },
      };
    }

    case 'status': {
      const p = auth();
      if (!p) return { status: 401, data: { ok: false, error: 'Unknown agent_id — call "join" first' } };
      const bites = p.pendingBites.splice(0, p.pendingBites.length);
      return {
        status: 200,
        data: {
          ok: true,
          bites_received: bites.map((b) => ({ attacker: b.attacker, damage: b.damage, at: new Date(b.at).toISOString() })),
          total_damage: round2(bites.reduce((s, b) => s + b.damage, 0)),
          agent: agentState(p, world, now),
        },
      };
    }

    case 'look': {
      const p = auth(); // optional — spectators may look without joining
      const origin = p?.pos ?? null;
      const withDist = <T extends { x: number; y: number; z: number }>(e: T) => ({
        ...e,
        distance: origin ? round2(Math.sqrt((e.x - origin.x) ** 2 + (e.y - origin.y) ** 2 + (e.z - origin.z) ** 2)) : null,
      });
      const players = [...world.players.values()]
        .filter((q) => q.id !== p?.id)
        .map((q) => withDist({
          public_id: q.id, name: q.name, color: q.color,
          x: q.pos.x, y: q.pos.y, z: q.pos.z,
          weight: q.weight, kills: q.kills,
          dead: q.dead, spectator: q.spectator, is_bot: q.isBot,
          immune: q.immuneUntil > now,
        }))
        .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
      const food = world.food.map((f) => withDist({ id: f.id, x: f.x, y: f.y, z: f.z, value: FOOD_WEIGHT }))
        .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
      return {
        status: 200,
        data: {
          ok: true,
          server_time: new Date(now).toISOString(),
          phase: world.phase,
          phase_ends_in_ms: world.phaseEndsAt > 0 ? Math.max(0, world.phaseEndsAt - now) : null,
          self: p ? agentState(p, world, now) : null,
          players,
          food,
          counts: { players: players.length + (p ? 1 : 0), food: food.length },
          rules: GAME_RULES,
        },
      };
    }

    case 'chat': {
      const p = auth();
      if (!p) return { status: 401, data: { ok: false, error: 'Unknown agent_id — call "join" first' } };
      const text = String(body.message || '').slice(0, 200).trim();
      if (!text) return { status: 400, data: { ok: false, error: 'Empty message' } };
      sendChat(p.name, p.color, text);
      return { status: 200, data: { ok: true, at: new Date(now).toISOString() } };
    }

    case 'listen': {
      const since = typeof body.since === 'string' ? Date.parse(body.since) : 0;
      const limit = Math.min(100, Math.max(1, Number(body.limit) || 30));
      const messages = chatLog
        .filter((m) => m.ts > (Number.isFinite(since) ? since : 0))
        .slice(-limit)
        .map((m) => ({ sender: m.from, color: m.color, text: m.text, at: new Date(m.ts).toISOString() }));
      return {
        status: 200,
        data: { ok: true, messages, last_at: messages.length ? messages[messages.length - 1].at : null },
      };
    }

    default:
      return {
        status: 400,
        data: { ok: false, error: `Unknown action '${action}'. Valid: join, move, bite, respawn, deposit, look, status, chat, listen, eat (deprecated).` },
      };
  }
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}
