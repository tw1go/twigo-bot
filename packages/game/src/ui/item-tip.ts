import { type EquipPlace, type EquipSlot, type Item, type StatName, affixTier, derivedStats, itemTotals, placesFor, agimatSlots, agimatValue, wordList, baseStats, canEquip, enhancedBase, gearKind, gearMismatch, isGearDef, itemAura, itemName, lineText, lineValue, pickupLine, requirements, statLabel } from '@mikazuki/shared';
import { adventure, classInfo, itemData } from '../net/adventure';
import { type Rarity, RARITY_TEXT, isRarity, itemArt, itemArtUrl, placeholderArt } from './item-art';
import { auraIcon } from '../fx/weaponAura';
import { slotSilhouette } from './equipment';

// 🏷️ An item's tooltip (the combat bag, the equipment panel, the shop, loot): its name in its rarity's colour ("Sturdy
// Slingshot of Calamity +7", "(Broken)"), what it is, its level and what it needs (what you don't meet in red, by
// your base stats), its base stat with its plus ("ATK 46 (40 +6)"), its three affix lines (line 3 last), its agimat
// slots as dots (filled: the agimat's stat and value), and Bound / "Binds when worn". Things that aren't gear: what they
// do. Also the item's picture (its icon, else its slot's silhouette or a square in its rarity's colour).

const SLOT: Record<EquipSlot, string> = {
  weapon: 'Weapon', head: 'Head', body: 'Body', hands: 'Hands', bottoms: 'Bottoms', feet: 'Feet', necklace: 'Necklace', earrings: 'Earrings', bracers: 'Bracers', ring: 'Ring',
};

/** Your main stat (a `stat` line's name and value), if you have a class. */
export const myMainStat = (): StatName | null => {
  const D = itemData();
  const cls = adventure()?.cls;
  return (cls && D?.stats.classes[cls]?.main) || null;
};

/** An item's name as you see it. */
/** The line in your own system feed as you pick something up ("Gained Sturdy Slingshot of Calamity +1 (1 slot)",
 *  "Gained 120 Kusing"): its text and coloured runs. */
export const pickupOf = (got: { kusing?: number; item?: Item }): ReturnType<typeof pickupLine> | null => {
  const D = itemData();
  return D ? pickupLine(D, got, myMainStat()) : null;
};

export const nameOf = (item: Item): string => {
  const D = itemData();
  return D ? itemName(D, item, myMainStat()) : item.defId;
};

/** Shows an item in the chat: "[its name]" into the input (ui/chat.ts listens), sent with its uid. Alt+click in the bag
 *  or the equipment panel. */
export function chatItem(it: Item): void {
  dispatchEvent(new CustomEvent('mk-chat-item', { detail: { label: nameOf(it), uid: it.uid } }));
}

export const rarityOf = (item: Pick<Item, 'rarity'>): Rarity => (isRarity(item.rarity) ? item.rarity : 'white');

/** An item's picture at `scale`× ('icon' 16 px, 'showcase' 32 px): its art, else its slot's silhouette (gear), else a
 *  square in its rarity's colour. A +15 or better weapon has its aura round it (fx/weaponAura.ts). */
export function itemPicture(item: Item, size: 'icon' | 'showcase' = 'icon', scale = 2): HTMLElement {
  const D = itemData();
  const def = D?.defs.get(item.defId);
  const art = itemArt(item.defId, rarityOf(item), size, scale, true);
  const aura = D ? itemAura(D, item) : null;
  const url = itemArtUrl(item.defId, size);
  if (art && aura && url) {
    // The glow, the icon and its spirals drawn together in place of the plain picture.
    const pic = art.querySelector<HTMLElement>('.it-pic');
    const glow = auraIcon(url, size === 'icon' ? 16 : 32, aura, scale);
    glow.style.position = 'absolute';
    glow.style.left = glow.style.top = `${scale}px`;
    pic?.replaceWith(glow);
    art.classList.add('it-aura');
    return art;
  }
  if (art) return art;
  if (isGearDef(def)) return slotSilhouette(def.slot, (size === 'icon' ? 16 : 32) * scale) ?? placeholderArt(rarityOf(item), size, scale);
  return placeholderArt(rarityOf(item), size, scale);
}

