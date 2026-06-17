/**
 * Render-only scene. The server owns all game state — this component
 * gathers input (keys / mouse / joystick / bite) and sends it up, then
 * draws interpolated snapshots from src/net/gameClient.
 */
import { useRef, useMemo, useEffect, useReducer } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import { TANK_HALF, REMOTE_LERP, scaleFor, biteRangeFor } from '../game/constants';
import { net, self, sendInput, RenderPlayer } from '../net/gameClient';
import { joystickState } from './VirtualJoystick';
import Scenery from './Scenery';

const tmpVec = new THREE.Vector3();
const PROXIMITY_RANGE = 10;

/** Set by the space key or the UI bite button; consumed by the input loop. */
export const biteRequest = { pending: false };

function FishMesh({ color, opacity = 1, weight = 1 }: { color: string; opacity?: number; weight?: number }) {
  const scale = scaleFor(weight);
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

/** Pulsing shield shown while a fish has spawn protection. */
function ImmunityShield({ weight }: { weight: number }) {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const pulse = 1 + Math.sin(clock.elapsedTime * 5) * 0.06;
    const s = (scaleFor(weight) * 1.9) * pulse;
    ref.current.scale.setScalar(s);
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[1, 16, 12]} />
      <meshBasicMaterial color="#4ade80" transparent opacity={0.15} side={THREE.DoubleSide} />
    </mesh>
  );
}

