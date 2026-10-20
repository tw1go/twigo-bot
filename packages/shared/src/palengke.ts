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
  dialogue?: { give?: string[]; report?: string[] };
}

export interface PalengkeData {
  quests: PalengkeQuest[];
  questItems: Record<string, { name: string; mob?: string; dropChance?: number }>;
  miniBosses: Record<string, { id: string; name: string; level: number }[]>;
  /** What a quest's giver says while the next quest waits for a level ({level}). */
  gapLine?: string;
}

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
  return P.quests.map((q, i): QuestDef => {
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
        objectives = [{ id: 'boss', type: 'fieldBoss', mob: q.mob!, count: 1, needs: 'honest-weight', text: `Help defeat ${mobName(q.mob!)} with the ${itemName('honest-weight')}` }, report()];
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
      dialogue: { ...(q.dialogue?.give ? { give: q.dialogue.give } : {}), ...(q.dialogue?.report ? { report: q.dialogue.report } : {}) },
      next: P.quests[i + 1]?.id ?? null,
    };
  });
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

/** The dishes a player has unlocked: each one whose quest (unlocksDish) they've finished. */
export const dishesUnlocked = (s: Pick<AdventureState, 'quests'>, quests: QuestDef[]): string[] => quests.flatMap((q) => (q.unlocksDish && s.quests.done.includes(q.id) ? [q.unlocksDish] : []));
