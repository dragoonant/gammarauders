import './style.css';
import { newAIContext, planAction, type AIContext } from './engine/ai';
import { getCard, weaponSummary, type CardDef } from './engine/cards';
import { distance, hexKey } from './engine/hex';
import {
  RULES,
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
  pidFromEvent,
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
const SAVE_KEY = 'wasteland-behemoths-save-v1';
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

function saveGame(): void {
  try {
    if (ui.game && ui.game.winner === null) localStorage.setItem(SAVE_KEY, JSON.stringify(ui.game));
    else localStorage.removeItem(SAVE_KEY);
  } catch {
    /* storage unavailable */
  }
}

function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as GameState) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
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

function renderSetup(): void {
  const saved = loadGame();
  const s = ui.settings;
  app.innerHTML = `
  <div class="setup">
    <div class="setup-card">
      <h1 class="logo">WASTELAND<span>BEHEMOTHS</span></h1>
      <p class="tag">Graft weapons onto a giant bio-mech, claim the Rad Wells, and break the other warlords' monsters.</p>
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
          <button type="submit" class="btn primary">New game</button>
          ${saved ? `<button type="button" class="btn" data-act="continue">Continue saved game (round ${saved.round})</button>` : ''}
          <button type="button" class="btn ghost" data-act="rules">Rules</button>
        </div>
      </form>
    </div>
  </div>
  <div id="modal"></div>`;
  document.getElementById('setup-form')!.addEventListener('submit', (e) => {
    e.preventDefault();
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
  ui.game = createGame({
    seed,
    vpToWin: s.vpToWin,
    players: [
      { name: s.name, beast: s.beast, color: COLORS[0], isAI: false },
      ...WARLORDS.slice(0, s.opponents).map((w, i) => ({ ...w, color: COLORS[i + 1], isAI: true })),
    ],
  });
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
    </div></section>
    <aside class="panel" id="panel"></aside>
  </main>
  <div id="modal"></div>`;
  const board = document.getElementById('board')!;
  board.addEventListener('click', onBoardClick);
  renderAll();
  saveGame();
  if (currentPlayer(g).isAI && g.winner === null) void runAI();
}

// ---------------------------------------------------------------------------
// Rendering

function highlights(): BoardHighlights {
  const hl = emptyHighlights();
  const g = ui.game!;
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
      for (const k of Object.keys(g.tiles)) {
        const t = g.tiles[k];
        if (distance(t, p.pos) <= w.stats.range && distance(t, p.pos) > 0) hl.inRange.add(k);
      }
      for (const e of enemiesInRange(g, p, w.stats.range)) hl.targets.add(e.id);
    }
  } else if (ui.mode.kind === 'target') {
    const mode = ui.mode;
    const card = p.hand.find((c) => c.uid === mode.cardUid);
    if (card) {
      const def = getCard(card.defId);
      for (const k of Object.keys(g.tiles)) {
        const t = g.tiles[k];
        if (distance(t, p.pos) <= (def.targetRange ?? 0) && distance(t, p.pos) > 0) hl.inRange.add(k);
      }
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
  renderGameOver();
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
          <span title="Wells held">◆ ${wellsOwned(g, p.id).length} (+${wellIncomeVP(g, p.id)} VP/turn)</span>
          <span title="Energy">⚡ ${p.energy}</span>
          <span title="Cards in hand">🂠 ${p.hand.length}</span>
        </div>
        ${p.id !== HUMAN && gs.length ? `<div class="score-grafts">${gs.map((x) => `<span class="chip ${x.def.kind}" title="${esc(x.def.text)}">${esc(x.def.name)}</span>`).join('')}</div>` : ''}
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
      out += `<div class="slot ${def ? def.kind : 'empty'}" title="${def ? esc(def.text) : 'Empty slot'}">
        <small>${slotLabel(slot, i)}</small><span>${def ? esc(def.name) : '—'}</span></div>`;
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
        <div><b>${esc(w.name)}</b> <small>${weaponSummary(w.stats)}</small></div>
        <button class="btn small ${aiming ? 'danger' : ''}" data-act="${aiming ? 'cancel' : 'aim'}" data-wid="${w.id}" ${disabled && !aiming ? 'disabled' : ''}
          title="${!w.ready ? 'Already fired this turn' : targets.length === 0 ? 'No enemy in range' : 'Fire'}">
          ${aiming ? 'Cancel' : w.ready ? 'Fire' : 'Spent'}</button>
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
    <section class="block">${scoreboard(g)}</section>
    ${lastShotView(g)}
    <section class="block mine" style="--pc:${p.color}">
      <h3>${esc(p.beast)} <small>your Behemoth</small></h3>
      ${p.destroyed ? '<p class="tagbad">Destroyed. Respawns at your base next turn.</p>' : hullBar(p)}
      <div class="stats">
        <span title="Energy (gain per turn)">⚡ <b>${p.energy}</b> <small>+${energyIncome(g, p)}/turn</small></span>
        <span title="Movement left / per turn">👣 <b>${p.movesLeft}</b><small>/${st.move}</small></span>
        <span title="Armor reduces each hit">🛡 <b>${st.armor}</b></span>
        <span title="Die result needed to hit">🎯 <b>${Math.max(2, RULES.baseHitOn - st.hitBonus)}+</b></span>
        ${p.pos ? `<span title="Terrain you stand on">${tileAt(g, p.pos)!.terrain}</span>` : ''}
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
    <h3>Cards</h3><p class="muted">The shared deck has 66 cards: weapons, mutations and one-shot tactics. Tap a card in your hand for its full text.</p>
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
  await playEvents(res.events);
  saveGame();
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

function onBoardClick(e: Event): void {
  if (!myTurn()) return;
  const g = ui.game!;
  const p = me();
  const pid = pidFromEvent(e);
  const key = pid !== null ? (g.players[pid].pos ? hexKey(g.players[pid].pos!) : null) : keyFromEvent(e);
  if (!key) return;
  const hex = parseKey(key);
  const target = g.players.find((x) => !x.destroyed && x.pos && hexKey(x.pos) === key && x.id !== HUMAN);

  if (ui.mode.kind === 'aim' && target) {
    void humanAct({ type: 'fire', weaponId: ui.mode.weaponId, targetId: target.id });
    return;
  }
  if (ui.mode.kind === 'target' && target) {
    void humanAct({ type: 'play', cardUid: ui.mode.cardUid, targetId: target.id });
    return;
  }
  if (ui.mode.kind !== 'idle') {
    resetMode();
    renderAll();
    return;
  }
  if (p.pos && reachable(g, p).has(key)) void humanAct({ type: 'move', to: hex });
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
      const saved = loadGame();
      if (saved) {
        ui.game = saved;
        enterGame();
      }
      return;
    }
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

renderSetup();
