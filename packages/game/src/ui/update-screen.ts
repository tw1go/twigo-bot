import { type UpdateState, type UpdateStore, progressOf, vOf } from '../net/update-state';

// 🔄 The update screen (CONTEXT.md "Update screen"): the desktop app installing a new version of itself, in the game's
// own style (the loading cover's navy, the crescent logo, Pixelify Sans): "Updating Mikazuki", "v0.1.560 → v0.1.575", a
// progress bar with the percent and the MB while it downloads, "Installing…" then "Mikazuki will close and open again
// by itself" (on Windows a few seconds pass with nothing on screen between the app closing and reopening: this line says
// that's expected). If it fails: "The update didn't work", Try again and Download: the player is never left without a
// button. It reads net/update-state.ts's store (net/desktop.ts moves it) and stays up until the app restarts.

export interface UpdateScreenActions {
  /** Try again: the install once more (net/desktop.ts startUpdate). */
  retry: () => void;
  /** Download: this system's installer in the browser (net/desktop.ts downloadFrom). */
  download: () => void;
  /** The version running now ("v0.1.560"). */
  from: string;
  /** The game's logo file (manifest ui.logoMikazuki), if it has one. */
  logo?: string;
}

let open: HTMLElement | null = null;

/** Shows the update screen over everything (once; a second call brings the same one). Closed by `hideUpdateScreen`
 *  (only the fake update needs that: a real one ends in a restart). */
export function showUpdateScreen(store: UpdateStore, actions: UpdateScreenActions): void {
  if (open) return;
  const root = document.createElement('div');
  root.id = 'update-screen';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-live', 'polite');
  const box = document.createElement('div');
  box.className = 'us-box';
  if (actions.logo) {
    const logo = document.createElement('img');
    logo.className = 'us-logo';
    logo.src = actions.logo;
    logo.alt = 'Mikazuki';
    logo.draggable = false;
    box.append(logo);
  }
  const title = document.createElement('h1');
  title.className = 'us-title';
  const versions = document.createElement('p');
  versions.className = 'us-versions';
  const bar = document.createElement('div');
  bar.className = 'us-bar';
  const fill = document.createElement('span');
  bar.append(fill);
  const line = document.createElement('p');
  line.className = 'us-line';
  const note = document.createElement('p');
  note.className = 'us-note';
  const buttons = document.createElement('div');
  buttons.className = 'us-buttons';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'us-button';
  retry.textContent = 'Try again';
  retry.addEventListener('click', () => actions.retry());
  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'us-button us-secondary';
  download.textContent = 'Download';
  download.addEventListener('click', () => actions.download());
  buttons.append(retry, download);
  box.append(title, versions, bar, line, note, buttons);
  root.append(box);
  document.body.append(root);
  open = root;
  document.body.classList.add('updating');

  const render = (s: UpdateState) => {
    const to = 'version' in s ? vOf(s.version) : null;
    versions.textContent = to ? `${vOf(actions.from)} → ${to}` : vOf(actions.from);
    root.classList.toggle('us-failed', s.state === 'failed');
    buttons.hidden = s.state !== 'failed';
    bar.hidden = s.state === 'failed';
    bar.classList.toggle('us-pulse', s.state === 'installing' || (s.state === 'downloading' && !s.total));
    if (s.state === 'failed') {
      title.textContent = "The update didn't work";
      line.textContent = s.error ? `(${s.error})` : '';
      note.textContent = 'Try again, or download the new version and install it over this one.';
      return;
    }
    title.textContent = 'Updating Mikazuki';
    if (s.state === 'downloading') {
      const p = progressOf(s.got, s.total);
      fill.style.width = `${p.percent ?? 100}%`;
      line.textContent = p.percent === null ? `Downloading… ${p.text}` : `Downloading… ${p.percent}% · ${p.text}`;
      note.textContent = '';
    } else if (s.state === 'installing') {
      fill.style.width = '100%';
      line.textContent = 'Installing…';
      note.textContent = 'Mikazuki will close and open again by itself.';
    } else {
      fill.style.width = '0%';
      line.textContent = 'Starting…';
      note.textContent = '';
    }
  };
  const off = store.subscribe(render);
  root.addEventListener('mk-update-screen-close', () => off(), { once: true });
}

/** Takes the screen down (the fake update's end; a real one restarts the app). */
export function hideUpdateScreen(): void {
  if (!open) return;
  open.dispatchEvent(new Event('mk-update-screen-close'));
  open.remove();
  open = null;
  document.body.classList.remove('updating');
}

export const updateScreenOpen = (): boolean => open !== null;
