import { type Item, cubeOf, cubeRefusal, petRules } from '@mikazuki/shared';
import { adventure, anyDef, itemData, petAct } from '../net/adventure';
import { playSound } from '../audio/sound';
import { toast } from './toast';

// 🎲 The pet cube's picker (CONTEXT.md "Pet cube"): the cube's pets (stats.json pets.petCube.<tier>.choices, in that
// order: the common cube's six, never Fairy Cha) as cards in a 3 × 2 grid, each playing its idle (the way the world's SE
// looks: manifest pets.sheetDirs) with its name under it. A click picks one: a gold outline and its special once, then
// idle again. Choose (greyed until one is picked) asks once more ("Take Croakyangs? …": Confirm / Back), then POST
// /town/pet { action: 'cube' } (the server checks the cube, the choice and the room, and spends the cube and gives the pet
// in one save). A full bag is refused before the picker opens. Cancel, ×, Escape or a click outside keep the cube.

/** A pet's sheet for the picker: its url and frames, and the animation's pace (pets/sheets/pets.json). */
export interface CubeSheet {
  url: string;
  frames: number;
  fps: number;
}

/** The picker's art, from the scene: a pet's idle or special sheet facing SE as the world draws it. */
export interface PetCubeArt {
  sheet: (pet: string, anim: 'idle' | 'special') => CubeSheet | null;
  /** The sheets' cell (px). */
  cell: [number, number];
}

let art: PetCubeArt | null = null;
export const setPetCubeArt = (a: PetCubeArt | null): void => void (art = a);

/** Each art px drawn this big in a card. */
const SCALE = 2;

/** Opens a pet cube from the bag: refused at once with a full bag, else the picker, then the server. */
export async function openCube(it: Item): Promise<void> {
  const D = itemData();
  const cube = D ? cubeOf(D, it) : null;
  const bag = adventure()?.bag ?? [];
  if (!D || !cube) return;
  const no = cubeRefusal(D, bag, it.uid);
  if (no) {
    playSound('error');
    return void toast(no.replace(/\.$/, ''), 2400, 'bad');
  }
  if (document.querySelector('.pc-back')) return; // (one picker at a time: a double-click opens it once)
  const pet = await pick(cube.choices);
  if (!pet) return;
  const r = await petAct({ action: 'cube', item: it.uid, pet });
  if (!r?.ok) {
    playSound('error');
    return void toast(r?.message?.replace(/\.$/, '') ?? "Couldn't reach the bot", 2400, 'bad');
  }
  playSound('coin'); // (as a pet box's opening)
  toast(r.message ?? `${nameOf(pet)} joined you!`, 2600, 'good');
  window.dispatchEvent(new Event('mk-wallet')); // the bag redraws
}

const nameOf = (pet: string) => anyDef(`pet-${pet}`)?.name ?? petRules(itemData()!.stats)?.list[pet]?.name ?? pet;

