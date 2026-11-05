import type { Slot } from './types';

export type TacticId =
  | 'repair'
  | 'overdrive'
  | 'scavenge'
  | 'surge'
  | 'radflare'
  | 'blight'
  | 'reload'
  | 'spores';

export interface WeaponStats {
  range: number;
  shots: number;
  damage: number;
  /** Ignores the target's armor. */
  pierce?: boolean;
  /** Target loses this much movement on its next turn if hit. */
  stun?: number;
  /** Attacker heals for the damage dealt. */
  leech?: boolean;
}

export interface Mods {
  armor?: number;
  move?: number;
  maxHull?: number;
  regen?: number;
  energy?: number;
  hitBonus?: number;
  radImmune?: boolean;
  radFeeder?: boolean;
  terrainWalker?: boolean;
}

export type CardKind = 'weapon' | 'mutation' | 'tactic';

export interface CardDef {
  id: string;
  name: string;
  kind: CardKind;
  slot?: Slot;
  cost: number;
  text: string;
  flavor: string;
  /** Copies in the shared deck. */
  count: number;
  weapon?: WeaponStats;
  mods?: Mods;
  tactic?: TacticId;
  /** Tactics that target an enemy Behemoth within this range. */
  targetRange?: number;
}

/** Every Behemoth can always stomp an adjacent enemy. */
export const TRAMPLE: WeaponStats = { range: 1, shots: 1, damage: 2 };

