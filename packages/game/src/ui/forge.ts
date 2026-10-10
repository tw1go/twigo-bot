import {
  type ForgeMode,
  type Item,
  type NextStat,
  type TownForgeAction,
  type TownForgeResponse,
  RATE_STATS,
  agimatValue,
  countOf,
  disassemblyYield,
  embedRefusal,
  enhanceRefusal,
  enhanceView,
  findItem,
  fragmentsPerWhetstone,
  gearTier,
  isGearDef,
  newItem,
  lineText,
  repairRefusal,
  statLabel,
  toolFor,
  toolName,
} from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { adventure, anyDef, forgeAction, itemData, onAdventure } from '../net/adventure';
import type { Strip } from './casino';
import { RARITY_TEXT } from './item-art';
import { agimatIcon, itemPicture, nameOf, rarityOf } from './item-tip';
import { toast } from './toast';

// ⚒️ The forge popup (combat-guide.md "How to enhance"), beside the inventory in the same window style. Clicking a
// whetstone in the combat bag opens it to enhance: drag a weapon, armor piece or accessory of the whetstone's tier into
// the item slot (worn gear from the equipment panel too; a click on it does the same while the popup is open), drag the
// whetstone stack onto the stone slot or use + and −: "Whetstones 6 / 6", the odds with the item's luck ("Luck +6%"),
// what the next + gives ("ATK 48 → 49"). Enhance lights up once enough stones are in; the server rolls it (bot
// web/forge.ts): success, fail (the stones are used, luck grows) or, from +16, a break. The item stays in for another
// try. A Repair Kit opens it to repair (a broken item of its tier); an agimat to embed (slotted gear: pick a slot, then
// Embed; a full slot asks first, as the old agimat breaks). Anything that doesn't fit bounces back with why. Taking gear
// apart and combining fragments are in the bag's right-click menu (ui/inventory.ts), with confirmDisassemble here.
// Effects from fx/progress (manifest fx) over the item slot, sounds combat-enhance-* / -repair / -agimat-embed.

/** The popup's effects (manifest fx enhance-success, -fail, -break, agimat-embed, disassemble). */
export interface ForgeArt {
  success?: Strip;
  fail?: Strip;
  break?: Strip;
  embed?: Strip;
  disassemble?: Strip;
}
let art: ForgeArt = {};
export const setForgeArt = (a: ForgeArt) => (art = a);

const FX_SCALE = 2;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Plays an effect strip once over `over` (centred; an element, or where one was), then removes it. */
export function playForgeFx(strip: Strip | undefined, over: HTMLElement | DOMRect): void {
  if (!strip) return;
  const r = over instanceof DOMRect ? over : over.getBoundingClientRect();
  const fx = el('div', 'fg-fx');
  const w = strip.w * FX_SCALE;
  const h = strip.h * FX_SCALE;
  Object.assign(fx.style, {
    left: `${Math.round(r.left + r.width / 2 - w / 2)}px`,
    top: `${Math.round(r.top + r.height / 2 - h / 2)}px`,
    width: `${w}px`,
    height: `${h}px`,
    backgroundImage: `url("${strip.url}")`,
    backgroundSize: `${w * strip.frames}px ${h}px`,
  });
  document.body.append(fx);
  let f = 0;
  const timer = setInterval(() => {
    if (++f >= strip.frames) {
      clearInterval(timer);
      return fx.remove();
    }
    fx.style.backgroundPosition = `${-f * w}px 0`;
  }, 1000 / strip.fps);
}

/** A stat change as the popup shows it: "ATK 48 → 49", "Crit damage 4.0% → 4.1%". */
function nextLine(n: NextStat): string {
  const v = (x: number) => (RATE_STATS.has(n.stat) ? `${+(x * 100).toFixed(1)}%` : String(x));
  return `${statLabel(n.stat)} ${v(n.from)} → ${v(n.to)}`;
}
const pct = (x: number) => `${Math.round(x * 100)}%`;

export class ForgePopup {
  private readonly root = el('div');
  private readonly body = el('div', 'fg-body');
  private readonly title = el('span', 'fg-title');
  private mode: ForgeMode = 'enhance';
  /** The whetstone or Repair Kit kind (enhance, repair), or the agimat stack's uid (embed). */
  private tool = '';
  /** The gear in the item slot (its uid). */
  private item: string | null = null;
  private stones = 0;
  /** Keep the stone slot full after each try (it was filled). */
  private keepFull = false;
  private slot: number | null = null;
  private asking = false;
  private busy = false;
  private message: { text: string; ok: boolean } | null = null;
  /** Where to sit: left of this panel's box (the equipment panel or the bag). */
  besides: () => DOMRect | null = () => null;

