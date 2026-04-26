import { useState, useCallback, useEffect, useRef } from 'react';
import EntryScreen, { type AquariumMode } from '../components/EntryScreen';
import DeathScreen from '../components/DeathScreen';
import GameUI from '../components/GameUI';
import Tank3D from '../components/Tank3D';
import WorkRoom from '../components/WorkRoom';
import { getStore, resetStore } from '../game/useGameStore';
import { GamePhase } from '../game/types';
import { FISH_COLORS } from '../game/constants';

function getPortalParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('portal') !== 'true') return null;
  return {
    username: params.get('username') || `Fish_${Math.floor(Math.random() * 999)}`,
    color: params.get('color') || FISH_COLORS[Math.floor(Math.random() * FISH_COLORS.length)],
    ref: params.get('ref') || null,
    hp: params.get('hp'),
    speed: params.get('speed'),
  };
}

export default function Index() {
  const [phase, setPhase] = useState<GamePhase>('entry');
  const [killerName, setKillerName] = useState('');
  const [finalKills, setFinalKills] = useState(0);
  const [finalWeight, setFinalWeight] = useState(1);
  const portalHandled = useRef(false);

  // Handle incoming portal users — skip entry screen
  useEffect(() => {
    if (portalHandled.current) return;
    const portalParams = getPortalParams();
    if (!portalParams) return;
    portalHandled.current = true;

    const store = getStore();
    store.name = portalParams.username;
    store.color = portalParams.color;
    store.portalRef = portalParams.ref;
    if (portalParams.hp) {
      const hp = Math.min(100, Math.max(1, parseInt(portalParams.hp, 10) || 1));
      store.weight = hp;
      store.maxWeight = hp;
    }
    store.phase = 'playing';
    store.spawnTime = Date.now();
    setPhase('playing');

    // Clean URL
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

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
        setFinalWeight(store.maxWeight);
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
          <GameUI phase={phase} />
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