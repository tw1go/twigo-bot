import type { OutfitData, TownClearRow, TownGolemRow, TownLeaderboardResponse, TownLeaderboardRow, TownRatingRow } from '@mikazuki/shared';
import { api } from '../net/endpoints';
import { fakeLogin, fakeName } from '../session';
import { el, showPopup } from './reward';

// 🏆 The leaderboard monument (CONTEXT.md Leaderboard): four boards as tabs in the reward box (the bank's tab style),
// the last one opened remembered in this browser (localStorage mk_lb_tab): Kowens (wallet + vault), Combat rating (base
// CP: no buffs, everyone with a class), Warrens (the fastest clears, one row per line-up: its team, size, time and date)
// and Golem (each player's most damage in one fight that ended with the golem down). Each list: rank, town name, title
// in its colour, the number; the top 3 in gold, silver and bronze; your row highlighted, or your own place under the
// list. Above the per-player lists, the top 3 stand on a podium as their own characters (idling); anyone without one is
// a "?". One request (GET /town/leaderboard) brings every board.

const MEDALS = ['lb-gold', 'lb-silver', 'lb-bronze'];

async function load(): Promise<TownLeaderboardResponse | null> {
  if (fakeLogin()) return sample(); // dev: no bot to ask
  const res = await api('/town/leaderboard', { credentials: 'same-origin' }).catch(() => null);
  return res?.ok ? ((await res.json()) as TownLeaderboardResponse) : null;
}

function row(r: TownLeaderboardRow): HTMLElement {
  const line = el('div', `lb-row${r.rank <= 3 ? ` ${MEDALS[r.rank - 1]}` : ''}${r.me ? ' lb-me' : ''}`);
  const who = el('span', 'lb-who');
  who.append(el('span', 'lb-name', r.me ? `${r.name} (you)` : r.name));
  const title = el('span', 'lb-title', `<${r.title.name}>`);
  if (r.title.color === 'prismatic') title.classList.add('prismatic');
  else title.style.color = r.title.color;
  who.append(title);
  // (Hidden: they don't show you their balance; CONTEXT.md Who can see. Their place and name still show.)
  const amount = el('span', r.kowens === null ? 'lb-kowens lb-hidden' : 'lb-kowens', r.kowens === null ? 'Hidden' : r.kowens.toLocaleString());
  if (r.kowens === null) amount.title = `${r.name} doesn't show their balance to you`;
  line.append(el('span', 'lb-rank', `#${r.rank}`), who, amount);
  return line;
}

/** The name and title, as every per-player row shows them. */
function who(r: { name: string; title: TownLeaderboardRow['title']; me?: boolean }): HTMLElement {
  const box = el('span', 'lb-who');
  box.append(el('span', 'lb-name', r.me ? `${r.name} (you)` : r.name));
  const title = el('span', 'lb-title', `<${r.title.name}>`);
  if (r.title.color === 'prismatic') title.classList.add('prismatic');
  else title.style.color = r.title.color;
  box.append(title);
  return box;
}
const rowBox = (rank: number, me?: boolean) => el('div', `lb-row${rank <= 3 ? ` ${MEDALS[rank - 1]}` : ''}${me ? ' lb-me' : ''}`);
const mmss = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const day = (at: number) => new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' });

/** A combat rating row: the class badge, name and title, level, CP. */
function ratingRow(r: TownRatingRow, badge: (cls: string) => string): HTMLElement {
  const line = rowBox(r.rank, r.me);
  const src = badge(r.cls);
  const b = el(src ? 'img' : 'span', 'lb-badge');
  if (b instanceof HTMLImageElement) {
    b.src = src;
    b.alt = r.cls;
  }
  line.append(el('span', 'lb-rank', `#${r.rank}`), b, who(r), el('span', 'lb-level', `Lv ${r.level}`), el('span', 'lb-kowens lb-cp', r.cp.toLocaleString()));
  return line;
}

/** A Warrens row: the team's names, how many, the clear time, when. */
function clearRow(r: TownClearRow): HTMLElement {
  const line = rowBox(r.rank, r.me);
  const team = el('span', 'lb-who lb-team');
  team.append(el('span', 'lb-names', r.names.join(', ')), el('span', 'lb-size', r.names.length === 1 ? 'solo' : `×${r.names.length}`));
  line.append(el('span', 'lb-rank', `#${r.rank}`), team, el('span', 'lb-kowens lb-time', mmss(r.ms)), el('span', 'lb-when', day(r.at)));
  return line;
}

/** A golem row: name and title, the damage, when. */
function golemRow(r: TownGolemRow): HTMLElement {
  const line = rowBox(r.rank, r.me);
  line.append(el('span', 'lb-rank', `#${r.rank}`), who(r), el('span', 'lb-kowens lb-damage', r.damage.toLocaleString()), el('span', 'lb-when', day(r.at)));
  return line;
}

/** A character for the podium: its idle sheet facing south (frames side by side), or a silhouette for "?". */
export interface Figure {
  sheet: CanvasImageSource;
  frames: number;
  fps: number;
  cell: [number, number];
  mystery: boolean;
}

