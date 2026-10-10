import type { OutfitData, PartyMember } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { disband, kick, leading, leave, onMemberHp, onParty, party } from '../net/party';

// 🎉 The party panel (left side, under the quest tracker): each member's head, name (party pink), class badge and where
// they are (Town, Neighbourhood, Slums, or Away for a minute after they drop), the leader's crown, "you" and a thin HP bar
// (following their HP live, wherever they are). A small
// icon on its top opens Leave party (a leader's lead passes to the next member) and, for the leader, Disband party. The
// leader can right-click a member for Kick from party. Plus the invite pop-up someone gets (Accept / Decline, gone
// after a minute). DOM only; net/party.ts has the state and sends the actions.

const AREAS: Record<string, string> = { town: 'Town', hood: 'Neighbourhood', slums: 'Slums' };
const INVITE_MS = 60_000;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export interface PartyArt {
  /** A member's head (their look, loaded if need be), for the row. */
  portrait: (outfit: OutfitData) => Promise<HTMLCanvasElement | null>;
  /** A class's small badge, if they have one. */
  badge: (cls: string | null | undefined) => { url: string; name: string } | null;
}

export class PartyPanel {
  private readonly root = el('div');
  private readonly count = el('span', 'pt-count');
  private readonly opts = el('button', 'pt-opts');
  private readonly optMenu = el('div', 'pt-menu');
  private readonly list = el('div', 'pt-list');
  private readonly kickMenu = el('div', 'pt-menu pt-kick-menu');
  private disbandArmed = false;
  /** Each member's HP bar (by party key). */
  private readonly hpBars = new Map<string, HTMLElement>();

  constructor(private readonly art: PartyArt) {
    this.root.id = 'party';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Your party');
    const head = el('div', 'pt-head');
    this.opts.setAttribute('aria-label', 'Party options');
    this.opts.setAttribute('aria-haspopup', 'menu');
    this.opts.title = 'Leave or disband';
    this.opts.append(exitIcon());
    this.opts.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleOptions();
    });
    head.append(el('span', 'pt-title', 'Party'), this.count, this.opts);
    this.optMenu.hidden = true;
    this.kickMenu.hidden = true;
    this.root.append(head, this.optMenu, this.list);
    document.body.append(this.root, this.kickMenu);
    // A press anywhere else closes the menus.
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as Node;
      if (!this.optMenu.hidden && !this.optMenu.contains(t) && !this.opts.contains(t)) this.closeOptions();
      if (!this.kickMenu.hidden && !this.kickMenu.contains(t)) this.kickMenu.hidden = true;
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      this.closeOptions();
      this.kickMenu.hidden = true;
    });
    onParty(() => this.draw());
    onMemberHp((key, hp, maxHp) => {
      const bar = this.hpBars.get(key);
      if (bar) setHp(bar, hp, maxHp);
    });
    this.draw();
    // Under the quest tracker (or, without it, under the profile in the top-left corner).
    const place = () => {
      const tracker = document.getElementById('warrens-tracker') ?? document.getElementById('quest-tracker'); // (the Warrens' replaces the quests')
      const above = tracker && !tracker.hidden && getComputedStyle(tracker).display !== 'none' ? tracker : document.querySelector('#town-hud .th-left');
      this.root.style.top = `${Math.round((above?.getBoundingClientRect().bottom ?? 0) + 10)}px`;
    };
    const watch = new ResizeObserver(place);
    for (const n of [document.getElementById('quest-tracker'), document.querySelector('#town-hud .th-left')]) if (n) watch.observe(n);
    addEventListener('resize', place);
    onParty(place);
    place();
  }

  private draw(): void {
    const p = party();
    this.root.hidden = !p;
    document.body.classList.toggle('party-on', !!p);
    this.closeOptions();
    this.kickMenu.hidden = true;
    if (!p) return;
    this.count.textContent = `${p.members.length}/${p.max}`;
    this.hpBars.clear();
    this.list.replaceChildren(...p.members.map((m) => this.row(m, m.key === p.leader, m.key === p.you)));
  }

  private row(m: PartyMember, leader: boolean, you: boolean): HTMLElement {
    const row = el('div', 'pt-row');
    if (!m.id) row.classList.add('pt-away');
    const face = el('span', 'pt-face');
    void this.art.portrait(m.outfit).then((c) => c && face.append(c));
    const words = el('span', 'pt-words');
    const line = el('span', 'pt-line');
    const badge = this.art.badge(m.cls);
    if (badge) {
      const img = el('img', 'pt-badge');
      img.src = badge.url;
      img.alt = '';
      img.title = badge.name;
      line.append(img);
    }
    line.append(el('b', 'pt-name', m.nickname));
    if (m.level) line.append(el('span', 'pt-lv', `Lv ${m.level}`));
    if (leader) {
      const crown = el('span', 'pt-crown', '♛');
      crown.title = 'Party leader';
      line.append(crown);
    }
    if (you) line.append(el('span', 'pt-you', 'you'));
    const hp = el('span', 'pt-hp');
    hp.append(el('span', 'pt-hp-fill'));
    hp.hidden = true;
    if (m.maxHp) setHp(hp, m.hp ?? m.maxHp, m.maxHp);
    this.hpBars.set(m.key, hp);
    words.append(line, el('span', 'pt-where', m.id ? (m.area?.startsWith('warrens:') ? 'Scrap Warrens' : (AREAS[m.area ?? ''] ?? 'Town')) : 'Away'), hp);
    row.append(face, words);
    row.setAttribute('aria-label', `${m.nickname}${leader ? ', leader' : ''}${you ? ', you' : ''}`);
    // The leader: right-click a member to kick them.
    if (leading() && !you) {
      row.title = 'Right-click to kick';
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showKick(m, e.clientX, e.clientY);
      });
    }
    return row;
  }

  private showKick(m: PartyMember, x: number, y: number): void {
    const b = el('button', 'pt-item pt-danger', `Kick ${m.nickname} from the party`);
    b.addEventListener('click', () => {
      playSound('click');
      kick(m.key);
      this.kickMenu.hidden = true;
    });
    this.kickMenu.replaceChildren(b);
    this.kickMenu.hidden = false;
    const r = this.kickMenu.getBoundingClientRect();
    this.kickMenu.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
    this.kickMenu.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
  }

  private toggleOptions(): void {
    if (!this.optMenu.hidden) return this.closeOptions();
    const p = party();
    if (!p) return;
    playSound('click');
    const next = p.members.find((m) => m.key !== p.leader);
    const out = el('button', 'pt-item', 'Leave party');
    if (leading() && next) out.title = `${next.nickname} will lead the party`;
    out.addEventListener('click', () => {
      playSound('click');
      leave();
      this.closeOptions();
    });
    this.optMenu.replaceChildren(out);
    if (leading()) {
      const end = el('button', 'pt-item pt-danger', 'Disband party');
      end.addEventListener('click', () => {
        playSound('click');
        // A second press to be sure.
        if (!this.disbandArmed) {
          this.disbandArmed = true;
          end.textContent = 'Sure? Disband';
          return;
        }
        disband();
        this.closeOptions();
      });
      this.optMenu.append(end);
    }
    this.optMenu.hidden = false;
    this.opts.setAttribute('aria-expanded', 'true');
  }

  private closeOptions(): void {
    this.optMenu.hidden = true;
    this.disbandArmed = false;
    this.opts.setAttribute('aria-expanded', 'false');
  }
}

