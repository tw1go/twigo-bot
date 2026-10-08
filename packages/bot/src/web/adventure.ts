import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type {
  AdventureState,
  ClassesFile,
  EquipPlace,
  Item,
  QuestDef,
  QuestReward,
  QuestsFile,
  StatName,
  TownAdventureResponse,
  TownEquipAction,
  TownForgeAction,
  TownForgeResponse,
  TownPointsAction,
  TownQuestAction,
  TownSkillsAction,
} from '@mikazuki/shared';
import {
  STAT_NAMES,
  bagSlots,
  classSkills,
  damageSkillLevels,
  equipFromBag,
  giveGear,
  giveQuestRewards,
  missingTraining,
  moveUnlock,
  newItem,
  placesFor,
  swapTrainingGear,
  trainingGear,
  unequipToBag,
  wearCheck,
} from '@mikazuki/shared';
import { db } from '../db/db.js';
import { type LevelGain, type SavedProgress, addXp, freshProgress, killXp, levelTo, progressView, raiseSkill, refundPoints, resetSkillPoints, resetStatPoints, spendPoint } from './progress.js';
import type { Attacker } from './town-mobs.js';
import { type CombatItems, type LootContent, buyCombat, takeLoot, usePotion } from './combat-bag.js';
import { forge } from './forge.js';
import { type HeldOffer, settleTrade } from './trade.js';
import { loadGear, loadItemData, loadStats } from './stats-data.js';

// ⚔️ A member's class, quests, equipment and level in the web game (table adventurers, schema v10; level, XP and points
// v11, by web/progress.ts). The quests, classes and equipment are the game's data files (public/assets/quests/quests.json,
// classes/classes.json, items/equipment.json), read here like the town map. The game says when an objective is done (POST /town/quest), what to wear (POST
// /town/equip), where stat points go (POST /town/points) and which skills to raise (POST /town/skills); everything is checked here (wearing: the stats rules'
// requirements on base stats), and items are only ever given here (the Tanod's training gear: the class's weapon and
// its gear type's armor, on the class choice, or once on a later visit for a class from before training armor).
// Training gear is bound and can't be dropped, traded or sold. Every item is its own row in `items` (schema v12: worn
// in a place, or in the combat bag in order; @mikazuki/shared items.ts), with the Kusing wallet on adventurers.
// Worn items don't take a bag slot; the combat bag has stats.json inventory.slots. Trades (web/trade.ts) move items and
// Kusing between two members in one transaction and log each one in `trades` (schema v13).

const asset = <T>(path: string): T => JSON.parse(readFileSync(new URL(`../../../game/public/assets/${path}`, import.meta.url), 'utf8')) as T;

export const QUESTS: QuestDef[] = asset<QuestsFile>('quests/quests.json').quests;
export const CLASSES = asset<ClassesFile>('classes/classes.json').classes;
export const EQUIPMENT = loadGear();
const PLACES = new Set<EquipPlace>(['weapon', 'head', 'body', 'hands', 'bottoms', 'feet', 'necklace', 'earrings', 'bracers1', 'bracers2', 'ring1', 'ring2']);

export { placesFor };

export const freshAdventure = (): AdventureState => ({ cls: null, quests: { active: [], done: [] }, equipped: {}, bag: [], kusing: 0, progress: freshProgress(loadStats()), trainingArmorGiven: false });

/** A new item's uid. */
export const newUid = () => randomBytes(8).toString('hex');

/** Their class's training armor they don't have yet: each into its place if it's free, else the combat bag while it has
 *  room; done once all of it has been given (what fitted nowhere comes on a later visit). Returns what was given (kinds). */
export function giveTrainingArmor(s: AdventureState): string[] {
  if (!s.cls || s.trainingArmorGiven) return [];
  const D = loadItemData();
  const { given, left } = giveGear(D, s, missingTraining(D, s, trainingGear(loadStats(), EQUIPMENT.values(), s.cls).armor), newUid);
  s.trainingArmorGiven = !left.length;
  return given;
}

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
    return completedWith(s, { ok: true, completed: advance(s, q) });
  }
  if (o?.type !== 'chooseClass') return { ok: false, message: 'Not yet.' };
  if (s.cls) return { ok: false, message: 'You already have a class.' };
  if (!CLASSES.some((c) => c.id === a.cls)) return { ok: false, message: 'No such class.' };
  s.cls = a.cls;
  s.progress = progressView(loadStats(), s.cls, s.progress); // its growth, and the banked points to spend
  // The class's training weapon, straight into the weapon slot (anything there goes to the bag; the bag if they can't
  // wear it, which every class can its own), then its armor.
  const weapon = trainingGear(loadStats(), EQUIPMENT.values(), a.cls).weapon;
  if (weapon) {
    const item = newItem(loadStats(), weapon, newUid());
    if (wearCheck(loadStats(), s, weapon).ok) {
      if (s.equipped.weapon) s.bag.push(s.equipped.weapon);
      s.equipped.weapon = item;
    } else s.bag.push(item);
  }
  const gear = giveTrainingArmor(s);
  return completedWith(s, { ok: true, given: weapon?.id, ...(gear.length ? { gear } : {}), completed: advance(s, q) });
}

