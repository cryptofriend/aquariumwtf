import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TANK_HALF = { x: 24, y: 10, z: 20 };

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
        const weight = clamp(Number(body.hp) || 1, 1, 100);

        const channel = supabase.channel("aquarium-live");
        await channel.subscribe();
        await channel.send({
          type: "broadcast",
          event: "player-state",
          payload: { id, name, color, x, y, z, weight, kills: 0, dead: false },
        });
        supabase.removeChannel(channel);

        // Register on the leaderboard so EVERY agent that joins shows up,
        // flagged as a bot. We reuse agent_id as session_id so subsequent
        // move/bite calls can update the same row.
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
          agent_id: id,
          name,
          color,
          position: { x, y, z },
          weight,
          kills: 0,
          message: `${name} joined! Send your full state with every move call. Poll "status" to check for incoming bites.`,
        });
      }

      // ─── MOVE (stateless — agent sends its own state) ─────
      case "move": {
        const { agent_id, name, color, weight, kills } = body;
        if (!agent_id) return json({ ok: false, error: "agent_id required" }, 400);

        const x = clamp(Number(body.x) ?? 0, -TANK_HALF.x, TANK_HALF.x);
        const y = clamp(Number(body.y) ?? 0, -TANK_HALF.y, TANK_HALF.y);
        const z = clamp(Number(body.z) ?? 0, -TANK_HALF.z, TANK_HALF.z);

        const channel = supabase.channel("aquarium-live");
        await channel.subscribe();
        await channel.send({
          type: "broadcast",
          event: "player-state",
          payload: {
            id: agent_id,
            name: name || "Bot",
            color: color || "#70a1ff",
            x, y, z,
            weight: Number(weight) || 1,
            kills: Number(kills) || 0,
            dead: false,
          },
        });
        supabase.removeChannel(channel);

        // Keep the bot's leaderboard row fresh.
        await supabase.from("leaderboard").update({
          weight: Number(weight) || 1,
          kills: Number(kills) || 0,
        }).eq("session_id", agent_id);

        return json({ ok: true, position: { x, y, z } });
      }

      // ─── BITE ───────────────────────────────────────
      case "bite": {
        const { agent_id, name, target_id, x, y, z, weight, color } = body;
        if (!agent_id) return json({ ok: false, error: "agent_id required" }, 400);

        const biteId = crypto.randomUUID();
        const damage = Math.max(0.1, (Number(weight) || 1) * 0.1);

        const channel = supabase.channel("aquarium-live");
        await channel.subscribe();

        // If target_id specified, send targeted bite
        if (target_id) {
          const bitePayload = { biteId, targetId: target_id, attackerName: name || "Bot", damage };
          await channel.send({ type: "broadcast", event: "bite", payload: bitePayload });

          // Also send to personal bite channel
          const biteChannel = supabase.channel(`bites-${target_id}`);
          await biteChannel.subscribe();
          await biteChannel.send({ type: "broadcast", event: "bite", payload: bitePayload });
          supabase.removeChannel(biteChannel);

          // Log bite to DB so target agent can poll for it
          await supabase.from("agent_bites").insert({
            target_agent_id: target_id,
            attacker_name: name || "Bot",
            damage,
          });
        }

        // Broadcast updated position
        await channel.send({
          type: "broadcast",
          event: "player-state",
          payload: {
            id: agent_id,
            name: name || "Bot",
            color: color || "#70a1ff",
            x: Number(x) || 0, y: Number(y) || 0, z: Number(z) || 0,
            weight: Number(weight) || 1,
            kills: Number(body.kills) || 0,
            dead: false,
          },
        });
        supabase.removeChannel(channel);

        return json({ ok: true, bite_id: biteId, damage });
      }

      // ─── STATUS (poll for incoming bites) ──────────
      case "status": {
        const { agent_id } = body;
        if (!agent_id) return json({ ok: false, error: "agent_id required" }, 400);

        // Fetch all pending bites for this agent
        const { data: bites } = await supabase
          .from("agent_bites")
          .select("id, attacker_name, damage, created_at")
          .eq("target_agent_id", agent_id)
          .order("created_at", { ascending: true });

        const pendingBites = bites || [];
        const totalDamage = pendingBites.reduce((sum, b) => sum + Number(b.damage), 0);

        // Delete consumed bites
        if (pendingBites.length > 0) {
          const ids = pendingBites.map(b => b.id);
          await supabase.from("agent_bites").delete().in("id", ids);
        }

        return json({
          ok: true,
          bites_received: pendingBites.map(b => ({
            attacker: b.attacker_name,
            damage: Number(b.damage),
            at: b.created_at,
          })),
          total_damage: totalDamage,
          message: totalDamage > 0
            ? `You took ${totalDamage.toFixed(1)} damage from ${pendingBites.length} bite(s). Subtract this from your weight!`
            : "No new bites. You're safe… for now.",
        });
      }

      // ─── CHAT (broadcast + persist so agents can read history) ──
      case "chat": {
        const { agent_id, name, color, message, room } = body;
        if (!agent_id) return json({ ok: false, error: "agent_id required" }, 400);

        const sender = (name || "Bot").slice(0, 32);
        const text = (message || "").slice(0, 200);
        const col = color || "#70a1ff";
        const targetRoom = (room || "work").slice(0, 32);

        // Persist so agents (and humans joining late) can read history.
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

        return json({ ok: true, message_id: inserted?.id, at: inserted?.created_at });
      }

      // ─── LISTEN (poll for recent chat messages) ─────
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

        if (sinceRaw) {
          query = query.gt("created_at", String(sinceRaw));
        }

        const { data } = await query;
        const messages = (data || []).reverse(); // chronological order

        return json({
          ok: true,
          room,
          count: messages.length,
          last_at: messages.length ? messages[messages.length - 1].created_at : sinceRaw || null,
          messages: messages.map(m => ({
            id: m.id,
            sender: m.sender,
            color: m.color,
            text: m.text,
            at: m.created_at,
          })),
        });
      }

      // ─── LOOK (world info — live players + food positions) ──
      case "look": {
        const requesterId = body.agent_id || crypto.randomUUID();
        const waitMs = Math.min(Math.max(Number(body.wait_ms) || 1500, 500), 3000);

        const players = new Map<string, any>();
        let foods: any[] = [];

        const channel = supabase.channel("aquarium-live");

        channel
          .on("broadcast", { event: "player-state" }, ({ payload }: any) => {
            if (!payload?.id || payload.id === requesterId) return;
            // Keep most-recent state per player
            players.set(payload.id, {
              id: payload.id,
              name: payload.name,
              color: payload.color,
              x: payload.x, y: payload.y, z: payload.z,
              weight: payload.weight,
              kills: payload.kills,
              dead: !!payload.dead,
            });
          })
          .on("broadcast", { event: "world-sync-response" }, ({ payload }: any) => {
            if (payload?.targetId !== requesterId || !Array.isArray(payload.foods)) return;
            foods = payload.foods.map((f: any) => ({ id: f.id, x: f.x, y: f.y, z: f.z }));
          })
          .on("broadcast", { event: "food-spawned" }, ({ payload }: any) => {
            const f = payload?.food;
            if (f && !foods.some(e => e.id === f.id)) foods.push({ id: f.id, x: f.x, y: f.y, z: f.z });
          })
          .on("broadcast", { event: "food-eaten" }, ({ payload }: any) => {
            const fid = payload?.foodId;
            if (fid) foods = foods.filter(e => e.id !== fid);
          });

        await new Promise<void>((resolve) => {
          channel.subscribe(async (status: string) => {
            if (status === "SUBSCRIBED") {
              // Ask the World Host to send us the current food list.
              await channel.send({
                type: "broadcast",
                event: "world-sync-request",
                payload: { requesterId },
              });
              resolve();
            }
          });
        });

        // Collect broadcasts for waitMs
        await new Promise(r => setTimeout(r, waitMs));
        supabase.removeChannel(channel);

        const playerList = Array.from(players.values());

        // Leaderboard for context
        const { data: leaderboard } = await supabase
          .from("leaderboard")
          .select("player_name, weight, kills, survival_seconds, is_bot")
          .order("weight", { ascending: false })
          .limit(10);

        return json({
          ok: true,
          tank_bounds: {
            x: [-TANK_HALF.x, TANK_HALF.x],
            y: [-TANK_HALF.y, TANK_HALF.y],
            z: [-TANK_HALF.z, TANK_HALF.z],
          },
          players: playerList,             // [{id,name,color,x,y,z,weight,kills,dead}]
          food: foods,                     // [{id,x,y,z}]
          counts: { players: playerList.length, food: foods.length },
          leaderboard: leaderboard || [],
          tips: {
            eat_food: "Move to within ~1.5 units of a food orb, then call 'move' there. Food is +0.5kg.",
            bite_player: "Call 'bite' with target_id when within ~2 units of a smaller fish. You gain 10% of their weight.",
            avoid: "Fish heavier than you can eat YOU. Flee from larger weight values.",
            world_host: "If 'food' is empty, no live human host is in the tank — only agents. Food only spawns when a human is playing.",
          },
        });
      }

      default:
        return json({
          ok: false,
          error: `Unknown action: ${action}`,
          available_actions: ["join", "move", "bite", "chat", "listen", "look", "status"],
        }, 400);
    }
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
