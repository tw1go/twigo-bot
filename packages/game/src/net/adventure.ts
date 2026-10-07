import type {
  AdventureState,
  ClassInfo,
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
import { fakeLogin, fakeName } from '../session';

// ⚔️ Your class, quests and equipment in the game (the bot keeps them: web/adventure.ts; /me brings them, POST
// /town/quest and /town/equip change them). The data files (quests/quests.json, classes/classes.json,
// items/equipment.json) are loaded once. Everything that shows them listens here: the quest tracker and log, the
// marker over a quest giver, the equipment panel, the avatar's class badge. In dev with no bot, the same rules run
// here, saved in this browser per ?as= name, and the dev town hears about class and weapon changes (/__kit).

export interface AdventureData {
  quests: QuestDef[];
  classes: ClassInfo[];
  equipment: Map<string, EquipmentDef>;
}

/** What just happened, for the tracker's tick, the log button's dot and the banners. */
export interface AdventureChange {
  /** A quest whose current objective was just done (and the one done). */
  advanced?: { quest: string; objective: string };
  completed?: string;
  given?: string;
}

let data: AdventureData | null = null;
let state: AdventureState | null = null;
const listeners = new Set<(s: AdventureState, change: AdventureChange) => void>();

export const adventureData = (): AdventureData | null => data;
export const adventure = (): AdventureState | null => state;
export const questDef = (id: string): QuestDef | undefined => data?.quests.find((q) => q.id === id);
export const classInfo = (id: string | null | undefined): ClassInfo | undefined => (id ? data?.classes.find((c) => c.id === id) : undefined);
export const itemDef = (id: string | null | undefined): EquipmentDef | undefined => (id ? data?.equipment.get(id) : undefined);

/** Listens for changes (called at once with the state, if there is one); returns the unsubscribe. */
export function onAdventure(fn: (s: AdventureState, change: AdventureChange) => void): () => void {
  listeners.add(fn);
  if (state) fn(state, {});
  return () => listeners.delete(fn);
}

function set(s: AdventureState, change: AdventureChange = {}): void {
  state = s;
  if (fakeLogin()) saveFake(s);
  for (const fn of listeners) fn(s, change);
}

/** Loads the data files (once). */
export async function loadAdventureData(url: (path: string) => string, files: { quests: string; classes: string; equipment: string }): Promise<AdventureData | null> {
  if (data) return data;
  const get = <T>(path: string) => fetch(url(path)).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null);
  const [q, c, e] = await Promise.all([get<QuestsFile>(files.quests), get<ClassesFile>(files.classes), get<EquipmentFile>(files.equipment)]);
  if (!q || !c || !e) return null;
  data = { quests: q.quests, classes: c.classes, equipment: new Map(e.items.map((i) => [i.id, i])) };
  return data;
}

