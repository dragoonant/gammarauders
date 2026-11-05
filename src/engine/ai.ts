import { getCard, type CardDef, type WeaponStats } from './cards';
import { distance, hexKey } from './hex';
import {
  alivePlayers,
  currentPlayer,
  enemiesInRange,
  expectedDamage,
  graftOptions,
  grafts,
  playerStats,
  reachable,
  tacticTargets,
  tileAt,
  weapons,
} from './rules';
import type { Action, CardInst, GameState, Hex, Player, Tile } from './types';

/** Per-turn memory for the AI so it doesn't reconsider moving forever. */
export interface AIContext {
  moveDone: boolean;
}

export const newAIContext = (): AIContext => ({ moveDone: false });

// ---------------------------------------------------------------------------
// Card valuation

function weaponValue(w: WeaponStats): number {
  const perHit = w.pierce ? w.damage : Math.max(1, w.damage - 0.7);
  const rangeFactor = 0.6 + 0.2 * w.range;
  return w.shots * 0.5 * perHit * rangeFactor + (w.stun ? 1 : 0) + (w.leech ? 1.5 : 0);
}

export function cardValue(s: GameState, p: Player, def: CardDef): number {
  if (def.weapon) return weaponValue(def.weapon);
  if (def.mods) {
    const m = def.mods;
    const weaponCount = weapons(p).length;
    let v = 0;
    v += (m.armor ?? 0) * 2.2;
    v += (m.move ?? 0) * 1.6;
    v += ((m.maxHull ?? 0) / 6) * 2;
    v += (m.regen ?? 0) * 1.25;
    v += (m.energy ?? 0) * (s.round < 15 ? 2.5 : 1);
    v += m.hitBonus ? 0.6 + 0.5 * weaponCount : 0;
    v += m.radImmune ? 0.4 : 0;
    v += m.radFeeder ? 0.4 : 0;
    v += m.terrainWalker ? 1 : 0;
    return v;
  }
  return 1.5;
}

// ---------------------------------------------------------------------------
// Positional evaluation

function weaponDamageAt(s: GameState, attacker: Player, from: Hex, target: Player, onlyReady: boolean): number {
  if (!target.pos) return 0;
  const d = distance(from, target.pos);
  let sum = 0;
  for (const w of weapons(attacker)) {
    if (onlyReady && !w.ready) continue;
    if (d <= w.stats.range) sum += expectedDamage(s, attacker, target, w.stats);
  }
  return sum;
}

/** Expected damage an enemy could deal to `p` standing on `tile` next turn. */
function threatAt(s: GameState, p: Player, tile: Tile): number {
  let total = 0;
  for (const e of alivePlayers(s)) {
    if (e.id === p.id || !e.pos) continue;
    const reach = playerStats(e).move;
    const d = distance(e.pos, tile);
    for (const w of weapons(e)) {
      if (d <= reach + w.stats.range) total += expectedDamage(s, e, p, w.stats, tile);
    }
  }
  return total;
}

function targetWells(s: GameState, p: Player): Tile[] {
  return Object.values(s.tiles).filter((t) => t.well && t.well.owner !== p.id);
}

function scorePosition(s: GameState, p: Player, h: Hex, path: Hex[]): number {
  const tile = tileAt(s, h)!;
  const st = playerStats(p);
  const hullFrac = p.hull / st.maxHull;
  let score = 0;

  const claimed = new Set<string>();
  for (const step of path) {
    const t = tileAt(s, step)!;
    if (t.well && t.well.owner !== p.id) {
      score += 12 * t.well.value + (t.well.owner !== null ? 4 : 0);
      claimed.add(hexKey(t));
    }
  }
  // Sitting on a well you own blocks enemies from taking it.
  if (tile.well && (tile.well.owner === p.id || claimed.has(hexKey(tile)))) score += 2 * tile.well.value;

  const remaining = targetWells(s, p).filter((t) => !claimed.has(hexKey(t)));
  if (remaining.length) {
    const d = Math.min(...remaining.map((t) => distance(h, t)));
    score -= 1.5 * d;
  }

  let bestAttack = 0;
  for (const e of alivePlayers(s)) {
    if (e.id === p.id) continue;
    const dmg = weaponDamageAt(s, p, h, e, true);
    let v = 1.2 * dmg;
    if (dmg >= e.hull * 0.8) v += 10;
    bestAttack = Math.max(bestAttack, v);
  }
  score += bestAttack;

  const risk = hullFrac < 0.4 ? 1.2 : 0.35;
  score -= threatAt(s, p, tile) * risk;

  if (hullFrac < 0.35) {
    const enemies = alivePlayers(s).filter((e) => e.id !== p.id && e.pos);
    if (enemies.length) score += Math.min(...enemies.map((e) => distance(h, e.pos!)));
  }

  if (tile.terrain === 'ruins') score += 1.5;
  if (tile.terrain === 'rad' && !st.radImmune) score -= 5;
  return score;
}

