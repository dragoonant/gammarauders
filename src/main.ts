import './style.css';
import { newAIContext, planAction, type AIContext } from './engine/ai';
import { CARDS, getCard, weaponSummary, type CardDef } from './engine/cards';
import { distance, hexKey } from './engine/hex';
import { makeEnvelope, readEnvelope, type SaveEnvelope } from './engine/save';
import {
  RULES,
  baseHitOn,
  hexesWithin,
  occupant,
  applyAction,
  createGame,
  currentPlayer,
  energyIncome,
  enemiesInRange,
  expectedDamage,
  graftOptions,
  grafts,
  hitOnAgainst,
  playerStats,
  reachable,
  tacticTargets,
  tileAt,
  wellIncomeVP,
  wellsOwned,
  weapons,
} from './engine/rules';
import { SLOT_COUNTS, SLOT_ORDER, slotLabel, type Action, type GameEvent, type GameState, type Hex, type Player } from './engine/types';
import {
  boardSkeleton,
  emptyHighlights,
  floatText,
  keyFromEvent,
  parseKey,
  TERRAIN_LABEL,
  tileFacts,
  renderTiles,
  renderTokens,
  setTokenPos,
  shotFx,
  type BoardHighlights,
} from './ui/board';
import { rulesHtml } from './ui/rulesText';

// ---------------------------------------------------------------------------
// App state

const HUMAN = 0;
/** Per-game key: every Pages game shares the dragoonant.github.io origin (KB rule 22). */
const SAVE_KEY = 'wasteland-behemoths-save';
const COLORS = ['#e8b04b', '#e5534b', '#4fc1e9', '#a77de8'];
const WARLORDS = [
  { name: 'The Cinder Khan', beast: 'Scaldback' },
  { name: 'Mother Rust', beast: 'Grindjaw' },
  { name: 'Baron Sludge', beast: 'Vexmaw' },
];

interface Settings {
  name: string;
  beast: string;
  opponents: number;
  vpToWin: number;
  speed: 'normal' | 'fast';
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'aim'; weaponId: string }
  | { kind: 'target'; cardUid: number };

const ui = {
  settings: loadSettings(),
  game: null as GameState | null,
  mode: { kind: 'idle' } as Mode,
  selectedCard: null as number | null,
  busy: false,
  message: '' as string,
  lastShot: null as Extract<GameEvent, { kind: 'shot' }> | null,
  /** Setup and accepted actions of the game in progress, for the save envelope. */
  setup: null as SaveEnvelope['setup'] | null,
  actions: [] as Action[],
  storageError: '',
  /** Hex whose contents the inspector shows (hover or tap). */
  inspect: null as string | null,
  confirmNew: false,
};

const app = document.getElementById('app')!;

// ---------------------------------------------------------------------------
// Persistence

function loadSettings(): Settings {
  const fallback: Settings = { name: 'You', beast: 'Ironmaw', opponents: 1, vpToWin: RULES.vpToWin, speed: 'normal' };
  try {
    const raw = localStorage.getItem(SAVE_KEY + '-settings');
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function saveSettings(): void {
  try {
    localStorage.setItem(SAVE_KEY + '-settings', JSON.stringify(ui.settings));
  } catch {
    /* storage unavailable */
  }
}

/** Autosave after every accepted action and at game start (KB rule 22). Never silent. */
function saveGame(): void {
  const g = ui.game;
  if (!g || !ui.setup) return;
  try {
    if (g.winner !== null) localStorage.removeItem(SAVE_KEY);
    else localStorage.setItem(SAVE_KEY, JSON.stringify(makeEnvelope(ui.setup, ui.actions, g)));
    ui.storageError = '';
  } catch {
    ui.storageError = 'This browser is not storing saves, so closing the tab will lose this game.';
  }
}

type SaveInfo = { kind: 'none' } | { kind: 'ok'; envelope: SaveEnvelope } | { kind: 'bad'; reason: string };

function readSave(): SaveInfo {
  let raw: string | null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
  } catch {
    return { kind: 'bad', reason: 'this browser refused to read saved games' };
  }
  if (!raw) return { kind: 'none' };
  const r = readEnvelope(raw);
  if (r.ok) return { kind: 'ok', envelope: r.envelope };
  if (r.finished) {
    discardSave();
    return { kind: 'none' };
  }
  return { kind: 'bad', reason: r.reason };
}

function discardSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* nothing stored to remove */
  }
}