/** A step's answer, with the quest's rewards if it was just completed (into the combat bag). */
function completedWith(s: AdventureState, r: Result): Result {
  if (!r.completed) return r;
  const rewards = giveQuestRewards(loadItemData(), s, QUESTS, newUid);
  return rewards.length ? { ...r, rewards } : r;
}

/** Wear an item from the combat bag (by uid; in the place asked for, else the first free one for its kind, else the
 *  first), or take one off into the bag (refused when it's full). An orange item binds as it's first worn. */
export function equipStep(s: AdventureState, a: TownEquipAction): Result {
  if (a.action === 'equip') return equipFromBag(loadItemData(), s, a.item, a.place);
  if (!PLACES.has(a.place)) return { ok: false, message: 'No such slot.' };
  return unequipToBag(loadItemData(), s, a.place);
}

/** One stat point into the class's main or second stat, or every stat point back (free). */
export function pointsStep(s: AdventureState, a: TownPointsAction): Result {
  if (a.action === 'reset') {
    if (!Object.values(s.progress.points).some((n) => n)) return { ok: false, message: 'No stat points spent.' };
    s.progress = resetStatPoints(loadStats(), s.cls, s.progress);
    return { ok: true, message: 'Stat points back.' };
  }
  const r = spendPoint(loadStats(), s.cls, s.progress, a.stat);
  if (!r.ok) return r;
  s.progress = r.progress;
  return { ok: true };
}

/** A skill point into one of their class's skills (by key: '0'…'6' or a move's id), or every skill point back (free). */
export function skillsStep(s: AdventureState, a: TownSkillsAction): Result {
  if (a.action === 'reset') {
    if (!Object.keys(s.progress.skills).length) return { ok: false, message: 'No skill points spent.' };
    s.progress = resetSkillPoints(loadStats(), s.cls, s.progress);
    return { ok: true, message: 'Skill points back.' };
  }
  const r = raiseSkill(loadStats(), s.cls, s.progress, classSkills(classOf(s.cls)).find((k) => k.key === a.skill));
  if (!r.ok) return r;
  s.progress = r.progress;
  return { ok: true };
}

const classOf = (cls: string | null | undefined) => CLASSES.find((c) => c.id === cls);

/** The level a class's movement skill unlocks at (classes.json), or null: not one of its moves (the town refuses it). */
export const moveLevel = (cls: string | null | undefined, move: string): number | null => moveUnlock(classOf(cls), move);

// ── Saved per member ──

