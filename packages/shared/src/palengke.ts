import type { AdventureState, QuestDef, QuestObjectiveDef, QuestReward } from './adventure.js';
import { objectiveCount } from './leveling.js';
import { heldCount } from './quests.js';

// 🏮 The Lumang Palengke's quest chain "Ang Huling Suki" (the game's classes/palengke-leveling.json, the art folder's
// data/palengke-leveling.json with its lines added here): its 14 quests as quests (QuestDef) both sides run, and the
// rules they bring (CONTEXT.md Quest item, Level gap). Hand-in at the NPC (`handIn`): a hunt moves on by itself once
// done (no radio report), then the last step is to walk up to its giver (or `reportTo`) and talk, handing over what was
// collected. Quest items drop only while a quest asks for them, from their mob, at their dropChance, each player their
// own. Each quest opens at its `unlockLevel` (the level gap: the next one waits with a grey "!" until then). Pure.

/** A quest of the chain as palengke-leveling.json has it. */
export interface PalengkeQuest {
  id: string;
  title: string;
  giver: string;
  /** talk, kill, collect, deliver, fieldBoss, or two at once / one after the other: collect+kill, kill+collect (both at
   *  once), kill+miniBoss, collect+miniBoss (the mini boss after). */
  kind: string;
  unlockLevel: number;
  goal: string;
  count: number;
  rewardXP: number;
  rewardKusing: number;
  mob?: string;
  item?: string;
  miniBoss?: string;
  /** The second part of a two-part quest: a mob to beat or an item to collect, and how many. */
  extra?: { target: string; count: number };
  unlocksDish?: string;
  /** Who takes the report (its giver when not given). */
  reportTo?: string;
  /** An item its giver hands over as it starts (Tisay's note). */
  gives?: string;
  rewards?: QuestReward[];
  /** A title given as it's reported (the titles' id). */
  rewardTitle?: string;
  /** A dish served free as it's reported (Q1: Aling Conching's bowl of Lugaw). */
  freeDish?: string;
  dialogue?: { give?: string[]; report?: string[] };
}

/** A dish on Aling Conching's menu (CONTEXT.md Dish): one main and one side at a time, `minutes` long, for Kusing, once
 *  the quest that unlocks it is done. `stats` = its effect as the buff system's stats. */
export interface PalengkeDish {
  name: string;
  effect: string;
  minutes: number;
  kusing: number;
  unlockedBy: string;
  slot: 'main' | 'side';
  stats: Record<string, number>;
}

/** The daily order after the chain (CONTEXT.md Daily order): one of `pool` a day, handed in to Aling Conching. */
export interface PalengkeDailies {
  pool: { item: string; count: number }[];
  rewardXP: number;
  rewardKusing: number;
  /** The day turns at this hour, at this UTC offset (4 am Manila). */
  reset: { hour: number; utcOffset: number };
  /** 'random': one of the dishes they've unlocked, served at once. */
  freeDish?: string;
  dialogue?: { give?: string[]; report?: string[] };
  /** The quest after which they start (the finale; the chain's last quest when not given). */
  unlockedBy?: string;
}

export interface PalengkeData {
  quests: PalengkeQuest[];
  questItems: Record<string, { name: string; mob?: string; dropChance?: number }>;
  miniBosses: Record<string, { id: string; name: string; level: number }[]>;
  /** What a quest's giver says while the next quest waits for a level ({level}). */
  gapLine?: string;
  dishes?: Record<string, PalengkeDish>;
  dailies?: PalengkeDailies;
}

/** Who gives the daily orders, and which quest opens them. */
const DAILY_GIVER = 'aling-conching';

/** The map the chain starts in: its first quest opens as you walk in at its unlock level. */
export const PALENGKE = 'palengke';

/** A mob kind's name from its id ("sako-slammer" → "Sako Slammer"), and its plural ("Sako Slammers", "Garapon Jars"). */
export const mobName = (id: string) => id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const plural = (name: string) => (name.endsWith('s') ? name : `${name}s`);

/**
 * The chain's quests as quests, in order (each one's `next` the one after): every step an objective, the last one at
 * an NPC. `npcName` names an NPC (their tile's data); `itemName` an item kind.
 */