  constructor(frame: { url: string; slice: number } | null, slot: { url: string; picked: string; slice: number } | null) {
    this.root.id = 'forge';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    if (frame) {
      this.root.classList.add('fg-framed');
      this.root.style.setProperty('--frame', `url("${frame.url}")`);
      this.root.style.setProperty('--slice', String(frame.slice));
    }
    if (slot) {
      this.root.style.setProperty('--slot', `url("${slot.url}")`);
      this.root.style.setProperty('--slot-picked', `url("${slot.picked}")`);
      this.root.style.setProperty('--slot-slice', String(slot.slice));
    }
    const head = el('div', 'fg-head');
    const close = el('button', 'fg-close', '×');
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.close());
    head.append(this.title, close);
    this.root.append(head, this.body);
    document.body.append(this.root);
    onAdventure(() => !this.root.hidden && this.render());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.root.hidden) {
        e.stopPropagation();
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Opens it with a whetstone or Repair Kit kind (enhance, repair) or an agimat stack (embed: its uid). */
  open(mode: ForgeMode, tool: string): void {
    if (this.mode !== mode || this.tool !== tool) {
      this.item = mode === this.mode ? this.item : null;
      this.stones = 0;
      this.keepFull = false;
      const kept = this.current();
      this.slot = mode === 'embed' && kept ? Math.max(0, kept.agimats.findIndex((a) => !a)) : null;
    }
    this.mode = mode;
    this.tool = tool;
    this.asking = false;
    this.message = null;
    this.root.hidden = false;
    playSound('click');
    this.render();
    this.fit();
  }

  close(): void {
    this.root.hidden = true;
    this.item = null;
    this.asking = false;
  }

  /** Beside the bag (left of the equipment panel where there's room, else over it). */
  fit(): void {
    if (this.root.hidden) return;
    if (matchMedia('(max-width: 900px)').matches) {
      for (const p of ['top', 'right']) this.root.style.removeProperty(p);
      return;
    }
    const r = this.besides();
    if (!r) return;
    this.root.style.top = `${Math.round(r.top)}px`;
    const right = innerWidth - r.left + 10;
    this.root.style.right = `${Math.round(right + this.root.offsetWidth > innerWidth - 8 ? Math.max(8, innerWidth - this.root.offsetWidth - 8) : right)}px`;
  }

  /** Puts a piece of gear (worn or in the bag) into the item slot; it bounces back (with why) if it doesn't fit. True
   *  if the popup was open to take it. */
  put(uid: string): boolean {
    if (this.root.hidden) return false;
    const D = itemData();
    const s = adventure();
    const found = s && findItem(s, uid);
    if (!D || !s || !found) return true;
    const why = this.refusal(found.item);
    if (why) {
      this.bounce(why);
      return true;
    }
    if (this.item !== uid || (this.mode === 'embed' && this.slot === null)) {
      this.item = uid;
      // Embed: the first empty slot to start with (else the first).
      this.slot = this.mode === 'embed' ? Math.max(0, found.item.agimats.findIndex((a) => !a)) : null;
      this.message = null;
      this.asking = false;
      if (this.mode === 'enhance' && this.keepFull) this.fillStones();
    }
    playSound('click');
    this.render();
    return true;
  }

  /** A whetstone stack dropped on the stone slot (enhance), or a tool dropped anywhere on it. */
  private putTool(uid: string): void {
    const it = adventure()?.bag.find((b) => b.uid === uid);
    const def = it && anyDef(it.defId);
    if (!it || !def || isGearDef(def)) return;
    if (def.kind === 'agimat') return this.open('embed', uid);
    if (def.forge === 'repairKit') return this.open('repair', def.id);
    if (def.forge !== 'whetstone') return this.bounce("That's not something the forge uses.");
    if (this.mode !== 'enhance' || this.tool !== def.id) this.open('enhance', def.id);
    this.keepFull = true;
    this.fillStones();
    playSound('click');
    this.render();
  }

  private refusal(item: Item): string | null {
    const D = itemData()!;
    if (this.mode === 'enhance') return enhanceRefusal(D, item, this.tool);
    if (this.mode === 'repair') return repairRefusal(D, item, this.tool);
    const ag = adventure()?.bag.find((b) => b.uid === this.tool);
    return ag ? embedRefusal(D, item, ag) : 'That agimat is gone.';
  }

  /** It doesn't go: the slot shakes and says why. */
  private bounce(why: string): void {
    playSound('error');
    toast(why.replace(/\.$/, ''), 2400, 'bad');
    const slot = this.root.querySelector<HTMLElement>('.fg-item');
    slot?.classList.remove('fg-refused');
    void slot?.offsetWidth;
    slot?.classList.add('fg-refused');
  }

  private current(): Item | null {
    const s = adventure();
    return (this.item && s && findItem(s, this.item)?.item) || null;
  }

  private fillStones(): void {
    const D = itemData();
    const it = this.current();
    const v = D && it ? enhanceView(D, it, adventure()!.bag) : null;
    this.stones = v ? Math.min(v.stones, v.have) : 0;
  }

  private dropTarget(node: HTMLElement, take: (kind: 'gear' | 'tool', uid: string) => void): void {
    const kinds = ['application/x-mk-equipment', 'application/x-mk-worn', 'application/x-mk-tool'];
    node.addEventListener('dragover', (e) => {
      if (!kinds.some((k) => e.dataTransfer?.types.includes(k))) return;
      e.preventDefault();
      node.classList.add('fg-over');
    });
    node.addEventListener('dragleave', () => node.classList.remove('fg-over'));
    node.addEventListener('drop', (e) => {
      node.classList.remove('fg-over');
      const gear = e.dataTransfer?.getData('application/x-mk-equipment') || e.dataTransfer?.getData('application/x-mk-worn');
      const tool = e.dataTransfer?.getData('application/x-mk-tool');
      if (!gear && !tool) return;
      e.preventDefault();
      e.stopPropagation();
      if (gear) take('gear', gear);
      else if (tool) take('tool', tool);
    });
  }

  private render(): void {
    const D = itemData();
    const s = adventure();
    if (!D || !s) return;
    this.title.textContent = this.mode === 'enhance' ? 'Enhance' : this.mode === 'repair' ? 'Repair' : 'Embed an agimat';
    this.root.dataset.mode = this.mode;
    const item = this.current();
    if (this.item && !item) this.item = null;
    const parts: HTMLElement[] = [];

    // The item slot (gear), and the tool's slot beside it.
    const row = el('div', 'fg-slots');
    const slot = el('button', `fg-slot fg-item${item ? ' fg-full' : ''}${item?.broken ? ' fg-broken' : ''}`);
    slot.setAttribute('aria-label', item ? nameOf(item) : 'Item slot: drag gear here');
    if (item) slot.append(itemPicture(item, 'showcase', 2));
    else slot.append(el('span', 'fg-hint', 'Drag gear here'));
    slot.addEventListener('click', () => {
      if (!item) return;
      this.item = null;
      this.render();
    });
    slot.title = item ? 'Click to take it out' : '';
    this.dropTarget(slot, (kind, uid) => (kind === 'gear' ? this.put(uid) : this.putTool(uid)));
    row.append(slot);
    const toolSlot = el('button', 'fg-slot fg-tool');
    this.dropTarget(toolSlot, (kind, uid) => (kind === 'gear' ? this.put(uid) : this.putTool(uid)));
    row.append(toolSlot);
    parts.push(row);
    const name = el('div', 'fg-name', item ? nameOf(item) : this.mode === 'embed' ? 'Drag a slotted weapon or armor piece in.' : this.mode === 'repair' ? 'Drag a broken item in.' : 'Drag a weapon, armor piece or accessory in.');
    if (item) name.style.color = item.broken ? '#9CA3AF' : RARITY_TEXT[rarityOf(item)];
    parts.push(name);

    if (this.mode === 'enhance') this.renderEnhance(toolSlot, item, parts);
    else if (this.mode === 'repair') this.renderRepair(toolSlot, item, parts);
    else this.renderEmbed(toolSlot, item, parts);
    if (this.message) parts.push(el('div', `fg-note${this.message.ok ? '' : ' fg-bad'}`, this.message.text));
    this.body.replaceChildren(...parts);
  }

  private toolPicture(defId: string, count: number): HTMLElement {
    const D = itemData()!;
    const def = D.defs.get(defId);
    const wrap = el('span', 'fg-tool-pic');
    if (def) wrap.append(itemPicture({ uid: '', defId, level: 1, rarity: def.rarity, plus: 0, broken: false, bound: false, luck: 0, agimats: [], lines: [], count }, 'showcase', 2));
    return wrap;
  }

  private renderEnhance(toolSlot: HTMLElement, item: Item | null, parts: HTMLElement[]): void {
    const D = itemData()!;
    const bag = adventure()!.bag;
    const def = D.defs.get(this.tool);
    const have = countOf(bag, this.tool);
    toolSlot.append(this.toolPicture(this.tool, have), el('span', 'fg-count', String(this.stones)));
    toolSlot.title = `Drag your ${def?.name ?? 'whetstones'} here, or use + and −`;
    const v = item ? enhanceView(D, item, bag) : null;
    if (item && !v) {
      const why = enhanceRefusal(D, item, this.tool);
      if (why) parts.push(el('div', 'fg-warn', why));
    }
    const need = v?.stones ?? 0;
    if (v && this.stones > Math.min(need, have)) this.stones = Math.min(need, have);
    // Whetstones in / needed, with + and −.
    const stones = el('div', 'fg-row fg-stones');
    const minus = el('button', 'fg-step', '−');
    const plus = el('button', 'fg-step', '+');
    minus.setAttribute('aria-label', 'One whetstone fewer');
    plus.setAttribute('aria-label', 'One whetstone more');
    minus.disabled = this.stones <= 0;
    plus.disabled = !v || this.stones >= Math.min(need, have);
    minus.addEventListener('click', () => {
      this.stones = Math.max(0, this.stones - 1);
      this.keepFull = false;
      this.render();
    });
    plus.addEventListener('click', () => {
      this.stones = Math.min(need, have, this.stones + 1);
      this.keepFull = this.stones >= need;
      this.render();
    });
    const label = el('span', 'fg-label');
    label.append('Whetstones ', el('b', 'fg-num', `${this.stones} / ${v ? need : '–'}`));
    stones.append(minus, label, plus);
    parts.push(stones, el('div', 'fg-have', `You have ${have.toLocaleString()} ${def?.name ?? 'whetstone'}${have === 1 ? '' : 's'}`));
    if (!v) return this.enhanceButton(parts, false);
    const odds = el('div', 'fg-row fg-odds');
    odds.append(el('span', 'fg-label', `Success to +${v.target}`), el('b', 'fg-num fg-chance', pct(v.chance)));
    parts.push(odds);
    if (v.luck > 0) parts.push(el('div', 'fg-luck', `Luck +${Math.round(v.luck * 100)}%`));
    for (const n of v.next) parts.push(el('div', 'fg-next', nextLine(n)));
    if (v.breaks) parts.push(el('div', 'fg-warn', `A fail now breaks it (it keeps its +; fix it with ${/^[aeiou]/i.test(toolName(D, 'repairKit', gearTier(D.stats, item!.level))) ? 'an' : 'a'} ${toolName(D, 'repairKit', gearTier(D.stats, item!.level))}).`));
    this.enhanceButton(parts, this.stones >= need && have >= need);
  }

  private enhanceButton(parts: HTMLElement[], ready: boolean): void {
    const b = el('button', 'fg-go', this.busy ? 'Enhancing…' : 'Enhance');
    b.disabled = !ready || this.busy;
    b.classList.toggle('fg-ready', ready);
    b.addEventListener('click', () => void this.run({ action: 'enhance', item: this.item!, tool: this.tool }));
    parts.push(b);
  }

  private renderRepair(toolSlot: HTMLElement, item: Item | null, parts: HTMLElement[]): void {
    const D = itemData()!;
    const have = countOf(adventure()!.bag, this.tool);
    const def = D.defs.get(this.tool);
    toolSlot.append(this.toolPicture(this.tool, have), el('span', 'fg-count', String(have ? 1 : 0)));
    const row = el('div', 'fg-row');
    const label = el('span', 'fg-label');
    label.append('Repair Kits ', el('b', 'fg-num', `${have ? 1 : 0} / 1`));
    row.append(label);
    parts.push(row, el('div', 'fg-have', `You have ${have} ${def?.name ?? 'Repair Kit'}${have === 1 ? '' : 's'}`));
    const why = item ? repairRefusal(D, item, this.tool) : null;
    if (why && !this.message?.ok) parts.push(el('div', 'fg-warn', why)); // (not right after repairing it)
    const ready = !!item && !why && have > 0;
    const b = el('button', 'fg-go', this.busy ? 'Repairing…' : 'Repair');
    b.disabled = !ready || this.busy;
    b.classList.toggle('fg-ready', ready);
    b.addEventListener('click', () => void this.run({ action: 'repair', item: this.item!, tool: this.tool }));
    parts.push(b);
  }

  private renderEmbed(toolSlot: HTMLElement, item: Item | null, parts: HTMLElement[]): void {
    const D = itemData()!;
    const ag = adventure()!.bag.find((b) => b.uid === this.tool);
    if (!ag?.stat) {
      parts.push(el('div', 'fg-warn', 'No more of that agimat: pick another in your bag.'));
      return;
    }
    toolSlot.append(itemPicture(ag, 'showcase', 2), el('span', 'fg-count', String(ag.count)));
    const what = el('div', 'fg-agimat');
    const name = el('b', undefined, nameOf({ ...ag, count: 1 }));
    name.style.color = RARITY_TEXT[rarityOf(ag)];
    what.append(name, el('span', 'fg-next', lineText(ag.stat, agimatValue(D.stats, ag.stat, ag.level))));
    parts.push(what);
    if (!item) return;
    // The slot dots: pick one.
    const dots = el('div', 'fg-dots');
    item.agimats.forEach((a, i) => {
      const b = el('button', `fg-dot${a ? ' fg-dot-on' : ''}${this.slot === i ? ' fg-dot-picked' : ''}`);
      b.append((a && agimatIcon(a.stat, a.level)) || el('span', 'fg-dot-mark'), el('span', undefined, a ? `${lineText(a.stat, agimatValue(D.stats, a.stat, a.level))} (Lv ${a.level})` : 'Empty slot'));
      b.addEventListener('click', () => {
        this.slot = i;
        this.asking = false;
        this.message = null;
        this.render();
      });
      dots.append(b);
    });
    parts.push(dots);
    const why = this.slot === null ? 'Pick a slot.' : embedRefusal(D, item, ag, this.slot);
    if (why) parts.push(el('div', 'fg-warn', why));
    if (this.asking && this.slot !== null) {
      const old = item.agimats[this.slot];
      parts.push(el('div', 'fg-warn', `That slot has ${old ? lineText(old.stat, agimatValue(D.stats, old.stat, old.level)) : 'an agimat'}. Put this one in its place? The old agimat breaks.`));
      const row = el('div', 'fg-actions');
      const yes = el('button', 'fg-go fg-ready fg-danger', 'Replace it');
      yes.disabled = this.busy;
      yes.addEventListener('click', () => void this.run({ action: 'embed', item: item.uid, agimat: ag.uid, slot: this.slot!, replace: true }));
      const no = el('button', 'fg-go', 'Cancel');
      no.addEventListener('click', () => ((this.asking = false), this.render()));
      row.append(yes, no);
      parts.push(row);
      return;
    }
    const b = el('button', 'fg-go', this.busy ? 'Embedding…' : 'Embed');
    b.disabled = !!why || this.busy;
    b.classList.toggle('fg-ready', !why);
    b.addEventListener('click', () => void this.run({ action: 'embed', item: item.uid, agimat: ag.uid, slot: this.slot!, replace: false }));
    parts.push(b);
    parts.push(el('div', 'fg-have', 'Embedding is for good.'));
  }

  private async run(a: TownForgeAction): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    const r = await forgeAction(a);
    this.busy = false;
    const slot = this.root.querySelector<HTMLElement>('.fg-item') ?? this.root;
    if (!r) {
      playSound('error');
      this.message = { text: "Couldn't reach the bot. Try again in a moment.", ok: false };
      return this.render();
    }
    if (r.confirm) {
      this.asking = true;
      return this.render();
    }
    this.asking = false;
    this.message = { text: r.message, ok: r.ok && r.outcome !== 'fail' && r.outcome !== 'break' };
    if (!r.ok) playSound('error');
    if (r.outcome === 'success') {
      playSound('combat-enhance-success');
      playForgeFx(art.success, slot);
    } else if (r.outcome === 'fail') {
      playSound('combat-enhance-fail');
      playForgeFx(art.fail, slot);
    } else if (r.outcome === 'break') {
      playSound('combat-enhance-break');
      playForgeFx(art.break, slot);
      slot.classList.remove('fg-broke');
      void slot.offsetWidth;
      slot.classList.add('fg-broke');
    } else if (r.outcome === 'repaired') {
      playSound('combat-repair');
      playForgeFx(art.success, slot);
    } else if (r.outcome === 'embedded') {
      playSound('combat-agimat-embed');
      playForgeFx(art.embed, this.root.querySelector<HTMLElement>('.fg-dot-picked') ?? slot);
    }
    if (this.mode === 'enhance' && this.keepFull) this.fillStones();
    else if (this.mode === 'enhance') this.stones = 0;
    if (r.outcome && r.outcome !== 'fail') window.dispatchEvent(new Event('mk-wallet')); // the bag redraws
    this.render();
  }
}

