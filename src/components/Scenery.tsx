/**
 * The underwater kingdom — all decorative scenery for the tank.
 * Layout is seeded (sharedWorld.ts) so every client sees the same world.
 * Everything here is render-only and built from low-poly primitives with
 * instancing for repeated elements, so it stays cheap.
 */
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TANK_HALF } from '../game/constants';
import { getCoralGarden, getKelpForests, getRocks, worldRandom } from '../game/sharedWorld';

const FLOOR_Y = -TANK_HALF.y;

// ─── Sea floor: gently duned sand ───────────────────────────────────

function SeaFloor() {
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(TANK_HALF.x * 2.4, TANK_HALF.z * 2.4, 48, 40);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      pos.setZ(i, Math.sin(x * 0.25) * 0.6 + Math.cos(y * 0.3 + x * 0.12) * 0.5);
    }
    geo.computeVertexNormals();
    return geo;
  }, []);

  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]} receiveShadow>
      <meshStandardMaterial color="#1d2742" roughness={1} />
    </mesh>
  );
}

// ─── God rays from the surface ──────────────────────────────────────

function LightRays() {
  const group = useRef<THREE.Group>(null!);
  const rays = useMemo(() => {
    const random = worldRandom();
    return Array.from({ length: 5 }, (_, i) => ({
      x: -18 + i * 9 + (random() - 0.5) * 4,
      z: (random() - 0.5) * TANK_HALF.z,
      phase: random() * Math.PI * 2,
      width: 2 + random() * 3,
    }));
  }, []);

  useFrame(({ clock }) => {
    if (!group.current) return;
    group.current.children.forEach((ray, i) => {
      const r = rays[i];
      ray.rotation.z = Math.sin(clock.elapsedTime * 0.15 + r.phase) * 0.12;
      const mat = (ray as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.opacity = 0.05 + Math.sin(clock.elapsedTime * 0.4 + r.phase) * 0.025;
    });
  });

  return (
    <group ref={group}>
      {rays.map((r, i) => (
        <mesh key={i} position={[r.x, TANK_HALF.y + 2, r.z]}>
          <coneGeometry args={[r.width, TANK_HALF.y * 2.6, 4, 1, true]} />
          <meshBasicMaterial
            color="#7ec8ff"
            transparent
            opacity={0.06}
            side={THREE.DoubleSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  );
}

// ─── Drifting plankton motes ────────────────────────────────────────

function Plankton() {
  const count = 140;
  const ref = useRef<THREE.InstancedMesh>(null!);
  const motes = useMemo(() => {
    const random = worldRandom();
    return Array.from({ length: count }, () => ({
      x: (random() - 0.5) * TANK_HALF.x * 2,
      y: (random() - 0.5) * TANK_HALF.y * 2,
      z: (random() - 0.5) * TANK_HALF.z * 2,
      speed: 0.1 + random() * 0.3,
      phase: random() * Math.PI * 2,
      size: 0.02 + random() * 0.045,
    }));
  }, []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    motes.forEach((m, i) => {
      dummy.position.set(
        m.x + Math.sin(t * m.speed + m.phase) * 1.5,
        m.y + Math.sin(t * m.speed * 0.7 + m.phase * 2) * 1.2,
        m.z + Math.cos(t * m.speed * 0.5 + m.phase) * 1.5,
      );
      dummy.scale.setScalar(m.size);
      dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 4, 4]} />
      <meshBasicMaterial color="#9fd8ff" transparent opacity={0.55} depthWrite={false} />
    </instancedMesh>
  );
}

// ─── Kelp forests (hiding spots) ────────────────────────────────────

function KelpForests() {
  const strands = useMemo(() => getKelpForests(), []);
  const group = useRef<THREE.Group>(null!);

  useFrame(({ clock }) => {
    if (!group.current) return;
    group.current.children.forEach((strand, i) => {
      const s = strands[i];
      strand.rotation.x = s.lean + Math.sin(clock.elapsedTime * 0.7 + s.phase) * 0.13;
      strand.rotation.z = Math.sin(clock.elapsedTime * 0.5 + s.phase + 1) * 0.11;
    });
  });

  return (
    <group ref={group}>
      {strands.map((s, i) => (
        <group key={i} position={[s.x, FLOOR_Y, s.z]}>
          {/* tapering stalk built from 3 stacked segments for a curvy look */}
          {[0, 1, 2].map((seg) => (
            <mesh key={seg} position={[Math.sin(seg * 1.2 + s.phase) * 0.25, s.height * (0.18 + seg * 0.3), 0]}>
              <cylinderGeometry args={[0.1 - seg * 0.025, 0.16 - seg * 0.03, s.height * 0.36, 5]} />
              <meshStandardMaterial color={seg % 2 ? '#1d6b35' : '#175a2c'} roughness={0.9} />
            </mesh>
          ))}
          {/* leaf blades */}
          {[0.35, 0.6, 0.85].map((h, j) => (
            <mesh
              key={`leaf${j}`}
              position={[0.3 * (j % 2 ? 1 : -1), s.height * h, 0]}
              rotation={[0, (j * Math.PI) / 2.5, j % 2 ? 0.5 : -0.5]}
              scale={[0.5, 1.6, 0.06]}
            >
              <sphereGeometry args={[0.55, 6, 5]} />
              <meshStandardMaterial color="#2d8a45" roughness={0.85} side={THREE.DoubleSide} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

// ─── Coral gardens ──────────────────────────────────────────────────

const CORAL_COLORS = ['#ff6f91', '#ff9671', '#ffc75f', '#d65db1', '#f9a8d4', '#fb7185'];

function coralColor(hue: number) {
  return CORAL_COLORS[Math.floor(hue * CORAL_COLORS.length) % CORAL_COLORS.length];
}

function CoralGardens() {
  const pieces = useMemo(() => getCoralGarden(), []);

  return (
    <group>
      {pieces.map((c, i) => {
        const color = coralColor(c.hue);
        switch (c.kind) {
          case 0: // branching coral
            return (
              <group key={i} position={[c.x, FLOOR_Y, c.z]} rotation={[0, c.rot, 0]} scale={c.scale}>
                {[0, 1, 2, 3, 4].map((b) => (
                  <mesh key={b} position={[Math.sin(b * 1.7) * 0.35, 0.7 + (b % 3) * 0.28, Math.cos(b * 2.1) * 0.35]}
                    rotation={[Math.sin(b) * 0.6, 0, Math.cos(b * 1.3) * 0.6]}>
                    <cylinderGeometry args={[0.05, 0.11, 1.3 + (b % 2) * 0.5, 5]} />
                    <meshStandardMaterial color={color} roughness={0.8} />
                  </mesh>
                ))}
              </group>
            );
          case 1: // brain coral
            return (
              <mesh key={i} position={[c.x, FLOOR_Y + 0.3 * c.scale, c.z]} rotation={[0, c.rot, 0]} scale={[c.scale, c.scale * 0.65, c.scale]}>
                <sphereGeometry args={[0.8, 9, 7]} />
                <meshStandardMaterial color={color} roughness={0.95} />
              </mesh>
            );
          case 2: // tube coral cluster
            return (
              <group key={i} position={[c.x, FLOOR_Y, c.z]} rotation={[0, c.rot, 0]} scale={c.scale}>
                {[0, 1, 2, 3].map((t) => (
                  <mesh key={t} position={[Math.sin(t * 2.4) * 0.3, 0.5 + (t % 2) * 0.25, Math.cos(t * 2.4) * 0.3]}>
                    <cylinderGeometry args={[0.16, 0.1, 1 + (t % 2) * 0.6, 6, 1, true]} />
                    <meshStandardMaterial color={color} roughness={0.85} side={THREE.DoubleSide} />
                  </mesh>
                ))}
              </group>
            );
          default: // sea fan
            return (
              <mesh key={i} position={[c.x, FLOOR_Y + 0.7 * c.scale, c.z]} rotation={[0, c.rot, 0]} scale={[c.scale, c.scale, c.scale * 0.08]}>
                <circleGeometry args={[0.9, 8, 0, Math.PI]} />
                <meshStandardMaterial color={color} roughness={0.8} side={THREE.DoubleSide} transparent opacity={0.92} />
              </mesh>
            );
        }
      })}
    </group>
  );
}

// ─── Rocks & a small cave stack ─────────────────────────────────────

function Rocks() {
  const rocks = useMemo(() => getRocks(), []);
  return (
    <group>
      {rocks.map((r, i) => (
        <mesh key={i} position={[r.x, FLOOR_Y + r.scale * r.squash * 0.35, r.z]}
          rotation={[0, r.rot, 0]} scale={[r.scale, r.scale * r.squash, r.scale]}>
          <dodecahedronGeometry args={[0.8, 0]} />
          <meshStandardMaterial color="#39415e" roughness={1} flatShading />
        </mesh>
      ))}
      {/* cave arch: two boulders + slab — a real hiding hole */}
      <group position={[13, FLOOR_Y, 9]}>
        <mesh position={[-2.2, 1.1, 0]} scale={[1.7, 2.3, 2]}>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color="#3c4566" roughness={1} flatShading />
        </mesh>
        <mesh position={[2.2, 1.1, 0]} scale={[1.7, 2.3, 2]}>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color="#343c59" roughness={1} flatShading />
        </mesh>
        <mesh position={[0, 2.9, 0]} scale={[3.4, 0.9, 2.4]} rotation={[0, 0.15, 0.05]}>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color="#414a6e" roughness={1} flatShading />
        </mesh>
      </group>
    </group>
  );
}

// ─── The sunken castle (kingdom centerpiece + hiding spots) ─────────

function Column({ position, height = 5, broken = false }: { position: [number, number, number]; height?: number; broken?: boolean }) {
  const h = broken ? height * 0.45 : height;
  return (
    <group position={position}>
      <mesh position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.75, 0.85, 0.5, 8]} />
        <meshStandardMaterial color="#8d93ab" roughness={0.9} />
      </mesh>
      <mesh position={[0, h / 2 + 0.5, 0]} rotation={broken ? [0.07, 0, 0.06] : [0, 0, 0]}>
        <cylinderGeometry args={[0.45, 0.55, h, 9]} />
        <meshStandardMaterial color="#a3a9c2" roughness={0.85} />
      </mesh>
      {!broken && (
        <mesh position={[0, h + 0.75, 0]}>
          <boxGeometry args={[1.5, 0.5, 1.5]} />
          <meshStandardMaterial color="#8d93ab" roughness={0.9} />
        </mesh>
      )}
    </group>
  );
}

function SunkenCastle() {
  return (
    <group position={[-11, FLOOR_Y, -10]}>
      {/* colonnade — swim between the pillars */}
      <Column position={[-5, 0, 0]} height={6} />
      <Column position={[-2.5, 0, -2]} height={6} />
      <Column position={[0, 0, -3]} height={6} broken />
      <Column position={[2.5, 0, -2]} height={6} />
      <Column position={[5, 0, 0]} height={6} broken />
      {/* architrave resting on the first pair */}
      <mesh position={[-3.75, 6.9, -1]} rotation={[0, 0.38, 0]}>
        <boxGeometry args={[4.4, 0.6, 1.6]} />
        <meshStandardMaterial color="#9aa0b8" roughness={0.9} />
      </mesh>
      {/* grand arch — the classic hiding spot */}
      <group position={[1.5, 0, 3.5]}>
        <mesh position={[0, 3.2, 0]} rotation={[0, 0, 0]}>
          <torusGeometry args={[2.6, 0.55, 6, 14, Math.PI]} />
          <meshStandardMaterial color="#a3a9c2" roughness={0.85} />
        </mesh>
        <mesh position={[-2.6, 1.5, 0]}>
          <boxGeometry args={[1.1, 3.2, 1.1]} />
          <meshStandardMaterial color="#8d93ab" roughness={0.9} />
        </mesh>
        <mesh position={[2.6, 1.5, 0]}>
          <boxGeometry args={[1.1, 3.2, 1.1]} />
          <meshStandardMaterial color="#8d93ab" roughness={0.9} />
        </mesh>
      </group>
      {/* crumbled wall pieces */}
      <mesh position={[-6.5, 0.8, 3]} rotation={[0, 0.6, 0]}>
        <boxGeometry args={[3, 1.6, 0.9]} />
        <meshStandardMaterial color="#7e849c" roughness={0.95} />
      </mesh>
      <mesh position={[6, 0.5, 2]} rotation={[0.1, -0.4, 0.12]}>
        <boxGeometry args={[2.2, 1, 0.8]} />
        <meshStandardMaterial color="#767c94" roughness={0.95} />
      </mesh>
      {/* mossy glow at the base — gives the ruins an eerie presence */}
      <pointLight position={[0, 2, 0]} color="#5eead4" intensity={1.6} distance={14} />
    </group>
  );
}

// ─── Treasure chest landmark ────────────────────────────────────────

function TreasureChest() {
  const glow = useRef<THREE.PointLight>(null!);
  useFrame(({ clock }) => {
    if (glow.current) glow.current.intensity = 1.5 + Math.sin(clock.elapsedTime * 2.2) * 0.5;
  });
  return (
    <group position={[18, FLOOR_Y, -14]} rotation={[0, -0.7, 0]}>
      <mesh position={[0, 0.45, 0]}>
        <boxGeometry args={[1.6, 0.9, 1]} />
        <meshStandardMaterial color="#6b4226" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.95, -0.18]} rotation={[-0.9, 0, 0]}>
        <boxGeometry args={[1.6, 0.7, 0.12]} />
        <meshStandardMaterial color="#7a4d2d" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.95, 0.05]} scale={[1.3, 0.35, 0.7]}>
        <sphereGeometry args={[0.5, 8, 6]} />
        <meshStandardMaterial color="#ffd34d" emissive="#b8860b" emissiveIntensity={0.7} roughness={0.3} metalness={0.6} />
      </mesh>
      <pointLight ref={glow} position={[0, 1.4, 0.3]} color="#ffcf4d" intensity={1.8} distance={9} />
    </group>
  );
}

// ─── Ambient school of small fish ───────────────────────────────────

function AmbientSchool() {
  const count = 36;
  const ref = useRef<THREE.InstancedMesh>(null!);
  const members = useMemo(() => {
    const random = worldRandom();
    return Array.from({ length: count }, () => ({
      offset: random() * Math.PI * 2,
      radius: 6 + random() * 4,
      y: 2 + random() * 4,
      wobble: random() * Math.PI * 2,
      speed: 0.85 + random() * 0.3,
    }));
  }, []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime * 0.22;
    // School center wanders a lissajous path through the tank
    const cx = Math.sin(t) * 13;
    const cz = Math.sin(t * 1.7 + 1) * 10;
    const cy = Math.sin(t * 0.8) * 3;
    members.forEach((m, i) => {
      const a = t * m.speed * 3 + m.offset;
      const x = cx + Math.cos(a) * m.radius * 0.4;
      const z = cz + Math.sin(a) * m.radius * 0.4;
      const y = cy + m.y + Math.sin(clock.elapsedTime * 2 + m.wobble) * 0.4;
      dummy.position.set(x, y, z);
      dummy.lookAt(x + Math.cos(a + 0.3), y, z + Math.sin(a + 0.3));
      dummy.scale.setScalar(0.22);
      dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]}>
      <coneGeometry args={[0.5, 1.6, 4]} />
      <meshStandardMaterial color="#7fb6d9" roughness={0.6} metalness={0.3} />
    </instancedMesh>
  );
}

// ─── Jellyfish drifting in the deep ─────────────────────────────────

function Jellyfish({ seed, position }: { seed: number; position: [number, number, number] }) {
  const group = useRef<THREE.Group>(null!);
  const bell = useRef<THREE.Mesh>(null!);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (group.current) {
      group.current.position.y = position[1] + Math.sin(t * 0.4 + seed) * 2.5;
      group.current.position.x = position[0] + Math.sin(t * 0.15 + seed * 2) * 3;
      group.current.position.z = position[2] + Math.cos(t * 0.12 + seed) * 3;
    }
    if (bell.current) {
      const pulse = 1 + Math.sin(t * 1.8 + seed) * 0.14;
      bell.current.scale.set(pulse, 1.6 - pulse * 0.45, pulse);
    }
  });

  return (
    <group ref={group} position={position}>
      <mesh ref={bell}>
        <sphereGeometry args={[0.9, 10, 8, 0, Math.PI * 2, 0, Math.PI / 1.8]} />
        <meshStandardMaterial color="#c4b5fd" emissive="#8b5cf6" emissiveIntensity={0.5} transparent opacity={0.55} side={THREE.DoubleSide} />
      </mesh>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} position={[Math.sin(i * 1.26) * 0.4, -0.9, Math.cos(i * 1.26) * 0.4]}>
          <cylinderGeometry args={[0.03, 0.015, 1.6, 4]} />
          <meshStandardMaterial color="#a78bfa" transparent opacity={0.5} />
        </mesh>
      ))}
      <pointLight color="#a78bfa" intensity={0.9} distance={5} />
    </group>
  );
}

// ─── Bubbles (carried over, slightly denser) ────────────────────────

function Bubbles() {
  const count = 50;
  const ref = useRef<THREE.InstancedMesh>(null!);
  const offsets = useMemo(() => {
    const random = worldRandom();
    return Array.from({ length: count }, () => ({
      x: (random() - 0.5) * TANK_HALF.x * 1.8,
      z: (random() - 0.5) * TANK_HALF.z * 1.8,
      speed: 0.5 + random() * 1.5,
      phase: random() * TANK_HALF.y * 2,
      size: 0.04 + random() * 0.09,
    }));
  }, []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(({ clock }) => {
    offsets.forEach((b, i) => {
      const y = ((clock.elapsedTime * b.speed + b.phase) % (TANK_HALF.y * 2)) - TANK_HALF.y;
      dummy.position.set(b.x + Math.sin(y * 0.8 + b.phase) * 0.4, y, b.z);
      dummy.scale.setScalar(b.size);
      dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshStandardMaterial color="#88ccff" transparent opacity={0.35} />
    </instancedMesh>
  );
}

// ─── Everything together ────────────────────────────────────────────

export default function Scenery() {
  return (
    <>
      <SeaFloor />
      <LightRays />
      <Plankton />
      <KelpForests />
      <CoralGardens />
      <Rocks />
      <SunkenCastle />
      <TreasureChest />
      <AmbientSchool />
      <Jellyfish seed={1} position={[-18, 4, 6]} />
      <Jellyfish seed={4} position={[8, 5, -16]} />
      <Jellyfish seed={7} position={[16, 3, 12]} />
      <Bubbles />
    </>
  );
}
