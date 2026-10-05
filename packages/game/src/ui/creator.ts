import type { CharacterDefs, Dir } from '../assets/types';
import { type Outfit, randomOutfit } from '../characters/doll';
import { choices } from '../characters/looks';
import { NICKNAME_RULE, parseNickname } from '../characters/nickname';
import type { TitleData } from '@mikazuki/shared';

// 🧍 The character creator, before a member's first visit to the town: one box with the character on the left
// (idle, turned with the arrows) and the choices on the right (scrolling, Save underneath). Colours are picked by swatch, not by name. DOM text only.
// 💇 The same box is the Parlor in town (`hooks.parlor`): no nickname, two tabs on the right (Appearance: the same
// choices, a new look for a few Kowens; Title: which of your titles to show, free), and a way out (×, Escape).

export interface CreatorHooks {
  name: string;
  /** Starting nickname: their saved one, or a suggestion from their Discord name ('' if none fits). */
  nickname: string;
  /** Their title, shown under the nickname as <Title>, in its colour. */
  title: TitleData;
  initial: Outfit;
  /** Loads and builds a look (resolves once its sheets exist). */
  apply: (o: Outfit) => Promise<void>;
  /** The composited idle sheet for a built look, facing `dir`. */
  sheet: (o: Outfit, dir: Dir) => CanvasImageSource | null;
  /** Rows of empty cell above a built look's head (the name plate sits just over it). */
  head: (o: Outfit) => number;
  /** Saves the nickname and look, then enters the town (the creator). */
  save?: (o: Outfit, nickname: string) => Promise<'ok' | 'taken' | 'invalid' | 'error'>;
  /** The Parlor instead of the creator. */
  parlor?: ParlorHooks;
  /** The game's pixel frame (a nine-slice image) for the box, if the manifest has one. */
  frame: { url: string; slice: number } | null;
}

export interface ParlorTitle extends TitleData {
  id: string;
  worn: boolean;
  /** What it's for (the CMS writes these), shown on hover. */
  description?: string;
  /** Not clicked yet at the Parlor: a NEW tag until it is. */
  isNew?: boolean;
}

/** What the Parlor's server says after a change. */
export interface ParlorResult {
  ok: boolean;
  message: string;
  kowens: number;
  titles: ParlorTitle[];
}

