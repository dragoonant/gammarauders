import { CARDS, TRAMPLE, getCard, type CardDef, type WeaponStats } from './cards';
import { distance, hexEquals, hexKey, neighbors } from './hex';
import { basePositions, generateTiles } from './map';
import { rollD6, shuffle, randInt } from './rng';
import {
  SLOT_COUNTS,
  SLOT_ORDER,
  slotLabel,
  type Action,
  type ActionResult,
  type CardInst,
  type GameEvent,
  type GameState,
  type Hex,
  type Player,
  type Slot,
  type Tile,
} from './types';

export const RULES = {
  baseHull: 24,
  baseMove: 3,
  baseHitOn: 4,
  baseIncome: 2,
  energyCap: 12,
  handLimit: 7,
  drawPerTurn: 2,
  startHand: 4,
  startEnergy: 3,
  killVP: 5,
  radDamage: 2,
  vpToWin: 25,
  maxRounds: 30,
  logLimit: 300,
};

export interface PlayerSetup {
  name: string;
  beast: string;
  color: string;
  isAI: boolean;
}

export interface GameOptions {
  players: PlayerSetup[];
  seed?: number;
  vpToWin?: number;
  maxRounds?: number;
  radius?: number;
}

// ---------------------------------------------------------------------------
// Setup

function emptySlots(): Record<Slot, (CardInst | null)[]> {
  const s = {} as Record<Slot, (CardInst | null)[]>;
  for (const slot of SLOT_ORDER) s[slot] = new Array(SLOT_COUNTS[slot]).fill(null);
  return s;
}

