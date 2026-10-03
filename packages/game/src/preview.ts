// Until launch the town is only shown with ?preview. The choice is remembered in this browser, because logging
// in with Discord comes back to /play/ without the query string. ?preview=off forgets it.

const KEY = 'mk_preview';

export function previewEnabled(): boolean {
  const param = new URLSearchParams(location.search).get('preview');
  try {
    if (param === 'off') localStorage.removeItem(KEY);
    else if (param !== null) localStorage.setItem(KEY, '1');
    return param === 'off' ? false : param !== null || localStorage.getItem(KEY) === '1';
  } catch {
    return param !== null && param !== 'off';
  }
}

/** The page everyone else sees: what's coming, with the login and pre-register corner on top. */
export function showComingSoon(root: HTMLElement): void {
  const card = document.createElement('div');
  card.id = 'coming-soon';
  const title = document.createElement('h1');
  title.textContent = '🏘️ Mikazuki town';
  const line = document.createElement('p');
  line.textContent = 'twigo is cooking up something. A little world of our own, right in your browser, is coming soon.';
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = 'Log in with Discord (top right) to pre-register and get Kowens at launch.';
  card.append(title, line, hint);
  root.append(card);
}
