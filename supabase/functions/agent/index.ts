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

      // ─── CHAT ───────────────────────────────────────
      case "chat": {
        const { agent_id, name, color, message } = body;
        if (!agent_id) return json({ ok: false, error: "agent_id required" }, 400);

        const chatChannel = supabase.channel("aquarium-chat");
        await chatChannel.subscribe();
        await chatChannel.send({
          type: "broadcast",
          event: "chat",
          payload: {
            id: `${agent_id}-${Date.now()}`,
            sender: name || "Bot",
            color: color || "#70a1ff",
            text: (message || "").slice(0, 200),
            timestamp: Date.now(),
          },
        });
        supabase.removeChannel(chatChannel);

        return json({ ok: true });
      }

      // ─── LOOK (world info) ─────────────────────────
      case "look": {
        const { data } = await supabase
          .from("leaderboard")
          .select("player_name, weight, kills, survival_seconds")
          .order("weight", { ascending: false })
          .limit(10);

        return json({
          ok: true,
          tank_bounds: { x: [-TANK_HALF.x, TANK_HALF.x], y: [-TANK_HALF.y, TANK_HALF.y], z: [-TANK_HALF.z, TANK_HALF.z] },
          leaderboard: data || [],
        });
      }

      default:
        return json({
          ok: false,
          error: `Unknown action: ${action}`,
          available_actions: ["join", "move", "bite", "chat", "look", "status"],
        }, 400);
    }
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
