import type { MeResponse } from '@mikazuki/shared';

// The login corner of the web game. The room API is on the same origin (the game is served at /play/), so the
// session cookie rides along with plain relative requests. Built with DOM nodes and textContent only: names come
// from Discord and are never parsed as HTML.

const PROBLEMS: Record<string, string> = {
  'not-member': 'Only members of the Mikazuki server can log in.',
  failed: "Couldn't log in. Try again?",
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const plural = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'Kowen' : 'Kowens'}`;

export async function startHud(root: HTMLElement): Promise<void> {
  // ?login=… comes back from a failed or cancelled login; show it once and tidy the address bar.
  const params = new URLSearchParams(location.search);
  const problem = PROBLEMS[params.get('login') ?? ''];
  if (params.has('login')) history.replaceState(null, '', location.pathname);

  const res = await fetch('/me', { credentials: 'same-origin' }).catch(() => null);
  root.replaceChildren();
  if (res?.ok) return renderMember(root, (await res.json()) as MeResponse);
  if (res && res.status !== 401) return; // login is off on this server (or it's down): show nothing

  const button = el('a', 'hud-login', 'Log in with Discord');
  button.href = '/auth/login';
  root.append(button);
  if (problem) root.append(el('div', 'hud-note', problem));
}

function renderMember(root: HTMLElement, me: MeResponse): void {
  const card = el('div', 'hud-card');
  if (me.avatar) {
    const img = el('img', 'hud-avatar');
    img.src = me.avatar;
    img.alt = '';
    card.append(img);
  }
  const info = el('div', 'hud-info');
  info.append(el('div', 'hud-name', me.name));
  const purse = `🪙 ${plural(me.kowens)}` + (me.vault ? ` · 🔒 ${me.vault}` : '') + (me.rank ? ` · #${me.rank}` : '');
  info.append(el('div', 'hud-kowens', purse));
  const items = me.items.reduce((n, i) => n + i.count, 0);
  if (items) info.append(el('div', 'hud-items', `🎒 ${items} item${items === 1 ? '' : 's'}`));
  card.append(info);

  const out = el('button', 'hud-logout', 'Log out');
  out.addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => null);
    location.reload();
  });
  card.append(out);
  root.append(card);
}
