import type { AdventureState, TownPetAction } from './adventure.js';
import type { GearTotals, StatsData } from './stats.js';
import { type Item, type ItemData, type CombatItemDef, addToBag, bagSlots, isGearDef, newItem, pocketUsed } from './items.js';

// 🐾 Pets (CONTEXT.md "Pets"): a pet box (items.json pet-box-<id>, a consumable that stacks and can be traded) is opened
// into a bound pet item (pet-<id>) with its own level, Pet XP and pet points; a pet cube (pet-cube-<tier>, bound) is opened
// into the pet its owner picks from its tier's list. One pet is out at a time (the Equipment
// panel's Pet tab); while it's out, its pet tree's stats add to the owner's like gear lines do, and every hit the owner
// lands on a monster gives it Pet XP (the server's, at most once a throttle). Every number is classes/stats.json `pets`
// (a repo addition: the art folder's pets/pets-stats-block.json). Pure, for both sides; the bot saves, the game shows.

/** A node of the pet tree, and the stat it gives. */
export type PetNode = 'hp' | 'def' | 'atk' | 'atkRate' | 'amp' | 'critRate' | 'critDmg';
/** The tree's nodes in the panel's order (each one's requirements come before it). */
export const PET_NODES: PetNode[] = ['hp', 'def', 'atk', 'atkRate', 'amp', 'critRate', 'critDmg'];

export interface PetNodeRule {
  max: number;
  /** What a point gives: flat (HP, DEF, ATK) or, with `unit` '%', a percentage (0.5 = 0.5%). */
  per: number;
  unit?: '%';
  /** Nodes that must all be at their max before this one opens. */
  requires: PetNode[];
}

export interface PetKind {
  name: string;
  rarity: 'common' | 'rare';
  /** Floats over the ground (a soft shadow under it). */
  hover?: boolean;
  /** A soft glow round it (a colour). */
  glow?: string;
  /** Stats it gives on its own, always (in %: Fairy Cha's drop rate). */
  bonus?: { dropRate?: number };
}

/** classes/stats.json `pets`. */
export interface PetRules {
  levelCap: number;
  startLevel: number;
  pointsPerLevel: number;
  pointAtLevel1: boolean;
  xp: { throttleSeconds: number; toNext: { mult: number; pow: number; roundTo: number }; table?: Record<string, number>; total?: number };
  tree: Record<PetNode, PetNodeRule>;
  list: Record<string, PetKind>;
  /** zigzagEveryStepsHover: a hovering pet's zigzag legs (tiles), when it has its own. */
  follow: { distanceTiles: number; zigzagEverySteps: number; zigzagEveryStepsHover?: number; swapCooldownSeconds: number };
  boxPrice: { currency: 'kowens'; common: number; rare: number };
  /** Pet cubes by tier (common): the cube's item and the pets it can open into (pets.list keys, in the picker's order). */
  petCube?: Record<string, PetCube>;
}

/** A tier of pet cube (stats.json pets.petCube.<tier>). */
export interface PetCube {
  itemId: string;
  choices: string[];
}

/** The pets block, or null (an older stats.json). */
export const petRules = (data: StatsData): PetRules | null => (data as StatsData & { pets?: PetRules }).pets ?? null;

/** The pet a pet item is (pets.list key), or null: not a pet. */
export function petIdOf(data: ItemData, item: Pick<Item, 'defId'> | null | undefined): string | null {
  const def = item ? data.defs.get(item.defId) : undefined;
  return def && !isGearDef(def) && def.kind === 'pet' ? (def.pet ?? null) : null;
}

/** The pet a pet box opens into (its pet item's kind), or null: not a pet box. */
export function boxOpens(data: ItemData, item: Pick<Item, 'defId'> | null | undefined): CombatItemDef | null {
  const def = item ? data.defs.get(item.defId) : undefined;
  if (!def || isGearDef(def) || !def.opens) return null;
  const pet = data.defs.get(def.opens);
  return pet && !isGearDef(pet) && pet.kind === 'pet' ? pet : null;
}