/** A member's HP bar: how full, the numbers on hover. */
function setHp(bar: HTMLElement, hp: number, maxHp: number): void {
  bar.hidden = false;
  (bar.firstElementChild as HTMLElement).style.width = `${Math.min(100, (hp / Math.max(1, maxHp)) * 100)}%`;
  bar.title = `HP ${hp} / ${maxHp}`;
}

/** A door with an arrow out (the options icon), drawn in CSS pixels. */
function exitIcon(): HTMLElement {
  const i = el('span', 'pt-exit');
  i.setAttribute('aria-hidden', 'true');
  return i;
}

/** Someone invites you: who, how big the party is, Accept / Decline; it goes by itself after a minute. One at a time
 *  per inviter (a new one from them replaces it). */
export function showPartyInvite(o: { invite: string; name: string; members: number; answer: (accept: boolean) => void }): void {
  const box = el('div', 'pt-invite');
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-label', `Party invite from ${o.name}`);
  const text = el('p', 'pt-invite-text');
  text.append(el('b', undefined, o.name), ` invites you to ${o.members > 1 ? `their party (${o.members}/6)` : 'a party'}.`);
  const timer = el('span', 'pt-invite-bar');
  const yes = el('button', 'pt-yes', 'Accept');
  const no = el('button', 'pt-no', 'Decline');
  const row = el('div', 'pt-invite-row');
  row.append(no, yes);
  box.append(text, row, timer);
  let stack = document.getElementById('party-invites');
  if (!stack) {
    stack = el('div');
    stack.id = 'party-invites';
    document.body.append(stack);
  }
  stack.append(box);
  playSound('click');
  timer.style.animationDuration = `${INVITE_MS}ms`;
  const done = (accept: boolean | null) => {
    clearTimeout(lapse);
    box.remove();
    if (accept !== null) {
      playSound('click');
      o.answer(accept);
    }
  };
  const lapse = setTimeout(() => done(null), INVITE_MS);
  yes.addEventListener('click', () => done(true));
  no.addEventListener('click', () => done(false));
}