export function createGame(opts: GameOptions): GameState {
  const n = opts.players.length;
  if (n < 2 || n > 4) throw new Error('Wasteland Behemoths supports 2–4 players');
  const radius = opts.radius ?? 6;
  const seed = (opts.seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0;
  const state: GameState = {
    seed,
    radius,
    tiles: {},
    players: [],
    current: 0,
    round: 1,
    deck: [],
    discard: [],
    rng: seed,
    nextUid: 1,
    vpToWin: opts.vpToWin ?? RULES.vpToWin,
    maxRounds: opts.maxRounds ?? RULES.maxRounds,
    winner: null,
    log: [],
  };
  state.tiles = generateTiles(state, radius, n);
  for (const def of CARDS) {
    for (let i = 0; i < def.count; i++) state.deck.push({ uid: state.nextUid++, defId: def.id });
  }
  shuffle(state, state.deck);
  const bases = basePositions(radius, n);
  state.players = opts.players.map((s, id) => ({
    id,
    name: s.name,
    beast: s.beast,
    color: s.color,
    isAI: s.isAI,
    hull: RULES.baseHull,
    pos: { ...bases[id] },
    destroyed: false,
    energy: RULES.startEnergy + id, // later seats get a head start to offset going first
    vp: 0,
    hand: [],
    slots: emptySlots(),
    movesLeft: 0,
    hasMoved: false,
    fired: [],
    // The first player starts a step slower to offset going first.
    stun: id === 0 ? 1 : 0,
    tempArmor: 0,
    kills: 0,
  }));
  for (const p of state.players) drawCards(state, p, RULES.startHand);
  log(state, null, `The war for the wastes begins. First to ${state.vpToWin} VP wins.`);
  beginTurn(state, []);
  return state;
}

// ---------------------------------------------------------------------------
// Queries

export const currentPlayer = (s: GameState): Player => s.players[s.current];

export function tileAt(s: GameState, h: Hex): Tile | undefined {
  return s.tiles[hexKey(h)];
}

export function occupant(s: GameState, h: Hex): Player | undefined {
  return s.players.find((p) => !p.destroyed && hexEquals(p.pos, h));
}

export function alivePlayers(s: GameState): Player[] {
  return s.players.filter((p) => !p.destroyed);
}

export function wellsOwned(s: GameState, pid: number): Tile[] {
  return Object.values(s.tiles).filter((t) => t.well && t.well.owner === pid);
}

export function wellIncomeVP(s: GameState, pid: number): number {
  return wellsOwned(s, pid).reduce((sum, t) => sum + (t.well?.value ?? 0), 0);
}

export interface GraftView {
  slot: Slot;
  index: number;
  card: CardInst;
  def: CardDef;
}

export function grafts(p: Player): GraftView[] {
  const out: GraftView[] = [];
  for (const slot of SLOT_ORDER) {
    p.slots[slot].forEach((card, index) => {
      if (card) out.push({ slot, index, card, def: getCard(card.defId) });
    });
  }
  return out;
}

export interface Stats {
  maxHull: number;
  armor: number;
  move: number;
  hitBonus: number;
  regen: number;
  energyBonus: number;
  radImmune: boolean;
  radFeeder: boolean;
  terrainWalker: boolean;
}

export function playerStats(p: Player): Stats {
  const st: Stats = {
    maxHull: RULES.baseHull,
    armor: 0,
    move: RULES.baseMove,
    hitBonus: 0,
    regen: 0,
    energyBonus: 0,
    radImmune: false,
    radFeeder: false,
    terrainWalker: false,
  };
  for (const { def } of grafts(p)) {
    const m = def.mods;
    if (!m) continue;
    st.maxHull += m.maxHull ?? 0;
    st.armor += m.armor ?? 0;
    st.move += m.move ?? 0;
    st.hitBonus += m.hitBonus ?? 0;
    st.regen += m.regen ?? 0;
    st.energyBonus += m.energy ?? 0;
    st.radImmune ||= !!m.radImmune;
    st.radFeeder ||= !!m.radFeeder;
    st.terrainWalker ||= !!m.terrainWalker;
  }
  st.move = Math.max(1, st.move);
  st.armor += p.tempArmor;
  return st;
}

export function energyIncome(s: GameState, p: Player): number {
  return RULES.baseIncome + wellsOwned(s, p.id).length + playerStats(p).energyBonus;
}

export function moveCost(tile: Tile, st: Stats): number {
  switch (tile.terrain) {
    case 'mountain':
      return Infinity;
    case 'ruins':
    case 'swamp':
      return st.terrainWalker ? 1 : 2;
    default:
      return 1;
  }
}

export interface Reach {
  cost: number;
  /** Hexes entered, start excluded, destination included. */
  path: Hex[];
}

/** Cheapest paths to every hex reachable within `budget` movement. Occupied hexes block. */
export function reachable(s: GameState, p: Player, budget = p.movesLeft): Map<string, Reach> {
  const out = new Map<string, Reach>();
  if (!p.pos || p.destroyed) return out;
  const st = playerStats(p);
  const best = new Map<string, Reach>([[hexKey(p.pos), { cost: 0, path: [] }]]);
  const frontier: { h: Hex; cost: number }[] = [{ h: p.pos, cost: 0 }];
  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost);
    const { h, cost } = frontier.shift()!;
    const here = best.get(hexKey(h))!;
    if (cost > here.cost) continue;
    for (const n of neighbors(h)) {
      const t = tileAt(s, n);
      if (!t || occupant(s, n)) continue;
      const c = cost + moveCost(t, st);
      if (c > budget) continue;
      const k = hexKey(n);
      const prev = best.get(k);
      if (prev && prev.cost <= c) continue;
      const r = { cost: c, path: [...here.path, { q: n.q, r: n.r }] };
      best.set(k, r);
      out.set(k, r);
      frontier.push({ h: n, cost: c });
    }
  }
  return out;
}

export interface WeaponView {
  id: string;
  name: string;
  stats: WeaponStats;
  ready: boolean;
  slot: Slot | null;
}

export function weapons(p: Player): WeaponView[] {
  const list: WeaponView[] = grafts(p)
    .filter((g) => g.def.weapon)
    .map((g) => ({
      id: `g${g.card.uid}`,
      name: g.def.name,
      stats: g.def.weapon!,
      ready: !p.fired.includes(`g${g.card.uid}`),
      slot: g.slot,
    }));
  list.push({ id: 'trample', name: 'Trample', stats: TRAMPLE, ready: !p.fired.includes('trample'), slot: null });
  return list;
}

/** Die result needed for each shot to hit (cover from ruins makes it harder). */
export function hitOnAgainst(s: GameState, attacker: Player, target: Player, targetTile?: Tile): number {
  const tile = targetTile ?? (target.pos ? tileAt(s, target.pos) : undefined);
  const cover = tile?.terrain === 'ruins' ? 1 : 0;
  return Math.min(6, Math.max(2, RULES.baseHitOn - playerStats(attacker).hitBonus + cover));
}

export function damagePerHit(w: WeaponStats, targetArmor: number): number {
  return w.pierce ? w.damage : Math.max(1, w.damage - targetArmor);
}

export function expectedDamage(
  s: GameState,
  attacker: Player,
  target: Player,
  w: WeaponStats,
  targetTile?: Tile,
): number {
  const hitOn = hitOnAgainst(s, attacker, target, targetTile);
  const pHit = (7 - hitOn) / 6;
  return w.shots * pHit * damagePerHit(w, playerStats(target).armor);
}

