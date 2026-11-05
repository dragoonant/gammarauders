import type { Hex } from './types';

/** Axial hex directions, pointy-top layout. */
export const DIRS: Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export const hexKey = (h: Hex): string => `${h.q},${h.r}`;

export function parseKey(k: string): Hex {
  const [q, r] = k.split(',').map(Number);
  return { q, r };
}

export const hexEquals = (a: Hex | null | undefined, b: Hex | null | undefined): boolean =>
  !!a && !!b && a.q === b.q && a.r === b.r;

export function distance(a: Hex, b: Hex): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

export function neighbors(h: Hex): Hex[] {
  return DIRS.map((d) => ({ q: h.q + d.q, r: h.r + d.r }));
}

export function scale(h: Hex, k: number): Hex {
  return { q: h.q * k, r: h.r * k };
}

/** All hexes within `radius` of the origin, in a stable order. */
export function allHexes(radius: number): Hex[] {
  const out: Hex[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      out.push({ q, r });
    }
  }
  return out;
}

/** Pixel center of a pointy-top hex. */
export function hexToPixel(h: Hex, size: number): { x: number; y: number } {
  return { x: size * Math.sqrt(3) * (h.q + h.r / 2), y: size * 1.5 * h.r };
}

export function hexCorners(cx: number, cy: number, size: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(cx + size * Math.cos(a)).toFixed(2)},${(cy + size * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}
