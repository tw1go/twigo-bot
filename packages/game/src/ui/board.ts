import type { TownBoardAction, TownBoardActionResponse, TownBoardResponse, TownQuest } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { fakeLogin, fakeName } from '../session';
import { coinIcon, el, showPopup } from './reward';

// 📜 The notice board (left click the board), in the reward box with two tabs. Quests: /request's quests as notes
// pinned on cork — the task, the reward, who posted it and who's on it — with Accept, Give up, Complete (pays the
// reward) and Cancel (refunds it) for whoever may use them; completing and cancelling ask twice. Post a quest: a task
// and a reward, held by the Tanod until it's done. Everything goes through the bot (POST /town/board), which keeps
// the quest's card in Discord in step.

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const kowens = (n: number) => plural(n, 'Kowen', 'Kowens');
/** As /request's task option. */
const MAX_TASK = 300;
/** Paper colours for the notes, picked by quest id so a note keeps its colour. */
const PAPERS = ['#FFF6D5', '#FDE2E4', '#E0F2FE', '#E9F7D8', '#F3E8FF'];

type Tab = 'quests' | 'post';
const TABS: [Tab, string][] = [['quests', 'Quests'], ['post', 'Post a quest']];

async function load(): Promise<TownBoardResponse | null> {
  if (fakeLogin()) return structuredClone(fake);
  const res = await fetch('/town/board', { credentials: 'same-origin' }).catch(() => null);
  return res?.ok ? ((await res.json()) as TownBoardResponse) : null;
}

async function act(body: { action: TownBoardAction; id?: string; task?: string; reward?: number }): Promise<TownBoardActionResponse | null> {
  if (fakeLogin()) return fakeAct(body);
  const res = await fetch('/town/board', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null);
  return res?.ok ? ((await res.json()) as TownBoardActionResponse) : null;
}

/** Enter and Escape in a field stay with the field (the pop-up closes on them otherwise). */
function keepKeys(field: HTMLElement, onEnter?: () => void): void {
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      field.blur();
    } else if (e.key === 'Enter') {
      e.stopPropagation();
      if (onEnter && !(field instanceof HTMLTextAreaElement && e.shiftKey)) {
        e.preventDefault();
        onEnter();
      }
    }
  });
}

