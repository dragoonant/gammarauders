import { hexCorners, hexKey, hexToPixel, parseKey } from '../engine/hex';
import { RULES, moveCost, playerStats } from '../engine/rules';
import type { GameState, Hex, Tile } from '../engine/types';

export const HEX_SIZE = 30;
const SVG_NS = 'http://www.w3.org/2000/svg';

export interface BoardHighlights {
  reach: Set<string>;
  inRange: Set<string>;
  targets: Set<number>;
  costs: Map<string, number>;
  inspect?: string | null;
}

export const emptyHighlights = (): BoardHighlights => ({
  reach: new Set(),
  inRange: new Set(),
  targets: new Set(),
  costs: new Map(),
});

export const TERRAIN_LABEL: Record<Tile['terrain'], string> = {
  plains: 'Ash Plains',
  ruins: 'Ruins',
  swamp: 'Toxic Swamp',
  rad: 'Rad Zone',
  mountain: 'Crags',
};

/** Plain-language facts about a hex; every number comes from the engine (KB rule 8). */
export function tileFacts(s: GameState, t: Tile): string[] {
  const cost = moveCost(t, playerStats(s.players[0]));
  const facts = [TERRAIN_LABEL[t.terrain] + (Number.isFinite(cost) ? ` · costs ${cost} to enter` : ' · impassable')];
  if (t.terrain === 'ruins') facts.push('Cover: shots at a Behemoth here need +1');
  if (t.terrain === 'rad') facts.push(`${RULES.radDamage} damage to a Behemoth that ends its turn here`);
  if (t.well) {
    const owner = t.well.owner !== null ? s.players[t.well.owner].name : 'unclaimed';
    facts.push(`${t.well.value > 1 ? 'Heart Well' : 'Rad Well'}: ${t.well.value} VP per turn (${owner})`);
  }
  if (t.base !== null) facts.push(`${s.players[t.base].name}'s base`);
  return facts;
}

function px(h: Hex) {
  return hexToPixel(h, HEX_SIZE);
}

function decor(t: Tile, x: number, y: number): string {
  const s = HEX_SIZE;
  switch (t.terrain) {
    case 'ruins':
      return `<g class="decor ruins-d">
        <rect x="${x - s * 0.45}" y="${y - s * 0.1}" width="${s * 0.3}" height="${s * 0.42}"/>
        <rect x="${x - s * 0.05}" y="${y - s * 0.38}" width="${s * 0.22}" height="${s * 0.7}"/>
        <rect x="${x + s * 0.24}" y="${y + s * 0.02}" width="${s * 0.2}" height="${s * 0.3}"/>
      </g>`;
    case 'swamp':
      return `<path class="decor swamp-d" d="M${x - s * 0.5},${y - s * 0.12} q${s * 0.125},-${s * 0.15} ${s * 0.25},0 t${s * 0.25},0 t${s * 0.25},0 t${s * 0.25},0 M${x - s * 0.4},${y + s * 0.22} q${s * 0.125},-${s * 0.15} ${s * 0.25},0 t${s * 0.25},0 t${s * 0.25},0"/>`;
    case 'rad':
      return `<g class="decor rad-d"><circle cx="${x}" cy="${y}" r="${s * 0.5}"/>
        <text x="${x}" y="${y + s * 0.2}" text-anchor="middle" font-size="${s * 0.6}">☢</text></g>`;
    case 'mountain':
      return `<path class="decor mountain-d" d="M${x - s * 0.62},${y + s * 0.38} L${x - s * 0.18},${y - s * 0.42} L${x + s * 0.06},${y - s * 0.02} L${x + s * 0.24},${y - s * 0.26} L${x + s * 0.62},${y + s * 0.38} Z"/>`;
    default:
      return '';
  }
}

function wellMarkup(s: GameState, t: Tile, x: number, y: number): string {
  if (!t.well) return '';
  const owner = t.well.owner !== null ? s.players[t.well.owner] : null;
  const r = HEX_SIZE * (t.well.value > 1 ? 0.5 : 0.38);
  const pts = [
    [x, y - r],
    [x + r * 0.8, y],
    [x, y + r],
    [x - r * 0.8, y],
  ]
    .map((p) => p.join(','))
    .join(' ');
  return `<g class="well ${owner ? 'owned' : ''}">
    <circle cx="${x}" cy="${y}" r="${r * 1.35}" class="well-glow" ${owner ? `style="stroke:${owner.color}"` : ''}/>
    <polygon points="${pts}" style="fill:${owner ? owner.color : '#b9f15b'}"/>
    <text x="${x}" y="${y + HEX_SIZE * 0.13}" text-anchor="middle" class="well-val">${t.well.value}</text>
  </g>`;
}

function baseMarkup(s: GameState, t: Tile, x: number, y: number): string {
  if (t.base === null) return '';
  const c = s.players[t.base]?.color ?? '#999';
  const r = HEX_SIZE * 0.78;
  return `<polygon class="base" points="${hexCorners(x, y, r)}" style="stroke:${c}"/>`;
}


export function boardViewBox(radius: number): string {
  const w = Math.sqrt(3) * HEX_SIZE * (2 * radius + 1) + 8;
  const h = HEX_SIZE * (3 * radius + 2) + 8;
  return `${-w / 2} ${-h / 2} ${w} ${h}`;
}

