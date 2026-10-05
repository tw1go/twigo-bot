import type { TownNewsPost, TownNewsResponse } from '@mikazuki/shared';
import { fakeLogin } from '../session';
import { el, showPopup } from './reward';

// 📣 The news board (the megaphone beside Settings): the latest announcements and patch notes from Discord (GET
// /town/news), in the reward box with two tabs, newest first; the newest post open, the rest a click away. Posts are
// Discord markdown, drawn here as DOM (bold, italic, underline, strikethrough, code, -# small lines, headings,
// quotes, links). The button gets a dot when there's a post newer than the last one seen in this browser.

type Tab = 'announcements' | 'patchNotes';
const TABS: [Tab, string][] = [
  ['announcements', 'Announcements'],
  ['patchNotes', 'Patch notes'],
];
const SEEN_KEY = 'mk_news_seen';
const CACHE_MS = 2 * 60_000;

let cache: { at: number; news: Promise<TownNewsResponse | null> } | null = null;

/** The news, fetched at most every couple of minutes. */
export function loadNews(): Promise<TownNewsResponse | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.news;
  const news = fakeLogin()
    ? Promise.resolve(structuredClone(fake)) // dev: no bot to ask
    : fetch('/town/news', { credentials: 'same-origin' })
        .then((r) => (r.ok ? (r.json() as Promise<TownNewsResponse>) : null))
        .catch(() => null);
  cache = { at: Date.now(), news };
  return news;
}

const newest = (n: TownNewsResponse) => Math.max(0, ...n.announcements.map((p) => p.at), ...n.patchNotes.map((p) => p.at));

function seen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** Whether there's a post newer than the last one seen here. */
export const hasUnread = (n: TownNewsResponse) => newest(n) > seen();

export function showNews(o: { onSeen?: () => void } = {}): void {
  const open = document.querySelector<HTMLButtonElement>('#reward:has(.nw-body) .rw-ok');
  if (open) return void open.click(); // the button toggles it

  const bar = el('div', 'bk-tabs');
  bar.setAttribute('role', 'tablist');
  const panel = el('div', 'nw-panel');
  panel.setAttribute('role', 'tabpanel');
  const note = el('div', 'bk-note nw-note', 'Loading…');
  note.setAttribute('role', 'status');
  const wrap = el('div', 'nw-body');
  wrap.append(bar, panel, note);

  let data: TownNewsResponse | null = null;
  let tab: Tab = 'announcements';
  const tabs = new Map<Tab, HTMLButtonElement>();
  for (const [t, label] of TABS) {
    const b = el('button', 'bk-tab', label);
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => {
      tab = t;
      render();
    });
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      tab = tab === 'announcements' ? 'patchNotes' : 'announcements';
      render();
      tabs.get(tab)!.focus();
    });
    tabs.set(t, b);
    bar.append(b);
  }

  const render = () => {
    for (const [t, b] of tabs) {
      b.setAttribute('aria-selected', String(t === tab));
      b.tabIndex = t === tab ? 0 : -1;
    }
    if (!data) return;
    const posts = data[tab];
    note.textContent = posts.length ? '' : tab === 'announcements' ? 'No announcements yet.' : 'No patch notes yet.';
    panel.replaceChildren(...posts.map((p, i) => post(p, i === 0)));
    panel.scrollTop = 0;
  };

  void showPopup({ title: 'News', body: [wrap], button: 'Close', celebrate: false });
  void loadNews().then((d) => {
    if (!d) return void (note.textContent = "Couldn't load the news. Try again in a moment.");
    data = d;
    // Open on patch notes when only they have something new.
    const last = seen();
    if (!d.announcements.some((p) => p.at > last) && d.patchNotes.some((p) => p.at > last)) tab = 'patchNotes';
    try {
      localStorage.setItem(SEEN_KEY, String(newest(d)));
    } catch {
      // private mode: the dot just comes back next time
    }
    o.onSeen?.();
    render();
  });
}

function post(p: TownNewsPost, open: boolean): HTMLElement {
  const box = el('details', 'nw-post');
  box.open = open;
  const head = el('summary', 'nw-head');
  head.append(el('span', 'nw-title', p.title), el('span', 'nw-date', new Date(p.at).toLocaleDateString([], { month: 'short', day: 'numeric' })));
  const body = el('div', 'nw-text');
  body.append(...markdown(p.body));
  box.append(head, body);
  return box;
}

