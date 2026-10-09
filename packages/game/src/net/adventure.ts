import {
  type AdventureState,
  type AnyItemDef,
  type CharacterProgress,
  type CombatItemsFile,
  type Item,
  type ItemData,
  type TownItems,
  type ClassInfo,
  type ClassSkill,
  type ClassesFile,
  type EquipmentDef,
  type EquipmentFile,
  type EquipPlace,
  type QuestDef,
  type QuestReward,
  type LevelingData,
  type QuestProgress,
  type QuestsFile,
  type StatName,
  type StatsData,
  type TownAdventureResponse,
  type TownEquipAction,
  type TownForgeAction,
  type TownForgeResponse,
  type TownPointsAction,
  type TownQuestAction,
  type TownSkillsAction,
  classSkills,
  classBuffs,
  equipFromBag,
  giveGear,
  giveQuestRewards,
  questKill,
  readyToReport,
  withLeveling,
  addToBag,
  missingTraining,
  needsLine,
  newItem,
  placesFor,
  skillCap,
  skillLevelOf,
  skillPointsAt,
  swapTrainingGear,
  trainingGear,
  unequipToBag,
  unspentStatPoints,
  wearCheck,
  xpToNext,
} from '@mikazuki/shared';
import { fakeLogin, fakeName } from '../session';

// ⚔️ Your class, quests and equipment in the game (the bot keeps them: web/adventure.ts; /me brings them, POST
// /town/quest, /town/equip, /town/points and /town/skills change them). The data files (quests/quests.json, classes/classes.json,
// items/equipment.json; classes/stats.json, the stats rules' numbers, comes with the scene's assets) are loaded once. Everything that shows them listens here: the quest tracker and log, the
// marker over a quest giver, the equipment panel, the avatar's class badge, the HUD's level and XP. Your level, XP and
// points change on the server (kills in the Slums: the town's `progress` messages, setProgress). In dev with no bot, the
// same rules run here, saved in this browser per ?as= name (&quests=reset starts over), and the dev town hears about
// class and weapon changes (/__kit) and keeps your level while it runs (sent on connect; ?xp= / ?level= ask it, /__xp;
// stat and skill points are spent there too, /__points and /__skills, by the bot's rules).
// Items are instances (@mikazuki/shared items.ts): what's worn, the combat bag and the Kusing wallet come with the state
// and change on the server (loot, potions, the shop: the town's `items` messages, setItems). In dev the pretend state
// keeps them in this browser too, and the dev town keeps its own copy (/__items, sent whenever they change here), which
// its loot, potions, shop and ?give= change and send back.

export interface AdventureData extends ItemData {
  quests: QuestDef[];
  classes: ClassInfo[];
  equipment: Map<string, EquipmentDef>;
  /** classes/leveling.json: the mini bosses and the Tanod's leveling quests (filled into `quests`). */
  leveling: LevelingData | null;
  /** classes/stats.json, for @mikazuki/shared's stats rules. */
  stats: StatsData;
  /** Every item kind (gear and the rest: items/items.json), for the items rules. */
  defs: Map<string, AnyItemDef>;
}

/** What just happened, for the tracker's tick, the log button's dot and the banners. */
export interface AdventureChange {
  /** A quest whose current objective was just done (and the one done). */
  advanced?: { quest: string; objective: string };
  completed?: string;
  given?: string;
  /** Training armor given with it. */
  gear?: string[];
  /** Picked up (loot): Kusing, or an item. */
  got?: { kusing?: number; item?: Item };
  /** A quest's rewards, just given (the quest just completed, or one finished before it had any). */
  rewards?: QuestReward[];
  /** Quests that just started (the Tanod's lines as each is given). */
  started?: string[];
  /** A report's XP and Kusing. */
  xp?: number;
  kusing?: number;
}

let data: AdventureData | null = null;
let state: AdventureState | null = null;
const listeners = new Set<(s: AdventureState, change: AdventureChange) => void>();