const SCALE = 3;

/** The top 3 on a podium: 2nd left, 1st in the middle (tallest), 3rd right, each idling on their step. */
function podium(rows: { rank: number; name: string; outfit?: OutfitData | null }[], figure: (o: OutfitData | null) => Promise<Figure | null>): HTMLElement {
  const box = el('div', 'lb-podium');
  const draws: (() => void)[] = [];
  for (const r of [rows[1], rows[0], rows[2]]) {
    if (!r) continue;
    const spot = el('div', `lb-spot lb-spot-${r.rank}`);
    const canvas = el('canvas', 'lb-figure');
    spot.append(el('div', 'lb-spot-name', r.name), canvas, el('div', 'lb-step', String(r.rank)));
    box.append(spot);
    void figure(r.outfit ?? null).then((f) => {
      if (!f) return;
      const [cw, ch] = f.cell;
      canvas.width = cw;
      canvas.height = ch;
      canvas.style.width = `${cw * SCALE}px`;
      canvas.style.height = `${ch * SCALE}px`;
      const ctx = canvas.getContext('2d')!;
      draws.push(() => {
        const frame = Math.floor((performance.now() / 1000) * f.fps) % f.frames;
        ctx.clearRect(0, 0, cw, ch);
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(f.sheet, frame * cw, 0, cw, ch, 0, 0, cw, ch);
        if (f.mystery) {
          // No character yet: a pale silhouette with a question mark.
          ctx.globalCompositeOperation = 'source-in';
          ctx.fillStyle = '#C9C2E3';
          ctx.fillRect(0, 0, cw, ch);
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = '#5B21B6';
          ctx.font = 'bold 16px "Mk Numbers", "Pixelify Sans", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('?', cw / 2, ch * 0.62);
        }
      });
    });
  }
  const tick = () => {
    if (!box.isConnected && draws.length) return; // the pop-up closed
    for (const d of draws) d();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return box;
}

type Tab = 'kowens' | 'cp' | 'warrens' | 'golem';
const TABS: [Tab, string][] = [['kowens', 'Kowens'], ['cp', 'Combat rating'], ['warrens', 'Warrens'], ['golem', 'Golem']];
const STORE = 'mk_lb_tab';
const SUB: Record<Tab, string> = {
  kowens: 'Richest in Mikazuki · Kowens (wallet + vault)',
  cp: 'Strongest · combat rating without buffs',
  warrens: 'Fastest Scrap Warrens clears · one row per team',
  golem: 'Hardest hitters · most damage in one fight the golem fell in',
};

function savedTab(): Tab {
  try {
    const t = localStorage.getItem(STORE);
    return TABS.some(([k]) => k === t) ? (t as Tab) : 'kowens';
  } catch {
    return 'kowens';
  }
}

export function showLeaderboard(figure: (o: OutfitData | null) => Promise<Figure | null>, badge: (cls: string) => string): void {
  // The tabs (arrow keys move between them) and a panel each: its line, podium, list and your own place.
  const bar = el('div', 'bk-tabs lb-tabs');
  bar.setAttribute('role', 'tablist');
  const tabs = new Map<Tab, HTMLButtonElement>();
  const panels = {} as Record<Tab, { root: HTMLElement; top: HTMLElement; list: HTMLElement; foot: HTMLElement }>;
  let current = savedTab();
  const show = (tab: Tab, focus = false) => {
    current = tab;
    for (const [t, b] of tabs) {
      const on = t === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      panels[t].root.hidden = !on;
    }
    if (focus) tabs.get(tab)!.focus();
    try {
      localStorage.setItem(STORE, tab);
    } catch {
      // private mode: not remembered
    }
  };
  for (const [tab, label] of TABS) {
    const b = el('button', 'bk-tab', label);
    b.setAttribute('role', 'tab');
    b.id = `lb-tab-${tab}`;
    const root = el('div', `lb-panel lb-panel-${tab}`);
    root.setAttribute('role', 'tabpanel');
    root.setAttribute('aria-labelledby', b.id);
    const top = el('div', 'lb-top');
    const list = el('div', 'lb-list', 'Loading…');
    const foot = el('div', 'lb-foot');
    root.append(el('div', 'lb-sub', SUB[tab]), top, list, foot);
    panels[tab] = { root, top, list, foot };
    b.addEventListener('click', () => show(tab));
    b.addEventListener('keydown', (e) => {
      const i = TABS.findIndex(([t]) => t === tab);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        show(TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0], true);
      }
    });
    tabs.set(tab, b);
    bar.append(b);
  }
  show(current);
  void showPopup({ title: 'Leaderboard', body: [bar, ...TABS.map(([t]) => panels[t].root)], button: 'Close', celebrate: false });

  void load().then((data) => {
    if (!data) {
      for (const t of TABS) panels[t[0]].list.textContent = "Couldn't load the leaderboard. Try again in a moment.";
      return;
    }
    const fill = (tab: Tab, rows: HTMLElement[], empty: string, foot: string, podiumRows?: { rank: number; name: string; outfit?: OutfitData | null }[]) => {
      const p = panels[tab];
      if (podiumRows?.length) p.top.append(podium(podiumRows.slice(0, 3), figure));
      p.list.replaceChildren(...rows);
      if (!rows.length) p.list.textContent = empty;
      p.foot.textContent = foot;
    };
    const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
    const inTop = (rows: { me?: boolean }[]) => rows.some((r) => r.me);
    fill('kowens', data.rows.map(row), 'Nobody has Kowens yet.',
      inTop(data.rows) ? '' : data.me.rank ? `You: #${data.me.rank} · ${plural(data.me.kowens, 'Kowen', 'Kowens')}` : 'You: no Kowens yet. /get-kowens in Discord!', data.rows);
    const cp = data.cp;
    fill('cp', cp.rows.map((r) => ratingRow(r, badge)), 'Nobody has a class yet. Talk to the Tanod!',
      inTop(cp.rows) ? '' : cp.me.rank && cp.me.cp !== null ? `You: #${cp.me.rank} · ${cp.me.cp.toLocaleString()} CP` : 'You: choose a class with the Tanod to be ranked.', cp.rows);
    const w = data.warrens;
    fill('warrens', w.rows.map(clearRow), 'No run has been cleared yet. Bring Barong-Barong down!',
      inTop(w.rows) ? '' : w.me.rank && w.me.ms !== null ? `Your best team: #${w.me.rank} · ${mmss(w.me.ms)}` : 'You: no clear yet.');
    const g = data.golem;
    fill('golem', g.rows.map(golemRow), 'The golem hasn’t fallen yet.',
      inTop(g.rows) ? '' : g.me.rank && g.me.damage !== null ? `You: #${g.me.rank} · ${g.me.damage.toLocaleString()} damage` : 'You: no golem fight won yet.', g.rows);
  });
}

