import { type FriendView, type OutfitData, type TitleData, lastOnline } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { answer, askByName, blockByName, cancel, friends, onFriends, remove, unblock } from '../net/friends';
import { inParty, invite, mayInvite, onParty } from '../net/party';
import { areaName } from './party';

// 👥 Who's around: a small "N online" button beside the chat input (with the art's green status dot) that opens a
// panel with three tabs. Here: everyone in this area — you first — with their titles in their colours. Friends (CONTEXT.md
// Friend): add one by nickname, then each friend with their head, class badge, level and where they are while online
// (Whisper; Invite to party while they're in town), or when they were last online, and Remove (asks twice). Requests: those sent
// to you (Accept / Decline) and yours waiting (Cancel). Blocked (CONTEXT.md Block): block someone by nickname, and those
// you've blocked with Unblock. A dot on the button and the tab while a request waits for you.
// Plus the pop-up for a request that arrives while you're here. DOM text only; net/friends.ts has the state.

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

/** A friend's head and class badge (the party panel's). */
export interface FriendArt {
  portrait: (outfit: OutfitData) => Promise<HTMLCanvasElement | null>;
  badge: (cls: string | null | undefined) => { url: string; name: string } | null;
}

type Tab = 'here' | 'friends' | 'requests' | 'blocked';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class OnlineList {
  readonly el: HTMLElement;
  private readonly count: HTMLElement;
  private readonly list: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly tabs = el('div', 'on-tabs');
  private readonly body = el('div', 'on-body');
  /** Add a friend by nickname (kept as it is while the rows under it are redrawn: what's typed stays). */
  private readonly addForm = el('form', 'on-add');
  /** Block someone by nickname (the Blocked tab's, kept the same way). */
  private readonly blockForm = el('form', 'on-add');
  private readonly tabButtons = new Map<Tab, HTMLButtonElement>();
  private tab: Tab = 'here';
  private players: OnlinePlayer[] = [];
  /** Remove pressed once (its friend key): the second press removes. */
  private removing: string | null = null;
  /** Heads and badges for the Friends tab (members only: without it, only the Here tab). */
  art: FriendArt | null = null;
  /** Whisper: the chat on a whisper to a friend who's online (set by the town). */
  whisper: ((name: string) => void) | null = null;

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
    this.button.append(pip, this.count, el('span', 'on-ask-dot'));
    this.list = document.createElement('div');
    this.list.className = 'on-list';
    this.list.hidden = true;
    for (const [t, label] of [['here', 'Here'], ['friends', 'Friends'], ['requests', 'Requests'], ['blocked', 'Blocked']] as [Tab, string][]) {
      const b = el('button', 'on-tab', label);
      b.addEventListener('click', () => {
        playSound('click');
        this.tab = t;
        this.removing = null;
        this.draw();
      });
      this.tabButtons.set(t, b);
      this.tabs.append(b);
    }
    nameForm(this.addForm, 'Add a friend by nickname', 'Add', askByName);
    nameForm(this.blockForm, 'Block someone by nickname', 'Block', blockByName);
    this.list.append(this.tabs, this.addForm, this.blockForm, this.body);
    this.button.addEventListener('click', () => this.toggle());
    document.addEventListener('click', (e) => {
      if (!this.el.contains(e.target as Node)) this.toggle(false);
    });
    this.el.append(this.list, this.button);
    onFriends(() => this.draw());
    onParty(() => this.tab === 'friends' && this.draw());
    this.update([]);
  }

  update(players: OnlinePlayer[]): void {
    this.players = players;
    this.count.textContent = `${players.length} online`;
    this.button.setAttribute('aria-label', `${players.length} ${players.length === 1 ? 'person' : 'people'} here: show who, and your friends`);
    this.draw();
  }

  /** Opens the panel on a tab (`/friend` alone, the request pop-up's "see all"). */
  open(tab: Tab): void {
    this.tab = tab;
    this.toggle(true);
  }

  private draw(): void {
    const F = friends();
    const asks = F.incoming.length;
    this.button.classList.toggle('on-asked', !!this.art && asks > 0);
    this.tabs.hidden = !this.art;
    if (!this.art) this.tab = 'here';
    const on = F.friends.filter((f) => f.online).length;
    this.tabButtons.get('here')!.textContent = `Here ${this.players.length}`;
    this.tabButtons.get('friends')!.textContent = F.friends.length ? `Friends ${on}/${F.friends.length}` : 'Friends';
    this.tabButtons.get('requests')!.textContent = asks ? `Requests ${asks}` : 'Requests';
    this.tabButtons.get('requests')!.classList.toggle('on-asked', asks > 0);
    for (const [t, b] of this.tabButtons) b.setAttribute('aria-pressed', String(t === this.tab));
    this.addForm.hidden = this.tab !== 'friends';
    this.blockForm.hidden = this.tab !== 'blocked';
    if (this.list.hidden) return; // (the rows, heads and all, only while it's open)
    const rows = { here: () => this.here(), friends: () => this.friendRows(), requests: () => this.requestRows(), blocked: () => this.blockedRows() }[this.tab];
    this.body.replaceChildren(...rows());
  }

  private here(): HTMLElement[] {
    return this.players.map((p) => {
      const row = el('div', 'on-row');
      const name = el('span', p.me ? 'on-me' : 'on-name', p.me ? `${p.name} (you)` : p.name);
      const t = el('span', 'on-ptitle', `<${p.title.name}>`);
      if (p.title.color === 'prismatic') t.classList.add('prismatic');
      else t.style.color = p.title.color;
      row.append(name, t);
      return row;
    });
  }

  private friendRows(): HTMLElement[] {
    const list = friends().friends;
    if (!list.length) return [el('p', 'on-empty', 'No friends yet. Add someone by nickname, or click a player in town and choose Add friend.')];
    return list.map((f) => this.friendRow(f));
  }

  private friendRow(f: FriendView): HTMLElement {
    const row = el('div', `on-friend${f.online ? '' : ' on-off'}`);
    const face = el('span', 'on-face');
    if (f.outfit) void this.art?.portrait(f.outfit).then((c) => c && face.append(c));
    const words = el('span', 'on-words');
    const line = el('span', 'on-line');
    const badge = this.art?.badge(f.cls);
    if (badge) {
      const img = el('img', 'on-badge');
      img.src = badge.url;
      img.alt = '';
      img.title = badge.name;
      line.append(img);
    }
    line.append(el('b', 'on-fname', f.name));
    if (f.level) line.append(el('span', 'on-lv', `Lv ${f.level}`));
    const where = f.online ? areaName(f.area) : f.lastSeen ? `Last online: ${lastOnline(f.lastSeen, Date.now())}` : 'Offline';
    words.append(line, el('span', 'on-where', where));
    const acts = el('span', 'on-acts');
    if (f.online && this.whisper) {
      const w = el('button', 'on-act', 'Whisper');
      w.addEventListener('click', () => {
        playSound('click');
        this.toggle(false);
        this.whisper?.(f.name);
      });
      acts.append(w);
    }
    if (f.id && !inParty(f.id) && mayInvite()) {
      const b = el('button', 'on-act', 'Invite');
      b.title = 'Invite to party';
      b.addEventListener('click', () => {
        playSound('click');
        if (invite(f.id!)) {
          b.disabled = true;
          b.textContent = 'Sent';
        }
      });
      acts.append(b);
    }
    const out = el('button', 'on-act on-danger', this.removing === f.key ? 'Sure?' : 'Remove');
    out.title = `Remove ${f.name} from your friends (for both of you)`;
    out.addEventListener('click', () => {
      playSound('click');
      if (this.removing !== f.key) {
        this.removing = f.key;
        return this.draw();
      }
      this.removing = null;
      remove(f.key);
    });
    acts.append(out);
    row.append(face, words, acts);
    row.setAttribute('aria-label', `${f.name}, ${where}`);
    return row;
  }

  private requestRows(): HTMLElement[] {
    const F = friends();
    const rows: HTMLElement[] = [];
    const row = (name: string, note: string, buttons: [string, string, () => void][]) => {
      const r = el('div', 'on-req');
      const words = el('span', 'on-words');
      words.append(el('b', 'on-fname', name), el('span', 'on-where', note));
      const acts = el('span', 'on-acts');
      for (const [label, cls, act] of buttons) {
        const b = el('button', `on-act ${cls}`, label);
        b.addEventListener('click', () => {
          playSound('click');
          act();
        });
        acts.append(b);
      }
      r.append(words, acts);
      return r;
    };
    if (F.incoming.length) rows.push(el('div', 'on-title', 'Sent to you'));
    for (const r of F.incoming) rows.push(row(r.name, 'Wants to be friends', [['Decline', '', () => answer(r.key, false)], ['Accept', 'on-yes', () => answer(r.key, true)]]));
    if (F.outgoing.length) rows.push(el('div', 'on-title', 'Waiting for an answer'));
    for (const r of F.outgoing) rows.push(row(r.name, `Sent ${lastOnline(r.at, Date.now()).toLowerCase()}`, [['Cancel', '', () => cancel(r.key)]]));
    if (!rows.length) rows.push(el('p', 'on-empty', 'No friend requests waiting.'));
    return rows;
  }

  private blockedRows(): HTMLElement[] {
    const list = friends().blocked;
    if (!list.length) return [el('p', 'on-empty', 'Nobody blocked. A player you block can’t whisper you, send you friend requests, invite you to a party or ask you to trade. Their chat in General still shows.')];
    return list.map((b) => {
      const r = el('div', 'on-req');
      const words = el('span', 'on-words');
      words.append(el('b', 'on-fname', b.name), el('span', 'on-where', `Blocked ${lastOnline(b.at, Date.now()).toLowerCase()}`));
      const out = el('button', 'on-act', 'Unblock');
      out.addEventListener('click', () => {
        playSound('click');
        unblock(b.key);
      });
      const acts = el('span', 'on-acts');
      acts.append(out);
      r.append(words, acts);
      return r;
    });
  }

  private toggle(show = this.list.hidden): void {
    this.list.hidden = !show;
    this.button.setAttribute('aria-expanded', String(show));
    if (!show) return void (this.removing = null);
    this.draw();
    // Kept on screen: it hangs from the button's right edge, which on a phone is near the left of the screen.
    this.list.style.right = '';
    const left = this.list.getBoundingClientRect().left;
    if (left < 8) this.list.style.right = `${left - 8}px`;
  }
}

