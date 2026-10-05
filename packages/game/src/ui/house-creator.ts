import type { HouseLook } from '@mikazuki/shared';
import { type HouseArt, comboLook, houseStyles, swatchKind, swatchShades, tidyLook } from '../houses/art';

// 🏠 The house creator: the character creator's box (same look, #creator) with the house on the left and the choices
// on the right: the house type, a colour scheme (the art's combos), then a swatch per part. First time in the
// neighbourhood it builds your house (free); later, from your house's menu, it gives it a new look (costs Kowens; ×,
// Escape or a click outside closes it). DOM text only.

export interface HouseCreatorHooks {
  art: HouseArt;
  initial: HouseLook | null;
  /** The house drawn in a look (null until its layers have loaded). */
  draw: (look: HouseLook) => HTMLCanvasElement | null;
  /** Builds or repaints; what to say after. */
  save: (look: HouseLook) => Promise<{ ok: boolean; message: string }>;
  /** A new look costs this (0 = building your first house). */
  cost: number;
  kowens: number;
  /** Only when repainting: closes without saving. */
  onClose?: () => void;
  frame: { url: string; slice: number } | null;
}

const NAMES: Record<string, string> = { kubo: 'Bahay kubo', cottage: 'Cottage', townhouse: 'Townhouse', modern: 'Modern', aframe: 'A-frame' };
/** "flowerbox" → "Flower box", and the like. */
const PART: Record<string, string> = { flowerbox: 'Flower box', aframe: 'A-frame' };
const label = (s: string) => PART[s] ?? s.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
/** Parts in the order they're offered (the rest follow alphabetically). */
const ORDER = ['walls', 'roof', 'door', 'windows', 'trim', 'upper', 'terrace', 'balcony', 'deck', 'stilts', 'shutter', 'stairs', 'step', 'flowerbox', 'planter', 'plants', 'chimney', 'base'];
const PREVIEW_ZOOM = 2;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const same = (a: HouseLook, b: HouseLook) => a.style === b.style && JSON.stringify(a.colours) === JSON.stringify(b.colours);