export const adventureData = (): AdventureData | null => data;
export const adventure = (): AdventureState | null => state;
export const questDef = (id: string): QuestDef | undefined => data?.quests.find((q) => q.id === id);
export const classInfo = (id: string | null | undefined): ClassInfo | undefined => (id ? data?.classes.find((c) => c.id === id) : undefined);
export const itemDef = (id: string | null | undefined): EquipmentDef | undefined => (id ? data?.equipment.get(id) : undefined);
/** Any item kind (gear or not) by id. */
export const anyDef = (id: string | null | undefined): AnyItemDef | undefined => (id ? data?.defs.get(id) : undefined);

/** Listens for changes (called at once with the state, if there is one); returns the unsubscribe. */
export function onAdventure(fn: (s: AdventureState, change: AdventureChange) => void): () => void {
  listeners.add(fn);
  if (state) fn(state, {});
  return () => listeners.delete(fn);
}

function set(s: AdventureState, change: AdventureChange = {}, fromServer = false): void {
  // Dev: the banked stat points follow the pretend class (the bot works them out as it saves).
  if (fakeLogin() && data) s = { ...s, progress: { ...s.progress, next: xpToNext(data.stats, s.progress.level), statPoints: unspentStatPoints(data.stats, s.cls, s.progress.level, s.progress.points) } };
  const items = JSON.stringify([s.equipped, s.bag, s.kusing]);
  const changed = items !== JSON.stringify([state?.equipped, state?.bag, state?.kusing]);
  // Quests that weren't on before (not on the first state: those were on already).
  if (state && !change.started) {
    const started = s.quests.active.filter((p) => !state!.quests.active.some((x) => x.id === p.id)).map((p) => p.id);
    if (started.length) change = { ...change, started };
  }
  state = s;
  if (fakeLogin()) {
    saveFake(s);
    if (changed && !fromServer) pushItems(s); // the dev town's copy (its loot, potions and fights use it)
  }
  for (const fn of listeners) fn(s, change);
}

/** Your worn items, combat bag and Kusing from the server (the town's `items` message; `got`: just picked up). */
export function setItems(items: TownItems, got?: AdventureChange['got']): void {
  if (state) set({ ...state, ...items }, got ? { got } : {}, true);
}

/** A forge action (the popup's enhance, repair and embed; the bag's disassemble and combine), rolled by the bot (POST
 *  /town/forge; dev: the dev town's /__forge, the same code). Your items come back with the answer. */
export async function forgeAction(a: TownForgeAction): Promise<TownForgeResponse | null> {
  const path = fakeLogin() ? `/__forge?${new URLSearchParams({ as: fakeName() })}` : '/town/forge';
  if (fakeLogin()) await devItemsReady;
  const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) }).catch(() => null);
  const r = res?.ok ? ((await res.json()) as TownForgeResponse) : null;
  if (r?.items) setItems(r.items);
  return r;
}

/** Every item kind and the stats rules (the items module's data). */
export const itemData = (): ItemData | null => data;

/** Dev: settled once the dev town and this browser agree on your items (dev's ?give= waits for it). */
export let devItemsReady: Promise<unknown> = Promise.resolve();

