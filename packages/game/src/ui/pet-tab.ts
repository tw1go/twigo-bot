import { type AdventureState, type Item, type PetNode, type PetRules, PET_NODES, PET_NODE_NAMES, boxOpens, isGearDef, nodeOpen, nodePoints, nodeText, petPointsLeft, petXp, petXpToNext } from '@mikazuki/shared';
import { adventure, anyDef, itemData, petAct, pets } from '../net/adventure';
import { playSound } from '../audio/sound';
import { RARITY_COLOUR, RARITY_TEXT } from './item-art';
import { chatItem, itemKeys, itemPicture, itemTipFor, nameOf, rarityOf } from './item-tip';
import { toast } from './toast';

// 🐾 The Equipment panel's Pet tab (CONTEXT.md "Pets"): the pet slot (a bound pet from the bag, dragged in or
// double-clicked; a pet box is refused: "Open the box first"; double-click or right-click the pet out to call it back),
// its name, level, Pet XP bar ("MAX" at the cap) and pet points, then its pet tree, Mac's layout:
//
//   HP  ──┐
//         ├─> ATK ──┬─> Attack rate ──> Damage amp
//   DEF ──┘         └─> Crit rate ───> Crit damage
//
// Each node is its art (pets/tree/ui-pet-node-<stat>.png, the matching agimat's inscription; -locked until every node it
// needs is at its max) with n/max under it; a click (or its +) spends a pet point; the lines into a node light once its
// way is open. Reset gives every point back, free. The numbers are stats.json `pets` (shared pets.ts); the server
// (POST /town/pet) decides. Also here: opening a pet box from the bag (a confirm: it binds), and sending a pet out.

/** Where each node sits (its top-left, px) and the lines between them (each into the node that needs the other). */
const NODE = 32;
const AT: Record<PetNode, [number, number]> = { hp: [0, 0], def: [0, 64], atk: [80, 32], atkRate: [160, 0], critRate: [160, 64], amp: [240, 0], critDmg: [240, 64] };
const WIDTH = 272;
const HEIGHT = 112;

/** The art for each node (manifest pets.node / nodeLocked with its stat word). */
export interface PetArt {
  node: (node: PetNode, locked: boolean) => string;
}

/** Opens a pet box from the bag, once they've said yes (the pet binds to this character). */
export async function openBox(it: Item): Promise<void> {
  const D = itemData();
  const pet = D ? boxOpens(D, it) : null;
  if (!pet || !(await confirmOpen(it, pet.id))) return;
  const r = await petAct({ action: 'open', item: it.uid });
  if (!r?.ok) {
    playSound('error');
    return void toast(r?.message?.replace(/\.$/, '') ?? "Couldn't reach the bot", 2400, 'bad');
  }
  playSound('coin');
  toast(r.message ?? `${pet.name} is yours!`, 2600, 'good');
  window.dispatchEvent(new Event('mk-wallet')); // the bag redraws
}

/** The open box: the box »»» its pet, the binding said plainly; Open or Cancel. */
function confirmOpen(box: Item, petDefId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const D = itemData();
    const back = el('div', 'fg-confirm-back');
    const dlg = el('div', 'fg-confirm');
    dlg.setAttribute('role', 'alertdialog');
    const title = el('div', 'fg-confirm-title', 'Open the pet box?');
    const side = (it: Item, name: string) => {
      const s = el('div', 'fg-combine-side');
      s.append(itemPicture({ ...it, count: 1 }, 'showcase', 2), el('span', 'fg-combine-name', name));
      return s;
    };
    const flow = el('div', 'fg-combine');
    const petDef = anyDef(petDefId);
    flow.append(side(box, anyDef(box.defId)?.name ?? 'Pet Box'), el('span', 'fg-combine-arrow', '»»»'));
    if (D && petDef) flow.append(side({ ...box, defId: petDefId, uid: 'pet-preview', rarity: petDef.rarity }, petDef.name));
    const warn = el('div', 'fg-warn', 'The pet will be bound to this character: it can’t be traded, sold or dropped.');
    const row = el('div', 'fg-actions');
    const yes = el('button', 'fg-go fg-ready', 'Open');
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
    dlg.append(title, flow, warn, row);
    back.append(dlg);
    document.body.append(back);
    yes.focus();
  });
}

