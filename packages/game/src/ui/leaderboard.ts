import type { OutfitData, TownLeaderboardResponse, TownLeaderboardRow } from '@mikazuki/shared';
import { fakeLogin, fakeName } from '../session';
import { el, showPopup } from './reward';

// 🏆 The leaderboard monument: the top 10 by Kowens (wallet + vault) in the reward box — rank, town name, title in
// its colour, Kowens; the top 3 in gold, silver and bronze; your row highlighted, or your own rank under the list.
// Above the list, the top 3 stand on a podium as their own characters (idling); anyone without one is a "?".

const MEDALS = ['lb-gold', 'lb-silver', 'lb-bronze'];

async function load(): Promise<TownLeaderboardResponse | null> {
  if (fakeLogin()) return sample(); // dev: no bot to ask
  const res = await fetch('/town/leaderboard', { credentials: 'same-origin' }).catch(() => null);
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
  line.append(el('span', 'lb-rank', `#${r.rank}`), who, el('span', 'lb-kowens', r.kowens.toLocaleString()));
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
function podium(rows: TownLeaderboardRow[], figure: (o: OutfitData | null) => Promise<Figure | null>): HTMLElement {
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

export function showLeaderboard(figure: (o: OutfitData | null) => Promise<Figure | null>): void {
  const top = el('div', 'lb-top');
  const list = el('div', 'lb-list', 'Loading…');
  const foot = el('div', 'lb-foot');
  void showPopup({ title: 'Leaderboard', body: [el('div', 'lb-sub', 'Richest in Mikazuki · Kowens (wallet + vault)'), top, list, foot], button: 'Close', celebrate: false });
  void load().then((data) => {
    if (!data) return void (list.textContent = "Couldn't load the leaderboard. Try again in a moment.");
    if (data.rows.length) top.append(podium(data.rows.slice(0, 3), figure));
    list.replaceChildren(...data.rows.map(row));
    if (!data.rows.length) list.textContent = 'Nobody has Kowens yet.';
    const inTop = data.rows.some((r) => r.me);
    foot.textContent = inTop ? '' : data.me.rank ? `You: #${data.me.rank} · ${data.me.kowens.toLocaleString()} ${data.me.kowens === 1 ? 'Kowen' : 'Kowens'}` : 'You: no Kowens yet. /get-kowens in Discord!';
  });
}

/** Dev: made-up rows (the fake member in 4th). */
function sample(): TownLeaderboardResponse {
  const names = ['Kuya Ben', 'Fae', 'junwuu', fakeName(), 'Hei', 'Mika', 'Lumi', 'Tala', 'Bayani', 'Dalisay'];
  const titles = [
    { name: 'Game Master', color: 'prismatic' },
    { name: 'She was a Fairy', color: '#F0ABFC' },
    { name: 'junwuurat', color: '#F8BF27' },
  ];
  const rows = names.map((name, i) => ({
    rank: i + 1,
    name,
    title: titles[i] ?? { name: 'Townfolk', color: '#B794F6' },
    kowens: Math.round(2400 / (i + 1)),
    ...(i === 3 ? { me: true } : {}),
    // 1st and 2nd have looks (made up from their names), 3rd hasn't made a character: the "?".
    ...(i < 3 ? { outfit: i < 2 ? ({} as OutfitData) : null } : {}),
  }));
  return { rows, me: { rank: 4, kowens: rows[3].kowens } };
}
