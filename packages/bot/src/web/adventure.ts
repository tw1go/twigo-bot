import { readFileSync } from 'node:fs';
import type {
  AdventureState,
  ClassesFile,
  EquipmentDef,
  EquipmentFile,
  EquipPlace,
  EquipSlot,
  QuestDef,
  QuestsFile,
  TownAdventureResponse,
  TownEquipAction,
  TownQuestAction,
} from '@mikazuki/shared';
import { db } from '../db/db.js';
import { type LevelGain, type SavedProgress, addXp, freshProgress, killXp, levelTo, progressView, refundPoints } from './progress.js';
import type { Attacker } from './town-mobs.js';
import { loadStats } from './stats-data.js';

// ⚔️ A member's class, quests, equipment and level in the web game (table adventurers, schema v10; level, XP and points
// v11, by web/progress.ts). The quests, classes and equipment are the game's data files (public/assets/quests/quests.json,
// classes/classes.json, items/equipment.json), read here like the town map. The game says when an objective is done (POST /town/quest) and what to wear (POST
// /town/equip); everything is checked here, and items are only ever given here (a class's training weapon). Starter
// items can't be dropped, traded or sold. Worn items don't take a bag slot; equipment in the bag takes one each.

const asset = <T>(path: string): T => JSON.parse(readFileSync(new URL(`../../../game/public/assets/${path}`, import.meta.url), 'utf8')) as T;

export const QUESTS: QuestDef[] = asset<QuestsFile>('quests/quests.json').quests;
export const CLASSES = asset<ClassesFile>('classes/classes.json').classes;
export const EQUIPMENT = new Map<string, EquipmentDef>(asset<EquipmentFile>('items/equipment.json').items.map((i) => [i.id, i]));
const PLACES = new Set<EquipPlace>(['weapon', 'head', 'body', 'hands', 'bottoms', 'feet', 'necklace', 'earrings', 'bracers1', 'bracers2', 'ring1', 'ring2']);

/** Where a kind of equipment can be worn (two places for bracers and rings). */
export const placesFor = (slot: EquipSlot): EquipPlace[] => (slot === 'bracers' ? ['bracers1', 'bracers2'] : slot === 'ring' ? ['ring1', 'ring2'] : [slot]);

export const freshAdventure = (): AdventureState => ({ cls: null, quests: { active: [], done: [] }, equipped: {}, bag: [], progress: freshProgress(loadStats()), trainingArmorGiven: false });

/** The class's gear type (Heavy, Light, Household). */
const gearOf = (cls: string | null) => CLASSES.find((c) => c.id === cls)?.gear ?? null;
/** Whether someone of this class can wear the item. */
const usable = (s: AdventureState, item: EquipmentDef) => (item.class ? item.class === s.cls : item.gear ? item.gear === gearOf(s.cls) : true);

/** Starts the autoStart quests they haven't started or finished (a class quest only for someone without a class).
 *  Returns the ones started. */
export function startQuests(s: AdventureState): QuestDef[] {
  const started: QuestDef[] = [];
  for (const q of QUESTS) {
    if (!q.autoStart || s.quests.done.includes(q.id) || s.quests.active.some((p) => p.id === q.id)) continue;
    if (s.cls && q.objectives.some((o) => o.type === 'chooseClass')) continue;
    s.quests.active.push({ id: q.id, step: 0 });
    started.push(q);
  }
  return started;
}

/** The current objective's done: on to the next, or the quest is complete (and its `next` starts). */
function advance(s: AdventureState, q: QuestDef): string | undefined {
  const p = s.quests.active.find((x) => x.id === q.id)!;
  p.step++;
  if (p.step < q.objectives.length) return undefined;
  s.quests.active = s.quests.active.filter((x) => x.id !== q.id);
  s.quests.done.push(q.id);
  const next = q.next && QUESTS.find((x) => x.id === q.next);
  if (next && !s.quests.done.includes(next.id)) s.quests.active.push({ id: next.id, step: 0 });
  return q.id;
}

type Result = Omit<TownAdventureResponse, 'adventure'>;

/** An objective done in the game: checked against the quest's current objective. */
export function questStep(s: AdventureState, a: TownQuestAction): Result {
  const q = QUESTS.find((x) => x.id === a.quest);
  const p = s.quests.active.find((x) => x.id === a.quest);
  if (!q || !p) return { ok: false, message: "That quest isn't under way." };
  const o = q.objectives[p.step];
  if (a.action === 'talk') {
    if (o?.type !== 'talk' || o.npc !== a.npc) return { ok: false, message: 'Not yet.' };
    return { ok: true, completed: advance(s, q) };
  }
  if (o?.type !== 'chooseClass') return { ok: false, message: 'Not yet.' };
  if (s.cls) return { ok: false, message: 'You already have a class.' };
  if (!CLASSES.some((c) => c.id === a.cls)) return { ok: false, message: 'No such class.' };
  s.cls = a.cls;
  // The class's training weapon, straight into the weapon slot (anything there goes to the bag).
  const weapon = [...EQUIPMENT.values()].find((i) => i.starter && i.slot === 'weapon' && i.class === a.cls);
  if (weapon) {
    if (s.equipped.weapon) s.bag.push(s.equipped.weapon);
    s.equipped.weapon = weapon.id;
  }
  return { ok: true, given: weapon?.id, completed: advance(s, q) };
}