// ── The forge's single popup (the bag makes it) ──

let popup: ForgePopup | null = null;
export const mountForge = (frame: { url: string; slice: number } | null, slot: { url: string; picked: string; slice: number } | null) => (popup ??= new ForgePopup(frame, slot));
export const forgePopup = () => popup;

/** Gear clicked while the popup is open goes into it (true: it took the click). */
export const forgeTake = (uid: string): boolean => !!popup?.put(uid);

// ── Taking gear apart (the bag's right-click menu) ──

/** What taking an item apart gives back, as lines for the confirm box. */
export function disassemblyLines(item: Item): { gives: string[]; warn: string[] } {
  const D = itemData();
  if (!D) return { gives: [], warn: [] };
  const y = disassemblyYield(D, item);
  const gives: string[] = [];
  if (y.fragment) gives.push(`${y.fragments.toLocaleString()} ${y.fragment.name}${y.fragments === 1 ? '' : 's'} (${fragmentsPerWhetstone(D.stats)} make a ${toolFor(D, 'whetstone', y.fragment.tier ?? null)?.name ?? 'whetstone'})`);
  const SLOT: Record<string, string> = { weapon: 'Weapon', head: 'Head', body: 'Body', hands: 'Hands', bottoms: 'Bottoms', feet: 'Feet' };
  if (y.agimat) gives.push(`1 agimat, Lv ${y.agimat.level}, ${SLOT[y.agimat.lock] ?? y.agimat.lock} only (its stat is rolled${y.agimat.rareTimes > 1 ? `; two slots: the rare ones ${y.agimat.rareTimes}× as likely` : ''})`);
  const warn: string[] = [];
  if (y.destroys.length) warn.push(`Its agimats are destroyed: ${y.destroys.map((a) => `${lineText(a.stat, agimatValue(D.stats, a.stat, a.level))} (Lv ${a.level})`).join(', ')}.`);
  if (item.plus) warn.push(`Its +${item.plus} is lost (the fragments give back part of it).`);
  warn.push("This can't be undone.");
  return { gives, warn };
}