function describeSave(env: SaveEnvelope): string {
  const s = env.snapshot;
  const sides = s.players.map((p) => p.beast).join(' vs ');
  const turn = s.current === HUMAN ? 'your turn' : `${s.players[s.current].name}'s turn`;
  const vp = s.players.map((p) => p.vp).join(' / ');
  const when = new Date(env.savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return `${sides} · round ${s.round}, ${turn} · VP ${vp} · saved ${when}`;
}

// ---------------------------------------------------------------------------
// Helpers

const esc = (t: string) =>
  t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const delay = () => (ui.settings.speed === 'fast' ? 220 : 600);

function me(): Player {
  return ui.game!.players[HUMAN];
}

function myTurn(): boolean {
  const g = ui.game;
  return !!g && g.winner === null && g.current === HUMAN && !ui.busy;
}

function resetMode(): void {
  ui.mode = { kind: 'idle' };
}

function kindLabel(def: CardDef): string {
  if (def.kind === 'tactic') return 'Tactic';
  return `${def.kind === 'weapon' ? 'Weapon' : 'Mutation'} · ${def.slot![0].toUpperCase()}${def.slot!.slice(1)}`;
}

// ---------------------------------------------------------------------------
// Setup screen

function saveNotice(save: SaveInfo): string {
  if (save.kind === 'ok') {
    return `<div class="save-box"><b>Saved game</b><span>${esc(describeSave(save.envelope))}</span>
      <button type="button" class="btn primary" data-act="continue">Continue</button></div>`;
  }
  if (save.kind === 'bad') {
    return `<div class="save-box bad"><b>Your saved game can't be opened</b><span>Reason: ${esc(save.reason)}.</span>
      <button type="button" class="btn small" data-act="discard-save">Discard it</button></div>`;
  }
  return '';
}

function renderSetup(): void {
  const saved = readSave();
  ui.confirmNew = false;
  const s = ui.settings;
  app.innerHTML = `
  <div class="setup">
    <div class="setup-card">
      <h1 class="logo">WASTELAND<span>BEHEMOTHS</span></h1>
      <p class="tag">Graft weapons onto a giant bio-mech, claim the Rad Wells, and break the other warlords' monsters.</p>
      ${saveNotice(saved)}
      <form id="setup-form">
        <label>Your warlord name <input name="name" maxlength="20" value="${esc(s.name)}"/></label>
        <label>Your Behemoth's name <input name="beast" maxlength="16" value="${esc(s.beast)}"/></label>
        <label>AI opponents
          <select name="opponents">${[1, 2, 3].map((n) => `<option ${n === s.opponents ? 'selected' : ''}>${n}</option>`).join('')}</select>
        </label>
        <label>Victory points to win
          <select name="vpToWin">${[15, 20, 25, 30, 40].map((n) => `<option ${n === s.vpToWin ? 'selected' : ''}>${n}</option>`).join('')}</select>
        </label>
        <label>AI speed
          <select name="speed"><option value="normal" ${s.speed === 'normal' ? 'selected' : ''}>Normal</option><option value="fast" ${s.speed === 'fast' ? 'selected' : ''}>Fast</option></select>
        </label>
        <label>Map seed <span class="muted">(optional, leave blank for a random map)</span> <input name="seed" inputmode="numeric" placeholder="random"/></label>
        <div class="setup-actions">
          <button type="submit" class="btn ${saved.kind === 'ok' ? '' : 'primary'}" id="new-game">New game</button>
          <button type="button" class="btn ghost" data-act="rules">Rules</button>
        </div>
        <p class="replace-warn" id="replace-warn" hidden>This replaces your saved game. Press <b>Replace and start</b> to confirm.</p>
      </form>
      <p class="credit">An original game by evilgouki. Saves stay in this browser only: a local copy and the web version keep separate saves.</p>
    </div>
  </div>
  <div id="modal"></div>`;
  document.getElementById('setup-form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    // Discard asks once more (KB rule 22).
    if (readSave().kind === 'ok' && !ui.confirmNew) {
      ui.confirmNew = true;
      document.getElementById('replace-warn')!.hidden = false;
      document.getElementById('new-game')!.textContent = 'Replace and start';
      return;
    }
    const f = new FormData(e.target as HTMLFormElement);
    ui.settings = {
      name: String(f.get('name') || 'You').trim() || 'You',
      beast: String(f.get('beast') || 'Ironmaw').trim() || 'Ironmaw',
      opponents: Number(f.get('opponents')),
      vpToWin: Number(f.get('vpToWin')),
      speed: f.get('speed') === 'fast' ? 'fast' : 'normal',
    };
    saveSettings();
    const seedRaw = String(f.get('seed') || '').trim();
    startGame(seedRaw ? Number(seedRaw) || hashSeed(seedRaw) : undefined);
  });
}