// ---------------------------------------------------------------------------
// Decisions

function chooseGraft(s: GameState, p: Player): Action | null {
  let best: { action: Action; gain: number } | null = null;
  for (const card of p.hand) {
    const def = getCard(card.defId);
    if (def.kind === 'tactic' || def.cost > p.energy) continue;
    const value = cardValue(s, p, def);
    for (const opt of graftOptions(p, card)) {
      const loss = opt.replacing ? cardValue(s, p, getCard(opt.replacing.defId)) * 1.2 + 0.5 : 0;
      const gain = value - loss;
      if (gain > 0.3 && (!best || gain > best.gain)) {
        best = { action: { type: 'graft', cardUid: card.uid, slot: opt.slot, index: opt.index }, gain };
      }
    }
  }
  return best?.action ?? null;
}

function chooseMove(s: GameState, p: Player): Action | null {
  if (!p.pos || p.movesLeft <= 0) return null;
  let bestHex: Hex = p.pos;
  let bestScore = scorePosition(s, p, p.pos, []);
  for (const [, r] of reachable(s, p)) {
    const dest = r.path[r.path.length - 1];
    const sc = scorePosition(s, p, dest, r.path) - r.cost * 0.05;
    if (sc > bestScore + 0.01) {
      bestScore = sc;
      bestHex = dest;
    }
  }
  return bestHex === p.pos ? null : { type: 'move', to: bestHex };
}

function chooseFire(s: GameState, p: Player): Action | null {
  if (!p.pos) return null;
  // Strongest weapons first, so the kill shot goes where it matters.
  const ready = weapons(p)
    .filter((w) => w.ready)
    .sort((a, b) => b.stats.damage * b.stats.shots - a.stats.damage * a.stats.shots);
  for (const w of ready) {
    const targets = enemiesInRange(s, p, w.stats.range);
    if (!targets.length) continue;
    let best = targets[0];
    let bestV = -Infinity;
    for (const t of targets) {
      const ev = expectedDamage(s, p, t, w.stats);
      const v = ev + (ev >= t.hull ? 20 : 0) + (1 - t.hull / playerStats(t).maxHull) * 2 + t.vp * 0.05;
      if (v > bestV) {
        bestV = v;
        best = t;
      }
    }
    return { type: 'fire', weaponId: w.id, targetId: best.id };
  }
  return null;
}

function hasCard(p: Player, pred: (d: CardDef) => boolean): CardInst | undefined {
  return p.hand.find((c) => {
    const d = getCard(c.defId);
    return pred(d) && d.cost <= p.energy;
  });
}

