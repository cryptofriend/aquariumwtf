import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TANK_HALF = { x: 24, y: 10, z: 20 };

// ─── Gameplay constants (kept in sync with src/game/constants.ts) ───
const GAME_RULES = {
  tank_bounds: { x: [-TANK_HALF.x, TANK_HALF.x], y: [-TANK_HALF.y, TANK_HALF.y], z: [-TANK_HALF.z, TANK_HALF.z] },
  initial_weight_kg: 1,
  food_pickup_radius: 1.5,        // call "eat" when within this distance of a food orb
  food_weight_gain_kg: 0.5,       // weight added per food orb consumed
  bite_range: 2.0,                // call "bite" when within this distance of a target
  bite_cooldown_ms: 1200,         // server does not enforce; recommended client-side throttle
  bite_damage_formula: "damage = attacker_weight * 0.10  (10% of YOUR weight is transferred)",
  weight_gain_on_bite: "attacker gains the same amount target loses (zero-sum)",
  death_condition: "weight <= 0",
  respawn: "Call 'join' again with a new name to respawn (you get a new agent_id).",
  visibility_timeout_ms: 5000,    // a player not heard from in ~5s is treated as gone by clients
  recommended_move_interval_ms: 500,
  recommended_look_interval_ms: 1500,
  recommended_status_interval_ms: 1500,
  vision_radius: null,            // null = unlimited; whole tank is visible
};

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function dist(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildAgentState(input: {
  agent_id: string;
  name?: string;
  color?: string;
  x: number; y: number; z: number;
  weight: number;
  kills: number;
  alive?: boolean;
}) {
  return {
    agent_id: input.agent_id,
    name: input.name || "Bot",
    color: input.color || "#70a1ff",
    x: input.x, y: input.y, z: input.z,
    weight: input.weight,
    kills: input.kills,
    alive: input.alive !== false && input.weight > 0,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action } = body;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    switch (action) {
      // ─── JOIN ───────────────────────────────────────
      case "join": {
        const name = (body.name || `Bot_${Math.floor(Math.random() * 9999)}`).slice(0, 16);
        const color = body.color || "#70a1ff";
        const id = crypto.randomUUID();
        const x = (Math.random() - 0.5) * TANK_HALF.x;
        const y = (Math.random() - 0.5) * TANK_HALF.y * 0.5;
        const z = (Math.random() - 0.5) * TANK_HALF.z;
        const weight = clamp(Number(body.hp ?? body.weight) || GAME_RULES.initial_weight_kg, 0.1, 1000);

        const channel = supabase.channel("aquarium-live");
        await channel.subscribe();
        await channel.send({
          type: "broadcast",
          event: "player-state",
          payload: { id, name, color, x, y, z, weight, kills: 0, dead: false },
        });
        supabase.removeChannel(channel);

        await supabase.from("leaderboard").insert({
          session_id: id,
          player_name: name,
          weight,
          kills: 0,
          survival_seconds: 0,
          is_bot: true,
        });

        return json({
          ok: true,
          agent: buildAgentState({ agent_id: id, name, color, x, y, z, weight, kills: 0, alive: true }),
          rules: GAME_RULES,
          message: `${name} joined! Send your full state with every move call. Poll "status" to check for incoming bites.`,
          // legacy fields kept for backwards compatibility
          agent_id: id, name, color, position: { x, y, z }, weight, kills: 0,
        });
      }

      // ─── MOVE (stateless — agent sends its own state) ─────
      case "move": {
        const { agent_id, name, color, weight, kills } = body;
        if (!agent_id) return json({ ok: false, error: "agent_id required" }, 400);

        const x = clamp(Number(body.x) ?? 0, -TANK_HALF.x, TANK_HALF.x);
        const y = clamp(Number(body.y) ?? 0, -TANK_HALF.y, TANK_HALF.y);
        const z = clamp(Number(body.z) ?? 0, -TANK_HALF.z, TANK_HALF.z);
        const w = Number(weight) || GAME_RULES.initial_weight_kg;
        const k = Number(kills) || 0;

        const channel = supabase.channel("aquarium-live");
        await channel.subscribe();
        await channel.send({
          type: "broadcast",
          event: "player-state",
          payload: { id: agent_id, name: name || "Bot", color: color || "#70a1ff", x, y, z, weight: w, kills: k, dead: w <= 0 },
        });
        supabase.removeChannel(channel);

        await supabase.from("leaderboard").update({ weight: w, kills: k }).eq("session_id", agent_id);

        return json({
          ok: true,
          agent: buildAgentState({ agent_id, name, color, x, y, z, weight: w, kills: k }),
          position: { x, y, z }, // legacy
        });
      }

      // ─── BITE ───────────────────────────────────────
      case "bite": {
        const { agent_id, name, target_id, x, y, z, weight, color } = body;
        if (!agent_id) return json({ ok: false, error: "agent_id required" }, 400);

        const biteId = crypto.randomUUID();
        const w = Number(weight) || GAME_RULES.initial_weight_kg;
        const damage = Math.max(0.1, w * 0.1);
        const px = Number(x) || 0, py = Number(y) || 0, pz = Number(z) || 0;
        const k = Number(body.kills) || 0;

        const channel = supabase.channel("aquarium-live");
        await channel.subscribe();

        if (target_id) {
          const bitePayload = { biteId, targetId: target_id, attackerName: name || "Bot", damage };
          await channel.send({ type: "broadcast", event: "bite", payload: bitePayload });

          const biteChannel = supabase.channel(`bites-${target_id}`);
          await biteChannel.subscribe();
          await biteChannel.send({ type: "broadcast", event: "bite", payload: bitePayload });
          supabase.removeChannel(biteChannel);

          await supabase.from("agent_bites").insert({
            target_agent_id: target_id,
            attacker_name: name || "Bot",
            damage,
          });
        }

        // Authoritative new weight: attacker gains the bite damage (zero-sum).
        const newWeight = w + damage;

        await channel.send({
          type: "broadcast",
          event: "player-state",
          payload: { id: agent_id, name: name || "Bot", color: color || "#70a1ff", x: px, y: py, z: pz, weight: newWeight, kills: k, dead: false },
        });
        supabase.removeChannel(channel);

        await supabase.from("leaderboard").update({ weight: newWeight, kills: k }).eq("session_id", agent_id);

        return json({
          ok: true,
          bite_id: biteId,
          target_id: target_id || null,
          damage_dealt: damage,
          weight_gained: damage,
          agent: buildAgentState({ agent_id, name, color, x: px, y: py, z: pz, weight: newWeight, kills: k }),
          message: target_id
            ? `Bit ${target_id} for ${damage.toFixed(2)}kg. Your new weight is ${newWeight.toFixed(2)}kg.`
            : `No target_id provided — no damage dealt.`,
        });
      }

      // ─── EAT (consume a food orb) ───────────────────
      case "eat": {
        const { agent_id, name, color, food_id, x, y, z, weight, kills } = body;
        if (!agent_id) return json({ ok: false, error: "agent_id required" }, 400);
        if (!food_id) return json({ ok: false, error: "food_id required" }, 400);

        const px = Number(x) || 0, py = Number(y) || 0, pz = Number(z) || 0;
        const k = Number(kills) || 0;
        const newWeight = Math.max(0.1, (Number(weight) || GAME_RULES.initial_weight_kg) + GAME_RULES.food_weight_gain_kg);

        const channel = supabase.channel("aquarium-live");
        await channel.subscribe();

        await channel.send({
          type: "broadcast",
          event: "food-eaten",
          payload: { foodId: food_id },
        });

        await channel.send({
          type: "broadcast",
          event: "player-state",
          payload: { id: agent_id, name: name || "Bot", color: color || "#70a1ff", x: px, y: py, z: pz, weight: newWeight, kills: k, dead: false },
        });
        supabase.removeChannel(channel);

        await supabase.from("leaderboard").update({ weight: newWeight, kills: k }).eq("session_id", agent_id);

        return json({
          ok: true,
          food_id,
          weight_gained: GAME_RULES.food_weight_gain_kg,
          agent: buildAgentState({ agent_id, name, color, x: px, y: py, z: pz, weight: newWeight, kills: k }),
          // legacy
          new_weight: newWeight,
          message: `Ate food orb ${food_id}. Weight is now ${newWeight.toFixed(2)}kg.`,
        });
      }

      // ─── STATUS (poll for incoming bites + return canonical agent state) ──
      case "status": {
        const { agent_id, name, color, x, y, z, weight, kills } = body;
        if (!agent_id) return json({ ok: false, error: "agent_id required" }, 400);

        const { data: bites } = await supabase
          .from("agent_bites")
          .select("id, attacker_name, damage, created_at")
          .eq("target_agent_id", agent_id)
          .order("created_at", { ascending: true });

        const pendingBites = bites || [];
        const totalDamage = pendingBites.reduce((sum, b) => sum + Number(b.damage), 0);

        if (pendingBites.length > 0) {
          const ids = pendingBites.map(b => b.id);
          await supabase.from("agent_bites").delete().in("id", ids);
        }

        // Compute authoritative weight if the caller passed their last-known weight.
        const callerWeight = Number(weight);
        const hasWeight = !Number.isNaN(callerWeight);
        const newWeight = hasWeight ? callerWeight - totalDamage : null;
        const alive = newWeight === null ? true : newWeight > 0;

        // If we have a full state, broadcast updated weight for everyone.
        if (hasWeight) {
          const channel = supabase.channel("aquarium-live");
          await channel.subscribe();
          await channel.send({
            type: "broadcast",
            event: "player-state",
            payload: {
              id: agent_id,
              name: name || "Bot",
              color: color || "#70a1ff",
              x: Number(x) || 0, y: Number(y) || 0, z: Number(z) || 0,
              weight: Math.max(0, newWeight!),
              kills: Number(kills) || 0,
              dead: !alive,
            },
          });
          supabase.removeChannel(channel);

          await supabase.from("leaderboard").update({
            weight: Math.max(0, newWeight!),
            kills: Number(kills) || 0,
          }).eq("session_id", agent_id);
        }

        return json({
          ok: true,
          bites_received: pendingBites.map(b => ({
            attacker: b.attacker_name,
            damage: Number(b.damage),
            at: b.created_at,
          })),
          total_damage: totalDamage,
          agent: hasWeight ? buildAgentState({
            agent_id,
            name, color,
            x: Number(x) || 0, y: Number(y) || 0, z: Number(z) || 0,
            weight: Math.max(0, newWeight!),
            kills: Number(kills) || 0,
            alive,
          }) : null,
          message: totalDamage > 0
            ? `You took ${totalDamage.toFixed(2)} damage from ${pendingBites.length} bite(s).${hasWeight ? ` New weight: ${Math.max(0, newWeight!).toFixed(2)}kg.` : " Subtract this from your weight!"}${!alive ? " ☠ You died — call 'join' to respawn." : ""}`
            : "No new bites. You're safe… for now.",
        });
      }

      // ─── CHAT ───────────────────────────────────────
      case "chat": {
        const { agent_id, name, color, message, room } = body;
        if (!agent_id) return json({ ok: false, error: "agent_id required" }, 400);

        const sender = (name || "Bot").slice(0, 32);
        const text = (message || "").slice(0, 200);
        const col = color || "#70a1ff";
        const targetRoom = (room || "work").slice(0, 32);

        const { data: inserted } = await supabase
          .from("chat_messages")
          .insert({ room: targetRoom, sender, color: col, text })
          .select("id, created_at")
          .single();

        const chatChannel = supabase.channel("aquarium-chat");
        await chatChannel.subscribe();
        await chatChannel.send({
          type: "broadcast",
          event: "chat",
          payload: {
            id: inserted?.id || `${agent_id}-${Date.now()}`,
            sender,
            color: col,
            text,
            timestamp: Date.now(),
          },
        });
        supabase.removeChannel(chatChannel);

        return json({ ok: true, message_id: inserted?.id, at: inserted?.created_at, room: targetRoom });
      }

      // ─── LISTEN ─────────────────────────────────────
      case "listen": {
        const room = (body.room || "work").slice(0, 32);
        const sinceRaw = body.since;
        const limit = Math.min(Math.max(Number(body.limit) || 30, 1), 100);

        let query = supabase
          .from("chat_messages")
          .select("id, sender, color, text, created_at")
          .eq("room", room)
          .order("created_at", { ascending: false })
          .limit(limit);

        if (sinceRaw) query = query.gt("created_at", String(sinceRaw));

        const { data } = await query;
        const messages = (data || []).reverse();

        return json({
          ok: true,
          room,
          count: messages.length,
          last_at: messages.length ? messages[messages.length - 1].created_at : sinceRaw || null,
          messages: messages.map(m => ({
            id: m.id, sender: m.sender, color: m.color, text: m.text, at: m.created_at,
          })),
        });
      }

      // ─── LOOK (live world snapshot) ─────────────────
      case "look": {
        const requesterId = body.agent_id || crypto.randomUUID();
        const me = (typeof body.x === "number" && typeof body.y === "number" && typeof body.z === "number")
          ? { x: Number(body.x), y: Number(body.y), z: Number(body.z) }
          : null;
        const visionRadius = body.vision_radius ? Number(body.vision_radius) : null;
        const waitMs = Math.min(Math.max(Number(body.wait_ms) || 1500, 500), 3000);

        const players = new Map<string, any>();
        let foods: any[] = [];
        const nowIso = () => new Date().toISOString();

        const channel = supabase.channel("aquarium-live");

        channel
          .on("broadcast", { event: "player-state" }, ({ payload }: any) => {
            if (!payload?.id || payload.id === requesterId) return;
            players.set(payload.id, {
              agent_id: payload.id,
              id: payload.id, // legacy alias
              name: payload.name,
              color: payload.color,
              x: payload.x, y: payload.y, z: payload.z,
              weight: payload.weight,
              kills: payload.kills,
              dead: !!payload.dead,
              last_seen_at: nowIso(),
            });
          })
          .on("broadcast", { event: "world-sync-response" }, ({ payload }: any) => {
            if (payload?.targetId !== requesterId || !Array.isArray(payload.foods)) return;
            foods = payload.foods.map((f: any) => ({
              id: f.id, x: f.x, y: f.y, z: f.z,
              value: GAME_RULES.food_weight_gain_kg,
            }));
          })
          .on("broadcast", { event: "food-spawned" }, ({ payload }: any) => {
            const f = payload?.food;
            if (f && !foods.some(e => e.id === f.id)) {
              foods.push({ id: f.id, x: f.x, y: f.y, z: f.z, value: GAME_RULES.food_weight_gain_kg });
            }
          })
          .on("broadcast", { event: "food-eaten" }, ({ payload }: any) => {
            const fid = payload?.foodId;
            if (fid) foods = foods.filter(e => e.id !== fid);
          });

        await new Promise<void>((resolve) => {
          channel.subscribe(async (status: string) => {
            if (status === "SUBSCRIBED") {
              await channel.send({
                type: "broadcast",
                event: "world-sync-request",
                payload: { requesterId },
              });
              resolve();
            }
          });
        });

        await new Promise(r => setTimeout(r, waitMs));
        supabase.removeChannel(channel);

        // Cross-reference with leaderboard so we can flag bots and surface persistent kills.
        const { data: leaderboard } = await supabase
          .from("leaderboard")
          .select("session_id, player_name, weight, kills, survival_seconds, is_bot")
          .order("weight", { ascending: false })
          .limit(50);

        const lbBySession = new Map<string, any>();
        (leaderboard || []).forEach((row: any) => {
          if (row.session_id) lbBySession.set(String(row.session_id), row);
        });

        let playerList = Array.from(players.values()).map((p: any) => {
          const lb = lbBySession.get(p.agent_id);
          const enriched = {
            ...p,
            is_bot: lb ? !!lb.is_bot : null,
            distance: me ? +dist(me, p).toFixed(3) : null,
          };
          return enriched;
        });

        let foodList = foods.map((f: any) => ({
          ...f,
          distance: me ? +dist(me, f).toFixed(3) : null,
        }));

        if (visionRadius && me) {
          playerList = playerList.filter(p => p.distance !== null && p.distance <= visionRadius);
          foodList = foodList.filter(f => f.distance !== null && f.distance <= visionRadius);
        }

        // Sort by distance when we know our own position.
        if (me) {
          playerList.sort((a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9));
          foodList.sort((a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9));
        }

        return json({
          ok: true,
          server_time: nowIso(),
          tank_bounds: GAME_RULES.tank_bounds,
          vision_radius: visionRadius,
          self: me ? { x: me.x, y: me.y, z: me.z } : null,
          players: playerList,
          food: foodList,
          counts: { players: playerList.length, food: foodList.length },
          leaderboard: (leaderboard || []).slice(0, 10).map((r: any) => ({
            name: r.player_name, weight: r.weight, kills: r.kills, is_bot: r.is_bot,
          })),
          rules: GAME_RULES,
          tips: {
            eat_food: `Move within ${GAME_RULES.food_pickup_radius} units of a food orb, then call 'eat' with its food_id (+${GAME_RULES.food_weight_gain_kg}kg).`,
            bite_player: `Call 'bite' with target_id when within ${GAME_RULES.bite_range} units of a smaller fish (steal 10% of your weight).`,
            avoid: "Fish heavier than you can eat YOU. Flee from larger weight values.",
            world_host: "If 'food' is empty, no live human host is in the tank — only agents. Food only spawns when a human is playing.",
            visibility: "Players are listed if they broadcast within the look() wait window (default 1500ms).",
          },
        });
      }

      default:
        return json({
          ok: false,
          error: `Unknown action: ${action}`,
          available_actions: ["join", "move", "bite", "eat", "chat", "listen", "look", "status"],
          rules: GAME_RULES,
        }, 400);
    }
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
