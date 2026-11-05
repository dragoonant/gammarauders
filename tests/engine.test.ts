import { describe, expect, it } from 'vitest';
import { newAIContext, planAction, randomAction } from '../src/engine/ai';
import { CARDS } from '../src/engine/cards';
import { distance, hexKey, neighbors } from '../src/engine/hex';
import {
  RULES,
  applyAction,
  createGame,
  currentPlayer,
  grafts,
  playerStats,
  reachable,
  tileAt,
  weapons,
  type PlayerSetup,
} from '../src/engine/rules';
import { makeEnvelope, readEnvelope, replay } from '../src/engine/save';
import type { Action, GameState } from '../src/engine/types';

const setup = (n: number, ai = true): PlayerSetup[] =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, beast: `Beast${i}`, color: '#fff', isAI: ai }));

const TOTAL_CARDS = CARDS.reduce((sum, c) => sum + c.count, 0);

function give(s: GameState, pid: number, defId: string) {
  const card = { uid: s.nextUid++, defId };
  s.players[pid].hand.push(card);
  return card;
}

function placeAdjacent(s: GameState) {
  const a = s.players[0];
  const spot = neighbors(a.pos!).find((h) => tileAt(s, h)?.terrain === 'plains')!;
  s.players[1].pos = spot;
  return spot;
}

/** Invariants checked after every action of every simulated game. */
function checkInvariants(s: GameState): void {
  const cards =
    s.deck.length +
    s.discard.length +
    s.players.reduce((n, p) => n + p.hand.length + grafts(p).length, 0);
  // Test helpers never run inside sims, so the deck is conserved exactly.
  if (cards !== TOTAL_CARDS) throw new Error(`card count ${cards} != ${TOTAL_CARDS}`);
  const seen = new Set<string>();
  for (const p of s.players) {
    const st = playerStats(p);
    if (p.hand.length > RULES.handLimit) throw new Error('hand over limit');
    if (p.energy < 0 || p.energy > RULES.energyCap) throw new Error(`energy ${p.energy}`);
    if (p.movesLeft < 0) throw new Error('negative movement');
    if (p.destroyed) {
      if (p.pos) throw new Error('destroyed Behemoth on the board');
      continue;
    }
    if (p.hull < 1 || p.hull > st.maxHull) throw new Error(`hull ${p.hull}/${st.maxHull}`);
    const t = tileAt(s, p.pos!);
    if (!t || t.terrain === 'mountain') throw new Error('Behemoth on an impassable hex');
    const k = hexKey(p.pos!);
    if (seen.has(k)) throw new Error('two Behemoths share a hex');
    seen.add(k);
  }
}

type Policy = (s: GameState, ctx: ReturnType<typeof newAIContext>, rand: () => number) => Action;
const normal: Policy = (s, ctx) => planAction(s, ctx);
const random: Policy = (s, _ctx, rand) => randomAction(s, rand);

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function playOut(seed: number, policies: Policy[], opts: { invariants?: boolean; vpToWin?: number } = {}) {
  const s = createGame({ players: setup(policies.length), seed, vpToWin: opts.vpToWin });
  const rand = mulberry(seed * 7919);
  const actions: Action[] = [];
  let ctx = newAIContext();
  let perTurn = 0;
  while (s.winner === null) {
    const a: Action = perTurn > 80 ? { type: 'endTurn' } : policies[s.current](s, ctx, rand);
    const res = applyAction(s, a);
    if (!res.ok) throw new Error(`illegal action ${JSON.stringify(a)}: ${res.error}`);
    actions.push(a);
    if (opts.invariants) checkInvariants(s);
    perTurn++;
    if (a.type === 'endTurn') {
      ctx = newAIContext();
      perTurn = 0;
    }
    if (actions.length > 20000) throw new Error('game did not finish');
  }
  return { s, actions };
}

describe('hex math', () => {
  it('measures distance', () => {
    expect(distance({ q: 0, r: 0 }, { q: 3, r: -3 })).toBe(3);
    expect(distance({ q: 6, r: 0 }, { q: -6, r: 0 })).toBe(12);
  });
});

