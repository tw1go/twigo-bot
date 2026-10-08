import type { AdventureState, EquipSlot, GearRarity, QuestDef, QuestObjectiveDef, QuestReward } from './adventure.js';
import { type AgimatStat, type Item, type ItemData, isGearDef, rollGear } from './items.js';
import { gearKind, numbersIn } from './stats.js';

// 📈 The Tanod's leveling quests and the Slums' mini bosses: the game's classes/leveling.json (the art folder's
// data/leveling.json; its rules in words: data/leveling-plan.md). Every number comes from the file, never from here; a
// few sit in its sentences (miniBoss.kill_credit, miniBoss.loot), read by numbersIn. Pure, used by the bot and the game.

/** A mini boss (leveling.json miniBosses[kind]): its own name, level and stats; its mob's art, moves and rules. */
export interface MiniBossDef {
  id: string;
  name: string;
  level: number;
  hp: number;
  atk: number;
  defense: number;
  xp: number;
}

/** A quest of the chain (leveling.json quests): kill `count` of `mob`, or one of its mini bosses (`kind` miniBoss). */
export interface LevelingQuest {
  id: string;
  title: string;
  mob: string;
  kind: 'kill' | 'miniBoss';
  count: number;
  goal: string;
  targetLevel: number;
  rewardXP: number;
  rewardKusing: number;
  dialogue?: { give?: string; report?: string };
}

/** The piece a mini boss drops for the quest it completes (leveling.json miniBoss.questDrop; a repo addition). */
export interface QuestDropRules {
  rarity: GearRarity;
  plus: number;
  bound: boolean;
  kinds: Record<string, { slot: EquipSlot; agimat: AgimatStat }>;
}

export interface LevelingData {
  miniBoss: { scale: number; respawnSeconds: number; nameColour: string; kill_credit: string; loot: string; questDrop?: QuestDropRules };
  miniBosses: Record<string, MiniBossDef[]>;
  quests: LevelingQuest[];
}

/** A quests.json entry: a whole quest, or one of the chain (`leveling`: its title, goal, rewards and lines from
 *  leveling.json by its id; the entry keeps its type, giver, item rewards and next). */
export type QuestFileEntry = Omit<QuestDef, 'title' | 'summary' | 'objectives'> & Partial<Pick<QuestDef, 'title' | 'summary' | 'objectives'>> & { leveling?: boolean };

/** quests.json with the chain filled in from leveling.json. */
export function withLeveling(entries: QuestFileEntry[], L: LevelingData | null | undefined): QuestDef[] {
  return entries.flatMap((e): QuestDef[] => {
    if (!e.leveling) return [e as QuestDef];
    const q = L?.quests.find((x) => x.id === e.id);
    if (!q) return []; // (no such quest in leveling.json: left out)
    const { leveling: _l, ...rest } = e;
    return [{
      ...rest,
      title: q.title,
      summary: q.goal,
      objectives: [objectiveOf(q)],
      rewardXP: q.rewardXP,
      rewardKusing: q.rewardKusing,
      dialogue: { ...rest.dialogue, ...(q.dialogue?.give ? { give: [q.dialogue.give] } : {}), ...(q.dialogue?.report ? { report: [q.dialogue.report] } : {}) },
    }];
  });
}

/** A chain quest's one objective; its text is what the tracker shows before the count: "Tin Cans" (12/20), "Beat a Tin
 *  Can mini boss" (0/1), from the goal's words. */
function objectiveOf(q: LevelingQuest): QuestObjectiveDef {
  const many = /^Defeat \d+ (.+)$/.exec(q.goal)?.[1];
  const boss = /one of the (.+?) mini bosses/.exec(q.goal)?.[1];
  const text = q.kind === 'kill' ? (many ?? q.goal) : boss ? `Beat a ${boss} mini boss` : q.goal;
  return { id: 'goal', type: q.kind, mob: q.mob, count: q.kind === 'miniBoss' ? 1 : q.count, text };
}

/** How many an objective needs (1 for talk / chooseClass). */
export const objectiveCount = (o: QuestObjectiveDef | undefined) => Math.max(1, o?.count ?? 1);

/** An active quest's current objective is a count (kill / miniBoss) that's reached: ready to report. */
export function readyToReport(def: QuestDef | undefined, p: { step: number; count?: number } | undefined): boolean {
  const o = def && p ? def.objectives[p.step] : undefined;
  return !!o && (o.type === 'kill' || o.type === 'miniBoss') && (p!.count ?? 0) >= objectiveCount(o);
}

