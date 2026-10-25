import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AdventureState, ClassesFile, EquipPlace, Item, QuestDef, QuestReward, QuestsFile, StatName, TownAdventureResponse, TownEquipAction, TownForgeAction, TownForgeResponse, TownPointsAction, TownQuestAction, TownSkillsAction, CosmeticPlace, TownPetAction } from '@mikazuki/shared';
import { type ShopEvents, type PalengkeData, addToBag, markCutscene, advanceCollects, ringBell, buyCosmetic, dishOf, dishPrice, dishRefusal, RAMON, SILONG_FLAGS, countOf, expireItems, finishQuest, freeDishOf, itemName, heldCount, objectiveCount, offeredBy, palengkeQuests, questItemDrops, startDaily, startInArea, takeFromBag, unlockedAt } from '@mikazuki/shared';
import { STAT_NAMES, bagSlots, classSkills, classBuffs, buffSkillLevels, damageSkillLevels, skillLevelOf, equipFromBag, giveGear, giveQuestRewards, giveQuestPieces, questKill, readyToReport, withLeveling, missingTraining, moveUnlock, newItem, placesFor, swapTrainingGear, trainingGear, takeKind, unequipToBag, wearCheck, COSMETIC_PLACES, wearCosmetic, unwearCosmetic, wornItems, gainPetXp, petAction, petIdOf, petRules } from '@mikazuki/shared';
import { db } from '../db/db.js';
import { type LevelGain, type SavedProgress, addXp, freshProgress, killXp, levelTo, progressView, raiseSkill, refundPoints, resetSkillPoints, resetStatPoints, spendPoint } from './progress.js';
import { type Attacker, fighterStats } from './town-mobs.js';
import { type CombatItems, type LootContent, buyCombat, dropFromBag, takeLoot, usePotion } from './combat-bag.js';
import { forge } from './forge.js';
import { type HeldOffer, settleTrade } from './trade.js';
import { loadDungeons, loadGear, loadItemData, loadLeveling, loadPalengkeLeveling, loadStats } from './stats-data.js';

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

/** The Lumang Palengke's quest chain (classes/palengke-leveling.json; its NPCs' names from maps/palengke.json). */
export const PALENGKE = loadPalengkeLeveling() as unknown as PalengkeData;
const PALENGKE_NPCS = new Map(asset<{ npcs?: { id: string; name: string }[] }>('maps/palengke.json').npcs?.map((n) => [n.id, n.name]) ?? []);
/** quests/quests.json, the Tanod's leveling chain filled in from classes/leveling.json, then the Palengke's chain. */
export const QUESTS: QuestDef[] = [...withLeveling(asset<QuestsFile>('quests/quests.json').quests, loadLeveling()), ...palengkeQuests(PALENGKE, (id) => PALENGKE_NPCS.get(id) ?? id)];
export const CLASSES = asset<ClassesFile>('classes/classes.json').classes;
export const EQUIPMENT = loadGear();
const PLACES = new Set<EquipPlace>(['weapon', 'head', 'body', 'hands', 'bottoms', 'feet', 'necklace', 'earrings', 'bracers1', 'bracers2', 'ring1', 'ring2']);

export { placesFor };

export const freshAdventure = (): AdventureState => ({ cls: null, quests: { active: [], done: [] }, equipped: {}, cosmetics: {}, pet: null, bag: [], kusing: 0, progress: freshProgress(loadStats()), trainingArmorGiven: false });
/** How a worn cosmetic's place is kept in the items table's `place` ("costume:head"). */
const COSTUME_PLACE = 'costume:';
/** The pet out's place in the items table. */
const PET_PLACE = 'pet';

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

/** Starts the autoStart quests they haven't started or finished (a class quest only for someone without a class), and
 *  moves on any collect objective whose item is in the bag; a finished quest's next one waits for its unlockLevel
 *  (CONTEXT.md Level gap); today's daily order once the Palengke's chain is done. Returns the ones started. */
export function startQuests(s: AdventureState, now = Date.now()): QuestDef[] {
  advanceCollects(s, QUESTS);
  const started: QuestDef[] = [];
  for (const q of QUESTS) {
    if (!q.autoStart || s.quests.done.includes(q.id) || s.quests.active.some((p) => p.id === q.id)) continue;
    if (s.cls && q.objectives.some((o) => o.type === 'chooseClass')) continue;
    s.quests.active.push({ id: q.id, step: 0 });
    started.push(q);
  }
  // A finished quest's next one that never started (it was added after they finished: the Tanod's leveling chain after
  // the class quest).
  for (const id of s.quests.done) {
    const next = QUESTS.find((q) => q.id === QUESTS.find((x) => x.id === id)?.next);
    if (!next || s.quests.done.includes(next.id) || s.quests.active.some((p) => p.id === next.id) || !unlockedAt(next, s.progress.level)) continue;
    s.quests.active.push({ id: next.id, step: 0 });
    started.push(next);
  }
  const daily = startDaily(s, QUESTS, PALENGKE, now);
  if (daily) started.push(daily);
  return started;
}

