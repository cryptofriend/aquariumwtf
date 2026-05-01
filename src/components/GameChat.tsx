import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getStore } from '../game/useGameStore';
import { uid } from '../game/constants';
import { MessageCircle, Send, X } from 'lucide-react';

interface ChatMessage {
  id: string;
  sender: string;
  color: string;
  text: string;
  timestamp: number;
  system?: boolean;
}

// How many historical rows to load on mount. The aquarium chat is meant to
// be a permanent log — bump high. (Realtime keeps adding new ones live.)
const HISTORY_LIMIT = 1000;

interface Props {
  /** When true, render inline (always open, full width of parent, no floating button). */
  embedded?: boolean;
  /** When true, fill 100% of the parent's height instead of a fixed height. */
  fillParent?: boolean;
  /** Logical chat room. 'game' = aquarium combat chat, 'work' = work room chat. */
  room?: 'game' | 'work';
}

export default function GameChat({ embedded = false, fillParent = false, room = 'game' }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(embedded);
  const [unread, setUnread] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Backfill the FULL chat & activity history on mount so nothing is lost
  // between sessions. Late joiners see the entire conversation.
  useEffect(() => {
    let cancelled = false;
    supabase
      .from('chat_messages')
      .select('id, sender, color, text, created_at, system')
      .eq('room', room)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT)
      .then(({ data }) => {
        if (cancelled || !data) return;
        const history: ChatMessage[] = data.reverse().map((m: any) => ({
          id: m.id,
          sender: m.sender,
          color: m.color,
          text: m.text,
          timestamp: new Date(m.created_at).getTime(),
          system: !!m.system,
        }));
        setMessages((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          return [...history.filter((h) => !seen.has(h.id)), ...prev];
        });
      });
    return () => { cancelled = true; };
  }, [room]);

  useEffect(() => {
    const channel = supabase.channel('aquarium-chat');
    channelRef.current = channel;

    channel
      .on('broadcast', { event: 'chat' }, ({ payload }) => {
        const msg = payload as ChatMessage;
        setMessages(prev => {
          if (prev.some((p) => p.id === msg.id)) return prev;
          return [...prev, msg];
        });
        if (!msg.system) setUnread(prev => prev + 1);
      })
      .on('broadcast', { event: 'activity' }, ({ payload }) => {
        const msg = payload as ChatMessage;
        setMessages(prev => {
          if (prev.some((p) => p.id === msg.id)) return prev;
          return [...prev, { ...msg, system: true }];
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setUnread(0);
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [open, messages.length]);

  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text || !channelRef.current) return;

    const store = getStore();
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      sender: store.name || 'Anonymous',
      color: store.color,
      text: text.slice(0, 200),
      timestamp: Date.now(),
    };

    channelRef.current.send({
      type: 'broadcast',
      event: 'chat',
      payload: msg,
    });

    // Persist so agents can read it via the `listen` endpoint and the
    // history survives reloads. Use the same id we broadcast for dedupe.
    supabase.from('chat_messages').insert({
      id: msg.id,
      room: 'game',
      sender: msg.sender,
      color: msg.color,
      text: msg.text,
    } as any).then(() => {});

    setMessages(prev => [...prev, msg]);
    setInput('');
  }, [input]);

  if (!embedded && !open) {
    return (
      <button
        onClick={() => { setOpen(true); setUnread(0); }}
        className="fixed bottom-20 left-4 z-50 pointer-events-auto bg-black/60 backdrop-blur-sm border border-zinc-700 rounded-lg p-2.5 hover:bg-black/80 transition-colors"
      >
        <MessageCircle size={20} className="text-zinc-300" />
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
    );
  }

  const wrapperClass = fillParent
    ? 'h-full w-full font-mono'
    : embedded
      ? 'w-full font-mono'
      : 'fixed bottom-20 left-4 z-50 pointer-events-auto w-72 font-mono';
  const panelStyle: React.CSSProperties = fillParent
    ? { height: '100%' }
    : embedded
      ? { height: 480 }
      : { height: 360 };

  return (
    <div className={wrapperClass}>
      <div
        className={`bg-black/80 backdrop-blur-md ${fillParent ? '' : 'border border-zinc-700 rounded-lg'} overflow-hidden flex flex-col`}
        style={panelStyle}
      >
        {/* Header (hidden in fillParent mode — parent provides its own tab header) */}
        {!fillParent && (
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700/50">
            <span className="text-cyan-300 text-xs font-bold uppercase tracking-wider">💬 Chat & Log</span>
            {!embedded && (
              <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-300">
                <X size={14} />
              </button>
            )}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1 scrollbar-thin">
          {messages.length === 0 && (
            <div className="text-zinc-600 text-[11px] text-center mt-8">No messages yet. Say hi! 🐟</div>
          )}
          {messages.map(msg => (
            msg.system ? (
              <div key={msg.id} className="text-[10px] leading-tight text-zinc-500 italic pl-1 border-l border-zinc-700/50">
                {msg.text}
              </div>
            ) : (
              <div key={msg.id} className="text-[11px] leading-tight">
                <span className="font-bold" style={{ color: msg.color }}>{msg.sender}: </span>
                <span className="text-zinc-300">{msg.text}</span>
              </div>
            )
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <form
          onSubmit={e => { e.preventDefault(); sendMessage(); }}
          className="flex items-center gap-1.5 px-2 py-2 border-t border-zinc-700/50"
        >
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Type a message..."
            maxLength={200}
            className="flex-1 bg-zinc-800/80 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-purple-500/50"
            autoFocus
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="text-purple-400 hover:text-purple-300 disabled:text-zinc-600 disabled:cursor-not-allowed p-1"
          >
            <Send size={14} />
          </button>
        </form>
      </div>
    </div>
  );
}
