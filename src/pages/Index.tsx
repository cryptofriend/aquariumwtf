import { useState, useCallback, useEffect } from 'react';
import EntryScreen from '../components/EntryScreen';
import DeathScreen from '../components/DeathScreen';
import GameUI from '../components/GameUI';
import Tank3D from '../components/Tank3D';
import { getStore, resetStore } from '../game/useGameStore';
import { GamePhase } from '../game/types';

export default function Index() {
  const [phase, setPhase] = useState<GamePhase>('entry');
  const [killerName, setKillerName] = useState('');
  const [finalKills, setFinalKills] = useState(0);

  const handleEnter = useCallback((name: string) => {
    const store = getStore();
    store.name = name;
    store.phase = 'playing';
    setPhase('playing');
  }, []);

  const handleSpectate = useCallback(() => {
    const store = getStore();
    store.spectate = true;
    store.phase = 'spectate';
    setPhase('spectate');
  }, []);

  // Poll for death phase change from game loop
  useEffect(() => {
    const id = setInterval(() => {
      const store = getStore();
      if (store.phase === 'dead' && phase !== 'dead') {
        setKillerName(store.killerName);
        setFinalKills(store.kills);
        setPhase('dead');
      }
    }, 200);
    return () => clearInterval(id);
  }, [phase]);

  return (
    <>
      {phase === 'entry' && <EntryScreen onEnter={handleEnter} />}
      {(phase === 'playing' || phase === 'spectate' || phase === 'dead') && (
        <>
          <Tank3D spectate={phase === 'spectate'} />
          <GameUI />
        </>
      )}
      {phase === 'dead' && (
        <DeathScreen
          killerName={killerName}
          kills={finalKills}
          onSpectate={handleSpectate}
        />
      )}
    </>
  );
}