/** The confirm box: what comes back and what's lost; Disassemble or Cancel. Resolves true if confirmed. */
export function confirmDisassemble(item: Item): Promise<boolean> {
  return new Promise((resolve) => {
    const { gives, warn } = disassemblyLines(item);
    const back = el('div', 'fg-confirm-back');
    const box = el('div', 'fg-confirm');
    box.setAttribute('role', 'alertdialog');
    const title = el('div', 'fg-confirm-title');
    title.append('Take apart ', Object.assign(el('b', undefined, nameOf(item)), { style: `color: ${RARITY_TEXT[rarityOf(item)]}` }), '?');
    const list = el('ul', 'fg-confirm-list');
    for (const g of gives) list.append(el('li', undefined, g));
    const warns = warn.map((w) => el('div', 'fg-warn', w));
    const row = el('div', 'fg-actions');
    const yes = el('button', 'fg-go fg-ready fg-danger', 'Disassemble');
    const no = el('button', 'fg-go', 'Cancel');
    const done = (ok: boolean) => {
      back.remove();
      document.removeEventListener('keydown', key, true);
      resolve(ok);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        done(false);
      }
    };
    yes.addEventListener('click', () => done(true));
    no.addEventListener('click', () => done(false));
    back.addEventListener('click', (e) => e.target === back && done(false));
    document.addEventListener('keydown', key, true);
    row.append(yes, no);
    box.append(title, el('div', 'fg-confirm-sub', 'You get back:'), list, ...warns, row);
    back.append(box);
    document.body.append(back);
    yes.focus();
  });
}