describe('S setup', () => {
  it('S-2..S-6 builds a valid game for 2–4 players', () => {
    for (const n of [2, 3, 4]) {
      const s = createGame({ players: setup(n), seed: 42 + n });
      expect(s.players).toHaveLength(n);
      const inHands = s.players.reduce((sum, p) => sum + p.hand.length, 0);
      expect(s.deck.length + inHands).toBe(TOTAL_CARDS);
      for (const p of s.players) expect(tileAt(s, p.pos!)!.base).toBe(p.id);
      expect(Object.values(s.tiles).filter((t) => t.well).length).toBe(7);
      expect(tileAt(s, { q: 0, r: 0 })!.well!.value).toBe(2);
      s.players.slice(1).forEach((p) => expect(p.energy).toBe(RULES.startEnergy + p.id));
    }
  });

  it('S-6 is deterministic for a seed', () => {
    const a = createGame({ players: setup(3), seed: 7 });
    const b = createGame({ players: setup(3), seed: 7 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('T-2 the first player moves one less on the opening turn', () => {
    const s = createGame({ players: setup(2), seed: 7 });
    expect(s.players[0].movesLeft).toBe(RULES.baseMove - 1);
  });
});

describe('G grafting', () => {
  it('G-1/G-2 grafts into a matching slot and spends energy', () => {
    const s = createGame({ players: setup(2), seed: 1 });
    const p = currentPlayer(s);
    p.energy = 5;
    const card = give(s, 0, 'bone_cannon');
    expect(applyAction(s, { type: 'graft', cardUid: card.uid, slot: 'head', index: 0 }).ok).toBe(false);
    expect(applyAction(s, { type: 'graft', cardUid: card.uid, slot: 'arm', index: 1 }).ok).toBe(true);
    expect(p.energy).toBe(3);
    expect(p.slots.arm[1]?.uid).toBe(card.uid);
    expect(weapons(p).find((w) => w.name === 'Bone Cannon')?.ready).toBe(true); // G-6
  });

  it('G-2 rejects grafts the player cannot afford, changing nothing', () => {
    const s = createGame({ players: setup(2), seed: 1 });
    const p = currentPlayer(s);
    p.energy = 1;
    const card = give(s, 0, 'rail_spines');
    const before = JSON.stringify(s);
    expect(applyAction(s, { type: 'graft', cardUid: card.uid, slot: 'back', index: 0 }).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('G-3 a movement mutation changes movement left this turn', () => {
    const s = createGame({ players: setup(2), seed: 1 });
    const p = currentPlayer(s);
    p.energy = 5;
    const before = p.movesLeft;
    const legs = give(s, 0, 'strider_legs');
    applyAction(s, { type: 'graft', cardUid: legs.uid, slot: 'body', index: 0 });
    expect(p.movesLeft).toBe(before + 1);
  });

  it('G-5 scrapping gives 1 energy', () => {
    const s = createGame({ players: setup(2), seed: 1 });
    const p = currentPlayer(s);
    const e = p.energy;
    applyAction(s, { type: 'scrap', cardUid: p.hand[0].uid });
    expect(p.energy).toBe(e + 1);
  });
});

describe('M movement', () => {
  it('M-3/W-1 moves along cheapest paths and claims wells', () => {
    const s = createGame({ players: setup(2), seed: 3 });
    currentPlayer(s).movesLeft = 99;
    expect(applyAction(s, { type: 'move', to: { q: 0, r: 0 } }).ok).toBe(true);
    expect(tileAt(s, { q: 0, r: 0 })!.well!.owner).toBe(0);
  });

  it('M-1/M-2 cannot enter crags or occupied hexes', () => {
    const s = createGame({ players: setup(2), seed: 3 });
    const spot = placeAdjacent(s);
    const reach = reachable(s, currentPlayer(s), 10);
    expect(reach.has(hexKey(spot))).toBe(false);
    for (const k of reach.keys()) expect(s.tiles[k].terrain).not.toBe('mountain');
  });
});

describe('C combat', () => {
  it('C-1/C-4 resolves armor and weapon readiness', () => {
    const s = createGame({ players: setup(2), seed: 5 });
    placeAdjacent(s);
    const [a, b] = s.players;
    b.slots.body[0] = { uid: s.nextUid++, defId: 'chitin_plating' };
    const before = b.hull;
    const res = applyAction(s, { type: 'fire', weaponId: 'trample', targetId: 1 });
    const shot = res.events.find((e) => e.kind === 'shot');
    if (shot?.kind !== 'shot') throw new Error('no shot event');
    expect(before - b.hull).toBe(shot.hits * 1); // 2 damage − 1 armor
    expect(applyAction(s, { type: 'fire', weaponId: 'trample', targetId: 1 }).ok).toBe(false);
    expect(a.fired).toContain('trample');
  });
});

describe('D destruction, W wells', () => {
  it('D-1..D-3 a kill awards VP, strips grafts, and the Behemoth respawns', () => {
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

  it('W-3 scores wells at the start of the owner’s turn', () => {
    const s = createGame({ players: setup(2), seed: 11 });
    tileAt(s, { q: 0, r: 0 })!.well!.owner = 1;
    applyAction(s, { type: 'endTurn' });
    expect(s.players[1].vp).toBe(2);
  });
});

describe('sim, save and AI', () => {
  it('sim: 30 AI games (2–4 players) finish legally with every invariant holding', () => {
    const rounds: number[] = [];
    let byVP = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const n = 2 + (seed % 3);
      const { s } = playOut(seed, Array(n).fill(normal), { invariants: true });
      rounds.push(s.round);
      if (s.players[s.winner!].vp >= s.vpToWin) byVP++;
    }
    const avg = rounds.reduce((a, b) => a + b, 0) / rounds.length;
    console.log(`sim: avg rounds ${avg.toFixed(1)} (min ${Math.min(...rounds)}, max ${Math.max(...rounds)}), won on VP ${byVP}/30`);
    expect(byVP).toBeGreaterThan(20);
  });

  it('save: the envelope round-trips, and setup + actions replay to the snapshot', () => {
    // Stop mid-game so there is a live state to save.
    const { s: done, actions } = playOut(77, [normal, normal, normal]);
    const cut = actions.slice(0, Math.floor(actions.length / 2));
    const seedSetup = { players: setup(3), seed: 77 };
    const live = replay(seedSetup, cut);
    const raw = JSON.stringify(makeEnvelope(seedSetup, cut, live));
    const read = readEnvelope(raw);
    if (!read.ok) throw new Error(read.reason);
    expect(JSON.stringify(read.envelope.snapshot)).toBe(JSON.stringify(live));
    // Playing on from the reopened snapshot gives the same game as never saving.
    const reopened = read.envelope.snapshot;
    for (const a of actions.slice(cut.length)) expect(applyAction(reopened, a).ok).toBe(true);
    expect(JSON.stringify(reopened)).toBe(JSON.stringify(done));
  });

  it('save: damaged, foreign, outdated and finished saves are refused with a reason', () => {
    const live = createGame({ players: setup(2), seed: 3 });
    const env = makeEnvelope({ players: setup(2), seed: 3 }, [], live);
    expect(readEnvelope('{oops').ok).toBe(false);
    expect(readEnvelope(JSON.stringify({ ...env, game: 'other' })).ok).toBe(false);
    expect(readEnvelope(JSON.stringify({ ...env, version: 1 })).ok).toBe(false);
    const missing = structuredClone(env);
    missing.snapshot.deck[0].defId = 'deleted_card';
    const r = readEnvelope(JSON.stringify(missing));
    expect(r.ok === false && r.reason).toMatch(/no longer in the game/);
    const finished = structuredClone(env);
    finished.snapshot.winner = 0;
    const f = readEnvelope(JSON.stringify(finished));
    expect(f.ok === false && f.finished).toBe(true);
  });

  it('bench: the AI beats the random baseline in at least 95% of games (both seats)', () => {
    let wins = 0;
    const games = 100;
    for (let i = 0; i < games; i++) {
      const aiSeat = i % 2;
      const policies = aiSeat === 0 ? [normal, random] : [random, normal];
      const { s } = playOut(1000 + i, policies, { invariants: true });
      if (s.winner === aiSeat) wins++;
    }
    console.log(`bench: AI beat random in ${wins}/${games} games`);
    expect(wins / games).toBeGreaterThanOrEqual(0.95);
  });
});