type Row = {
  class: string | null;
  quests: string;
  level: number;
  xp: number;
  str_points: number;
  dex_points: number;
  int_points: number;
  skill_levels: string;
  skill_points: number;
  training_armor_given: number;
  kusing: number;
};
type ItemRow = {
  uid: string;
  def_id: string;
  level: number;
  rarity: string;
  plus: number;
  broken: number;
  bound: number;
  luck: number;
  agimats: string;
  lines: string;
  stat: string | null;
  lock: string | null;
  count: number;
  place: string | null;
  slot: number | null;
};
const getStmt = db.prepare<[string], Row>(
  'SELECT class, quests, level, xp, str_points, dex_points, int_points, skill_levels, skill_points, training_armor_given, kusing FROM adventurers WHERE user_id = ?',
);
// (equipped and bag are schema v10's JSON, no longer read: items live in `items`.)
const setStmt = db.prepare(
  `INSERT INTO adventurers (user_id, class, quests, equipped, bag, level, xp, str_points, dex_points, int_points, skill_levels, skill_points, training_armor_given, kusing, updated)
   VALUES (?, ?, ?, '{}', '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(user_id) DO UPDATE SET class = excluded.class, quests = excluded.quests,
     level = excluded.level, xp = excluded.xp, str_points = excluded.str_points, dex_points = excluded.dex_points, int_points = excluded.int_points,
     skill_levels = excluded.skill_levels, skill_points = excluded.skill_points, training_armor_given = excluded.training_armor_given, kusing = excluded.kusing,
     updated = excluded.updated`,
);
const itemsStmt = db.prepare<[string], ItemRow>('SELECT uid, def_id, level, rarity, plus, broken, bound, luck, agimats, lines, stat, lock, count, place, slot FROM items WHERE owner = ? ORDER BY slot, created, uid');
const dropItemsStmt = db.prepare('DELETE FROM items WHERE owner = ?');
const addItemStmt = db.prepare(
  `INSERT INTO items (uid, owner, def_id, level, rarity, plus, broken, bound, luck, agimats, lines, stat, lock, count, place, slot, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

const fromRow = (r: ItemRow): Item => ({
  uid: r.uid,
  defId: r.def_id,
  level: r.level,
  rarity: r.rarity as Item['rarity'],
  plus: r.plus,
  broken: !!r.broken,
  bound: !!r.bound,
  luck: r.luck,
  agimats: JSON.parse(r.agimats),
  lines: JSON.parse(r.lines),
  count: r.count,
  ...(r.stat ? { stat: r.stat as Item['stat'] } : {}),
  ...(r.lock ? { lock: r.lock as Item['lock'] } : {}),
});

/** Their items: worn by place, and the combat bag in order. */
function loadItems(userId: string): Pick<AdventureState, 'equipped' | 'bag'> {
  const equipped: AdventureState['equipped'] = {};
  const bag: Item[] = [];
  const worn = new Map<string, Item>();
  for (const r of itemsStmt.all(userId)) {
    if (r.place && PLACES.has(r.place as EquipPlace)) worn.set(r.place, fromRow(r));
    else bag.push(fromRow(r));
  }
  for (const p of PLACES) if (worn.has(p)) equipped[p] = worn.get(p); // in the panel's order
  return { equipped, bag };
}

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
  return { cls: row.class, quests: JSON.parse(row.quests), ...loadItems(userId), kusing: row.kusing, progress, trainingArmorGiven: !!row.training_armor_given };
}

/** Saves it (and works out its progress's banked points again: a class may have come or gone), its items with it (all of
 *  them, in one go). */
const save = db.transaction((userId: string, s: AdventureState): void => {
  const p = (s.progress = progressView(loadStats(), s.cls, s.progress));
  setStmt.run(userId, s.cls, JSON.stringify(s.quests), p.level, p.xp, p.points.STR ?? 0, p.points.DEX ?? 0, p.points.INT ?? 0,
    JSON.stringify(p.skills), p.skillPoints, s.trainingArmorGiven ? 1 : 0, Math.max(0, Math.floor(s.kusing)), Date.now());
  dropItemsStmt.run(userId);
  const now = Date.now();
  const put = (i: Item, place: string | null, slot: number | null) =>
    addItemStmt.run(i.uid, userId, i.defId, i.level, i.rarity, i.plus, i.broken ? 1 : 0, i.bound ? 1 : 0, i.luck, JSON.stringify(i.agimats), JSON.stringify(i.lines), i.stat ?? null, i.lock ?? null, i.count, place, slot, now);
  for (const [place, item] of Object.entries(s.equipped)) if (item) put(item, place, null);
  s.bag.forEach((item, i) => put(item, null, i));
});

/** Their state for /me: autoStart quests start here, on their first visit (and for anyone who hasn't done them). */
export function adventureOf(userId: string): AdventureState {
  const s = load(userId);
  if (startQuests(s).length) save(userId, s);
  return s;
}

/** The training armor of a class from before training armor (their first visit since; again while some of it had no
 *  room), saved; what was given. */
export function trainingArmorFor(userId: string): string[] {
  const s = load(userId);
  if (!s.cls || s.trainingArmorGiven) return [];
  const given = giveTrainingArmor(s);
  save(userId, s);
  return given;
}

/** Rewards of quests finished before they had any (or that had no room then), saved; what was given. */
export function questRewardsFor(userId: string): QuestReward[] {
  const s = load(userId);
  const given = giveQuestRewards(loadItemData(), s, QUESTS, newUid);
  if (given.length) save(userId, s);
  return given;
}

/** Their worn items, combat bag and Kusing (the town's `items` message). */
export function combatOf(userId: string): CombatItems {
  const { equipped, bag, kusing } = load(userId);
  return { equipped, bag, kusing };
}

/** Changes their items or Kusing through `f` and saves it if it says so; what `f` returned. */
export function withItems<T>(userId: string, f: (s: AdventureState) => T, changed: (r: T) => boolean = () => true): T {
  const s = load(userId);
  const r = f(s);
  if (changed(r)) save(userId, s);
  return r;
}

/** Loot picked up in the Slums (Kusing, or an item into the bag): false if the bag has no room for it. */
export const takeLootFor = (userId: string, loot: LootContent): boolean => withItems(userId, (s) => takeLoot(loadItemData(), s, loot, newUid), (ok) => ok);

/** One HP or MP Potion of a kind used from their bag: what it heals, or null (none). */
export const usePotionFor = (userId: string, defId: string) => withItems(userId, (s) => usePotion(loadItemData(), s, defId), (r) => !!r);

/** Buys `quantity` of a combat item at the sari-sari store (its Healing and Smithing tabs): HP/MP Potions for Kusing,
 *  whetstones and Repair Kits for Kowens (`kowens`: their wallet). */
export const buyCombatFor = (userId: string, defId: string, quantity: number, kowens: { have: number; spend(n: number): boolean }) =>
  withItems(userId, (s) => buyCombat(loadItemData(), s, s.progress.level, defId, quantity, kowens, newUid), (r) => r.ok);

const addTradeStmt = db.prepare('INSERT INTO trades (at, a, b, a_items, b_items, a_kusing, b_kusing) VALUES (?, ?, ?, ?, ?, ?, ?)');

/** A finished trade (web/trade.ts: both sides locked and confirmed): both members' items and Kusing checked again and
 *  moved, both saved and the trade logged (table trades, and a line in the bot's log), all in one transaction; or
 *  nothing (`message` says why). `names`: their town nicknames, for that message. */
export const tradeFor = db.transaction((users: [string, string], offers: [HeldOffer, HeldOffer], names: [string, string]): { ok: true } | { ok: false; message: string } => {
  const sides = [load(users[0]), load(users[1])] as [AdventureState, AdventureState];
  const r = settleTrade(loadItemData(), sides, offers, names, newUid);
  if (!r.ok) return r;
  // Both sets of rows go first: an item that changed hands keeps its uid.
  dropItemsStmt.run(users[0]);
  dropItemsStmt.run(users[1]);
  save(users[0], sides[0]);
  save(users[1], sides[1]);
  const [a, b] = r.gave;
  const info = addTradeStmt.run(Date.now(), users[0], users[1], JSON.stringify(a.items), JSON.stringify(b.items), a.kusing, b.kusing);
  const list = (o: HeldOffer) => [...o.items.map((i) => `${i.defId}${i.count > 1 ? ` ×${i.count}` : ''} (${i.uid})`), ...(o.kusing ? [`${o.kusing} Kusing`] : [])].join(', ') || 'nothing';
  console.log(`[trade] #${info.lastInsertRowid} ${users[0]} gave ${list(a)}; ${users[1]} gave ${list(b)}`);
  return { ok: true };
});

