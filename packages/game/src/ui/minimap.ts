import type { TownMap } from '../assets/types';

// 🗺️ The minimap (top right, above the HUD's buttons; it goes in the HUD's .th-map slot): the town's diamond from maps/town.json — grass, paths, the plaza,
// the river and the buildings' footprints — with a green dot for everyone else in town, a gold one for you, and a
// faint box for what the camera shows. The ground is drawn once; the dots every quarter second. Smaller on phones.

const GROUND: Record<string, string> = { grass: '#2D5240', path: '#565C75', plaza: '#7A8099', water: '#1D3F6E' };
const BUILDING = '#7C2AE8';
const OTHER = '#22C55E';
const YOU = '#FCDA4A';
const OUTLINE = '#111827';
const PHONE = '(max-width: 760px)';

export interface MinimapView {
  me: { col: number; row: number };
  others: { col: number; row: number }[];
  /** The camera's view, in world px (tile (col, row)'s top corner is at ((col - row) × 16, (col + row) × 8)). */
  camera: { x: number; y: number; width: number; height: number };
}

export class Minimap {
  readonly el = document.createElement('canvas');
  private readonly ground = document.createElement('canvas');
  private readonly phone = matchMedia(PHONE);
  private width = 0;
  private height = 0;
  private hw = 0; // minimap px per half tile width
  private ratio = 1;

  constructor(private readonly map: TownMap) {
    this.el.id = 'minimap';
    this.el.setAttribute('role', 'img');
    this.el.setAttribute('aria-label', 'Town map: you in gold, everyone else in green');
    (document.querySelector('#town-hud .th-map') ?? document.body).append(this.el);
    this.phone.addEventListener('change', () => this.layout());
    this.layout();
  }

  /** Sizes the canvases for the screen and draws the ground once. */
  private layout(): void {
    const [cols, rows] = this.map.size;
    this.width = this.phone.matches ? 132 : 216;
    this.hw = this.width / (cols + rows);
    this.height = Math.ceil((cols + rows) * this.hw * 0.5);
    this.ratio = Math.max(1, Math.round(window.devicePixelRatio || 1));
    for (const c of [this.el, this.ground]) {
      c.width = this.width * this.ratio;
      c.height = this.height * this.ratio;
    }
    this.el.style.width = `${this.width}px`;
    this.el.style.height = `${this.height}px`;

    const g = this.ground.getContext('2d')!;
    g.scale(this.ratio, this.ratio);
    const hw = this.hw;
    const tile = (c: number, r: number, colour: string) => {
      const { x, y } = this.at(c + 0.5, r + 0.5);
      g.fillStyle = colour;
      g.fillRect(x - hw, y - hw / 2, hw * 2, hw); // a little diamond's bounding box: the tiles mesh into the town's shape
    };
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) tile(c, r, GROUND[this.map.ground[r][c]] ?? GROUND.grass);
    for (const o of this.map.objects) {
      if (o.kind !== 'building') continue;
      for (let dc = 0; dc < o.footprint[0]; dc++) for (let dr = 0; dr < o.footprint[1]; dr++) tile(o.col + dc, o.row + dr, BUILDING);
    }
  }

  /** Minimap px for a tile position (col, row may be fractional: + 0.5 is a tile's middle). */
  private at(col: number, row: number): { x: number; y: number } {
    return { x: (col - row) * this.hw + this.width / 2, y: (col + row) * this.hw * 0.5 };
  }

  draw(v: MinimapView): void {
    const g = this.el.getContext('2d')!;
    g.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    g.clearRect(0, 0, this.width, this.height);
    g.drawImage(this.ground, 0, 0, this.width, this.height);

    // What the camera shows: world px → tiles (x / 16 = col − row, y / 8 = col + row) → minimap px.
    const k = this.hw / 16;
    g.strokeStyle = 'rgba(230, 233, 242, 0.55)';
    g.lineWidth = 1;
    g.strokeRect(Math.round(v.camera.x * k + this.width / 2) + 0.5, Math.round(v.camera.y * k) + 0.5, Math.round(v.camera.width * k), Math.round(v.camera.height * k));

    const r = this.phone.matches ? 2 : 2.5;
    const dot = (p: { col: number; row: number }, colour: string, size: number) => {
      const { x, y } = this.at(p.col + 0.5, p.row + 0.5);
      g.beginPath();
      g.arc(x, y, size, 0, Math.PI * 2);
      g.fillStyle = colour;
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = OUTLINE;
      g.stroke();
    };
    for (const p of v.others) dot(p, OTHER, r);
    dot(v.me, YOU, r + 1); // last, on top
  }
}