/** Dev: the dev town's copy of your items (its loot, potions, shop and fights use it). */
function pushItems(s: AdventureState): Promise<unknown> {
  return fetch(`/__items?${new URLSearchParams({ as: fakeName() })}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ equipped: s.equipped, bag: s.bag, kusing: s.kusing }) }).catch(() => null);
}

/** Loads the data files (once); `stats` is loaded already (the scene's json cache). */
export async function loadAdventureData(url: (path: string) => string, files: { quests: string; classes: string; equipment: string; items?: string }, stats: StatsData | undefined, leveling?: LevelingData): Promise<AdventureData | null> {
  if (data) return data;
  const get = <T>(path: string) => fetch(url(path)).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null);
  const [q, c, e, i] = await Promise.all([get<QuestsFile>(files.quests), get<ClassesFile>(files.classes), get<EquipmentFile>(files.equipment), files.items ? get<CombatItemsFile>(files.items) : null]);
  if (!q || !c || !e || !stats) return null;
  const equipment = new Map(e.items.map((x) => [x.id, x]));
  data = { quests: withLeveling(q.quests, leveling), leveling: leveling ?? null, classes: c.classes, equipment, stats, defs: new Map<string, AnyItemDef>([...equipment, ...(i?.items ?? []).map((x): [string, AnyItemDef] => [x.id, x])]) };
  return data;
}

/** Your state from /me (or, in dev, this browser's pretend one, with the autoStart quests started as the bot would).
 *  Returns the training armor the Tanod has just left (a class from before training armor: /me's `trainingGear`) and
 *  quest rewards just given (quests finished before they had any: /me's `questRewards`) — in dev, given here the bot's
 *  way — for the town to say so once. */
export function initAdventure(fromMe: AdventureState | undefined, trainingArmor: string[] = [], questRewards: QuestReward[] = []): { armor: string[]; rewards: QuestReward[] } {
  if (fakeLogin()) {
    // Dev: &quests=reset forgets this browser's pretend class, quests and equipment (the Tanod's quest starts over).
    if (new URLSearchParams(location.search).get('quests') === 'reset') {
      try {
        localStorage.removeItem(fakeKey());
        localStorage.removeItem(SEEN_KEY);
      } catch {
        // nothing saved
      }
    }
    const s = loadFake();
    const jump = new URLSearchParams(location.search).get('quest');
    if (jump) jumpToQuest(s, jump);
    startQuests(s);
    const given = giveTrainingArmor(s);
    const rewards = data ? giveQuestRewards(data, s, data.quests, devUid) : [];
    set(s, {}, true); // (not sent yet: the dev town's copy may be newer)
    // The dev town's copy wins while it runs (a page closed in a hurry may not have saved its last items); after a
    // restart it has none, and gets this browser's.
    devItemsReady = fetch(`/__items?${new URLSearchParams({ as: fakeName() })}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ known: boolean } & Partial<TownItems>>) : null))
      .then((r) => {
        if (!r?.known || !r.bag) return state && pushItems(state);
        setItems({ equipped: r.equipped ?? {}, bag: r.bag, kusing: r.kusing ?? 0 });
        // Quest rewards just given here go into the dev town's copy too.
        if (!rewards.length || !state || !data) return;
        const s = structuredClone(state);
        for (const x of rewards) addToBag(data, s.bag, newItem(data.stats, data.defs.get(x.item)!, devUid(), x.count), devUid);
        set(s);
      })
      .catch(() => undefined);
    return { armor: given, rewards };
  }
  set(fromMe ?? fresh());
  return { armor: trainingArmor, rewards: questRewards };
}

// ── Quests seen in the log (the button's dot) ──

const SEEN_KEY = 'mk_quests_seen';

/** Quests started or moved on since the log was last opened: 'main', 'side' (the dot's colour; main first), or null. */
export function unseenQuest(): 'main' | 'side' | null {
  if (!state) return null;
  let seen: Record<string, number> = {};
  try {
    seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}');
  } catch {
    // nothing seen yet
  }
  const fresh = state.quests.active.filter((p) => seen[p.id] !== p.step).map((p) => questDef(p.id)?.type);
  return fresh.includes('main') ? 'main' : fresh.includes('side') ? 'side' : null;
}

/** The log was opened: everything in it now has been seen. */
export function markQuestsSeen(): void {
  if (!state) return;
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(state.quests.active.map((p) => [p.id, p.step]))));
  } catch {
    // private window: the dot comes back next time
  }
  for (const fn of listeners) fn(state, {});
}

// ── Actions ──

type Path = '/town/quest' | '/town/equip' | '/town/points' | '/town/skills';
type Body = TownQuestAction | TownEquipAction | TownPointsAction | TownSkillsAction;

async function post(path: Path, body: Body): Promise<TownAdventureResponse | null> {
  const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  return res?.ok ? ((await res.json()) as TownAdventureResponse) : null;
}

