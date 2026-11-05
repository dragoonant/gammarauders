import { RULES } from '../engine/rules';

export const rulesHtml = (vpToWin: number = RULES.vpToWin): string => `
<h2>How to play</h2>
<p>The old world is ash. Warlords fight over the last <b>Rad Wells</b> with Behemoths: city-sized bio-mechs
that grow new weapons when you graft them on. Be the first warlord to <b>${vpToWin} victory points</b> (VP).</p>

<h3>Your turn</h3>
<ol>
  <li><b>Upkeep (automatic):</b> score <b>1 VP</b> for each Rad Well you control (<b>2 VP</b> for the Heart Well at the center).
  Gain <b>${RULES.baseIncome} energy +1 per well</b> you control (maximum ${RULES.energyCap}). Draw ${RULES.drawPerTurn} cards (hand limit ${RULES.handLimit}).</li>
  <li><b>Act</b> in any order, as often as you can afford:
    <ul>
      <li><b>Graft</b> a weapon or mutation card into a matching slot (Head ×1, Arm ×2, Back ×1, Body ×2) by paying its energy cost.
      Grafting into a full slot discards what was there.</li>
      <li><b>Play</b> a tactic card by paying its cost.</li>
      <li><b>Move</b> using your movement points (base ${RULES.baseMove}). You can split your movement across several moves.</li>
      <li><b>Fire</b> each weapon once at an enemy in range. Every Behemoth can also <b>Trample</b> an adjacent enemy.</li>
      <li><b>Scrap</b> a card from your hand for 1 energy.</li>
    </ul>
  </li>
  <li><b>End turn.</b> If you end it standing in a rad zone, you take ${RULES.radDamage} damage.</li>
</ol>

<h3>Rad Wells</h3>
<p>Enter a well's hex to claim it. It stays yours until an enemy Behemoth enters it. Standing on a well blocks
anyone else from entering it.</p>

<h3>Combat</h3>
<p>Each shot rolls a die. A <b>4+</b> hits (3+ with a Hunter Eye). A target in <b>ruins</b> is harder to hit (+1).
Each hit deals the weapon's damage minus the target's <b>armor</b> (minimum 1). <i>Pierce</i> weapons ignore armor.</p>

<h3>Destruction</h3>
<p>A Behemoth at 0 hull is destroyed, and the warlord who destroyed it gains <b>${RULES.killVP} VP</b>. All its grafts are lost. It respawns at
full hull at its home base at the start of its owner's next turn. Its owner keeps their hand, energy, wells and VP.</p>

<h3>Terrain</h3>
<ul>
  <li><b>Ash plains:</b> cost 1.</li>
  <li><b>Ruins:</b> cost 2. Gives cover (enemies need +1 to hit).</li>
  <li><b>Toxic swamp:</b> cost 2.</li>
  <li><b>Rad zone:</b> cost 1. You take ${RULES.radDamage} damage if you end your turn here.</li>
  <li><b>Crags:</b> impassable.</li>
</ul>

<h3>Ending the game</h3>
<p>The first warlord to reach the VP target wins immediately. If no one has after ${RULES.maxRounds} rounds, the warlord with the most VP wins.
The first player moves one hex less on their opening turn, and later players start with extra energy, to offset turn order.</p>
`;
