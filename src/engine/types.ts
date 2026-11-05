export type Slot = 'head' | 'arm' | 'back' | 'body';

/** How many graft slots of each type a Behemoth has. */
export const SLOT_COUNTS: Record<Slot, number> = { head: 1, arm: 2, back: 1, body: 2 };
export const SLOT_ORDER: Slot[] = ['head', 'arm', 'back', 'body'];

export function slotLabel(slot: Slot, index: number): string {
  if (slot === 'arm') return index === 0 ? 'Left Arm' : 'Right Arm';
  if (slot === 'body') return index === 0 ? 'Body I' : 'Body II';
  return slot === 'head' ? 'Head' : 'Back';
}

export type Terrain = 'plains' | 'ruins' | 'swamp' | 'rad' | 'mountain';

export interface Hex {
  q: number;
  r: number;
}

export interface Well {
  value: number;
  owner: number | null;
}

export interface Tile extends Hex {
  terrain: Terrain;
  well: Well | null;
  /** Index of the player whose home base this is. */
  base: number | null;
}

export interface CardInst {
  uid: number;
  defId: string;
}

export interface Player {
  id: number;
  name: string;
  beast: string;
  color: string;
  isAI: boolean;
  hull: number;
  pos: Hex | null;
  destroyed: boolean;
  energy: number;
  vp: number;
  hand: CardInst[];
  slots: Record<Slot, (CardInst | null)[]>;
  movesLeft: number;
  hasMoved: boolean;
  /** Weapon ids that have fired this turn. */
  fired: string[];
  /** Movement lost at the start of this player's next turn. */
  stun: number;
  /** Bonus armor that lasts until this player's next turn. */
  tempArmor: number;
  kills: number;
}

export interface LogEntry {
  text: string;
  player: number | null;
  round: number;
}

export interface GameState {
  seed: number;
  radius: number;
  tiles: Record<string, Tile>;
  players: Player[];
  current: number;
  round: number;
  deck: CardInst[];
  discard: CardInst[];
  rng: number;
  nextUid: number;
  vpToWin: number;
  maxRounds: number;
  winner: number | null;
  log: LogEntry[];
}

export type Action =
  | { type: 'graft'; cardUid: number; slot: Slot; index: number }
  | { type: 'play'; cardUid: number; targetId?: number }
  | { type: 'scrap'; cardUid: number }
  | { type: 'move'; to: Hex }
  | { type: 'fire'; weaponId: string; targetId: number }
  | { type: 'endTurn' };

export type GameEvent =
  | { kind: 'move'; player: number; path: Hex[] }
  | {
      kind: 'shot';
      attacker: number;
      target: number;
      weapon: string;
      rolls: number[];
      hitOn: number;
      hits: number;
      damage: number;
    }
  | { kind: 'damage'; target: number; amount: number; source: string }
  | { kind: 'heal'; player: number; amount: number }
  | { kind: 'destroyed'; player: number; by: number | null }
  | { kind: 'claim'; player: number; hex: Hex }
  | { kind: 'turn'; player: number };

export interface ActionResult {
  ok: boolean;
  error?: string;
  events: GameEvent[];
}
