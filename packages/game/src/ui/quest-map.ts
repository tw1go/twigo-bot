import { held, matches } from './keybinds';
import { type QuestMarkArt, drawQuestMarks } from './quest-marks';
import { type WorldMap, type WorldMapUrls, loadWorldMap, middleOf, worldPx } from './world-map';

// 🗺️ The quest map (CONTEXT.md "Quest map"): the world map's picture (ui-map-world.png, placed by map-layout.json, the
// Town, the Slums and the Old Market together) over the game while its key is held (keybind questMap, Tab by default),
// or from a touch screen's tracker pin until the next tap. Centred at the biggest whole-number scale that fits (2× or
// 1×), on the night navy at 70%, no frame and no title; only for looking. On it: you (the Map menu's pin; in the
// neighbourhood at the Town's way there, in a Warrens run at the Slums' Warren Gate, in the Cellar at the Cellar Hatch) and every active quest's hunt and
// the NPCs it needs (ui/quest-marks.ts); none: "No quests to show on the map right now." Not while typing or while
// another window or dialog is open.

export interface QuestMapArt extends WorldMapUrls {
  world: string;
  /** The picture's size (manifest ui.mapWorld.size). */
  worldSize: [number, number];
  /** The Map menu's "you are here" pin, and its size. */
  pin: string;
  pinSize: [number, number];
  marks: QuestMarkArt;
}

/** Where you are: the area ('town', 'slums', 'hood', 'warrens') and your tile there. */
export type QuestMapHere = { area: string; col: number; row: number } | null;

/** A page window or dialog open (the quest map waits for it to close), or the town locked (casino, arena). */
function windowOpen(): boolean {
  if (document.body.classList.contains('town-locked') || document.getElementById('reward')) return true;
  for (const el of document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], #inventory, #equipment, #skill-book, #forge, #settings, #trade')) {
    if (!el.hidden && el.offsetParent !== null) return true;
  }
  return false;
}

/** A page field has the keyboard (the chat). */
function typing(): boolean {
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
}

export class QuestMap {
  private readonly root = document.createElement('div');
  private readonly stage = document.createElement('div');
  private readonly foot = document.createElement('div');
  private world: WorldMap | null = null;
  private mode: 'hold' | 'tap' | null = null;
  private opening = 0;

  constructor(
    private readonly art: QuestMapArt,
    private readonly here: () => QuestMapHere,
  ) {
    this.root.id = 'quest-map';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Quest map');
    this.stage.className = 'qmap-stage';
    this.foot.className = 'qmap-foot';
    this.root.append(this.stage, this.foot);
    document.body.append(this.root);
    // A tap anywhere closes one opened by a tap.
    this.root.addEventListener('pointerdown', () => this.mode === 'tap' && this.hide());
    document.addEventListener('keydown', (e) => {
      if (!matches('questMap', e) || typing()) return;
      e.preventDefault(); // (Tab: never the page's focus)
      if (e.repeat || this.mode || windowOpen()) return;
      void this.show('hold');
    });
    document.addEventListener('keyup', () => this.mode === 'hold' && !held('questMap') && this.hide());
    addEventListener('blur', () => this.hide());
    addEventListener('resize', () => this.mode && this.draw());
  }

  get isOpen(): boolean {
    return !!this.mode;
  }

  /** Shows it: held (its key's up hides it) or tapped (the next tap does). */
  async show(mode: 'hold' | 'tap'): Promise<void> {
    if (mode === 'tap' && windowOpen()) return;
    this.mode = mode;
    const n = ++this.opening;
    this.world ??= await loadWorldMap(this.art);
    if (n !== this.opening || !this.mode) return;
    this.root.hidden = false;
    this.root.classList.toggle('qmap-tap', mode === 'tap'); // (takes the next tap)
    this.draw();
  }

  hide(): void {
    this.opening++;
    this.mode = null;
    this.root.hidden = true;
    this.stage.replaceChildren();
  }

  private draw(): void {
    const W = this.world;
    if (!W) return;
    const img = new Image();
    img.className = 'qmap-world';
    img.src = this.art.world;
    img.alt = 'The Town, the Slums and the Old Market';
    img.draggable = false;
    // 2× where it fits (a margin round it and room for the line under it), else 1×.
    const [w, h] = this.art.worldSize;
    const k = w * 2 + 32 <= innerWidth && h * 2 + 72 <= innerHeight ? 2 : 1;
    this.root.style.setProperty('--k', String(k));
    this.stage.style.width = `${w * k}px`;
    this.stage.style.height = `${h * k}px`;
    this.stage.replaceChildren(img);
    const marks = drawQuestMarks(this.stage, W, k, this.art.marks);
    // You: the Map menu's pin, its point on your spot.
    const spot = this.spot(W);
    if (spot) {
      const [pw, ph] = this.art.pinSize;
      const pin = new Image();
      pin.className = 'qmap-you';
      pin.src = this.art.pin;
      pin.alt = 'You';
      pin.style.width = `${pw * k}px`;
      pin.style.height = `${ph * k}px`;
      pin.style.left = `${Math.round((spot[0] - pw / 2) * k)}px`;
      pin.style.top = `${Math.round((spot[1] - ph) * k)}px`;
      this.stage.append(pin);
    }
    this.foot.textContent = marks.length ? '' : 'No quests to show on the map right now.';
    this.foot.hidden = !!marks.length;
  }

  /** Your pixel on the picture: your tile in the Town, the Slums or the Old Market (drawn in since 23 Oct 2026); in the
   *  neighbourhood the Town's way there, in a Warrens run the Slums' Warren Gate, in the Cellar the Old Market's Cellar Hatch (where you'd come out). */
  private spot(W: WorldMap): [number, number] | null {
    const at = this.here();
    if (!at) return null;
    if (at.area === 'town' || at.area === 'slums' || at.area === 'palengke') return worldPx(W.layout, at.area, at.col, at.row);
    if (at.area === 'hood') {
      const gate = middleOf(W.town.gates?.hood);
      return gate && worldPx(W.layout, 'town', gate[0], gate[1]);
    }
    // A run: where you'd come out (the Cellar: the Old Market's Cellar Hatch; the Warrens: the Slums' Warren Gate).
    if (at.area.startsWith('silong')) {
      const hatch = W.palengke?.arrive?.silong;
      return hatch ? worldPx(W.layout, 'palengke', hatch[0], hatch[1]) : null;
    }
    const out = W.slums.arrive?.warrens;
    return out ? worldPx(W.layout, 'slums', out[0], out[1]) : null;
  }
}
