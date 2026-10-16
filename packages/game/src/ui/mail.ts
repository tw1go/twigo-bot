import { type Item, type TownMail, type TownMailActionResponse, hasAttachments } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { loadMail, mailAction } from '../net/mail';
import { itemPicture, itemTipFor, nameOf } from './item-tip';
import { markdown } from './news';
import { coinIcon, el, kusingIcon, showPopup } from './reward';
import { toast } from './toast';

// ✉️ The mailbox (CONTEXT.md "Mail"): the HUD's mail button or a mailbox in town opens it, in the reward box. The list on
// the left (newest first: unread in bold with a dot, a clip while something's still attached), the open letter on the
// right (on phones one or the other, with Back): who it's from, when, how long it stays, the letter (the news board's
// markdown), what's attached (items with their tooltips, Kusing, Kowens) and Claim; Claim all and Delete read under
// both. Opening a letter marks it read. A claim tells the town ('mk-mail-got': the "Gained …" lines in your feed).

const DAY = 86_400_000;

export function showMail(): void {
  const open = document.querySelector<HTMLButtonElement>('#reward:has(.ml-body) .rw-ok');
  if (open) return void open.click(); // the button toggles it

  const body = el('div', 'ml-body');
  const list = el('div', 'ml-list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Mail');
  const read = el('div', 'ml-read');
  const foot = el('div', 'ml-foot');
  const claimAll = el('button', 'bk-button ml-claim-all', 'Claim all');
  const clear = el('button', 'bk-button bk-plain ml-clear', 'Delete read');
  const note = el('div', 'bk-note ml-note', 'Loading…');
  note.setAttribute('role', 'status');
  foot.append(claimAll, clear);
  body.append(list, read, foot, note);
  const tip = el('div', 'iv-tip ml-tip');
  tip.hidden = true;
  document.body.append(tip);

  let mail: TownMail[] = [];
  let current: number | null = null;
  let busy = false;

  const render = () => {
    const open = mail.find((m) => m.id === current) ?? null;
    body.classList.toggle('reading', !!open);
    list.replaceChildren(...(mail.length ? mail.map(row) : [el('div', 'ml-empty', 'No mail. Letters from the Tanod and the Game Masters land here.')]));
    read.replaceChildren(...(open ? letter(open) : [el('div', 'ml-empty', mail.length ? 'Pick a letter.' : '')]));
    claimAll.disabled = busy || !mail.some(hasAttachments);
    clear.disabled = busy || !mail.some((m) => m.read && !hasAttachments(m));
  };

  const row = (m: TownMail) => {
    const b = el('button', `ml-row${m.read ? '' : ' unread'}${m.id === current ? ' on' : ''}`);
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(m.id === current));
    const top = el('div', 'ml-row-top');
    top.append(el('span', 'ml-from', m.from), el('span', 'ml-date', date(m.at)));
    const title = el('div', 'ml-title', m.title);
    if (hasAttachments(m)) title.prepend(el('span', 'ml-clip', '📎'));
    b.append(top, title);
    b.addEventListener('click', () => void pick(m));
    return b;
  };

  const letter = (m: TownMail): HTMLElement[] => {
    const back = el('button', 'bk-button bk-plain ml-back', '‹ Back');
    back.addEventListener('click', () => {
      current = null;
      render();
    });
    const days = Math.max(1, Math.ceil((m.expires - Date.now()) / DAY));
    const head = el('div', 'ml-head');
    head.append(el('div', 'ml-subject', m.title), el('div', 'ml-meta', `From ${m.from} · ${date(m.at)} · gone in ${days} ${days === 1 ? 'day' : 'days'}`));
    const text = el('div', 'nw-text ml-text');
    text.append(...markdown(m.body));
    const out: HTMLElement[] = [back, head, text];
    if (m.kowens || m.kusing || m.items.length) {
      const box = el('div', `ml-att${m.claimed ? ' claimed' : ''}`);
      const things = el('div', 'ml-things');
      for (const it of m.items) things.append(cell(it));
      if (m.kusing) things.append(money(kusingIcon(2), m.kusing, 'Kusing'));
      if (m.kowens) things.append(money(coinIcon(2), m.kowens, m.kowens === 1 ? 'Kowen' : 'Kowens'));
      const claim = el('button', 'bk-button ml-claim', m.claimed ? 'Claimed' : 'Claim');
      claim.disabled = m.claimed || busy;
      claim.addEventListener('click', () => void act({ action: 'claim', id: m.id }));
      box.append(el('div', 'ml-att-label', 'Attached'), things, claim);
      out.push(box);
    }
    if (!hasAttachments(m)) {
      const del = el('button', 'bk-button bk-plain ml-delete', 'Delete');
      del.addEventListener('click', () => void act({ action: 'delete', id: m.id }));
      out.push(del);
    }
    return out;
  };

  const cell = (it: Item) => {
    const c = el('div', 'ml-cell');
    c.append(itemPicture(it, 'icon', 2));
    if (it.count > 1) c.append(el('span', 'ml-count', `×${it.count}`));
    c.setAttribute('aria-label', nameOf(it));
    c.addEventListener('pointerenter', () => {
      tip.replaceChildren(...itemTipFor(it));
      tip.hidden = false;
      const r = c.getBoundingClientRect();
      const w = tip.offsetWidth;
      tip.style.left = `${Math.round(r.right + 6 + w > innerWidth - 8 ? Math.max(8, r.left - w - 6) : r.right + 6)}px`;
      tip.style.top = `${Math.round(Math.max(8, Math.min(r.top, innerHeight - tip.offsetHeight - 8)))}px`;
    });
    c.addEventListener('pointerleave', () => (tip.hidden = true));
    return c;
  };

  const money = (icon: HTMLElement, n: number, label: string) => {
    const m = el('div', 'ml-money');
    m.append(icon, el('b', undefined, n.toLocaleString()), el('span', undefined, label));
    return m;
  };

  const pick = async (m: TownMail) => {
    current = m.id;
    tip.hidden = true;
    render();
    if (m.read) return;
    m.read = true; // (shown at once; the server agrees below)
    render();
    const r = await mailAction({ action: 'read', id: m.id });
    if (r) take(r);
  };

  const take = (r: TownMailActionResponse | { mail: TownMail[] }) => {
    mail = r.mail;
    if (current !== null && !mail.some((m) => m.id === current)) current = null;
    render();
  };

  const act = async (a: Parameters<typeof mailAction>[0]) => {
    if (busy) return;
    busy = true;
    tip.hidden = true;
    render();
    const r = await mailAction(a);
    busy = false;
    if (!r) {
      note.textContent = "Couldn't reach the mailbox. Try again in a moment.";
      return render();
    }
    note.textContent = r.message ?? '';
    if (!r.ok) {
      playSound('error');
      toast(r.message ?? "That didn't work.", 2600, 'bad');
    }
    if (r.got) {
      playSound('combat-loot-pickup');
      dispatchEvent(new CustomEvent('mk-mail-got', { detail: r.got }));
    }
    take(r);
  };

  claimAll.addEventListener('click', () => void act({ action: 'claim-all' }));
  clear.addEventListener('click', () => void act({ action: 'delete-read' }));

  void showPopup({ title: 'Mail', body: [body], button: 'Close', celebrate: false }).then(() => tip.remove());
  void loadMail().then((m) => {
    if (!m) return void (note.textContent = "Couldn't load your mail. Try again in a moment.");
    note.textContent = '';
    mail = m.mail;
    // Wide: the newest unread open at once.
    const first = mail.find((x) => !x.read);
    if (first && matchMedia('(min-width: 561px)').matches) void pick(first);
    else render();
  });
}

const date = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