export function boardSkeleton(s: GameState): string {
  return `<svg id="board" viewBox="${boardViewBox(s.radius)}" role="img" aria-label="Hex battle map">
    <g id="tiles"></g><g id="tokens"></g><g id="fx"></g></svg>`;
}

export function renderTiles(s: GameState, hl: BoardHighlights): void {
  const g = document.getElementById('tiles');
  if (!g) return;
  let out = '';
  for (const [k, t] of Object.entries(s.tiles)) {
    const { x, y } = px(t);
    const cls = ['tile', `t-${t.terrain}`];
    if (hl.reach.has(k)) cls.push('reach');
    if (hl.inRange.has(k)) cls.push('inrange');
    if (hl.inspect === k) cls.push('inspected');
    out += `<g class="${cls.join(' ')}" data-key="${k}">
      <polygon points="${hexCorners(x, y, HEX_SIZE - 0.5)}"/>
      ${decor(t, x, y)}${baseMarkup(s, t, x, y)}${wellMarkup(s, t, x, y)}
      <polygon class="hl" points="${hexCorners(x, y, HEX_SIZE - 2.5)}"/>
      ${hl.costs.has(k) ? `<text class="cost" x="${x + HEX_SIZE * 0.5}" y="${y - HEX_SIZE * 0.35}" text-anchor="middle">${hl.costs.get(k)}</text>` : ''}
    </g>`;
  }
  g.innerHTML = out;
}

export function setTokenPos(pid: number, h: Hex): void {
  const el = document.querySelector<SVGGElement>(`#tokens .token[data-pid="${pid}"]`);
  if (!el) return;
  const { x, y } = px(h);
  el.style.transform = `translate(${x}px, ${y}px)`;
}

/** Tokens are kept alive between renders so movement can animate via CSS transitions. */
export function renderTokens(s: GameState, hl: BoardHighlights, positions?: Map<number, Hex>): void {
  const g = document.getElementById('tokens');
  if (!g) return;
  for (const p of s.players) {
    let el = g.querySelector<SVGGElement>(`.token[data-pid="${p.id}"]`);
    if (!el) {
      el = document.createElementNS(SVG_NS, 'g') as SVGGElement;
      el.setAttribute('class', 'token');
      el.dataset.pid = String(p.id);
      const r = HEX_SIZE * 0.6;
      el.innerHTML = `
        <circle class="ring" r="${r + 5}"/>
        <circle class="body" r="${r}" style="fill:${p.color}"/>
        <path class="spikes" d="M${-r * 0.75},${-r * 0.55} L${-r * 0.45},${-r * 1.15} L${-r * 0.2},${-r * 0.75} L0,${-r * 1.25} L${r * 0.2},${-r * 0.75} L${r * 0.45},${-r * 1.15} L${r * 0.75},${-r * 0.55}" style="fill:${p.color}"/>
        <text class="glyph" y="${r * 0.36}" text-anchor="middle">${p.beast.charAt(0)}</text>
        <rect class="hp-bg" x="${-r}" y="${r + 3}" width="${r * 2}" height="5" rx="2"/>
        <rect class="hp" x="${-r}" y="${r + 3}" width="${r * 2}" height="5" rx="2"/>
`;
      g.appendChild(el);
    }
    const pos = positions?.get(p.id) ?? p.pos;
    el.classList.toggle('gone', p.destroyed || !pos);
    el.classList.toggle('current', s.current === p.id && s.winner === null);
    el.classList.toggle('target', hl.targets.has(p.id));
    if (pos) setTokenPos(p.id, pos);
    const max = playerStats(p).maxHull;
    const hp = el.querySelector<SVGRectElement>('.hp')!;
    const r = HEX_SIZE * 0.6;
    hp.setAttribute('width', String(Math.max(0, (p.hull / max) * r * 2)));
    hp.style.fill = p.hull / max > 0.5 ? '#7fd36b' : p.hull / max > 0.25 ? '#e8b04b' : '#e5534b';
  }
}

function fxEl(markup: string, ttl: number): void {
  const g = document.getElementById('fx');
  if (!g) return;
  const wrap = document.createElementNS(SVG_NS, 'g');
  wrap.innerHTML = markup;
  g.appendChild(wrap);
  setTimeout(() => wrap.remove(), ttl);
}

export function shotFx(from: Hex, to: Hex, color: string, damage: number, hits: number): void {
  const a = px(from);
  const b = px(to);
  fxEl(
    `<line class="shot" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" style="stroke:${color}"/>
     ${hits ? `<circle class="burst" cx="${b.x}" cy="${b.y}" r="${HEX_SIZE * 0.5}"/>` : ''}`,
    700,
  );
  floatText(to, hits ? `−${damage}` : 'MISS', hits ? 'dmg' : 'miss');
}

export function floatText(at: Hex, text: string, cls: string): void {
  const p = px(at);
  fxEl(`<text class="float ${cls}" x="${p.x}" y="${p.y - HEX_SIZE * 0.6}" text-anchor="middle">${text}</text>`, 1300);
}

export function keyFromEvent(e: Event): string | null {
  const el = (e.target as Element).closest?.('[data-key]');
  return el ? (el as HTMLElement).dataset.key ?? null : null;
}

export { hexKey, parseKey };
