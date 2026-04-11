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

// In-memory agent sessions (per edge function instance)
const agents = new Map<string, {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  z: number;
  weight: number;
  kills: number;
  dead: boolean;
  lastSeen: number;
  spawnTime: number;
}>();

// Clean up agents not seen in 30s
function cleanupAgents() {
  const cutoff = Date.now() - 30000;
  for (const [id, a] of agents) {
    if (a.lastSeen < cutoff) agents.delete(id);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action } = body;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    cleanupAgents();

    switch (action) {
      case "join": {
        const name = (body.name || `Bot_${Math.floor(Math.random() * 9999)}`).slice(0, 16);
        const color = body.color || "#70a1ff";
        const id = crypto.randomUUID();
        const x = (Math.random() - 0.5) * TANK_HALF.x;
        const y = (Math.random() - 0.5) * TANK_HALF.y * 0.5;
        const z = (Math.random() - 0.5) * TANK_HALF.z;
        const weight = clamp(Number(body.hp) || 1, 1, 100);

        const agent = { id, name, color, x, y, z, weight, kills: 0, dead: false, lastSeen: Date.now(), spawnTime: Date.now() };
        agents.set(id, agent);

        // Broadcast presence to all players
        const channel = supabase.channel("aquarium-live");
        await channel.subscribe();
        await channel.send({
          type: "broadcast",
          event: "player-state",
          payload: { id, name, color, x, y, z, weight, kills: 0, dead: false },
        });
        supabase.removeChannel(channel);

        return new Response(JSON.stringify({
          ok: true,
          agent_id: id,
          name,
          color,
          position: { x, y, z },
          weight,
          message: `${name} joined the aquarium! Use agent_id in subsequent calls.`,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "move": {
        const { agent_id, x, y, z } = body;
        const agent = agents.get(agent_id);
        if (!agent) {
          return new Response(JSON.stringify({ ok: false, error: "Unknown agent_id. Call join first." }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (agent.dead) {
          return new Response(JSON.stringify({ ok: false, error: "Agent is dead." }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Accept absolute position or relative delta
        if (body.relative) {
          agent.x = clamp(agent.x + (Number(x) || 0), -TANK_HALF.x, TANK_HALF.x);
          agent.y = clamp(agent.y + (Number(y) || 0), -TANK_HALF.y, TANK_HALF.y);
          agent.z = clamp(agent.z + (Number(z) || 0), -TANK_HALF.z, TANK_HALF.z);
        } else {
          agent.x = clamp(Number(x) ?? agent.x, -TANK_HALF.x, TANK_HALF.x);
          agent.y = clamp(Number(y) ?? agent.y, -TANK_HALF.y, TANK_HALF.y);
          agent.z = clamp(Number(z) ?? agent.z, -TANK_HALF.z, TANK_HALF.z);
        }
        agent.lastSeen = Date.now();

        const channel = supabase.channel("aquarium-live");
        await channel.subscribe();
        await channel.send({
          type: "broadcast",
          event: "player-state",
          payload: { id: agent.id, name: agent.name, color: agent.color, x: agent.x, y: agent.y, z: agent.z, weight: agent.weight, kills: agent.kills, dead: agent.dead },
        });
        supabase.removeChannel(channel);

        return new Response(JSON.stringify({
          ok: true,
          position: { x: agent.x, y: agent.y, z: agent.z },
          weight: agent.weight,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "bite": {
        const { agent_id } = body;
        const agent = agents.get(agent_id);
        if (!agent || agent.dead) {
          return new Response(JSON.stringify({ ok: false, error: "Agent not found or dead." }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        agent.lastSeen = Date.now();

        // Broadcast bite as area-of-effect — game clients handle collision
        const biteId = crypto.randomUUID();
        const damage = Math.max(0.1, agent.weight * 0.1);

        const channel = supabase.channel("aquarium-live");
        await channel.subscribe();

        // Also broadcast updated state
        await channel.send({
          type: "broadcast",
          event: "player-state",
          payload: { id: agent.id, name: agent.name, color: agent.color, x: agent.x, y: agent.y, z: agent.z, weight: agent.weight, kills: agent.kills, dead: agent.dead },
        });

        supabase.removeChannel(channel);

        return new Response(JSON.stringify({
          ok: true,
          bite_id: biteId,
          damage_potential: damage,
          position: { x: agent.x, y: agent.y, z: agent.z },
          message: "Bite broadcast. Damage applied if enemies are in range (handled by game clients).",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "chat": {
        const { agent_id, message } = body;
        const agent = agents.get(agent_id);
        if (!agent) {
          return new Response(JSON.stringify({ ok: false, error: "Agent not found." }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        agent.lastSeen = Date.now();

        const chatChannel = supabase.channel("aquarium-chat");
        await chatChannel.subscribe();
        await chatChannel.send({
          type: "broadcast",
          event: "chat",
          payload: {
            id: `${agent.id}-${Date.now()}`,
            sender: agent.name,
            color: agent.color,
            text: (message || "").slice(0, 200),
            timestamp: Date.now(),
          },
        });
        supabase.removeChannel(chatChannel);

        return new Response(JSON.stringify({ ok: true, message: "Message sent." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "status": {
        const { agent_id } = body;
        const agent = agents.get(agent_id);
        if (!agent) {
          return new Response(JSON.stringify({ ok: false, error: "Agent not found." }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        agent.lastSeen = Date.now();

        return new Response(JSON.stringify({
          ok: true,
          name: agent.name,
          position: { x: agent.x, y: agent.y, z: agent.z },
          weight: agent.weight,
          kills: agent.kills,
          dead: agent.dead,
          alive_seconds: Math.floor((Date.now() - agent.spawnTime) / 1000),
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "look": {
        // Return info about the game world (leaderboard)
        const { data } = await supabase
          .from("leaderboard")
          .select("player_name, weight, kills, survival_seconds")
          .order("weight", { ascending: false })
          .limit(10);

        return new Response(JSON.stringify({
          ok: true,
          tank_bounds: { x: [-TANK_HALF.x, TANK_HALF.x], y: [-TANK_HALF.y, TANK_HALF.y], z: [-TANK_HALF.z, TANK_HALF.z] },
          leaderboard: data || [],
          active_agents: agents.size,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      default:
        return new Response(JSON.stringify({
          ok: false,
          error: `Unknown action: ${action}`,
          available_actions: ["join", "move", "bite", "chat", "status", "look"],
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