export function mountHouseCreator(h: HouseCreatorHooks): void {
  const { art } = h;
  const building = h.cost === 0;
  let look = tidyLook(art, h.initial);
  const saved = { ...look, colours: { ...look.colours } };
  let busy = false;

  const root = el('div');
  root.id = 'creator';
  root.classList.add('cr-house');
  if (!building) root.classList.add('cr-parlor'); // over the town, dimmed
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', building ? 'Build your house' : 'Your house');

  // ── the house ──
  const preview = el('div', 'cr-preview');
  const canvas = el('canvas', 'cr-house-art');
  const [w, hgt] = art.def.size;
  canvas.width = w;
  canvas.height = hgt;
  canvas.style.width = `${w * PREVIEW_ZOOM}px`;
  canvas.style.height = `${hgt * PREVIEW_ZOOM}px`;
  const ctx = canvas.getContext('2d')!;
  preview.append(canvas);
  const redraw = () => {
    const img = h.draw(look);
    ctx.clearRect(0, 0, w, hgt);
    if (img) ctx.drawImage(img, 0, 0);
  };

  // ── the choices ──
  const settings = el('div', 'cr-settings');
  const note = el('div', 'cr-note');
  const save = el('button', 'cr-save');
  const random = el('button', 'cr-random', 'Random');
  const set = (next: HouseLook) => {
    look = tidyLook(art, next);
    render();
    redraw();
    refresh();
  };

  const pills = (items: [string, string][], on: string | null, pick: (id: string) => void) => {
    const wrap = el('div', 'cr-items');
    wrap.setAttribute('role', 'radiogroup');
    for (const [id, name] of items) {
      const b = el('button', 'cr-item', name);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(id === on));
      b.addEventListener('click', () => pick(id));
      wrap.append(b);
    }
    return wrap;
  };
  const swatches = (slot: string) => {
    const wrap = el('div', 'cr-swatches');
    wrap.setAttribute('role', 'radiogroup');
    wrap.setAttribute('aria-label', label(slot));
    const pool = Object.keys(art.swatches[swatchKind(slot)]);
    for (const name of pool) {
      const [a, b] = swatchShades(art, slot, name);
      const s = el('button', 'cr-swatch');
      s.style.background = `linear-gradient(135deg, ${a} 62%, ${b} 62%)`;
      s.setAttribute('role', 'radio');
      s.setAttribute('aria-label', label(name));
      s.title = label(name);
      s.setAttribute('aria-checked', String(look.colours[slot] === name));
      s.addEventListener('click', () => set({ ...look, colours: { ...look.colours, [slot]: name } }));
      wrap.append(s);
    }
    return wrap;
  };
  const section = (title: string, ...parts: HTMLElement[]) => {
    const s = el('section', 'cr-section');
    s.append(el('h2', undefined, title), ...parts);
    return s;
  };

  const render = () => {
    const scroll = settings.scrollTop;
    const slots = [...art.parts.houses[look.style].slots].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));
    // A combo is "on" when the house matches it exactly.
    const combo = art.swatches.combos.find((c) => same(comboLook(art, look.style, c), look))?.name ?? null;
    settings.replaceChildren(
      section('House', pills(houseStyles(art).map((s) => [s, NAMES[s] ?? label(s)]), look.style, (s) => set({ style: s, colours: look.colours }))),
      section('Colour scheme', pills(art.swatches.combos.map((c) => [c.name, c.name]), combo, (name) => set(comboLook(art, look.style, art.swatches.combos.find((c) => c.name === name)!)))),
      ...slots.map((slot) => section(label(slot), swatches(slot))),
    );
    settings.scrollTop = scroll;
  };

  const refresh = () => {
    const changed = !same(look, saved);
    save.textContent = busy ? 'Saving…' : building ? 'Build my house' : `Save · ${h.cost} ${h.cost === 1 ? 'Kowen' : 'Kowens'}`;
    save.disabled = busy || (!building && (!changed || h.kowens < h.cost));
    random.disabled = busy;
  };

  random.addEventListener('click', () => {
    const styles = houseStyles(art);
    const style = styles[Math.floor(Math.random() * styles.length)];
    const pick = (slot: string) => {
      const pool = Object.keys(art.swatches[swatchKind(slot)]);
      return pool[Math.floor(Math.random() * pool.length)];
    };
    // Half the time a colour scheme, half the time any colours.
    const combos = art.swatches.combos;
    set(Math.random() < 0.5 ? comboLook(art, style, combos[Math.floor(Math.random() * combos.length)]) : { style, colours: Object.fromEntries(art.parts.houses[style].slots.map((s) => [s, pick(s)])) });
  });
  save.addEventListener('click', async () => {
    busy = true;
    refresh();
    note.textContent = '';
    const r = await h.save(look).catch(() => ({ ok: false, message: "Couldn't save. Try again?" }));
    busy = false;
    note.textContent = r.message;
    note.classList.toggle('cr-ok', r.ok);
    if (r.ok) {
      Object.assign(saved, { style: look.style, colours: { ...look.colours } });
      if (building) return shut(); // the neighbourhood takes over
      h.kowens -= h.cost;
    }
    refresh();
  });

  const actions = el('div', 'cr-actions');
  actions.append(random, save);
  const head = el('header', 'cr-head');
  if (!building) {
    const close = el('button', 'cr-close', '×');
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => shut());
    head.append(close);
  }
  head.append(
    el('h1', undefined, building ? 'Build your house' : 'Your house'),
    el('p', building ? undefined : 'cr-wallet', building
      ? 'Welcome to the neighbourhood! Pick a house and its colours. Your first house is free.'
      : `You have ${h.kowens} ${h.kowens === 1 ? 'Kowen' : 'Kowens'} · a new look is ${h.cost}`),
  );
  const side = el('div', 'cr-side');
  side.append(settings, actions, note);
  const panel = el('div', 'cr-panel');
  panel.append(preview, side);
  const box = el('div', 'cr-box');
  if (h.frame) {
    box.classList.add('cr-framed');
    box.style.setProperty('--frame', `url("${h.frame.url}")`);
    box.style.setProperty('--slice', String(h.frame.slice));
  }
  box.append(head, panel);
  root.append(box);
  document.body.append(root);

  const keys = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || building) return;
    e.stopPropagation();
    shut();
  };
  document.addEventListener('keydown', keys, true);
  if (!building) root.addEventListener('pointerdown', (e) => e.target === root && shut());
  function shut(): void {
    document.removeEventListener('keydown', keys, true);
    root.remove();
    h.onClose?.();
  }

  render();
  redraw();
  refresh();
}
