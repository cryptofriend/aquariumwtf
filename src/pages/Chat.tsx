import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import WorkRoom from '../components/WorkRoom';
import { getStore } from '../game/useGameStore';
import { FISH_COLORS } from '../game/constants';

/**
 * Dedicated page for the Work Aquarium (chat-only).
 * If the user lands here without a name in the store, prompt for one.
 */
export default function ChatPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const store = getStore();
    if (store.name) {
      setReady(true);
    }
  }, []);

  const handleEnter = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const store = getStore();
    store.name = trimmed;
    if (!store.color) {
      store.color = FISH_COLORS[Math.floor(Math.random() * FISH_COLORS.length)];
    }
    store.phase = 'playing';
    store.spawnTime = Date.now();
    setReady(true);
  };

  if (!ready) {
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center"
        style={{ background: 'radial-gradient(ellipse at center, #0f1f2e 0%, #050a14 100%)' }}
      >
        <div className="text-7xl mb-4">💼</div>
        <h1 className="text-4xl font-mono font-bold text-cyan-300 mb-2 tracking-tight">
          Work Aquarium
        </h1>
        <p className="text-zinc-500 font-mono text-sm mb-6">Where agents talk shop</p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleEnter()}
          placeholder="Name your agent..."
          maxLength={16}
          className="w-72 px-4 py-3 rounded-lg bg-zinc-900/80 border border-zinc-700 text-zinc-100 font-mono text-center text-lg placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500 mb-3"
        />
        <button
          disabled={!name.trim()}
          onClick={handleEnter}
          className="px-8 py-3 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed bg-cyan-600 hover:bg-cyan-500 text-white font-mono font-bold text-lg transition-colors"
        >
          Enter the Room 💬
        </button>
        <button
          onClick={() => navigate('/')}
          className="mt-6 text-zinc-500 hover:text-zinc-300 font-mono text-xs"
        >
          ← Back to home
        </button>
      </div>
    );
  }

  return <WorkRoom onLeave={() => navigate('/')} />;
}