/** The Sell box for training gear: "Sell <name> for N Kusing?" (bound gear: it's gone for good). Resolves true if confirmed. */
export function confirmSell(item: Item, price: number): Promise<boolean> {
  return new Promise((resolve) => {
    const back = el('div', 'fg-confirm-back');
    const box = el('div', 'fg-confirm');
    box.setAttribute('role', 'alertdialog');
    const title = el('div', 'fg-confirm-title');
    title.append('Sell ', item.count > 1 ? `${item.count}× ` : '', Object.assign(el('b', undefined, nameOf({ ...item, count: 1 })), { style: `color: ${RARITY_TEXT[rarityOf(item)]}` }), ` for ${price.toLocaleString()} Kusing?`);
    const row = el('div', 'fg-actions');
    const yes = el('button', 'fg-go fg-ready', 'Sell');
    const no = el('button', 'fg-go', 'Cancel');
    const done = (ok: boolean) => {
      back.remove();
      document.removeEventListener('keydown', key, true);
      resolve(ok);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        done(false);
      }
    };
    yes.addEventListener('click', () => done(true));
    no.addEventListener('click', () => done(false));
    back.addEventListener('click', (e) => e.target === back && done(false));
    document.addEventListener('keydown', key, true);
    row.append(yes, no);
    box.append(title, el('div', 'fg-warn', isGearDef(anyDef(item.defId)) ? 'Training gear is bound: once sold it’s gone.' : 'Once sold it’s gone.'), row);
    back.append(box);
    document.body.append(back);
    yes.focus();
  });
}