async function act(path: Path, body: Body): Promise<TownAdventureResponse | null> {
  const before = state;
  const res = !fakeLogin()
    ? await post(path, body)
    : path === '/town/points' || path === '/town/skills'
      ? await fakePoints(path, body as TownPointsAction | TownSkillsAction)
      : fakeAct(body as TownQuestAction | TownEquipAction);
  if (!res) return null;
  if (res.ok) {
    let advanced: AdventureChange['advanced'];
    if ('quest' in body) {
      const p = before?.quests.active.find((x) => x.id === body.quest);
      const o = p && questDef(body.quest)?.objectives[p.step];
      if (o) advanced = { quest: body.quest, objective: o.id };
    }
    set(res.adventure, { advanced, completed: res.completed, given: res.given, gear: res.gear, rewards: res.rewards, xp: res.xp, kusing: res.kusing });
    if (fakeLogin() && (before?.cls !== res.adventure.cls || JSON.stringify(before?.equipped) !== JSON.stringify(res.adventure.equipped))) {
      void fetch(`/__kit?${new URLSearchParams({ as: fakeName(), cls: res.adventure.cls ?? '', weapon: res.adventure.equipped.weapon?.defId ?? '' })}`).catch(() => null);
    }
  }
  return res;
}

/** Your level, XP and points from the server (the town's `progress` message). */
export function setProgress(progress: CharacterProgress): void {
  if (state) set({ ...state, progress });
}

/** Your quests' counts from the town (`quests`: a kill counted, saved by the bot). */
export function setQuestCounts(active: QuestProgress[]): void {
  if (state) set({ ...state, quests: { ...state.quests, active } }, {}, true);
}

/** Dev: a kill that counts toward quests (the dev town's `quest-kill`; it keeps no quests), counted here the bot's way. */
export function devQuestKill(kill: { kind: string; mini: boolean; level?: number }): void {
  if (!state || !data || !fakeLogin()) return;
  const s = structuredClone(state);
  const quests = data.quests;
  const waiting = s.quests.active.filter((p) => quests.find((q) => q.id === p.id)?.objectives[p.step]?.type === 'miniBoss' && !readyToReport(questDef(p.id), p)).map((p) => p.id);
  if (!questKill(s, quests, kill)) return;
  set(s, {}, true);
  // A mini boss kill that completed a quest: its piece (the dev town gives it; the bot drops it as your loot).
  if (kill.mini && waiting.some((id) => readyToReport(questDef(id), s.quests.active.find((p) => p.id === id))))
    void fetch(`/__questdrop?${new URLSearchParams({ as: fakeName(), kind: kill.kind, level: String(kill.level ?? 1) })}`).catch(() => null);
}

/** Reports a quest whose count is reached, over the Tanod's radio: its rewards come back, and the next one starts. */
export const questReport = (quest: string) => act('/town/quest', { quest, action: 'report' });

/** Talked to `npc` for `quest`'s talk objective. */
export const questTalk = (quest: string, npc: string) => act('/town/quest', { quest, action: 'talk', npc });
/** Chose a class for `quest`'s chooseClass objective (the training weapon and armor come with it). */
export const chooseClass = (quest: string, cls: string) => act('/town/quest', { quest, action: 'chooseClass', cls });
/** Wear an item from the combat bag (by uid; in `place`, or the first free place for its kind). */
export const equipItem = (uid: string, place?: EquipPlace) => act('/town/equip', { action: 'equip', item: uid, ...(place ? { place } : {}) });
export const unequipPlace = (place: EquipPlace) => act('/town/equip', { action: 'unequip', place });

/** One stat point into `stat` (your class's main or second stat), or every stat point back (free). */
export const spendPoint = (stat: StatName) => act('/town/points', { action: 'spend', stat });
export const resetPoints = () => act('/town/points', { action: 'reset' });

/** One skill point into a skill of your class (its key: '0'…'6', or a move's id), or every skill point back (free). */
export const raiseSkill = (skill: string) => act('/town/skills', { action: 'raise', skill });
export const resetSkills = () => act('/town/skills', { action: 'reset' });

/** A skill as the Skills panel, the hotbar and the class choice show it: its level (Lv 1 unless raised; another class's
 *  always 1) and cap at your level (0: still locked). */
export interface SkillView extends ClassSkill {
  level: number;
  cap: number;
  locked: boolean;
}

/** Your class's skills (or another's, as they'd be for you): damage skills and moves in unlock order, then its buffs
 *  (`buff`, kept by name). */
export function skillViews(c: ClassInfo | null | undefined): SkillView[] {
  const p = state?.progress;
  const level = p?.level ?? 1;
  const mine = !!c && c.id === state?.cls;
  return [...classSkills(c), ...classBuffs(c)].map((k) => ({
    ...k,
    level: mine ? skillLevelOf(p, k.key) : 1,
    cap: data ? skillCap(data.stats, level, k) : 0,
    locked: level < k.unlock,
  }));
}