/** A kill counts toward their active quests: `kill` objectives of its kind (not its mini bosses), `miniBoss` ones of its
 *  kind's mini bosses. Returns whether anything moved. */
export function questKill(s: Pick<AdventureState, 'quests'>, quests: QuestDef[], kill: { kind: string; mini: boolean }): boolean {
  let moved = false;
  for (const p of s.quests.active) {
    const o = quests.find((q) => q.id === p.id)?.objectives[p.step];
    if (!o || o.mob !== kill.kind || (o.type === 'kill' ? kill.mini : o.type === 'miniBoss' ? !kill.mini : true)) continue;
    const n = p.count ?? 0;
    if (n >= objectiveCount(o)) continue;
    p.count = n + 1;
    moved = true;
  }
  return moved;
}

/** The mini bosses' shared rules as numbers: their size, respawn (ms), name colour, the share of its HP that earns a
 *  kill (kill_credit: "≥ 10%"), and their loot (loot: "Kusing x10 …, 1 gear piece …, … fragment 1 in 3"). */
export function miniBossRules(L: LevelingData) {
  const M = L.miniBoss;
  const [share] = numbersIn(M.kill_credit);
  const kusing = /x\s*(\d+(?:\.\d+)?)/i.exec(M.loot)?.[1];
  const gear = /(\d+) gear piece/i.exec(M.loot)?.[1];
  const frag = /fragment (\d+) in (\d+)/i.exec(M.loot);
  return {
    scale: M.scale,
    respawnMs: M.respawnSeconds * 1000,
    nameColour: M.nameColour,
    creditShare: (share ?? 10) / 100,
    kusingTimes: Number(kusing ?? 1),
    gearPieces: Number(gear ?? 1),
    fragmentChance: frag ? Number(frag[1]) / Number(frag[2]) : 0,
  };
}

/** The piece a mini boss of `kind` (at `level`) drops for the player whose quest it completes (class `cls`): their gear
 *  type's armor for its slot (a weapon: their class's own) at the gear level nearest, at questDrop's rarity (no lines) and
 *  plus, bound, its agimat in the first slot at the piece's level. Null without the rules or a fitting piece. */
export function questDropFor(data: ItemData, L: LevelingData, kind: string, level: number, cls: string | null | undefined, uid: string, random: () => number = Math.random): Item | null {
  const Q = L.miniBoss.questDrop;
  const k = Q?.kinds[kind];
  if (!Q || !k) return null;
  const type = cls ? data.stats.classes[cls]?.gearType : undefined;
  const yours = (d: { slot: string; class?: string; gear?: string }) =>
    gearKind(k.slot) === 'weapon' ? d.class === cls : gearKind(k.slot) === 'accessory' || (!!type && d.gear?.toLowerCase() === type);
  const fits = [...data.defs.values()].filter(isGearDef).filter((d) => !d.training && d.slot === k.slot && yours(d));
  if (!fits.length) return null;
  const at = nearestGearLevel([...new Set(fits.map((d) => d.level))], level);
  const pick = fits.filter((d) => d.level === at);
  const item = rollGear(data.stats, pick[Math.floor(random() * pick.length)], Q.rarity, uid, random);
  item.lines = [];
  item.plus = Q.plus;
  item.bound = Q.bound;
  if (item.agimats.length) item.agimats[0] = { stat: k.agimat, level: item.level };
  return item;
}

/** A zone's mini boss id in the room (`<zone>:mini:<id>`), and the other way. */
export const miniMobId = (zone: string, id: string) => `${zone}:mini:${id}`;
export const miniOfMobId = (mobId: string) => /:mini:(.+)$/.exec(mobId)?.[1] ?? null;

/** A mini boss by its id (any kind's). */
export function miniBossDef(L: LevelingData, id: string): (MiniBossDef & { kind: string }) | null {
  for (const [kind, list] of Object.entries(L.miniBosses)) {
    const m = list.find((x) => x.id === id);
    if (m) return { ...m, kind };
  }
  return null;
}

/** The gear level nearest a level among those there are (mini bosses' loot: Lv 10 below 15, Lv 20 from 15 up). */
export function nearestGearLevel(levels: number[], level: number): number {
  return [...levels].sort((a, b) => Math.abs(a - level) - Math.abs(b - level) || b - a)[0] ?? level;
}

export type { QuestReward };
