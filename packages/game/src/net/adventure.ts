import { type LootGot,
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
  type TownPetAction,
  petRules,
  classSkills,
  classBuffs,
  equipFromBag,
  giveGear,
  giveQuestRewards,
  giveQuestPieces,
  questKill,
  ringBell,
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
  gearMismatch,
  xpToNext,
  type CosmeticPlace,
  cosmeticHatOf, cosmeticTopOf,
  withCosmetics,
  wearCosmetic,
  unwearCosmetic,
  type WarrensData,
  type PalengkeData,
  finishQuest,
  freeDishOf,
  startDaily,
  mobName,
  palengkeQuests,
  startInArea,
  unlockedAt,
  waitingQuests,
  advanceCollects,
  heldCount,
  offeredBy,
  markCutscene,
  offeredQuests,
  takeFromBag,
} from '@mikazuki/shared';
import { api } from './endpoints';
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
  /** classes/palengke-leveling.json: the Lumang Palengke's chain (its quests after the Tanod's in `quests`). */
  palengke: PalengkeData | null;
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
  got?: LootGot;
  /** A quest's rewards, just given (the quest just completed, or one finished before it had any). */
  rewards?: QuestReward[];
  /** Mini boss quests' +5 pieces, just given (with the report, or on a visit for one finished before). */
  pieces?: Item[];
  /** Quests that just started (the Tanod's lines as each is given). */
  started?: string[];
  /** A title a quest just gave (its id). */
  title?: string;
  /** A dish a quest just served free (its id). */
  dish?: string;
  /** A report's XP and Kusing, and a quest's Kowens (into the wallet). */
  xp?: number;
  kusing?: number;
  kowens?: number;
  /** An item a quest giver just handed over (Aling Nena's Practice Warren Ticket: its kind). */
  handed?: string;
  /** Your pet out went up a level (its name and new level: the toast). */
  petUp?: { name: string; level: number };
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
  const items = JSON.stringify([s.equipped, s.bag, s.kusing, s.pet ?? null]);
  const changed = items !== JSON.stringify([state?.equipped, state?.bag, state?.kusing, state?.pet ?? null]);
  // A collect objective whose item is in the bag (Aling Nena's binoculars) moves on, as the bot's does; dev: a quest
  // that waited for a level opens with it (the bot's startQuests as it saves).
  if (data) advanceCollects(s, data.quests);
  if (fakeLogin()) {
    startQuests(s);
    if (JSON.stringify(s.quests) !== JSON.stringify(state?.quests)) tellDevQuests(s);
  }
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

/** Your pet out gained Pet XP (the town's `pet-xp`: a hit on a monster): the pet as it is now; a level-up's toast. */
export function setPetXp(pet: Item, ups: number): void {
  if (!state || state.pet?.uid !== pet.uid) return;
  const name = anyDef(pet.defId)?.name ?? 'Your pet';
  set({ ...state, pet }, ups ? { petUp: { name, level: pet.level } } : {}, true);
}

/** A pet action (POST /town/pet; dev: the dev town's /__pet, the same shared rules): open a pet box, send a pet out
 *  (the one out goes back), call it back, a pet point into a node, or all of them back. Your items come back with it. */