export function enemiesInRange(s: GameState, p: Player, range: number): Player[] {
  if (!p.pos) return [];
  return s.players.filter(
    (e) => e.id !== p.id && !e.destroyed && e.pos && distance(p.pos!, e.pos) <= range,
  );
}

export interface GraftOption {
  slot: Slot;
  index: number;
  replacing: CardInst | null;
}

export function graftOptions(p: Player, card: CardInst): GraftOption[] {
  const def = getCard(card.defId);
  if (!def.slot) return [];
  return p.slots[def.slot].map((occ, index) => ({ slot: def.slot!, index, replacing: occ }));
}

export function tacticTargets(s: GameState, p: Player, def: CardDef): Player[] {
  if (!def.targetRange) return [];
  const list = enemiesInRange(s, p, def.targetRange);
  return def.tactic === 'blight' ? list.filter((e) => grafts(e).length > 0) : list;
}

// ---------------------------------------------------------------------------
// Mutations

function log(s: GameState, player: number | null, text: string): void {
  s.log.push({ text, player, round: s.round });
  if (s.log.length > RULES.logLimit) s.log.splice(0, s.log.length - RULES.logLimit);
}

function drawCards(s: GameState, p: Player, n: number): number {
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    if (p.hand.length >= RULES.handLimit) break;
    if (s.deck.length === 0) {
      if (s.discard.length === 0) break;
      s.deck = shuffle(s, s.discard);
      s.discard = [];
      log(s, null, 'The scrap pile is reshuffled into the deck.');
    }
    p.hand.push(s.deck.pop()!);
    drawn++;
  }
  return drawn;
}

function heal(p: Player, amount: number, events: GameEvent[]): number {
  const max = playerStats(p).maxHull;
  const gained = Math.max(0, Math.min(amount, max - p.hull));
  p.hull += gained;
  if (gained > 0) events.push({ kind: 'heal', player: p.id, amount: gained });
  return gained;
}

function clampHull(p: Player): void {
  p.hull = Math.max(1, Math.min(p.hull, playerStats(p).maxHull));
}

function checkWin(s: GameState): void {
  if (s.winner !== null) return;
  const contenders = s.players.filter((p) => p.vp >= s.vpToWin);
  if (contenders.length === 0) return;
  contenders.sort((a, b) => b.vp - a.vp || (a.id === s.current ? -1 : b.id === s.current ? 1 : 0));
  s.winner = contenders[0].id;
  log(s, s.winner, `${contenders[0].name} rules the wastes with ${contenders[0].vp} VP!`);
}

function dealDamage(
  s: GameState,
  target: Player,
  amount: number,
  attacker: Player | null,
  source: string,
  events: GameEvent[],
): void {
  if (target.destroyed || amount <= 0) return;
  target.hull -= amount;
  events.push({ kind: 'damage', target: target.id, amount, source });
  if (target.hull > 0) return;

  target.hull = 0;
  target.destroyed = true;
  target.pos = null;
  target.stun = 0;
  target.tempArmor = 0;
  for (const g of grafts(target)) {
    s.discard.push(g.card);
    target.slots[g.slot][g.index] = null;
  }
  events.push({ kind: 'destroyed', player: target.id, by: attacker?.id ?? null });
  if (attacker) {
    attacker.vp += RULES.killVP;
    attacker.kills++;
    log(s, attacker.id, `${attacker.beast} destroys ${target.beast}! ${attacker.name} gains ${RULES.killVP} VP.`);
    checkWin(s);
  } else {
    log(s, target.id, `${target.beast} collapses from ${source}.`);
  }
}

function respawn(s: GameState, p: Player): void {
  const base = basePositions(s.radius, s.players.length)[p.id];
  // Nearest free, passable hex to the base.
  const seen = new Set<string>([hexKey(base)]);
  const queue: Hex[] = [base];
  while (queue.length) {
    const h = queue.shift()!;
    const t = tileAt(s, h);
    if (t && t.terrain !== 'mountain' && !occupant(s, h)) {
      p.pos = { q: h.q, r: h.r };
      break;
    }
    for (const n of neighbors(h)) {
      if (!seen.has(hexKey(n)) && tileAt(s, n)) {
        seen.add(hexKey(n));
        queue.push(n);
      }
    }
  }
  p.destroyed = false;
  p.hull = playerStats(p).maxHull;
  log(s, p.id, `A new ${p.beast} crawls out of ${p.name}'s vats.`);
}

