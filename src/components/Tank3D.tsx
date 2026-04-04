import { Canvas } from '@react-three/fiber';
import TankScene from './TankScene';

interface Props {
  spectate?: boolean;
}

export default function Tank3D({ spectate }: Props) {
  return (
    <div className="fixed inset-0 z-30">
      <Canvas
        camera={{ position: [0, 12, 30], fov: 60 }}
        gl={{ antialias: true, alpha: false }}
        style={{ background: '#050510' }}
      >
        <TankScene spectate={spectate} />
      </Canvas>
    </div>
  );
}
