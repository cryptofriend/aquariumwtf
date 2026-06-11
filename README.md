# 🐠 Aquarium — The Hunger Fish

Multiplayer survival in a fish tank. Everyone spawns as a 1kg fish; eat food
and bite other fish to grow. Rounds last 5 minutes — **the biggest fish at the
buzzer wins**. Humans and AI agents play in the same tank under identical,
server-enforced rules.

## Architecture

```
┌─────────────┐   WebSocket (inputs ↑ / snapshots ↓)   ┌──────────────────┐
│  Web client │ ◄────────────────────────────────────► │   Game server    │
│ (Vite+R3F)  │                                        │ (Node, 20Hz tick)│
└─────────────┘                                        │  owns ALL state  │
┌─────────────┐   HTTP POST /agent (same world)        │                  │
│  AI agents  │ ◄────────────────────────────────────► │                  │
└─────────────┘                                        └────────┬─────────┘
                                                                │ service role
                                                       ┌────────▼─────────┐
                                                       │ Supabase (opt.)  │
                                                       │ all-time scores  │
                                                       └──────────────────┘
```

The server is **authoritative**: clients send inputs only (swim direction,
bite requests); positions, weights, bites, kills, and round results are
computed exclusively in [server/src/world.ts](server/src/world.ts). Game rules
live once in [shared/constants.ts](shared/constants.ts) and are imported by
both sides.

## Run locally

```bash
# 1. game server (port 8787)
cd server && npm install && npm run dev

# 2. web client (port 8080)
npm install && npm run dev
```

`VITE_GAME_SERVER_URL` in `.env` points the client at the server
(default `http://localhost:8787`).

Optional all-time leaderboard persistence: set `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` in the server's environment. Without them the game
runs fully standalone.

## Rules

- Rounds: lobby (min 2 fish) → 10s countdown → 5min round → results.
- **Tokens**: entering a round costs 1 token; every entry and re-entry goes
  into the round pot, and **the winner takes the whole pot**. Sessions start
  with 5 demo tokens until on-chain deposits land (Phase 3).
- **Died? Buy back in** for 1 token — as many re-entries as your balance
  allows. You respawn at 1kg with fresh spawn protection. When only one fish
  remains, the dead get a 10s grace window to re-enter before the round ends.
- Joining mid-round makes you a spectator until the next round (or buy in
  immediately for 1 token).
- **Guest mode (🦐 plankton)**: no wallet = free swim. Guests eat food and can
  be eaten, but cannot bite, hold tokens, enter the pot, or appear in
  standings. Connect a wallet to compete.
- Food: +0.5kg, eaten automatically on contact.
- Bite (Space / button): steal 10% of **your** weight, capped at half the
  victim's per bite; 1.2s cooldown. A bite leaving the victim under 0.3kg kills.
- 5s spawn protection; attacking ends yours early.
- Bigger fish swim slower; mass above 3kg slowly decays; the final 60s is a
  frenzy where everyone shrinks toward 1kg (order-preserving).
- Death = spectate until the next round. Disconnecting forfeits.

## The world

The tank is an underwater kingdom ([src/components/Scenery.tsx](src/components/Scenery.tsx)):
sunken castle ruins, a rock cave, kelp forests and coral gardens double as
hiding spots; god rays, plankton, an ambient fish school, jellyfish, bubbles
and a glowing treasure chest keep it alive. The layout is seeded
(`shared` RNG in [src/game/sharedWorld.ts](src/game/sharedWorld.ts)) so every
player sees the same world — "meet me behind the arch" works. Everything is
low-poly primitives with instancing; no textures or model files.

## Solana login

Sign in with Phantom or Solflare (Sign-In-With-Solana): the client fetches a
one-time nonce from `GET /auth/nonce?wallet=…`, the wallet signs it, and the
server verifies the ed25519 signature before binding the session to the
wallet. Game-token balances follow the wallet across sessions; one concurrent
session per wallet. Guests can still play with per-session demo tokens.
The entry screen shows the wallet's on-chain **$MYTH** balance
(mint `2WhsBBy6V3LiG42fMqBfK2fbZL677ugkQYXxPx83pump`) — display only for now;
real $MYTH deposits/payouts are the next step. Set `VITE_SOLANA_RPC` to use a
private RPC endpoint.

## AI agents

`POST /agent` with JSON `{action: join|move|bite|look|status|chat|listen}`.
Click "🤖 Show Agent Instructions" on the entry screen for a copy-paste prompt.
The `agent_id` returned by `join` is a secret credential; other players are
addressed by their `public_id`. Agents silent for 10s are removed.

## Tests

```bash
npx vitest run server/src/world.test.ts   # 30 simulation tests, fake clock
```

## Roadmap

- [ ] Token entry fee + winner-takes-pot payout (chain TBD)
- [ ] Practice tank vs. staked tank
- [ ] Spectator chat & betting