function beginTurn(s: GameState, events: GameEvent[]): void {
  const p = currentPlayer(s);
  events.push({ kind: 'turn', player: p.id });
  if (p.destroyed) respawn(s, p);

  const vp = wellIncomeVP(s, p.id);
  if (vp > 0) {
    p.vp += vp;
    log(s, p.id, `${p.name} harvests ${vp} VP from their Rad Wells.`);
    checkWin(s);
    if (s.winner !== null) return;
  }

  p.tempArmor = 0;
  const st = playerStats(p);
  let income = energyIncome(s, p);
  const tile = p.pos ? tileAt(s, p.pos) : undefined;
  if (st.radFeeder && tile?.terrain === 'rad') income += 1;
  p.energy = Math.min(RULES.energyCap, p.energy + income);
  if (st.regen) heal(p, st.regen, events);
  drawCards(s, p, RULES.drawPerTurn);

  p.movesLeft = Math.max(0, st.move - p.stun);
  if (p.stun) {
    const lost = Math.min(p.stun, st.move);
    log(
      s,
      p.id,
      s.round === 1 && p.id === 0
        ? `${p.name} moves first, so ${p.beast} gets ${lost} less movement this turn.`
        : `${p.beast} is still reeling and loses ${lost} movement.`,
    );
  }
  p.stun = 0;
  p.hasMoved = false;
  p.fired = [];
}

function endTurn(s: GameState, events: GameEvent[]): void {
  const p = currentPlayer(s);
  const tile = p.pos ? tileAt(s, p.pos) : undefined;
  if (tile?.terrain === 'rad' && !playerStats(p).radImmune) {
    log(s, p.id, `${p.beast} soaks up radiation (−${RULES.radDamage}).`);
    dealDamage(s, p, RULES.radDamage, null, 'radiation', events);
  }

  s.current = (s.current + 1) % s.players.length;
  if (s.current === 0) {
    s.round++;
    if (s.round > s.maxRounds) {
      const ranked = [...s.players].sort(
        (a, b) => b.vp - a.vp || wellsOwned(s, b.id).length - wellsOwned(s, a.id).length || b.hull - a.hull,
      );
      s.winner = ranked[0].id;
      log(s, s.winner, `The dust settles after ${s.maxRounds} rounds. ${ranked[0].name} wins on points.`);
      return;
    }
  }
  beginTurn(s, events);
}

function findInHand(p: Player, uid: number): CardInst | undefined {
  return p.hand.find((c) => c.uid === uid);
}

function removeFromHand(p: Player, uid: number): void {
  p.hand = p.hand.filter((c) => c.uid !== uid);
}

const fail = (error: string): ActionResult => ({ ok: false, error, events: [] });

