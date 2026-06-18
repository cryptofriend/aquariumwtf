import { useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import GameChat from './GameChat';

/**
 * Bottom-left chat panel. (The Ranks tab was removed — live payouts now live
 * in the Survivors panel, and the post-event payout board is the end overlay.)
 */
export default function ChatLeaderboardPanel() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="fixed bottom-20 left-4 z-50 pointer-events-auto">
        <button
          onClick={() => setOpen(true)}
          className="bg-black/60 backdrop-blur-sm border border-zinc-700 rounded-lg p-2.5 hover:bg-black/80 transition-colors"
          title="Chat & Log"
        >
          <MessageCircle size={20} className="text-zinc-300" />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-20 left-4 z-50 pointer-events-auto w-80 font-mono">
      <div className="bg-black/85 backdrop-blur-md border border-zinc-700 rounded-lg overflow-hidden flex flex-col" style={{ height: 440 }}>
        <div className="flex items-center border-b border-zinc-700/60 bg-zinc-950/60">
          <div className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-bold uppercase tracking-wider text-cyan-300">
            <MessageCircle size={12} /> Chat &amp; Log
          </div>
          <button
            onClick={() => setOpen(false)}
            className="px-3 py-2 text-zinc-500 hover:text-zinc-200 transition-colors"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <GameChat embedded fillParent />
        </div>
      </div>
    </div>
  );
}
