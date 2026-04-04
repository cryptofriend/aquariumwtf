import { useRef, useCallback, useEffect, useState } from 'react';

// Global joystick state readable from game loop
export const joystickState = { x: 0, y: 0, upDown: 0 };

export default function VirtualJoystick() {
  const stickRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const touchIdRef = useRef<number | null>(null);
  const originRef = useRef({ x: 0, y: 0 });
  const [stickPos, setStickPos] = useState({ x: 0, y: 0 });

  const RADIUS = 50;

  const handleMove = useCallback((clientX: number, clientY: number) => {
    const dx = clientX - originRef.current.x;
    const dy = clientY - originRef.current.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const clamped = Math.min(dist, RADIUS);
    const angle = Math.atan2(dy, dx);
    const cx = clamped * Math.cos(angle);
    const cy = clamped * Math.sin(angle);
    setStickPos({ x: cx, y: cy });
    joystickState.x = cx / RADIUS;
    joystickState.y = cy / RADIUS;
  }, []);

  const handleEnd = useCallback(() => {
    touchIdRef.current = null;
    setStickPos({ x: 0, y: 0 });
    joystickState.x = 0;
    joystickState.y = 0;
  }, []);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (touchIdRef.current !== null) return;
    const touch = e.changedTouches[0];
    touchIdRef.current = touch.identifier;
    const rect = baseRef.current!.getBoundingClientRect();
    originRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    handleMove(touch.clientX, touch.clientY);
  }, [handleMove]);

  useEffect(() => {
    const onMove = (e: TouchEvent) => {
      if (touchIdRef.current === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === touchIdRef.current) {
          handleMove(e.changedTouches[i].clientX, e.changedTouches[i].clientY);
          break;
        }
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (touchIdRef.current === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === touchIdRef.current) {
          handleEnd();
          break;
        }
      }
    };
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [handleMove, handleEnd]);

  return (
    <div className="fixed bottom-24 left-8 z-50 pointer-events-auto flex items-end gap-4">
      {/* Movement joystick */}
      <div
        ref={baseRef}
        onTouchStart={onTouchStart}
        className="relative rounded-full border-2 border-white/20 bg-white/10 backdrop-blur-sm"
        style={{ width: RADIUS * 2 + 20, height: RADIUS * 2 + 20 }}
      >
        <div
          ref={stickRef}
          className="absolute rounded-full bg-white/40 border border-white/50 shadow-lg"
          style={{
            width: 44,
            height: 44,
            left: '50%',
            top: '50%',
            transform: `translate(calc(-50% + ${stickPos.x}px), calc(-50% + ${stickPos.y}px))`,
            transition: stickPos.x === 0 && stickPos.y === 0 ? 'transform 0.15s ease-out' : 'none',
          }}
        />
      </div>

      {/* Up/Down buttons */}
      <div className="flex flex-col gap-2 mb-2">
        <button
          onTouchStart={() => { joystickState.upDown = 1; }}
          onTouchEnd={() => { joystickState.upDown = 0; }}
          onTouchCancel={() => { joystickState.upDown = 0; }}
          className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white/60 text-lg font-bold active:bg-white/30 select-none"
        >
          ↑
        </button>
        <button
          onTouchStart={() => { joystickState.upDown = -1; }}
          onTouchEnd={() => { joystickState.upDown = 0; }}
          onTouchCancel={() => { joystickState.upDown = 0; }}
          className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white/60 text-lg font-bold active:bg-white/30 select-none"
        >
          ↓
        </button>
      </div>
    </div>
  );
}
