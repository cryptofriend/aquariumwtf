import { useRef, useMemo, useEffect, useCallback, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import { getStore } from '../game/useGameStore';
import { supabase } from '@/integrations/supabase/client';
import {
  TANK_HALF, DAMPING, MAX_SPEED, MOUSE_LERP, BITE_RANGE,
  BITE_COOLDOWN_MS, BROADCAST_MS, FOOD_SPAWN_MS, REMOTE_LERP,
  DEATH_DELAY_MS, uid, INITIAL_WEIGHT, FOOD_WEIGHT
} from '../game/constants';
import { FoodOrb, PlayerState } from '../game/types';
import { addFoodIfMissing, createRandomFoodOrb, getSharedKelpPositions, removeFoodById, replaceFoods } from '../game/sharedWorld';
import { joystickState } from './VirtualJoystick';
import { toast } from 'sonner';

const tmpVec = new THREE.Vector3();
const PROXIMITY_RANGE = 10;
export const biteRequest = { pending: false };

interface EatingOrb {
  id: string;
  x: number; y: number; z: number;
  startTime: number;
  duration: number;
}

interface PlayerBroadcastState extends PlayerState {
  id: string;
}

interface WorldSyncRequestPayload { requesterId: string }
interface WorldSyncResponsePayload { targetId: string; foods: FoodOrb[] }
interface FoodSpawnPayload { food: FoodOrb }
interface FoodEatenPayload { foodId: string }

// Scale: logarithmic so 1kg=small, 10kg=medium, 100kg=large
function weightToScale(weight: number): number {
  return 0.6 + Math.log2(Math.max(1, weight)) * 0.25;
}

function FishMesh({ color, opacity = 1, weight = INITIAL_WEIGHT }: { color: string; opacity?: number; weight?: number }) {
  const scale = weightToScale(weight);
  return (
    <group scale={[scale, scale, scale]}>
      <mesh scale={[1.2, 0.7, 0.6]}>
        <sphereGeometry args={[1, 12, 8]} />
        <meshStandardMaterial color={color} transparent opacity={opacity} />
      </mesh>
      <mesh position={[-1.3, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[0.6, 1, 4]} />
        <meshStandardMaterial color={color} transparent opacity={opacity} />
      </mesh>
      <mesh position={[0.1, 0.7, 0]} rotation={[0, 0, -0.3]} scale={[0.6, 0.5, 0.1]}>
        <coneGeometry args={[0.5, 1, 3]} />
        <meshStandardMaterial color={color} transparent opacity={opacity} />
      </mesh>
      <mesh position={[0.8, 0.2, 0.45]}>
        <sphereGeometry args={[0.15, 8, 8]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0.9, 0.22, 0.52]}>
        <sphereGeometry args={[0.07, 6, 6]} />
        <meshStandardMaterial color="#111111" />
      </mesh>
    </group>
  );
}

function WeightBar({ weight }: { weight: number }) {
  const pct = Math.min(1, weight / Math.max(weight, 10));
  return (
    <group position={[0, 1.8, 0]}>
      <mesh>
        <planeGeometry args={[2, 0.2]} />
        <meshBasicMaterial color="#333" />
      </mesh>
      <mesh position={[(pct - 1), 0, 0.01]} scale={[pct, 1, 1]}>
        <planeGeometry args={[2, 0.2]} />
        <meshBasicMaterial color="#eab308" />
      </mesh>
    </group>
  );
}

function Kelp({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Mesh>(null!);
  const offset = useMemo(() => Math.random() * Math.PI * 2, []);
  const height = useMemo(() => 2 + Math.random() * 3, []);
  const color = useMemo(() => {
    const colors = ['#1a5c2a', '#0d4a22', '#2d7a3e', '#164c28'];
    return colors[Math.floor(Math.random() * colors.length)];
  }, []);

  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.x = Math.sin(clock.elapsedTime * 0.8 + offset) * 0.15;
      ref.current.rotation.z = Math.sin(clock.elapsedTime * 0.6 + offset + 1) * 0.1;
    }
  });

  return (
    <mesh ref={ref} position={[position[0], -TANK_HALF.y + height / 2, position[2]]}>
      <cylinderGeometry args={[0.15, 0.3, height, 6]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

function Bubbles() {
  const count = 40;
  const ref = useRef<THREE.InstancedMesh>(null!);
  const offsets = useMemo(() =>
    Array.from({ length: count }, () => ({
      x: (Math.random() - 0.5) * TANK_HALF.x * 1.8,
      z: (Math.random() - 0.5) * TANK_HALF.z * 1.8,
      speed: 0.5 + Math.random() * 1.5,
      phase: Math.random() * TANK_HALF.y * 2,
    })), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(({ clock }) => {
    offsets.forEach((b, i) => {
      const y = ((clock.elapsedTime * b.speed + b.phase) % (TANK_HALF.y * 2)) - TANK_HALF.y;
      dummy.position.set(b.x, y, b.z);
      dummy.scale.setScalar(0.05 + Math.random() * 0.08);
      dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshStandardMaterial color="#88ccff" transparent opacity={0.4} />
    </instancedMesh>
  );
}

function DistanceLabel({ targetPos, distance }: { targetPos: THREE.Vector3; distance: number }) {
  const ref = useRef<THREE.Group>(null!);
  const store = getStore();

  useFrame(() => {
    if (!ref.current) return;
    ref.current.position.lerpVectors(store.position, targetPos, 0.5);
    ref.current.position.y += 1.5;
  });

  const color = distance < BITE_RANGE ? '#ff4444' : distance < 5 ? '#ffaa00' : '#88ccff';

  return (
    <group ref={ref}>
      <Text fontSize={0.4} color={color} anchorX="center" anchorY="middle" font={undefined}>
        {distance.toFixed(1)}m
      </Text>
    </group>
  );
}

function EatingFoodOrb({ orb, onComplete }: { orb: EatingOrb; onComplete: () => void }) {
  const ref = useRef<THREE.Group>(null!);
  const completed = useRef(false);

  useFrame(() => {
    if (!ref.current || completed.current) return;
    const store = getStore();
    const elapsed = Date.now() - orb.startTime;
    const progress = Math.min(elapsed / orb.duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    ref.current.scale.setScalar(1 - ease * 0.9);
    tmpVec.set(orb.x, orb.y, orb.z);
    ref.current.position.lerpVectors(tmpVec, store.position, ease);
    ref.current.rotation.y += 0.3;
    if (progress >= 1 && !completed.current) {
      completed.current = true;
      onComplete();
    }
  });

  return (
    <group ref={ref} position={[orb.x, orb.y, orb.z]}>
      <pointLight color="#22ff44" intensity={3} distance={4} />
      <mesh>
        <sphereGeometry args={[0.4, 8, 8]} />
        <meshStandardMaterial color="#44ff44" emissive="#22ff00" emissiveIntensity={1.2} />
      </mesh>
    </group>
  );
}

function FoodOrbs() {
  const ref = useRef<THREE.Group>(null!);

  useFrame(({ clock }) => {
    const store = getStore();
    if (!ref.current) return;
    ref.current.children.forEach((child, i) => {
      const f = store.food[i];
      if (!f) return;
      child.position.set(f.x, f.y + Math.sin(clock.elapsedTime * 1.5 + i) * 0.5, f.z);
      child.rotation.y = clock.elapsedTime + i;
    });
  });

  const store = getStore();

  return (
    <group ref={ref}>
      {store.food.map((f) => (
        <group key={f.id} position={[f.x, f.y, f.z]}>
          <pointLight color="#ffdd00" intensity={2} distance={5} />
          <mesh>
            <sphereGeometry args={[0.4, 8, 8]} />
            <meshStandardMaterial color="#ffdd00" emissive="#ffaa00" emissiveIntensity={0.8} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export default function TankScene({ spectate }: { spectate?: boolean }) {
  const { camera } = useThree();
  const playerRef = useRef<THREE.Group>(null!);
  const keys = useRef<Set<string>>(new Set());
  const mouseWorld = useRef(new THREE.Vector3());
  const lastBroadcast = useRef(0);
  const lastFoodSpawn = useRef(0);
  const channelRef = useRef<any>(null);

  const deathTimeout = useRef<number | null>(null);
  const [eatingOrbs, setEatingOrbs] = useState<EatingOrb[]>([]);
  const [proximities, setProximities] = useState<{ id: string; pos: THREE.Vector3; dist: number }[]>([]);
  const [, setSceneVersion] = useState(0);
  const proximityRef = useRef<{ id: string; pos: THREE.Vector3; dist: number }[]>([]);
  const lastProximityUpdate = useRef(0);
  const isWorldHostRef = useRef(false);
  const seenBitesRef = useRef<Map<string, number>>(new Map());

  const bumpScene = useCallback(() => setSceneVersion(v => v + 1), []);

  const roundWeight = useCallback((value: number) => {
    return Math.round(Math.max(0, value) * 100) / 100;
  }, []);

  const rememberBite = useCallback((biteId: string) => {
    const now = Date.now();
    const seen = seenBitesRef.current;
    seen.set(biteId, now);

    const cutoff = now - 15000;
    for (const [id, timestamp] of seen) {
      if (timestamp < cutoff) seen.delete(id);
    }
  }, []);

  const upsertRemote = useCallback((id: string, p: PlayerState) => {
    getStore().remotePlayers.set(id, p);
    bumpScene();
  }, [bumpScene]);

  const addFood = useCallback((food: FoodOrb) => {
    const added = addFoodIfMissing(getStore().food, food);
    if (added) bumpScene();
    return added;
  }, [bumpScene]);

  const replaceFood = useCallback((foods: FoodOrb[]) => {
    replaceFoods(getStore().food, foods);
    bumpScene();
  }, [bumpScene]);

  const consumeFood = useCallback((foodId: string) => {
    const removed = removeFoodById(getStore().food, foodId);
    if (removed) bumpScene();
    return removed;
  }, [bumpScene]);

  const broadcastState = useCallback(() => {
    const store = getStore();
    if (!channelRef.current) return;
    void channelRef.current.send({
      type: 'broadcast',
      event: 'player-state',
      payload: {
        id: uid,
        name: store.name,
        color: store.color,
        x: store.position.x,
        y: store.position.y,
        z: store.position.z,
        weight: store.weight,
        kills: store.kills,
        dead: store.dead,
      } satisfies PlayerBroadcastState,
    });
  }, []);

  const applyIncomingBite = useCallback((payload: { biteId?: string; targetId?: string; attackerName?: string; damage?: number } | null | undefined, requireTargetId = false) => {
    const store = getStore();
    if (!payload?.biteId) return;
    if (requireTargetId && payload.targetId !== uid) return;
    if (seenBitesRef.current.has(payload.biteId) || store.dead) return;

    rememberBite(payload.biteId);

    const biteAmount = Math.max(0.1, Number(payload.damage) || 0.1);
    store.weight = roundWeight(store.weight - biteAmount);
    store.flashUntil = Date.now() + 300;
    toast.error(`Bitten by ${payload.attackerName || 'Unknown'}! -${biteAmount.toFixed(1)}kg`);

    if (store.weight <= 0 && !store.dead) {
      store.dead = true;
      store.killerName = payload.attackerName || 'Unknown';
      const survivalSecs = store.spawnTime > 0 ? Math.floor((Date.now() - store.spawnTime) / 1000) : 0;
      supabase.from('leaderboard').insert({
        player_name: store.name,
        survival_seconds: survivalSecs,
        kills: store.kills,
        weight: store.maxWeight,
      } as any).then(({ error }) => {
        if (error) console.error('[Aquarium] Failed to save score:', error);
      });
      deathTimeout.current = window.setTimeout(() => { store.phase = 'dead'; }, DEATH_DELAY_MS);
    }

    broadcastState();
  }, [broadcastState, rememberBite, roundWeight]);

  const kelpPositions = useMemo<[number, number, number][]>(() => getSharedKelpPositions(), []);

  // Keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keys.current.add(e.key.toLowerCase());
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        biteRequest.pending = true;
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  // Mouse
  useEffect(() => {
    const onMove = (cx: number, cy: number) => {
      const ndc = new THREE.Vector2((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const target = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, target);
      if (target) mouseWorld.current.copy(target);
    };
    const mh = (e: MouseEvent) => onMove(e.clientX, e.clientY);
    const th = (e: TouchEvent) => { if (e.touches.length > 0) onMove(e.touches[0].clientX, e.touches[0].clientY); };
    window.addEventListener('mousemove', mh);
    window.addEventListener('touchmove', th);
    return () => { window.removeEventListener('mousemove', mh); window.removeEventListener('touchmove', th); };
  }, [camera]);

  // Realtime channels
  useEffect(() => {
    const store = getStore();
    const channel = supabase.channel('aquarium-live', {
      config: { presence: { key: uid }, broadcast: { self: true, ack: true } },
    });

    const resolveHost = () => {
      const state = channel.presenceState();
      const ids = Array.from(new Set([uid, ...Object.keys(state)])).sort();
      isWorldHostRef.current = ids[0] === uid;
    };

    const parsePlayer = (p: any): PlayerState => ({
      name: p.name || 'Unknown fish',
      color: p.color || '#70a1ff',
      x: p.x ?? 0,
      y: p.y ?? 0,
      z: p.z ?? 0,
      weight: p.weight ?? INITIAL_WEIGHT,
      kills: p.kills ?? 0,
      dead: Boolean(p.dead),
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const currentIds = new Set<string>();
        Object.entries(state).forEach(([key, presences]) => {
          if (key === uid) return;
          currentIds.add(key);
          const p = (presences as any[])?.[0];
          if (p) store.remotePlayers.set(key, parsePlayer(p));
        });
        store.remotePlayers.forEach((_, key) => {
          if (!currentIds.has(key)) store.remotePlayers.delete(key);
        });
        resolveHost();
        bumpScene();
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        if (key === uid) return;
        const p = (newPresences as any[])?.[0];
        if (p) upsertRemote(key, parsePlayer(p));
        resolveHost();
        toast(`🐟 ${p?.name || 'Unknown fish'} joined!`, { duration: 3000 });
      })
      .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
        const p = (leftPresences as any[])?.[0];
        store.remotePlayers.delete(key);
        resolveHost();
        bumpScene();
        toast(`💨 ${p?.name || 'A fish'} left`, { duration: 3000 });
      })
      .on('broadcast', { event: 'player-state' }, ({ payload }) => {
        const p = payload as PlayerBroadcastState;
        if (!p || p.id === uid) return;
        upsertRemote(p.id, parsePlayer(p));
      })
      .on('broadcast', { event: 'world-sync-request' }, ({ payload }) => {
        const req = payload as WorldSyncRequestPayload;
        if (!req?.requesterId || req.requesterId === uid || !isWorldHostRef.current) return;
        void channel.send({
          type: 'broadcast',
          event: 'world-sync-response',
          payload: { targetId: req.requesterId, foods: getStore().food } satisfies WorldSyncResponsePayload,
        });
      })
      .on('broadcast', { event: 'world-sync-response' }, ({ payload }) => {
        const res = payload as WorldSyncResponsePayload;
        if (res?.targetId !== uid || !Array.isArray(res.foods)) return;
        replaceFood(res.foods);
      })
      .on('broadcast', { event: 'food-spawned' }, ({ payload }) => {
        const e = payload as FoodSpawnPayload;
        if (e?.food) addFood(e.food);
      })
      .on('broadcast', { event: 'food-eaten' }, ({ payload }) => {
        const e = payload as FoodEatenPayload;
        if (e?.foodId) consumeFood(e.foodId);
      })
      .on('broadcast', { event: 'bite' }, ({ payload }) => {
        console.log('[Aquarium] Bite event received:', JSON.stringify(payload), 'myUid:', uid);
        applyIncomingBite(payload as { biteId?: string; targetId?: string; attackerName?: string; damage?: number }, true);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            name: store.name,
            color: store.color,
            x: store.position.x,
            y: store.position.y,
            z: store.position.z,
            weight: store.weight,
            kills: store.kills,
            dead: store.dead,
          });
          resolveHost();
          broadcastState();
          void channel.send({
            type: 'broadcast',
            event: 'world-sync-request',
            payload: { requesterId: uid } satisfies WorldSyncRequestPayload,
          });
        }
      });

    channelRef.current = channel;

    // Per-player bite channel (redundant receiver for reliability)
    const biteChannel = supabase.channel(`bites-${uid}`);
    biteChannel
      .on('broadcast', { event: 'bite' }, ({ payload }) => {
        console.log('[Aquarium] Bite received on personal channel:', JSON.stringify(payload));
        applyIncomingBite(payload as { biteId?: string; targetId?: string; attackerName?: string; damage?: number });
      })
      .subscribe();

    const handleBeforeUnload = () => {
      if (!store.dead && store.spawnTime > 0 && store.name) {
        const survivalSecs = Math.floor((Date.now() - store.spawnTime) / 1000);
        navigator.sendBeacon(
          `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/leaderboard`,
          new Blob([JSON.stringify({
            player_name: store.name,
            survival_seconds: survivalSecs,
            kills: store.kills,
            weight: store.maxWeight,
          })], { type: 'application/json' })
        );
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      channel.unsubscribe();
      biteChannel.unsubscribe();
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (deathTimeout.current) clearTimeout(deathTimeout.current);
    };
  }, [addFood, applyIncomingBite, broadcastState, bumpScene, consumeFood, replaceFood, upsertRemote]);

  // Game loop
  useFrame((_, delta) => {
    const store = getStore();
    const now = Date.now();

    if (!spectate && !store.dead) {
      const accel = new THREE.Vector3();
      const k = keys.current;
      if (k.has('w') || k.has('arrowup')) accel.z -= 1;
      if (k.has('s') || k.has('arrowdown')) accel.z += 1;
      if (k.has('a') || k.has('arrowleft')) accel.x -= 1;
      if (k.has('d') || k.has('arrowright')) accel.x += 1;
      if (k.has('q')) accel.y += 1;
      if (k.has('e')) accel.y -= 1;

      if (Math.abs(joystickState.x) > 0.1 || Math.abs(joystickState.y) > 0.1) {
        accel.x += joystickState.x;
        accel.z += joystickState.y;
      }
      if (joystickState.upDown !== 0) accel.y += joystickState.upDown;

      if (accel.lengthSq() > 0) {
        accel.normalize().multiplyScalar(0.8);
        store.velocity.add(accel);
      }

      tmpVec.copy(mouseWorld.current).sub(store.position);
      if (tmpVec.length() > 1) {
        tmpVec.normalize().multiplyScalar(MOUSE_LERP * tmpVec.length());
        store.velocity.add(tmpVec);
      }

      store.velocity.multiplyScalar(DAMPING);
      if (store.velocity.length() > MAX_SPEED) store.velocity.normalize().multiplyScalar(MAX_SPEED);
      store.position.add(tmpVec.copy(store.velocity).multiplyScalar(delta));
      store.position.x = THREE.MathUtils.clamp(store.position.x, -TANK_HALF.x, TANK_HALF.x);
      store.position.y = THREE.MathUtils.clamp(store.position.y, -TANK_HALF.y, TANK_HALF.y);
      store.position.z = THREE.MathUtils.clamp(store.position.z, -TANK_HALF.z, TANK_HALF.z);

      if (playerRef.current) {
        playerRef.current.position.copy(store.position);
        if (store.velocity.lengthSq() > 0.01) {
          playerRef.current.lookAt(tmpVec.copy(store.position).add(store.velocity));
        }
      }

      // Manual bite: space key or UI button
      if (biteRequest.pending && now - store.lastBiteTime > BITE_COOLDOWN_MS) {
        biteRequest.pending = false;
        let nearest: { key: string; dist: number; name: string } | null = null;
        store.remotePlayers.forEach((p, key) => {
          if (p.dead) return;
          const dist = store.position.distanceTo(tmpVec.set(p.x, p.y, p.z));
          if (dist < BITE_RANGE && (!nearest || dist < nearest.dist)) {
            nearest = { key, dist, name: p.name };
          }
        });
        if (nearest) {
          store.lastBiteTime = now;
          const n = nearest as { key: string; dist: number; name: string };
          const victim = store.remotePlayers.get(n.key);
          const victimWeight = victim?.weight ?? 1;
          const rawBite = Math.max(0.1, store.weight * 0.1);
          const biteAmount = Math.min(rawBite, victimWeight);
          const biteId = crypto.randomUUID();
          const nextVictimWeight = roundWeight(victimWeight - biteAmount);

          console.log('[Aquarium] Sending bite to targetId:', n.key, 'damage:', biteAmount, 'victimWeight:', victimWeight, 'biteId:', biteId);

          if (victim) {
            upsertRemote(n.key, {
              ...victim,
              weight: nextVictimWeight,
              dead: victim.dead || nextVictimWeight <= 0,
            });
          }

          const bitePayload = { biteId, targetId: n.key, attackerName: store.name, damage: biteAmount };

          void channelRef.current?.send({
            type: 'broadcast',
            event: 'bite',
            payload: bitePayload,
          });

          void supabase.channel(`bites-${n.key}`).send({
            type: 'broadcast',
            event: 'bite',
            payload: bitePayload,
          });

          store.weight = roundWeight(store.weight + biteAmount);
          store.maxWeight = Math.max(store.maxWeight, store.weight);
          if (victim && !victim.dead && nextVictimWeight <= 0) store.kills++;
          broadcastState();
          toast(`🦷 Bit ${n.name}! (+${biteAmount.toFixed(1)}kg)`);
        } else {
          toast('No fish in range!', { duration: 1000 });
        }
      } else if (biteRequest.pending) {
        biteRequest.pending = false;
      }

      // Eat food: +1kg
      for (let i = store.food.length - 1; i >= 0; i--) {
        const f = store.food[i];
        const dist = store.position.distanceTo(tmpVec.set(f.x, f.y, f.z));
        if (dist < 2.2 && consumeFood(f.id)) {
          setEatingOrbs(prev => [...prev, { id: f.id, x: f.x, y: f.y, z: f.z, startTime: Date.now(), duration: 400 }]);
          store.weight = Math.round((store.weight + FOOD_WEIGHT) * 100) / 100;
          store.maxWeight = Math.max(store.maxWeight, store.weight);
          void channelRef.current?.send({
            type: 'broadcast',
            event: 'food-eaten',
            payload: { foodId: f.id } satisfies FoodEatenPayload,
          });
          toast.success(`+${FOOD_WEIGHT}kg 🌿`);
        }
      }

      // Proximity labels (throttled)
      if (now - lastProximityUpdate.current > 150) {
        lastProximityUpdate.current = now;
        const nearby: { id: string; pos: THREE.Vector3; dist: number }[] = [];
        store.remotePlayers.forEach((p, key) => {
          if (p.dead) return;
          const d = store.position.distanceTo(tmpVec.set(p.x, p.y, p.z));
          if (d < PROXIMITY_RANGE) nearby.push({ id: `fish-${key}`, pos: new THREE.Vector3(p.x, p.y, p.z), dist: d });
        });
        store.food.forEach((f) => {
          const d = store.position.distanceTo(tmpVec.set(f.x, f.y, f.z));
          if (d < PROXIMITY_RANGE) nearby.push({ id: `food-${f.id}`, pos: new THREE.Vector3(f.x, f.y, f.z), dist: d });
        });
        if (JSON.stringify(nearby.map(n => n.id)) !== JSON.stringify(proximityRef.current.map(n => n.id))
          || nearby.some((n, i) => Math.abs(n.dist - (proximityRef.current[i]?.dist ?? 0)) > 0.3)) {
          proximityRef.current = nearby;
          setProximities(nearby);
        }
      }

      // Broadcast
      if (now - lastBroadcast.current > BROADCAST_MS && channelRef.current) {
        lastBroadcast.current = now;
        broadcastState();
      }
    }

    // Host spawns food
    if (now - lastFoodSpawn.current > FOOD_SPAWN_MS && channelRef.current && isWorldHostRef.current) {
      lastFoodSpawn.current = now;
      const food = createRandomFoodOrb();
      if (addFood(food)) {
        void channelRef.current.send({
          type: 'broadcast',
          event: 'food-spawned',
          payload: { food } satisfies FoodSpawnPayload,
        });
      }
    }

    // Camera follow
    if (!spectate && playerRef.current) {
      const store = getStore();
      camera.position.lerp(tmpVec.copy(store.position).add(new THREE.Vector3(0, 8, 18)), 0.05);
      camera.lookAt(store.position);
    }

    // Flash effect
    const store2 = getStore();
    if (store2.flashUntil > now && playerRef.current) {
      playerRef.current.traverse(child => {
        if ((child as THREE.Mesh).isMesh) {
          const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
          if (mat.emissive) mat.emissive.set('#ff0000');
        }
      });
    } else if (playerRef.current) {
      playerRef.current.traverse(child => {
        if ((child as THREE.Mesh).isMesh) {
          const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
          if (mat.emissive) mat.emissive.set('#000000');
        }
      });
    }
  });

  const store = getStore();

  return (
    <>
      <ambientLight intensity={0.3} />
      <directionalLight position={[10, 15, 10]} intensity={0.5} />
      <pointLight position={[-TANK_HALF.x, 0, 0]} color="#ff4444" intensity={1.5} distance={50} />
      <pointLight position={[TANK_HALF.x, 0, 0]} color="#4444ff" intensity={1.5} distance={50} />
      <fog attach="fog" args={['#050510', 20, 80]} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -TANK_HALF.y, 0]}>
        <planeGeometry args={[TANK_HALF.x * 2, TANK_HALF.z * 2]} />
        <meshStandardMaterial color="#0a0a15" />
      </mesh>

      {[
        { pos: [0, 0, -TANK_HALF.z] as const, rot: [0, 0, 0] as const, size: [TANK_HALF.x * 2, TANK_HALF.y * 2] as const },
        { pos: [0, 0, TANK_HALF.z] as const, rot: [0, Math.PI, 0] as const, size: [TANK_HALF.x * 2, TANK_HALF.y * 2] as const },
        { pos: [-TANK_HALF.x, 0, 0] as const, rot: [0, Math.PI / 2, 0] as const, size: [TANK_HALF.z * 2, TANK_HALF.y * 2] as const },
        { pos: [TANK_HALF.x, 0, 0] as const, rot: [0, -Math.PI / 2, 0] as const, size: [TANK_HALF.z * 2, TANK_HALF.y * 2] as const },
      ].map((wall, i) => (
        <mesh key={i} position={wall.pos as any} rotation={wall.rot as any}>
          <planeGeometry args={wall.size as any} />
          <meshStandardMaterial color="#88aacc" transparent opacity={0.05} side={THREE.DoubleSide} />
        </mesh>
      ))}

      {kelpPositions.map((pos, i) => <Kelp key={i} position={pos} />)}
      <Bubbles />
      <FoodOrbs />

      {!spectate && (
        <group ref={playerRef} position={[store.position.x, store.position.y, store.position.z]}>
          <FishMesh color={store.color} weight={store.weight} />
          <WeightBar weight={store.weight} />
          <Text position={[0, 2.3, 0]} fontSize={0.5} color="#ffffff" anchorX="center" anchorY="middle" font={undefined}>
            {store.name} ({store.weight.toFixed(1)}kg)
          </Text>
        </group>
      )}

      {Array.from(store.remotePlayers.entries()).map(([key, p]) => (
        <RemoteFish key={key} player={p} />
      ))}

      {!spectate && !store.dead && proximities.map((p) => (
        <DistanceLabel key={p.id} targetPos={p.pos} distance={p.dist} />
      ))}

      {eatingOrbs.map((orb) => (
        <EatingFoodOrb key={orb.id} orb={orb} onComplete={() => setEatingOrbs(prev => prev.filter(o => o.id !== orb.id))} />
      ))}
    </>
  );
}

function RemoteFish({ player }: { player: PlayerState }) {
  const ref = useRef<THREE.Group>(null!);

  useFrame(() => {
    if (!ref.current) return;
    const target = tmpVec.set(player.x, player.y, player.z);
    ref.current.position.lerp(target, REMOTE_LERP);
    if (target.distanceTo(ref.current.position) > 0.1) ref.current.lookAt(target);
  });

  return (
    <group ref={ref} position={[player.x, player.y, player.z]}>
      <FishMesh color={player.dead ? '#666666' : player.color} opacity={player.dead ? 0.45 : 1} weight={player.weight} />
      {!player.dead && <WeightBar weight={player.weight} />}
      <Text position={[0, 2.3, 0]} fontSize={0.5} color={player.dead ? '#666666' : '#ffffff'} anchorX="center" anchorY="middle" font={undefined}>
        {player.name} ({player.weight.toFixed(1)}kg)
      </Text>
    </group>
  );
}
