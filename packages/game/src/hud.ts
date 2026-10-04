import type { MeResponse, PreregResponse, PreregStatus } from '@mikazuki/shared';
import { loadMe, loginProblem } from './session';

// The login corner of the web game. The room API is on the same origin (the game is served at /play/), so the
// session cookie rides along with plain relative requests. Built with DOM nodes and textContent only: names come
// from Discord and are never parsed as HTML.

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const plural = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'Kowen' : 'Kowens'}`;

export async function startHud(root: HTMLElement): Promise<void> {
  const problem = loginProblem();
  const [me, prereg] = await Promise.all([
    loadMe(),
    fetch('/prereg')
      .then((r) => (r.ok ? (r.json() as Promise<PreregStatus>) : null))
      .catch(() => null),
  ]);
  root.replaceChildren();
  if (me.status === 'ok') return renderMember(root, me.me, prereg);
  if (me.status === 'off') return; // login is off on this server (or it's down): show nothing

  const button = el('a', 'hud-login', 'Log in with Discord');
  button.href = '/auth/login';
  root.append(button);
  if (problem) root.append(el('div', 'hud-note', problem));
  if (prereg?.open) root.append(el('div', 'hud-prereg-note', `Log in to pre-register: +${prereg.reward} Kowens at launch · ${prereg.count} signed up`));
}

/** The pre-registration line under the member card (the town's HUD shows it too). */
export function renderPrereg(root: HTMLElement, me: MeResponse, prereg: PreregStatus | null): void {
  if (!prereg?.open) return;
  const box = el('div', 'hud-prereg');
  if (me.preregistered) {
    box.append(el('span', 'hud-prereg-done', `Pre-registered: +${prereg.reward} Kowens at launch`));
  } else {
    const join = el('button', 'hud-prereg-join', `Pre-register · +${prereg.reward} Kowens at launch`);
    join.addEventListener('click', async () => {
      join.disabled = true;
      const r = await fetch('/prereg', { method: 'POST', credentials: 'same-origin' }).catch(() => null);
      const body = r?.ok ? ((await r.json()) as PreregResponse) : null;
      if (body && body.result !== 'closed') {
        box.replaceChildren(el('span', 'hud-prereg-done', `Pre-registered! +${prereg.reward} Kowens at launch · ${body.count} signed up`));
      } else {
        join.disabled = false;
        box.append(el('div', 'hud-note', body?.result === 'closed' ? 'Pre-registration has closed.' : "Couldn't pre-register. Try again?"));
      }
    });
    box.append(join);
  }
  root.append(box);
}

function renderMember(root: HTMLElement, me: MeResponse, prereg: PreregStatus | null): void {
  const card = el('div', 'hud-card');
  if (me.avatar) {
    const img = el('img', 'hud-avatar');
    img.src = me.avatar;
    img.alt = '';
    card.append(img);
  }
  const info = el('div', 'hud-info');
  info.append(el('div', 'hud-name', me.name));
  const purse = plural(me.kowens) + (me.vault ? ` · vault ${me.vault}` : '') + (me.rank ? ` · #${me.rank}` : '');
  info.append(el('div', 'hud-kowens', purse));
  const items = me.items.reduce((n, i) => n + i.count, 0);
  if (items) info.append(el('div', 'hud-items', `${items} item${items === 1 ? '' : 's'}`));
  card.append(info);

  const out = el('button', 'hud-logout', 'Log out');
  out.addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => null);
    location.reload();
  });
  card.append(out);
  root.append(card);
  renderPrereg(root, me, prereg);
}
