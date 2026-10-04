// 💬 The town's chat box (bottom left): the last messages with names, in the game's chat-window frame, and an input
// below. Enter opens the input, Enter sends (and goes back to walking), Esc closes it. Messages go to everyone in
// town as speech bubbles too (TownScene). DOM text only: names and messages are never parsed as HTML.

export interface ChatArt {
  /** The chat window (nine-slice) and the input box (nine-slice, plus its focused look). */
  window: { url: string; slice: number } | null;
  input: { url: string; focus: string; slice: number } | null;
}

const MAX_LINES = 60;
const MAX_LENGTH = 120;

export class ChatBox {
  private readonly root: HTMLElement;
  private readonly log: HTMLElement;
  private readonly input: HTMLInputElement;

  constructor(
    art: ChatArt,
    /** Sends a message; false if it couldn't go (not connected). */
    private readonly send: (text: string) => boolean,
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
    if (art.window) {
      this.log.classList.add('ch-framed');
      this.log.style.setProperty('--frame', `url("${art.window.url}")`);
      this.log.style.setProperty('--slice', String(art.window.slice));
    }
    if (art.input) {
      this.input.classList.add('ch-framed-input');
      this.input.style.setProperty('--frame', `url("${art.input.url}")`);
      this.input.style.setProperty('--frame-focus', `url("${art.input.focus}")`);
      this.input.style.setProperty('--slice', String(art.input.slice));
    }
    this.root.append(this.log, this.input);
    document.body.append(this.root);
    this.log.hidden = true; // until there's something to show

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const text = this.input.value.trim();
        if (text && !this.send(text)) this.notice('Chat is offline right now.');
        this.input.value = '';
        this.input.blur();
      } else if (e.key === 'Escape') {
        this.input.blur();
      }
      e.stopPropagation(); // typing never walks or opens doors
    });
    // Enter anywhere else opens the chat (unless another box or dialog has the focus).
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.defaultPrevented || document.activeElement !== document.body) return;
      if (document.getElementById('reward') || document.getElementById('elsewhere')) return;
      e.preventDefault();
      this.input.focus();
    });
  }

  /** A message in the log. */
  add(name: string, text: string, self = false): void {
    const line = document.createElement('div');
    line.className = 'ch-line';
    const who = document.createElement('b');
    who.className = self ? 'ch-me' : 'ch-name';
    who.textContent = `${name}: `;
    line.append(who, document.createTextNode(text));
    this.push(line);
  }

  /** A note from the game (refused, offline…). */
  notice(text: string): void {
    const line = document.createElement('div');
    line.className = 'ch-line ch-notice';
    line.textContent = text;
    this.push(line);
  }

  private push(line: HTMLElement): void {
    this.log.hidden = false;
    const atBottom = this.log.scrollTop + this.log.clientHeight >= this.log.scrollHeight - 4;
    this.log.append(line);
    while (this.log.childElementCount > MAX_LINES) this.log.firstElementChild?.remove();
    if (atBottom) this.log.scrollTop = this.log.scrollHeight;
  }
}
