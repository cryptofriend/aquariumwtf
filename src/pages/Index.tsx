import { useEffect, useState } from 'react';
import EntryScreen from '../components/EntryScreen';
import GameUI from '../components/GameUI';
import Tank3D from '../components/Tank3D';
import { connect, disconnect, net, on } from '../net/gameClient';
import { releaseSessionLock } from '../game/sessionLock';

type Mode = 'entry' | 'playing' | 'spectating';

export default function Index() {
  const [mode, setMode] = useState<Mode>('entry');

  // Observer connection for the entry screen (live counts), cleaned up on unmount
  useEffect(() => {
    connect();
    return () => {
      disconnect();
      releaseSessionLock();
    };
  }, []);

  // If the server connection drops for good, fall back to the entry screen
  useEffect(() => on('status', (s) => {
    if (s === 'closed' && !net.joined) setMode((m) => (m === 'playing' ? 'entry' : m));
  }), []);

  return (
    <>
      {mode === 'entry' && (
        <EntryScreen
          onJoined={() => setMode('playing')}
          onSpectate={() => setMode('spectating')}
        />
      )}
      {mode !== 'entry' && (
        <>
          <Tank3D />
          <GameUI spectateOnly={mode === 'spectating'} onExit={() => setMode('entry')} />
        </>
      )}
    </>
  );
}