/** Wear an item from the bag (in the place asked for, else the first free one for its kind, else the first), or take
 *  one off (`freeSlots`: the bag's free slots, for taking off). */
export function equipStep(s: AdventureState, a: TownEquipAction, freeSlots: number): Result {
  if (a.action === 'equip') {
    const item = EQUIPMENT.get(a.item);
    const at = s.bag.indexOf(a.item);
    if (!item || at < 0) return { ok: false, message: "You don't have that item." };
    const places = placesFor(item.slot);
    if (a.place && !places.includes(a.place)) return { ok: false, message: 'Wrong slot.' };
    if (!usable(s, item)) return { ok: false, message: "Your class can't use this." };
    const place = a.place ?? places.find((p) => !s.equipped[p]) ?? places[0];
    s.bag.splice(at, 1);
    const old = s.equipped[place];
    if (old) s.bag.push(old);
    s.equipped[place] = item.id;
    return { ok: true, message: `Equipped ${item.name}.` };
  }
  if (!PLACES.has(a.place)) return { ok: false, message: 'No such slot.' };
  const id = s.equipped[a.place];
  if (!id) return { ok: false, message: 'Nothing to take off there.' };
  if (freeSlots < 1) return { ok: false, message: 'Your bag is full.' };
  delete s.equipped[a.place];
  s.bag.push(id);
  return { ok: true, message: `Took off ${EQUIPMENT.get(id)?.name ?? 'it'}.` };
}

// ── Saved per member ──

type Row = {
  class: string | null;
  quests: string;
  equipped: string;
  bag: string;
  level: number;
  xp: number;
  str_points: number;
  dex_points: number;
  int_points: number;
  skill_levels: string;
  skill_points: number;
  training_armor_given: number;
};
const getStmt = db.prepare<[string], Row>(
  'SELECT class, quests, equipped, bag, level, xp, str_points, dex_points, int_points, skill_levels, skill_points, training_armor_given FROM adventurers WHERE user_id = ?',
);
const setStmt = db.prepare(
  `INSERT INTO adventurers (user_id, class, quests, equipped, bag, level, xp, str_points, dex_points, int_points, skill_levels, skill_points, training_armor_given, updated)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(user_id) DO UPDATE SET class = excluded.class, quests = excluded.quests, equipped = excluded.equipped, bag = excluded.bag,
     level = excluded.level, xp = excluded.xp, str_points = excluded.str_points, dex_points = excluded.dex_points, int_points = excluded.int_points,
     skill_levels = excluded.skill_levels, skill_points = excluded.skill_points, training_armor_given = excluded.training_armor_given, updated = excluded.updated`,
);

function load(userId: string): AdventureState {
  const row = getStmt.get(userId);
  if (!row) return freshAdventure();
  const progress = progressView(loadStats(), row.class, {
    level: row.level,
    xp: row.xp,
    points: { STR: row.str_points, DEX: row.dex_points, INT: row.int_points },
    skills: JSON.parse(row.skill_levels),
    skillPoints: row.skill_points,
  });
  return { cls: row.class, quests: JSON.parse(row.quests), equipped: JSON.parse(row.equipped), bag: JSON.parse(row.bag), progress, trainingArmorGiven: !!row.training_armor_given };
}

/** Saves it (and works out its progress's banked points again: a class may have come or gone). */
function save(userId: string, s: AdventureState): void {
  const p = (s.progress = progressView(loadStats(), s.cls, s.progress));
  setStmt.run(userId, s.cls, JSON.stringify(s.quests), JSON.stringify(s.equipped), JSON.stringify(s.bag), p.level, p.xp, p.points.STR ?? 0, p.points.DEX ?? 0, p.points.INT ?? 0,
    JSON.stringify(p.skills), p.skillPoints, s.trainingArmorGiven ? 1 : 0, Date.now());
}

/** Their state for /me: autoStart quests start here, on their first visit (and for anyone who hasn't done them). */
export function adventureOf(userId: string): AdventureState {
  const s = load(userId);
  if (startQuests(s).length) save(userId, s);
  return s;
}

/** Equipment in their bag (one slot each), for the bag's count and the town's inventory. */
export const equipmentInBag = (userId: string): string[] => load(userId).bag;

/** Their class, worn weapon and level, for the town (the chat's badge, the resting weapon). */
export function kitOf(userId: string): { cls: string | null; weapon: string | null; level: number } {
  const s = load(userId);
  return { cls: s.cls, weapon: s.equipped.weapon ?? null, level: s.progress.level };
}

/** Who they are in a fight (MobRoom.attack's Attacker): class, level, stat points spent, everything worn, and their damage
 *  skills' levels in the class's order. */
