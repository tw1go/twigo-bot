// A short message at the bottom of the screen (door hooks, hints). DOM text only: never parsed as HTML.
let hideTimer: ReturnType<typeof setTimeout> | undefined;

/** `tone`: 'bad' (an error, a red edge) or 'good' (a green one); plain otherwise. */
export function toast(text: string, ms = 2200, tone: 'bad' | 'good' | null = null): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.toggle('toast-bad', tone === 'bad');
  el.classList.toggle('toast-good', tone === 'good');
  el.classList.add('show');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => el!.classList.remove('show'), ms);
}