export const CARDS: CardDef[] = [
  // ---- Weapons -------------------------------------------------------------
  {
    id: 'bone_cannon', name: 'Bone Cannon', kind: 'weapon', slot: 'arm', cost: 2, count: 4,
    weapon: { range: 3, shots: 1, damage: 4 },
    text: 'Range 3 · 1 shot · 4 damage.',
    flavor: 'Calcified slugs, grown fresh in a living breech.',
  },
  {
    id: 'saw_claws', name: 'Saw Claws', kind: 'weapon', slot: 'arm', cost: 1, count: 4,
    weapon: { range: 1, shots: 2, damage: 3 },
    text: 'Range 1 · 2 shots · 3 damage.',
    flavor: 'Serrated keratin that never stops growing.',
  },
  {
    id: 'acid_spitter', name: 'Acid Spitter', kind: 'weapon', slot: 'head', cost: 2, count: 3,
    weapon: { range: 2, shots: 2, damage: 2, pierce: true },
    text: 'Range 2 · 2 shots · 2 damage. Ignores armor.',
    flavor: 'It eats plating first and questions never.',
  },
  {
    id: 'rail_spines', name: 'Rail Spines', kind: 'weapon', slot: 'back', cost: 4, count: 2,
    weapon: { range: 5, shots: 1, damage: 6 },
    text: 'Range 5 · 1 shot · 6 damage.',
    flavor: 'Bio-electric quills, fired at a fraction of lightspeed.',
  },
  {
    id: 'missile_hump', name: 'Missile Hump', kind: 'weapon', slot: 'back', cost: 3, count: 3,
    weapon: { range: 4, shots: 3, damage: 2 },
    text: 'Range 4 · 3 shots · 2 damage.',
    flavor: 'A swollen pod of seeker-larvae.',
  },
  {
    id: 'shriek_horn', name: 'Shriek Horn', kind: 'weapon', slot: 'head', cost: 2, count: 2,
    weapon: { range: 2, shots: 1, damage: 2, stun: 2 },
    text: 'Range 2 · 1 shot · 2 damage. On a hit, the target loses 2 movement next turn.',
    flavor: 'A sound you feel in your ganglia.',
  },
  {
    id: 'napalm_bladder', name: 'Napalm Bladder', kind: 'weapon', slot: 'arm', cost: 2, count: 3,
    weapon: { range: 2, shots: 2, damage: 3 },
    text: 'Range 2 · 2 shots · 3 damage.',
    flavor: 'Sticky, burning, and frankly rude.',
  },
  {
    id: 'leech_tendril', name: 'Leech Tendril', kind: 'weapon', slot: 'arm', cost: 3, count: 2,
    weapon: { range: 2, shots: 1, damage: 4, leech: true },
    text: 'Range 2 · 1 shot · 4 damage. Heal hull equal to damage dealt.',
    flavor: 'Takes what it needs. Then a little more.',
  },

  // ---- Mutations -----------------------------------------------------------
  {
    id: 'chitin_plating', name: 'Chitin Plating', kind: 'mutation', slot: 'body', cost: 2, count: 4,
    mods: { armor: 1 },
    text: '+1 armor.',
    flavor: 'Layered shell, thick as a bunker door.',
  },
  {
    id: 'siege_shell', name: 'Siege Shell', kind: 'mutation', slot: 'body', cost: 4, count: 2,
    mods: { armor: 2, move: -1 },
    text: '+2 armor, −1 movement.',
    flavor: 'Slow. Unstoppable. Mostly the second one.',
  },
  {
    id: 'strider_legs', name: 'Strider Legs', kind: 'mutation', slot: 'body', cost: 2, count: 3,
    mods: { move: 1, terrainWalker: true },
    text: '+1 movement. Ruins and swamp cost only 1 to enter.',
    flavor: 'Six extra knees, all of them angry.',
  },
  {
    id: 'regen_sac', name: 'Regen Sac', kind: 'mutation', slot: 'body', cost: 3, count: 3,
    mods: { regen: 2 },
    text: 'Heal 2 hull at the start of each of your turns.',
    flavor: 'A pulsing bag of spare meat.',
  },
  {
    id: 'bulk_tissue', name: 'Bulk Tissue', kind: 'mutation', slot: 'body', cost: 2, count: 3,
    mods: { maxHull: 6 },
    text: '+6 max hull. Heal 6 when grafted.',
    flavor: 'More of you to love. And to shoot.',
  },
  {
    id: 'rad_lungs', name: 'Rad Lungs', kind: 'mutation', slot: 'head', cost: 1, count: 2,
    mods: { radImmune: true, radFeeder: true },
    text: 'Immune to rad zones. +1 energy at the start of your turn if you stand in a rad zone.',
    flavor: 'Breathes fallout like mountain air.',
  },
  {
    id: 'hunter_eye', name: 'Hunter Eye', kind: 'mutation', slot: 'head', cost: 2, count: 3,
    mods: { hitBonus: 1 },
    text: 'All your weapons hit on one less (4+ becomes 3+).',
    flavor: 'A cluster of compound lenses that never blink.',
  },
  {
    id: 'reactor_gland', name: 'Reactor Gland', kind: 'mutation', slot: 'back', cost: 3, count: 2,
    mods: { energy: 1 },
    text: '+1 energy at the start of each of your turns.',
    flavor: 'A warm, ticking lump where the spine should be.',
  },

  // ---- Tactics -------------------------------------------------------------
  {
    id: 'field_mending', name: 'Field Mending', kind: 'tactic', tactic: 'repair', cost: 1, count: 4,
    text: 'Heal 6 hull.',
    flavor: 'Staples, glue, and a stern talking-to.',
  },
  {
    id: 'adrenal_surge', name: 'Adrenal Surge', kind: 'tactic', tactic: 'overdrive', cost: 1, count: 3,
    text: '+3 movement this turn.',
    flavor: 'Every gland, all at once.',
  },
  {
    id: 'scavenge', name: 'Scavenge', kind: 'tactic', tactic: 'scavenge', cost: 0, count: 3,
    text: 'Draw 2 cards.',
    flavor: 'One warlord’s wreck is another’s spare parts.',
  },
  {
    id: 'power_siphon', name: 'Power Siphon', kind: 'tactic', tactic: 'surge', cost: 0, count: 3,
    text: 'Gain 2 energy.',
    flavor: 'Tap the old grid. Ignore the screaming.',
  },
  {
    id: 'rad_flare', name: 'Rad Flare', kind: 'tactic', tactic: 'radflare', cost: 2, count: 2, targetRange: 4,
    text: 'An enemy Behemoth within 4 hexes takes 3 damage, ignoring armor.',
    flavor: 'Point the bad end at them.',
  },
  {
    id: 'gene_blight', name: 'Gene Blight', kind: 'tactic', tactic: 'blight', cost: 2, count: 2, targetRange: 3,
    text: 'An enemy Behemoth within 3 hexes loses a random graft.',
    flavor: 'A virus that unwrites whatever it touches.',
  },
  {
    id: 'rapid_reload', name: 'Rapid Reload', kind: 'tactic', tactic: 'reload', cost: 2, count: 2,
    text: 'All your weapons may fire again this turn.',
    flavor: 'Overclock the glands. Worry about it later.',
  },
  {
    id: 'spore_cloud', name: 'Spore Cloud', kind: 'tactic', tactic: 'spores', cost: 1, count: 2,
    text: '+2 armor until the start of your next turn.',
    flavor: 'Good luck aiming through that.',
  },
];

const BY_ID = new Map(CARDS.map((c) => [c.id, c]));

export function getCard(id: string): CardDef {
  const c = BY_ID.get(id);
  if (!c) throw new Error(`Unknown card: ${id}`);
  return c;
}

export function weaponSummary(w: WeaponStats): string {
  const tags: string[] = [];
  if (w.pierce) tags.push('pierce');
  if (w.stun) tags.push(`stun ${w.stun}`);
  if (w.leech) tags.push('leech');
  return `R${w.range} · ${w.shots}×${w.damage}${tags.length ? ' · ' + tags.join(', ') : ''}`;
}