/** The pet cube an item is (its tier's rule), or null: not a pet cube. */
export function cubeOf(data: ItemData, item: Pick<Item, 'defId'> | null | undefined): PetCube | null {
  const cubes = petRules(data.stats)?.petCube ?? {};
  for (const c of Object.values(cubes)) if (c && typeof c === 'object' && c.itemId === item?.defId) return c;
  return null;
}

/** The pet item a pet cube can open into for `petId`, or null: not one of its choices (another tier's pet, or none). */
export function cubeChoice(data: ItemData, cube: PetCube, petId: string): CombatItemDef | null {
  if (!cube.choices.includes(petId) || !petRules(data.stats)?.list[petId]) return null;
  const pet = data.defs.get(`pet-${petId}`);
  return pet && !isGearDef(pet) && pet.kind === 'pet' && pet.pet === petId ? pet : null;
}

/** A pet box's price in Kowens (pets.boxPrice by its pet's rarity), or null: not a pet box. */
export function boxPrice(data: ItemData, defId: string): number | null {
  const R = petRules(data.stats);
  const pet = boxOpens(data, { defId });
  const kind = pet?.pet ? R?.list[pet.pet] : undefined;
  return R && kind ? R.boxPrice[kind.rarity] : null;
}

// ── Levels and Pet XP ──

/** Pet XP from this level to the next (pets.xp.table, else 2600 × level^1.5 rounded to 100); 0 at the cap. */
export function petXpToNext(R: PetRules, level: number): number {
  if (level >= R.levelCap) return 0;
  const t = R.xp.table?.[String(level)];
  if (t) return t;
  const { mult, pow, roundTo } = R.xp.toNext;
  return Math.round((mult * level ** pow) / roundTo) * roundTo;
}

/** Pet XP into a level (the item's `xp`), 0 when missing. */
export const petXp = (item: Pick<Item, 'xp'>): number => item.xp ?? 0;

/** `n` Pet XP into a pet (changed in place): levels up while it reaches the next, stops at the cap (XP 0 there).
 *  Returns how many levels it went up and how much counted. */
export function gainPetXp(R: PetRules, pet: Item, n: number): { ups: number; gained: number } {
  if (n <= 0 || pet.level >= R.levelCap) return { ups: 0, gained: 0 };
  let ups = 0;
  let gained = 0;
  let left = Math.floor(n);
  while (left > 0 && pet.level < R.levelCap) {
    const need = petXpToNext(R, pet.level) - petXp(pet);
    if (left < need) {
      pet.xp = petXp(pet) + left;
      gained += left;
      left = 0;
    } else {
      pet.level++;
      pet.xp = 0;
      gained += need;
      left -= need;
      ups++;
    }
  }
  if (pet.level >= R.levelCap) pet.xp = 0;
  return { ups, gained };
}

/** Sets a pet's level and XP (dev: ?petlevel=, ?petxp=), within the rules; its spent points stay unless they're more
 *  than the level gives (then they all come back). */
export function setPetLevel(R: PetRules, pet: Item, level: number, xp = 0): void {
  pet.level = Math.max(R.startLevel, Math.min(R.levelCap, Math.floor(level)));
  pet.xp = pet.level >= R.levelCap ? 0 : Math.max(0, Math.min(petXpToNext(R, pet.level) - 1, Math.floor(xp)));
  if (petPointsSpent(pet) > petPointsEarned(R, pet.level)) pet.points = {};
}

/** Pet XP for a hit: the level of the highest-level monster it hit (one gain per swing, however many it hit). */
export const petXpForHit = (monsterLevels: number[]): number => monsterLevels.reduce((m, l) => Math.max(m, l), 0);

/** Pet XP's throttle: a member's pet gains at most once every `throttleSeconds` (AoE skills, fast classes and multi-hits
 *  don't change the pace). The server keeps one. */
export class PetXpClock {
  private readonly last = new Map<string, number>();
  constructor(private readonly everyMs: number) {}
  /** Whether a gain may happen now (and if so it's counted). */
  take(member: string, now: number): boolean {
    const at = this.last.get(member);
    if (at !== undefined && now - at < this.everyMs) return false;
    this.last.set(member, now);
    return true;
  }
  forget(member: string): void {
    this.last.delete(member);
  }
}