function chooseTactic(s: GameState, p: Player, ctx: AIContext, phase: 'pre' | 'post'): Action | null {
  const st = playerStats(p);
  const play = (c: CardInst, targetId?: number): Action => ({ type: 'play', cardUid: c.uid, targetId });

  if (phase === 'pre') {
    const repair = hasCard(p, (d) => d.tactic === 'repair');
    if (repair && (p.hull <= st.maxHull - 6 || p.hull < st.maxHull * 0.5)) return play(repair);

    const scav = hasCard(p, (d) => d.tactic === 'scavenge');
    if (scav && p.hand.length <= 5) return play(scav);

    const flare = hasCard(p, (d) => d.tactic === 'radflare');
    if (flare) {
      const ts = tacticTargets(s, p, getCard(flare.defId)).sort((a, b) => a.hull - b.hull);
      if (ts.length) return play(flare, ts[0].id);
    }

    const blight = hasCard(p, (d) => d.tactic === 'blight');
    if (blight) {
      const ts = tacticTargets(s, p, getCard(blight.defId)).sort((a, b) => grafts(b).length - grafts(a).length);
      if (ts.length) return play(blight, ts[0].id);
    }

    const surge = hasCard(p, (d) => d.tactic === 'surge');
    if (surge) {
      const wants = p.hand.some((c) => {
        const d = getCard(c.defId);
        return d.kind !== 'tactic' && d.cost > p.energy && d.cost <= p.energy + 2;
      });
      if (wants) return play(surge);
    }

    const adrenal = hasCard(p, (d) => d.tactic === 'overdrive');
    if (adrenal && !ctx.moveDone && p.pos) {
      const now = reachable(s, p);
      const later = reachable(s, p, p.movesLeft + 3);
      const wells = targetWells(s, p);
      const reachableNow = wells.some((w) => now.has(hexKey(w)));
      const reachableLater = wells.some((w) => later.has(hexKey(w)));
      if (!reachableNow && reachableLater) return play(adrenal);
    }
  } else {
    const reload = hasCard(p, (d) => d.tactic === 'reload');
    if (reload) {
      const reloadable = weapons(p).filter(
        (w) => !w.ready && w.id !== 'trample' && enemiesInRange(s, p, w.stats.range).length > 0,
      );
      if (reloadable.length >= 2) return play(reload);
    }
    const spores = hasCard(p, (d) => d.tactic === 'spores');
    if (spores && p.pos && threatAt(s, p, tileAt(s, p.pos)!) > 4) return play(spores);
  }
  return null;
}

function chooseScrap(s: GameState, p: Player): Action | null {
  if (p.hand.length < 6) return null;
  let worst: CardInst | null = null;
  let worstV = Infinity;
  for (const c of p.hand) {
    const d = getCard(c.defId);
    let v = cardValue(s, p, d);
    if (d.slot) {
      // A card that can't beat what's already grafted is worth little.
      const opts = graftOptions(p, c);
      const best = Math.max(...opts.map((o) => (o.replacing ? v - cardValue(s, p, getCard(o.replacing.defId)) : v)));
      v = Math.min(v, best + 0.5);
    }
    if (v < worstV) {
      worstV = v;
      worst = c;
    }
  }
  return worst ? { type: 'scrap', cardUid: worst.uid } : null;
}

/**
 * The bench baseline: a uniformly random legal action (graft, play, move, fire or end turn).
 * The real AI must beat it in at least 95% of games (KB recipe step 6).
 */
export function randomAction(s: GameState, rand: () => number = Math.random): Action {
  const p = currentPlayer(s);
  const options: Action[] = [{ type: 'endTurn' }];
  for (const c of p.hand) {
    const d = getCard(c.defId);
    if (d.cost > p.energy) continue;
    if (d.kind === 'tactic') {
      const ts = tacticTargets(s, p, d);
      if (d.targetRange) ts.forEach((t) => options.push({ type: 'play', cardUid: c.uid, targetId: t.id }));
      else options.push({ type: 'play', cardUid: c.uid });
    } else {
      for (const o of graftOptions(p, c)) options.push({ type: 'graft', cardUid: c.uid, slot: o.slot, index: o.index });
    }
  }
  for (const [, r] of reachable(s, p)) options.push({ type: 'move', to: r.path[r.path.length - 1] });
  for (const w of weapons(p)) {
    if (!w.ready) continue;
    for (const t of enemiesInRange(s, p, w.stats.range)) options.push({ type: 'fire', weaponId: w.id, targetId: t.id });
  }
  return options[Math.floor(rand() * options.length)];
}

/** Picks the next action for the current (AI) player. Call repeatedly until it returns endTurn. */
export function planAction(s: GameState, ctx: AIContext): Action {
  const p = currentPlayer(s);
  return (
    chooseTactic(s, p, ctx, 'pre') ??
    chooseGraft(s, p) ??
    (ctx.moveDone ? null : ((ctx.moveDone = true), chooseMove(s, p))) ??
    chooseFire(s, p) ??
    chooseTactic(s, p, ctx, 'post') ??
    chooseScrap(s, p) ?? { type: 'endTurn' }
  );
}