/** The current objective's done: on to the next, or the quest is complete (and its `next` starts). */
function advance(s: AdventureState, q: QuestDef, now = Date.now()): string | undefined {
  const p = s.quests.active.find((x) => x.id === q.id)!;
  p.step++;
  delete p.count; // (the next objective counts from 0)
  if (p.step < q.objectives.length) return undefined;
  finishQuest(s, q, PALENGKE, now); // (a daily order: today's handed in, never into done)
  // (Its next one waits for its level: completedWith starts it once the reward's XP is in, startQuests after.)
  const next = q.next && QUESTS.find((x) => x.id === q.next);
  if (next && !s.quests.done.includes(next.id) && unlockedAt(next, s.progress.level)) s.quests.active.push({ id: next.id, step: 0 });
  return q.id;
}

type Result = Omit<TownAdventureResponse, 'adventure'>;
/** A quest action proper (a cutscene's mark is townQuest's alone). */
type QuestStepAction = Exclude<TownQuestAction, { action: 'cutscene' }>;

/** What the host knows for a quest step: whether they have a practice run open (Aling Nena hands over no ticket then),
 *  and the time. */
export interface QuestCtx {
  inPracticeRun?: boolean;
  now?: number;
}

/** The practice run's quest (dungeons.json entry.requiresQuest) and its ticket (warrens.practice), if there are both. */
function practiceQuest(): { quest: string; ticket: string; drop?: string; retryMs: number } | null {
  const W = loadDungeons().warrens;
  const P = W.practice;
  return W.entry.requiresQuest && P ? { quest: W.entry.requiresQuest, ticket: P.ticket, drop: P.drop, retryMs: (P.retryHours ?? 0) * 3_600_000 } : null;
}

/** Aling Nena hands over a Practice Warren Ticket for her quest (into the bag: false if it has no room). */
function handTicket(s: AdventureState, p: { givenAt?: number }, ticket: string, now: number): boolean {
  const data = loadItemData();
  const def = data.defs.get(ticket);
  if (!def || !addToBag(data, s.bag, newItem(data.stats, def, newUid()), newUid)) return false;
  p.givenAt = now;
  return true;
}

/** An objective done in the game: checked against the quest's current objective. Talking to an offered quest's giver
 *  starts it (CONTEXT.md "Offered quest"). */
