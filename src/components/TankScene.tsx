import { useRef, useMemo, useEffect, useCallback, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import { getStore, spawnFood } from '../game/useGameStore';
import { supabase } from '@/integrations/supabase/client';
import {
  TANK_HALF, DAMPING, MAX_SPEED, MOUSE_LERP, BITE_RANGE,
  BITE_COOLDOWN_MS, BITE_DAMAGE, FOOD_HP, MAX_HP, BROADCAST_MS,
  FOOD_SPAWN_MS, REMOTE_LERP, DEATH_DELAY_MS, uid
} from '../game/constants';
import { PlayerState } from '../game/types';
import { toast } from 'sonner';

const tmpVec = new THREE.Vector3();
const PROXIMITY_RANGE = 10; // Show distance labels within this range

interface EatingOrb {
  id: string;
  x: number;
  y: number;
  z: number;
  startTime: number;
  duration: number;
}

// Fish mesh component
function FishMesh({ color, opacity = 1 }: { color: string; opacity?: number }) {
  return (
    <group>
      {/* Body */}
      <mesh scale={[1.2, 0.7, 0.6]}>
        <sphereGeometry args={[1, 12, 8]} />
        <meshStandardMaterial color={color} transparent opacity={opacity} />
      </mesh>
      {/* Tail */}
      <mesh position={[-1.3, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[0.6, 1, 4]} />
        <meshStandardMaterial color={color} transparent opacity={opacity} />
      </mesh>
      {/* Dorsal fin */}
      <mesh position={[0.1, 0.7, 0]} rotation={[0, 0, -0.3]} scale={[0.6, 0.5, 0.1]}>
        <coneGeometry args={[0.5, 1, 3]} />
        <meshStandardMaterial color={color} transparent opacity={opacity} />
      </mesh>
      {/* Eye */}
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

// HP bar above fish
function HPBar({ hp, maxHp }: { hp: number; maxHp: number }) {
  const pct = Math.max(0, hp / maxHp);
  const c = pct > 0.55 ? '#22c55e' : pct > 0.3 ? '#eab308' : '#ef4444';
  return (
    <group position={[0, 1.8, 0]}>
      <mesh>
        <planeGeometry args={[2, 0.2]} />
        <meshBasicMaterial color="#333" />
      </mesh>
      <mesh position={[(pct - 1), 0, 0.01]} scale={[pct, 1, 1]}>
        <planeGeometry args={[2, 0.2]} />
        <meshBasicMaterial color={c} />
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

function FoodOrbs() {
  const ref = useRef<THREE.Group>(null!);

  useFrame(({ clock }) => {
    const store = getStore();
    if (!ref.current) return;
    // Update positions
    ref.current.children.forEach((child, i) => {
      const f = store.food[i];
      if (!f) return;
      child.position.set(f.x, f.y + Math.sin(clock.elapsedTime * 1.5 + i) * 0.5, f.z);
      child.rotation.y = clock.elapsedTime + i;
    });
  });

  // Re-render when food count changes — we just do it in the parent
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
  const { camera, gl } = useThree();
  const playerRef = useRef<THREE.Group>(null!);
  const remoteRefs = useRef<Map<string, THREE.Group>>(new Map());
  const keys = useRef<Set<string>>(new Set());
  const mouseWorld = useRef(new THREE.Vector3(0, 0, 0));
  const lastBroadcast = useRef(0);
  const lastFoodSpawn = useRef(0);
  const channelRef = useRef<any>(null);
  const biteChannelRef = useRef<any>(null);
  const deathTimeout = useRef<number | null>(null);

  // Kelp positions
  const kelpPositions = useMemo<[number, number, number][]>(() =>
    Array.from({ length: 18 }, () => [
      (Math.random() - 0.5) * TANK_HALF.x * 1.6,
      0,
      (Math.random() - 0.5) * TANK_HALF.z * 1.6,
    ]), []);

  // Keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => keys.current.add(e.key.toLowerCase());
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  // Mouse / touch
  useEffect(() => {
    const onMove = (cx: number, cy: number) => {
      const ndc = new THREE.Vector2(
        (cx / window.innerWidth) * 2 - 1,
        -(cy / window.innerHeight) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const target = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, target);
      if (target) mouseWorld.current.copy(target);
    };
    const mouseHandler = (e: MouseEvent) => onMove(e.clientX, e.clientY);
    const touchHandler = (e: TouchEvent) => {
      if (e.touches.length > 0) onMove(e.touches[0].clientX, e.touches[0].clientY);
    };
    window.addEventListener('mousemove', mouseHandler);
    window.addEventListener('touchmove', touchHandler);
    return () => {
      window.removeEventListener('mousemove', mouseHandler);
      window.removeEventListener('touchmove', touchHandler);
    };
  }, [camera]);

  // Supabase channels
  useEffect(() => {
    if (!supabase) return;
    const store = getStore();

    const channel = supabase.channel('aquarium', {
      config: { presence: { key: uid } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<PlayerState>();
        const currentIds = new Set<string>();
        Object.entries(state).forEach(([key, presences]) => {
          if (key === uid) return;
          currentIds.add(key);
          const p = presences[0] as unknown as PlayerState;
          if (p) {
            store.remotePlayers.set(key, { ...p });
          }
        });
        // Remove departed
        store.remotePlayers.forEach((_, key) => {
          if (!currentIds.has(key)) store.remotePlayers.delete(key);
        });
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            name: store.name,
            color: store.color,
            x: store.position.x,
            y: store.position.y,
            z: store.position.z,
            hp: store.hp,
            kills: store.kills,
            dead: store.dead,
          } as PlayerState);
        }
      });

    channelRef.current = channel;

    // Bite channel - listen for incoming bites
    const biteChannel = supabase.channel(`bites-${uid}`);
    biteChannel
      .on('broadcast', { event: 'bite' }, ({ payload }) => {
        if (store.dead) return;
        store.hp = Math.max(0, store.hp - (payload.damage || BITE_DAMAGE));
        store.flashUntil = Date.now() + 300;
        toast.error(`Bitten by ${payload.attackerName}! -${payload.damage} HP`);

        if (store.hp <= 0 && !store.dead) {
          store.dead = true;
          store.killerName = payload.attackerName || 'Unknown';
          // Death delay
          deathTimeout.current = window.setTimeout(() => {
            store.phase = 'dead';
          }, DEATH_DELAY_MS);
        }
      })
      .subscribe();

    biteChannelRef.current = biteChannel;

    return () => {
      channel.unsubscribe();
      biteChannel.unsubscribe();
      if (deathTimeout.current) clearTimeout(deathTimeout.current);
    };
  }, []);

  // Game loop
  useFrame(({ clock }, delta) => {
    const store = getStore();
    const now = Date.now();

    if (!spectate && !store.dead) {
      // Input
      const accel = new THREE.Vector3();
      const k = keys.current;
      if (k.has('w') || k.has('arrowup')) accel.z -= 1;
      if (k.has('s') || k.has('arrowdown')) accel.z += 1;
      if (k.has('a') || k.has('arrowleft')) accel.x -= 1;
      if (k.has('d') || k.has('arrowright')) accel.x += 1;
      if (k.has('q')) accel.y += 1;
      if (k.has('e')) accel.y -= 1;

      if (accel.lengthSq() > 0) {
        accel.normalize().multiplyScalar(0.8);
        store.velocity.add(accel);
      }

      // Mouse attraction
      tmpVec.copy(mouseWorld.current).sub(store.position);
      if (tmpVec.length() > 1) {
        tmpVec.normalize().multiplyScalar(MOUSE_LERP * tmpVec.length());
        store.velocity.add(tmpVec);
      }

      // Damping
      store.velocity.multiplyScalar(DAMPING);
      if (store.velocity.length() > MAX_SPEED) {
        store.velocity.normalize().multiplyScalar(MAX_SPEED);
      }

      // Move
      store.position.add(tmpVec.copy(store.velocity).multiplyScalar(delta));

      // Clamp
      store.position.x = THREE.MathUtils.clamp(store.position.x, -TANK_HALF.x, TANK_HALF.x);
      store.position.y = THREE.MathUtils.clamp(store.position.y, -TANK_HALF.y, TANK_HALF.y);
      store.position.z = THREE.MathUtils.clamp(store.position.z, -TANK_HALF.z, TANK_HALF.z);

      // Update player mesh
      if (playerRef.current) {
        playerRef.current.position.copy(store.position);
        // Rotate toward velocity
        if (store.velocity.lengthSq() > 0.01) {
          const target = tmpVec.copy(store.position).add(store.velocity);
          playerRef.current.lookAt(target);
        }
      }

      // Auto-bite
      if (now - store.lastBiteTime > BITE_COOLDOWN_MS) {
        let nearest: { key: string; dist: number; name: string } | null = null;
        store.remotePlayers.forEach((p, key) => {
          if (p.dead) return;
          const dist = store.position.distanceTo(tmpVec.set(p.x, p.y, p.z));
          if (dist < BITE_RANGE && (!nearest || dist < nearest.dist)) {
            nearest = { key, dist, name: p.name };
          }
        });
        if (nearest && supabase) {
          store.lastBiteTime = now;
          const n = nearest as { key: string; dist: number; name: string };
          supabase.channel(`bites-${n.key}`).send({
            type: 'broadcast',
            event: 'bite',
            payload: { attackerName: store.name, damage: BITE_DAMAGE },
          });
          toast(`🦷 Bit ${n.name}!`);
          // Check if they died (optimistic kill count)
          const victim = store.remotePlayers.get(n.key);
          if (victim && victim.hp - BITE_DAMAGE <= 0) {
            store.kills++;
          }
        }
      }

      // Eat food
      for (let i = store.food.length - 1; i >= 0; i--) {
        const f = store.food[i];
        const dist = store.position.distanceTo(tmpVec.set(f.x, f.y, f.z));
        if (dist < 2.2) {
          store.food.splice(i, 1);
          store.hp = Math.min(MAX_HP, store.hp + FOOD_HP);
          toast.success(`+${FOOD_HP} HP 🍔`);
        }
      }

      // Broadcast position
      if (now - lastBroadcast.current > BROADCAST_MS && channelRef.current) {
        lastBroadcast.current = now;
        channelRef.current.track({
          name: store.name,
          color: store.color,
          x: store.position.x,
          y: store.position.y,
          z: store.position.z,
          hp: store.hp,
          kills: store.kills,
          dead: store.dead,
        });
      }
    }

    // Spawn food
    if (now - lastFoodSpawn.current > FOOD_SPAWN_MS) {
      lastFoodSpawn.current = now;
      spawnFood(store.food);
    }

    // Camera follow
    if (!spectate && playerRef.current) {
      const camTarget = tmpVec.copy(store.position).add(new THREE.Vector3(0, 8, 18));
      camera.position.lerp(camTarget, 0.05);
      camera.lookAt(store.position);
    }

    // Flash effect
    if (store.flashUntil > now && playerRef.current) {
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
      {/* Lighting */}
      <ambientLight intensity={0.3} />
      <directionalLight position={[10, 15, 10]} intensity={0.5} />
      <pointLight position={[-TANK_HALF.x, 0, 0]} color="#ff4444" intensity={1.5} distance={50} />
      <pointLight position={[TANK_HALF.x, 0, 0]} color="#4444ff" intensity={1.5} distance={50} />
      <fog attach="fog" args={['#050510', 20, 80]} />

      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -TANK_HALF.y, 0]}>
        <planeGeometry args={[TANK_HALF.x * 2, TANK_HALF.z * 2]} />
        <meshStandardMaterial color="#0a0a15" />
      </mesh>

      {/* Glass walls */}
      {[
        { pos: [0, 0, -TANK_HALF.z] as [number, number, number], rot: [0, 0, 0] as [number, number, number], size: [TANK_HALF.x * 2, TANK_HALF.y * 2] as [number, number] },
        { pos: [0, 0, TANK_HALF.z] as [number, number, number], rot: [0, Math.PI, 0] as [number, number, number], size: [TANK_HALF.x * 2, TANK_HALF.y * 2] as [number, number] },
        { pos: [-TANK_HALF.x, 0, 0] as [number, number, number], rot: [0, Math.PI / 2, 0] as [number, number, number], size: [TANK_HALF.z * 2, TANK_HALF.y * 2] as [number, number] },
        { pos: [TANK_HALF.x, 0, 0] as [number, number, number], rot: [0, -Math.PI / 2, 0] as [number, number, number], size: [TANK_HALF.z * 2, TANK_HALF.y * 2] as [number, number] },
      ].map((wall, i) => (
        <mesh key={i} position={wall.pos} rotation={wall.rot}>
          <planeGeometry args={wall.size} />
          <meshStandardMaterial color="#88aacc" transparent opacity={0.05} side={THREE.DoubleSide} />
        </mesh>
      ))}

      {/* Kelp */}
      {kelpPositions.map((pos, i) => <Kelp key={i} position={pos} />)}

      {/* Bubbles */}
      <Bubbles />

      {/* Food */}
      <FoodOrbs />

      {/* Player fish */}
      {!spectate && (
        <group ref={playerRef} position={[store.position.x, store.position.y, store.position.z]}>
          <FishMesh color={store.color} />
          <HPBar hp={store.hp} maxHp={MAX_HP} />
          <Text position={[0, 2.3, 0]} fontSize={0.6} color="#ffffff" anchorX="center" anchorY="middle" font={undefined}>
            {store.name}
          </Text>
        </group>
      )}

      {/* Remote players */}
      {Array.from(store.remotePlayers.entries()).map(([key, p]) => (
        <RemoteFish key={key} id={key} player={p} />
      ))}
    </>
  );
}

function RemoteFish({ id, player }: { id: string; player: PlayerState }) {
  const ref = useRef<THREE.Group>(null!);

  useFrame(() => {
    if (!ref.current) return;
    const target = tmpVec.set(player.x, player.y, player.z);
    ref.current.position.lerp(target, REMOTE_LERP);
    // Look toward movement direction
    if (target.distanceTo(ref.current.position) > 0.1) {
      ref.current.lookAt(target);
    }
  });

  return (
    <group ref={ref} position={[player.x, player.y, player.z]}>
      <FishMesh color={player.dead ? '#666666' : player.color} opacity={player.dead ? 0.45 : 1} />
      {!player.dead && <HPBar hp={player.hp} maxHp={MAX_HP} />}
      <Text position={[0, 2.3, 0]} fontSize={0.6} color={player.dead ? '#666666' : '#ffffff'} anchorX="center" anchorY="middle" font={undefined}>
        {player.name}
      </Text>
    </group>
  );
}
