import { playSound } from '../audio/sound';

// 💬 The town's chat box (bottom left): one see-through box with the last messages and names (Discord's mark for
// people chatting from the linked Discord channel) and the input under them. Enter opens the input, Enter sends (and keeps it open), an empty Enter or Esc closes it. Messages go to everyone in
// town as speech bubbles too (TownScene). DOM text only: names and messages are never parsed as HTML.


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

export class ChatBox {
  private readonly root: HTMLElement;
  private readonly log: HTMLElement;
  private readonly input: HTMLInputElement;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    /** Sends a message; false if it couldn't go (not connected). */
    private readonly send: (text: string) => boolean,
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
    const row = document.createElement('div');
    row.className = 'ch-row';
    row.append(this.input);
    if (tools) row.append(tools);
    this.root.append(this.log, row);
    document.body.append(this.root);
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
        if (!this.send(text)) this.notice('Chat is offline right now.');
      } else if (e.key === 'Escape') {
        this.input.blur();
      }
      e.stopPropagation(); // typing never walks or opens doors
    });
    // Enter anywhere else opens the chat (unless another box or dialog has the focus).
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.defaultPrevented || document.activeElement !== document.body) return;
      if (document.getElementById('reward') || document.getElementById('elsewhere') || document.getElementById('settings')) return;
      e.preventDefault();
      this.input.focus();
    });
  }

  /** A message in the log (from Discord: with Discord's mark before the name). */
  add(name: string, text: string, from: 'me' | 'town' | 'discord' = 'town'): void {
    const line = document.createElement('div');
    line.className = 'ch-line';
    if (from === 'discord') line.append(discordMark());
    const who = document.createElement('b');
    who.className = from === 'me' ? 'ch-me' : 'ch-name';
    who.textContent = `${name}: `;
    line.append(who, document.createTextNode(text));
    this.push(line);
  }

  /** The conversation so far (as the server remembers it), replacing what's in the log. */
  history(lines: { name: string; text: string; discord?: boolean }[], myName: string | null): void {
    this.log.replaceChildren();
    for (const l of lines) this.add(l.name, l.text, l.discord ? 'discord' : l.name === myName ? 'me' : 'town');
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

  private push(line: HTMLElement): void {
    this.wake();
    const atBottom = this.log.scrollTop + this.log.clientHeight >= this.log.scrollHeight - 4;
    this.log.append(line);
    while (this.log.childElementCount > MAX_LINES) this.log.firstElementChild?.remove();
    if (atBottom) this.log.scrollTop = this.log.scrollHeight;
  }
}