function hashSeed(t: string): number {
  let h = 2166136261;
  for (const ch of t) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function startGame(seed?: number): void {
  const s = ui.settings;
  const setup: SaveEnvelope['setup'] = {
    seed: (seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0,
    vpToWin: s.vpToWin,
    players: [
      { name: s.name, beast: s.beast, color: COLORS[0], isAI: false },
      ...WARLORDS.slice(0, s.opponents).map((w, i) => ({ ...w, color: COLORS[i + 1], isAI: true })),
    ],
  };
  ui.setup = setup;
  ui.actions = [];
  ui.game = createGame(setup);
  enterGame();
}

function continueGame(env: SaveEnvelope): void {
  ui.setup = env.setup;
  ui.actions = env.actions;
  ui.game = env.snapshot;
  enterGame();
}

function enterGame(): void {
  resetMode();
  ui.selectedCard = null;
  ui.lastShot = null;
  ui.message = '';
  const g = ui.game!;
  app.innerHTML = `
  <header class="topbar">
    <div class="brand">WASTELAND <span>BEHEMOTHS</span></div>
    <div class="top-actions">
      <button class="btn small ghost" data-act="rules">Rules</button>
      <button class="btn small ghost" data-act="menu">Menu</button>
    </div>
  </header>
  <main class="layout">
    <section class="board-wrap">${boardSkeleton(g)}<div class="legend">
      <span><i class="sw t-plains"></i>Plains 1</span><span><i class="sw t-ruins"></i>Ruins 2 · cover</span>
      <span><i class="sw t-swamp"></i>Swamp 2</span><span><i class="sw t-rad"></i>Rad 1 · burns</span>
      <span><i class="sw t-mountain"></i>Crags</span><span><i class="sw well-sw"></i>Rad Well</span>
    </div><div class="inspector" id="inspector"></div></section>
    <aside class="panel" id="panel"></aside>
  </main>
  <div id="modal"></div>`;
  const board = document.getElementById('board')!;
  // Tiles are the only pick targets (KB rule 25); tokens and effects ignore the pointer.
  board.addEventListener('click', onBoardClick);
  board.addEventListener('pointerover', (e) => {
    if ((e as PointerEvent).pointerType !== 'mouse') return;
    const key = keyFromEvent(e);
    if (key && key !== ui.inspect) {
      ui.inspect = key;
      renderInspector();
    }
  });
  ui.inspect = me().pos ? hexKey(me().pos!) : null;
  saveGame();
  renderAll();
  if (currentPlayer(g).isAI && g.winner === null) void runAI();
}

// ---------------------------------------------------------------------------
// Rendering

function highlights(): BoardHighlights {
  const hl = emptyHighlights();
  const g = ui.game!;
  hl.inspect = ui.inspect;
  if (!myTurn()) return hl;
  const p = me();
  if (!p.pos) return hl;
  if (ui.mode.kind === 'idle' && p.movesLeft > 0) {
    for (const [k, r] of reachable(g, p)) {
      hl.reach.add(k);
      hl.costs.set(k, r.cost);
    }
  } else if (ui.mode.kind === 'aim') {
    const mode = ui.mode;
    const w = weapons(p).find((x) => x.id === mode.weaponId);
    if (w) {
      hl.inRange = hexesWithin(g, p.pos, w.stats.range);
      for (const e of enemiesInRange(g, p, w.stats.range)) hl.targets.add(e.id);
    }
  } else if (ui.mode.kind === 'target') {
    const mode = ui.mode;
    const card = p.hand.find((c) => c.uid === mode.cardUid);
    if (card) {
      const def = getCard(card.defId);
      hl.inRange = hexesWithin(g, p.pos, def.targetRange ?? 0);
      for (const e of tacticTargets(g, p, def)) hl.targets.add(e.id);
    }
  }
  return hl;
}

function renderAll(): void {
  const g = ui.game;
  if (!g) return;
  const hl = highlights();
  renderTiles(g, hl);
  renderTokens(g, hl);
  renderPanel();
  renderInspector();
  renderGameOver();
}

/** Shows what stands on the inspected hex: the hover info a figure used to give (KB rule 25). */
function renderInspector(): void {
  const el = document.getElementById('inspector');
  const g = ui.game;
  if (!el || !g) return;
  const t = ui.inspect ? g.tiles[ui.inspect] : undefined;
  if (!t) {
    el.innerHTML = '<span class="muted">Hover or tap a hex to see what is there.</span>';
    return;
  }
  const lines = tileFacts(g, t);
  const reach = myTurn() && me().pos ? reachable(g, me()).get(hexKey(t)) : undefined;
  if (reach) lines.push(`Move here: ${reach.cost}`);
  const who = occupant(g, t);
  let unit = '';
  if (who) {
    const st = playerStats(who);
    const gs = grafts(who);
    const d = me().pos && who.id !== HUMAN ? distance(me().pos!, t) : null;
    unit = `<div class="insp-unit" style="--pc:${who.color}">
      <b>${esc(who.beast)}</b> <small>${esc(who.name)}</small>
      <span>Hull ${who.hull}/${st.maxHull} · Armor ${st.armor} · Move ${st.move} · Hits on ${baseHitOn(who)}+${d !== null ? ` · ${d} hexes away` : ''}</span>
      <span>${gs.length ? gs.map((x) => `${esc(x.def.name)}`).join(', ') : 'No grafts'}</span>
    </div>`;
  }
  el.innerHTML = `<div class="insp-tile">${lines.map((l) => `<span>${esc(l)}</span>`).join('')}</div>${unit}`;
}

function hullBar(p: Player): string {
  const max = playerStats(p).maxHull;
  const pct = Math.max(0, Math.min(100, (p.hull / max) * 100));
  const cls = pct > 50 ? 'ok' : pct > 25 ? 'warn' : 'bad';
  return `<div class="bar"><div class="fill ${cls}" style="width:${pct}%"></div><span>${p.hull}/${max}</span></div>`;
}

function scoreboard(g: GameState): string {
  return g.players
    .map((p) => {
      const gs = grafts(p);
      const vpPct = Math.min(100, (p.vp / g.vpToWin) * 100);
      return `<div class="score ${g.current === p.id ? 'active' : ''}" style="--pc:${p.color}">
        <div class="score-head">
          <span class="dot"></span>
          <span class="who"><b>${esc(p.beast)}</b> <small>${esc(p.name)}${p.isAI || p.name.toLowerCase() === 'you' ? '' : ' (you)'}</small></span>
          <span class="vp">${p.vp}<small>/${g.vpToWin} VP</small></span>
        </div>
        <div class="vpbar"><div style="width:${vpPct}%"></div></div>
        <div class="score-meta">
          ${p.destroyed ? '<span class="tagbad">DESTROYED, respawning</span>' : hullBar(p)}
          <span>◆ ${wellsOwned(g, p.id).length} wells (+${wellIncomeVP(g, p.id)} VP)</span>
          <span>⚡ ${p.energy}</span>
          <span>${p.hand.length} cards</span>
        </div>
        ${p.id !== HUMAN && gs.length ? `<div class="score-grafts">${gs.map((x) => `<span class="chip ${x.def.kind}">${esc(x.def.name)}</span>`).join('')}</div>` : ''}
      </div>`;
    })
    .join('');
}

function slotsGrid(p: Player): string {
  let out = '';
  for (const slot of SLOT_ORDER) {
    for (let i = 0; i < SLOT_COUNTS[slot]; i++) {
      const c = p.slots[slot][i];
      const def = c ? getCard(c.defId) : null;
      out += `<div class="slot ${def ? def.kind : 'empty'}">
        <small>${slotLabel(slot, i)}</small><span>${def ? esc(def.name) : 'empty'}</span>
        ${def ? `<em>${esc(def.weapon ? weaponSummary(def.weapon) : def.text)}</em>` : ''}</div>`;
    }
  }
  return `<div class="slots">${out}</div>`;
}

function weaponsList(g: GameState, p: Player): string {
  const canAct = myTurn() && !!p.pos;
  return weapons(p)
    .map((w) => {
      const targets = canAct ? enemiesInRange(g, p, w.stats.range) : [];
      const aiming = ui.mode.kind === 'aim' && ui.mode.weaponId === w.id;
      const disabled = !canAct || !w.ready || targets.length === 0;
      return `<div class="weapon ${w.ready ? '' : 'spent'} ${aiming ? 'aiming' : ''}">
        <div><b>${esc(w.name)}</b> <small>${weaponSummary(w.stats)}</small>
          ${canAct && w.ready && !targets.length ? '<small class="why">no enemy in range</small>' : ''}</div>
        <button class="btn small ${aiming ? 'danger' : ''}" data-act="${aiming ? 'cancel' : 'aim'}" data-wid="${w.id}" ${disabled && !aiming ? 'disabled' : ''}>
          ${aiming ? 'Cancel' : w.ready ? 'Fire' : 'Fired'}</button>
      </div>`;
    })
    .join('');
}

function cardActions(g: GameState, p: Player, uid: number): string {
  const card = p.hand.find((c) => c.uid === uid);
  if (!card) return '';
  const def = getCard(card.defId);
  const afford = p.energy >= def.cost;
  const acts: string[] = [];
  if (def.kind === 'tactic') {
    if (def.targetRange) {
      const ts = tacticTargets(g, p, def);
      acts.push(
        `<button class="btn small primary" data-act="play" data-uid="${uid}" ${afford && ts.length ? '' : 'disabled'}>
          ${ts.length ? 'Play — choose target' : `No target within ${def.targetRange}`}</button>`,
      );
    } else {
      acts.push(`<button class="btn small primary" data-act="play" data-uid="${uid}" ${afford ? '' : 'disabled'}>Play</button>`);
    }
  } else {
    for (const opt of graftOptions(p, card)) {
      const rep = opt.replacing ? getCard(opt.replacing.defId).name : null;
      acts.push(
        `<button class="btn small primary" data-act="graft" data-uid="${uid}" data-slot="${opt.slot}" data-index="${opt.index}" ${afford ? '' : 'disabled'}>
          Graft → ${slotLabel(opt.slot, opt.index)}${rep ? ` <small>(replaces ${esc(rep)})</small>` : ''}</button>`,
      );
    }
  }
  acts.push(`<button class="btn small ghost" data-act="scrap" data-uid="${uid}">Scrap for +1 ⚡</button>`);
  return `<div class="card-actions">${afford ? '' : `<div class="warn-text">Needs ${def.cost} ⚡ (you have ${p.energy})</div>`}${acts.join('')}</div>`;
}

function handList(g: GameState, p: Player): string {
  if (!p.hand.length) return '<p class="muted">Your hand is empty.</p>';
  const canAct = myTurn();
  return p.hand
    .map((c) => {
      const def = getCard(c.defId);
      const sel = ui.selectedCard === c.uid;
      return `<div class="card ${def.kind} ${sel ? 'selected' : ''} ${p.energy < def.cost ? 'pricey' : ''}">
        <button class="card-face" data-act="select-card" data-uid="${c.uid}" ${canAct ? '' : 'disabled'}>
          <div class="card-top"><b>${esc(def.name)}</b><span class="cost">${def.cost}⚡</span></div>
          <div class="card-kind">${kindLabel(def)}</div>
          <div class="card-text">${esc(def.text)}</div>
          ${sel ? `<div class="flavor">${esc(def.flavor)}</div>` : ''}
        </button>
        ${sel && canAct ? cardActions(g, p, c.uid) : ''}
      </div>`;
    })
    .join('');
}

function modePrompt(g: GameState, p: Player): string {
  if (!myTurn()) return '';
  if (ui.mode.kind === 'aim') {
    const mode = ui.mode;
    const w = weapons(p).find((x) => x.id === mode.weaponId)!;
    const ts = enemiesInRange(g, p, w.stats.range);
    return `<div class="prompt"><b>${esc(w.name)}</b>: tap a highlighted enemy, or pick one:
      <div class="prompt-btns">${ts
        .map((t) => {
          const ev = expectedDamage(g, p, t, w.stats);
          return `<button class="btn small danger" data-act="fire" data-wid="${w.id}" data-target="${t.id}">
            ${esc(t.beast)} <small>(${hitOnAgainst(g, p, t)}+ to hit, ~${ev.toFixed(1)} dmg)</small></button>`;
        })
        .join('')}<button class="btn small ghost" data-act="cancel">Cancel</button></div></div>`;
  }
  if (ui.mode.kind === 'target') {
    const mode = ui.mode;
    const card = p.hand.find((c) => c.uid === mode.cardUid);
    if (!card) return '';
    const def = getCard(card.defId);
    return `<div class="prompt"><b>${esc(def.name)}</b>: choose a target:
      <div class="prompt-btns">${tacticTargets(g, p, def)
        .map((t) => `<button class="btn small danger" data-act="play-target" data-uid="${card.uid}" data-target="${t.id}">${esc(t.beast)}</button>`)
        .join('')}<button class="btn small ghost" data-act="cancel">Cancel</button></div></div>`;
  }
  return '';
}

function lastShotView(g: GameState): string {
  const s = ui.lastShot;
  if (!s) return '';
  const a = g.players[s.attacker];
  const t = g.players[s.target];
  return `<div class="dice-row" style="--pc:${a.color}"><small>${esc(a.beast)} → ${esc(t.beast)} · ${esc(s.weapon)} (need ${s.hitOn}+)</small>
    <div>${s.rolls.map((r) => `<span class="die ${r >= s.hitOn ? 'hit' : ''}">${r}</span>`).join('')}
    <b>${s.hits ? `${s.damage} dmg` : 'miss'}</b></div></div>`;
}

function renderPanel(): void {
  const panel = document.getElementById('panel');
  const g = ui.game;
  if (!panel || !g) return;
  const p = me();
  const st = playerStats(p);
  const cur = currentPlayer(g);
  const status =
    g.winner !== null
      ? `<b>${esc(g.players[g.winner].name)}</b> wins!`
      : cur.id === HUMAN
        ? ui.busy
          ? 'Resolving…'
          : '<b>Your turn</b>'
        : `<b style="color:${cur.color}">${esc(cur.name)}</b> is acting…`;

  panel.innerHTML = `
    <div class="status"><span>Round ${g.round}</span><span>${status}</span></div>
    ${ui.message ? `<div class="toast">${esc(ui.message)}</div>` : ''}
    ${ui.storageError ? `<div class="toast">${esc(ui.storageError)}</div>` : ''}
    <section class="block">${scoreboard(g)}</section>
    ${lastShotView(g)}
    <section class="block mine" style="--pc:${p.color}">
      <h3>${esc(p.beast)} <small>your Behemoth</small></h3>
      ${p.destroyed ? '<p class="tagbad">Destroyed. Respawns at your base next turn.</p>' : hullBar(p)}
      <div class="stats">
        <span><small>Energy</small> <b>${p.energy}</b> <small>+${energyIncome(g, p)}/turn</small></span>
        <span><small>Move</small> <b>${p.movesLeft}</b><small>/${st.move}</small></span>
        <span><small>Armor</small> <b>${st.armor}</b></span>
        <span><small>Hits on</small> <b>${baseHitOn(p)}+</b></span>
        ${p.pos ? `<span><small>On</small> ${TERRAIN_LABEL[tileAt(g, p.pos)!.terrain]}</span>` : ''}
      </div>
      ${slotsGrid(p)}
    </section>
    ${modePrompt(g, p)}
    <section class="block"><h3>Weapons</h3>${weaponsList(g, p)}</section>
    <section class="block"><h3>Hand <small>${p.hand.length}/${RULES.handLimit} · tap a card</small></h3><div class="hand">${handList(g, p)}</div></section>
    <div class="end-wrap"><button class="btn primary big" data-act="end-turn" ${myTurn() ? '' : 'disabled'}>End turn</button></div>
    <section class="block"><h3>Battle log</h3><div class="log">${g.log
      .slice(-60)
      .map((l) => `<div style="--pc:${l.player !== null ? g.players[l.player].color : '#9a8f7a'}"><small>R${l.round}</small> ${esc(l.text)}</div>`)
      .join('')}</div></section>`;
  const logEl = panel.querySelector('.log');
  if (logEl) logEl.scrollTop = logEl.scrollHeight;
}

function renderGameOver(): void {
  const g = ui.game!;
  const modal = document.getElementById('modal')!;
  if (g.winner === null) {
    if (modal.dataset.kind === 'over') modal.innerHTML = '';
    return;
  }
  if (modal.dataset.kind === 'over' && modal.innerHTML) return;
  const w = g.players[g.winner];
  const ranked = [...g.players].sort((a, b) => b.vp - a.vp);
  modal.dataset.kind = 'over';
  modal.innerHTML = `<div class="overlay"><div class="dialog">
    <h2 style="color:${w.color}">${w.id === HUMAN ? 'Victory!' : 'Defeat'}</h2>
    <p>${esc(w.name)} and ${esc(w.beast)} rule the wastes after ${g.round} rounds.</p>
    <table class="results"><tr><th>Warlord</th><th>VP</th><th>Kills</th><th>Wells</th></tr>
    ${ranked.map((p) => `<tr style="color:${p.color}"><td>${esc(p.name)}</td><td>${p.vp}</td><td>${p.kills}</td><td>${wellsOwned(g, p.id).length}</td></tr>`).join('')}</table>
    <div class="setup-actions"><button class="btn primary" data-act="rematch">Play again</button><button class="btn ghost" data-act="menu">Menu</button><button class="btn ghost" data-act="close-modal">View board</button></div>
  </div></div>`;
}

function showRules(): void {
  const modal = document.getElementById('modal')!;
  modal.dataset.kind = 'rules';
  modal.innerHTML = `<div class="overlay" data-act="close-modal"><div class="dialog rules" data-stop>
    ${rulesHtml(ui.game?.vpToWin ?? ui.settings.vpToWin)}
    <h3>Cards</h3><p class="muted">The shared deck has ${CARDS.reduce((n, c) => n + c.count, 0)} cards: weapons, mutations and one-shot tactics. Tap a card in your hand for its full text.</p>
    <div class="setup-actions"><button class="btn primary" data-act="close-modal">Got it</button></div>
  </div></div>`;
}

// ---------------------------------------------------------------------------
// Running actions

async function perform(a: Action): Promise<boolean> {
  const g = ui.game!;
  const res = applyAction(g, a);
  if (!res.ok) {
    ui.message = res.error ?? 'Not allowed.';
    renderPanel();
    return false;
  }
  ui.message = '';
  ui.actions.push(a);
  saveGame();
  await playEvents(res.events);
  return true;
}

async function playEvents(events: GameEvent[]): Promise<void> {
  const g = ui.game!;
  for (const e of events) {
    if (e.kind === 'move') {
      // Walk the token hex by hex before the final render snaps everything into place.
      const positions = new Map<number, Hex>([[e.player, e.path[0]]]);
      renderTokens(g, emptyHighlights(), positions);
      renderTiles(g, emptyHighlights());
      for (const h of e.path.slice(1)) {
        setTokenPos(e.player, h);
        await sleep(ui.settings.speed === 'fast' ? 70 : 150);
      }
    } else if (e.kind === 'shot') {
      ui.lastShot = e;
      const a = g.players[e.attacker];
      const t = g.players[e.target];
      const tp = t.pos ?? lastKnown.get(t.id);
      if (a.pos && tp) shotFx(a.pos, tp, a.color, e.damage, e.hits);
    } else if (e.kind === 'heal') {
      const p = g.players[e.player];
      if (p.pos) floatText(p.pos, `+${e.amount}`, 'heal');
    } else if (e.kind === 'damage' && (e.source === 'radiation' || e.source === 'a Rad Flare')) {
      const p = g.players[e.target];
      const at = p.pos ?? lastKnown.get(p.id);
      if (at) floatText(at, `−${e.amount}`, 'dmg');
    } else if (e.kind === 'destroyed') {
      const at = lastKnown.get(e.player);
      if (at) floatText(at, 'DESTROYED', 'dmg big');
    }
  }
  rememberPositions();
  renderAll();
}

/** Last on-board position of each Behemoth, for effects on a just-destroyed one. */
const lastKnown = new Map<number, Hex>();
function rememberPositions(): void {
  for (const p of ui.game?.players ?? []) if (p.pos) lastKnown.set(p.id, { ...p.pos });
}

async function runAI(): Promise<void> {
  const g = ui.game;
  if (!g || ui.busy) return;
  ui.busy = true;
  resetMode();
  ui.selectedCard = null;
  rememberPositions();
  renderAll();
  let ctx: AIContext = newAIContext();
  let steps = 0;
  try {
    while (ui.game === g && g.winner === null && currentPlayer(g).isAI) {
      await sleep(delay());
      if (ui.game !== g) return;
      const a: Action = steps++ > 80 ? { type: 'endTurn' } : planAction(g, ctx);
      const ok = await perform(a);
      if (!ok) await perform({ type: 'endTurn' });
      if (a.type === 'endTurn' || !ok) {
        ctx = newAIContext();
        steps = 0;
      }
    }
  } finally {
    if (ui.game === g) {
      ui.busy = false;
      renderAll();
    }
  }
}

async function humanAct(a: Action): Promise<void> {
  if (!myTurn()) return;
  ui.busy = true;
  // Disable the controls while the action animates, so no click is silently ignored.
  renderPanel();
  rememberPositions();
  const ok = await perform(a);
  ui.busy = false;
  if (ok) {
    if (a.type !== 'move') ui.selectedCard = null;
    resetMode();
  }
  renderAll();
  if (ok && a.type === 'endTurn') void runAI();
}

// ---------------------------------------------------------------------------
// Input

/**
 * Every tap on the board resolves by hex, in one place (KB rule 25): the legal action for that
 * hex first (fire the armed weapon or tactic at whoever stands there, or move there), otherwise
 * inspect the hex and whatever stands on it.
 */
function onBoardClick(e: Event): void {
  const g = ui.game;
  const key = keyFromEvent(e);
  if (!g || !key) return;
  const hex = parseKey(key);
  const who = occupant(g, hex);
  const enemy = who && who.id !== HUMAN ? who : undefined;
  if (myTurn()) {
    const p = me();
    if (ui.mode.kind === 'aim' && enemy) {
      void humanAct({ type: 'fire', weaponId: ui.mode.weaponId, targetId: enemy.id });
      return;
    }
    if (ui.mode.kind === 'target' && enemy) {
      void humanAct({ type: 'play', cardUid: ui.mode.cardUid, targetId: enemy.id });
      return;
    }
    if (ui.mode.kind === 'idle' && p.pos && reachable(g, p).has(key)) {
      ui.inspect = key;
      void humanAct({ type: 'move', to: hex });
      return;
    }
    if (ui.mode.kind !== 'idle') resetMode();
  }
  ui.inspect = key;
  renderAll();
}

app.addEventListener('click', (e) => {
  const el = (e.target as Element).closest<HTMLElement>('[data-act]');
  if (!el || (el as HTMLButtonElement).disabled) return;
  if (el.dataset.act === 'close-modal' && (e.target as Element).closest('[data-stop]') && el.classList.contains('overlay')) return;
  const d = el.dataset;
  const uid = Number(d.uid);
  switch (d.act) {
    case 'rules':
      showRules();
      return;
    case 'close-modal': {
      const modal = document.getElementById('modal');
      if (modal) modal.innerHTML = '';
      return;
    }
    case 'menu':
      ui.game = null;
      renderSetup();
      return;
    case 'continue': {
      const saved = readSave();
      if (saved.kind === 'ok') continueGame(saved.envelope);
      else renderSetup();
      return;
    }
    case 'discard-save':
      discardSave();
      renderSetup();
      return;
    case 'rematch':
      startGame();
      return;
    case 'select-card':
      ui.selectedCard = ui.selectedCard === uid ? null : uid;
      resetMode();
      ui.message = '';
      renderAll();
      return;
    case 'graft':
      void humanAct({ type: 'graft', cardUid: uid, slot: d.slot as never, index: Number(d.index) });
      return;
    case 'scrap':
      void humanAct({ type: 'scrap', cardUid: uid });
      return;
    case 'play': {
      const card = me().hand.find((c) => c.uid === uid);
      if (card && getCard(card.defId).targetRange) {
        ui.mode = { kind: 'target', cardUid: uid };
        renderAll();
      } else void humanAct({ type: 'play', cardUid: uid });
      return;
    }
    case 'play-target':
      void humanAct({ type: 'play', cardUid: uid, targetId: Number(d.target) });
      return;
    case 'aim':
      ui.mode = { kind: 'aim', weaponId: d.wid! };
      ui.selectedCard = null;
      renderAll();
      return;
    case 'fire':
      void humanAct({ type: 'fire', weaponId: d.wid!, targetId: Number(d.target) });
      return;
    case 'cancel':
      resetMode();
      renderAll();
      return;
    case 'end-turn':
      void humanAct({ type: 'endTurn' });
      return;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('modal');
    if (modal?.innerHTML) modal.innerHTML = '';
    else if (ui.game) {
      resetMode();
      renderAll();
    }
  }
});

// A long press never selects text or opens a callout (KB rule 24); the CSS does the work and
// these listeners cover browsers that ignore it.
const editable = (t: EventTarget | null) =>
  t instanceof Element && !!t.closest('input, textarea, select, [contenteditable="true"]');
document.addEventListener('selectstart', (e) => {
  if (!editable(e.target)) e.preventDefault();
});
document.addEventListener('contextmenu', (e) => {
  if (!editable(e.target)) e.preventDefault();
});

renderSetup();
