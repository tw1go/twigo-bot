import { playVoice } from '../audio/sound';

// 💬 Talking to an NPC (world/npc-life.ts): a box at the bottom, in the chat window's nine-slice (manifest
// ui.chatWindow) at the HUD's scale (2 screen px per art px), 320 art px wide (narrower on small screens): centred
// when it fits, else slid along or lifted as little as it takes never to cover a HUD panel (chat, bag, the stay box…).
// The NPC's portrait in the item frame (ui.inventory.itemFrame) at 3× (mirrored for some: world/npcs.ts) stands on the box's top-right corner (just over
// its edge), blinking now and then (its frame 1 for a moment); the box holds the name, the characteristic, and the line,
// typed out letter by letter in their voice (a soft blip every few letters, pitched per NPC). One line per talk: a
// click on the box, a tap, Space or E shows the whole line, and once it's shown closes the box (click the NPC again
// for another line); Esc or a click outside closes it too (so does walking away: the scene's job). One at a time; it
// never takes focus, so the chat still gets what's typed. Only the player who clicked sees it: nothing goes to the server.

export interface NpcTalk {
  id: string;
  name: string;
  title: string;
  /** The portrait sheet's URL: two square frames side by side (eyes open, blink). */
  portrait: string;
  /** The next line to say. */
  next: () => string;
  /** Their voice: the talk blips' playback rate (world/npcs.ts). */
  voice: number;
  /** The portrait mirrored (the art faces SE; this makes it face SW). */
  mirror: boolean;
  /** Called once when the box closes (the NPC goes back to what it was doing). */
  onClose: () => void;
}

const PX = 2; // screen px per art px, as the HUD's frames
const WIDTH = 320; // art px
const PORTRAIT = 32; // art px
const PORTRAIT_PX = 3; // screen px per art px for the portrait and its frame
const PORTRAIT_OVERLAP = 30; // screen px of the portrait's frame over the box's top edge
const CPS = 40; // letters typed a second
const BLIP_EVERY = 3; // letters (not spaces or punctuation) per voice blip
const TEXT_PX = 17; // the line's text size, shrunk for a line that wouldn't fit two rows
const MIN_TEXT_PX = 11; // every line fits two rows at 17 px on a computer; on a phone the longest need 11
const BLINK_MS = 150;
const MARGIN = 12; // from the screen's edges and from HUD panels
/** HUD panels the box keeps clear of (whichever are showing). */
const HUD = ['#chat', '#chat-button', '#bag-button', '#inventory', '#stay', '#system-feed', '#arena-queue'];

interface Art {
  box: { url: string; slice: number } | null;
  frame: { url: string; slice: number } | null;
}
let art: Art = { box: null, frame: null };

/** The panel art, set once by the town. */
export function setNpcDialogArt(a: Art): void {
  art = a;
}

let open: { id: string; close: () => void } | null = null;

/** The NPC whose box is open, if any. */
export const talkingTo = (): string | null => open?.id ?? null;

export function closeNpcDialog(): void {
  open?.close();
}

