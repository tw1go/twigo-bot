// 🗿 The field boss's bar (the Scrapheap Golem): wide, top centre, while its fight is on and you're within its leash —
// its name, level and HP (the numbers too), the bar going red when it enrages. DOM only; world/golem.ts says when.
// While it's up, body.boss-on moves the mob info bar under it (and hides that bar when it's showing the golem too).

export interface BossInfo {
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  enraged: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class BossBar {
  private readonly root = el('div');
  private readonly name = el('span', 'bb-name');
  private readonly level = el('span', 'bb-level');
  private readonly fill = el('span', 'bb-fill');
  private readonly hp = el('span', 'bb-hp');
  /** What it shows now (so a frame that changes nothing writes nothing). */
  private shown = '';

  constructor() {
    this.root.id = 'boss-bar';
    this.root.hidden = true;
    this.root.setAttribute('role', 'status');
    const top = el('div', 'bb-top');
    top.append(this.name, this.level);
    const bar = el('div', 'bb-bar');
    bar.append(this.fill, this.hp);
    this.root.append(top, bar);
    document.body.append(this.root);
  }

  show(b: BossInfo | null): void {
    const key = b ? `${b.name}|${b.level}|${b.hp}|${b.maxHp}|${b.enraged}` : '';
    if (key === this.shown) return;
    this.shown = key;
    this.root.hidden = !b;
    document.body.classList.toggle('boss-on', !!b);
    if (!b) return;
    this.name.textContent = b.name;
    this.level.textContent = `Lv ${b.level}`;
    this.fill.style.width = `${Math.max(0, Math.min(100, (b.hp / Math.max(1, b.maxHp)) * 100)).toFixed(1)}%`;
    this.hp.textContent = `${b.hp.toLocaleString('en')} / ${b.maxHp.toLocaleString('en')}`;
    this.root.classList.toggle('bb-enraged', b.enraged);
  }

  destroy(): void {
    this.root.remove();
    document.body.classList.remove('boss-on');
  }
}
