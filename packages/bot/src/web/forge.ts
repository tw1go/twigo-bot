import { sellPrice,
  type CombatItemDef,
  type ForgeHolder,
  type Item,
  type ItemData,
  type TownForgeAction,
  type TownForgeResponse,
  addToBag,
  breaksFrom,
  countOf,
  disassembleRefusal,
  disassemblyYield,
  embedRefusal,
  enhanceRefusal,
  findItem,
  fragmentsPerWhetstone,
  gearTier,
  isGearDef,
  itemName,
  luckPerFail,
  newAgimat,
  newItem,
  repairRefusal,
  stonesFor,
  successFor,
  takeKind,
  tidyLuck,
  toolFor,
  unequipBroken,
} from '@mikazuki/shared';
import { rollAgimatStat } from './loot.js';

// ⚒️ The forge popup's actions, rolled here on the server (the game only shows them): enhancing with whetstones (the odds
// plus the item's luck: a success +1 and luck back to 0; a fail uses the stones and adds luck, and from +16 breaks the
// item, which keeps its +), repairing with a Repair Kit of its tier, setting an agimat into a slot (a full one only once
// they've said yes: the old one breaks), taking gear apart (its tier's fragments, and an agimat locked to its slot type
// from slotted gear; its own agimats are destroyed) and combining fragments into whetstones. The rules and refusals are
// @mikazuki/shared's forge.ts (the game shows them too); the numbers are classes/stats.json's. Pure: `random` and `uid`
// come in (web/adventure.ts saves the character after).

type Result = Omit<TownForgeResponse, 'items'>;
const no = (message: string): Result => ({ ok: false, message });

/** Enhances an item (worn or in the bag) with its tier's whetstones (`tool`: the kind the popup was opened with). */
export function enhance(data: ItemData, s: ForgeHolder, uid: string, tool: string | undefined, random: () => number): Result {
  const found = findItem(s, uid);
  if (!found) return no("You don't have that item.");
  const item = found.item;
  const why = enhanceRefusal(data, item, tool);
  if (why) return no(why);
  const stone = toolFor(data, 'whetstone', gearTier(data.stats, item.level));
  if (!stone) return no("There's no whetstone for gear of that level yet.");
  const target = item.plus + 1;
  const stones = stonesFor(data.stats, target);
  if (!takeKind(s.bag, stone.id, stones)) return no(`Needs ${stones} ${stone.name}${stones === 1 ? '' : 's'} (you have ${countOf(s.bag, stone.id)}).`);
  const chance = Math.min(1, tidyLuck(successFor(data.stats, target) + item.luck));
  if (random() < chance) {
    item.plus = target;
    item.luck = 0;
    return { ok: true, outcome: 'success', message: `Success! It's ${itemName(data, item)} now.`, item };
  }
  item.luck = tidyLuck(item.luck + luckPerFail(data.stats, target));
  if (target >= breaksFrom(data.stats)) {
    item.broken = true;
    unequipBroken(data, s); // (into the bag if there's room; worn, it gives nothing anyway)
    return { ok: true, outcome: 'break', message: `It broke! It keeps its +${item.plus}: repair it with a Repair Kit.`, item };
  }
  return { ok: true, outcome: 'fail', message: `It failed. The whetstones are used up; luck +${Math.round(luckPerFail(data.stats, target) * 100)}% for the next try.`, item };
}

/** Repairs a broken item (worn or in the bag) with one Repair Kit of its tier. */
export function repair(data: ItemData, s: ForgeHolder, uid: string, tool: string | undefined): Result {
  const found = findItem(s, uid);
  if (!found) return no("You don't have that item.");
  const why = repairRefusal(data, found.item, tool);
  if (why) return no(why);
  const kit = toolFor(data, 'repairKit', gearTier(data.stats, found.item.level));
  if (!kit || !takeKind(s.bag, kit.id, 1)) return no(`You need ${kit ? `a ${kit.name}` : 'a Repair Kit of its tier'}.`);
  found.item.broken = false;
  return { ok: true, outcome: 'repaired', message: `Repaired ${itemName(data, found.item)}!`, item: found.item };
}

/** Sets one agimat from a stack in the bag into slot `slot` of a piece of gear (worn or in the bag). A full slot asks
 *  first (`confirm`), then the old agimat breaks. For good. */