export async function petAct(a: TownPetAction): Promise<{ ok: boolean; message?: string } | null> {
  if (fakeLogin()) {
    await devItemsReady;
    const res = await fetch(`/__pet?${new URLSearchParams({ as: fakeName() })}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) }).catch(() => null);
    const r = res?.ok ? ((await res.json()) as { ok: boolean; message?: string; items?: TownItems }) : null;
    if (r?.items) setItems(r.items);
    return r;
  }
  const res = await api('/town/pet', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) }).catch(() => null);
  const r = res?.ok ? ((await res.json()) as TownAdventureResponse) : null;
  if (r?.ok) set(r.adventure, {}, true);
  return r;
}

/** The pets block (classes/stats.json `pets`), or null. */
export const pets = () => (data ? petRules(data.stats) : null);

/** A forge action (the popup's enhance, repair and embed; the bag's disassemble and combine), rolled by the bot (POST
 *  /town/forge; dev: the dev town's /__forge, the same code). Your items come back with the answer. */
export async function forgeAction(a: TownForgeAction): Promise<TownForgeResponse | null> {
  const path = fakeLogin() ? `/__forge?${new URLSearchParams({ as: fakeName() })}` : '/town/forge';
  if (fakeLogin()) await devItemsReady;
  const res = await api(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) }).catch(() => null);
  const r = res?.ok ? ((await res.json()) as TownForgeResponse) : null;
  if (r?.items) setItems(r.items);
  if (r) for (const fn of forgeListeners) fn(a, r);
  return r;
}

const forgeListeners = new Set<(a: TownForgeAction, r: TownForgeResponse) => void>();

/** Hears every forge answer (the lessons: a combine done, an enhance try over). Returns the off switch. */
export function onForge(fn: (a: TownForgeAction, r: TownForgeResponse) => void): () => void {
  forgeListeners.add(fn);
  return () => forgeListeners.delete(fn);
}

/** Every item kind and the stats rules (the items module's data). */
export const itemData = (): ItemData | null => data;

/** Dev: settled once the dev town and this browser agree on your items (dev's ?give= waits for it). */
export let devItemsReady: Promise<unknown> = Promise.resolve();

/** Dev: the dev town's copy of your items (its loot, potions, shop and fights use it). */
function pushItems(s: AdventureState): Promise<unknown> {
  return fetch(`/__items?${new URLSearchParams({ as: fakeName() })}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ equipped: s.equipped, cosmetics: s.cosmetics, bag: s.bag, kusing: s.kusing, pet: s.pet ?? null }) }).catch(() => null);
}

/** Loads the data files (once); `stats` is loaded already (the scene's json cache). */
/** Dev: Aling Nena's quest and its practice ticket (dungeons.json), for the pretend store. */
let practice: { quest: string; ticket: string; retryMs: number } | null = null;
/** Dev: the dungeon tickets' store prices in Kusing (dungeons.json), for the pretend store. */
let ticketPrices = new Map<string, number>();
export const devTicketPrice = (id: string): number | null => ticketPrices.get(id) ?? null;

export async function loadAdventureData(url: (path: string) => string, files: { quests: string; classes: string; equipment: string; items?: string; dungeons?: string; palengke?: string }, stats: StatsData | undefined, leveling?: LevelingData): Promise<AdventureData | null> {
  if (data) return data;
  const get = <T>(path: string) => fetch(url(path)).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null);
  const [q, c, e, i, P] = await Promise.all([get<QuestsFile>(files.quests), get<ClassesFile>(files.classes), get<EquipmentFile>(files.equipment), files.items ? get<CombatItemsFile>(files.items) : null, files.palengke ? get<PalengkeData>(files.palengke) : null]);
  if (!q || !c || !e || !stats) return null;
  const equipment = new Map(e.items.map((x) => [x.id, x]));
  // (The Palengke's NPCs by their ids' words: "aling-conching" is Aling Conching, as maps/palengke.json names them.)
  data = { quests: [...withLeveling(q.quests, leveling), ...(P ? palengkeQuests(P, mobName) : [])], leveling: leveling ?? null, palengke: P, classes: c.classes, equipment, stats, defs: new Map<string, AnyItemDef>([...equipment, ...(i?.items ?? []).map((x): [string, AnyItemDef] => [x.id, x])]) };
  // (Dev: the practice ticket's rules for the pretend store; the bot reads its own.)
  if (fakeLogin() && files.dungeons) {
    const W = (await get<{ warrens: WarrensData }>(files.dungeons))?.warrens;
    if (W?.entry.requiresQuest && W.practice) practice = { quest: W.entry.requiresQuest, ticket: W.practice.ticket, retryMs: (W.practice.retryHours ?? 0) * 3_600_000 };
    if (W?.ticket) ticketPrices = new Map([[W.ticket.id, W.ticket.sources.shop.kusing]]);
  }
  return data;
}

