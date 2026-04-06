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
}

const MAX_MESSAGES = 50;

export default function GameChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    const channel = supabase.channel('aquarium-chat');
    channelRef.current = channel;

    channel
      .on('broadcast', { event: 'chat' }, ({ payload }) => {
        const msg = payload as ChatMessage;
        setMessages(prev => [...prev.slice(-(MAX_MESSAGES - 1)), msg]);
        setUnread(prev => prev + 1);
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
      id: `${uid}-${Date.now()}`,
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

    // Add own message locally
    setMessages(prev => [...prev.slice(-(MAX_MESSAGES - 1)), msg]);
    setInput('');
  }, [input]);

  if (!open) {
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

  return (
    <div className="fixed bottom-20 left-4 z-50 pointer-events-auto w-72 font-mono">
      <div className="bg-black/80 backdrop-blur-md border border-zinc-700 rounded-lg overflow-hidden flex flex-col" style={{ height: 320 }}>
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700/50">
          <span className="text-purple-400 text-xs font-bold uppercase tracking-wider">💬 Chat</span>
          <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-300">
            <X size={14} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 scrollbar-thin">
          {messages.length === 0 && (
            <div className="text-zinc-600 text-[11px] text-center mt-8">No messages yet. Say hi! 🐟</div>
          )}
          {messages.map(msg => (
            <div key={msg.id} className="text-[11px] leading-tight">
              <span className="font-bold" style={{ color: msg.color }}>{msg.sender}: </span>
              <span className="text-zinc-300">{msg.text}</span>
            </div>
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
