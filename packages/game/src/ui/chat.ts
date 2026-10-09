import type { ChatItemLink, Item } from '@mikazuki/shared';
import { playSound } from '../audio/sound';

export type ChatChannel = 'general' | 'megaphone' | 'party' | 'gm';
const CHANNELS: Record<ChatChannel, { tag: string; hint: string; placeholder: string; key: string }> = {
  general: { tag: 'General', hint: 'General chat (/m for the megaphone, /p for your party)', placeholder: 'Press Enter to chat', key: 'g' },
  megaphone: { tag: 'Megaphone', hint: 'Megaphone: uses one from your bag and runs across everyone’s screen (/g for general)', placeholder: 'Say it to the whole town', key: 'm' },
  party: { tag: 'Party', hint: 'Party chat: only your party sees it (/g for general)', placeholder: 'Say it to your party', key: 'p' },
  gm: { tag: 'GM', hint: 'Game Master: gold, across everyone’s screen and in Discord, free (/g for general)', placeholder: 'Say it as the Game Master', key: 'gm' },
};
/** The channel tag's order when clicked (the GM channel only for Game Masters). */
const ORDER: ChatChannel[] = ['general', 'megaphone', 'party', 'gm'];

// 💬 The town's chat box (bottom left): one see-through box with the last messages and names (Discord's mark for
// people chatting from the linked Discord channel) and the input under them. Enter opens the input, Enter sends (and keeps it open), an empty Enter or Esc closes it. Messages go to everyone in
// town as speech bubbles too (TownScene). DOM text only: names and messages are never parsed as HTML. On phones the box
// folds away behind a chat button (bottom left; a dot when something new arrives while it's closed).
// Three channels: General (white), Megaphone (sky blue: uses a megaphone from the bag and runs across everyone's
// screen) and Party (pink: your party only, wherever they are; net/party.ts). `/m`, `/g` or `/p message` say it there
// and stay on that channel; `/m`, `/g` or `/p` alone just switch, and the tag before the input shows (and switches,
// General → Megaphone → Party) which one you're on. Game Masters (the server says so in `welcome`) have a fourth, GM
// (gold, `/gm`): free, across everyone's screen like a megaphone, gold in the log.
// Items: Alt+click one in your bag or equipment panel (the 'mk-chat-item' event) writes "[its name]" into the input; the
// line goes with its uid and the server checks it's yours. In the log a shown item is its name in its rarity's colour,
// and a click on it opens its tooltip (`showItem`, set by the town).


const MAX_LINES = 60;
/** After this long without a message (and not being used), the box fades to the background. */
const IDLE_MS = 15_000;
/** Discord's mark (Simple Icons, CC0), before the names of people chatting from the Discord channel. */
const DISCORD_PATH =
  'M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.011c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z';

function discordMark(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'ch-discord');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'from Discord');
  const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  title.textContent = 'Chatting from Discord';
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', DISCORD_PATH);
  svg.append(title, path);
  return svg;
}
const MAX_LENGTH = 120;
/** Items shown in one message at most (the server takes no more). */
const MAX_LINKS = 3;
/** Phone-sized screens fold the chat away behind its button. */
const PHONE = '(max-width: 560px), (max-height: 500px)';

/** Lines remembered for a reconnect (more than the server keeps). */
const HEARD = 40;
const heardKey = (name: string, text: string, discord: boolean) => `${discord ? 'd' : 't'}|${name}|${text}`;

export class ChatBox {
  /** The chat lines shown lately (as the server sends them), so a reconnect only adds what's new. */
  private readonly heard: string[] = [];
  private readonly root: HTMLElement;
  /** The channel tag before the input: General, Megaphone or Party (click to switch). */
  private readonly channel: HTMLButtonElement;
  private current: ChatChannel = 'general';
  /** A Game Master: the GM channel is there. */
  private gmOn = false;
  private readonly log: HTMLElement;
  private readonly input: HTMLInputElement;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  /** The phone's chat button (hidden on bigger screens). */
  private readonly toggle: HTMLButtonElement;

  /** Items written into the input so far ("[name]" → its uid), sent with the message if still in it. */
  private readonly pending = new Map<string, string>();