/** The tooltip's lines for an item. */
export function itemTipFor(item: Item): HTMLElement[] {
  const D = itemData();
  const def = D?.defs.get(item.defId);
  const rarity = rarityOf(item);
  const name = el('div', 'eq-tip-name', nameOf(item));
  name.style.color = item.broken ? '#9CA3AF' : RARITY_TEXT[rarity];
  if (!D || !def) return [name];
  const parts: HTMLElement[] = [name];
  if (isGearDef(def) && itemAura(D, item)) {
    // A glowing weapon shows its aura in the tooltip too.
    const head = el('div', 'eq-tip-head');
    head.append(itemPicture(item, 'icon', 2), name);
    parts[0] = head;
  }
  if (!isGearDef(def)) {
    const kind = def.kind === 'potion' ? (def.heals === 'mp' ? 'MP Potion' : 'HP Potion') : def.kind === 'agimat' ? 'Agimat' : def.kind === 'cosmetic' ? 'Cosmetic' : 'Material';
    parts.push(el('div', 'eq-tip-meta', `${kind}${item.count > 1 ? ` · ×${item.count}` : ''}`));
    if (def.kind === 'agimat' && item.stat) {
      parts.push(el('div', 'eq-tip-line', lineText(item.stat, agimatValue(D.stats, item.stat, item.level))));
      const only = agimatSlots(D.stats, item.stat);
      const where = item.lock ? `, ${SLOT[item.lock].toLowerCase()} only` : only ? `, ${wordList(only.map((x) => SLOT[x].toLowerCase()))} only` : '';
      parts.push(el('div', 'eq-tip-meta', `Fits gear of Lv ${item.level} or higher${where}`));
    }
    if (def.about) parts.push(el('div', 'eq-tip-about', def.about));
    if (def.kind === 'cosmetic') parts.push(el('div', 'eq-tip-unmet', "Can't be worn yet"));
    return parts;
  }
  const who = def.class ? (classInfo(def.class)?.name ?? def.class) : def.gear;
  // (Its rarity shows in its name's colour; it isn't written out.)
  parts.push(el('div', 'eq-tip-meta', [who, SLOT[def.slot]].filter(Boolean).join(' · ')));
  // Another class's gear, said plainly (its stat needs below would only say "Needs DEX 14").
  const D0 = itemData();
  const other = D0 ? gearMismatch(D0.stats, adventure()?.cls, def, (c) => classInfo(c)?.name ?? c) : null;
  if (other) parts.push(el('div', 'eq-tip-unmet', other));
  // Lv and what it needs, by your base stats (gear's never count).
  const s = adventure();
  const gearItem = { ...def, level: item.level };
  const missing = s ? canEquip(D.stats, baseStats(D.stats, s.cls, s.progress.level, s.progress.points), s.progress.level, gearItem).missing : [];
  const needs = el('div', 'eq-tip-needs');
  requirements(D.stats, gearItem).forEach((r, i) => {
    const m = missing.find((x) => x.stat === r.stat);
    if (i) needs.append(' · ');
    needs.append(el('span', m && !m.highest ? 'eq-tip-unmet' : undefined, r.stat === 'level' ? `Lv ${r.value}` : `${r.stat} ${r.value}`));
  });
  parts.push(needs);
  const highest = missing.find((m) => m.highest);
  if (highest) parts.push(el('div', 'eq-tip-unmet', `${highest.stat} must be your highest stat`));
  // Its base stat, with what its plus adds.
  const base = enhancedBase(D.stats, def, { level: item.level, plus: 0 });
  const now = enhancedBase(D.stats, def, item);
  for (const k of ['atk', 'def'] as const) {
    if (base[k] === undefined) continue;
    const up = (now[k] ?? 0) - (base[k] ?? 0);
    parts.push(el('div', 'eq-tip-stat', `${statLabel(k)} ${now[k]}${up ? ` (${base[k]} +${up})` : ''}`));
  }
  for (const [k, v] of Object.entries(def.stats ?? {})) if (k !== 'atk' && k !== 'def') parts.push(el('div', 'eq-tip-stat', `+${v} ${k === 'crit' ? 'Crit %' : k.toUpperCase()}`));
  // The affix lines, line 3 last (an accessory's grow with its plus).
  const tier = affixTier(D.stats, item.rarity);
  for (const line of item.lines) {
    const row = el('div', `eq-tip-line${tier === 'orange' ? ' eq-tip-orange' : ''}`, lineText(line.stat, lineValue(D.stats, def, item, line), myMainStat()));
    parts.push(row);
  }
  // Agimat slots as dots.
  if (item.agimats.length) {
    const dots = el('div', 'eq-tip-dots');
    for (const a of item.agimats) {
      const dot = el('span', `eq-tip-dot${a ? ' eq-tip-dot-on' : ''}`);
      dots.append(dot, el('span', 'eq-tip-dot-text', a ? `${lineText(a.stat, agimatValue(D.stats, a.stat, a.level))} (Lv ${a.level})` : 'Empty agimat slot'));
    }
    parts.push(dots);
  }
  if (item.broken) parts.push(el('div', 'eq-tip-unmet', 'Broken: repair it with a Repair Kit of its tier'));
  if (def.training) parts.push(el('div', 'eq-tip-note', "Training gear: bound; it can't be dropped, traded, sold, enhanced or taken apart"));
  else if (item.bound) parts.push(el('div', 'eq-tip-note', 'Bound'));
  else if (affixTier(D.stats, item.rarity) === 'orange') parts.push(el('div', 'eq-tip-note eq-tip-binds', 'Binds when worn'));
  if (gearKind(def.slot) === 'accessory' && item.plus) parts.push(el('div', 'eq-tip-meta', `Lines +${item.plus}% from its plus`));
  return parts;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ── Comparing and keys ──

/** What you wear in the place(s) an item would go (two for rings and bracers), for the Shift comparison. */
export function wornFor(item: Item): Item[] {
  const def = itemData()?.defs.get(item.defId);
  const s = adventure();
  if (!s || !isGearDef(def)) return [];
  return placesFor(def.slot).flatMap((p) => (s.equipped[p] ? [s.equipped[p]!] : []));
}

/** Wearing it instead of what's worn (where the server would put it: the first free place, else the first): the change to
 *  your ATK, DEF, HP, MP and crit, each green (more) or red (less); "No change" if none. Null for what can't be worn. */
export function wearDiff(item: Item): HTMLElement | null {
  const D = itemData();
  const def = D?.defs.get(item.defId);
  const s = adventure();
  if (!D || !s || !isGearDef(def)) return null;
  const places = placesFor(def.slot);
  const to: EquipPlace = places.find((p) => !s.equipped[p]) ?? places[0];
  const stats = (equipped: Partial<Record<EquipPlace, Item>>) =>
    derivedStats(D.stats, s.cls, s.progress.level, baseStats(D.stats, s.cls, s.progress.level, s.progress.points), itemTotals(D, Object.values(equipped).filter((i): i is Item => !!i), myMainStat()));
  const now = stats(s.equipped);
  const then = stats({ ...s.equipped, [to]: item });
  const row = el('div', 'eq-tip-diff');
  row.append(el('span', 'eq-tip-diff-label', s.equipped[to] ? 'Wearing this: ' : 'Wearing this (an empty slot): '));
  const parts: [string, number, (n: number) => string][] = [
    ['ATK', then.power - now.power, (n) => String(Math.round(n))],
    ['DEF', then.def - now.def, (n) => String(Math.round(n))],
    ['HP', then.hp - now.hp, (n) => String(Math.round(n))],
    ['MP', then.mp - now.mp, (n) => String(Math.round(n))],
    ['Crit', then.critRate - now.critRate, (n) => `${+(n * 100).toFixed(1)}%`],
  ];
  const shown = parts.filter(([, d, f]) => f(Math.abs(d)) !== '0' && f(Math.abs(d)) !== '0%');
  if (!shown.length) row.append(el('span', 'eq-tip-diff-same', 'No change'));
  shown.forEach(([label, d, f], i) => {
    if (i) row.append(' · ');
    row.append(el('span', d > 0 ? 'eq-tip-diff-up' : 'eq-tip-diff-down', `${label} ${d > 0 ? '+' : '−'}${f(Math.abs(d))}`));
  });
  return row;
}

/** The Alt key's name here (Option on a Mac). */
const ALT = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Option' : 'Alt';

/** What the keys do with an item, at the foot of its tooltip: in the bag (`bag`) or worn (`worn`). */
export function itemKeys(item: Item, where: 'bag' | 'worn'): HTMLElement {
  const def = itemData()?.defs.get(item.defId);
  const keys: string[] = [];
  if (where === 'worn') keys.push('Double-click or right-click: take off');
  else if (isGearDef(def)) keys.push('Double-click: wear', 'Hold Shift: compare', 'Right-click: more');
  else if (def?.kind === 'agimat' || def?.forge === 'whetstone' || def?.forge === 'repairKit') keys.push('Click: open the forge');
  else if (def?.forge === 'fragment') keys.push('Right-click: combine');
  else if (def?.kind === 'potion') keys.push('Drag onto your hotbar');
  keys.push(`${ALT}+click: show in chat`);
  return el('div', 'eq-tip-keys', keys.join(' · '));
}
