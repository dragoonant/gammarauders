/** Seeded PRNG (mulberry32). The state lives on the game object so games are reproducible. */
export interface RngHolder {
  rng: number;
}

export function nextRandom(s: RngHolder): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function rollD6(s: RngHolder): number {
  return 1 + Math.floor(nextRandom(s) * 6);
}

export function randInt(s: RngHolder, n: number): number {
  return Math.floor(nextRandom(s) * n);
}

export function shuffle<T>(s: RngHolder, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(s, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
