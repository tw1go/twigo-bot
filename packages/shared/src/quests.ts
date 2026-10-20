import type { AdventureState, QuestDef, QuestObjectiveDef } from './adventure.js';
import type { Item } from './items.js';
import { objectiveCount } from './leveling.js';

// 📜 Quest rules both sides run (the bot's web/adventure.ts, the game's pretend store in dev): offered quests (a
// minLevel, not autoStart: CONTEXT.md "Offered quest") and the item objectives, collect (done as the item is in the
// combat bag) and deliver (talking to their NPC with it: they take it). Pure.

/** How many of an item kind are in the combat bag. */
export const heldCount = (bag: Item[], defId: string | undefined) => (defId ? bag.reduce((n, it) => n + (it.defId === defId ? it.count : 0), 0) : 0);

/** Quests a character can start now: a minLevel they've reached, not autoStart, neither under way nor done. */
export function offeredQuests(s: Pick<AdventureState, 'quests' | 'progress'>, quests: QuestDef[]): QuestDef[] {
  const level = s.progress?.level ?? 1;
  return quests.filter((q) => q.minLevel !== undefined && !q.autoStart && level >= q.minLevel && !s.quests.done.includes(q.id) && !s.quests.active.some((p) => p.id === q.id));
}

/** The offered quest an NPC gives (its first objective is to talk to them), if any. */
export function offeredBy(s: Pick<AdventureState, 'quests' | 'progress'>, quests: QuestDef[], npc: string): QuestDef | null {
  return offeredQuests(s, quests).find((q) => q.giver === npc && q.objectives[0]?.type === 'talk' && q.objectives[0]?.npc === npc) ?? null;
}

/** A collect objective's item is in the bag (done). */
export const collected = (o: QuestObjectiveDef | undefined, bag: Item[]) => o?.type === 'collect' && heldCount(bag, o.item) >= objectiveCount(o);

/** A hunting objective (kill, miniBoss, fieldBoss) that's done: its count reached, with any items it also needs in hand
 *  (`collect`: the Palengke's kill-and-collect quests). */
export function huntDone(o: QuestObjectiveDef | undefined, p: { count?: number }, bag: Item[]): boolean {
  if (!o || (o.type !== 'kill' && o.type !== 'miniBoss' && o.type !== 'fieldBoss')) return false;
  return (p.count ?? 0) >= objectiveCount(o) && (!o.collect || heldCount(bag, o.collect.item) >= o.collect.count);
}

/** Every active quest whose current objective is a collect that's done, or (a hand-in quest: the Palengke's, no radio
 *  report) a hunt that's done, moved on to its next objective (neither is ever a quest's last: what's collected is then
 *  delivered, a hunt reported). Returns whether anything moved. */
export function advanceCollects(s: Pick<AdventureState, 'quests' | 'bag'>, quests: QuestDef[]): boolean {
  let moved = false;
  for (const p of s.quests.active) {
    const q = quests.find((x) => x.id === p.id);
    while (q && p.step < q.objectives.length - 1 && (collected(q.objectives[p.step], s.bag) || (q.handIn && huntDone(q.objectives[p.step], p, s.bag)))) {
      p.step++;
      delete p.count;
      moved = true;
    }
  }
  return moved;
}

/** The bell rung after a field boss of `mob` fell (the Great Scale's): every active quest on its `bell` objective for
 *  that boss moves on. Returns whether anything moved. */
export function ringBell(s: Pick<AdventureState, 'quests'>, quests: QuestDef[], mob: string): boolean {
  let moved = false;
  for (const p of s.quests.active) {
    const q = quests.find((x) => x.id === p.id);
    const o = q?.objectives[p.step];
    if (!q || o?.type !== 'bell' || o.mob !== mob || p.step >= q.objectives.length - 1) continue;
    p.step++;
    delete p.count;
    moved = true;
  }
  return moved;
}

/** Whether a quest of theirs waits on that boss's bell. */
export const waitsOnBell = (s: Pick<AdventureState, 'quests'>, quests: QuestDef[], mob: string) =>
  s.quests.active.some((p) => {
    const o = quests.find((x) => x.id === p.id)?.objectives[p.step];
    return o?.type === 'bell' && o.mob === mob;
  });

/** Takes `count` of an item kind out of the combat bag (all or nothing). */
export function takeFromBag(bag: Item[], defId: string, count: number): boolean {
  if (heldCount(bag, defId) < count) return false;
  let left = count;
  for (let i = bag.length - 1; i >= 0 && left > 0; i--) {
    const it = bag[i];
    if (it.defId !== defId) continue;
    const n = Math.min(it.count, left);
    it.count -= n;
    left -= n;
    if (it.count <= 0) bag.splice(i, 1);
  }
  return true;
}