// ── Discord markdown → DOM (text nodes only, never HTML) ──

function markdown(text: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const line of text.split('\n')) {
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    const small = /^-# (.*)$/.exec(line);
    const quote = /^> ?(.*)$/.exec(line);
    let node: HTMLElement;
    if (!line.trim()) node = el('div', 'nw-gap');
    else if (small) node = el('div', 'nw-small');
    else if (heading) node = el('div', `nw-h nw-h${heading[1].length}`);
    else if (quote) node = el('div', 'nw-quote');
    else node = el('div', 'nw-line');
    node.append(...inline(small?.[1] ?? heading?.[2] ?? quote?.[1] ?? line));
    out.push(node);
  }
  return out;
}

const INLINE = /\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|`([^`]+)`|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])|\[([^\]]+)\]\(<?(https?:\/\/[^\s)>]+)>?\)|<(https?:\/\/[^\s>]+)>|(https?:\/\/[^\s<]+[^\s<.,:;!?)\]])/;

function inline(text: string): Node[] {
  const out: Node[] = [];
  let rest = text;
  for (let m = INLINE.exec(rest); m; m = INLINE.exec(rest)) {
    if (m.index) out.push(document.createTextNode(rest.slice(0, m.index)));
    const [, bold, under, strike, code, em, em2, linkText, linkUrl, angled, bare] = m;
    const wrap = (tag: keyof HTMLElementTagNameMap, inner: string) => {
      const n = el(tag);
      n.append(...inline(inner));
      return n;
    };
    if (bold !== undefined) out.push(wrap('b', bold));
    else if (under !== undefined) out.push(wrap('u', under));
    else if (strike !== undefined) out.push(wrap('s', strike));
    else if (code !== undefined) out.push(el('code', 'nw-code', code));
    else if (em !== undefined || em2 !== undefined) out.push(wrap('i', (em ?? em2)!));
    else out.push(link(linkUrl ?? angled ?? bare, linkText ?? shortUrl(angled ?? bare)));
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest) out.push(document.createTextNode(rest));
  return out;
}

const shortUrl = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

function link(url: string, text: string): HTMLElement {
  const a = el('a', 'nw-link', text);
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

// ── Dev: pretend news (no bot behind the dev server). ──

const day = 24 * 60 * 60_000;
const fake: TownNewsResponse = {
  announcements: [
    {
      at: Date.now() - 2 * day,
      title: '🍳 psst… twigo is cooking up something.',
      body: 'The Tanod has been grinding behind the scenes, and Mikazuki is about to **level up**. 🆙\nWe are building a little world of our own, right in your browser. 🏘️✨\n\n🎮 **Pre-register now and get 50 Kowens when it launches!**\n-# Press the button below to join.',
    },
    {
      at: Date.now() - 4 * day,
      title: "📢 The Tanod's guide (part 1): the basics & Kowens 🫡",
      body: '-# Terms: <https://github.com/tw1go/twigo-bot/blob/main/TERMS.md>\n\n**🫡 Meet the Tanod — your server bot**\nThe Tanod keeps the barangay in order.\n\n**🪙 Kowens — earn, check, share**\n• `/balance` shows yours\n• `/give @someone 5` shares them',
    },
  ],
  patchNotes: [
    { at: Date.now() - 3 * 60 * 60_000, title: 'Kara y Krus at the Casino 🎰', body: 'Walk into the Casino and flip a coin:\n• **45%** double, otherwise you lose\n• The Tanod raids **3%** of tables 🚨\n> Bet responsibly, citizen.' },
    { at: Date.now() - 3 * day, title: 'The Vault & Potions 🔐🧪', body: '**🔐 New: the Vault** (`/redeem`, **50 Kowens**, once)\n• Store up to **30%** of your Kowens with `/vault deposit`\n• Vaulted Kowens are __safe from thieves__ 🥷' },
    { at: Date.now() - 5 * day, title: 'Small fixes & quality of life', body: '• ~~Old bug~~ fixed\n• *Faster* replies' },
  ],
};