export function showBoard(): void {
  const bar = el('div', 'bk-tabs');
  bar.setAttribute('role', 'tablist');
  const panel = el('div', 'nb-panel');
  panel.setAttribute('role', 'tabpanel');
  const note = el('div', 'bk-note nb-note', 'Loading…');
  note.setAttribute('role', 'status');
  const wrap = el('div', 'nb-body');
  wrap.append(bar, panel, note);

  let data: TownBoardResponse | null = null;
  let tab: Tab = 'quests';
  let busy = false;
  /** A quest action waiting for its second press: `${id}:${action}`. */
  let confirming: string | null = null;
  // The post form keeps what was typed across redraws.
  const task = el('textarea', 'nb-task');
  task.maxLength = MAX_TASK;
  task.rows = 4;
  task.placeholder = 'What do you need done? e.g. "Carry me through a dungeon run"';
  task.setAttribute('aria-label', 'What you need done');
  const reward = el('input', 'nb-reward');
  reward.type = 'number';
  reward.min = '1';
  reward.step = '1';
  reward.inputMode = 'numeric';
  reward.placeholder = 'Kowens';
  reward.setAttribute('aria-label', 'Reward in Kowens');
  const count = el('span', 'nb-count');
  const say = (text: string, ok: boolean) => {
    note.textContent = text;
    note.classList.toggle('bk-refused', !ok);
  };

  const tabs = new Map<Tab, HTMLButtonElement>();
  for (const [t, label] of TABS) {
    const b = el('button', 'bk-tab', label);
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => {
      tab = t;
      confirming = null;
      note.textContent = '';
      render();
    });
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      tab = tab === 'quests' ? 'post' : 'quests';
      render();
      tabs.get(tab)!.focus();
    });
    tabs.set(t, b);
    bar.append(b);
  }

  const run = async (body: { action: TownBoardAction; id?: string; task?: string; reward?: number }) => {
    if (busy) return;
    busy = true;
    confirming = null;
    render();
    const res = await act(body);
    busy = false;
    if (!res) {
      playSound('error');
      say("Couldn't reach the board. Try again in a moment.", false);
      return render();
    }
    data = res;
    if (res.ok && body.action === 'post') {
      task.value = '';
      reward.value = '';
      tab = 'quests';
    }
    render();
    say(res.message, res.ok);
    playSound(res.ok ? (body.action === 'complete' || body.action === 'post' ? 'coin' : 'click') : 'error');
    if (res.ok && body.action !== 'accept' && body.action !== 'giveup') window.dispatchEvent(new Event('mk-wallet')); // the HUD's Kowens
  };

  /** A quest's button; Complete and Cancel ask again first. */
  const action = (q: TownQuest, a: TownBoardAction, label: string, cls: string) => {
    const key = `${q.id}:${a}`;
    const asks = a === 'complete' || a === 'cancel';
    const b = el('button', `nb-act ${cls}${confirming === key ? ' nb-sure' : ''}`, confirming === key ? 'Sure?' : label);
    b.disabled = busy;
    b.addEventListener('click', () => {
      if (asks && confirming !== key) {
        confirming = key;
        say(a === 'complete' ? `Pay ${q.helper} ${kowens(q.reward)} for this quest? Press again.` : `Cancel this quest and get your ${kowens(q.reward)} back? Press again.`, true);
        return render();
      }
      void run({ action: a, id: q.id });
    });
    return b;
  };

  const questNote = (q: TownQuest, i: number) => {
    const n = el('div', `nb-quest${q.mine ? ' nb-mine' : ''}${q.helping ? ' nb-helping' : ''}`);
    const hue = [...q.id].reduce((a, c) => a + c.charCodeAt(0), 0);
    n.style.setProperty('--paper', PAPERS[hue % PAPERS.length]);
    n.style.setProperty('--tilt', `${((hue % 5) - 2) * 0.6 + (i % 2 ? 0.4 : -0.4)}deg`);
    const head = el('div', 'nb-head');
    const prize = el('span', 'nb-prize');
    prize.append(coinIcon(1), q.reward.toLocaleString());
    head.append(prize, el('span', `nb-state nb-${q.status}`, q.status === 'open' ? 'Open' : 'Taken'));
    const who = el('div', 'nb-who', q.mine ? 'Posted by you' : `Posted by ${q.by}`);
    if (q.helper) who.append(` · ${q.helping ? 'you are on it' : `${q.helper} is on it`}`);
    const acts = el('div', 'nb-acts');
    if (q.mine) {
      if (q.status === 'accepted') acts.append(action(q, 'complete', `Done · pay ${q.reward}`, 'nb-pay'));
      acts.append(action(q, 'cancel', 'Cancel', 'nb-plain'));
    } else if (q.helping) acts.append(action(q, 'giveup', 'Give up', 'nb-plain'));
    else if (q.status === 'open') acts.append(action(q, 'accept', 'Accept', 'nb-take'));
    n.append(head, el('p', 'nb-text', q.task), who, acts);
    return n;
  };

  const render = () => {
    for (const [t, b] of tabs) {
      b.setAttribute('aria-selected', String(t === tab));
      b.tabIndex = t === tab ? 0 : -1;
    }
    const d = data;
    if (!d) return;
    if (tab === 'quests') {
      const cork = el('div', 'nb-cork');
      if (!d.quests.length) cork.append(el('div', 'nb-empty', 'No quests up. Post one!'));
      d.quests.forEach((q, i) => cork.append(questNote(q, i)));
      panel.replaceChildren(cork);
      return;
    }

    // Post a quest.
    const form = el('div', 'nb-form');
    const value = Number(reward.value);
    const why = d.inDebt ? "You can't post quests while you have a loan."
      : d.myActive >= d.maxActive ? `You have ${d.maxActive} quests up already. Finish or cancel one first.`
      : d.wallet < 1 ? 'You have no Kowens for a reward.'
      : null;
    reward.max = String(Math.min(d.maxReward, Math.max(1, d.wallet)));
    const post = el('button', 'nb-post', Number.isInteger(value) && value > 0 ? `Post · hold ${kowens(value)}` : 'Post quest');
    post.disabled = busy || !!why;
    const send = () => {
      const n = Number(reward.value);
      if (!task.value.trim()) return say('Write what you need done.', false);
      if (!Number.isInteger(n) || n < 1 || n > d.maxReward) return say(`The reward is 1–${d.maxReward} Kowens.`, false);
      void run({ action: 'post', task: task.value, reward: n });
    };
    post.onclick = send;
    reward.oninput = () => (post.textContent = Number(reward.value) > 0 ? `Post · hold ${kowens(Number(reward.value))}` : 'Post quest');
    task.oninput = () => (count.textContent = `${task.value.length}/${MAX_TASK}`);
    count.textContent = `${task.value.length}/${MAX_TASK}`;
    task.disabled = reward.disabled = !!why;
    const rewardRow = el('div', 'nb-row');
    const label = el('label', 'nb-label', 'Reward');
    label.append(reward);
    rewardRow.append(label, post);
    form.append(
      el('div', 'nb-form-title', 'Help wanted'),
      task,
      count,
      rewardRow,
      el('p', 'nb-hint', why ?? `1–${d.maxReward} Kowens, taken from your wallet (${kowens(d.wallet)}) and held by the Tanod until you mark it done or cancel it. You have ${d.myActive}/${d.maxActive} quests up. It's also posted in Discord.`),
    );
    panel.replaceChildren(form);
  };
  keepKeys(task);
  keepKeys(reward, () => (panel.querySelector('.nb-post') as HTMLButtonElement | null)?.click());

  void showPopup({ title: 'Notice board', body: [wrap], button: 'Close', celebrate: false, sound: 'click' });
  void load().then((d) => {
    if (!d) return void (note.textContent = "Couldn't load the board. Try again in a moment.");
    data = d;
    note.textContent = '';
    render();
  });
}