// ── Pet points and the pet tree ──

/** Pet points a level gives in all: one a level, Lv 1's included (pets.pointAtLevel1). */
export const petPointsEarned = (R: PetRules, level: number): number => R.pointsPerLevel * (R.pointAtLevel1 ? level : level - 1);
export const petPointsSpent = (pet: Pick<Item, 'points'>): number => Object.values(pet.points ?? {}).reduce((n, v) => n + (v ?? 0), 0);
/** Pet points not spent yet. */
export const petPointsLeft = (R: PetRules, pet: Item): number => Math.max(0, petPointsEarned(R, pet.level) - petPointsSpent(pet));
/** Points in a node. */
export const nodePoints = (pet: Pick<Item, 'points'>, node: PetNode): number => pet.points?.[node] ?? 0;

/** Whether a node is open: every node it needs is at its max. */
export function nodeOpen(R: PetRules, pet: Pick<Item, 'points'>, node: PetNode): boolean {
  return R.tree[node].requires.every((n) => nodePoints(pet, n) >= R.tree[n].max);
}

/** Why a point can't go into a node, or null: it can. */
export function petSpendRefusal(R: PetRules, pet: Item, node: PetNode): string | null {
  const rule = R.tree[node];
  if (!rule) return 'No such node.';
  if (nodePoints(pet, node) >= rule.max) return "That's maxed.";
  if (!nodeOpen(R, pet, node)) return `Needs ${rule.requires.map((n) => `${PET_NODE_NAMES[n]} ${R.tree[n].max}/${R.tree[n].max}`).join(' and ')} first.`;
  if (petPointsLeft(R, pet) <= 0) return 'No pet points left.';
  return null;
}

/** One pet point into a node (changed in place), or why not. */
export function spendPetPoint(R: PetRules, pet: Item, node: PetNode): string | null {
  const no = petSpendRefusal(R, pet, node);
  if (no) return no;
  pet.points = { ...pet.points, [node]: nodePoints(pet, node) + 1 };
  return null;
}

/** Every pet point back (free). False: none spent. */
export function resetPetPoints(pet: Item): boolean {
  if (!petPointsSpent(pet)) return false;
  pet.points = {};
  return true;
}

export const PET_NODE_NAMES: Record<PetNode, string> = { hp: 'HP', def: 'DEF', atk: 'ATK', atkRate: 'Attack rate', amp: 'Damage amp', critRate: 'Crit rate', critDmg: 'Crit damage' };

/** A node's value at `n` points as words: "+8 HP", "+1% Crit rate". */
export function nodeText(R: PetRules, node: PetNode, n: number): string {
  const r = R.tree[node];
  const v = +(r.per * n).toFixed(2);
  return r.unit === '%' ? `+${v}% ${PET_NODE_NAMES[node]}` : `+${v} ${PET_NODE_NAMES[node]}`;
}

/** What a pet out gives its owner, as gear totals (rates as fractions): its tree's points, and its kind's bonus (Fairy
 *  Cha's drop rate). Added like gear lines; the stats rules' caps still hold. Never STR, DEX or INT (requirements). */
export function petTotals(R: PetRules, pet: Pick<Item, 'points'>, petId: string | null): GearTotals {
  const t: GearTotals = {};
  const add = (k: keyof GearTotals, v: number) => {
    if (v) t[k] = +((t[k] ?? 0) + v).toFixed(6);
  };
  for (const node of PET_NODES) {
    const n = nodePoints(pet, node);
    if (!n || !R.tree[node]) continue;
    const r = R.tree[node];
    const v = r.per * n * (r.unit === '%' ? 0.01 : 1);
    add(node === 'critDmg' ? 'critDamage' : node, v);
  }
  const bonus = petId ? R.list[petId]?.bonus : undefined;
  if (bonus?.dropRate) add('dropRate', bonus.dropRate / 100);
  return t;
}

// ── Opening, sending out, calling back ──

export const OPEN_BOX_FIRST = 'Open the box first.';

const BAG_FULL = 'Your bag is full.';

type Opened = { ok: true; pet: Item; message: string } | { ok: false; message: string };

