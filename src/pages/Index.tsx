import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import EntryScreen, { type AquariumMode } from '../components/EntryScreen';
import DeathScreen from '../components/DeathScreen';
import GameUI from '../components/GameUI';
import Tank3D from '../components/Tank3D';
import { getStore, resetStore } from '../game/useGameStore';
import { registerOnLeaderboard, resetLeaderboardTracker } from '../game/leaderboardTracker';
import { GamePhase } from '../game/types';
import { FISH_COLORS } from '../game/constants';
import { acquireSessionLock, releaseSessionLock } from '../game/sessionLock';

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
  const [mode, setMode] = useState<AquariumMode>('game');
  const [killerName, setKillerName] = useState('');
  const [finalKills, setFinalKills] = useState(0);
  const [finalWeight, setFinalWeight] = useState(1);
  const portalHandled = useRef(false);
  const navigate = useNavigate();

  // Handle incoming portal users — skip entry screen (game mode only)
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
    store.isBot = false;
    acquireSessionLock(store.name);
    setMode('game');
    setPhase('playing');
    void registerOnLeaderboard();

    // Clean URL
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  const handleEnter = useCallback((name: string, selectedMode: AquariumMode) => {
    const store = getStore();
    store.name = name;
    if (selectedMode === 'work') {
      navigate('/chat');
      return;
    }
    store.phase = 'playing';
    store.spawnTime = Date.now();
    store.isBot = false;
    setMode(selectedMode);
    setPhase('playing');
    void registerOnLeaderboard();
  }, [navigate]);

  const handleSpectate = useCallback(() => {
    const store = getStore();
    store.spectate = true;
    store.phase = 'spectate';
    setPhase('spectate');
  }, []);

  const handlePlayAgain = useCallback(() => {
    resetStore();
    resetLeaderboardTracker();
    setPhase('entry');
  }, []);

  useEffect(() => {
    if (mode !== 'game') return;
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
  }, [phase, mode]);

  const inGame = mode === 'game';

  return (
    <>
      {phase === 'entry' && <EntryScreen onEnter={handleEnter} />}

      {inGame && (phase === 'playing' || phase === 'spectate' || phase === 'dead') && (
        <>
          <Tank3D spectate={phase === 'spectate'} />
          <GameUI phase={phase} />
        </>
      )}

      {inGame && phase === 'dead' && (
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