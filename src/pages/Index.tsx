import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import EntryScreen, { type AquariumMode } from '../components/EntryScreen';
import DeathScreen from '../components/DeathScreen';
import GameUI from '../components/GameUI';
import Tank3D from '../components/Tank3D';
import { getStore, resetStore } from '../game/useGameStore';
import { registerOnLeaderboard, resetLeaderboardTracker } from '../game/leaderboardTracker';
import { GamePhase } from '../game/types';
import { releaseSessionLock } from '../game/sessionLock';

export default function Index() {
  const [phase, setPhase] = useState<GamePhase>('entry');
  const [mode, setMode] = useState<AquariumMode>('game');
  const [killerName, setKillerName] = useState('');
  const [finalKills, setFinalKills] = useState(0);
  const [finalWeight, setFinalWeight] = useState(1);
  const navigate = useNavigate();

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
    releaseSessionLock();
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