export function questStep(s: AdventureState, a: QuestStepAction, ctx: QuestCtx = {}): Result & { ups?: number } {
  const now = ctx.now ?? Date.now();
  advanceCollects(s, QUESTS);
  const q = QUESTS.find((x) => x.id === a.quest);
  if (q && a.action === 'talk' && !s.quests.active.some((x) => x.id === q.id) && offeredBy(s, QUESTS, a.npc)?.id === q.id) s.quests.active.push({ id: q.id, step: 0 });
  const p = s.quests.active.find((x) => x.id === a.quest);
  if (!q || !p) return { ok: false, message: "That quest isn't under way." };
  const o = q.objectives[p.step];
  const P = practiceQuest()?.quest === q.id ? practiceQuest() : null;
  if (a.action === 'report') {
    // Its count reached (kills, a mini boss): reported over the Tanod's radio, wherever they are.
    if (!readyToReport(q, p)) return { ok: false, message: 'Not done yet.' };
    return completedWith(s, { ok: true, completed: advance(s, q, now) }, now);
  }
  if (a.action === 'talk') {
    // Its giver while you hunt for its item (Aling Nena, the binoculars): her reminder, and another Practice Warren Ticket
    // when you have none, nor the item, nor a practice run going (once retryHours have passed since the last one).
    if (o?.type === 'collect' && q.giver === a.npc) {
      if (!P || heldCount(s.bag, P.ticket) || heldCount(s.bag, o.item) || ctx.inPracticeRun) return { ok: true };
      if (p.givenAt !== undefined && now - p.givenAt < P.retryMs) {
        const hours = Math.ceil((p.givenAt + P.retryMs - now) / 3_600_000);
        return { ok: true, message: `Aling Nena has no ticket for you yet. Come back in ${hours} ${hours === 1 ? 'hour' : 'hours'}.` };
      }
      if (!handTicket(s, p, P.ticket, now)) return { ok: false, message: 'Make room in your bag: Aling Nena has a ticket for you.' };
      return { ok: true, handed: P.ticket };
    }
    // A deliver objective: they take the item (all of it, or nothing), and it's done.
    if (o?.type === 'deliver' && o.npc === a.npc) {
      if (!o.item || !takeFromBag(s.bag, o.item, objectiveCount(o))) return { ok: false, message: "You don't have it yet." };
      const r = completedWith(s, { ok: true, taken: o.item, completed: advance(s, q, now) }, now);
      // Aling Nena's quest done: any Practice Warren Ticket left goes.
      if (r.completed && P) s.bag = s.bag.filter((it) => it.defId !== P.ticket);
      return r;
    }
    if (o?.type !== 'talk' || o.npc !== a.npc) return { ok: false, message: 'Not yet.' };
    // A talk that hands something over (Tisay's note), into the bag (no room: not yet).
    if (o.gives) {
      const data = loadItemData();
      const def = data.defs.get(o.gives);
      if (def && !heldCount(s.bag, o.gives) && !addToBag(data, s.bag, newItem(data.stats, def, newUid()), newUid)) return { ok: false, message: 'Make room in your bag first.' };
      return completedWith(s, { ok: true, handed: o.gives, completed: advance(s, q, now) }, now);
    }
    // Aling Nena's first talk: her Practice Warren Ticket (no room: she gives it next time).
    const handed = P && handTicket(s, p, P.ticket, now) ? P.ticket : undefined;
    return completedWith(s, { ok: true, ...(handed ? { handed } : {}), completed: advance(s, q, now) }, now);
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
  return completedWith(s, { ok: true, given: weapon?.id, ...(gear.length ? { gear } : {}), completed: advance(s, q, now) }, now);
}

/** A step's answer, with the quest's rewards if it was just completed: its items into the combat bag, its XP (`ups`:
 *  the levels it brought) and Kusing (the leveling chain's: the same for everyone). */
function completedWith(s: AdventureState, r: Result, now = Date.now()): Result & { ups?: number } {
  if (!r.completed) return r;
  const q = QUESTS.find((x) => x.id === r.completed);
  const rewards = giveQuestRewards(loadItemData(), s, QUESTS, newUid);
  // A mini boss quest's +5 piece, into the bag with them.
  const pieces = giveQuestPieces(loadItemData(), loadLeveling(), s, newUid);
  const out: Result & { ups?: number } = { ...r, ...(rewards.length ? { rewards } : {}), ...(pieces.length ? { pieces } : {}) };
  if (q?.rewardKusing) {
    s.kusing += q.rewardKusing;
    out.kusing = q.rewardKusing;
  }
  // (Its Kowens go into the wallet where the request is answered: web/server.ts.)
  if (q?.rewardKowens) out.kowens = q.rewardKowens;
  if (q?.rewardXP) {
    const g = addXp(loadStats(), s.cls, s.progress, q.rewardXP);
    s.progress = g.progress;
    out.xp = g.gained;
    out.ups = g.ups;
  }
  // (Its title is given, and its free dish served, where the request is answered: web/server.ts.)
  if (q?.rewardTitle) out.title = q.rewardTitle;
  const dish = q?.freeDish ? freeDishOf(s, QUESTS, PALENGKE, q.freeDish) : null;
  if (dish) out.dish = dish;
  // Its next one, if that XP reached its level.
  const started = startQuests(s, now).map((x) => x.id);
  if (started.length) out.started = started;
  return out;
}

/** A kill that counts toward a member's quests (theirs, or their party's nearby): the counts saved; their active quests
 *  if anything moved (the town tells them), else null. (A mini boss quest's +5 piece comes with its report.) */
export function questKillFor(userId: string, kill: { kind: string; mini: boolean }): { active: AdventureState['quests']['active'] } | null {
  const s = load(userId);
  if (!questKill(s, QUESTS, kill)) return null;
  advanceCollects(s, QUESTS); // (a hand-in hunt done: on to its NPC)
  save(userId, s);
  return { active: s.quests.active };
}

/** They rang a field boss's bell (the Great Scale's): their "ring the bell" step moves on, saved; their active quests if
 *  it did, else null. */
export function ringBellFor(userId: string, mob: string): { active: AdventureState['quests']['active'] } | null {
  const s = load(userId);
  if (!ringBell(s, QUESTS, mob)) return null;
  save(userId, s);
  return { active: s.quests.active };
}

/** Wear an item from the combat bag (by uid; in the place asked for, else the first free one for its kind, else the
 *  first), or take one off into the bag (refused when it's full). An orange item binds as it's first worn. */
export function equipStep(s: AdventureState, a: TownEquipAction): Result {
  if (a.action === 'equip') return equipFromBag(loadItemData(), s, a.item, a.place);
  if (a.action === 'wear-cosmetic') return wearCosmetic(loadItemData(), s, a.item, a.place);
  if (a.action === 'take-off-cosmetic') return unwearCosmetic(loadItemData(), s, a.place);
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
  const r = raiseSkill(loadStats(), s.cls, s.progress, [...classSkills(classOf(s.cls)), ...classBuffs(classOf(s.cls))].find((k) => k.key === a.skill));
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
  xp: number;
  points: string | null;
  expires_at: number | null;
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
const itemsStmt = db.prepare<[string], ItemRow>('SELECT uid, def_id, level, rarity, plus, broken, bound, luck, agimats, lines, stat, lock, count, place, slot, xp, points, expires_at FROM items WHERE owner = ? ORDER BY slot, created, uid');
const dropItemsStmt = db.prepare('DELETE FROM items WHERE owner = ?');
const addItemStmt = db.prepare(
  `INSERT INTO items (uid, owner, def_id, level, rarity, plus, broken, bound, luck, agimats, lines, stat, lock, count, place, slot, created, xp, points, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  ...(r.points !== null ? { xp: r.xp, points: JSON.parse(r.points) } : {}),
  ...(r.expires_at !== null ? { expiresAt: r.expires_at } : {}),
});

/** Their items: worn by place (gear, and cosmetics as "costume:<place>"), and the combat bag in order. */
function loadItems(userId: string): Pick<AdventureState, 'equipped' | 'cosmetics' | 'bag' | 'pet'> {
  const equipped: AdventureState['equipped'] = {};
  const cosmetics: AdventureState['cosmetics'] = {};
  const bag: Item[] = [];
  const worn = new Map<string, Item>();
  let pet: Item | null = null;
  for (const r of itemsStmt.all(userId)) {
    if (r.place === PET_PLACE) pet = fromRow(r);
    else if (r.place && PLACES.has(r.place as EquipPlace)) worn.set(r.place, fromRow(r));
    else if (r.place?.startsWith(COSTUME_PLACE) && COSMETIC_PLACES.includes(r.place.slice(COSTUME_PLACE.length) as CosmeticPlace)) cosmetics[r.place.slice(COSTUME_PLACE.length) as CosmeticPlace] = fromRow(r);
    else bag.push(fromRow(r));
  }
  for (const p of PLACES) if (worn.has(p)) equipped[p] = worn.get(p); // in the panel's order
  return { equipped, cosmetics, bag, pet };
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
  const s: AdventureState = { cls: row.class, quests: JSON.parse(row.quests), ...loadItems(userId), kusing: row.kusing, progress, trainingArmorGiven: !!row.training_armor_given };
  // Timed items that ran out (CONTEXT.md Timed cosmetic): gone wherever they are, on every load; the member is told on
  // their next look (expiredFor: login, the town's sweep).
  const gone = expireItems(s, Date.now());
  if (gone.length) {
    const data = loadItemData();
    expired.set(userId, [...(expired.get(userId) ?? []), ...gone.map((g) => ({ name: itemName(data, g.item), worn: !!g.place }))]);
    save(userId, s);
  }
  return s;
}

/** Timed items taken out since a member was last told, by member. */
const expired = new Map<string, { name: string; worn: boolean }[]>();

/** The timed items of a member's that have run out since they were last told (each once: the town's sweep and /me tell
 *  them), anything due taken out now. */
export function expiredFor(userId: string): { name: string; worn: boolean }[] {
  load(userId);
  const gone = expired.get(userId) ?? [];
  expired.delete(userId);
  return gone;
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
    addItemStmt.run(i.uid, userId, i.defId, i.level, i.rarity, i.plus, i.broken ? 1 : 0, i.bound ? 1 : 0, i.luck, JSON.stringify(i.agimats), JSON.stringify(i.lines), i.stat ?? null, i.lock ?? null, i.count, place, slot, now,
      i.xp ?? 0, i.points ? JSON.stringify(i.points) : null, i.expiresAt ?? null);
  for (const [place, item] of Object.entries(s.equipped)) if (item) put(item, place, null);
  for (const [place, item] of Object.entries(s.cosmetics)) if (item) put(item, COSTUME_PLACE + place, null);
  if (s.pet) put(s.pet, PET_PLACE, null);
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
/** Mini boss quests' +5 pieces not given yet (finished before the piece came with the report, or there was no room),
 *  into their bag now (on /me); what was given. */
export function questPiecesFor(userId: string): Item[] {
  const s = load(userId);
  const given = giveQuestPieces(loadItemData(), loadLeveling(), s, newUid);
  if (given.length) save(userId, s);
  return given;
}

export function questRewardsFor(userId: string): QuestReward[] {
  const s = load(userId);
  const given = giveQuestRewards(loadItemData(), s, QUESTS, newUid);
  if (given.length) save(userId, s);
  return given;
}

/** Their worn items, combat bag and Kusing (the town's `items` message). */
export function combatOf(userId: string): CombatItems {
  const { equipped, cosmetics, bag, kusing, pet } = load(userId);
  return { equipped, cosmetics, bag, kusing, pet: pet ?? null };
}

/** The cosmetics a member wears (the look they show: shared cosmetics.ts). */
export function cosmeticsOf(userId: string): AdventureState['cosmetics'] {
  return load(userId).cosmetics;
}

/** Changes their items or Kusing through `f` and saves it if it says so; what `f` returned. A collect objective whose
 *  item just came in moves on with it. */
export function withItems<T>(userId: string, f: (s: AdventureState) => T, changed: (r: T) => boolean = () => true): T {
  const s = load(userId);
  const r = f(s);
  if (changed(r)) {
    advanceCollects(s, QUESTS);
    save(userId, s);
  }
  return r;
}

/** Aling Nena's quest, for the Warren Gate (town-warrens.ts WarrensAccess): done (a real run may open), needing its item
 *  still (a practice run may open), and their Practice Warren Tickets. */
export function warrensAccessOf(userId: string): { done: boolean; needs: boolean; practiceTickets: number } {
  const P = practiceQuest();
  if (!P) return { done: true, needs: false, practiceTickets: 0 };
  const s = load(userId);
  const p = s.quests.active.find((x) => x.id === P.quest);
  const o = p && QUESTS.find((q) => q.id === P.quest)?.objectives[p.step];
  return { done: s.quests.done.includes(P.quest), needs: o?.type === 'collect' && !heldCount(s.bag, o.item), practiceTickets: heldCount(s.bag, P.ticket) };
}

/** One Practice Warren Ticket out of their bag (opening a practice run): false if they have none. */
export const usePracticeTicketFor = (userId: string): boolean => {
  const P = practiceQuest();
  return !!P && useKindFor(userId, P.ticket);
};

/** The quest item a practice run's last boss drops for them (warrens.practice.drop), while their quest needs it. */
export function practiceDropFor(userId: string): Item | null {
  const P = practiceQuest();
  const data = loadItemData();
  const def = P?.drop ? data.defs.get(P.drop) : undefined;
  return def && warrensAccessOf(userId).needs ? newItem(data.stats, def, newUid()) : null;
}

/** Loot picked up in the Slums (Kusing, or an item into the bag): false if the bag has no room for it. */
export const takeLootFor = (userId: string, loot: LootContent): boolean => withItems(userId, (s) => takeLoot(loadItemData(), s, loot, newUid), (ok) => ok);

/** `count` of an item out of their bag to drop on the ground (the town's `drop`): the item, or why not. */
export const dropItemFor = (userId: string, uid: string, count: number) => withItems(userId, (s) => dropFromBag(loadItemData(), s, uid, count, newUid), (r) => typeof r !== 'string');

/** One HP or MP Potion of a kind used from their bag: what it heals, or null (none). */
export const usePotionFor = (userId: string, defId: string) => withItems(userId, (s) => usePotion(loadItemData(), s, defId), (r) => !!r);

/** Warren Tickets in their combat bag (the Warren Gate's panel). */
/** How many of a kind they hold in their combat bag. */
export const kindCountOf = (userId: string, defId: string): number => load(userId).bag.reduce((n, i) => n + (i?.defId === defId ? (i.count ?? 1) : 0), 0);

/** One of a kind out of their bag (a ticket, a Return Lantern): false if they have none. */
export const useKindFor = (userId: string, defId: string): boolean => withItems(userId, (s) => takeKind(s.bag, defId, 1), (ok) => ok);

export const warrenTicketsOf = (userId: string): number => kindCountOf(userId, loadDungeons().warrens.ticket.id);

/** One Warren Ticket out of their bag (opening a run): false if they have none. */
export const useTicketFor = (userId: string): boolean => useKindFor(userId, loadDungeons().warrens.ticket.id);

/** One of a kind back into their bag (a ticket of a run that ended before a boss fell): false if no room. */
function refundKindFor(userId: string, defId: string | undefined): boolean {
  const data = loadItemData();
  const def = defId ? data.defs.get(defId) : undefined;
  return !!def && withItems(userId, (s) => takeLoot(data, s, { item: newItem(data.stats, def, newUid()) }, newUid), (ok) => ok);
}

/** A Warren Ticket back into their bag (their run ended before a boss fell): false if no room. */
export const refundTicketFor = (userId: string): boolean => refundKindFor(userId, loadDungeons().warrens.ticket.id);

/** A Practice Warren Ticket back into their bag (their practice run ended before a boss fell): false if no room. */
export const refundPracticeTicketFor = (userId: string): boolean => refundKindFor(userId, practiceQuest()?.ticket);

// ── Ang Silong's keys (classes/dungeons.json silong.key; the Practice Susi from "Now's the Time") ──

const SILONG_KEY = () => loadDungeons().silong?.key.id ?? 'susi-ng-silong';
export const PRACTICE_SUSI = 'practice-susi-ng-silong';
/** The quest that lets you into Ang Silong (its Practice Susi comes with it), and the finale after which Aling Conching
 *  sells keys. */
const SILONG_QUEST = 'palengke-15';
const FINALE = 'palengke-14';

export const silongKeysOf = (userId: string): number => kindCountOf(userId, SILONG_KEY());
export const useSilongKeyFor = (userId: string): boolean => useKindFor(userId, SILONG_KEY());
export const refundSilongKeyFor = (userId: string): boolean => refundKindFor(userId, SILONG_KEY());
export const usePracticeSusiFor = (userId: string): boolean => useKindFor(userId, PRACTICE_SUSI);
export const refundPracticeSusiFor = (userId: string): boolean => refundKindFor(userId, PRACTICE_SUSI);

/** Who may come into Ang Silong: "Now's the Time" done, and how many Practice Susi they hold. */
export function silongAccessOf(userId: string): { done: boolean; practiceKeys: number } {
  const s = load(userId);
  return { done: s.quests.done.includes(SILONG_QUEST), practiceKeys: heldCount(s.bag, PRACTICE_SUSI) };
}

/** A Susi ng Silong from Aling Conching (after the Great Scale's finale): its Kusing spent, the key into the bag. Null:
 *  bought; else why not. */
export function buySilongKeyFor(userId: string): string | null {
  const data = loadItemData();
  const def = data.defs.get(SILONG_KEY());
  const price = loadDungeons().silong?.key.sources.shop.kusing ?? 0;
  if (!def || !price) return 'No keys for sale.';
  return withItems(
    userId,
    (s): string | null => {
      if (!s.quests.done.includes(FINALE)) return 'Aling Conching keeps the keys until the Great Scale rests.';
      if (s.kusing < price) return 'Not enough Kusing.';
      if (!takeLoot(data, s, { item: newItem(data.stats, def, newUid()) }, newUid)) return 'Your bag is full.';
      s.kusing -= price;
      return null;
    },
    (why) => why === null,
  );
}

/** Buys `quantity` of a combat item at the sari-sari store (its Healing and Smithing tabs): HP/MP Potions for Kusing,
 *  whetstones and Repair Kits for Kowens (`kowens`: their wallet). */
export const buyCombatFor = (userId: string, defId: string, quantity: number, kowens: { have: number; spend(n: number): boolean }) =>
  withItems(userId, (s) => buyCombat(loadItemData(), s, s.progress.level, defId, quantity, kowens, newUid), (r) => r.ok);

/** Buys a cosmetic or a Set from the store's Cosmetics tab (shared cosmetic-shop.ts), saved when it works. */
export const buyCosmeticFor = (userId: string, id: string, events: ShopEvents, kowens: { have: number; spend(n: number): boolean }) =>
  withItems(userId, (s) => buyCosmetic(loadItemData(), s, id, events, kowens, newUid), (r) => r.ok);

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

/** Their class, worn weapon (its kind and its + for the aura: 0 when broken), level and pet out, for the town (the chat's badge,
 *  the resting weapon). */
export function kitOf(userId: string): { cls: string | null; weapon: string | null; weaponPlus: number; level: number; pet: string | null } {
  const s = load(userId);
  return { cls: s.cls, weapon: s.equipped.weapon?.defId ?? null, weaponPlus: weaponPlusOf(s.equipped.weapon), level: s.progress.level, pet: petIdOf(loadItemData(), s.pet) };
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
  return { ...r, items: { equipped: s.equipped, cosmetics: s.cosmetics, bag: s.bag, kusing: s.kusing, pet: s.pet ?? null }, worn: r.ok && before !== JSON.stringify(s.equipped) };
}

const withClassStmt = db.prepare<[], { user_id: string }>('SELECT user_id FROM adventurers WHERE class IS NOT NULL');
/** Every member with a class (the leaderboard's combat rating board). */
export const adventurersWithClass = (): string[] => withClassStmt.all().map((r) => r.user_id);

/** Who they are in a fight (MobRoom.attack's Attacker): class, level, stat points spent, everything worn, and their damage
 *  skills' levels in the class's order. */
export function fighterOf(userId: string): Attacker {
  const s = load(userId);
  const moves = Object.fromEntries((classOf(s.cls)?.mobility ?? []).map((m) => [m.id, skillLevelOf(s.progress, m.id)]));
  // (The pet out counts like gear: its pet tree and its kind's bonus; a worn cosmetic with stats, a Moonlight weapon, while
  // it fits their class: shared items.ts itemTotals.)
  return { cls: s.cls, level: s.progress.level, points: s.progress.points, gear: [...wornItems(s), ...(s.pet ? [s.pet] : [])], skills: damageSkillLevels(classOf(s.cls), s.progress), moves, buffLevels: buffSkillLevels(classOf(s.cls), s.progress) };
}

/** Changes their progress through `f` (web/progress.ts) and saves it; a level-up starts any quest that waited for it
 *  (`quests`: their active quests then). */
function progress(userId: string, f: (cls: string | null, p: SavedProgress) => LevelGain): LevelGain & { quests?: AdventureState['quests']['active'] } {
  const s = load(userId);
  const r = f(s.cls, s.progress);
  s.progress = r.progress;
  const opened = r.ups > 0 && startQuests(s).length > 0;
  save(userId, s);
  return opened ? { ...r, quests: s.quests.active } : r;
}

/** They walked into a map: a chain that starts there (the Palengke's first quest, at its level) starts, saved; their
 *  active quests if one did, else null. */
export function enterAreaFor(userId: string, area: string): { active: AdventureState['quests']['active'] } | null {
  const s = load(userId);
  // (Today's daily order too, once its day has turned.)
  if (!startInArea(s, QUESTS, area).length && !(area === 'palengke' && startDaily(s, QUESTS, PALENGKE, Date.now()))) return null;
  save(userId, s);
  return { active: s.quests.active };
}

/** A dish bought from Aling Conching (CONTEXT.md Dish): unlocked for them and its Kusing in hand, spent and saved; null,
 *  or why not. (The town puts it on them.) */
export function buyDishFor(userId: string, dish: string): string | null {
  const s = load(userId);
  const refused = dishRefusal(s, QUESTS, PALENGKE, dish);
  if (refused) return refused;
  s.kusing -= dishPrice(s, PALENGKE, dish);
  save(userId, s);
  return null;
}

// ── Ang Silong's one-offs (shared silong.ts SILONG_FLAGS, RAMON) ──

/** A flag in their quests (kept with them); false if they had it. */
function flag(s: AdventureState, f: string): boolean {
  const flags = (s.quests.flags ??= []);
  if (flags.includes(f)) return false;
  flags.push(f);
  return true;
}

/** They were inside as Ang Makinang Yelo fell: cleared Ang Silong (Aling Conching's Atchara refill at half price). */
export function silongClearedFor(userId: string): void {
  const s = load(userId);
  if (flag(s, SILONG_FLAGS.cleared)) save(userId, s);
}

/** Mang Ramon's box on B2: his note into their bag (its quest pocket), unless they hold it or have handed it in. */
export function ramonBoxFor(userId: string): 'given' | 'have' | 'done' | 'full' {
  const data = loadItemData();
  const def = data.defs.get(RAMON.note);
  return withItems(
    userId,
    (s): 'given' | 'have' | 'done' | 'full' => {
      if (s.quests.flags?.includes(SILONG_FLAGS.ramonDone)) return 'done';
      if (countOf(s.bag, RAMON.note)) return 'have';
      if (!def || !takeLoot(data, s, { item: newItem(data.stats, def, newUid()) }, newUid)) return 'full';
      return 'given';
    },
    (r) => r === 'given',
  );
}

/** Mang Ramon's note to Kuya Jun: taken, a Mid Repair Kit for it, never again. Why not, or null. */
export function ramonGiveFor(userId: string): string | null {
  const data = loadItemData();
  const kit = data.defs.get(RAMON.reward);
  return withItems(
    userId,
    (s): string | null => {
      if (s.quests.flags?.includes(SILONG_FLAGS.ramonDone)) return 'He already has it.';
      if (!countOf(s.bag, RAMON.note) || !kit) return "You don't have Mang Ramon's note.";
      takeKind(s.bag, RAMON.note, 1);
      if (!takeLoot(data, s, { item: newItem(data.stats, kit, newUid()) }, newUid)) return 'Make room in your bag first.';
      flag(s, SILONG_FLAGS.ramonDone);
      return null;
    },
    (why) => why === null,
  );
}

/** The quest items a kill of `kind` drops for them (CONTEXT.md Quest item: only while a quest asks, at its dropChance),
 *  made as items for their own loot. */
export function questDropsFor(userId: string, kind: string, random: () => number = Math.random): Item[] {
  const data = loadItemData();
  return questItemDrops(load(userId), QUESTS, PALENGKE, kind, random).flatMap((id) => {
    const def = data.defs.get(id);
    return def ? [newItem(data.stats, def, newUid())] : [];
  });
}

/** A kill's XP for them (the town: town-mobs.ts says who killed what), saved; how many levels it went up. */
export const killFor = (userId: string, mob: { level: number; xp: number }): LevelGain => progress(userId, (cls, p) => killXp(loadStats(), cls, p, mob));

/** `n` XP for them, saved. */
export const gainXpFor = (userId: string, n: number): LevelGain => progress(userId, (cls, p) => addXp(loadStats(), cls, p, n));

/** Sets their level (nothing in the bot calls it yet: the game's dev server's ?level= has its own). */
export const levelFor = (userId: string, level: number): LevelGain => progress(userId, (cls, p) => levelTo(loadStats(), cls, p, level));

// ── Pets (@mikazuki/shared pets.ts) ──

/** When each member last sent a pet out or called one back (the swap cooldown), in memory: a restart forgets it. */
const petChanges = new Map<string, number>();

/** A pet action on their state (shared petAction): never a swap in a fight (`inCombat`: the town's rule) or within the
 *  cooldown of their last one. */
export function petStep(userId: string, s: AdventureState, a: TownPetAction, inCombat: boolean, now = Date.now()): Result & { changed?: boolean } {
  const r = petAction(loadItemData(), s, a, { lastChange: petChanges.get(userId), now, inCombat, newUid });
  if (r.changed) petChanges.set(userId, now);
  return r;
}

/** POST /town/pet for a member. `changed`: the pet out changed (everyone sees it; fights use its stats). */
export function townPet(userId: string, a: TownPetAction, inCombat: boolean): TownAdventureResponse & { changed: boolean } {
  const s = load(userId);
  const r = petStep(userId, s, a, inCombat);
  if (r.ok) save(userId, s);
  return { ...r, adventure: s, changed: !!r.changed };
}

const petRowStmt = db.prepare<[string], ItemRow>("SELECT uid, def_id, level, rarity, plus, broken, bound, luck, agimats, lines, stat, lock, count, place, slot, xp, points FROM items WHERE owner = ? AND place = 'pet'");
const petXpStmt = db.prepare('UPDATE items SET level = ?, xp = ? WHERE uid = ? AND owner = ?');

/** `n` Pet XP for the pet a member has out (the town: a hit on a monster, at most once a second), saved by itself (one
 *  row: this comes often); the pet as it is now and how many levels it went up, or null: no pet out (or it's maxed). */
export function petXpFor(userId: string, n: number): { pet: Item; ups: number } | null {
  const R = petRules(loadStats());
  const row = petRowStmt.get(userId);
  if (!R || !row) return null;
  const pet = fromRow(row);
  const g = gainPetXp(R, pet, n);
  if (!g.gained) return null;
  petXpStmt.run(pet.level, pet.xp ?? 0, pet.uid, userId);
  return { pet, ups: g.ups };
}

/** The body of POST /town/quest, if it's a valid one. */
export function parseQuestAction(body: unknown): TownQuestAction | null {
  const b = body as Record<string, unknown> | null;
  if (b?.action === 'cutscene' && typeof b.cutscene === 'string' && (b.mark === 'seen' || b.mark === 'due')) return { action: 'cutscene', cutscene: b.cutscene, mark: b.mark };
  if (!b || typeof b.quest !== 'string') return null;
  if (b.action === 'talk' && typeof b.npc === 'string') return { quest: b.quest, action: 'talk', npc: b.npc };
  if (b.action === 'chooseClass' && typeof b.cls === 'string') return { quest: b.quest, action: 'chooseClass', cls: b.cls };
  if (b.action === 'report') return { quest: b.quest, action: 'report' };
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
  const cplace = (p: unknown) => (typeof p === 'string' && COSMETIC_PLACES.includes(p as CosmeticPlace) ? (p as CosmeticPlace) : null);
  if (b?.action === 'wear-cosmetic' && typeof b.item === 'string') {
    if (b.place === undefined) return { action: 'wear-cosmetic', item: b.item };
    return cplace(b.place) ? { action: 'wear-cosmetic', item: b.item, place: cplace(b.place)! } : null;
  }
  if (b?.action === 'take-off-cosmetic' && cplace(b.place)) return { action: 'take-off-cosmetic', place: cplace(b.place)! };
  return null;
}

/** POST /town/quest for a member: the step checked and saved. `changed`: their class or weapon changed (the town shows it). */
export function townQuest(userId: string, a: TownQuestAction, ctx: QuestCtx = {}): TownAdventureResponse & { changed: boolean; ups?: number } {
  const s = load(userId);
  // A cutscene watched, or waiting for its map (CONTEXT.md Cutscene: once each, on every device).
  if (a.action === 'cutscene') {
    if (markCutscene(s.quests, a.cutscene, a.mark)) save(userId, s);
    return { ok: true, adventure: s, changed: false };
  }
  startQuests(s);
  const before = `${s.cls}|${s.equipped.weapon?.defId}`;
  const r = questStep(s, a, ctx);
  if (r.ok) save(userId, s);
  return { ...r, adventure: s, changed: r.ok && before !== `${s.cls}|${s.equipped.weapon?.defId}` };
}

/** POST /town/equip for a member. `changed`: their worn gear changed (the town shows the weapon, fights the rest). */
export function townEquip(userId: string, a: TownEquipAction): TownAdventureResponse & { changed: boolean; costume: boolean } {
  const s = load(userId);
  const r = equipStep(s, a);
  if (r.ok) save(userId, s);
  const costume = a.action === 'wear-cosmetic' || a.action === 'take-off-cosmetic';
  return { ...r, adventure: s, changed: r.ok && !costume, costume: r.ok && costume };
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

/** Their Drop rate (the stat, capped: class, level, points, worn gear and the pet out; no buffs): the loot cascades'
 *  boost (CONTEXT.md Drop rate; town-warrens.ts RunDeps.dropRate). */
export const dropRateOf = (userId: string): number => fighterStats(loadItemData(), fighterOf(userId)).dropRate ?? 0;