export function embed(data: ItemData, s: ForgeHolder, gearUid: string, agimatUid: string, slot: number, replace: boolean): Result {
  const gear = findItem(s, gearUid)?.item;
  const stack = s.bag.find((b) => b.uid === agimatUid);
  if (!gear || !stack) return no("You don't have that item.");
  const why = embedRefusal(data, gear, stack, slot);
  if (why) return no(why);
  const old = gear.agimats[slot];
  if (old && !replace) return { ok: false, confirm: true, message: `That slot has ${an(agimatWords(data, old))}. Put this one in its place? The old agimat breaks.` };
  gear.agimats[slot] = { stat: stack.stat!, level: stack.level, ...(stack.lock ? { lock: stack.lock } : {}) };
  stack.count -= 1;
  if (stack.count <= 0) s.bag.splice(s.bag.indexOf(stack), 1);
  return { ok: true, outcome: 'embedded', message: `Set ${itemName(data, { ...stack, count: 1 })} into ${itemName(data, gear)}${old ? ` (the old ${agimatWords(data, old)} broke)` : ''}.`, item: gear };
}

/** "Crit Damage Agimat Lv 20". */
function agimatWords(data: ItemData, a: { stat: string; level: number }): string {
  const def = [...data.defs.values()].find((d): d is CombatItemDef => !isGearDef(d) && d.kind === 'agimat' && d.stat === a.stat);
  return `${def?.name ?? 'agimat'} Lv ${a.level}`;
}

/** "a" or "an" before a name ("an HP Agimat", "a DEF Agimat"). */
const an = (name: string) => (/^(?:[aeiou]|HP|MP|STR|INT)/i.test(name) && !/^DEF/.test(name) ? `an ${name}` : `a ${name}`);

/** Takes a piece of gear in the bag apart: its tier's fragments, and from slotted gear one agimat (its level, locked to
 *  its slot type; the stat rolled, the rare three 3× as likely from two slots). Its own agimats are destroyed. Refused
 *  (nothing changes) when what comes back doesn't fit. */
export function disassemble(data: ItemData, s: ForgeHolder, uid: string, random: () => number, newUid: () => string): Result {
  const why = disassembleRefusal(data, s, uid);
  if (why) return no(why);
  const at = s.bag.findIndex((b) => b.uid === uid);
  const item = s.bag[at];
  const y = disassemblyYield(data, item);
  const got: Item[] = [];
  if (y.fragment && y.fragments > 0) got.push(newItem(data.stats, y.fragment, newUid(), y.fragments));
  if (y.agimat) {
    const stat = rollAgimatStat(data, random, y.agimat.rareTimes, y.agimat.lock); // (one that fits its slot)
    const def = [...data.defs.values()].find((d): d is CombatItemDef => !isGearDef(d) && d.kind === 'agimat' && d.stat === stat);
    if (def) got.push(newAgimat(data.stats, def, y.agimat.level, newUid(), y.agimat.lock));
  }
  const bag = structuredClone(s.bag);
  bag.splice(at, 1);
  for (const g of got) if (!addToBag(data, bag, structuredClone(g), newUid)) return no('Make room in your combat bag first.');
  s.bag.splice(0, s.bag.length, ...bag);
  const what = got.map((g) => `${g.count > 1 ? `${g.count}× ` : ''}${itemName(data, g)}`).join(' and ');
  return { ok: true, outcome: 'disassembled', message: `Took ${itemName(data, item)} apart${what ? `: ${what}` : ''}.`, got };
}

/** Combines a fragment stack's kind into whetstones of its tier: every ten (disassembly.fragments.craft) into one. */
export function combine(data: ItemData, s: ForgeHolder, uid: string, newUid: () => string): Result {
  const stack = s.bag.find((b) => b.uid === uid);
  const def = stack && data.defs.get(stack.defId);
  if (!stack || !def || isGearDef(def) || def.forge !== 'fragment') return no('Only whetstone fragments combine.');
  const per = fragmentsPerWhetstone(data.stats);
  const stone = toolFor(data, 'whetstone', def.tier ?? null);
  const n = Math.floor(countOf(s.bag, def.id) / per);
  if (!stone) return no('There is no whetstone of that tier yet.');
  if (n < 1) return no(`It takes ${per} fragments to make a ${stone.name}.`);
  const bag = structuredClone(s.bag);
  takeKind(bag, def.id, n * per);
  const made = newItem(data.stats, stone, newUid(), n);
  if (!addToBag(data, bag, structuredClone(made), newUid)) return no('Make room in your combat bag first.');
  s.bag.splice(0, s.bag.length, ...bag);
  return { ok: true, outcome: 'combined', message: `Combined ${n * per} fragments into ${n} ${stone.name}${n === 1 ? '' : 's'}.`, got: [made] };
}