/** A nickname box with its button (`go` with what's typed); typing never walks or opens doors. */
function nameForm(form: HTMLFormElement, placeholder: string, label: string, go: (name: string) => void): void {
  const input = el('input', 'on-add-name');
  input.placeholder = placeholder;
  input.maxLength = 16;
  input.setAttribute('aria-label', placeholder);
  input.addEventListener('keydown', (e) => e.stopPropagation());
  const button = el('button', 'on-add-go', label);
  button.type = 'submit';
  form.append(input, button);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    playSound('click');
    go(name);
    input.value = '';
  });
}

/** A friend request arriving while you're here: who, Accept / Decline, or × to answer later (in the Requests tab). */
export function showFriendRequest(o: { name: string; answer: (accept: boolean) => void }): void {
  const box = el('div', 'pt-invite fr-ask');
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-label', `Friend request from ${o.name}`);
  const text = el('p', 'pt-invite-text');
  text.append(el('b', undefined, o.name), ' wants to be your friend.');
  const later = el('button', 'fr-later', '×');
  later.setAttribute('aria-label', 'Later');
  later.title = 'Later (it waits in Requests)';
  const yes = el('button', 'pt-yes', 'Accept');
  const no = el('button', 'pt-no', 'Decline');
  const row = el('div', 'pt-invite-row');
  row.append(no, yes);
  box.append(later, text, row);
  let stack = document.getElementById('party-invites');
  if (!stack) {
    stack = el('div');
    stack.id = 'party-invites';
    document.body.append(stack);
  }
  stack.append(box);
  playSound('click');
  const done = (accept: boolean | null) => {
    box.remove();
    if (accept === null) return;
    playSound('click');
    o.answer(accept);
  };
  yes.addEventListener('click', () => done(true));
  no.addEventListener('click', () => done(false));
  later.addEventListener('click', () => done(null));
  // (Answered elsewhere, from the Requests tab or another tab: gone.)
  const off = onFriends(() => {
    if (friends().incoming.some((r) => r.name === o.name)) return;
    off();
    box.remove();
  });
}