export function fighterOf(userId: string): Attacker {
  const s = load(userId);
  const n = CLASSES.find((c) => c.id === s.cls)?.skills.length ?? 0;
  return { cls: s.cls, level: s.progress.level, points: s.progress.points, gear: Object.values(s.equipped), skills: Array.from({ length: n }, (_, i) => s.progress.skills[i] ?? 1) };
}

/** Changes their progress through `f` (web/progress.ts) and saves it. */
function progress(userId: string, f: (cls: string | null, p: SavedProgress) => LevelGain): LevelGain {
  const s = load(userId);
  const r = f(s.cls, s.progress);
  s.progress = r.progress;
  save(userId, s);
  return r;
}

/** A kill's XP for them (the town: town-mobs.ts says who killed what), saved; how many levels it went up. */
export const killFor = (userId: string, mob: { level: number; xp: number }): LevelGain => progress(userId, (cls, p) => killXp(loadStats(), cls, p, mob));

/** `n` XP for them, saved. */
export const gainXpFor = (userId: string, n: number): LevelGain => progress(userId, (cls, p) => addXp(loadStats(), cls, p, n));

/** Sets their level (nothing in the bot calls it yet: the game's dev server's ?level= has its own). */
export const levelFor = (userId: string, level: number): LevelGain => progress(userId, (cls, p) => levelTo(loadStats(), cls, p, level));

/** The body of POST /town/quest, if it's a valid one. */
export function parseQuestAction(body: unknown): TownQuestAction | null {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b.quest !== 'string') return null;
  if (b.action === 'talk' && typeof b.npc === 'string') return { quest: b.quest, action: 'talk', npc: b.npc };
  if (b.action === 'chooseClass' && typeof b.cls === 'string') return { quest: b.quest, action: 'chooseClass', cls: b.cls };
  return null;
}

/** The body of POST /town/equip, if it's a valid one. */
export function parseEquipAction(body: unknown): TownEquipAction | null {
  const b = body as Record<string, unknown> | null;
  const place = (p: unknown) => (typeof p === 'string' && PLACES.has(p as EquipPlace) ? (p as EquipPlace) : null);
  if (b?.action === 'equip' && typeof b.item === 'string') {
    if (b.place === undefined) return { action: 'equip', item: b.item };
    return place(b.place) ? { action: 'equip', item: b.item, place: place(b.place)! } : null;
  }
  if (b?.action === 'unequip' && place(b.place)) return { action: 'unequip', place: place(b.place)! };
  return null;
}

/** POST /town/quest for a member: the step checked and saved. `changed`: their class or weapon changed (the town shows it). */
export function townQuest(userId: string, a: TownQuestAction): TownAdventureResponse & { changed: boolean } {
  const s = load(userId);
  startQuests(s);
  const before = `${s.cls}|${s.equipped.weapon}`;
  const r = questStep(s, a);
  if (r.ok) save(userId, s);
  return { ...r, adventure: s, changed: r.ok && before !== `${s.cls}|${s.equipped.weapon}` };
}

/** POST /town/equip for a member (`freeSlots`: their bag's free slots). */
export function townEquip(userId: string, a: TownEquipAction, freeSlots: number): TownAdventureResponse & { changed: boolean } {
  const s = load(userId);
  const before = s.equipped.weapon;
  const r = equipStep(s, a, freeSlots);
  if (r.ok) save(userId, s);
  return { ...r, adventure: s, changed: r.ok && before !== s.equipped.weapon };
}

/** A new class for someone who has one (a Bagong Buhay Ticket, items/class-ticket.ts): the new class's training weapon
 *  in the weapon slot instead of the old one's (the old training weapon goes; any other worn weapon to the bag); quests
 *  as they were. */
export function switchClass(userId: string, cls: string): { ok: true; adventure: AdventureState } | { ok: false; message: string } {
  const s = load(userId);
  if (!s.cls) return { ok: false, message: 'Choose your first class with the Tanod.' };
  if (s.cls === cls) return { ok: false, message: "That's already your class." };
  const training = (id: string | undefined) => !!id && !!EQUIPMENT.get(id)?.starter;
  s.bag = s.bag.filter((id) => !training(id));
  if (s.equipped.weapon && !training(s.equipped.weapon)) s.bag.push(s.equipped.weapon);
  const weapon = [...EQUIPMENT.values()].find((i) => i.starter && i.slot === 'weapon' && i.class === cls);
  if (weapon) s.equipped.weapon = weapon.id;
  else delete s.equipped.weapon;
  s.cls = cls;
  save(userId, s);
  return { ok: true, adventure: s };
}

/** Starts a member's class, quests and equipment over (the CMS): no class, the Tanod's quest again on their next visit,
 *  nothing worn or carried. Their level and XP stay; every stat and skill point comes back. */
export function resetAdventure(userId: string): void {
  if (!getStmt.get(userId)) return;
  const s = load(userId);
  save(userId, { ...freshAdventure(), progress: refundPoints(loadStats(), null, s.progress) });
}