/** Dev: the pretend quests to the dev town (the Warren Gate asks whether Aling Nena's quest is done). */
function tellDevQuests(s: AdventureState): void {
  void fetch(`/__quests?${new URLSearchParams({ as: fakeName() })}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s.quests) }).catch(() => null);
}

/** Your state from /me (or, in dev, this browser's pretend one, with the autoStart quests started as the bot would).
 *  Returns the training armor the Tanod has just left (a class from before training armor: /me's `trainingGear`) and
 *  quest rewards just given (quests finished before they had any: /me's `questRewards`) — in dev, given here the bot's
 *  way — for the town to say so once. */
export function initAdventure(fromMe: AdventureState | undefined, trainingArmor: string[] = [], questRewards: QuestReward[] = [], questPieces: Item[] = []): { armor: string[]; rewards: QuestReward[]; pieces: Item[] } {
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
    const pieces = data?.leveling ? giveQuestPieces(data, data.leveling, s, devUid) : [];
    set(s, {}, true); // (not sent yet: the dev town's copy may be newer)
    applyEarly();
    // The dev town's copy wins while it runs (a page closed in a hurry may not have saved its last items); after a
    // restart it has none, and gets this browser's.
    devItemsReady = fetch(`/__items?${new URLSearchParams({ as: fakeName() })}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ known: boolean } & Partial<TownItems>>) : null))
      .then((r) => {
        if (!r?.known || !r.bag) return state && pushItems(state);
        setItems({ equipped: r.equipped ?? {}, cosmetics: r.cosmetics ?? {}, bag: r.bag, kusing: r.kusing ?? 0, pet: r.pet ?? null });
        // Quest rewards (and pieces) just given here go into the dev town's copy too.
        if ((!rewards.length && !pieces.length) || !state || !data) return;
        const s = structuredClone(state);
        for (const x of rewards) addToBag(data, s.bag, newItem(data.stats, data.defs.get(x.item)!, devUid(), x.count), devUid);
        for (const p of pieces) addToBag(data, s.bag, p, devUid);
        set(s);
      })
      .catch(() => undefined);
    return { armor: given, rewards, pieces };
  }
  set(fromMe ?? fresh());
  applyEarly();
  return { armor: trainingArmor, rewards: questRewards, pieces: questPieces };
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
  // (An offered quest the log hasn't shown yet, as step -1.)
  for (const q of offeredNow()) if (seen[q.id] !== -1) fresh.push(q.type);
  return fresh.includes('main') ? 'main' : fresh.includes('side') ? 'side' : null;
}

/** A guided quest that started since the log was last opened (the guide arrow at the quest button, once a quest: a
 *  guided quest whose objective moves on doesn't bring it back, unlike the dot), main first; or null. */
export function newGuidedQuest(): QuestDef | null {
  if (!state) return null;
  let seen: Record<string, number> = {};
  try {
    seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}');
  } catch {
    // nothing seen yet
  }
  const fresh = state.quests.active.filter((p) => seen[p.id] === undefined).map((p) => questDef(p.id)).filter((q): q is QuestDef => !!q?.guided);
  return fresh.find((q) => q.type === 'main') ?? fresh[0] ?? null;
}

/** The log was opened: everything in it now has been seen. */
export function markQuestsSeen(): void {
  if (!state) return;
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries([...state.quests.active.map((p) => [p.id, p.step]), ...offeredNow().map((q) => [q.id, -1])])));
  } catch {
    // private window: the dot comes back next time
  }
  for (const fn of listeners) fn(state, {});
}

// ── Actions ──

type Path = '/town/quest' | '/town/equip' | '/town/points' | '/town/skills';
/** Dev (the GM tools, ui/gm-tools.ts): a quest's current step done, or all of it, as if it were (the pretend store only). */
type DevQuestAction = { quest: string; action: 'dev-step' | 'dev-done' };
type Body = TownQuestAction | TownEquipAction | TownPointsAction | TownSkillsAction | DevQuestAction;

