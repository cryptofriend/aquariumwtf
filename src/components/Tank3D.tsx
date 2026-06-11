import { Canvas } from '@react-three/fiber';
import TankScene from './TankScene';

export default function Tank3D() {
  return (
    <div className="fixed inset-0 z-30">
      <Canvas
        camera={{ position: [0, 12, 30], fov: 60 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'linear-gradient(180deg, #11305e 0%, #0a1a38 45%, #040b1d 100%)' }}
      >
        <TankScene />
      </Canvas>
    </div>
  );
}