/** The picker: resolves the pet taken (a pets.list key), or null: they kept the cube. */
function pick(choices: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const back = el('div', 'fg-confirm-back pc-back');
    const dlg = el('div', 'fg-confirm pc-pick');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-label', 'Pet Selection Cube');
    const close = el('button', 'pc-x', '×');
    close.setAttribute('aria-label', 'Close');
    const title = el('div', 'fg-confirm-title', 'Pet Selection Cube');
    const sub = el('div', 'fg-confirm-sub', 'Pick a pet. It will be bound to this character.');
    const grid = el('div', 'pc-grid');
    const choose = el('button', 'fg-go fg-ready', 'Choose');
    const cancel = el('button', 'fg-go', 'Cancel');
    const row = el('div', 'fg-actions');
    row.append(choose, cancel);
    let picked: string | null = null;
    let asking = false;

    const cards = choices.map((pet) => {
      const card = el('button', 'pc-card');
      card.setAttribute('aria-pressed', 'false');
      const stage = el('div', 'pc-stage');
      const sprite = new PetSprite(stage, pet);
      card.append(stage, el('span', 'pc-name', nameOf(pet)));
      card.addEventListener('click', () => {
        if (asking) return;
        picked = pet;
        for (const c of cards) c.card.classList.toggle('pc-picked', c.pet === pet);
        for (const c of cards) c.card.setAttribute('aria-pressed', String(c.pet === pet));
        sprite.special();
        refresh();
      });
      grid.append(card);
      return { pet, card, sprite };
    });
    const refresh = () => {
      choose.disabled = !picked;
      choose.classList.toggle('fg-ready', !!picked);
    };
    refresh();

    // Choose → "Take X? …" in the same box: Confirm takes it, Back goes back to the cards (the pick kept).
    const ask = el('div', 'pc-ask');
    const askText = el('div', 'pc-ask-text');
    const confirm = el('button', 'fg-go fg-ready', 'Confirm');
    const backBtn = el('button', 'fg-go', 'Back');
    const askRow = el('div', 'fg-actions');
    askRow.append(confirm, backBtn);
    ask.append(askText, askRow);
    ask.hidden = true;
    const showAsk = (on: boolean) => {
      asking = on;
      ask.hidden = !on;
      grid.classList.toggle('pc-dim', on);
      row.hidden = on;
      if (on) askText.textContent = `Take ${nameOf(picked!)}? The pet will be bound to this character and the cube is used up.`;
    };

    let timer = 0;
    const tick = () => {
      const now = performance.now();
      for (const c of cards) c.sprite.draw(now);
      timer = requestAnimationFrame(tick);
    };
    timer = requestAnimationFrame(tick);

    const done = (pet: string | null) => {
      cancelAnimationFrame(timer);
      back.remove();
      document.removeEventListener('keydown', key, true);
      resolve(pet);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (asking) showAsk(false);
      else done(null);
    };
    choose.addEventListener('click', () => picked && showAsk(true));
    cancel.addEventListener('click', () => done(null));
    close.addEventListener('click', () => done(null));
    confirm.addEventListener('click', () => done(picked));
    backBtn.addEventListener('click', () => showAsk(false));
    back.addEventListener('click', (e) => e.target === back && done(null));
    document.addEventListener('keydown', key, true);
    dlg.append(close, title, sub, grid, row, ask);
    back.append(dlg);
    document.body.append(back);
  });
}

/** A pet in a card: its idle looping, its special once on a pick (then idle again), a sheet's frames as a CSS
 *  background stepped by the picker's clock. Nothing until the art is in. */
class PetSprite {
  private readonly box = el('div', 'pc-sprite');
  private anim: 'idle' | 'special' = 'idle';
  private since = performance.now();

  constructor(stage: HTMLElement, private readonly pet: string) {
    stage.append(this.box);
    const [w, h] = art?.cell ?? [40, 40];
    this.box.style.width = `${w * SCALE}px`;
    this.box.style.height = `${h * SCALE}px`;
    // (Both sheets fetched now, so the special starts at once.)
    for (const a of ['idle', 'special'] as const) {
      const s = art?.sheet(pet, a);
      if (s) new Image().src = s.url;
    }
    this.show('idle');
  }

  special(): void {
    if (art?.sheet(this.pet, 'special')) this.show('special');
  }

  private show(anim: 'idle' | 'special'): void {
    const s = art?.sheet(this.pet, anim);
    if (!s || !art) return;
    this.anim = anim;
    this.since = performance.now();
    const [w, h] = art.cell;
    this.box.style.backgroundImage = `url("${s.url}")`;
    this.box.style.backgroundSize = `${s.frames * w * SCALE}px ${h * SCALE}px`;
    this.box.style.backgroundPositionX = '0px';
  }

  draw(now: number): void {
    const s = art?.sheet(this.pet, this.anim);
    if (!s || !art || s.frames < 1) return;
    let f = Math.floor(((now - this.since) / 1000) * s.fps);
    if (this.anim === 'special' && f >= s.frames) {
      this.show('idle');
      f = 0;
    }
    this.box.style.backgroundPositionX = `${-(f % s.frames) * art.cell[0] * SCALE}px`;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