export function palengkeQuests(P: PalengkeData, npcName: (id: string) => string): QuestDef[] {
  const itemName = (id: string) => P.questItems[id]?.name ?? mobName(id);
  const miniKind = (id: string | undefined) => (id ? Object.entries(P.miniBosses).find(([, list]) => list.some((m) => m.id === id))?.[0] : undefined);
  const miniName = (id: string | undefined) => (id ? Object.values(P.miniBosses).flat().find((m) => m.id === id)?.name : undefined) ?? 'its mini boss';
  const chain = P.quests.map((q, i): QuestDef => {
    const reporter = q.reportTo ?? q.giver;
    const talk = (npc: string, id: string, gives?: string): QuestObjectiveDef => ({ id, type: 'talk', npc, text: `Talk to ${npcName(npc)}`, ...(gives ? { gives } : {}) });
    const report = (): QuestObjectiveDef => ({ id: 'report', type: 'talk', npc: reporter, text: `Report to ${npcName(reporter)}` });
    const kill = (mob: string, count: number): QuestObjectiveDef => ({ id: 'kill', type: 'kill', mob, count, text: plural(mobName(mob)) });
    const collect = (item: string, count: number): QuestObjectiveDef => ({ id: 'collect', type: 'collect', item, count, text: plural(itemName(item)), label: plural(itemName(item)) });
    const deliver = (item: string, count: number): QuestObjectiveDef => ({ id: 'deliver', type: 'deliver', npc: reporter, item, count, text: `Bring ${count > 1 ? `the ${plural(itemName(item))}` : itemName(item)} to ${npcName(reporter)}` });
    const mini = (): QuestObjectiveDef => ({ id: 'mini', type: 'miniBoss', mob: miniKind(q.miniBoss), count: 1, text: `Defeat ${miniName(q.miniBoss)}` });
    let objectives: QuestObjectiveDef[];
    switch (q.kind) {
      case 'talk':
        objectives = [talk(q.giver, 'talk'), ...(q.reportTo && q.reportTo !== q.giver ? [report()] : [])];
        break;
      case 'kill':
        objectives = [kill(q.mob!, q.count), report()];
        break;
      case 'collect':
        objectives = [collect(q.item!, q.count), deliver(q.item!, q.count)];
        break;
      case 'kill+miniBoss':
        objectives = [kill(q.mob!, q.count), mini(), report()];
        break;
      case 'collect+miniBoss':
        objectives = [collect(q.item!, q.count), mini(), deliver(q.item!, q.count)];
        break;
      case 'collect+kill': {
        // Both at once: the kills with the items in hand; then the items handed over.
        const k = kill(q.extra!.target, q.extra!.count);
        objectives = [{ ...k, collect: { item: q.item!, count: q.count, label: plural(itemName(q.item!)) } }, deliver(q.item!, q.count)];
        break;
      }
      case 'kill+collect': {
        const k = kill(q.mob!, q.count);
        objectives = [{ ...k, collect: { item: q.extra!.target, count: q.extra!.count, label: plural(itemName(q.extra!.target)) } }, deliver(q.extra!.target, q.extra!.count)];
        break;
      }
      case 'deliver':
        objectives = [talk(q.giver, 'talk', q.gives), deliver(q.gives!, 1)];
        break;
      case 'fieldBoss':
        // (Then its bell, rung within 3 tiles once it's down: CONTEXT.md Bell.)
        objectives = [
          { id: 'boss', type: 'fieldBoss', mob: q.mob!, count: 1, needs: 'honest-weight', text: `Help defeat ${mobName(q.mob!)} with the ${itemName('honest-weight')}` },
          { id: 'bell', type: 'bell', mob: q.mob!, text: 'Ring the bell of the palengke' },
          report(),
        ];
        break;
      default:
        objectives = [report()];
    }
    return {
      id: q.id,
      type: 'main',
      title: q.title,
      giver: q.giver,
      summary: q.goal,
      objectives,
      handIn: true,
      unlockLevel: q.unlockLevel,
      ...(i === 0 ? { startsIn: PALENGKE } : {}),
      rewardXP: q.rewardXP,
      rewardKusing: q.rewardKusing,
      ...(q.rewards?.length ? { rewards: q.rewards } : {}),
      ...(q.rewardTitle ? { rewardTitle: q.rewardTitle } : {}),
      ...(q.unlocksDish ? { unlocksDish: q.unlocksDish } : {}),
      ...(q.freeDish ? { freeDish: q.freeDish } : {}),
      dialogue: { ...(q.dialogue?.give ? { give: q.dialogue.give } : {}), ...(q.dialogue?.report ? { report: q.dialogue.report } : {}) },
      next: P.quests[i + 1]?.id ?? null,
    };
  });
  return [...chain, ...dailyQuests(P, itemName, npcName)];
}

