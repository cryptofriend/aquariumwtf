import { useEffect, useState } from 'react';
import EntryScreen from '../components/EntryScreen';
import GameUI from '../components/GameUI';
import Tank3D from '../components/Tank3D';
import { connect, disconnect, net, on } from '../net/gameClient';
import { releaseSessionLock } from '../game/sessionLock';

export default function Index() {
  const [joined, setJoined] = useState(false);

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
    if (s === 'closed' && !net.joined) setJoined(false);
  }), []);

  return (
    <>
      {!joined && <EntryScreen onJoined={() => setJoined(true)} />}
      {joined && (
        <>
          <Tank3D />
          <GameUI />
        </>
      )}
    </>
  );
}
