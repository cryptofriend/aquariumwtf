import { useState } from 'react';
import { MessageCircle, Trophy, X } from 'lucide-react';
import GameChat from './GameChat';
import Leaderboard from './Leaderboard';

type Tab = 'chat' | 'leaderboard';

/**
 * Unified bottom-left panel that combines Chat and Leaderboard
 * behind a single tab switcher. Collapses to a small floating button.
 */
export default function ChatLeaderboardPanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('chat');

  if (!open) {
    return (
      <div className="fixed bottom-20 left-4 z-50 pointer-events-auto flex flex-col gap-2">
        <button
          onClick={() => { setTab('chat'); setOpen(true); }}
          className="bg-black/60 backdrop-blur-sm border border-zinc-700 rounded-lg p-2.5 hover:bg-black/80 transition-colors"
          title="Chat & Log"
        >
          <MessageCircle size={20} className="text-zinc-300" />
        </button>
        <button
          onClick={() => { setTab('leaderboard'); setOpen(true); }}
          className="bg-black/60 backdrop-blur-sm border border-zinc-700 rounded-lg p-2.5 hover:bg-black/80 transition-colors"
          title="Leaderboard"
        >
          <Trophy size={20} className="text-amber-400" />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-20 left-4 z-50 pointer-events-auto w-80 font-mono">
      <div className="bg-black/85 backdrop-blur-md border border-zinc-700 rounded-lg overflow-hidden flex flex-col" style={{ height: 440 }}>
        {/* Tab switcher header */}
        <div className="flex items-center border-b border-zinc-700/60 bg-zinc-950/60">
          <button
            onClick={() => setTab('chat')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-bold uppercase tracking-wider transition-colors ${
              tab === 'chat'
                ? 'text-cyan-300 bg-cyan-500/10 border-b-2 border-cyan-400'
                : 'text-zinc-500 hover:text-zinc-300 border-b-2 border-transparent'
            }`}
          >
            <MessageCircle size={12} /> Chat
          </button>
          <button
            onClick={() => setTab('leaderboard')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-bold uppercase tracking-wider transition-colors ${
              tab === 'leaderboard'
                ? 'text-amber-300 bg-amber-500/10 border-b-2 border-amber-400'
                : 'text-zinc-500 hover:text-zinc-300 border-b-2 border-transparent'
            }`}
          >
            <Trophy size={12} /> Ranks
          </button>
          <button
            onClick={() => setOpen(false)}
            className="px-3 py-2 text-zinc-500 hover:text-zinc-200 transition-colors"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {tab === 'chat' ? (
            <GameChat embedded fillParent />
          ) : (
            <div className="h-full overflow-y-auto p-2">
              <Leaderboard chrome={false} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
