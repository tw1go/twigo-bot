// ⌨️ Keybinds: every game key is an action with up to two keys (a key = its event.code, plus Ctrl/Alt/Shift if held,
// so a keyboard layout or Caps Lock doesn't change what it does), saved in this browser (localStorage `mk_keys`, only
// what differs from the defaults). Settings → Keybinds changes them (ui/settings.ts keybindsPage). Enter (the chat),
// Escape, Tab and the arena's 1–3 stay as they are. Everything that listens for a key asks here (`matches`,
// `held`), and every label showing a key reads `keyLabel` again on the 'mk-keys' event.

export interface ActionDef {
  id: string;
  label: string;
  group: 'Movement' | 'Actions' | 'Hotbar' | 'Hotbar (top row)' | 'Emotes';
  keys: [string, string?];
}

const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const slotCodes = [...digits.map((d) => `Digit${d}`), 'Minus', 'Equal', 'Backquote'];
const EMOTES = ['Love', 'Laugh', 'Surprised', 'Confused', 'Kowens!', 'Sleepy', 'Angry', 'Wave'];

export const ACTIONS: ActionDef[] = [
  { id: 'up', label: 'Walk up', group: 'Movement', keys: ['KeyW', 'ArrowUp'] },
  { id: 'left', label: 'Walk left', group: 'Movement', keys: ['KeyA', 'ArrowLeft'] },
  { id: 'down', label: 'Walk down', group: 'Movement', keys: ['KeyS', 'ArrowDown'] },
  { id: 'right', label: 'Walk right', group: 'Movement', keys: ['KeyD', 'ArrowRight'] },
  { id: 'interact', label: 'Enter, sit, talk', group: 'Actions', keys: ['KeyE', 'Space'] },
  { id: 'pickup', label: 'Pick up', group: 'Actions', keys: ['KeyF'] },
  { id: 'target', label: 'Target the nearest mob', group: 'Actions', keys: ['KeyZ'] },
  { id: 'skills', label: 'Skills', group: 'Actions', keys: ['KeyK'] },
  { id: 'bag', label: 'Bag and equipment', group: 'Actions', keys: ['KeyB', 'KeyI'] },
  { id: 'quests', label: 'Quest log', group: 'Actions', keys: ['KeyJ'] },
  { id: 'settings', label: 'Settings', group: 'Actions', keys: ['KeyO'] },
  ...slotCodes.map((code, i): ActionDef => ({ id: i < 10 ? `main${i + 1}` : `util${i - 9}`, label: `Slot ${i + 1}`, group: 'Hotbar', keys: [code] })),
  ...slotCodes.map((code, i): ActionDef => ({ id: `top${i + 1}`, label: `Top slot ${i + 1}`, group: 'Hotbar (top row)', keys: [`Alt+${code}`] })),
  ...EMOTES.map((name, i): ActionDef => ({ id: `emote${i + 1}`, label: name, group: 'Emotes', keys: [`F${i + 1}`] })),
];

const STORE = 'mk_keys';
const byId = new Map(ACTIONS.map((a) => [a.id, a]));
/** Keys the page keeps for itself (never bound). */
const RESERVED = new Set(['Enter', 'NumpadEnter', 'Escape', 'Tab']);
const MODIFIERS = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock', 'Fn']);

let saved: Record<string, (string | null)[]> = load();

function load(): Record<string, (string | null)[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? '{}') as unknown;
    return raw && typeof raw === 'object' ? (raw as Record<string, (string | null)[]>) : {};
  } catch {
    return {};
  }
}

function save(): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(saved));
  } catch {
    /* private window: the keys just aren't remembered */
  }
  window.dispatchEvent(new Event('mk-keys'));
}

/** An action's keys (two places; null = none). */
export function bindings(id: string): [string | null, string | null] {
  const def = byId.get(id);
  const own = saved[id];
  if (own) return [own[0] ?? null, own[1] ?? null];
  return [def?.keys[0] ?? null, def?.keys[1] ?? null];
}

/** The key a keydown event makes ("Alt+Digit1"), or null for a lone modifier, a reserved key or one with ⌘/Win. */
export function comboOf(e: KeyboardEvent): string | null {
  if (e.metaKey || MODIFIERS.has(e.code) || RESERVED.has(e.code) || !e.code) return null;
  return `${e.ctrlKey ? 'Ctrl+' : ''}${e.altKey ? 'Alt+' : ''}${e.shiftKey ? 'Shift+' : ''}${e.code}`;
}

/** Whether a keydown is one of the action's keys. (Shift is let through for keys bound without it, so walking with
 *  Shift held still walks.) */
export function matches(id: string, e: KeyboardEvent): boolean {
  const c = comboOf(e);
  if (!c) return false;
  const loose = c.replace('Shift+', '');
  return bindings(id).some((k) => k === c || (k === loose && !k.includes('Shift+')));
}

/** The first action a keydown is a key of, among `ids` (all when left out). */
export function actionOf(e: KeyboardEvent, ids?: string[]): string | null {
  for (const a of ids ?? ACTIONS.map((x) => x.id)) if (matches(a, e)) return a;
  return null;
}

// Keys held down now (by code), for walking.
const down = new Set<string>();
document.addEventListener('keydown', (e) => down.add(e.code), true);
document.addEventListener('keyup', (e) => down.delete(e.code), true);
window.addEventListener('blur', () => down.clear());

/** Whether one of the action's keys is held (its modifiers aren't asked: for walking). */
export function held(id: string): boolean {
  return bindings(id).some((k) => !!k && down.has(k.split('+').pop()!));
}

/** Sets one of an action's two keys (null clears it). The key is taken off any other action that had it: that one's
 *  label is returned. */
export function setBinding(id: string, place: 0 | 1, key: string | null): string | null {
  let took: string | null = null;
  if (key)
    for (const a of ACTIONS) {
      const b = bindings(a.id);
      const i = b.indexOf(key);
      if (i < 0 || (a.id === id && i === place)) continue;
      b[i] = null;
      saved[a.id] = b;
      if (a.id !== id) took = a.label;
    }
  const mine = bindings(id);
  mine[place] = key;
  saved[id] = mine;
  tidy();
  save();
  return took;
}

/** Back to the defaults. */
export function resetKeybinds(): void {
  saved = {};
  save();
}

/** Drops saved keys that are the defaults anyway. */
function tidy(): void {
  for (const [id, b] of Object.entries(saved)) {
    const d = byId.get(id)?.keys;
    if (!d || ((b[0] ?? null) === (d[0] ?? null) && (b[1] ?? null) === (d[1] ?? null))) delete saved[id];
  }
}

const NAMES: Record<string, string> = {
  Minus: '-', Equal: '=', Backquote: '~', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Space: 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Backspace: 'Bksp', Delete: 'Del', Insert: 'Ins', PageUp: 'PgUp', PageDown: 'PgDn', Home: 'Home', End: 'End',
};

/** A key as shown: "W", "1", "Alt+1", "~", "F1", "Space". */
export function keyName(key: string): string {
  return key
    .split('+')
    .map((p) => NAMES[p] ?? p.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num '))
    .join('+');
}

/** An action's first key as shown ('' when it has none). */
export function keyLabel(id: string): string {
  const [a, b] = bindings(id);
  const k = a ?? b;
  return k ? keyName(k) : '';
}

/** Runs `fn` now and whenever the keys change. */
export function onKeybinds(fn: () => void): void {
  fn();
  window.addEventListener('mk-keys', fn);
}