async function post(path: Path, body: Body): Promise<TownAdventureResponse | null> {
  const res = await api(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  return res?.ok ? ((await res.json()) as TownAdventureResponse) : null;
}

async function act(path: Path, body: Body): Promise<TownAdventureResponse | null> {
  const before = state;
  const res = !fakeLogin()
    ? await post(path, body)
    : path === '/town/points' || path === '/town/skills'
      ? await fakePoints(path, body as TownPointsAction | TownSkillsAction)
      : fakeAct(body as TownQuestAction | TownEquipAction | DevQuestAction);
  if (!res) return null;
  if (res.ok) {
    let advanced: AdventureChange['advanced'];
    if ('quest' in body) {
      // The objective it was on, if it moved on (an offered quest just started: its first; a reminder: none).
      const from = before?.quests.active.find((x) => x.id === body.quest)?.step ?? 0;
      const now = res.adventure.quests.active.find((x) => x.id === body.quest)?.step;
      const o = (now === undefined ? !!res.completed : now > from) ? questDef(body.quest)?.objectives[from] : undefined;
      if (o) advanced = { quest: body.quest, objective: o.id };
      if (fakeLogin()) tellDevQuests(res.adventure);
    }
    set(res.adventure, { advanced, completed: res.completed, given: res.given, gear: res.gear, rewards: res.rewards, pieces: res.pieces, xp: res.xp, kusing: res.kusing, kowens: res.kowens, handed: res.handed, title: res.title, dish: res.dish, ...(res.started?.length ? { started: res.started } : {}) });
    // Dev: a free dish is served by the dev town (the bot serves it where it answers).
    if (fakeLogin() && res.dish) void fetch(`/__dish?${new URLSearchParams({ as: fakeName(), dish: res.dish })}`).catch(() => null);
    if (fakeLogin() && (before?.cls !== res.adventure.cls || JSON.stringify(before?.equipped) !== JSON.stringify(res.adventure.equipped))) {
      void fetch(`/__kit?${new URLSearchParams({ as: fakeName(), cls: res.adventure.cls ?? '', weapon: res.adventure.equipped.weapon?.defId ?? '' })}`).catch(() => null);
    }
  }
  return res;
}

/** Your level, XP and points from the server (the town's `progress` message). */
export function setProgress(progress: CharacterProgress): void {
  if (state) set({ ...state, progress });
  else early = progress; // (before your state is in: kept for initAdventure)
}

/** Your level from the town before your state was in (the town connects first; dev's ?level= answers at once), put on
 *  it as it comes: the town's is the newer. */
let early: CharacterProgress | null = null;
const applyEarly = () => {
  if (!early || !state) return;
  const progress = early;
  early = null;
  set({ ...state, progress }, {}, true);
};

/** Your quests' counts from the town (`quests`: a kill counted, saved by the bot). */
export function setQuestCounts(active: QuestProgress[]): void {
  if (state) set({ ...state, quests: { ...state.quests, active } }, {}, true);
}

/** Dev: a field boss's bell rung (the dev town's `quest-bell`): the "ring the bell" step moves on, the bot's way. */
export function devQuestBell(mob: string): void {
  if (!state || !data || !fakeLogin()) return;
  const s = structuredClone(state);
  if (!ringBell(s, data.quests, mob)) return;
  set(s, {}, true);
}

/** Dev: a kill that counts toward quests (the dev town's `quest-kill`; it keeps no quests), counted here the bot's way. */
export function devQuestKill(kill: { kind: string; mini: boolean; level?: number }): void {
  if (!state || !data || !fakeLogin()) return;
  const s = structuredClone(state);
  const quests = data.quests;
  if (!questKill(s, quests, kill)) return;
  set(s, {}, true);
}

/** Reports a quest whose count is reached, over the Tanod's radio: its rewards come back, and the next one starts. */
export const questReport = (quest: string) => act('/town/quest', { quest, action: 'report' });

/** Talked to `npc` for `quest`'s talk objective. */
export const questTalk = (quest: string, npc: string) => act('/town/quest', { quest, action: 'talk', npc });
/** Dev (the GM tools): a quest's current step done (`whole`: all of it), its rewards as if it were. */
export const devFinishQuest = (quest: string, whole: boolean) => (fakeLogin() ? act('/town/quest', { quest, action: whole ? 'dev-done' : 'dev-step' }) : Promise.resolve(null));
/** Chose a class for `quest`'s chooseClass objective (the training weapon and armor come with it). */
export const chooseClass = (quest: string, cls: string) => act('/town/quest', { quest, action: 'chooseClass', cls });
/** A cutscene watched (`seen`), or one whose moment came on another map (`due`): kept with your quests (CONTEXT.md
 *  Cutscene: once each, on every device). */
export const markCutsceneOf = (cutscene: string, mark: 'seen' | 'due') => act('/town/quest', { action: 'cutscene', cutscene, mark });
/** The cutscenes you've watched, and the ones waiting for their map. */
export const cutscenesSeen = (): string[] => state?.quests.cutscenesSeen ?? [];
export const cutscenesDue = (): string[] => state?.quests.cutscenesDue ?? [];
/** Wear an item from the combat bag (by uid; in `place`, or the first free place for its kind). */
export const equipItem = (uid: string, place?: EquipPlace) => act('/town/equip', { action: 'equip', item: uid, ...(place ? { place } : {}) });
export const unequipPlace = (place: EquipPlace) => act('/town/equip', { action: 'unequip', place });
/** Wear a cosmetic from the Costume tab (by uid; in `place`, or its own), or take one off into the Costume tab. */
export const wearCosmeticItem = (uid: string, place?: CosmeticPlace) => act('/town/equip', { action: 'wear-cosmetic', item: uid, ...(place ? { place } : {}) });
export const takeOffCosmetic = (place: CosmeticPlace) => act('/town/equip', { action: 'take-off-cosmetic', place });

/** The look you show, from your saved one: a worn head cosmetic's hat on it (shared cosmetics.ts; the manifest's
 *  cosmeticHats). */
export function lookWithCosmetics<O extends { hat?: string; hatColour?: string; top: string }>(outfit: O, hats: Record<string, string>, tops?: Record<string, string>): O {
  return withCosmetics(outfit, cosmeticHatOf(hats, state?.cosmetics), cosmeticTopOf(tops, state?.cosmetics));
}

/** The name of the head cosmetic worn (the Parlor's Hat row says so), or null. */
export const wornHeadCosmetic = (): string | null => {
  const it = state?.cosmetics.head;
  return it ? (anyDef(it.defId)?.name ?? it.defId) : null;
};

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

/** Whether you can wear an item: null if so, else why: another class's gear said plainly ("Heavy armor, for the Stick
 *  and Greatstick. You wear Household armor."), else its requirements on your base stats (gear's STR, DEX and INT never
 *  count: "Needs DEX 26"). */
export function cantWear(item: EquipmentDef): string | null {
  if (!state || !data) return null;
  const other = gearMismatch(data.stats, state.cls, item, (c) => classInfo(c)?.name ?? c);
  if (other) return other;
  const r = wearCheck(data.stats, state, item);
  return r.ok ? null : needsLine(r.missing);
}

export { placesFor };

/** The quest under way whose current objective is to talk to this NPC, or choose a class after talking to them. */
export function questFor(npc: string): { quest: QuestDef; step: number; offered?: boolean } | null {
  for (const p of state?.quests.active ?? []) {
    const q = questDef(p.id);
    const o = q?.objectives[p.step];
    if (!q || !o) continue;
    if ((o.type === 'talk' && o.npc === npc) || (o.type === 'chooseClass' && q.giver === npc) || (o.type === 'deliver' && o.npc === npc) || (o.type === 'collect' && q.giver === npc)) return { quest: q, step: p.step };
  }
  // An offered quest (CONTEXT.md): its giver's "!"; talking starts it.
  const q = state && data ? offeredBy(state, data.quests, npc) : null;
  return q ? { quest: q, step: 0, offered: true } : null;
}

/** A quest of a chain waiting for your level (CONTEXT.md Level gap) whose giver is this NPC: their grey "!". */
export function waitingFor(npc: string): QuestDef | null {
  return state && data ? (waitingQuests(state, data.quests).find((q) => q.giver === npc) ?? null) : null;
}

/** Every quest waiting for your level (the log's grey rows). */
export const waitingNow = (): QuestDef[] => (state && data ? waitingQuests(state, data.quests) : []);

/** The line a giver says while their next quest waits for a level (palengke-leveling.json gapLine). */
export const gapLine = (q: QuestDef): string => (data?.palengke?.gapLine ?? 'Come back at Lv {level}.').replaceAll('{level}', String(q.unlockLevel ?? ''));

/** You walked into a map: a chain that starts there opens (the Palengke's first quest, at its level). The bot does it as
 *  you join its room (the town's `quests`); in dev, here. */
export function enterArea(area: string): void {
  if (!fakeLogin() || !state || !data) return;
  const s = structuredClone(state);
  if (startInArea(s, data.quests, area).length) set(s);
}

/** How many of an item kind are in your combat bag (a collect objective's count). */
export const heldOf = (defId: string | undefined): number => heldCount(state?.bag ?? [], defId);

/** Quests you can start now (offered), for the log. */
export const offeredNow = (): QuestDef[] => (state && data ? offeredQuests(state, data.quests) : []);

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
  const res = await api('/town/class-change', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cls }) }).catch(() => null);
  const r = res?.ok ? ((await res.json()) as { ok: boolean; error?: string; adventure?: AdventureState }) : null;
  if (!r) return null;
  if (r.ok && r.adventure) set(r.adventure, {});
  return { ok: r.ok, error: r.error, adventure: r.adventure ?? state ?? fresh() };
}