/** Applies an action for the current player. Illegal actions change nothing. */
export function applyAction(s: GameState, a: Action): ActionResult {
  if (s.winner !== null) return fail('The game is over.');
  const p = currentPlayer(s);
  const events: GameEvent[] = [];

  switch (a.type) {
    case 'endTurn':
      endTurn(s, events);
      return { ok: true, events };

    case 'scrap': {
      const card = findInHand(p, a.cardUid);
      if (!card) return fail('That card is not in your hand.');
      removeFromHand(p, card.uid);
      s.discard.push(card);
      p.energy = Math.min(RULES.energyCap, p.energy + 1);
      log(s, p.id, `${p.name} scraps ${getCard(card.defId).name} for 1 energy.`);
      return { ok: true, events };
    }

    case 'graft': {
      const card = findInHand(p, a.cardUid);
      if (!card) return fail('That card is not in your hand.');
      const def = getCard(card.defId);
      if (def.kind === 'tactic' || def.slot !== a.slot) return fail(`${def.name} cannot be grafted there.`);
      if (a.index < 0 || a.index >= SLOT_COUNTS[a.slot]) return fail('No such slot.');
      if (!p.pos || p.destroyed) return fail('Your Behemoth is not on the field.');
      if (p.energy < def.cost) return fail(`Not enough energy (needs ${def.cost}).`);
      p.energy -= def.cost;
      removeFromHand(p, card.uid);
      const moveBefore = playerStats(p).move;
      const old = p.slots[a.slot][a.index];
      if (old) s.discard.push(old);
      p.slots[a.slot][a.index] = card;
      if (def.mods?.maxHull) heal(p, def.mods.maxHull, events);
      clampHull(p);
      p.movesLeft = Math.max(0, p.movesLeft + playerStats(p).move - moveBefore);
      log(
        s,
        p.id,
        `${p.beast} grafts ${def.name} to its ${slotLabel(a.slot, a.index)}` +
          (old ? `, discarding ${getCard(old.defId).name}.` : '.'),
      );
      return { ok: true, events };
    }

    case 'play': {
      const card = findInHand(p, a.cardUid);
      if (!card) return fail('That card is not in your hand.');
      const def = getCard(card.defId);
      if (def.kind !== 'tactic' || !def.tactic) return fail(`${def.name} must be grafted, not played.`);
      if (p.energy < def.cost) return fail(`Not enough energy (needs ${def.cost}).`);
      if (!p.pos || p.destroyed) return fail('Your Behemoth is not on the field.');
      let target: Player | undefined;
      if (def.targetRange) {
        target = tacticTargets(s, p, def).find((e) => e.id === a.targetId);
        if (!target) return fail('Choose a valid target in range.');
      }
      p.energy -= def.cost;
      removeFromHand(p, card.uid);
      s.discard.push(card);
      log(s, p.id, `${p.name} plays ${def.name}${target ? ` on ${target.beast}` : ''}.`);
      switch (def.tactic) {
        case 'repair':
          heal(p, 6, events);
          break;
        case 'overdrive':
          p.movesLeft += 3;
          break;
        case 'scavenge':
          drawCards(s, p, 2);
          break;
        case 'surge':
          p.energy = Math.min(RULES.energyCap, p.energy + 2);
          break;
        case 'radflare':
          dealDamage(s, target!, 3, p, 'a Rad Flare', events);
          break;
        case 'blight': {
          const gs = grafts(target!);
          const g = gs[randInt(s, gs.length)];
          target!.slots[g.slot][g.index] = null;
          s.discard.push(g.card);
          clampHull(target!);
          log(s, p.id, `${target!.beast}'s ${g.def.name} withers away.`);
          break;
        }
        case 'reload':
          p.fired = [];
          break;
        case 'spores':
          p.tempArmor += 2;
          break;
      }
      return { ok: true, events };
    }

    case 'move': {
      if (!p.pos || p.destroyed) return fail('Your Behemoth is not on the field.');
      const reach = reachable(s, p).get(hexKey(a.to));
      if (!reach) return fail('You cannot reach that hex.');
      p.movesLeft -= reach.cost;
      p.hasMoved = true;
      events.push({ kind: 'move', player: p.id, path: [{ ...p.pos }, ...reach.path] });
      for (const h of reach.path) {
        const t = tileAt(s, h)!;
        if (t.well && t.well.owner !== p.id) {
          const prev = t.well.owner;
          t.well.owner = p.id;
          events.push({ kind: 'claim', player: p.id, hex: h });
          log(
            s,
            p.id,
            `${p.beast} claims a ${t.well.value > 1 ? 'Heart Well' : 'Rad Well'}` +
              (prev !== null ? ` from ${s.players[prev].name}.` : '.'),
          );
        }
      }
      p.pos = { ...a.to };
      return { ok: true, events };
    }

    case 'fire': {
      const w = weapons(p).find((x) => x.id === a.weaponId);
      if (!w) return fail('No such weapon.');
      if (!w.ready) return fail(`${w.name} has already fired this turn.`);
      const target = s.players.find((e) => e.id === a.targetId);
      if (!target || target.id === p.id || target.destroyed || !target.pos || !p.pos) return fail('Invalid target.');
      if (distance(p.pos, target.pos) > w.stats.range) return fail('Target is out of range.');
      p.fired.push(w.id);
      const hitOn = hitOnAgainst(s, p, target);
      const rolls = Array.from({ length: w.stats.shots }, () => rollD6(s));
      const hits = rolls.filter((r) => r >= hitOn).length;
      const damage = hits * damagePerHit(w.stats, playerStats(target).armor);
      events.push({ kind: 'shot', attacker: p.id, target: target.id, weapon: w.name, rolls, hitOn, hits, damage });
      log(
        s,
        p.id,
        `${p.beast} fires ${w.name} at ${target.beast}: rolled ${rolls.join(', ')} (need ${hitOn}+) → ` +
          (hits ? `${hits} hit${hits > 1 ? 's' : ''}, ${damage} damage.` : 'miss.'),
      );
      if (hits && w.stats.stun) target.stun += w.stats.stun;
      if (damage && w.stats.leech) heal(p, damage, events);
      dealDamage(s, target, damage, p, w.name, events);
      return { ok: true, events };
    }
  }
}
