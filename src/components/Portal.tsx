import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import { getStore } from '../game/useGameStore';

const PORTAL_RADIUS = 3;
const PORTAL_ENTER_DIST = 2.5;

interface PortalProps {
  position: [number, number, number];
  label: string;
  targetUrl: string;
  color?: string;
}

function PortalRing({ color }: { color: string }) {
  const ringRef = useRef<THREE.Mesh>(null!);
  const particlesRef = useRef<THREE.Points>(null!);

  const particlePositions = useMemo(() => {
    const count = 60;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      positions[i * 3] = Math.cos(angle) * PORTAL_RADIUS;
      positions[i * 3 + 1] = Math.sin(angle) * PORTAL_RADIUS;
      positions[i * 3 + 2] = 0;
    }
    return positions;
  }, []);

  useFrame(({ clock }) => {
    if (ringRef.current) {
      ringRef.current.rotation.z = clock.elapsedTime * 0.5;
    }
    if (particlesRef.current) {
      particlesRef.current.rotation.z = -clock.elapsedTime * 0.3;
      const positions = particlesRef.current.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < positions.length / 3; i++) {
        const angle = (i / (positions.length / 3)) * Math.PI * 2 + clock.elapsedTime;
        const wobble = Math.sin(clock.elapsedTime * 2 + i) * 0.3;
        positions[i * 3] = Math.cos(angle) * (PORTAL_RADIUS + wobble);
        positions[i * 3 + 1] = Math.sin(angle) * (PORTAL_RADIUS + wobble);
      }
      particlesRef.current.geometry.attributes.position.needsUpdate = true;
    }
  });

  return (
    <group>
      {/* Outer glowing ring */}
      <mesh ref={ringRef}>
        <torusGeometry args={[PORTAL_RADIUS, 0.15, 16, 64]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={2}
          transparent
          opacity={0.9}
        />
      </mesh>

      {/* Inner swirl disc */}
      <mesh>
        <circleGeometry args={[PORTAL_RADIUS - 0.2, 64]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.5}
          transparent
          opacity={0.3}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Particle ring */}
      <points ref={particlesRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={particlePositions.length / 3}
            array={particlePositions}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial color={color} size={0.15} transparent opacity={0.8} />
      </points>

      {/* Point light */}
      <pointLight color={color} intensity={4} distance={15} />
    </group>
  );
}

export default function Portal({ position, label, targetUrl, color = '#8b5cf6' }: PortalProps) {
  const groupRef = useRef<THREE.Group>(null!);
  const enteredRef = useRef(false);
  const labelRef = useRef<THREE.Group>(null!);

  useFrame(({ clock, camera }) => {
    if (!groupRef.current) return;

    // Gentle floating
    groupRef.current.position.y = position[1] + Math.sin(clock.elapsedTime * 0.8) * 0.3;

    // Make label face camera
    if (labelRef.current) {
      labelRef.current.lookAt(camera.position);
    }

    // Check if player enters portal
    const store = getStore();
    if (store.dead || store.spectate || enteredRef.current) return;

    const portalPos = new THREE.Vector3(position[0], position[1], position[2]);
    const dist = store.position.distanceTo(portalPos);

    if (dist < PORTAL_ENTER_DIST) {
      enteredRef.current = true;

      // Build URL with query params
      const params = new URLSearchParams();
      params.set('username', store.name);
      params.set('color', store.color);
      const speed = store.velocity.length();
      params.set('speed', speed.toFixed(2));
      params.set('ref', window.location.origin);
      params.set('hp', Math.min(100, Math.max(1, Math.round(store.weight))).toString());
      params.set('speed_x', store.velocity.x.toFixed(2));
      params.set('speed_y', store.velocity.y.toFixed(2));
      params.set('speed_z', store.velocity.z.toFixed(2));

      window.location.href = `${targetUrl}?${params.toString()}`;
    }
  });

  return (
    <group ref={groupRef} position={position}>
      <PortalRing color={color} />

      {/* Label above */}
      <group ref={labelRef} position={[0, PORTAL_RADIUS + 1, 0]}>
        <Text
          fontSize={0.6}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
          font={undefined}
          outlineWidth={0.05}
          outlineColor="#000000"
        >
          {label}
        </Text>
        <Text
          fontSize={0.3}
          color="#a78bfa"
          anchorX="center"
          anchorY="middle"
          position={[0, -0.6, 0]}
          font={undefined}
        >
          Swim into the portal!
        </Text>
      </group>
    </group>
  );
}