/** Opens one pet box from the combat bag (by uid): the box goes (one of its stack), a new bound pet at Lv 1 comes in its
 *  place (no XP, no points). Refused: not a box, no room (a stack of several needs a free slot). */
export function openPetBox(data: ItemData, s: Pick<AdventureState, 'bag'>, uid: string, newUid: () => string): Opened {
  const box = s.bag.find((b) => b.uid === uid);
  const petDef = boxOpens(data, box);
  if (!petRules(data.stats) || !box || !petDef) return { ok: false, message: "That isn't a pet box." };
  const r = openInto(data, s, uid, petDef, newUid);
  return r.ok ? { ...r, message: `${petDef.name} is yours!` } : { ok: false, message: 'Make room in your bag first.' };
}

/** Why a pet cube in the bag (by uid) can't be opened now, or null: it can. A lone cube's slot is the pet's, a stack of
 *  several needs a free slot (the popup asks before it opens, the server again). */
export function cubeRefusal(data: ItemData, bag: Item[], uid: string): string | null {
  const cube = bag.find((b) => b.uid === uid);
  if (!cube || !cubeOf(data, cube)) return "That isn't a pet cube.";
  if (cube.count > 1 && pocketUsed(data, bag, 'bag') >= bagSlots(data.stats)) return BAG_FULL;
  return null;
}

/** Opens one pet cube from the combat bag (by uid) into the pet chosen (pets.list key): the cube goes (one of its stack),
 *  the pet comes in as a box's does (bound, Lv 1, no XP, no points), both in one change of the bag. Refused: not a cube,
 *  a pet not on its list (Fairy Cha off the common cube's, an unknown id), no room. */
export function openPetCube(data: ItemData, s: Pick<AdventureState, 'bag'>, uid: string, petId: string, newUid: () => string): Opened {
  const cube = cubeOf(data, s.bag.find((b) => b.uid === uid));
  const no = cubeRefusal(data, s.bag, uid);
  if (!cube || no) return { ok: false, message: no ?? "That isn't a pet cube." };
  const petDef = cubeChoice(data, cube, petId);
  if (!petDef) return { ok: false, message: "That pet isn't in this cube." };
  const r = openInto(data, s, uid, petDef, newUid);
  return r.ok ? { ...r, message: `${petDef.name} joined you!` } : { ok: false, message: BAG_FULL };
}

/** One of a stack (by uid) spent on a new bound Lv 1 pet of `petDef`: in the bag, in the stack's place when that was its
 *  last; the bag untouched when it has no room. */
function openInto(data: ItemData, s: Pick<AdventureState, 'bag'>, uid: string, petDef: CombatItemDef, newUid: () => string): { ok: true; pet: Item } | { ok: false } {
  const R = petRules(data.stats)!;
  const box = s.bag.find((b) => b.uid === uid)!;
  const bag = s.bag.map((b) => ({ ...b }));
  const at = bag.findIndex((b) => b.uid === uid);
  if (bag[at].count > 1) bag[at].count--;
  else bag.splice(at, 1);
  const pet: Item = { ...newItem(data.stats, petDef, newUid()), level: R.startLevel, bound: true, xp: 0, points: {} };
  if (!addToBag(data, bag, pet, newUid)) return { ok: false };
  // (The pet takes the box's place when that was the box's last.)
  if (box.count <= 1) {
    const i = bag.findIndex((b) => b.uid === pet.uid);
    bag.splice(i, 1);
    bag.splice(Math.min(at, bag.length), 0, pet);
  }
  s.bag = bag;
  return { ok: true, pet };
}

/** Why a pet can't be sent out, called back or swapped now, or null: in combat (the town's rule), or within the swap
 *  cooldown (pets.follow.swapCooldownSeconds) of the last change. */
export function petSwapRefusal(R: PetRules, lastChange: number | undefined, now: number, inCombat: boolean): string | null {
  if (inCombat) return "Can't change pets during a fight.";
  const left = lastChange === undefined ? 0 : lastChange + R.follow.swapCooldownSeconds * 1000 - now;
  if (left > 0) return `You can change pets again in ${Math.ceil(left / 1000)} s.`;
  return null;
}