/** The daily orders as quests, one per pool entry (`palengke-daily-<item>`): collect, then bring them to Aling Conching;
 *  `daily` (done, they wait for the next day), after the chain's last quest. */
function dailyQuests(P: PalengkeData, itemName: (id: string) => string, npcName: (id: string) => string): QuestDef[] {
  const D = P.dailies;
  const last = P.quests.at(-1)?.id;
  if (!D || !last) return [];
  const fill = (lines: string[] | undefined, item: string, count: number) => lines?.map((l) => l.replaceAll('{count}', String(count)).replaceAll('{item}', plural(itemName(item))));
  return D.pool.map(({ item, count }): QuestDef => {
    const name = plural(itemName(item));
    const give = fill(D.dialogue?.give, item, count);
    const report = fill(D.dialogue?.report, item, count);
    return {
      id: `palengke-daily-${item}`,
      type: 'side',
      title: `Daily order: ${name}`,
      giver: DAILY_GIVER,
      summary: `Collect ${count} ${name} for ${npcName(DAILY_GIVER)}`,
      objectives: [
        { id: 'collect', type: 'collect', item, count, text: name, label: name },
        { id: 'deliver', type: 'deliver', npc: DAILY_GIVER, item, count, text: `Bring the ${name} to ${npcName(DAILY_GIVER)}` },
      ],
      handIn: true,
      daily: true,
      after: D.unlockedBy ?? last, // (the finale: Ang Silong's quest comes after it)
      rewardXP: D.rewardXP,
      rewardKusing: D.rewardKusing,
      ...(D.freeDish ? { freeDish: D.freeDish } : {}),
      dialogue: { ...(give ? { give } : {}), ...(report ? { report } : {}) },
      next: null,
    };
  });
}

/** The day a daily order belongs to ("2026-10-20"): the date at the reset's offset, turning at its hour. */
export function dailyDay(P: Pick<PalengkeData, 'dailies'>, now: number): string {
  const R = P.dailies?.reset ?? { hour: 0, utcOffset: 0 };
  return new Date(now + (R.utcOffset - R.hour) * 3_600_000).toISOString().slice(0, 10);
}

/** Today's daily order, if one is due: the chain finished, today's not handed in yet and none under way (an order not
 *  handed in stays until it is). A random one of the pool, started. Returns it, or null. */
export function startDaily(s: Pick<AdventureState, 'quests'>, quests: QuestDef[], P: Pick<PalengkeData, 'dailies'>, now: number, random: () => number = Math.random): QuestDef | null {
  const dailies = quests.filter((q) => q.daily);
  if (!dailies.length || !dailies[0].after || !s.quests.done.includes(dailies[0].after)) return null;
  if (s.quests.dailyDone === dailyDay(P, now) || s.quests.active.some((p) => dailies.some((q) => q.id === p.id))) return null;
  const q = dailies[Math.min(dailies.length - 1, Math.floor(random() * dailies.length))];
  s.quests.active.push({ id: q.id, step: 0 });
  return q;
}

/** A quest finished: into `done` (or, a daily order, today's marked handed in) and out of the active ones. */
export function finishQuest(s: Pick<AdventureState, 'quests'>, q: QuestDef, P: Pick<PalengkeData, 'dailies'>, now: number): void {
  s.quests.active = s.quests.active.filter((x) => x.id !== q.id);
  if (q.daily) s.quests.dailyDone = dailyDay(P, now);
  else if (!s.quests.done.includes(q.id)) s.quests.done.push(q.id);
}

// ── Dishes (CONTEXT.md Dish) ──

/** A dish by id. */
export const dishOf = (P: Pick<PalengkeData, 'dishes'>, id: string): PalengkeDish | undefined => P.dishes?.[id];

/** How long a dish lasts (ms). */
export const dishMs = (d: PalengkeDish) => d.minutes * 60_000;

