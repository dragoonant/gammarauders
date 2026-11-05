# Status (rewritten in place; last update 2026-11-05)

**Milestone M3+M4 equivalent:** a playable game against the AI, on branch `claude/wasteland-behemoths`. Not merged, and not on Pages yet.

## What works
- Full rules (`docs/spec/10-rules.md`): setup, turn flow, grafting, tactics, movement, combat, wells, destruction and respawn, and victory.
- Heuristic AI (`src/engine/ai.ts`). It beat the random baseline in 100/100 bench games, alternating seats.
- SVG board with tile-only picking and a hex inspector. Panel with scoreboard, slots, weapons, hand, dice tray and battle log. Rules dialog. Phone layout at 390 px with no sideways scroll.
- Autosave after every accepted action, plus Continue, Discard, replace-confirm, and corrupt, finished and refused-storage handling (rule 22).

## Gates (2026-11-05, cloud container)
- `npm run typecheck`: clean.
- `npm test`: 17 tests. Sim of 30 games with invariants after every action (average 10.8 rounds, 9–14, all won on VP); save round-trip and replay; bench 100/100.
- `npm run e2e`: 6 Playwright tests (smoke and text sweep, rule 24, rule 25, rule 22 with a persistent profile, bad saves, refused storage).

## Not done / next
- Owner playtest: the VP target, card costs and AI difficulty are first-pass numbers.
- AI difficulty tiers (easy/normal/hard) and moving the AI into a Web Worker (recipe step 6). The AI is fast enough on the main thread today.
- Art (M5) and audio (M6) need a session on the owner's PC. The game has no sound yet.
- Rule 21 screenshot comparison against the siblings.
- Pinch-zoom on phones: hexes are about 22 px wide at 390 px.