/** Their class, worn weapon (its kind and its + for the aura: 0 when broken) and level, for the town (the chat's badge,
 *  the resting weapon). */
export function kitOf(userId: string): { cls: string | null; weapon: string | null; weaponPlus: number; level: number } {
  const s = load(userId);
  return { cls: s.cls, weapon: s.equipped.weapon?.defId ?? null, weaponPlus: weaponPlusOf(s.equipped.weapon), level: s.progress.level };
}

/** A worn weapon's + as its aura shows it (none when broken). */
export const weaponPlusOf = (weapon: Item | undefined): number => (weapon && !weapon.broken ? weapon.plus : 0);

/** A forge action (POST /town/forge: enhance, repair, embed an agimat, take gear apart, combine fragments), rolled and
 *  saved (web/forge.ts). `worn`: what they wear changed (the town shows the weapon's aura; fights use the rest). */
export function forgeFor(userId: string, a: TownForgeAction): TownForgeResponse & { worn: boolean } {
  const s = load(userId);
  const before = JSON.stringify(s.equipped);
  const r = forge(loadItemData(), s, a, Math.random, newUid);
  // (A refused one changes nothing; an enhance that failed still used its stones.)
  if (r.ok) save(userId, s);
  return { ...r, items: { equipped: s.equipped, bag: s.bag, kusing: s.kusing }, worn: r.ok && before !== JSON.stringify(s.equipped) };
}