/** A pet's name colour. */
const petColour = (it: Item) => RARITY_TEXT[rarityOf(it)];

export class PetTab {
  readonly root = el('div', 'pt-root');
  private readonly slot = el('button', 'eq-slot pt-slot');
  private readonly info = el('div', 'pt-info');
  private readonly tree = el('div', 'pt-tree');
  private readonly foot = el('div', 'pt-foot');
  private busy = false;

  constructor(
    private readonly art: PetArt | null,
    /** The panel's tooltip: shown beside `at` with these lines, or hidden (null). */
    private readonly tip: (lines: HTMLElement[] | null, at?: HTMLElement) => void,
  ) {
    const top = el('div', 'pt-top');
    top.append(this.slot, this.info);
    this.tree.style.width = `${WIDTH}px`;
    this.tree.style.height = `${HEIGHT}px`;
    this.root.append(top, el('div', 'pt-tree-title', 'Pet tree'), this.tree, this.foot);
    const s = this.slot;
    s.setAttribute('aria-label', 'Pet slot');
    s.addEventListener('dblclick', () => void this.callBack());
    s.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      void this.callBack();
    });
    s.addEventListener('click', (e) => {
      const pet = adventure()?.pet;
      if (pet && e.altKey) chatItem(pet);
    });
    s.addEventListener('pointerenter', () => this.slotTip());
    s.addEventListener('pointerleave', () => this.tip(null));
    s.addEventListener('dragover', (e) => {
      const t = e.dataTransfer?.types ?? [];
      if (!t.some((x) => x.startsWith('application/x-mk-'))) return;
      e.preventDefault();
      s.classList.add('eq-over');
    });
    s.addEventListener('dragleave', () => s.classList.remove('eq-over'));
    s.addEventListener('drop', (e) => {
      s.classList.remove('eq-over');
      const d = e.dataTransfer;
      if (!d) return;
      e.preventDefault();
      const pet = d.getData('application/x-mk-pet');
      if (pet) return void this.sendOut(pet);
      if (d.getData('application/x-mk-petbox')) return this.refuse('Open the box first');
      this.refuse("That isn't a pet");
    });
  }

  /** Sends a pet out from the bag (by uid): the one out goes back. Refused in a fight and within the swap cooldown (the
   *  server says so). */
  async sendOut(uid: string): Promise<void> {
    const it = adventure()?.bag.find((b) => b.uid === uid);
    const def = anyDef(it?.defId);
    if (!it || this.busy) return;
    if (def && !isGearDef(def) && def.opens) return this.refuse('Open the box first');
    if (!def || isGearDef(def) || def.kind !== 'pet') return this.refuse("That isn't a pet");
    this.busy = true;
    const r = await petAct({ action: 'out', item: uid });
    this.busy = false;
    if (!r?.ok) return this.refuse(r?.message?.replace(/\.$/, '') ?? "Couldn't reach the bot");
    playSound('click');
    window.dispatchEvent(new Event('mk-wallet'));
  }

  private async callBack(): Promise<void> {
    if (this.busy || !adventure()?.pet) return;
    this.busy = true;
    const r = await petAct({ action: 'back' });
    this.busy = false;
    if (!r?.ok) return this.refuse(r?.message?.replace(/\.$/, '') ?? "Couldn't reach the bot");
    playSound('click');
    this.tip(null);
    window.dispatchEvent(new Event('mk-wallet'));
  }

  private async spend(node: PetNode | null): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const r = await petAct(node ? { action: 'spend', node } : { action: 'reset' });
    this.busy = false;
    if (!r?.ok) {
      playSound('error');
      return void toast(r?.message?.replace(/\.$/, '') ?? "Couldn't reach the bot", 2200, 'bad');
    }
    playSound('click');
  }

  private refuse(why: string): void {
    playSound('error');
    this.slot.classList.remove('eq-refused');
    void this.slot.offsetWidth;
    this.slot.classList.add('eq-refused');
    toast(why, 2200, 'bad');
  }

  private slotTip(): void {
    const pet = adventure()?.pet;
    this.tip(pet ? [...itemTipFor(pet), itemKeys(pet, 'worn')] : [el('div', 'eq-tip-name', 'Pet')], this.slot);
  }

  render(s: AdventureState): void {
    const R = pets();
    const pet = s.pet ?? null;
    this.slot.replaceChildren();
    this.slot.classList.toggle('eq-worn', !!pet);
    this.slot.setAttribute('aria-label', pet ? `Pet: ${nameOf(pet)}` : 'Pet slot (empty)');
    if (pet) {
      this.slot.style.setProperty('--rarity', RARITY_COLOUR[rarityOf(pet)]);
      this.slot.append(itemPicture(pet, 'showcase', 2));
    }
    this.info.replaceChildren();
    if (!pet || !R) {
      this.info.append(el('div', 'pt-hint', 'Drag a pet here. Pet boxes are sold at the sari-sari store.'));
      this.tree.hidden = true;
      this.foot.replaceChildren();
      (this.root.querySelector('.pt-tree-title') as HTMLElement).hidden = true;
      return;
    }
    (this.root.querySelector('.pt-tree-title') as HTMLElement).hidden = false;
    this.tree.hidden = false;
    const name = el('div', 'pt-name', nameOf(pet));
    name.style.color = petColour(pet);
    const next = petXpToNext(R, pet.level);
    const bar = el('div', 'pt-xp');
    const fill = el('span', 'pt-xp-fill');
    fill.style.width = next ? `${Math.min(100, (petXp(pet) / next) * 100)}%` : '100%';
    bar.classList.toggle('pt-max', !next);
    bar.append(fill, el('span', 'pt-xp-text', next ? `${petXp(pet).toLocaleString()} / ${next.toLocaleString()}` : 'MAX'));
    bar.title = next ? 'Pet XP: your hits on monsters while it’s out (the monster’s level, at most once a second)' : 'Lv 20: the most a pet reaches';
    const left = petPointsLeft(R, pet);
    this.info.append(name, el('div', 'pt-level', `Lv ${pet.level}`), bar, el('div', `pt-points${left ? ' pt-points-on' : ''}`, `Pet points: ${left}`));
    this.renderTree(R, pet, left);
    const reset = el('button', 'eq-reset', 'Reset');
    reset.title = 'Get every pet point back (free)';
    reset.disabled = !Object.values(pet.points ?? {}).some((n) => n);
    reset.addEventListener('click', () => void this.spend(null));
    this.foot.replaceChildren(el('span', 'pt-foot-hint', 'Click a node to spend a pet point.'), reset);
  }

  private renderTree(R: PetRules, pet: Item, left: number): void {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'pt-lines');
    svg.setAttribute('width', String(WIDTH));
    svg.setAttribute('height', String(HEIGHT));
    // A line from each node it needs into it: right of the one, an elbow half-way, into its left.
    for (const node of PET_NODES) {
      const [tx, ty] = AT[node];
      for (const from of R.tree[node].requires) {
        const [fx, fy] = AT[from];
        const x0 = fx + NODE;
        const y0 = fy + NODE / 2;
        const y1 = ty + NODE / 2;
        const mid = Math.round((x0 + tx) / 2);
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('d', `M${x0} ${y0} H${mid} V${y1} H${tx}`);
        path.setAttribute('class', nodePoints(pet, from) >= R.tree[from].max ? 'pt-line pt-lit' : 'pt-line');
        svg.append(path);
      }
    }
    const nodes = PET_NODES.map((node) => {
      const rule = R.tree[node];
      const n = nodePoints(pet, node);
      const open = nodeOpen(R, pet, node);
      const can = open && n < rule.max && left > 0;
      const b = el('button', `pt-node${open ? '' : ' pt-locked'}${n >= rule.max ? ' pt-full' : ''}${can ? ' pt-can' : ''}`);
      b.style.left = `${AT[node][0]}px`;
      b.style.top = `${AT[node][1]}px`;
      b.setAttribute('aria-label', `${PET_NODE_NAMES[node]} ${n}/${rule.max}${open ? '' : ' (locked)'}`);
      const src = this.art?.node(node, !open);
      if (src) b.append(Object.assign(el('img', 'pt-node-art'), { src, alt: '', draggable: false }));
      else b.append(el('span', 'pt-node-word', PET_NODE_NAMES[node].slice(0, 3)));
      if (can) b.append(el('span', 'pt-plus', '+'));
      b.append(el('span', 'pt-count', `${n}/${rule.max}`));
      b.addEventListener('click', () => {
        if (can) return void this.spend(node);
        playSound('error');
        toast(!open ? `Needs ${rule.requires.map((r) => `${PET_NODE_NAMES[r]} ${R.tree[r].max}/${R.tree[r].max}`).join(' and ')} first` : n >= rule.max ? `${PET_NODE_NAMES[node]} is maxed` : 'No pet points left', 2000, 'bad');
      });
      b.addEventListener('pointerenter', () => this.tip(this.nodeTip(R, pet, node), b));
      b.addEventListener('pointerleave', () => this.tip(null));
      return b;
    });
    this.tree.replaceChildren(svg, ...nodes);
  }

  /** A node's card: its stat, what a point gives, its total now, and what opens it (or what it opens). */
  private nodeTip(R: PetRules, pet: Item, node: PetNode): HTMLElement[] {
    const rule = R.tree[node];
    const n = nodePoints(pet, node);
    const lines = [el('div', 'eq-tip-name', PET_NODE_NAMES[node]), el('div', 'eq-tip-line', `${nodeText(R, node, 1)} a point (up to ${nodeText(R, node, rule.max)})`), el('div', 'eq-tip-line', `Now: ${n ? nodeText(R, node, n) : 'nothing'} (${n}/${rule.max})`)];
    if (rule.requires.length) {
      const need = el('div', 'eq-tip-line', `Unlocks with ${rule.requires.map((r) => `${PET_NODE_NAMES[r]} ${R.tree[r].max}/${R.tree[r].max}`).join(' and ')}`);
      if (!nodeOpen(R, pet, node)) need.classList.add('eq-tip-need');
      lines.push(need);
    }
    const opens = PET_NODES.filter((x) => R.tree[x].requires.includes(node));
    if (opens.length) lines.push(el('div', 'eq-tip-sub', `At ${rule.max}/${rule.max} it opens ${opens.map((x) => PET_NODE_NAMES[x]).join(' and ')}.`));
    return lines;
  }
}

/** The pet item's name, Lv, Pet XP and points per node, for its tooltip (ui/item-tip.ts). */
export function petTipLines(pet: Item): HTMLElement[] {
  const R = pets();
  if (!R) return [];
  const next = petXpToNext(R, pet.level);
  const out = [el('div', 'eq-tip-line', `Lv ${pet.level} · ${next ? `Pet XP ${petXp(pet).toLocaleString()} / ${next.toLocaleString()}` : 'MAX'}`)];
  const spent = PET_NODES.filter((n) => nodePoints(pet, n) > 0);
  for (const n of spent) out.push(el('div', 'eq-tip-line', `${nodeText(R, n, nodePoints(pet, n))} (${nodePoints(pet, n)}/${R.tree[n].max})`));
  const left = petPointsLeft(R, pet);
  if (left) out.push(el('div', 'eq-tip-sub', `${left} pet point${left === 1 ? '' : 's'} to spend`));
  const kind = (() => {
    const def = anyDef(pet.defId);
    return def && !isGearDef(def) && def.pet ? R.list[def.pet] : undefined;
  })();
  if (kind?.bonus?.dropRate) out.push(el('div', 'eq-tip-line', `+${kind.bonus.dropRate}% Drop rate (always)`));
  return out;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
