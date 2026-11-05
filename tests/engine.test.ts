import { describe, expect, it } from 'vitest';
import { newAIContext, planAction } from '../src/engine/ai';
import { CARDS } from '../src/engine/cards';
import { distance, hexKey, neighbors } from '../src/engine/hex';
import {
  RULES,
  applyAction,
  createGame,
  currentPlayer,
  playerStats,
  reachable,
  tileAt,
  weapons,
  type PlayerSetup,
} from '../src/engine/rules';
import type { GameState } from '../src/engine/types';

const setup = (n: number, ai = true): PlayerSetup[] =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, beast: `Beast${i}`, color: '#fff', isAI: ai }));

function give(s: GameState, pid: number, defId: string) {
  const card = { uid: s.nextUid++, defId };
  s.players[pid].hand.push(card);
  return card;
}

function placeAdjacent(s: GameState) {
  // Put player 1 right next to player 0 on open ground.
  const a = s.players[0];
  const spot = neighbors(a.pos!).find((h) => {
    const t = tileAt(s, h);
    return t && t.terrain === 'plains';
  })!;
  s.players[1].pos = spot;
  return spot;
}

describe('hex math', () => {
  it('measures distance', () => {
    expect(distance({ q: 0, r: 0 }, { q: 3, r: -3 })).toBe(3);
    expect(distance({ q: 6, r: 0 }, { q: -6, r: 0 })).toBe(12);
  });
});