/** Who they are in a fight (MobRoom.attack's Attacker): class, level, stat points spent, everything worn, and their damage
 *  skills' levels in the class's order. */
export function fighterOf(userId: string): Attacker {
  const s = load(userId);
  return { cls: s.cls, level: s.progress.level, points: s.progress.points, gear: Object.values(s.equipped), skills: damageSkillLevels(classOf(s.cls), s.progress) };
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

/** The body of POST /town/points, if it's a valid one. */
export function parsePointsAction(body: unknown): TownPointsAction | null {
  const b = body as Record<string, unknown> | null;
  if (b?.action === 'reset') return { action: 'reset' };
  if (b?.action === 'spend' && STAT_NAMES.includes(b.stat as StatName)) return { action: 'spend', stat: b.stat as StatName };
  return null;
}

/** The body of POST /town/skills, if it's a valid one. */
export function parseSkillsAction(body: unknown): TownSkillsAction | null {
  const b = body as Record<string, unknown> | null;
  if (b?.action === 'reset') return { action: 'reset' };
  if (b?.action === 'raise' && typeof b.skill === 'string' && b.skill.length <= 20) return { action: 'raise', skill: b.skill };
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
  const before = `${s.cls}|${s.equipped.weapon?.defId}`;
  const r = questStep(s, a);
  if (r.ok) save(userId, s);
  return { ...r, adventure: s, changed: r.ok && before !== `${s.cls}|${s.equipped.weapon?.defId}` };
}

/** POST /town/equip for a member. `changed`: their worn gear changed (the town shows the weapon, fights the rest). */
export function townEquip(userId: string, a: TownEquipAction): TownAdventureResponse & { changed: boolean } {
  const s = load(userId);
  const r = equipStep(s, a);
  if (r.ok) save(userId, s);
  return { ...r, adventure: s, changed: r.ok };
}

/** POST /town/points for a member. */
export function townPoints(userId: string, a: TownPointsAction): TownAdventureResponse {
  const s = load(userId);
  const r = pointsStep(s, a);
  if (r.ok) save(userId, s);
  return { ...r, adventure: s };
}

/** POST /town/skills for a member. */
export function townSkills(userId: string, a: TownSkillsAction): TownAdventureResponse {
  const s = load(userId);
  const r = skillsStep(s, a);
  if (r.ok) save(userId, s);
  return { ...r, adventure: s };
}

/** A new class for someone who has one (a Bagong Buhay Ticket, items/class-ticket.ts): every stat and skill point back,
 *  and the new class's training weapon and armor in place of the old class's, wherever those were (worn, or in the
 *  bag); quests as they were. */
export function switchClass(userId: string, cls: string): { ok: true; adventure: AdventureState } | { ok: false; message: string } {
  const s = load(userId);
  if (!s.cls) return { ok: false, message: 'Choose your first class with the Tanod.' };
  if (s.cls === cls) return { ok: false, message: "That's already your class." };
  s.cls = cls;
  s.progress = refundPoints(loadStats(), cls, s.progress);
  swapTrainingGear(loadItemData(), s, trainingGear(loadStats(), EQUIPMENT.values(), cls), newUid);
  save(userId, s);
  return { ok: true, adventure: s };
}

/** Starts a member's class, quests and equipment over (the CMS): no class, the Tanod's quest again on their next visit,
 *  and their training gear gone (worn or carried; it comes again with the next class). Everything else they own stays,
 *  Kusing too. Their level and XP stay; every stat and skill point comes back. */
export function resetAdventure(userId: string): void {
  if (!getStmt.get(userId)) return;
  const s = load(userId);
  const training = (i: Item | undefined) => !!i && !!EQUIPMENT.get(i.defId)?.training;
  const equipped = Object.fromEntries(Object.entries(s.equipped).filter(([, i]) => !training(i)));
  // Quest rewards already given stay given (doing the quest again doesn't pay twice).
  const quests = { ...freshAdventure().quests, ...(s.quests.rewarded ? { rewarded: s.quests.rewarded } : {}) };
  save(userId, { ...freshAdventure(), quests, equipped, bag: s.bag.filter((i) => !training(i)), kusing: s.kusing, progress: refundPoints(loadStats(), null, s.progress) });
}
