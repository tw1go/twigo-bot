import type { CharacterDefs, Dir } from '../assets/types';
import { type Outfit, randomOutfit } from '../characters/doll';
import { choices } from '../characters/looks';

// 🧍 The character creator, before a member's first visit to the town: one box with the character on the left
// (idle, turned with the arrows) and the choices on the right (scrolling, Save underneath). Colours are picked by swatch, not by name. DOM text only.

export interface CreatorHooks {
  name: string;
  initial: Outfit;
  /** Loads and builds a look (resolves once its sheets exist). */
  apply: (o: Outfit) => Promise<void>;
  /** The composited idle sheet for a built look, facing `dir`. */
  sheet: (o: Outfit, dir: Dir) => CanvasImageSource | null;
  /** Saves the look and enters the town; false if saving failed. */
  save: (o: Outfit) => Promise<boolean>;
  /** The game's pixel frame (a nine-slice image) for the box, if the manifest has one. */
  frame: { url: string; slice: number } | null;
}

/** "tshirt" → "Tshirt", "longsleeve" → "Longsleeve". */
const label = (s: string) => s.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function mountCreator(C: CharacterDefs, hooks: CreatorHooks): void {
  const c = choices(C);
  const [cw, ch] = C.cell;
  const idle = C.animations.idle;
  let draft: Outfit = { ...hooks.initial, glassesColour: hooks.initial.glassesColour ?? c.colours[0], hatColour: hooks.initial.hatColour ?? c.colours[0] };
  let shown: Outfit | null = null; // the last look that finished building
  let dir = C.directions.indexOf('s');
  let pending: ReturnType<typeof setTimeout> | undefined;
  let applying: Promise<void> = Promise.resolve();

  const root = el('div');
  root.id = 'creator';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Create your character');

  // ── the character ──
  const look = el('div', 'cr-preview');
  const doll = el('canvas', 'cr-doll');
  doll.width = cw;
  doll.height = ch;
  const ctx = doll.getContext('2d')!;
  const turn = (step: number) => {
    dir = (dir + step + C.directions.length) % C.directions.length;
  };
  const left = el('button', 'cr-turn', '◀');
  left.setAttribute('aria-label', 'Turn left');
  left.addEventListener('click', () => turn(-1));
  const right = el('button', 'cr-turn', '▶');
  right.setAttribute('aria-label', 'Turn right');
  right.addEventListener('click', () => turn(1));
  const turns = el('div', 'cr-turns');
  turns.append(left, right);
  const stage = el('div', 'cr-stage');
  stage.append(el('div', 'cr-shadow'), doll);
  look.append(stage, turns);

  let frame = 0;
  const draw = (t: number) => {
    frame = requestAnimationFrame(draw);
    const sheet = shown && hooks.sheet(shown, C.directions[dir]);
    if (!sheet) return;
    const f = Math.floor((t / 1000) * (idle.fps || 1)) % idle.frames;
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(sheet, f * cw, 0, cw, ch, 0, 0, cw, ch);
  };
  frame = requestAnimationFrame(draw);

  // A new hairstyle or item loads its layers the first time; only the newest look is shown.
  const preview = () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      const o = { ...draft };
      root.classList.add('cr-busy');
      applying = hooks.apply(o).then(() => {
        if (sameLook(o, draft)) {
          shown = o;
          root.classList.remove('cr-busy');
        }
      });
    }, 60);
  };

  // ── the choices ──
  const settings = el('div', 'cr-settings');
  const set = (key: keyof Outfit, value: string | undefined) => {
    (draft as unknown as Record<string, string | undefined>)[key] = value;
    const focused = (document.activeElement as HTMLElement | null)?.dataset.pick;
    render();
    if (focused) settings.querySelector<HTMLElement>(`[data-pick="${CSS.escape(focused)}"]`)?.focus();
    preview();
  };

  /** Pills for the items ("None" first for glasses and hats). */
  const items = (key: keyof Outfit, list: string[], none = false) => {
    const wrap = el('div', 'cr-items');
    wrap.setAttribute('role', 'radiogroup');
    for (const v of none ? ['', ...list] : list) {
      const b = el('button', 'cr-item', v ? label(v) : 'None');
      const on = (draft[key] ?? '') === v;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(on));
      b.dataset.pick = `${key}:${v}`;
      b.addEventListener('click', () => set(key, v || undefined));
      wrap.append(b);
    }
    return wrap;
  };

  /** Colour swatches: the main shade with a corner of the next one, as it looks on the character. */
  const swatches = (key: keyof Outfit, ramps: Record<string, string[]>, list: string[], name: string) => {
    const wrap = el('div', 'cr-swatches');
    wrap.setAttribute('role', 'radiogroup');
    wrap.setAttribute('aria-label', name);
    for (const v of list) {
      const [a, b] = ramps[v];
      const s = el('button', 'cr-swatch');
      s.style.background = `linear-gradient(135deg, #${a} 62%, #${b ?? a} 62%)`;
      s.setAttribute('role', 'radio');
      s.setAttribute('aria-label', label(v));
      s.setAttribute('aria-checked', String(draft[key] === v));
      s.dataset.pick = `${key}:${v}`;
      s.addEventListener('click', () => set(key, v));
      wrap.append(s);
    }
    return wrap;
  };
  const colours = (key: keyof Outfit, name: string) => swatches(key, C.colourPresets, c.colours, name);

  const section = (title: string, ...parts: HTMLElement[]) => {
    const s = el('section', 'cr-section');
    s.append(el('h2', undefined, title), ...parts);
    return s;
  };
  const sub = (title: string, part: HTMLElement) => {
    const r = el('div', 'cr-sub');
    r.append(el('span', 'cr-sub-label', title), part);
    return r;
  };

  const note = el('div', 'cr-note');
  const random = el('button', 'cr-random', '🎲 Random');
  random.addEventListener('click', () => {
    draft = randomOutfit(C, Math.random);
    draft.glassesColour ??= c.colours[0];
    draft.hatColour ??= c.colours[0];
    render();
    preview();
  });
  const save = el('button', 'cr-save', 'Save & enter town');
  save.addEventListener('click', async () => {
    save.disabled = random.disabled = true;
    save.textContent = 'Entering town…';
    note.textContent = '';
    clearTimeout(pending);
    const o = { ...draft };
    await applying;
    await hooks.apply(o);
    if (await hooks.save(o)) {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', keys);
      root.remove();
      return;
    }
    save.disabled = random.disabled = false;
    save.textContent = 'Save & enter town';
    note.textContent = "Couldn't save your look. Try again?";
  });
  const actions = el('div', 'cr-actions');
  actions.append(random, save);

  const render = () => {
    const scroll = settings.scrollTop;
    settings.replaceChildren(
      section('Skin', swatches('skin', C.skinTones as Record<string, string[]>, c.skin, 'Skin tone')),
      section('Hair', items('hair', c.hair), colours('hairColour', 'Hair colour')),
      section('Top', items('top', c.top), sub('Colour', colours('topColour', 'Top colour')), sub('Trim', colours('topTrim', 'Top trim'))),
      section('Bottom', items('bottom', c.bottom), sub('Colour', colours('bottomColour', 'Bottom colour')), sub('Trim', colours('bottomTrim', 'Bottom trim'))),
      section('Shoes', items('shoes', c.shoes), colours('shoesColour', 'Shoes colour')),
      section('Glasses', items('glasses', c.glasses, true), ...(draft.glasses ? [colours('glassesColour', 'Glasses colour')] : [])),
      section('Hat', items('hat', c.hats, true), ...(draft.hat ? [colours('hatColour', 'Hat colour')] : [])),
    );
    settings.scrollTop = scroll;
  };
  render();

  const head = el('header', 'cr-head');
  head.append(el('h1', undefined, 'Create your character'), el('p', undefined, `Welcome, ${hooks.name}! Pick a look. You can change it any time from the wardrobe in town.`));
  const side = el('div', 'cr-side');
  side.append(settings, actions, note);
  const panel = el('div', 'cr-panel');
  panel.append(look, side);
  const box = el('div', 'cr-box');
  if (hooks.frame) {
    box.classList.add('cr-framed');
    box.style.setProperty('--frame', `url("${hooks.frame.url}")`);
    box.style.setProperty('--slice', String(hooks.frame.slice));
  }
  box.append(head, panel);
  root.append(box);
  document.body.append(root);

  // ←/→ turn the character too.
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') turn(-1);
    else if (e.key === 'ArrowRight') turn(1);
  };
  document.addEventListener('keydown', keys);

  preview();
}

const sameLook = (a: Outfit, b: Outfit) => (Object.keys({ ...a, ...b }) as (keyof Outfit)[]).every((k) => a[k] === b[k]);