  constructor(
    /** Sends a message on a channel (with the uids of the items shown in it); false if it couldn't go (not connected). */
    private readonly send: (text: string, channel: ChatChannel, links: string[]) => boolean,
    /** Extra controls beside the input (the emote picker). */
    tools: HTMLElement | null = null,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'chat';
    this.log = document.createElement('div');
    this.log.className = 'ch-log';
    this.log.setAttribute('role', 'log');
    this.log.setAttribute('aria-label', 'Chat');
    this.input = document.createElement('input');
    this.input.className = 'ch-input';
    this.input.maxLength = MAX_LENGTH;
    this.input.placeholder = 'Press Enter to chat';
    this.input.setAttribute('aria-label', 'Chat message');
    this.input.autocomplete = 'off';
    this.input.enterKeyHint = 'send';
    this.channel = document.createElement('button');
    this.channel.className = 'ch-channel';
    this.channel.type = 'button';
    this.channel.addEventListener('click', () => {
      const order = ORDER.filter((c) => c !== 'gm' || this.gmOn);
      this.setChannel(order[(order.indexOf(this.current) + 1) % order.length]);
      this.input.focus();
    });
    this.setChannel('general');
    const row = document.createElement('div');
    row.className = 'ch-row';
    row.append(this.channel, this.input);
    if (tools) row.append(tools);
    this.root.append(this.log, row);
    this.toggle = document.createElement('button');
    this.toggle.id = 'chat-toggle';
    this.toggle.textContent = 'Chat';
    this.toggle.setAttribute('aria-controls', 'chat');
    this.toggle.setAttribute('aria-expanded', 'false');
    this.toggle.addEventListener('click', () => this.setOpen(!document.body.classList.contains('chat-open')));
    document.body.append(this.root, this.toggle);
    // Clicking the log opens the chat too; pressing anywhere outside the box closes it (the town's canvas stops the
    // browser doing that by itself, as Phaser cancels the default of presses on it).
    this.log.addEventListener('click', () => this.input.focus());
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (document.activeElement === this.input && !this.root.contains(e.target as Node)) this.input.blur();
      },
      true,
    );
    // Quiet for a while → faded; a message, a hover or typing → back to full.
    this.root.addEventListener('mouseenter', () => this.wake());
    this.root.addEventListener('mouseleave', () => this.wake());
    this.input.addEventListener('focus', () => this.wake());
    this.input.addEventListener('blur', () => this.wake());
    this.wake();

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const text = this.input.value.trim();
        this.input.value = '';
        // Sending keeps the chat open for the next message (so its letters never walk you); an empty Enter closes it.
        if (!text) return this.input.blur();
        // /m, /g, /p (and a GM's /gm) pick the channel (and stay on it); alone they only switch.
        const pick = /^\/(gm|[mgp])(?:\s+|$)/i.exec(text);
        if (pick?.[1].toLowerCase() === 'gm' && !this.gmOn) return this.notice('Only Game Masters can use /gm.');
        if (pick) this.setChannel((Object.keys(CHANNELS) as ChatChannel[]).find((c) => CHANNELS[c].key === pick[1].toLowerCase())!);
        const said = pick ? text.slice(pick[0].length).trim() : text;
        if (!said) return;
        const links = [...this.pending].filter(([label]) => said.includes(`[${label}]`)).map(([, uid]) => uid).slice(0, MAX_LINKS);
        this.pending.clear();
        if (!this.send(said, this.current, links)) this.notice('Chat is offline right now.');
      } else if (e.key === 'Escape') {
        this.input.blur();
      }
      e.stopPropagation(); // typing never walks or opens doors
    });
    // An item Alt+clicked in the bag or the equipment panel: "[its name]" where the cursor is.
    addEventListener('mk-chat-item', (e) => {
      const { label, uid } = (e as CustomEvent<{ label: string; uid: string }>).detail;
      if (this.pending.size >= MAX_LINKS && !this.pending.has(label)) return this.notice(`Up to ${MAX_LINKS} items a message.`);
      const word = `[${label}]`;
      const at = document.activeElement === this.input ? (this.input.selectionStart ?? this.input.value.length) : this.input.value.length;
      const before = this.input.value.slice(0, at);
      const text = `${before}${before && !before.endsWith(' ') ? ' ' : ''}${word} ${this.input.value.slice(at)}`.trimEnd() + ' ';
      if (text.length > MAX_LENGTH) return this.notice('That won’t fit in this message.');
      this.pending.set(label, uid);
      this.setOpen(true);
      this.input.value = text;
      this.input.focus();
      this.input.setSelectionRange(text.length, text.length);
    });
    // Enter anywhere else opens the chat (unless another box or dialog has the focus).
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.defaultPrevented || document.activeElement !== document.body) return;
      if (document.getElementById('reward') || document.getElementById('elsewhere') || document.getElementById('settings') || document.getElementById('creator')) return;
      e.preventDefault();
      this.setOpen(true);
      this.input.focus();
    });
  }

  /** General (white), Megaphone (sky blue) or Party (pink): the tag, the input's colour and its hint. */
  private setChannel(channel: ChatChannel): void {
    const c = CHANNELS[channel];
    this.current = channel;
    this.channel.textContent = c.tag;
    this.channel.title = c.hint;
    this.channel.setAttribute('aria-label', `Channel: ${c.tag}. Switch`);
    this.root.classList.toggle('ch-mega-mode', channel === 'megaphone');
    this.root.classList.toggle('ch-party-mode', channel === 'party');
    this.root.classList.toggle('ch-gm-mode', channel === 'gm');
    this.input.placeholder = c.placeholder;
  }

  /** Whether you're a Game Master (the server's `welcome`): the GM channel comes and goes with it. */
  setGm(on: boolean): void {
    this.gmOn = on;
    if (!on && this.current === 'gm') this.setChannel('general');
  }

  /** Someone's name in the log was clicked: their town id when the line has it (else just the name), and the name
   *  itself (the player menu opens beside it). Set by the town for members. */
  onName: ((who: { id?: string; name: string }, anchor: HTMLElement) => void) | null = null;

  /** The class badge (16x16) of whoever said a line in town (`me`, or their town id), or null without a class or
   *  when it isn't known yet. Only players' own lines get one: never system lines. Set by the town. */
  badgeFor: ((from: 'me' | 'town', id?: string) => { url: string; name: string } | null) | null = null;

  /** A name in the log, then `after`. Someone else in town (`clickable`) gets a button for the player menu. */
  private speaker(name: string, after: string, className: string, clickable: boolean, id?: string): Node[] {
    const who = document.createElement('b');
    who.className = className;
    who.textContent = name;
    if (clickable && this.onName) {
      who.classList.add('ch-click');
      who.tabIndex = 0;
      who.setAttribute('role', 'button');
      who.title = `${name}: open the menu`;
      const open = (e: Event) => {
        e.stopPropagation(); // not the log's own click, which opens the chat
        this.onName?.({ id, name }, who);
      };
      who.addEventListener('click', open);
      who.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        open(e);
      });
    }
    return [who, document.createTextNode(after)];
  }

  /** A message in the log (from Discord: with Discord's mark before the name; through a megaphone: sky blue; to the
   *  party: pink, after a "Party" tag). `id`: the speaker's town id. */
  add(name: string, text: string, from: 'me' | 'town' | 'discord' = 'town', id?: string, megaphone: boolean | 'party' | 'gm' = false, links: ChatItemLink[] = []): void {
    const party = megaphone === 'party';
    const gm = megaphone === 'gm';
    if (!party) {
      this.heard.push(heardKey(name, text, from === 'discord'));
      if (this.heard.length > HEARD) this.heard.shift();
    }
    const line = document.createElement('div');
    line.className = party ? 'ch-line ch-party' : gm ? 'ch-line ch-gm' : megaphone ? 'ch-line ch-mega' : 'ch-line';
    if (megaphone === true) line.title = 'Megaphone';
    if (gm) line.title = 'Game Master';
    if (party) line.append(Object.assign(document.createElement('span'), { className: 'ch-party-tag', textContent: 'Party' }));
    if (from === 'discord') line.append(discordMark());
    const badge = from !== 'discord' ? this.badgeFor?.(from, id) : null;
    if (badge) {
      const img = document.createElement('img');
      img.className = 'ch-badge';
      img.src = badge.url;
      img.alt = '';
      img.title = badge.name;
      line.append(img);
    }
    line.append(...this.speaker(name, ': ', from === 'me' ? 'ch-me' : 'ch-name', from === 'town', id), ...this.withItems(text, links));
    this.push(line);
  }

  /** A shown item was clicked: its tooltip beside the name (set by the town). */
  showItem: ((item: Item, anchor: HTMLElement) => void) | null = null;

  /** A line's text with each shown item ("[name]") as its name in its rarity's colour, clickable for its tooltip. */
  private withItems(text: string, links: ChatItemLink[]): Node[] {
    if (!links.length) return [document.createTextNode(text)];
    const out: Node[] = [];
    let rest = text;
    while (rest) {
      // The first shown item still in the text.
      let first: { at: number; l: ChatItemLink } | null = null;
      for (const l of links) {
        const at = rest.indexOf(`[${l.label}]`);
        if (at >= 0 && (!first || at < first.at)) first = { at, l };
      }
      if (!first) {
        out.push(document.createTextNode(rest));
        break;
      }
      if (first.at) out.push(document.createTextNode(rest.slice(0, first.at)));
      const word = `[${first.l.label}]`;
      const b = document.createElement('b');
      b.className = 'ch-item ch-click';
      b.textContent = word;
      b.style.color = this.itemColour?.(first.l.item) ?? '';
      b.setAttribute('role', 'button');
      b.title = `${first.l.label}: see it`;
      const item = first.l.item;
      b.addEventListener('click', (e) => {
        e.stopPropagation(); // not the log's own click
        this.showItem?.(item, b);
      });
      out.push(b);
      rest = rest.slice(first.at + word.length);
    }
    return out;
  }

  /** An item's name colour (its rarity's; set by the town). */
  itemColour: ((item: Item) => string) | null = null;

  /** A diss, praise or judge from the player menu: who said it, a coloured tag, and the line. `id`: theirs, when it's
   *  someone else. */
  verdict(name: string, kind: 'roast' | 'praise', judged: boolean, text: string, id?: string): void {
    const line = document.createElement('div');
    line.className = 'ch-line';
    const tag = document.createElement('span');
    tag.className = `ch-verdict ch-${kind}`;
    tag.textContent = judged ? `judged: ${kind === 'roast' ? 'roast' : 'praise'}` : kind === 'roast' ? 'dissed' : 'praised';
    line.append(...this.speaker(name, ' ', 'ch-name', !!id, id), tag, ` ${text}`);
    this.push(line);
  }

  /** A flex from someone's bag: who, a "flexed" tag, and the item in its rarity's colour. `id`: theirs, when it's
   *  someone else. */
  flex(name: string, itemName: string, rarity: string, colour: string, id?: string): void {
    const line = document.createElement('div');
    line.className = 'ch-line';
    const tag = document.createElement('span');
    tag.className = 'ch-verdict ch-flex';
    tag.textContent = 'flexed';
    const item = document.createElement('b');
    item.style.color = colour;
    item.textContent = ` ${itemName}`;
    line.append(...this.speaker(name, ' ', 'ch-name', !!id, id), tag, item, ` (${rarity[0].toUpperCase()}${rarity.slice(1)})`);
    this.push(line);
  }

  /** The conversation so far (as the server remembers it), replacing what's in the log. */
  /** The server's recent lines as you arrive. After a reconnect (`more`, e.g. the bot restarted) what's shown stays and
   *  only lines not shown yet are added. */
  history(lines: { name: string; text: string; discord?: boolean; megaphone?: boolean; gm?: boolean; links?: ChatItemLink[] }[], myName: string | null, more = false): void {
    if (!more) {
      this.log.replaceChildren();
      this.heard.length = 0;
    }
    const shown = new Map<string, number>();
    if (more) for (const k of this.heard) shown.set(k, (shown.get(k) ?? 0) + 1);
    for (const l of lines) {
      const k = heardKey(l.name, l.text, !!l.discord);
      const n = shown.get(k) ?? 0;
      if (n) {
        shown.set(k, n - 1);
        continue;
      }
      this.add(l.name, l.text, l.discord ? 'discord' : l.name === myName ? 'me' : 'town', undefined, l.gm ? 'gm' : l.megaphone, l.links);
    }
  }

  /** A note from the game (refused, offline…). */
  notice(text: string): void {
    playSound('error');
    const line = document.createElement('div');
    line.className = 'ch-line ch-notice';
    line.textContent = text;
    this.push(line);
  }

  /** A friendly line from the town itself (the welcome). */
  system(text: string): void {
    const line = document.createElement('div');
    line.className = 'ch-line ch-system';
    line.textContent = text;
    this.push(line);
  }

  /** Full opacity now, and fade again after IDLE_MS unless the box is being used. */
  private wake(): void {
    this.root.classList.remove('ch-idle');
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (document.activeElement === this.input || this.root.matches(':hover')) return this.wake();
      this.root.classList.add('ch-idle');
    }, IDLE_MS);
  }

  /** Phones: shows or folds away the chat (bigger screens always show it). */
  private setOpen(open: boolean): void {
    document.body.classList.toggle('chat-open', open);
    this.toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      this.toggle.classList.remove('ch-unread');
      this.log.scrollTop = this.log.scrollHeight;
      this.wake();
    } else if (document.activeElement === this.input) this.input.blur();
  }

  private push(line: HTMLElement): void {
    this.wake();
    if (matchMedia(PHONE).matches && !document.body.classList.contains('chat-open')) this.toggle.classList.add('ch-unread');
    const atBottom = this.log.scrollTop + this.log.clientHeight >= this.log.scrollHeight - 4;
    this.log.append(line);
    while (this.log.childElementCount > MAX_LINES) this.log.firstElementChild?.remove();
    if (atBottom) this.log.scrollTop = this.log.scrollHeight;
  }
}