/** A confirm box for several items at once (the bag's multi-select): the title, the items by name (in their rarity's
 *  colour, a scrolling list), what comes back, warnings, and the button. Resolves true if confirmed. */
function confirmMany(title: string, items: Item[], gives: string[], warn: string[], yesLabel: string, danger: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const back = el('div', 'fg-confirm-back');
    const box = el('div', 'fg-confirm');
    box.setAttribute('role', 'alertdialog');
    const names = el('ul', 'fg-confirm-names');
    for (const it of items) {
      const li = el('li', undefined, `${it.count > 1 ? `${it.count}× ` : ''}${nameOf({ ...it, count: 1 })}`);
      li.style.color = RARITY_TEXT[rarityOf(it)];
      names.append(li);
    }
    const list = el('ul', 'fg-confirm-list');
    for (const g of gives) list.append(el('li', undefined, g));
    const row = el('div', 'fg-actions');
    const yes = el('button', `fg-go fg-ready${danger ? ' fg-danger' : ''}`, yesLabel);
    const no = el('button', 'fg-go', 'Cancel');
    const done = (ok: boolean) => {
      back.remove();
      document.removeEventListener('keydown', key, true);
      resolve(ok);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        done(false);
      }
    };
    yes.addEventListener('click', () => done(true));
    no.addEventListener('click', () => done(false));
    back.addEventListener('click', (e) => e.target === back && done(false));
    document.addEventListener('keydown', key, true);
    row.append(yes, no);
    box.append(el('div', 'fg-confirm-title', title), names, ...(gives.length ? [el('div', 'fg-confirm-sub', 'You get back:'), list] : []), ...warn.map((w) => el('div', 'fg-warn', w)), row);
    back.append(box);
    document.body.append(back);
    yes.focus();
  });
}