/** Dev: your class, weapon and level for the dev town (sent on connect; it keeps the level from there; your items go
 *  to it apart, /__items). */
export function devKit(): { cls: string | null; weapon: string | null; progress: CharacterProgress; quests: AdventureState['quests'] } {
  const s = state ?? loadFake();
  return { cls: s.cls, weapon: s.equipped.weapon?.defId ?? null, progress: s.progress, quests: s.quests };
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

const fresh = (): AdventureState => ({ cls: null, quests: { active: [], done: [] }, equipped: {}, cosmetics: {}, pet: null, bag: [], kusing: 0, progress: freshProgress(), trainingArmorGiven: false });
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
  // A finished quest's next one that never started (the bot's startQuests), once you're at its level.
  for (const id of s.quests.done) {
    const next = data?.quests.find((q) => q.id === questDef(id)?.next);
    if (next && !s.quests.done.includes(next.id) && !s.quests.active.some((p) => p.id === next.id) && unlockedAt(next, s.progress.level)) s.quests.active.push({ id: next.id, step: 0 });
  }
  // Today's daily order, once the Palengke's chain is done (the bot's startDaily).
  if (data?.palengke) startDaily(s, data.quests, data.palengke, Date.now());
}

/** Dev (?quest=tanod-05, ?quest=palengke-08): straight to that quest of its chain, every one before it done (a
 *  Palengke quest: the Tanod's chain done too, the dishes of those before unlocked); ?quest=palengke-done: every one
 *  done, a daily order on. ?quest=done: all quests done, none active (for testing UI without a
 *  quest tracker). */
