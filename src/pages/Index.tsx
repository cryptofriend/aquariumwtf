import { useState, useCallback, useEffect } from 'react';
import EntryScreen from '../components/EntryScreen';
import DeathScreen from '../components/DeathScreen';
import GameUI from '../components/GameUI';
import Tank3D from '../components/Tank3D';
import VirtualJoystick from '../components/VirtualJoystick';
import { getStore, resetStore } from '../game/useGameStore';
import { GamePhase } from '../game/types';
import { useIsMobile } from '../hooks/use-mobile';

export default function Index() {
  const [phase, setPhase] = useState<GamePhase>('entry');
  const [killerName, setKillerName] = useState('');
  const [finalKills, setFinalKills] = useState(0);
  const [finalWeight, setFinalWeight] = useState(1);

  const handleEnter = useCallback((name: string) => {
    const store = getStore();
    store.name = name;
    store.phase = 'playing';
    store.spawnTime = Date.now();
    setPhase('playing');
  }, []);

  const handleSpectate = useCallback(() => {
    const store = getStore();
    store.spectate = true;
    store.phase = 'spectate';
    setPhase('spectate');
  }, []);

  const handlePlayAgain = useCallback(() => {
    resetStore();
    setPhase('entry');
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const store = getStore();
      if (store.phase === 'dead' && phase !== 'dead') {
        setKillerName(store.killerName);
        setFinalKills(store.kills);
        setFinalWeight(store.weight);
        setPhase('dead');
      }
    }, 200);
    return () => clearInterval(id);
  }, [phase]);

  const isMobile = useIsMobile();

  return (
    <>
      {phase === 'entry' && <EntryScreen onEnter={handleEnter} />}
      {(phase === 'playing' || phase === 'spectate' || phase === 'dead') && (
        <>
          <Tank3D spectate={phase === 'spectate'} />
          <GameUI />
          {isMobile && phase === 'playing' && <VirtualJoystick />}
        </>
      )}
      {phase === 'dead' && (
        <DeathScreen
          killerName={killerName}
          kills={finalKills}
          weight={finalWeight}
          onSpectate={handleSpectate}
          onPlayAgain={handlePlayAgain}
        />
      )}
    </>
  );
}