/** Dev: made-up rows (the fake member in 4th on Kowens, 2nd on combat rating, in the 3rd team, 5th on the golem). */
function sample(): TownLeaderboardResponse {
  const names = ['Kuya Ben', 'Fae', 'junwuu', fakeName(), 'Hei', 'Mika', 'Lumi', 'Tala', 'Bayani', 'Dalisay'];
  const titles = [
    { name: 'Game Master', color: 'prismatic' },
    { name: 'She was a Fairy', color: '#F0ABFC' },
    { name: 'junwuurat', color: '#F8BF27' },
  ];
  const townfolk = { name: 'Townfolk', color: '#B794F6' };
  const title = (i: number) => titles[i] ?? townfolk;
  const look = (i: number) => (i < 3 ? { outfit: i < 2 ? ({} as OutfitData) : null } : {}); // (3rd hasn't made a character: the "?")
  const rows = names.map((name, i) => ({
    rank: i + 1,
    name,
    title: title(i),
    kowens: i === 5 ? null : Math.round(2400 / (i + 1)), // (6th shows their balance only to friends: "Hidden")
    ...(i === 3 ? { me: true } : {}),
    ...look(i),
  }));
  const classes = ['slingshot',  'stick',  'greatstick',  'broom',  'potlid',  'hilot'];
  const cpNames = ['Fae', fakeName(), 'Kuya Ben', 'Tala', 'Hei', 'junwuu', 'Mika'];
  const cpRows = cpNames.map((name, i) => ({ rank: i + 1, name, title: title(names.indexOf(name)), cls: classes[i % classes.length], level: 20 - i, cp: 5200 - i * 310, ...(i === 1 ? { me: true } : {}), ...look(i) }));
  const now = Date.now();
  const clears = [
    { names: ['Kuya Ben', 'Fae', 'junwuu', 'Hei'], ms: 9 * 60_000 + 42_000, at: now - 3 * 86_400_000 },
    { names: ['Tala', 'Mika'], ms: 12 * 60_000 + 5_000, at: now - 86_400_000 },
    { names: [fakeName(), 'Lumi', 'Bayani'], ms: 13 * 60_000 + 30_000, at: now - 7 * 86_400_000, me: true },
    { names: ['Dalisay'], ms: 17 * 60_000 + 58_000, at: now - 10 * 86_400_000 },
  ];
  const golemNames = ['junwuu', 'Kuya Ben', 'Fae', 'Hei', fakeName(), 'Tala'];
  const golem = golemNames.map((name, i) => ({ rank: i + 1, name, title: title(names.indexOf(name)), damage: 48_200 - i * 6_150, at: now - (i + 1) * 5 * 3_600_000, ...(i === 4 ? { me: true } : {}), ...look(i) }));
  return {
    rows,
    me: { rank: 4, kowens: rows[3].kowens ?? 0 },
    cp: { rows: cpRows, me: { rank: 2, cp: cpRows[1].cp } },
    warrens: { rows: clears.map((c, i) => ({ rank: i + 1, ...c })), me: { rank: 3, ms: clears[2].ms } },
    golem: { rows: golem, me: { rank: 5, damage: golem[4].damage } },
  };
}
