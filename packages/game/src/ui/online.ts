import type { TitleData } from '@mikazuki/shared';

// 👥 Who's in town: a small "N online" button beside the chat input (with the art's green status dot) that opens a
// list of everyone here — you first — with their titles in their colours. DOM text only.

export interface OnlinePlayer {
  name: string;
  title: TitleData;
  me?: boolean;
}

/** The art's status dot for "online" (manifest ui.statusDots), as a CSS sprite. */
export interface DotArt {
  url: string;
  size: number;
  frame: number;
  frames: number;
}

export class OnlineList {
  readonly el: HTMLElement;
  private readonly count: HTMLElement;
  private readonly list: HTMLElement;
  private readonly button: HTMLButtonElement;

  constructor(dot: DotArt | null) {
    this.el = document.createElement('div');
    this.el.className = 'on-wrap';
    this.button = document.createElement('button');
    this.button.className = 'on-open';
    this.button.setAttribute('aria-expanded', 'false');
    const pip = document.createElement('span');
    pip.className = 'on-dot';
    if (dot) {
      const z = 2;
      pip.style.backgroundImage = `url("${dot.url}")`;
      pip.style.backgroundSize = `${dot.size * dot.frames * z}px ${dot.size * z}px`;
      pip.style.backgroundPosition = `-${dot.frame * dot.size * z}px 0`;
      pip.style.width = pip.style.height = `${dot.size * z}px`;
    }
    this.count = document.createElement('span');
    this.button.append(pip, this.count);
    this.list = document.createElement('div');
    this.list.className = 'on-list';
    this.list.hidden = true;
    this.button.addEventListener('click', () => this.toggle());
    document.addEventListener('click', (e) => {
      if (!this.el.contains(e.target as Node)) this.toggle(false);
    });
    this.el.append(this.list, this.button);
    this.update([]);
  }

  update(players: OnlinePlayer[]): void {
    this.count.textContent = `${players.length} online`;
    this.button.setAttribute('aria-label', `${players.length} ${players.length === 1 ? 'person' : 'people'} in town: show who`);
    const title = document.createElement('div');
    title.className = 'on-title';
    title.textContent = 'In town now';
    const rows = players.map((p) => {
      const row = document.createElement('div');
      row.className = 'on-row';
      const name = document.createElement('span');
      name.className = p.me ? 'on-me' : 'on-name';
      name.textContent = p.me ? `${p.name} (you)` : p.name;
      const t = document.createElement('span');
      t.className = 'on-ptitle';
      t.textContent = `<${p.title.name}>`;
      if (p.title.color === 'prismatic') t.classList.add('prismatic');
      else t.style.color = p.title.color;
      row.append(name, t);
      return row;
    });
    this.list.replaceChildren(title, ...rows);
  }

  private toggle(show = this.list.hidden): void {
    this.list.hidden = !show;
    this.button.setAttribute('aria-expanded', String(show));
  }
}
