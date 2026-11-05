# Wasteland Behemoths — plan and decisions

Repo `dragoonant/gammarauders` (private), started 2026-11-05 from a claude.ai cloud session.
Decisions are not re-asked. Owner quotes are verbatim, with dates.

## Decisions
- **D1 Original game, not a port (2026-11-05).** Owner: "In this project I'd like to make a digital version of the gammarauders game." Claude declined to recreate Gammarauders (TSR, 1987): its name, creatures, card text and art, and its rules 1:1. Claude offered an original game in the same family instead. Owner: "Original game, browser-based, play against the AI. I'd like the rules to be as similar to gammarauders as possible." Result: the mechanics stay in the genre (giant bio-mech per warlord, hex map, slot grafting, resource sites, dice combat, VP race), and the rules, numbers, cards, names and look are our own. KB rule 2 ("fidelity is the product") becomes "the spec is the product", as for three-kingdoms-tactics.
- **D2 Browser, TypeScript, no framework (2026-11-05).** The board is 2D, so the game uses plain DOM plus one SVG and skips the recipe's React/R3F/three stack. It keeps the recipe's Vite 8, TS 7 strict, Vitest 5 and Playwright. Nothing 3D exists, so rules 26 and 27 do not apply yet.
- **D3 One human against 1–3 AI warlords (2026-11-05, owner).** The human is seat 0 and moves first. Seat compensation is in spec B-1.
- **D4 Presentation concept (default, 2026-11-05):** "a salvage-yard war map": a dark rust-and-amber survey table, heavy uppercase wordmark, hexes as surveyed ground, Behemoths as spiked crest tokens. Must not look like: three-kingdoms-tactics (war-council sand table), bossforge (pixel dungeon), or the lorecannae card scaffold. No side-by-side screenshot comparison has been made yet (rule 21 asks for one before the first playable ships to the owner).
- **D5 Defaults (2026-11-05):** map radius 6, 7 wells (Heart Well worth 2), 25 VP to win (the owner can pick 15–40 at setup), 30-round cap, 66-card deck.
- **D6 Seat balance (2026-11-05):** the first player starts with 1 stun, and later seats start with +1 energy each. Numbers are in spec B-1.
- **D7 Save (2026-11-05, KB rule 22):** a v2 envelope (setup, seed, action list, snapshot, savedAt) under the key `wasteland-behemoths-save`. The snapshot reopens the game, and the action list replays it.
- **D8 Pages (default, 2026-11-05):** a gates-then-force-push to `gh-pages` workflow (the bossforge route). It runs on `main` only, and the repo is private (see Open questions).

## Open questions (defaults in use, rule 20)
1. Make the repo public so Pages can serve it on a free plan, or keep it private? *Default: private; the workflow is ready either way.*
2. Merge `claude/wasteland-behemoths` into `main` (which starts the deploy)? *Default: wait for the owner.*
3. Art and audio: this cloud session cannot reach the local studios (KB gotchas, cloud sessions). *Default: procedural SVG tokens until a session on the owner's PC runs M5/M6.*
