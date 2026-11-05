import { getCard } from './cards';
import { applyAction, createGame, type GameOptions } from './rules';
import type { Action, GameState } from './types';

/**
 * One versioned envelope per save (KB rules.md rule 22): the setup, the action list and a
 * snapshot. The snapshot is what reopens, so a rules update never costs the player their game;
 * the action list rides along so a bug report still replays from the seed.
 */
export const SAVE_VERSION = 2;
export const SAVE_GAME_ID = 'wasteland-behemoths';

export interface SaveEnvelope {
  game: typeof SAVE_GAME_ID;
  version: number;
  savedAt: string;
  setup: GameOptions & { seed: number };
  actions: Action[];
  snapshot: GameState;
}

export type ReadResult =
  | { ok: true; envelope: SaveEnvelope }
  | { ok: false; reason: string; finished?: boolean };

export function makeEnvelope(setup: SaveEnvelope['setup'], actions: Action[], snapshot: GameState, now = new Date()): SaveEnvelope {
  return { game: SAVE_GAME_ID, version: SAVE_VERSION, savedAt: now.toISOString(), setup, actions, snapshot };
}

/** Parses and checks a stored save. Never throws; every failure says why. */
export function readEnvelope(raw: string): ReadResult {
  let env: SaveEnvelope;
  try {
    env = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'the save file is unreadable (not valid JSON)' };
  }
  if (!env || typeof env !== 'object' || env.game !== SAVE_GAME_ID) {
    return { ok: false, reason: 'the save is not a Wasteland Behemoths save' };
  }
  if (env.version !== SAVE_VERSION) {
    return { ok: false, reason: `the save is from an incompatible version (v${env.version}, this game reads v${SAVE_VERSION})` };
  }
  const s = env.snapshot;
  if (!s || !Array.isArray(s.players) || s.players.length < 2 || s.players.length > 4 || !s.tiles || typeof s.current !== 'number' || !s.players[s.current]) {
    return { ok: false, reason: 'the game state inside the save is damaged' };
  }
  const cards = [...s.deck, ...s.discard, ...s.players.flatMap((p) => [...p.hand, ...Object.values(p.slots).flat()])];
  for (const c of cards) {
    if (!c) continue;
    try {
      getCard(c.defId);
    } catch {
      return { ok: false, reason: `the save uses a card that is no longer in the game (${c.defId})` };
    }
  }
  if (s.winner !== null) return { ok: false, reason: 'that game is finished', finished: true };
  return { ok: true, envelope: env };
}

/** Rebuilds a game from its setup and action list (for bug reports and the replay invariant). */
export function replay(setup: SaveEnvelope['setup'], actions: Action[]): GameState {
  const s = createGame(setup);
  for (const a of actions) {
    const res = applyAction(s, a);
    if (!res.ok) throw new Error(`Replay diverged at ${JSON.stringify(a)}: ${res.error}`);
  }
  return s;
}
