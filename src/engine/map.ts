import { DIRS, allHexes, hexKey, neighbors, scale } from './hex';
import { nextRandom, type RngHolder } from './rng';
import type { Hex, Terrain, Tile } from './types';

const TERRAIN_WEIGHTS: [Terrain, number][] = [
  ['plains', 48],
  ['ruins', 18],
  ['swamp', 12],
  ['rad', 11],
  ['mountain', 11],
];

function pickTerrain(rng: RngHolder): Terrain {
  const total = TERRAIN_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let x = nextRandom(rng) * total;
  for (const [t, w] of TERRAIN_WEIGHTS) {
    if ((x -= w) < 0) return t;
  }
  return 'plains';
}

/** Home bases sit on corners of the board, spread out by player count. */
export function basePositions(radius: number, players: number): Hex[] {
  const corners = players === 2 ? [0, 3] : players === 3 ? [0, 2, 4] : [0, 1, 3, 4];
  return corners.map((i) => scale(DIRS[i], radius));
}

/** Rad Wells: a 2-point Heart Well in the center, ringed by six 1-point wells. */
export function wellPositions(radius: number): { hex: Hex; value: number }[] {
  const ring = Math.max(2, Math.round(radius / 2));
  return [{ hex: { q: 0, r: 0 }, value: 2 }, ...DIRS.map((d) => ({ hex: scale(d, ring), value: 1 }))];
}

/**
 * Builds a point-symmetric random map (fair for opposite bases), with wells and bases on
 * open ground, and guarantees every base and well can reach every other.
 */
export function generateTiles(rng: RngHolder, radius: number, players: number): Record<string, Tile> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const tiles: Record<string, Tile> = {};
    for (const h of allHexes(radius)) {
      if (tiles[hexKey(h)]) continue;
      const terrain = pickTerrain(rng);
      for (const m of [h, { q: -h.q, r: -h.r }]) {
        tiles[hexKey(m)] = { q: m.q, r: m.r, terrain, well: null, base: null };
      }
    }
    const specials: Hex[] = [];
    for (const { hex, value } of wellPositions(radius)) {
      const t = tiles[hexKey(hex)];
      t.terrain = 'plains';
      t.well = { value, owner: null };
      specials.push(hex);
    }
    basePositions(radius, players).forEach((hex, i) => {
      const t = tiles[hexKey(hex)];
      t.terrain = 'plains';
      t.base = i;
      specials.push(hex);
    });
    // Keep the ground around key sites passable.
    for (const s of specials) {
      for (const n of neighbors(s)) {
        const t = tiles[hexKey(n)];
        if (t && t.terrain === 'mountain') t.terrain = 'plains';
      }
    }
    if (connected(tiles, specials)) return tiles;
  }
  throw new Error('Could not generate a connected map');
}

function connected(tiles: Record<string, Tile>, specials: Hex[]): boolean {
  const seen = new Set<string>([hexKey(specials[0])]);
  const queue: Hex[] = [specials[0]];
  while (queue.length) {
    const h = queue.shift()!;
    for (const n of neighbors(h)) {
      const k = hexKey(n);
      const t = tiles[k];
      if (!t || t.terrain === 'mountain' || seen.has(k)) continue;
      seen.add(k);
      queue.push(n);
    }
  }
  return specials.every((s) => seen.has(hexKey(s)));
}
