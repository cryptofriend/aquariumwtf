// Browser-wide single-session lock.
// Ensures only ONE tab per browser can play at a time.
// Uses localStorage + heartbeat. A lock is considered stale after STALE_MS.

const KEY = 'aquarium.session.lock';
const STALE_MS = 5000;
const HEARTBEAT_MS = 1500;

type LockData = { id: string; ts: number; name: string };

let myId: string | null = null;
let heartbeatTimer: number | null = null;

function read(): LockData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as LockData;
    if (!data?.id || !data?.ts) return null;
    return data;
  } catch {
    return null;
  }
}

function write(data: LockData) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* noop */ }
}

function clear() {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
}

/** Returns the active session info if another tab currently holds the lock. */
export function getActiveSession(): { name: string } | null {
  const data = read();
  if (!data) return null;
  if (myId && data.id === myId) return null;
  if (Date.now() - data.ts > STALE_MS) return null;
  return { name: data.name };
}

/** Try to acquire the lock for this tab. Returns true on success. */
export function acquireSessionLock(name: string): boolean {
  const existing = getActiveSession();
  if (existing) return false;

  myId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  write({ id: myId, ts: Date.now(), name });

  if (heartbeatTimer != null) window.clearInterval(heartbeatTimer);
  heartbeatTimer = window.setInterval(() => {
    if (!myId) return;
    write({ id: myId, ts: Date.now(), name });
  }, HEARTBEAT_MS);

  // Release on tab close
  window.addEventListener('pagehide', releaseSessionLock);
  window.addEventListener('beforeunload', releaseSessionLock);
  return true;
}

export function releaseSessionLock() {
  if (heartbeatTimer != null) {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  const data = read();
  if (data && myId && data.id === myId) clear();
  myId = null;
}

/** Subscribe to lock changes from other tabs. Returns unsubscribe fn. */
export function subscribeSessionLock(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) cb(); };
  const interval = window.setInterval(cb, 2000);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.clearInterval(interval);
  };
}
