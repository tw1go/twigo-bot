import type { CharacterDefs } from '../assets/types';
import type { Outfit } from '../characters/doll';
import { randomOutfit } from '../characters/doll';
import { choices } from '../characters/looks';
import { toast } from './toast';

// 👕 The wardrobe: every hairstyle, item and colour the manifest offers. Changes show on the player right away;
// Save keeps them (on the account when logged in), Close without saving puts the old look back.

export interface WardrobeHooks {
  current: () => Outfit;
  apply: (o: Outfit) => Promise<void>;
  save: (o: Outfit) => Promise<'account' | 'browser' | 'error'>;
  loggedIn: () => boolean;
}

/** "hairColour" → "Hair colour", "tshirt" → "Tshirt". */
const label = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/-/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());

export function mountWardrobe(C: CharacterDefs, hooks: WardrobeHooks): void {
  const c = choices(C);
  const button = document.createElement('button');
  button.id = 'wardrobe-button';
  button.textContent = '👕 Wardrobe';
  document.body.append(button);

  let panel: HTMLElement | null = null;
  let draft: Outfit;
  let original: Outfit;
  let pending: ReturnType<typeof setTimeout> | undefined;

  // Rebuilding a look takes a moment, and a new hairstyle or item loads its layers the first time.
  let busy = 0;
  const setBusy = (delta: number) => {
    busy += delta;
    const title = panel?.querySelector('.wr-title');
    if (title) title.textContent = busy > 0 ? '👕 Wardrobe · loading…' : '👕 Wardrobe';
  };
  const preview = () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      setBusy(1);
      void hooks.apply({ ...draft }).finally(() => setBusy(-1));
    }, 80);
  };

  const close = (revert: boolean) => {
    clearTimeout(pending); // a queued preview must not land after we've put the old look back
    if (revert) void hooks.apply(original);
    panel?.remove();
    panel = null;
    button.hidden = false;
  };

  const swatch = (name: string | undefined) => {
    const s = document.createElement('span');
    s.className = 'wr-swatch';
    const ramp = name ? C.colourPresets[name] : undefined;
    s.style.background = Array.isArray(ramp) ? `#${ramp[1]}` : 'transparent';
    return s;
  };

  /** One <select>; "none" adds an empty choice (glasses, hat). */
  const select = (key: keyof Outfit, list: string[], opts: { none?: boolean; colour?: boolean } = {}) => {
    const wrap = document.createElement('span');
    wrap.className = 'wr-pick';
    const el = document.createElement('select');
    el.setAttribute('aria-label', label(key));
    if (opts.none) el.append(new Option('None', ''));
    for (const v of list) el.append(new Option(label(v), v));
    el.value = (draft[key] as string | undefined) ?? '';
    const sw = opts.colour ? swatch(draft[key] as string) : null;
    el.addEventListener('change', () => {
      (draft as unknown as Record<string, string | undefined>)[key] = el.value || undefined;
      if (sw) sw.style.background = swatch(el.value).style.background;
      preview();
    });
    wrap.append(el);
    if (sw) wrap.append(sw);
    return wrap;
  };

  const row = (title: string, ...parts: HTMLElement[]) => {
    const r = document.createElement('div');
    r.className = 'wr-row';
    const t = document.createElement('span');
    t.className = 'wr-label';
    t.textContent = title;
    r.append(t, ...parts);
    return r;
  };

  const render = () => {
    panel?.remove();
    panel = document.createElement('div');
    panel.id = 'wardrobe';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Wardrobe');
    const h = document.createElement('div');
    h.className = 'wr-title';
    h.textContent = '👕 Wardrobe';
    panel.append(
      h,
      row('Skin', select('skin', c.skin)),
      row('Hair', select('hair', c.hair), select('hairColour', c.colours, { colour: true })),
      row('Top', select('top', c.top), select('topColour', c.colours, { colour: true }), select('topTrim', c.colours, { colour: true })),
      row('Bottom', select('bottom', c.bottom), select('bottomColour', c.colours, { colour: true }), select('bottomTrim', c.colours, { colour: true })),
      row('Shoes', select('shoes', c.shoes), select('shoesColour', c.colours, { colour: true })),
      row('Glasses', select('glasses', c.glasses, { none: true }), select('glassesColour', c.colours, { colour: true })),
      row('Hat', select('hat', c.hats, { none: true }), select('hatColour', c.colours, { colour: true })),
    );
    const note = document.createElement('div');
    note.className = 'wr-note';
    note.textContent = hooks.loggedIn() ? 'Saved to your Discord account.' : 'Saved in this browser. Log in to keep your look everywhere.';
    const actions = document.createElement('div');
    actions.className = 'wr-actions';
    const shuffle = document.createElement('button');
    shuffle.textContent = '🎲 Random';
    shuffle.addEventListener('click', () => {
      draft = randomOutfit(C, Math.random);
      draft.glassesColour ??= c.colours[0];
      draft.hatColour ??= c.colours[0];
      render();
      preview();
    });
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => close(true));
    const save = document.createElement('button');
    save.className = 'wr-save';
    save.textContent = 'Save';
    save.addEventListener('click', async () => {
      save.disabled = true;
      clearTimeout(pending);
      await hooks.apply({ ...draft });
      const where = await hooks.save({ ...draft });
      save.disabled = false;
      if (where === 'error') return toast("Couldn't save your look. Try again?");
      toast(where === 'account' ? '👕 Look saved to your account' : '👕 Look saved in this browser');
      original = { ...draft };
      close(false);
    });
    actions.append(shuffle, cancel, save);
    panel.append(note, actions);
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close(true);
    });
    document.body.append(panel);
  };

  button.addEventListener('click', () => {
    original = hooks.current();
    draft = { ...original, glassesColour: original.glassesColour ?? c.colours[0], hatColour: original.hatColour ?? c.colours[0] };
    button.hidden = true;
    render();
    panel?.querySelector('select')?.focus();
  });
}