/** A buff as the class choice's preview shows it (classes.json buffs), with its skill level and cap at your level. */
export interface BuffView {
  name: string;
  unlock: number;
  level: number;
  cap: number;
  locked: boolean;
}

/** A class's buffs at your level, in unlock order. */
export function buffViews(c: ClassInfo | null | undefined): BuffView[] {
  return skillViews(c)
    .filter((s) => s.buff)
    .map((s) => ({ name: s.name, unlock: s.unlock, level: s.level, cap: s.cap, locked: s.locked }));
}

/** One of your class's skills by name. */
export const skillView = (name: string): SkillView | undefined => skillViews(classInfo(state?.cls)).find((k) => k.name === name);

/** Whether you can wear an item (its requirements on your base stats; gear's STR, DEX and INT never count): null if so,
 *  else the line saying what's missing ("Needs DEX 26"). */
export function cantWear(item: EquipmentDef): string | null {
  if (!state || !data) return null;
  const r = wearCheck(data.stats, state, item);
  return r.ok ? null : needsLine(r.missing);
}

export { placesFor };

/** The quest under way whose current objective is to talk to this NPC, or choose a class after talking to them. */
export function questFor(npc: string): { quest: QuestDef; step: number } | null {
  for (const p of state?.quests.active ?? []) {
    const q = questDef(p.id);
    const o = q?.objectives[p.step];
    if (!q || !o) continue;
    if ((o.type === 'talk' && o.npc === npc) || (o.type === 'chooseClass' && q.giver === npc)) return { quest: q, step: p.step };
  }
  return null;
}

/**
 * Dev (?switch): become another class at once (null: none), its training gear in place of the old (the bot's
 * swapTrainingGear; the armor given if it hasn't been), every stat and skill point back, the class choice done
 * (the Tanod's quest finished). Everything listening (the HUD, the hotbar, battle poses, resting weapons) follows; the
 * dev town hears the new kit. Only with the pretend login: a real account changes class through the bot (CMS: Reset
 * class, then the Tanod).
 */
export function devSwitchClass(cls: string | null): void {
  if (!fakeLogin() || !data) return;
  const s = structuredClone(state ?? loadFake());
  s.cls = cls;
  // Every stat and skill point back (the bot's refundPoints), and the new class's training gear in the old one's places.
  s.progress = { ...s.progress, points: {}, skills: {}, skillPoints: skillPointsAt(data.stats, s.progress.level) };
  if (cls) swapTrainingGear(data, s, trainingGear(data.stats, data.equipment.values(), cls), devUid);
  else {
    for (const [place, item] of Object.entries(s.equipped)) if (data.equipment.get(item!.defId)?.training) delete s.equipped[place as EquipPlace];
    s.bag = s.bag.filter((i) => !data!.equipment.get(i.defId)?.training);
    s.trainingArmorGiven = false;
  }
  if (cls && !s.trainingArmorGiven) giveTrainingArmor(s);
  const weapon = s.equipped.weapon?.defId;
  const choosing = data.quests.filter((q) => q.objectives.some((o) => o.type === 'chooseClass')).map((q) => q.id);
  s.quests.active = s.quests.active.filter((p) => !choosing.includes(p.id));
  if (cls) s.quests.done = [...new Set([...s.quests.done, ...choosing])];
  else {
    s.quests.done = s.quests.done.filter((id) => !choosing.includes(id));
    startQuests(s);
  }
  set(s);
  void fetch(`/__kit?${new URLSearchParams({ as: fakeName(), cls: cls ?? '', weapon: weapon ?? '', progress: JSON.stringify(s.progress) })}`).catch(() => null);
}