/** Taking several pieces apart: their fragments added up by kind, how many agimats come back (each rolled, locked to
 *  its piece's slot), and what's lost. */
export function confirmDisassembleMany(items: Item[]): Promise<boolean> {
  const D = itemData();
  if (!D) return Promise.resolve(false);
  const frags = new Map<string, number>();
  let agimats = 0;
  let destroyed = 0;
  let plussed = 0;
  for (const it of items) {
    const y = disassemblyYield(D, it);
    if (y.fragment) frags.set(y.fragment.name, (frags.get(y.fragment.name) ?? 0) + y.fragments);
    if (y.agimat) agimats++;
    destroyed += y.destroys.length;
    if (it.plus) plussed++;
  }
  const gives = [
    ...[...frags].map(([name, n]) => `${n.toLocaleString()} ${name}${n === 1 ? '' : 's'}`),
    ...(agimats ? [`${agimats} agimat${agimats === 1 ? '' : 's'} (each rolled, locked to its piece's slot)`] : []),
  ];
  const warn = [
    ...(destroyed ? [`${destroyed} agimat${destroyed === 1 ? '' : 's'} set in them ${destroyed === 1 ? 'is' : 'are'} destroyed.`] : []),
    ...(plussed ? [`${plussed} of them ${plussed === 1 ? 'has a + that is' : 'have a + that is'} lost (the fragments give back part of it).`] : []),
    "This can't be undone.",
  ];
  return confirmMany(`Take apart ${items.length} item${items.length === 1 ? '' : 's'}?`, items, gives, warn, 'Disassemble', true);
}

