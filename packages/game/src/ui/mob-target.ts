// 🎯 The targeted mob (Z, or a click on one): an info bar at the top of the screen like a picked player's — its name, its
// level, its HP (full: there's no combat yet) and its zone. DOM only; world/mobs.ts picks the mob and rings it.

export interface MobInfo {
  name: string;
  level: number;
  zone: string;
  /** 0–1. */
  hp: number;
  /** The field boss (its boss bar, while up, says it all: this one hides). */
  boss?: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class MobTargetBox {
  private readonly root = el('div');
  private readonly name = el('span', 'mt-name');
  private readonly level = el('span', 'mt-level');
  private readonly fill = el('span', 'mt-fill');
  private readonly zone = el('span', 'mt-zone');

  constructor() {
    this.root.id = 'mob-target';
    this.root.hidden = true;
    this.root.setAttribute('role', 'status');
    const top = el('div', 'mt-top');
    top.append(this.name, this.level);
    const bar = el('div', 'mt-bar');
    bar.append(this.fill);
    this.root.append(top, bar, this.zone);
    document.body.append(this.root);
  }

  show(m: MobInfo | null): void {
    this.root.hidden = !m;
    if (!m) return;
    this.root.classList.toggle('mt-boss', !!m.boss);
    this.name.textContent = m.name;
    this.level.textContent = `Lv ${m.level}`;
    this.fill.style.width = `${Math.round(Math.max(0, Math.min(1, m.hp)) * 100)}%`;
    this.zone.textContent = m.zone;
  }

  destroy(): void {
    this.root.remove();
  }
}