export function openNpcDialog(t: NpcTalk): void {
  open?.close(); // another NPC's box is replaced

  const root = el('div');
  root.id = 'npc-dialog';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.style.setProperty('--px', String(PX));
  root.style.width = `min(${WIDTH * PX}px, calc(100vw - ${MARGIN * 2}px))`;
  if (art.box) {
    root.classList.add('nd-framed');
    root.style.setProperty('--frame', `url("${art.box.url}")`);
    root.style.setProperty('--slice', String(art.box.slice));
  }

  const face = el('div', 'nd-portrait');
  face.style.width = face.style.height = `${PORTRAIT * PORTRAIT_PX}px`;
  face.style.backgroundImage = `url("${t.portrait}")`;
  face.style.backgroundSize = `${PORTRAIT * PORTRAIT_PX * 2}px ${PORTRAIT * PORTRAIT_PX}px`;
  if (t.mirror) face.style.transform = 'scaleX(-1)';
  const frame = el('div', 'nd-frame');
  frame.style.setProperty('--px', String(PORTRAIT_PX));
  if (art.frame) {
    frame.classList.add('nd-framed');
    frame.style.setProperty('--frame', `url("${art.frame.url}")`);
    frame.style.setProperty('--slice', String(art.frame.slice));
  }
  // Standing on the box's top-right corner: its bottom PORTRAIT_OVERLAP px over the box's top edge (measured from
  // inside the box's border, where absolute positions start).
  const frameH = PORTRAIT * PORTRAIT_PX + 2 * (art.frame ? art.frame.slice * PORTRAIT_PX : 0);
  const boxBorder = art.box ? art.box.slice * PX : 2;
  frame.style.top = `${-(frameH - PORTRAIT_OVERLAP) - boxBorder}px`;
  frame.append(face);

  const words = el('div', 'nd-words');
  const line = el('div', 'nd-line');
  const more = el('div', 'nd-more', '▼');
  more.setAttribute('aria-hidden', 'true');
  words.append(el('div', 'nd-name', t.name), el('div', 'nd-title', t.title), line);
  root.append(frame, words, more);
  document.body.append(root);

  // ── the line, typed out ──
  let full = '';
  let shown = 0;
  let letters = 0; // typed so far, for the voice
  let typing: ReturnType<typeof setInterval> | undefined;
  const done = () => shown >= full.length;
  const finish = () => {
    clearInterval(typing);
    shown = full.length;
    line.textContent = full;
    more.classList.add('nd-ready');
  };
  const say = (text: string) => {
    clearInterval(typing);
    full = text;
    shown = 0;
    letters = 0;
    more.classList.remove('nd-ready');
    fit(line, text);
    line.textContent = '';
    typing = setInterval(() => {
      shown += 1;
      line.textContent = full.slice(0, shown);
      if (/[\p{L}\p{N}]/u.test(full[shown - 1]) && letters++ % BLIP_EVERY === 0) playVoice(t.voice);
      if (done()) finish(); // (shown in full, or skipped: no more blips)
    }, 1000 / CPS);
  };
  // Still typing: the whole line at once; shown in full: that's all they had to say, the box closes.
  const advance = () => (done() ? close() : finish());

  // ── the portrait blinks now and then ──
  let blink: ReturnType<typeof setTimeout> | undefined;
  const blinkLater = () => {
    blink = setTimeout(() => {
      face.style.backgroundPosition = `-${PORTRAIT * PORTRAIT_PX}px 0`;
      blink = setTimeout(() => {
        face.style.backgroundPosition = '0 0';
        blinkLater();
      }, BLINK_MS);
    }, 3000 + Math.random() * 2000);
  };

  // ── clear of the HUD: as low as it can sit without covering a panel, as near the centre as that allows ──
  const place = () => {
    const { width, height } = root.getBoundingClientRect();
    const panels = HUD.map((sel) => document.querySelector(sel)?.getBoundingClientRect()).filter((r): r is DOMRect => !!r && r.width > 0 && r.height > 0);
    const clamp = (x: number) => Math.max(MARGIN, Math.min(innerWidth - MARGIN - width, x));
    const centre = (innerWidth - width) / 2;
    // Centred, or flush beside a panel on either side.
    const xs = [centre, ...panels.flatMap((r) => [r.right + MARGIN, r.left - MARGIN - width])].map(clamp);
    let best = { x: centre, bottom: Infinity };
    for (const x of xs) {
      let bottom = MARGIN;
      for (let moved = true, guard = 0; moved && guard < 8; guard++) {
        moved = false;
        const top = innerHeight - bottom - height;
        for (const r of panels) {
          if (r.left < x + width && r.right > x && r.top < innerHeight - bottom && r.bottom > top) {
            bottom = innerHeight - r.top + MARGIN / 2;
            moved = true;
          }
        }
      }
      if (bottom < best.bottom || (bottom === best.bottom && Math.abs(x - centre) < Math.abs(best.x - centre))) best = { x, bottom };
    }
    root.style.left = `${Math.round(best.x)}px`;
    root.style.bottom = `${Math.round(best.bottom)}px`;
  };

  // ── controls ──
  const keys = (e: KeyboardEvent) => {
    if (typingInPage()) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      e.stopPropagation();
      return close();
    }
    if (k !== ' ' && k !== 'e') return;
    e.preventDefault();
    e.stopPropagation(); // not the town's E/Space (doors, benches)
    if (!e.repeat) advance();
  };
  const outside = (e: PointerEvent) => {
    if (!root.contains(e.target as Node)) close();
  };
  root.addEventListener('click', advance);
  document.addEventListener('keydown', keys, true);
  document.addEventListener('pointerdown', outside, true);
  addEventListener('resize', place);

  function close(): void {
    if (open?.close !== close) return;
    open = null;
    clearInterval(typing);
    clearTimeout(blink);
    document.removeEventListener('keydown', keys, true);
    document.removeEventListener('pointerdown', outside, true);
    removeEventListener('resize', place);
    root.remove();
    t.onClose();
  }
  open = { id: t.id, close };

  place();
  blinkLater();
  say(t.next());
}

/** The line's text size: the largest (up to TEXT_PX) at which it fits two rows of the box. */
function fit(line: HTMLElement, text: string): void {
  line.textContent = text;
  for (let px = TEXT_PX; px >= MIN_TEXT_PX; px--) {
    line.style.fontSize = `${px}px`;
    if (line.scrollHeight <= line.clientHeight + 1) return;
  }
}

/** Typing into a field (the chat): keys stay there. */
function typingInPage(): boolean {
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