/** Why they can't buy a dish (null: they can): no such dish, not unlocked yet (the quest's title), or short of Kusing. */
export function dishRefusal(s: Pick<AdventureState, 'quests' | 'kusing'>, quests: QuestDef[], P: Pick<PalengkeData, 'dishes'>, id: string): string | null {
  const d = dishOf(P, id);
  if (!d) return 'No such dish.';
  if (!s.quests.done.includes(d.unlockedBy)) return `Unlocks with ${quests.find((q) => q.id === d.unlockedBy)?.title ?? 'a quest'}.`;
  if (s.kusing < d.kusing) return `You need ${d.kusing.toLocaleString('en-US')} Kusing.`;
  return null;
}

/** A dish served free (a quest's `freeDish`): itself, or 'random' = one of the dishes they've unlocked (Lugaw if none). */
export function freeDishOf(s: Pick<AdventureState, 'quests'>, quests: QuestDef[], P: Pick<PalengkeData, 'dishes'>, free: string, random: () => number = Math.random): string | null {
  if (free !== 'random') return dishOf(P, free) ? free : null;
  const open = Object.entries(P.dishes ?? {}).filter(([, d]) => s.quests.done.includes(d.unlockedBy)).map(([id]) => id);
  const list = open.length ? open : Object.keys(P.dishes ?? {}).slice(0, 1);
  return list.length ? list[Math.min(list.length - 1, Math.floor(random() * list.length))] : null;
}

/** Whether a quest is open at this level (no unlockLevel: always). */
export const unlockedAt = (q: QuestDef | undefined, level: number) => !q?.unlockLevel || level >= q.unlockLevel;

/** The quests waiting for a level (CONTEXT.md Level gap): each the next of a done quest, neither started nor done, its
 *  unlockLevel not reached yet. */
export function waitingQuests(s: Pick<AdventureState, 'quests' | 'progress'>, quests: QuestDef[]): QuestDef[] {
  const level = s.progress?.level ?? 1;
  const out: QuestDef[] = [];
  for (const id of s.quests.done) {
    const next = quests.find((q) => q.id === quests.find((x) => x.id === id)?.next);
    if (next && !unlockedAt(next, level) && !s.quests.done.includes(next.id) && !s.quests.active.some((p) => p.id === next.id)) out.push(next);
  }
  return out;
}

/** A chain's first quest that starts as you walk into `area` at its unlock level (the Palengke's Q1). Returns whether it
 *  started. */
export function startInArea(s: Pick<AdventureState, 'quests' | 'progress'>, quests: QuestDef[], area: string): QuestDef[] {
  const level = s.progress?.level ?? 1;
  const started: QuestDef[] = [];
  for (const q of quests) {
    if (q.startsIn !== area || !unlockedAt(q, level) || s.quests.done.includes(q.id) || s.quests.active.some((p) => p.id === q.id)) continue;
    s.quests.active.push({ id: q.id, step: 0 });
    started.push(q);
  }
  return started;
}

/** The quest items a kill of `kind` drops for this player: each active quest's current objective that collects an item
 *  from that mob, still short of its count, rolled at the item's dropChance. */
export function questItemDrops(s: Pick<AdventureState, 'quests' | 'bag'>, quests: QuestDef[], P: Pick<PalengkeData, 'questItems'>, kind: string, random: () => number = Math.random): string[] {
  const out: string[] = [];
  for (const p of s.quests.active) {
    const o = quests.find((q) => q.id === p.id)?.objectives[p.step];
    const want = o?.type === 'collect' && o.item ? { item: o.item, count: objectiveCount(o) } : o?.collect;
    const def = want && P.questItems[want.item];
    if (!want || !def || def.mob !== kind || heldCount(s.bag, want.item) + out.filter((x) => x === want.item).length >= want.count) continue;
    if (random() < (def.dropChance ?? 0)) out.push(want.item);
  }
  return out;
}

/** The dishes a player has unlocked (by the quests' unlocksDish): each one whose quest they've finished. */
export const dishesUnlocked = (s: Pick<AdventureState, 'quests'>, quests: QuestDef[]): string[] => quests.flatMap((q) => (q.unlocksDish && s.quests.done.includes(q.id) ? [q.unlocksDish] : []));