/** Sends a pet out from the combat bag (by uid): the one out before goes back where it was. Refused: a pet box ("Open the
 *  box first."), not a pet. */
export function sendOutPet(data: ItemData, s: Pick<AdventureState, 'bag' | 'pet'>, uid: string): { ok: boolean; message: string } {
  const at = s.bag.findIndex((b) => b.uid === uid);
  const item = s.bag[at];
  if (!item) return { ok: false, message: "You don't have that pet." };
  if (boxOpens(data, item)) return { ok: false, message: OPEN_BOX_FIRST };
  if (!petIdOf(data, item)) return { ok: false, message: "That isn't a pet." };
  const old = s.pet;
  s.bag.splice(at, 1, ...(old ? [old] : []));
  s.pet = item;
  return { ok: true, message: `${data.defs.get(item.defId)?.name ?? 'Your pet'} is out.` };
}

/** Calls the pet back into the combat bag: refused when the bag is full. */
export function callBackPet(data: ItemData, s: Pick<AdventureState, 'bag' | 'pet'>): { ok: boolean; message: string } {
  const pet = s.pet;
  if (!pet) return { ok: false, message: 'No pet is out.' };
  if (pocketUsed(data, s.bag, 'bag') >= bagSlots(data.stats)) return { ok: false, message: 'Your bag is full.' };
  s.pet = null;
  s.bag.push(pet);
  return { ok: true, message: `${data.defs.get(pet.defId)?.name ?? 'Your pet'} is back in your bag.` };
}

export const CUBE_IN_FIGHT = "Can't open that during a fight.";

/** A pet action (POST /town/pet; the dev town's /__pet) on a character: a box opened, a cube opened into the pet picked
 *  (never in a fight), a pet sent out or called back
 *  (refused in a fight or within the swap cooldown of `lastChange`), a pet point spent on the pet out, or every one back.
 *  `changed`: the pet out changed (the caller notes the time, and everyone sees it). */
export function petAction(
  data: ItemData,
  s: Pick<AdventureState, 'bag' | 'pet'>,
  a: TownPetAction,
  ctx: { lastChange?: number; now: number; inCombat: boolean; newUid: () => string },
): { ok: boolean; message?: string; changed?: boolean } {
  const R = petRules(data.stats);
  if (!R) return { ok: false, message: 'No pets yet.' };
  if (a.action === 'open') return openPetBox(data, s, a.item, ctx.newUid);
  if (a.action === 'cube') return ctx.inCombat ? { ok: false, message: CUBE_IN_FIGHT } : openPetCube(data, s, a.item, a.pet, ctx.newUid);
  if (a.action === 'out' || a.action === 'back') {
    const no = petSwapRefusal(R, ctx.lastChange, ctx.now, ctx.inCombat);
    if (no) return { ok: false, message: no };
    const r = a.action === 'out' ? sendOutPet(data, s, a.item) : callBackPet(data, s);
    return { ...r, changed: r.ok };
  }
  if (!s.pet) return { ok: false, message: 'No pet is out.' };
  if (a.action === 'reset') return resetPetPoints(s.pet) ? { ok: true, message: 'Pet points back.' } : { ok: false, message: 'No pet points spent.' };
  const no = spendPetPoint(R, s.pet, a.node);
  return no ? { ok: false, message: no } : { ok: true };
}

/** The body of POST /town/pet, if it's a valid one. */
export function parsePetAction(body: unknown): TownPetAction | null {
  const b = body as Record<string, unknown> | null;
  if ((b?.action === 'open' || b?.action === 'out') && typeof b.item === 'string' && b.item.length <= 40) return { action: b.action, item: b.item };
  if (b?.action === 'cube' && typeof b.item === 'string' && b.item.length <= 40 && typeof b.pet === 'string' && b.pet.length <= 40) return { action: 'cube', item: b.item, pet: b.pet };
  if (b?.action === 'back' || b?.action === 'reset') return { action: b.action };
  if (b?.action === 'spend' && PET_NODES.includes(b.node as PetNode)) return { action: 'spend', node: b.node as PetNode };
  return null;
}
