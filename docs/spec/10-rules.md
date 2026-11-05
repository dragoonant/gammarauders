# Wasteland Behemoths: rules spec

This is an original ruleset, so the spec is the product (KB `three-kingdoms-tactics.md`, lesson "Original games need a spec with rule ids before code").
Every rule has a stable id, and tests are named by those ids (`tests/engine.test.ts`).
Numbers live in `RULES` (`src/engine/rules.ts`) and in `src/engine/cards.ts`. If this text and the code disagree, the code wins and this file gets fixed.
Balance changes need a sim or bench result (section B).

## S. Setup
- **S-1** 2–4 warlords. Seat 0 is the human; seats 1–3 are AI.
- **S-2** The map is a hexagon of radius 6 (127 hexes). Terrain is random but point-symmetric, so it is fair for opposite bases. Every base and well is guaranteed to connect to every other, and the hexes around them are never crags.
- **S-3** Wells: the 2-VP Heart Well sits at the center, ringed by six 1-VP Rad Wells at distance 3.
- **S-4** Bases sit on board corners: corners 0 and 3 for 2 players, 0/2/4 for 3, and 0/1/3/4 for 4.
- **S-5** Each Behemoth starts at its base with 24 hull and no grafts. Each warlord starts with 4 cards and 3 + seat index energy.
- **S-6** The shared deck is the 66 cards in `cards.ts`, shuffled with the game seed. The game is deterministic for a seed and an action list.

## T. Turn
- **T-1** Upkeep, in order: respawn if destroyed (D-3), score wells (W-3), clear temporary armor, gain energy (2 + 1 per well + mutations, maximum 12), regenerate, draw 2 (hand limit 7, reshuffle the discard into the deck when it runs out), then set movement to move − stun and clear stun.
- **T-2** The first player's Behemoth starts with 1 stun, so it moves one hex less on its opening turn (B-1).
- **T-3** During the act step, graft, play, move, fire and scrap may happen in any order and as often as resources allow.
- **T-4** End turn: a Behemoth standing in a rad zone takes 2 damage unless it is rad-immune. Then play passes to the next seat. A new round starts at seat 0.

## G. Grafting and cards
- **G-1** Slots: Head ×1, Arm ×2, Back ×1, Body ×2. A card grafts only into its own slot type.
- **G-2** Grafting costs the card's energy. Grafting into a full slot discards the old card.
- **G-3** A mutation's modifiers apply immediately. A movement change adjusts the movement left this turn. Bulk Tissue heals 6 when grafted. Hull is clamped to max hull, with a minimum of 1.
- **G-4** A tactic costs its energy, resolves, and is discarded. Targeted tactics need an enemy within their range. Gene Blight needs an enemy with at least one graft.
- **G-5** Scrap: discard any card from your hand for +1 energy (maximum 12).
- **G-6** A newly grafted weapon can fire on the turn it is grafted.

## M. Movement
- **M-1** Entering a hex costs 1 on plains and rad zones and 2 on ruins and swamp. Strider Legs make every passable hex cost 1. Crags are impassable.
- **M-2** A Behemoth cannot enter or pass through a hex holding another Behemoth.
- **M-3** A move goes to any hex within movement left, along the cheapest path. Movement can be split across several moves.

## C. Combat
- **C-1** Each weapon fires once per turn (Rapid Reload readies them all again). Trample is innate: range 1, 1 shot, 2 damage.
- **C-2** Range is hex distance. There is no line-of-sight rule.
- **C-3** Each shot rolls a d6 and hits on 4+. Hunter Eye gives −1, and a target in ruins gives +1. The result is clamped to 2..6.
- **C-4** Each hit deals the weapon's damage minus the target's armor, with a minimum of 1. Pierce weapons ignore armor.
- **C-5** Stun: a hit adds the weapon's stun to the target. Leech: the attacker heals the damage it dealt.

## W. Wells
- **W-1** Entering a well's hex (passing through counts) claims it from anyone.
- **W-2** A well stays claimed after its owner leaves it, and after its owner is destroyed.
- **W-3** At the start of a warlord's turn, they score the value of every well they hold.

## D. Destruction
- **D-1** At 0 hull a Behemoth is destroyed and leaves the board. All its grafts are discarded.
- **D-2** The warlord whose weapon or tactic destroyed it gains 5 VP. Radiation deaths award nothing.
- **D-3** The Behemoth respawns at the start of its owner's next turn, at full hull, on its base or the nearest free passable hex.

## V. Victory
- **V-1** A warlord wins the moment their VP reaches the target (25 by default, chosen at setup).
- **V-2** If no one has reached it after 30 rounds, the warlord with the most VP wins. Ties go to most wells, then most hull.

## B. Balance record
- **B-1** Seat balance (`tests/engine.test.ts`, 200 AI games per seat count, seeds 100–299, 2026-11-05):

  | Change | 2p | 3p | 4p |
  |---|---|---|---|
  | No compensation | 127 / 73 | 80 / 58 / 62 | 56 / 58 / 43 / 43 |
  | Later seats +1 energy each | 123 / 77 | 80 / 62 / 58 | 59 / 39 / 46 / 56 |
  | Plus first-player stun 1 (shipped) | 108 / 92 | 63 / 69 / 68 | 47 / 51 / 52 / 50 |

  The energy step alone did not help. The opening-move penalty did.
- **B-2** Pace: 30 AI games averaged 10.8 rounds (9–14) and about 2 kills, and every one ended on the VP target (2026-11-05, after B-1).
- **B-3** Bench: the AI beat the uniformly random legal-action baseline in 100/100 two-player games, alternating seats (gate: at least 95%).

## Rulings
`RULING: <rule> | <what we did> | <why> | <status>`
- `RULING: M-3 | moving claims every well on the path, not only the destination | entering a hex is what claims it (W-1), and paths are deterministic | settled`
- `RULING: D-2 | a Rad Flare kill awards the kill VP | it is an attack by a warlord | settled`
- `RULING: T-1 | a destroyed Behemoth's owner still scores wells and draws on the turn it respawns | otherwise a kill would be worth far more than 5 VP | open (playtest)`
