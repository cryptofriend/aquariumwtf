import { useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import TankScene from './TankScene';

interface Props {
  spectate?: boolean;
}

export default function Tank3D({ spectate }: Props) {
  const [lightMode, setLightMode] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => setLightMode((e as CustomEvent).detail);
    window.addEventListener('aquarium-light-mode', handler);
    return () => window.removeEventListener('aquarium-light-mode', handler);
  }, []);

  return (
    <div className="fixed inset-0 z-30">
      <Canvas
        camera={{ position: [0, 60, 200], fov: 60 }}
        gl={{ antialias: true, alpha: false }}
        style={{ background: lightMode ? '#a8d8ea' : '#050510' }}
      >
        <TankScene spectate={spectate} />
      </Canvas>
    </div>
  );
}