/** A Bagong Buhay Ticket spent on a new class (bot POST /town/class-change; dev: the pretend one, as ?switch does). */
export async function changeClass(cls: string): Promise<{ ok: boolean; error?: string; adventure: AdventureState } | null> {
  if (fakeLogin()) {
    if (!state?.cls) return { ok: false, error: 'Choose your first class with the Tanod.', adventure: state ?? fresh() };
    devSwitchClass(cls);
    return { ok: true, adventure: state! };
  }
  const res = await fetch('/town/class-change', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cls }) }).catch(() => null);
  const r = res?.ok ? ((await res.json()) as { ok: boolean; error?: string; adventure?: AdventureState }) : null;
  if (!r) return null;
  if (r.ok && r.adventure) set(r.adventure, {});
  return { ok: r.ok, error: r.error, adventure: r.adventure ?? state ?? fresh() };
}

/** Dev: your class, weapon and level for the dev town (sent on connect; it keeps the level from there; your items go
 *  to it apart, /__items). */
export function devKit(): { cls: string | null; weapon: string | null; progress: CharacterProgress } {
  const s = state ?? loadFake();
  return { cls: s.cls, weapon: s.equipped.weapon?.defId ?? null, progress: s.progress };
}

// ── Dev: the bot's rules, here (web/adventure.ts) ──

/** Lv 1, nothing earned (the bot's freshProgress). */
function freshProgress(cls: string | null = null): CharacterProgress {
  const S = data?.stats;
  return { level: 1, xp: 0, next: S ? xpToNext(S, 1) : 0, points: {}, statPoints: S ? unspentStatPoints(S, cls, 1) : 0, skills: {}, skillPoints: 0 };
}

/** Dev: a new pretend item's uid. */
const devUid = () => `dev-${Math.random().toString(16).slice(2, 14)}`;

/** The bot's giveTrainingArmor: your class's training armor you don't have yet, each into its place if free, else the
 *  combat bag; done once all of it is given. */
function giveTrainingArmor(s: AdventureState): string[] {
  if (!s.cls || s.trainingArmorGiven || !data) return [];
  const r = giveGear(data, s, missingTraining(data, s, trainingGear(data.stats, data.equipment.values(), s.cls).armor), devUid);
  s.trainingArmorGiven = !r.left.length;
  return r.given;
}

/** Dev: the dev town spends the stat or skill point (the bot's web/progress.ts) and sends your new progress. */
async function fakePoints(path: Path, body: TownPointsAction | TownSkillsAction): Promise<TownAdventureResponse | null> {
  const q = new URLSearchParams({ as: fakeName(), ...(body.action === 'spend' ? { stat: body.stat } : body.action === 'raise' ? { skill: body.skill } : { reset: '1' }) });
  const r = await fetch(`${path === '/town/skills' ? '/__skills' : '/__points'}?${q}`).then((x) => (x.ok ? (x.json() as Promise<{ ok: boolean; message?: string; progress?: CharacterProgress }>) : null)).catch(() => null);
  if (!r || !state) return null;
  return { ok: r.ok, message: r.message, adventure: r.progress ? { ...state, progress: r.progress } : state };
}

const fresh = (): AdventureState => ({ cls: null, quests: { active: [], done: [] }, equipped: {}, bag: [], kusing: 0, progress: freshProgress(), trainingArmorGiven: false });
const fakeKey = () => `mk_adventure:${fakeName()}`;

function loadFake(): AdventureState {
  try {
    const saved = JSON.parse(localStorage.getItem(fakeKey()) ?? 'null') as Partial<AdventureState> | null;
    if (!saved) return fresh();
    // (Saved before levels: Lv 1. Saved before items were instances: each id a plain item of that kind.)
    const asItem = (x: Item | string): Item[] => {
      if (typeof x !== 'string') return [x];
      const def = data?.defs.get(x);
      return def ? [newItem(data!.stats, def, devUid())] : [];
    };
    const equipped = Object.fromEntries(Object.entries(saved.equipped ?? {}).flatMap(([p, x]) => asItem(x as Item | string).map((i) => [p, i])));
    return { ...fresh(), ...saved, equipped, bag: (saved.bag ?? []).flatMap((x) => asItem(x as Item | string)), kusing: saved.kusing ?? 0, progress: { ...freshProgress(saved.cls ?? null), ...saved.progress } };
  } catch {
    return fresh();
  }
}

function saveFake(s: AdventureState): void {
  try {
    localStorage.setItem(fakeKey(), JSON.stringify(s));
  } catch {
    // private window: it lasts the visit
  }
}

