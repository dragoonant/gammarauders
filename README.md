# Wasteland Behemoths

A browser strategy game for 1 player against 1–3 AI warlords. Each side commands one giant bio-mech **Behemoth**
on a hex map of a ruined world. You graft weapons and mutations onto it, claim the **Rad Wells**, and
smash the other warlords' monsters.

The game is in the same family as late-80s "giant monster on a hex map" board games. Its rules, cards, names and art are original.

## Running it

```bash
npm install
npm run dev       # play at http://localhost:5173
npm test          # engine + AI tests (includes full AI-vs-AI games)
npm run build     # static build in dist/ (works from any path, e.g. GitHub Pages)
```

Games autosave in the browser, and the menu offers **Continue**.

## Rules

**Goal:** be the first to reach the victory-point target (25 VP by default; you can change it on the setup screen).

### Your turn
1. **Upkeep (automatic):** score 1 VP for each Rad Well you control, or 2 VP for the Heart Well at the center.
   Gain 2 energy + 1 per well (maximum 12) and draw 2 cards (hand limit 7).
2. **Act**, in any order:
   - **Graft** a weapon or mutation into a matching slot (Head ×1, Arm ×2, Back ×1, Body ×2) by paying its energy cost.
     Grafting into a full slot discards the old card.
   - **Play** a tactic card.
   - **Move** up to your movement (base 3). You can split it across several moves.
   - **Fire** each weapon once at an enemy in range. Every Behemoth can also **Trample** an adjacent enemy (1 shot, 2 damage).
   - **Scrap** a card from your hand for 1 energy.
3. **End turn.** If you end it in a rad zone, you take 2 damage.

### Rad Wells
Enter a well's hex to claim it. It stays yours until an enemy Behemoth enters it. Occupied hexes block movement,
so standing on a well defends it.

### Combat
Each shot rolls a d6 and hits on **4+**. A Hunter Eye lowers that by 1. A target in ruins raises it by 1.
Each hit deals the weapon's damage minus the target's armor (minimum 1). *Pierce* weapons ignore armor.

### Destruction
A Behemoth at 0 hull is destroyed, and its attacker gains **5 VP**. The destroyed Behemoth loses all its grafts.
It respawns at full hull at its base on its owner's next turn. Its owner keeps their hand, energy, wells and VP.

### Terrain
| Terrain     | Move cost | Effect                                 |
|-------------|-----------|----------------------------------------|
| Ash plains  | 1         | —                                      |
| Ruins       | 2         | Cover: attackers need +1 to hit        |
| Toxic swamp | 2         | —                                      |
| Rad zone    | 1         | 2 damage if you end your turn there    |
| Crags       | —         | Impassable                             |

### Turn-order balance
The first player moves one hex less on their opening turn. Each later seat starts with +1 more energy than the seat before it.
Over 600 simulated AI games, this keeps win rates by seat close to even.

### Ending
The game ends the moment anyone reaches the VP target. If no one has after 30 rounds, the warlord with the most VP wins.

## Cards (66-card shared deck)

| Card | Type | Slot | Cost | Effect |
|---|---|---|---|---|
| Bone Cannon ×4 | Weapon | Arm | 2 | Range 3, 1 shot, 4 dmg |
| Saw Claws ×4 | Weapon | Arm | 1 | Range 1, 2 shots, 3 dmg |
| Napalm Bladder ×3 | Weapon | Arm | 2 | Range 2, 2 shots, 3 dmg |
| Leech Tendril ×2 | Weapon | Arm | 3 | Range 2, 1 shot, 4 dmg, heal the damage dealt |
| Acid Spitter ×3 | Weapon | Head | 2 | Range 2, 2 shots, 2 dmg, ignores armor |
| Shriek Horn ×2 | Weapon | Head | 2 | Range 2, 1 shot, 2 dmg, target loses 2 move next turn |
| Missile Hump ×3 | Weapon | Back | 3 | Range 4, 3 shots, 2 dmg |
| Rail Spines ×2 | Weapon | Back | 4 | Range 5, 1 shot, 6 dmg |
| Chitin Plating ×4 | Mutation | Body | 2 | +1 armor |
| Siege Shell ×2 | Mutation | Body | 4 | +2 armor, −1 move |
| Strider Legs ×3 | Mutation | Body | 2 | +1 move, ruins and swamp cost 1 |
| Regen Sac ×3 | Mutation | Body | 3 | Heal 2 each turn |
| Bulk Tissue ×3 | Mutation | Body | 2 | +6 max hull (heals 6) |
| Hunter Eye ×3 | Mutation | Head | 2 | Hit on one less |
| Rad Lungs ×2 | Mutation | Head | 1 | Rad immune, +1 energy when starting a turn in a rad zone |
| Reactor Gland ×2 | Mutation | Back | 3 | +1 energy each turn |
| Field Mending ×4 | Tactic | — | 1 | Heal 6 |
| Adrenal Surge ×3 | Tactic | — | 1 | +3 move this turn |
| Scavenge ×3 | Tactic | — | 0 | Draw 2 |
| Power Siphon ×3 | Tactic | — | 0 | +2 energy |
| Rad Flare ×2 | Tactic | — | 2 | Enemy within 4 takes 3 damage, ignoring armor |
| Gene Blight ×2 | Tactic | — | 2 | Enemy within 3 loses a random graft |
| Rapid Reload ×2 | Tactic | — | 2 | Your weapons may fire again |
| Spore Cloud ×2 | Tactic | — | 1 | +2 armor until your next turn |

## Code layout

- `src/engine/` holds the pure, deterministic game logic (seeded RNG) and has no DOM code.
  - `rules.ts`: setup, turn flow, actions (`applyAction`), and queries.
  - `cards.ts`: card definitions. `map.ts`: symmetric map generator. `hex.ts`: axial hex math.
  - `ai.ts`: heuristic AI (`planAction` returns the next action for the current player).
- `src/ui/board.ts` draws the SVG board. `src/main.ts` holds app state, the side panel, input handling, and AI turn playback.
- `tests/engine.test.ts`: rules tests plus 30 full AI-vs-AI games.
