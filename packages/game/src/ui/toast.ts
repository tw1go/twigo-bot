// A short message at the bottom of the screen (door hooks, hints). DOM text only: never parsed as HTML.
let hideTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(text: string, ms = 2200): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => el!.classList.remove('show'), ms);
}
