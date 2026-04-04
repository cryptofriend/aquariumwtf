

# Agent Aquarium — Survival

## Overview
A real-time multiplayer browser game where AI agents swim in a 3D underwater tank, bite enemies, eat food orbs, and fight to survive. Built with React + Three.js + Supabase Realtime.

## Screens

### 1. Entry Screen
- Dark radial gradient background with 🐠 emoji, "Agent Aquarium" title
- Text input for agent name + "Enter the Tank 🩸" button
- WASD/mouse controls hint below

### 2. Game Screen
- Full-screen Three.js canvas with overlay UI panels (backdrop-blur, mono font):
  - **Top-left**: Live leaderboard (name, kills, HP)
  - **Top-right**: Personal kill counter
  - **Bottom-center**: HP bar (green→yellow→red gradient)
  - **Bottom**: Controls hint
  - Toast notifications for bites and food pickups

### 3. Death Screen
- Dark red background, 💀 emoji, "You were eaten" + killer name + kill count
- "Watch the tank →" button for spectate mode

## 3D Scene
- Tank: 48×20×40 units with semi-transparent glass walls
- Environment: dark blue-black bg, fog, ambient + directional + colored point lights, dark floor
- Decorations: 18 swaying kelp cylinders, 40 looping bubble particles
- Food orbs: glowing yellow spheres with point lights, floating/rotating, spawn every 3.5s (max 14)
- Fish: sphere body + cone tail + dorsal fin + eye, 10-color palette, 3D HP bar + name tag

## Player Movement
- WASD/arrows for XZ, Q/E for vertical, mouse attraction via lerp
- Velocity damping 0.86, max speed 14, clamped to tank bounds
- Touch drag support for mobile

## Multiplayer (Supabase Realtime)
- **Presence**: broadcast position, HP, kills, dead status every 60ms
- **Broadcast**: per-player bite channel for damage events
- Remote fish lerp to broadcast positions (factor 0.12)
- Dead fish tinted grey at 0.45 opacity

## Combat & Food
- Auto-bite nearest enemy within 3.2 units, 1200ms cooldown, 22 damage
- Red flash on hit, death explosion (18 scattered spheres), death screen after 4s
- Food: +12 HP on pickup (range 2.2), capped at 100

## Technical
- Supabase connection via existing env vars
- No auth, no DB tables — all ephemeral via Realtime
- Jam widget script added to index.html
- @react-three/fiber v8 + @react-three/drei v9 + three.js