/** Sells training gear or an agimat (a whole stack) from the bag for Kusing (stats.json trainingGear.sellKusing,
 *  agimats.sellKusing: `sellPrice`); nothing else sells here. */
export function sell(data: ItemData, s: ForgeHolder, uid: string): Result {
  const at = s.bag.findIndex((b) => b.uid === uid);
  const item = s.bag[at];
  if (!item) return no(Object.values(s.equipped).some((i) => i?.uid === uid) ? 'Take it off first.' : "You don't have that item.");
  const price = sellPrice(data, item);
  if (price === null) return no('Only training gear and agimats sell here.');
  s.bag.splice(at, 1);
  s.kusing = (s.kusing ?? 0) + price;
  return { ok: true, outcome: 'sold', message: `Sold ${item.count > 1 ? `${item.count}× ` : ''}${itemName(data, { ...item, count: 1 })} for ${price.toLocaleString('en-US')} Kusing.` };
}

/** Several items taken apart or sold at once (the bag's multi-select): each by the one-item rules, in turn on a copy;
 *  every one or none (the first refusal, with the item's name, and nothing changes). One message with all that came back
 *  (like kinds added up). */
function many(data: ItemData, s: ForgeHolder, uids: string[], one: (h: ForgeHolder, uid: string) => Result, outcome: 'disassembled' | 'sold'): Result {
  const list = [...new Set(uids)];
  if (!list.length) return no('Pick some items first.');
  const copy: ForgeHolder = { equipped: s.equipped, bag: structuredClone(s.bag), kusing: s.kusing };
  const got: Item[] = [];
  for (const uid of list) {
    const item = copy.bag.find((b) => b.uid === uid);
    const r = one(copy, uid);
    if (!r.ok) return no(item ? `${itemName(data, item)}: ${r.message}` : r.message);
    got.push(...(r.got ?? []));
  }
  s.bag.splice(0, s.bag.length, ...copy.bag);
  const earned = (copy.kusing ?? 0) - (s.kusing ?? 0);
  s.kusing = copy.kusing;
  const counts = new Map<string, number>();
  for (const g of got) {
    const name = itemName(data, { ...g, count: 1 });
    counts.set(name, (counts.get(name) ?? 0) + g.count);
  }
  const what = [...counts].map(([name, n]) => `${n > 1 ? `${n}× ` : ''}${name}`).join(', ');
  const n = `${list.length} item${list.length === 1 ? '' : 's'}`;
  return outcome === 'sold'
    ? { ok: true, outcome, message: `Sold ${n} for ${earned.toLocaleString('en-US')} Kusing.` }
    : { ok: true, outcome, message: `Took ${n} apart${what ? `: ${what}` : ''}.`, got };
}

/** One forge action. */
export function forge(data: ItemData, s: ForgeHolder, a: TownForgeAction, random: () => number, newUid: () => string): Result {
  switch (a.action) {
    case 'enhance':
      return enhance(data, s, a.item, a.tool, random);
    case 'repair':
      return repair(data, s, a.item, a.tool);
    case 'embed':
      return embed(data, s, a.item, a.agimat, a.slot, !!a.replace);
    case 'disassemble':
      return disassemble(data, s, a.item, random, newUid);
    case 'combine':
      return combine(data, s, a.item, newUid);
    case 'sell':
      return sell(data, s, a.item);
    case 'disassemble-many':
      return many(data, s, a.items, (h, uid) => disassemble(data, h, uid, random, newUid), 'disassembled');
    case 'sell-many':
      return many(data, s, a.items, (h, uid) => sell(data, h, uid), 'sold');
  }
}

/** The body of POST /town/forge, if it's a valid one. */
export function parseForgeAction(body: unknown): TownForgeAction | null {
  const b = body as Record<string, unknown> | null;
  const id = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 64;
  if (b && (b.action === 'disassemble-many' || b.action === 'sell-many'))
    return Array.isArray(b.items) && b.items.length > 0 && b.items.length <= 100 && b.items.every(id) ? { action: b.action, items: b.items as string[] } : null;
  if (!b || !id(b.item)) return null;
  const item = b.item as string;
  const tool = id(b.tool) ? (b.tool as string) : undefined;
  if (b.action === 'enhance' || b.action === 'repair') return { action: b.action, item, ...(tool ? { tool } : {}) };
  if (b.action === 'embed' && id(b.agimat) && Number.isInteger(b.slot)) return { action: 'embed', item, agimat: b.agimat as string, slot: b.slot as number, ...(b.replace === true ? { replace: true } : {}) };
  if (b.action === 'disassemble' || b.action === 'combine' || b.action === 'sell') return { action: b.action, item };
  return null;
}