export interface ParlorHooks {
  kowens: number;
  /** Kowens a new look costs. */
  cost: number;
  titles: ParlorTitle[];
  buyLook: (o: Outfit) => Promise<ParlorResult>;
  wearTitle: (id: string) => Promise<ParlorResult>;
  /** A NEW title was clicked: its tag goes (here at once, and on the server). */
  openedTitle: (id: string) => void;
  onClose: () => void;
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
  const parlor = hooks.parlor;
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
  root.setAttribute('aria-label', parlor ? 'Parlor' : 'Create your character');
  if (parlor) root.classList.add('cr-parlor');

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
  // Name and title, as in town: just over the head, at the character's scale.
  const plate = el('div', 'cr-name');
  const titleEl = el('div', 'cr-title');
  const showTitle = (t: TitleData) => {
    titleEl.textContent = `<${t.name}>`;
    titleEl.classList.toggle('prismatic', t.color === 'prismatic');
    titleEl.style.color = t.color === 'prismatic' ? '' : t.color;
  };
  showTitle(hooks.title);
  const tag = el('div', 'cr-tag');
  tag.append(plate, titleEl);
  const stage = el('div', 'cr-stage');
  stage.append(el('div', 'cr-shadow'), doll, tag);
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
          stage.style.setProperty('--head', String(hooks.head(o)));
          root.classList.remove('cr-busy');
        }
      });
    }, 60);
  };

  // ── the nickname (outside the choices, which are rebuilt on every pick) ──
  const nickInput = el('input', 'cr-nick');
  nickInput.id = 'cr-nick';
  nickInput.maxLength = 16;
  nickInput.autocomplete = 'off';
  nickInput.spellcheck = false;
  nickInput.value = hooks.nickname;
  nickInput.placeholder = 'Your name in town';
  const nickNote = el('div', 'cr-nick-note', NICKNAME_RULE);
  nickNote.id = 'cr-nick-note';
  nickInput.setAttribute('aria-describedby', nickNote.id);
  const nickLabel = el('label', undefined, 'Nickname');
  nickLabel.htmlFor = nickInput.id;
  const nickHead = el('h2');
  nickHead.append(nickLabel);
  const nickSection = el('section', 'cr-section');
  nickSection.append(nickHead, nickInput, nickNote);
  const showNick = (problem?: string) => {
    plate.textContent = nickInput.value.trim();
    plate.hidden = !plate.textContent;
    nickNote.textContent = problem ?? NICKNAME_RULE;
    nickNote.classList.toggle('cr-bad', !!problem);
    nickInput.setAttribute('aria-invalid', String(!!problem));
  };
  nickInput.addEventListener('input', () => showNick());
  showNick();
  if (parlor) nickInput.readOnly = true; // the nickname is shown, not changed, at the Parlor

  // ── the choices ──
  const settings = el('div', 'cr-settings');
  const choicesBox = el('div', 'cr-choices');
  const set = (key: keyof Outfit, value: string | undefined) => {
    (draft as unknown as Record<string, string | undefined>)[key] = value;
    const focused = (document.activeElement as HTMLElement | null)?.dataset.pick;
    render();
    if (focused) choicesBox.querySelector<HTMLElement>(`[data-pick="${CSS.escape(focused)}"]`)?.focus();
    preview();
    refreshParlor();
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
  const random = el('button', 'cr-random', 'Random');
  random.addEventListener('click', () => {
    draft = randomOutfit(C, Math.random);
    draft.glassesColour ??= c.colours[0];
    draft.hatColour ??= c.colours[0];
    render();
    preview();
    refreshParlor();
  });
  const save = el('button', 'cr-save', 'Save & enter town');
  const badNick = (problem: string) => {
    showNick(problem);
    nickInput.focus();
    settings.scrollTop = 0;
  };
  if (!parlor) save.addEventListener('click', async () => {
    const nickname = parseNickname(nickInput.value);
    if (!nickname) return badNick(nickInput.value.trim() ? `Not quite: ${NICKNAME_RULE}.` : 'Pick a nickname first.');
    nickInput.value = nickname;
    showNick();
    save.disabled = random.disabled = true;
    save.textContent = 'Entering town…';
    note.textContent = '';
    clearTimeout(pending);
    const o = { ...draft };
    await applying;
    await hooks.apply(o);
    const result = await hooks.save!(o, nickname);
    if (result === 'ok') {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', keys, true);
      root.remove();
      return;
    }
    save.disabled = random.disabled = false;
    save.textContent = 'Save & enter town';
    if (result === 'taken') badNick('Someone already goes by that name. Try another?');
    else if (result === 'invalid') badNick(`Not quite: ${NICKNAME_RULE}.`);
    else note.textContent = "Couldn't save. Try again?";
  });
  const actions = el('div', 'cr-actions');
  actions.append(random, save);

  // ── the Parlor: tabs, a paid new look, and titles ──
  let saved: Outfit = { ...draft }; // the look the member has
  let tab: 'look' | 'title' = 'look';
  let titles = parlor?.titles ?? [];
  let picked = titles.find((t) => t.worn)?.id ?? null;
  let kowens = parlor?.kowens ?? 0;
  let busy = false;
  const wallet = el('p', 'cr-wallet');
  const reset = el('button', 'cr-random', 'Undo changes');
  const wear = el('button', 'cr-save', 'Show this title');
  const titleBox = el('div', 'cr-titles');
  titleBox.setAttribute('role', 'radiogroup');
  titleBox.setAttribute('aria-label', 'Your titles');
  const tabBar = el('div', 'cr-tabs');
  tabBar.setAttribute('role', 'tablist');
  const tabButtons = (['look', 'title'] as const).map((t) => {
    const b = el('button', 'cr-tab', t === 'look' ? 'Appearance' : 'Title');
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => {
      tab = t;
      note.textContent = '';
      layout();
    });
    return b;
  });
  tabBar.append(...tabButtons);
  const say = (text: string, ok: boolean) => {
    note.textContent = text;
    note.classList.toggle('cr-ok', ok);
  };
  /** The Parlor's buttons and wallet line, as the draft and title pick stand. */
  function refreshParlor(): void {
    if (!parlor) return;
    const changed = !sameLook(canon(draft), canon(saved));
    wallet.textContent = `You have ${kowens} ${kowens === 1 ? 'Kowen' : 'Kowens'} · a new look is ${parlor.cost}, titles are free`;
    save.textContent = busy ? 'Saving…' : `Save look · ${parlor.cost} ${parlor.cost === 1 ? 'Kowen' : 'Kowens'}`;
    save.disabled = busy || !changed || kowens < parlor.cost;
    save.title = !changed ? 'Change something first' : kowens < parlor.cost ? 'Not enough Kowens' : '';
    reset.disabled = busy || !changed;
    const worn = titles.find((t) => t.worn)?.id;
    wear.disabled = busy || !picked || picked === worn;
    wear.textContent = busy ? 'Saving…' : picked && picked === worn ? 'Showing this title' : 'Show this title';
  }
  // A title's description floats over its card on hover or keyboard focus (on the box itself, so the scrolling list
  // never clips it).
  const info = el('div', 'cr-info');
  info.setAttribute('role', 'tooltip');
  info.id = 'cr-info';
  info.hidden = true;
  const hint = (b: HTMLElement | null, t?: ParlorTitle) => {
    if (!b || !t) return void (info.hidden = true);
    info.replaceChildren(el('strong', undefined, `<${t.name}>`), el('span', undefined, t.description || 'No description yet.'));
    info.hidden = false;
    const card = b.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    const below = card.bottom + info.offsetHeight + 8 < innerHeight;
    info.style.left = `${Math.max(8, Math.min(card.left + card.width / 2 - info.offsetWidth / 2, box.width - info.offsetWidth - 8))}px`;
    info.style.top = `${below ? card.bottom + 6 : card.top - info.offsetHeight - 6}px`;
  };
  const drawTitles = () => {
    hint(null);
    titleBox.replaceChildren(
      ...titles.map((t) => {
        const b = el('button', 'cr-title-pick');
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(t.id === picked));
        b.setAttribute('aria-describedby', info.id);
        const name = el('span', `cr-title-name${t.color === 'prismatic' ? ' prismatic' : ''}`, `<${t.name}>`);
        if (t.color !== 'prismatic') name.style.color = t.color;
        b.append(name, el('span', 'cr-title-about', t.description || ' '));
        const tags = el('span', 'cr-tags');
        if (t.isNew) tags.append(el('span', 'cr-new', 'new'));
        if (t.worn) tags.append(el('span', 'cr-worn', 'showing'));
        if (tags.childElementCount) b.append(tags);
        b.addEventListener('pointerenter', () => hint(b, t));
        b.addEventListener('pointerleave', () => hint(null));
        b.addEventListener('focus', () => hint(b, t));
        b.addEventListener('blur', () => hint(null));
        b.addEventListener('click', () => {
          if (t.isNew) {
            t.isNew = false;
            parlor?.openedTitle(t.id);
          }
          picked = t.id;
          showTitle(t);
          drawTitles();
          refreshParlor();
        });
        return b;
      }),
    );
  };
  const layout = () => {
    tabButtons.forEach((b, i) => b.setAttribute('aria-selected', String((i === 0) === (tab === 'look'))));
    hint(null);
    if (tab === 'look') {
      settings.replaceChildren(choicesBox);
      actions.replaceChildren(random, reset, save);
      showTitle(titles.find((t) => t.worn) ?? hooks.title);
    } else {
      drawTitles();
      settings.replaceChildren(titleBox, el('p', 'cr-nick-note', 'Titles are given for things you do around the server. Showing another is free.'));
      actions.replaceChildren(wear);
      const t = titles.find((x) => x.id === picked);
      if (t) showTitle(t);
    }
    settings.scrollTop = 0;
    refreshParlor();
  };
  const after = (r: ParlorResult) => {
    kowens = r.kowens;
    titles = r.titles;
    say(r.message, r.ok);
  };
  if (parlor) {
    reset.addEventListener('click', () => {
      draft = { ...saved };
      render();
      preview();
      refreshParlor();
    });
    save.addEventListener('click', async () => {
      busy = true;
      refreshParlor();
      clearTimeout(pending);
      const o = { ...draft };
      await applying;
      await hooks.apply(o);
      const r = await parlor.buyLook(canon(o)).catch(() => null);
      busy = false;
      if (r) {
        after(r);
        if (r.ok) saved = o;
      } else say("Couldn't save. Try again?", false);
      refreshParlor();
    });
    wear.addEventListener('click', async () => {
      if (!picked) return;
      busy = true;
      refreshParlor();
      const r = await parlor.wearTitle(picked).catch(() => null);
      busy = false;
      if (r) after(r);
      else say("Couldn't save. Try again?", false);
      drawTitles();
      refreshParlor();
    });
  }

  const render = () => {
    const scroll = settings.scrollTop;
    choicesBox.replaceChildren(
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
  if (!parlor) settings.append(nickSection, choicesBox);
  render();

  const head = el('header', 'cr-head');
  if (parlor) {
    const close = el('button', 'cr-close', '×');
    close.setAttribute('aria-label', 'Close the Parlor');
    close.addEventListener('click', () => shut());
    head.append(close, el('h1', undefined, 'Parlor'), wallet);
  } else head.append(el('h1', undefined, 'Create your character'), el('p', undefined, `Welcome, ${hooks.name}! Pick a nickname and a look for the town.`));
  const side = el('div', 'cr-side');
  side.append(...(parlor ? [tabBar] : []), settings, actions, note);
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

  // ←/→ turn the character too (not while typing the nickname); Escape leaves the Parlor.
  const keys = (e: KeyboardEvent) => {
    if (e.target === nickInput) return;
    if (e.key === 'ArrowLeft') turn(-1);
    else if (e.key === 'ArrowRight') turn(1);
    else if (e.key === 'Escape' && parlor) shut();
    else return;
    e.stopPropagation(); // not the town's keys
  };
  document.addEventListener('keydown', keys, true);
  const shut = () => {
    cancelAnimationFrame(frame);
    clearTimeout(pending);
    document.removeEventListener('keydown', keys, true);
    root.remove();
    parlor?.onClose();
  };

  if (parlor) {
    root.append(info);
    settings.addEventListener('scroll', () => hint(null));
    root.addEventListener('pointerdown', (e) => e.target === root && shut()); // a click on the dimmed town outside the box
    layout();
  }
  preview();
}

/** A look without the colour of glasses or a hat it doesn't wear (the creator keeps one ready for when it does). */
function canon(o: Outfit): Outfit {
  const out = { ...o };
  if (!out.glasses) delete out.glassesColour;
  if (!out.hat) delete out.hatColour;
  return out;
}

const sameLook = (a: Outfit, b: Outfit) => (Object.keys({ ...a, ...b }) as (keyof Outfit)[]).every((k) => a[k] === b[k]);