/** Your state from /me (or, in dev, this browser's pretend one, with the autoStart quests started as the bot would). */
export function initAdventure(fromMe: AdventureState | undefined): void {
  if (fakeLogin()) {
    const s = loadFake();
    startQuests(s);
    return set(s);
  }
  set(fromMe ?? fresh());
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

async function post(path: '/town/quest' | '/town/equip', body: TownQuestAction | TownEquipAction): Promise<TownAdventureResponse | null> {
  const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  return res?.ok ? ((await res.json()) as TownAdventureResponse) : null;
}

async function act(path: '/town/quest' | '/town/equip', body: TownQuestAction | TownEquipAction): Promise<TownAdventureResponse | null> {
  const before = state;
  const res = fakeLogin() ? fakeAct(body) : await post(path, body);
  if (!res) return null;
  if (res.ok) {
    let advanced: AdventureChange['advanced'];
    if ('quest' in body) {
      const p = before?.quests.active.find((x) => x.id === body.quest);
      const o = p && questDef(body.quest)?.objectives[p.step];
      if (o) advanced = { quest: body.quest, objective: o.id };
    }
    set(res.adventure, { advanced, completed: res.completed, given: res.given });
    if (fakeLogin() && (before?.cls !== res.adventure.cls || before?.equipped.weapon !== res.adventure.equipped.weapon)) {
      void fetch(`/__kit?${new URLSearchParams({ as: fakeName(), cls: res.adventure.cls ?? '', weapon: res.adventure.equipped.weapon ?? '' })}`).catch(() => null);
    }
  }
  return res;
}

/** Talked to `npc` for `quest`'s talk objective. */
export const questTalk = (quest: string, npc: string) => act('/town/quest', { quest, action: 'talk', npc });
/** Chose a class for `quest`'s chooseClass objective (the training weapon comes with it). */
export const chooseClass = (quest: string, cls: string) => act('/town/quest', { quest, action: 'chooseClass', cls });
/** Wear an item from the bag (in `place`, or the first free place for its kind). */
export const equipItem = (item: string, place?: EquipPlace) => act('/town/equip', { action: 'equip', item, ...(place ? { place } : {}) });
export const unequipPlace = (place: EquipPlace) => act('/town/equip', { action: 'unequip', place });

/** Where a kind of equipment can be worn (two places for bracers and rings), as the bot has it. */
export const placesFor = (slot: EquipSlot): EquipPlace[] => (slot === 'bracers' ? ['bracers1', 'bracers2'] : slot === 'ring' ? ['ring1', 'ring2'] : [slot]);

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

/** Dev: your class and weapon for the dev town (sent on connect). */
export function devKit(): { cls: string | null; weapon: string | null } {
  const s = state ?? loadFake();
  return { cls: s.cls, weapon: s.equipped.weapon ?? null };
}

// ── Dev: the bot's rules, here (web/adventure.ts) ──

const fresh = (): AdventureState => ({ cls: null, quests: { active: [], done: [] }, equipped: {}, bag: [] });
const fakeKey = () => `mk_adventure:${fakeName()}`;

function loadFake(): AdventureState {
  try {
    return (JSON.parse(localStorage.getItem(fakeKey()) ?? 'null') as AdventureState | null) ?? fresh();
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
    if (body.action === 'talk') {
      if (o.type !== 'talk' || o.npc !== body.npc) return no('Not yet.');
    } else {
      if (o.type !== 'chooseClass' || s.cls || !classInfo(body.cls)) return no('Not yet.');
      s.cls = body.cls;
      const weapon = [...(data?.equipment.values() ?? [])].find((i) => i.starter && i.slot === 'weapon' && i.class === body.cls);
      if (weapon) {
        if (s.equipped.weapon) s.bag.push(s.equipped.weapon);
        s.equipped.weapon = weapon.id;
        given = weapon.id;
      }
    }
    p.step++;
    let completed: string | undefined;
    if (p.step >= q.objectives.length) {
      s.quests.active = s.quests.active.filter((x) => x.id !== q.id);
      s.quests.done.push(q.id);
      completed = q.id;
      if (q.next && !s.quests.done.includes(q.next)) s.quests.active.push({ id: q.next, step: 0 });
    }
    return { ok: true, adventure: s, given, completed };
  }
  if (body.action === 'equip') {
    const item = itemDef(body.item);
    const at = s.bag.indexOf(body.item);
    if (!item || at < 0) return no("You don't have that item.");
    const places = placesFor(item.slot);
    if (body.place && !places.includes(body.place)) return no('Wrong slot.');
    const gear = classInfo(s.cls)?.gear;
    if (item.class ? item.class !== s.cls : item.gear ? item.gear !== gear : false) return no("Your class can't use this.");
    const place = body.place ?? places.find((p) => !s.equipped[p]) ?? places[0];
    s.bag.splice(at, 1);
    if (s.equipped[place]) s.bag.push(s.equipped[place]!);
    s.equipped[place] = item.id;
    return { ok: true, message: `Equipped ${item.name}.`, adventure: s };
  }
  const id = s.equipped[body.place];
  if (!id) return no('Nothing to take off there.');
  delete s.equipped[body.place];
  s.bag.push(id);
  return { ok: true, message: `Took off ${itemDef(id)?.name ?? 'it'}.`, adventure: s };
}