function startQuests(s: AdventureState): void {
  for (const q of data?.quests ?? []) {
    if (!q.autoStart || s.quests.done.includes(q.id) || s.quests.active.some((p) => p.id === q.id)) continue;
    if (s.cls && q.objectives.some((o) => o.type === 'chooseClass')) continue;
    s.quests.active.push({ id: q.id, step: 0 });
  }
  // A finished quest's next one that never started (the bot's startQuests).
  for (const id of s.quests.done) {
    const next = data?.quests.find((q) => q.id === questDef(id)?.next);
    if (next && !s.quests.done.includes(next.id) && !s.quests.active.some((p) => p.id === next.id)) s.quests.active.push({ id: next.id, step: 0 });
  }
}

/** Dev (?quest=tanod-05): straight to that quest of the chain, every one before it done. */
function jumpToQuest(s: AdventureState, id: string): void {
  const quests = data?.quests ?? [];
  const chain: string[] = [];
  for (let q = quests.find((x) => x.autoStart); q; q = quests.find((x) => x.id === q!.next)) {
    if (q.id === id) {
      s.quests = { active: [{ id, step: 0 }], done: chain, rewarded: [...chain] };
      return;
    }
    chain.push(q.id);
  }
}

function fakeAct(body: TownQuestAction | TownEquipAction): TownAdventureResponse {
  const s: AdventureState = structuredClone(state ?? fresh());
  const no = (message: string): TownAdventureResponse => ({ ok: false, message, adventure: state ?? fresh() });
  if ('quest' in body) {
    const q = questDef(body.quest);
    const p = s.quests.active.find((x) => x.id === body.quest);
    const o = p && q?.objectives[p.step];
    if (!q || !p || !o) return no("That quest isn't under way.");
    let given: string | undefined;
    let gear: string[] = [];
    let xp = 0;
    if (body.action === 'report') {
      if (!readyToReport(q, p)) return no('Not done yet.');
      // Its XP from the dev town (levels live there: it sends the level-ups), its Kusing here (sent with the items).
      xp = q.rewardXP ?? 0;
      if (xp) void fetch(`/__xp?${new URLSearchParams({ as: fakeName(), xp: String(xp) })}`).catch(() => null);
      s.kusing += q.rewardKusing ?? 0;
    } else if (body.action === 'talk') {
      if (o.type !== 'talk' || o.npc !== body.npc) return no('Not yet.');
    } else {
      if (o.type !== 'chooseClass' || s.cls || !classInfo(body.cls) || !data) return no('Not yet.');
      s.cls = body.cls;
      const weapon = trainingGear(data.stats, data.equipment.values(), body.cls).weapon;
      if (weapon) {
        const item = newItem(data.stats, weapon, devUid());
        if (wearCheck(data.stats, s, weapon).ok) {
          if (s.equipped.weapon) s.bag.push(s.equipped.weapon);
          s.equipped.weapon = item;
        } else s.bag.push(item);
        given = weapon.id;
      }
      gear = giveTrainingArmor(s);
    }
    p.step++;
    delete p.count;
    let completed: string | undefined;
    if (p.step >= q.objectives.length) {
      s.quests.active = s.quests.active.filter((x) => x.id !== q.id);
      s.quests.done.push(q.id);
      completed = q.id;
      if (q.next && !s.quests.done.includes(q.next)) s.quests.active.push({ id: q.next, step: 0 });
    }
    const rewards = completed && data ? giveQuestRewards(data, s, data.quests, devUid) : [];
    return { ok: true, adventure: s, given, ...(gear.length ? { gear } : {}), completed, ...(rewards.length ? { rewards } : {}), ...(xp ? { xp } : {}), ...(q.rewardKusing && completed ? { kusing: q.rewardKusing } : {}) };
  }
  // Wearing and taking off: the bot's rules (@mikazuki/shared items.ts), by uid.
  if (!data) return no("Couldn't load the items.");
  const r = body.action === 'equip' ? equipFromBag(data, s, body.item, body.place) : unequipToBag(data, s, body.place);
  return r.ok ? { ok: true, message: r.message, adventure: s } : no(r.message);
}
