import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, Send, X } from 'lucide-react';
import { net, on, sendChat, ChatMessage } from '../net/gameClient';

interface Props {
  /** When true, render inline (always open, full width of parent, no floating button). */
  embedded?: boolean;
  /** When true, fill 100% of the parent's height instead of a fixed height. */
  fillParent?: boolean;
}

let seq = 0;

export default function GameChat({ embedded = false, fillParent = false }: Props) {
  const [messages, setMessages] = useState<(ChatMessage & { id: number })[]>([]);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(embedded);
  const [unread, setUnread] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  const push = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev.slice(-300), { ...msg, id: seq++ }]);
  }, []);

  // Live chat from the game server
  useEffect(() => on('chat', (msg) => {
    push(msg);
    if (msg.from !== net.selfName) setUnread((u) => u + 1);
  }), [push]);

  // Activity feed from game events
  useEffect(() => on('event', (e) => {
    const sys = (text: string) => push({ from: 'system', color: '#888', text, ts: Date.now(), system: true });
    switch (e.kind) {
      case 'join': sys(`🐟 ${e.name} joined the aquarium`); break;
      case 'leave': sys(`💨 ${e.name} left`); break;
      case 'kill': sys(`💀 ${e.attacker} killed ${e.victim}!`); break;
      case 'respawn': sys(`🪙 ${e.name} bought back in (+1 to the pot)`); break;
      case 'bite': sys(`🦷 ${e.attacker} bit ${e.victim} for ${e.damage.toFixed(1)}kg`); break;
      case 'round_start': sys('⚔️ Round started — eat or get eaten!'); break;
      case 'round_end': sys(e.winner ? `🏆 ${e.winner.name} won the round at ${e.winner.weight.toFixed(1)}kg and takes the pot (${e.pot}🪙)!` : '🏁 Round over'); break;
    }
  }), [push]);

  useEffect(() => {
    if (open) {
      setUnread(0);
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [open, messages.length]);

  const submit = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    sendChat(text.slice(0, 200));
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

        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1 scrollbar-thin">
          {messages.length === 0 && (
            <div className="text-zinc-600 text-[11px] text-center mt-8">No messages yet. Say hi! 🐟</div>
          )}
          {messages.map((msg) => (
            msg.system ? (
              <div key={msg.id} className="text-[10px] leading-tight text-zinc-500 italic pl-1 border-l border-zinc-700/50">
                {msg.text}
              </div>
            ) : (
              <div key={msg.id} className="text-[11px] leading-tight">
                <span className="font-bold" style={{ color: msg.color }}>{msg.from}: </span>
                <span className="text-zinc-300">{msg.text}</span>
              </div>
            )
          ))}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          className="flex items-center gap-1.5 px-2 py-2 border-t border-zinc-700/50"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            maxLength={200}
            className="flex-1 bg-zinc-800/80 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-purple-500/50"
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