function FoodOrbs() {
  const ref = useRef<THREE.Group>(null!);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.children.forEach((child, i) => {
      const f = net.food[i];
      if (!f) return;
      child.position.set(f.x, f.y + Math.sin(clock.elapsedTime * 1.5 + i) * 0.5, f.z);
      child.rotation.y = clock.elapsedTime + i;
    });
  });

  return (
    <group ref={ref}>
      {net.food.map((f) => (
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

function Fish({ player, isSelf }: { player: RenderPlayer; isSelf: boolean }) {
  const ref = useRef<THREE.Group>(null!);

  useFrame(() => {
    if (!ref.current) return;
    // Advance interpolated position toward the latest server position
    player.cx += (player.x - player.cx) * REMOTE_LERP;
    player.cy += (player.y - player.cy) * REMOTE_LERP;
    player.cz += (player.z - player.cz) * REMOTE_LERP;
    ref.current.position.set(player.cx, player.cy, player.cz);
    const target = tmpVec.set(player.x, player.y, player.z);
    if (target.distanceTo(ref.current.position) > 0.15) ref.current.lookAt(target);
  });

  const ghost = player.spectator;
  const color = player.dead ? '#666666' : player.color;
  const opacity = player.dead ? 0.45 : ghost ? 0.25 : 1;

  return (
    <group ref={ref} position={[player.cx, player.cy, player.cz]}>
      <FishMesh color={color} opacity={opacity} weight={player.weight} />
      {player.immune && !player.dead && !ghost && <ImmunityShield weight={player.weight} />}
      <Text position={[0, 2.3, 0]} fontSize={0.5} color={player.dead ? '#666666' : isSelf ? '#ffe066' : '#ffffff'} anchorX="center" anchorY="middle" font={undefined}>
        {`${player.name} (${player.weight.toFixed(1)}kg)${ghost ? ' 👻' : ''}`}
      </Text>
    </group>
  );
}

/** Distance readouts to nearby fish — red when in bite range. */
function ProximityLabels() {
  const groupRef = useRef<THREE.Group>(null!);

  useFrame(() => {
    const me = self();
    if (!groupRef.current || !me || me.dead || me.spectator) return;
    let i = 0;
    for (const p of net.players.values()) {
      if (p.id === me.id || p.dead || p.spectator) continue;
      const child = groupRef.current.children[i++] as THREE.Group | undefined;
      if (!child) break;
      const d = Math.sqrt((p.cx - me.cx) ** 2 + (p.cy - me.cy) ** 2 + (p.cz - me.cz) ** 2);
      const visible = d < PROXIMITY_RANGE;
      child.visible = visible;
      if (visible) {
        child.position.set((me.cx + p.cx) / 2, (me.cy + p.cy) / 2 + 1.5, (me.cz + p.cz) / 2);
        const label = child.children[0] as unknown as { text?: string; color?: string } & THREE.Object3D;
        const inRange = d < biteRangeFor(me.weight);
        // drei <Text> exposes .text/.color on the underlying object
        (label as any).text = `${d.toFixed(1)}m`;
        (label as any).color = inRange ? '#ff4444' : d < 5 ? '#ffaa00' : '#88ccff';
      }
    }
    for (; i < groupRef.current.children.length; i++) {
      groupRef.current.children[i].visible = false;
    }
  });

  const slots = useMemo(() => Array.from({ length: 8 }), []);
  return (
    <group ref={groupRef}>
      {slots.map((_, i) => (
        <group key={i} visible={false}>
          <Text fontSize={0.4} color="#88ccff" anchorX="center" anchorY="middle" font={undefined}>0.0m</Text>
        </group>
      ))}
    </group>
  );
}

export default function TankScene() {
  const { camera } = useThree();
  const keys = useRef<Set<string>>(new Set());

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

  // First-person controls: you sit in the fish's head. A/D (←/→) turn,
  // Q/E pitch up/dive, W/↑ thrust, S/↓ brake. Joystick: x = turn, y = thrust.
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const fwd = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const me = self();
    const TURN_SPEED = 2.1;   // rad/s
    const PITCH_SPEED = 1.6;

    if (me && !me.dead && !me.spectator) {
      const k = keys.current;
      let thrust = 0;
      if (k.has('w') || k.has('arrowup')) thrust += 1;
      if (k.has('s') || k.has('arrowdown')) thrust -= 0.45;
      if (k.has('a') || k.has('arrowleft')) yawRef.current -= TURN_SPEED * delta;
      if (k.has('d') || k.has('arrowright')) yawRef.current += TURN_SPEED * delta;
      let pitching = false;
      if (k.has('q')) { pitchRef.current += PITCH_SPEED * delta; pitching = true; }
      if (k.has('e')) { pitchRef.current -= PITCH_SPEED * delta; pitching = true; }

      // Mobile joystick: x turns, push up to swim forward; buttons pitch
      if (Math.abs(joystickState.x) > 0.15) yawRef.current += joystickState.x * TURN_SPEED * delta;
      if (Math.abs(joystickState.y) > 0.15) thrust += -joystickState.y;
      if (joystickState.upDown !== 0) { pitchRef.current += joystickState.upDown * PITCH_SPEED * delta; pitching = true; }

      // Gentle auto-level so the horizon comes back when you stop pitching
      if (!pitching) pitchRef.current += (0 - pitchRef.current) * Math.min(1, delta * 0.5);
      pitchRef.current = THREE.MathUtils.clamp(pitchRef.current, -1.15, 1.15);

      const yaw = yawRef.current, pitch = pitchRef.current;
      fwd.set(
        Math.sin(yaw) * Math.cos(pitch),
        Math.sin(pitch),
        -Math.cos(yaw) * Math.cos(pitch),
      );

      thrust = THREE.MathUtils.clamp(thrust, -0.45, 1);
      const bite = biteRequest.pending;
      biteRequest.pending = false;
      sendInput(fwd.x * thrust, fwd.y * thrust, fwd.z * thrust, bite);

      // Advance our own interpolated position toward the authoritative
      // server position. Our fish isn't rendered (we're inside its head), so
      // the Fish component never does this for us — without it the camera
      // stays frozen at spawn and the world appears motionless.
      const lerpK = Math.min(1, delta * 9);
      me.cx += (me.x - me.cx) * lerpK;
      me.cy += (me.y - me.cy) * lerpK;
      me.cz += (me.z - me.cz) * lerpK;

      // Camera in the fish's head, looking along the heading
      const scale = scaleFor(me.weight);
      const eyeX = me.cx + fwd.x * scale * 1.1;
      const eyeY = me.cy + fwd.y * scale * 1.1 + scale * 0.2;
      const eyeZ = me.cz + fwd.z * scale * 1.1;
      camera.position.lerp(tmpVec.set(eyeX, eyeY, eyeZ), 0.45);
      camera.lookAt(camera.position.x + fwd.x, camera.position.y + fwd.y, camera.position.z + fwd.z);
    } else {
      biteRequest.pending = false;
      // Spectators & the dead: high slow orbit over the kingdom
      const t = Date.now() / 24000;
      camera.position.lerp(tmpVec.set(Math.sin(t) * 26, 26, Math.cos(t) * 26), 0.02);
      camera.lookAt(0, -4, 0);
    }
  });

  return (
    <>
      {/* Deep-water mood: cool ambient, warm sun shafts from above,
          teal + violet accent lights at the far walls */}
      <ambientLight intensity={0.42} color="#6f9fd8" />
      <directionalLight position={[8, 20, 6]} intensity={0.7} color="#bfe3ff" />
      <pointLight position={[-TANK_HALF.x, 2, 0]} color="#14b8a6" intensity={1.2} distance={45} />
      <pointLight position={[TANK_HALF.x, 2, 0]} color="#8b5cf6" intensity={1.2} distance={45} />
      <fog attach="fog" args={['#0a1a38', 26, 95]} />

      {/* faint boundary walls so players can read the edge of the arena */}
      {[
        { pos: [0, 0, -TANK_HALF.z] as const, rot: [0, 0, 0] as const, size: [TANK_HALF.x * 2, TANK_HALF.y * 2] as const },
        { pos: [0, 0, TANK_HALF.z] as const, rot: [0, Math.PI, 0] as const, size: [TANK_HALF.x * 2, TANK_HALF.y * 2] as const },
        { pos: [-TANK_HALF.x, 0, 0] as const, rot: [0, Math.PI / 2, 0] as const, size: [TANK_HALF.z * 2, TANK_HALF.y * 2] as const },
        { pos: [TANK_HALF.x, 0, 0] as const, rot: [0, -Math.PI / 2, 0] as const, size: [TANK_HALF.z * 2, TANK_HALF.y * 2] as const },
      ].map((wall, i) => (
        <mesh key={i} position={wall.pos as any} rotation={wall.rot as any}>
          <planeGeometry args={wall.size as any} />
          <meshStandardMaterial color="#7ec8ff" transparent opacity={0.04} side={THREE.DoubleSide} />
        </mesh>
      ))}

      <Scenery />
      <FoodOrbs />
      <PlayersLayer />
      <ProximityLabels />
    </>
  );
}

/** Re-renders the fish list when players join/leave (snapshot-driven). */
function PlayersLayer() {
  // net.players is mutated in place; we only need React to re-render when
  // the SET of ids changes. Poll cheaply — positions update via useFrame.
  const idsRef = useRef('');
  const [, force] = useReducer((v: number) => v + 1, 0);
  const forceRef = useRef(force);
  forceRef.current = force;

  useFrame(() => {
    const ids = [...net.players.keys()].join(',');
    if (ids !== idsRef.current) {
      idsRef.current = ids;
      forceRef.current();
    }
  });

  return (
    <>
      {[...net.players.values()]
        // benched fish have no body; your own fish is hidden — you're inside it
        .filter((p) => !p.spectator && p.id !== net.selfId)
        .map((p) => (
          <Fish key={p.id} player={p} isSelf={false} />
        ))}
    </>
  );
}
