// 🔑 The login screen: the town is for members of the Mikazuki server, so it starts with Discord. (When login is
// off on the server, BootScene skips this and lets everyone in.) DOM text only.

export function showLogin(problem: string | null): void {
  const root = document.createElement('div');
  root.id = 'login';
  const card = document.createElement('div');
  card.className = 'lg-card';
  const title = document.createElement('h1');
  title.textContent = 'Mikazuki';
  const line = document.createElement('p');
  line.textContent = 'A little town for the Mikazuki Discord server.';
  const button = document.createElement('a');
  button.className = 'lg-discord';
  button.href = '/auth/login';
  button.textContent = 'Log in with Discord';
  card.append(title, line, button);
  const note = document.createElement('p');
  if (problem) {
    note.className = 'lg-problem';
    note.textContent = problem;
  } else {
    note.className = 'lg-hint';
    note.textContent = 'Members of the Mikazuki server only.';
  }
  card.append(note);
  root.append(card);
  document.body.append(root);
}

/** Logged in, but the town is only open to testers for now (the bot decides: /me canPlay). */
export function showTestersOnly(name: string): void {
  const root = document.createElement('div');
  root.id = 'login';
  const card = document.createElement('div');
  card.className = 'lg-card';
  const title = document.createElement('h1');
  title.textContent = 'Almost there';
  const line = document.createElement('p');
  line.textContent = `Hi ${name}! Mikazuki town is open to testers for now. You'll be able to come in at launch.`;
  const out = document.createElement('button');
  out.className = 'lg-out';
  out.textContent = 'Log out';
  out.addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => null);
    location.reload();
  });
  card.append(title, line, out);
  root.append(card);
  document.body.append(root);
}