/** Selling several (training gear, agimats) for their Kusing added up. */
export function confirmSellMany(items: Item[], total: number): Promise<boolean> {
  return confirmMany(`Sell ${items.length} item${items.length === 1 ? '' : 's'} for ${total.toLocaleString()} Kusing?`, items, [], ['Once sold they’re gone.'], 'Sell', false);
}

/** The Combine box: the fragments going in (their icon ×how many) » the whetstones they make (icon ×how many), and any
 *  left over; Combine or Cancel (just OK while there aren't enough). Resolves true if confirmed. */
export function confirmCombine(item: Item): Promise<boolean> {
  return new Promise((resolve) => {
    const D = itemData();
    const def = anyDef(item.defId);
    if (!D || !def || isGearDef(def)) return resolve(false);
    const per = fragmentsPerWhetstone(D.stats);
    const stone = toolFor(D, 'whetstone', def.tier ?? null);
    const have = countOf(adventure()?.bag ?? [], item.defId);
    const n = Math.floor(have / per);
    const back = el('div', 'fg-confirm-back');
    const box = el('div', 'fg-confirm');
    box.setAttribute('role', 'alertdialog');
    const side = (it: Item, count: number, name: string) => {
      const s = el('div', 'fg-combine-side');
      s.append(itemPicture({ ...it, count: 1 }, 'showcase', 2), el('b', 'fg-combine-n', `×${count.toLocaleString()}`), el('span', 'fg-combine-name', name));
      return s;
    };
    const flow = el('div', `fg-combine${n ? '' : ' fg-combine-short'}`);
    flow.append(side(item, n ? n * per : have, def.name), el('span', 'fg-combine-arrow', '»»»'));
    if (stone) flow.append(side(newItem(D.stats, stone, 'combine-preview', Math.max(1, n)), n, stone.name));
    const notes: HTMLElement[] = [];
    if (!n) notes.push(el('div', 'fg-warn', `It takes ${per} fragments to make a ${stone?.name ?? 'whetstone'}: you have ${have}.`));
    else if (have - n * per) notes.push(el('div', 'fg-confirm-sub', `${have - n * per} fragment${have - n * per === 1 ? '' : 's'} left over.`));
    const row = el('div', 'fg-actions');
    const yes = el('button', 'fg-go fg-ready', n ? 'Combine' : 'OK');
    const no = el('button', 'fg-go', 'Cancel');
    const done = (ok: boolean) => {
      back.remove();
      document.removeEventListener('keydown', key, true);
      resolve(ok);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        done(false);
      }
    };
    yes.addEventListener('click', () => done(n > 0));
    no.addEventListener('click', () => done(false));
    back.addEventListener('click', (e) => e.target === back && done(false));
    document.addEventListener('keydown', key, true);
    row.append(yes, ...(n ? [no] : []));
    box.append(el('div', 'fg-confirm-title', 'Combine fragments?'), flow, ...notes, row);
    back.append(box);
    document.body.append(back);
    yes.focus();
  });
}

/** Takes an item apart (asked first) or combines fragments: the server's answer, with the effect and sound. */
export async function forgeFromBag(a: Extract<TownForgeAction, { action: 'disassemble' | 'combine' | 'sell' | 'disassemble-many' | 'sell-many' }>, at: HTMLElement | null): Promise<TownForgeResponse | null> {
  const where = at?.getBoundingClientRect(); // (the slot is gone once the bag redraws)
  const r = await forgeAction(a);
  if (!r) {
    playSound('error');
    toast("Couldn't reach the bot. Try again in a moment.", 2400, 'bad');
    return null;
  }
  if (!r.ok) {
    playSound('error');
    toast(r.message.replace(/\.$/, ''), 2600, 'bad');
    return r;
  }
  if (r.outcome === 'disassembled') {
    playSound('combat-disassemble');
    if (where) playForgeFx(art.disassemble, where);
  } else playSound(r.outcome === 'sold' ? 'combat-coins' : 'click');
  toast(r.message.replace(/\.$/, ''), 3200, 'good');
  return r;
}
