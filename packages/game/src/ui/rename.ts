import { playSound } from '../audio/sound';
import { NICKNAME_RULE, parseNickname } from '../characters/nickname';
import { fakeLogin } from '../session';
import { itemArt } from './item-art';
import { el, showPopup } from './reward';

// 🪪 Using a Rename Card (from the bag): a pop-up with the card, a field for the new nickname (the creator's rules,
// checked here first; the bot has the last word: POST /town/rename) and Rename. On success the pop-up closes, everyone
// in town sees the new name (the server's rename message; yours: 'mk-renamed', the tag and the HUD), and `done` gets it.

type Reply = { ok: true; nickname: string; cards: number } | { ok: false; error: string };

export function showRename(done: (nickname: string) => void): void {
  const body = el('div', 'rn-body');
  const art = itemArt('rename-card', 'common', 'showcase', 2);
  const input = el('input', 'rn-input');
  input.maxLength = 16;
  input.placeholder = 'New nickname';
  input.setAttribute('aria-label', 'New nickname');
  input.autocomplete = 'off';
  const go = el('button', 'rn-go', 'Rename');
  const note = el('p', 'rn-note', NICKNAME_RULE);
  note.setAttribute('role', 'status');
  const row = el('div', 'rn-row');
  row.append(input, go);
  body.append(...(art ? [art] : []), el('p', 'rn-text', 'Pick your new town nickname. Everyone sees it at once.'), row, note);

  let busy = false;
  const submit = async () => {
    if (busy) return;
    const nickname = parseNickname(input.value);
    if (!nickname) {
      playSound('error');
      note.textContent = NICKNAME_RULE;
      note.classList.add('rn-bad');
      return;
    }
    busy = true;
    go.disabled = true;
    const res: Reply | null = fakeLogin()
      ? { ok: true, nickname, cards: 0 }
      : await fetch('/town/rename', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname }) })
          .then((r) => (r.ok ? (r.json() as Promise<Reply>) : null))
          .catch(() => null);
    busy = false;
    go.disabled = false;
    if (!res || !res.ok) {
      playSound('error');
      note.textContent = res ? res.error : "Couldn't reach the bot. Try again in a moment.";
      note.classList.add('rn-bad');
      return;
    }
    playSound('coin');
    window.dispatchEvent(new CustomEvent('mk-renamed', { detail: res.nickname }));
    document.querySelector<HTMLButtonElement>('#reward:has(.rn-body) :is(.rw-x, .rw-ok)')?.click(); // close it
    done(res.nickname);
  };
  go.addEventListener('click', () => void submit());
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // not the town's keys (B, I, J…)
    if (e.key === 'Enter') void submit();
  });
  void showPopup({ title: 'Rename Card', body: [body], button: 'Close', celebrate: false, closeX: true });
  requestAnimationFrame(() => input.focus());
}