// ── Dev: a pretend board (no bot behind the dev server) ──

const fake: TownBoardResponse = {
  quests: [
    { id: 'a1b2', task: 'Carry me through the Abyss dungeon tonight, 9 PM. I bring snacks.', reward: 25, status: 'open', by: 'Fae', helper: null, created: Date.now() - 3600_000 },
    { id: 'c3d4', task: 'Need someone to farm 200 crystals for my alt', reward: 40, status: 'accepted', by: 'Kuya Ben', helper: 'junwuu', created: Date.now() - 7200_000 },
    { id: 'e5f6', task: 'Teach me the boss mechanics for raid 3', reward: 15, status: 'accepted', by: '', helper: 'Hei', mine: true, created: Date.now() - 600_000 },
  ],
  maxReward: 100,
  maxActive: 3,
  myActive: 1,
  wallet: Number(new URLSearchParams(location.search).get('kowens') ?? 1250),
  inDebt: false,
};

function fakeAct(body: { action: TownBoardAction; id?: string; task?: string; reward?: number }): TownBoardActionResponse {
  const done = (ok: boolean, message: string) => ({ ...structuredClone(fake), ok, message });
  if (body.action === 'post') {
    const reward = body.reward ?? 0;
    fake.wallet -= reward;
    fake.myActive++;
    fake.quests.unshift({ id: Math.random().toString(16).slice(2, 6), task: body.task ?? '', reward, status: 'open', by: fakeName(), helper: null, mine: true, created: Date.now() });
    return done(true, `Posted! ${kowens(reward)} is held until it's done.`);
  }
  const q = fake.quests.find((x) => x.id === body.id);
  if (!q) return done(false, 'This quest is already closed.');
  if (body.action === 'accept') Object.assign(q, { status: 'accepted', helper: fakeName(), helping: true });
  if (body.action === 'giveup') Object.assign(q, { status: 'open', helper: null, helping: false });
  if (body.action === 'complete' || body.action === 'cancel') {
    fake.quests = fake.quests.filter((x) => x !== q);
    fake.myActive--;
    if (body.action === 'cancel') fake.wallet += q.reward;
  }
  return done(true, { accept: 'You took it on.', giveup: "You gave it up. It's open again.", complete: `Done! ${q.helper} got ${kowens(q.reward)}.`, cancel: `Cancelled. Your ${kowens(q.reward)} came back.` }[body.action]);
}