function jumpToQuest(s: AdventureState, id: string): void {
  const quests = data?.quests ?? [];
  const chain: string[] = [];
  for (const first of quests.filter((x) => x.autoStart || x.startsIn)) {
    for (let q: QuestDef | undefined = first; q; q = quests.find((x) => x.id === q!.next)) {
      if (q.id === id) {
        s.quests = { active: [{ id, step: 0 }], done: chain, rewarded: [...chain] };
        return;
      }
      chain.push(q.id);
    }
    if (first.autoStart && id === 'done') return void (s.quests = { active: [], done: chain, rewarded: [...chain] });
  }
  // ?quest=palengke-done: the Palengke's chain done too (its daily orders start).
  if (id === 'palengke-done') s.quests = { active: [], done: chain, rewarded: [...chain] };
}

function fakeAct(body: TownQuestAction | TownEquipAction | DevQuestAction): TownAdventureResponse {
  const s: AdventureState = structuredClone(state ?? fresh());
  const no = (message: string): TownAdventureResponse => ({ ok: false, message, adventure: state ?? fresh() });
  // A cutscene watched or waiting for its map (the bot's townQuest).
  if (body.action === 'cutscene') {
    markCutscene(s.quests, body.cutscene, body.mark);
    return { ok: true, adventure: s };
  }
  if ('quest' in body) {
    const q = questDef(body.quest);
    // An offered quest: talking to its giver starts it (the bot's questStep).
    if (q && data && body.action === 'talk' && !s.quests.active.some((x) => x.id === q.id) && offeredBy(s, data.quests, body.npc)?.id === q.id) s.quests.active.push({ id: q.id, step: 0 });
    const p = s.quests.active.find((x) => x.id === body.quest);
    const o = p && q?.objectives[p.step];
    if (!q || !p || !o) return no("That quest isn't under way.");
    let given: string | undefined;
    let gear: string[] = [];
    let xp = 0;
    let handed: string | undefined;
    let taken: string | undefined;
    const P = practice && practice.quest === q.id ? practice : null;
    const hand = () => {
      const def = P && data?.defs.get(P.ticket);
      if (!def || !data || !addToBag(data, s.bag, newItem(data.stats, def, devUid()), devUid)) return false;
      p.givenAt = Date.now();
      handed = P!.ticket;
      return true;
    };
    if (body.action === 'talk' && o.type === 'collect' && q.giver === body.npc) {
      // Her reminder; another ticket with none, no binoculars and retryHours since the last (dev: no run is asked about).
      if (!P || heldCount(s.bag, P.ticket) || heldCount(s.bag, o.item)) return { ok: true, adventure: s };
      if (p.givenAt !== undefined && Date.now() - p.givenAt < P.retryMs) return { ok: true, adventure: s, message: `Aling Nena has no ticket for you yet. Come back in ${Math.ceil((p.givenAt + P.retryMs - Date.now()) / 3_600_000)} hours.` };
      return hand() ? { ok: true, adventure: s, handed } : no('Make room in your bag: Aling Nena has a ticket for you.');
    }
    if (body.action === 'dev-step' || body.action === 'dev-done') {
      // (The GM tools: on to the next step, or to the end; its rewards as ever.)
      if (body.action === 'dev-done') p.step = q.objectives.length - 1;
    } else if (body.action === 'report') {
      if (!readyToReport(q, p)) return no('Not done yet.');
    } else if (body.action === 'talk' && o.type === 'deliver' && o.npc === body.npc) {
      if (!o.item || !takeFromBag(s.bag, o.item, Math.max(1, o.count ?? 1))) return no("You don't have it yet.");
      taken = o.item;
      if (P) s.bag = s.bag.filter((it) => it.defId !== P.ticket);
    } else if (body.action === 'talk') {
      if (o.type !== 'talk' || o.npc !== body.npc) return no('Not yet.');
      // A talk that hands something over (Tisay's note).
      if (o.gives && data) {
        const def = data.defs.get(o.gives);
        if (def && !heldCount(s.bag, o.gives) && !addToBag(data, s.bag, newItem(data.stats, def, devUid()), devUid)) return no('Make room in your bag first.');
        handed = o.gives;
      }
      if (P) hand();
    } else {
      if (body.action !== 'chooseClass' || o.type !== 'chooseClass' || s.cls || !classInfo(body.cls) || !data) return no('Not yet.');
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
      finishQuest(s, q, data?.palengke ?? {}, Date.now()); // (a daily order: today's handed in)
      completed = q.id;
      // Its XP from the dev town (levels live there: it sends the level-ups, and a quest waiting for one starts then),
      // its Kusing here (sent with the items).
      xp = q.rewardXP ?? 0;
      if (xp) void fetch(`/__xp?${new URLSearchParams({ as: fakeName(), xp: String(xp) })}`).catch(() => null);
      s.kusing += q.rewardKusing ?? 0;
      const next = questDef(q.next ?? '');
      if (next && !s.quests.done.includes(next.id) && unlockedAt(next, s.progress.level)) s.quests.active.push({ id: next.id, step: 0 });
    }
    const rewards = completed && data ? giveQuestRewards(data, s, data.quests, devUid) : [];
    const pieces = completed && data?.leveling ? giveQuestPieces(data, data.leveling, s, devUid) : [];
    return {
      ok: true, adventure: s, given, ...(gear.length ? { gear } : {}), completed, ...(rewards.length ? { rewards } : {}), ...(pieces.length ? { pieces } : {}), ...(xp ? { xp } : {}),
      ...(q.rewardKusing && completed ? { kusing: q.rewardKusing } : {}), ...(q.rewardKowens && completed ? { kowens: q.rewardKowens } : {}), ...(handed ? { handed } : {}), ...(taken ? { taken } : {}),
      ...(q.rewardTitle && completed ? { title: q.rewardTitle } : {}),
      ...(q.freeDish && completed && data?.palengke ? { dish: freeDishOf(s, data.quests, data.palengke, q.freeDish) ?? undefined } : {}),
    };
  }
  // Wearing and taking off (gear and cosmetics): the bot's rules (@mikazuki/shared items.ts), by uid.
  if (!data) return no("Couldn't load the items.");
  const r =
    body.action === 'equip' ? equipFromBag(data, s, body.item, body.place)
    : body.action === 'unequip' ? unequipToBag(data, s, body.place)
    : body.action === 'wear-cosmetic' ? wearCosmetic(data, s, body.item, body.place)
    : unwearCosmetic(data, s, body.place);
  return r.ok ? { ok: true, message: r.message, adventure: s } : no(r.message);
}