describe('setup', () => {
  it('builds a valid game for 2–4 players', () => {
    for (const n of [2, 3, 4]) {
      const s = createGame({ players: setup(n), seed: 42 + n });
      expect(s.players).toHaveLength(n);
      const totalCards = CARDS.reduce((sum, c) => sum + c.count, 0);
      const inHands = s.players.reduce((sum, p) => sum + p.hand.length, 0);
      expect(s.deck.length + inHands).toBe(totalCards);
      for (const p of s.players) {
        const t = tileAt(s, p.pos!)!;
        expect(t.base).toBe(p.id);
      }
      expect(Object.values(s.tiles).filter((t) => t.well).length).toBe(7);
    }
  });

  it('is deterministic for a seed', () => {
    const a = createGame({ players: setup(3), seed: 7 });
    const b = createGame({ players: setup(3), seed: 7 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('rules', () => {
  it('grafts a weapon into a matching slot and spends energy', () => {
    const s = createGame({ players: setup(2), seed: 1 });
    const p = currentPlayer(s);
    p.energy = 5;
    const card = give(s, 0, 'bone_cannon');
    expect(applyAction(s, { type: 'graft', cardUid: card.uid, slot: 'head', index: 0 }).ok).toBe(false);
    expect(applyAction(s, { type: 'graft', cardUid: card.uid, slot: 'arm', index: 1 }).ok).toBe(true);
    expect(p.energy).toBe(3);
    expect(p.slots.arm[1]?.uid).toBe(card.uid);
    expect(weapons(p).map((w) => w.name)).toContain('Bone Cannon');
  });

  it('rejects grafts the player cannot afford', () => {
    const s = createGame({ players: setup(2), seed: 1 });
    const p = currentPlayer(s);
    p.energy = 1;
    const card = give(s, 0, 'rail_spines');
    expect(applyAction(s, { type: 'graft', cardUid: card.uid, slot: 'back', index: 0 }).ok).toBe(false);
    expect(p.hand).toContain(card);
  });

  it('moves along cheapest paths and claims wells', () => {
    const s = createGame({ players: setup(2), seed: 3 });
    const p = currentPlayer(s);
    p.movesLeft = 99;
    const res = applyAction(s, { type: 'move', to: { q: 0, r: 0 } });
    expect(res.ok).toBe(true);
    expect(tileAt(s, { q: 0, r: 0 })!.well!.owner).toBe(0);
  });

  it('cannot move into mountains or occupied hexes', () => {
    const s = createGame({ players: setup(2), seed: 3 });
    const spot = placeAdjacent(s);
    const reach = reachable(s, currentPlayer(s), 10);
    expect(reach.has(hexKey(spot))).toBe(false);
    for (const k of reach.keys()) expect(s.tiles[k].terrain).not.toBe('mountain');
  });

  it('resolves combat, armor and weapon readiness', () => {
    const s = createGame({ players: setup(2), seed: 5 });
    placeAdjacent(s);
    const [a, b] = s.players;
    b.slots.body[0] = { uid: s.nextUid++, defId: 'chitin_plating' };
    const before = b.hull;
    const res = applyAction(s, { type: 'fire', weaponId: 'trample', targetId: 1 });
    expect(res.ok).toBe(true);
    const shot = res.events.find((e) => e.kind === 'shot');
    expect(shot && shot.kind === 'shot').toBe(true);
    if (shot?.kind === 'shot') expect(before - b.hull).toBe(shot.hits * 1); // 2 dmg − 1 armor
    expect(applyAction(s, { type: 'fire', weaponId: 'trample', targetId: 1 }).ok).toBe(false);
    expect(a.fired).toContain('trample');
  });

  it('destroying a Behemoth awards VP, strips grafts, and it respawns', () => {
    const s = createGame({ players: setup(2), seed: 9 });
    placeAdjacent(s);
    const [a, b] = s.players;
    b.slots.arm[0] = { uid: s.nextUid++, defId: 'saw_claws' };
    b.hull = 1;
    a.energy = 5;
    const flare = give(s, 0, 'rad_flare');
    expect(applyAction(s, { type: 'play', cardUid: flare.uid, targetId: 1 }).ok).toBe(true);
    expect(b.destroyed).toBe(true);
    expect(a.vp).toBe(RULES.killVP);
    expect(b.slots.arm[0]).toBeNull();
    applyAction(s, { type: 'endTurn' });
    expect(b.destroyed).toBe(false);
    expect(b.hull).toBe(playerStats(b).maxHull);
    expect(b.pos).not.toBeNull();
  });

  it('scores wells at the start of the owner’s turn', () => {
    const s = createGame({ players: setup(2), seed: 11 });
    tileAt(s, { q: 0, r: 0 })!.well!.owner = 1;
    applyAction(s, { type: 'endTurn' });
    expect(s.players[1].vp).toBe(2);
  });
});

describe('AI', () => {
  function playOut(seed: number, n: number) {
    const s = createGame({ players: setup(n), seed });
    let ctx = newAIContext();
    let actions = 0;
    let perTurn = 0;
    while (s.winner === null) {
      const a = perTurn > 80 ? ({ type: 'endTurn' } as const) : planAction(s, ctx);
      const res = applyAction(s, a);
      if (!res.ok) throw new Error(`AI chose illegal action ${JSON.stringify(a)}: ${res.error}`);
      perTurn++;
      if (a.type === 'endTurn') {
        ctx = newAIContext();
        perTurn = 0;
      }
      if (++actions > 20000) throw new Error('Game did not finish');
    }
    return s;
  }

  it('plays complete legal games for 2, 3 and 4 players', () => {
    const rounds: number[] = [];
    const kills: number[] = [];
    let byVP = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const n = 2 + (seed % 3);
      const s = playOut(seed, n);
      rounds.push(s.round);
      kills.push(s.players.reduce((k, p) => k + p.kills, 0));
      if (s.players[s.winner!].vp >= s.vpToWin) byVP++;
    }
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    console.log(
      `avg rounds ${avg(rounds).toFixed(1)} (min ${Math.min(...rounds)}, max ${Math.max(...rounds)}), ` +
        `avg kills ${avg(kills).toFixed(1)}, won on VP target ${byVP}/30`,
    );
    expect(byVP).toBeGreaterThan(20);
  });
});
