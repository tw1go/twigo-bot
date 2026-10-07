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

// ⚔️ A member's class, quests and equipment in the web game (table adventurers, schema v10). The quests, classes and
// equipment are the game's data files (public/assets/quests/quests.json, classes/classes.json, items/equipment.json),
// read here like the town map. The game says when an objective is done (POST /town/quest) and what to wear (POST
// /town/equip); everything is checked here, and items are only ever given here (a class's training weapon). Starter
// items can't be dropped, traded or sold. Worn items don't take a bag slot; equipment in the bag takes one each.

const asset = <T>(path: string): T => JSON.parse(readFileSync(new URL(`../../../game/public/assets/${path}`, import.meta.url), 'utf8')) as T;

export const QUESTS: QuestDef[] = asset<QuestsFile>('quests/quests.json').quests;
export const CLASSES = asset<ClassesFile>('classes/classes.json').classes;
export const EQUIPMENT = new Map<string, EquipmentDef>(asset<EquipmentFile>('items/equipment.json').items.map((i) => [i.id, i]));
const PLACES = new Set<EquipPlace>(['weapon', 'head', 'body', 'hands', 'bottoms', 'feet', 'necklace', 'earrings', 'bracers1', 'bracers2', 'ring1', 'ring2']);

/** Where a kind of equipment can be worn (two places for bracers and rings). */
export const placesFor = (slot: EquipSlot): EquipPlace[] => (slot === 'bracers' ? ['bracers1', 'bracers2'] : slot === 'ring' ? ['ring1', 'ring2'] : [slot]);

export const freshAdventure = (): AdventureState => ({ cls: null, quests: { active: [], done: [] }, equipped: {}, bag: [] });

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

type Row = { class: string | null; quests: string; equipped: string; bag: string };
const getStmt = db.prepare<[string], Row>('SELECT class, quests, equipped, bag FROM adventurers WHERE user_id = ?');
const setStmt = db.prepare(
  `INSERT INTO adventurers (user_id, class, quests, equipped, bag, updated) VALUES (?, ?, ?, ?, ?, ?)
   ON CONFLICT(user_id) DO UPDATE SET class = excluded.class, quests = excluded.quests, equipped = excluded.equipped, bag = excluded.bag, updated = excluded.updated`,
);

function load(userId: string): AdventureState {
  const row = getStmt.get(userId);
  if (!row) return freshAdventure();
  return { cls: row.class, quests: JSON.parse(row.quests), equipped: JSON.parse(row.equipped), bag: JSON.parse(row.bag) };
}

function save(userId: string, s: AdventureState): void {
  setStmt.run(userId, s.cls, JSON.stringify(s.quests), JSON.stringify(s.equipped), JSON.stringify(s.bag), Date.now());
}

/** Their state for /me: autoStart quests start here, on their first visit (and for anyone who hasn't done them). */
export function adventureOf(userId: string): AdventureState {
  const s = load(userId);
  if (startQuests(s).length) save(userId, s);
  return s;
}

/** Equipment in their bag (one slot each), for the bag's count and the town's inventory. */
export const equipmentInBag = (userId: string): string[] => load(userId).bag;

/** Their class and worn weapon, for the town (the chat's badge and the resting weapon). */
export function kitOf(userId: string): { cls: string | null; weapon: string | null } {
  const s = load(userId);
  return { cls: s.cls, weapon: s.equipped.weapon ?? null };
}

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
