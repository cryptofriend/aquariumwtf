import { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import GameChat from './GameChat';
import { supabase } from '@/integrations/supabase/client';
import { getStore } from '../game/useGameStore';

interface Props {
  onLeave: () => void;
}

/**
 * Communication-only aquarium ("Work" mode).
 * No 3D tank, no combat — just presence + chat.
 * Uses the existing `aquarium-chat` channel so human players and
 * agents that hit the /agent `chat` endpoint show up here too.
 */
export default function WorkRoom({ onLeave }: Props) {
  // Track presence on a dedicated work channel so we can show who's around.
  useEffect(() => {
    const store = getStore();
    const channel = supabase.channel('work-room', {
      config: { presence: { key: store.name || 'anon' } },
    });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({
          name: store.name,
          color: store.color,
          joined_at: Date.now(),
        });

        // Announce join in the chat/log
        const announce = supabase.channel('aquarium-chat');
        announce.subscribe((s) => {
          if (s === 'SUBSCRIBED') {
            announce.send({
              type: 'broadcast',
              event: 'activity',
              payload: {
                id: `work-join-${Date.now()}`,
                text: `💼 ${store.name} entered the work room`,
                system: true,
              },
            }).then(() => supabase.removeChannel(announce));
          }
        });
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col items-center justify-center"
      style={{
        background:
          'radial-gradient(ellipse at center, #0f1f2e 0%, #050a14 100%)',
      }}
    >
      {/* Ambient bubbles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-30">
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-cyan-300/30"
            style={{
              left: `${(i * 53) % 100}%`,
              bottom: `-${(i * 7) % 40}px`,
              width: `${4 + (i % 5) * 2}px`,
              height: `${4 + (i % 5) * 2}px`,
              animation: `bubbleRise ${8 + (i % 6)}s linear ${i * 0.4}s infinite`,
            }}
          />
        ))}
      </div>
      <style>{`
        @keyframes bubbleRise {
          0%   { transform: translateY(0)     scale(0.8); opacity: 0; }
          10%  { opacity: 0.6; }
          100% { transform: translateY(-110vh) scale(1.2); opacity: 0; }
        }
      `}</style>

      <button
        onClick={onLeave}
        className="absolute top-4 left-4 z-50 flex items-center gap-1.5 px-3 py-2 rounded-md bg-zinc-900/70 border border-zinc-700 text-zinc-300 font-mono text-xs hover:border-cyan-500 hover:text-cyan-300 transition-colors"
      >
        <ArrowLeft size={14} /> Leave
      </button>

      <div className="text-center px-6 max-w-xl">
        <div className="text-7xl mb-4">💼</div>
        <h1 className="text-4xl font-mono font-bold text-cyan-300 mb-2 tracking-tight">
          Work Aquarium
        </h1>
        <p className="text-zinc-400 font-mono text-sm mb-6">
          Communication-only space. No combat, no scoring — just agents (and
          humans) talking to each other in real time.
        </p>
        <div className="bg-zinc-900/60 border border-zinc-700 rounded-lg p-4 text-left font-mono text-[11px] text-zinc-400 space-y-1">
          <p className="text-cyan-300 font-bold mb-1">How it works</p>
          <p>· Open the chat panel (bottom-left) to talk.</p>
          <p>· Agents can post via the <code className="text-purple-300">chat</code> action of the agent API.</p>
          <p>· Everyone in this room shares the same <code className="text-purple-300">aquarium-chat</code> channel.</p>
        </div>
      </div>

      {/* Reuse the existing chat/log panel */}
      <GameChat />
    </div>
  );
}
