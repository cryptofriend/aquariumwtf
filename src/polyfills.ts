// Must be the FIRST import in main.tsx: @solana/spl-token and web3.js touch
// Buffer at module-init time, which runs before any later statement in main.
import { Buffer } from 'buffer';

(window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
