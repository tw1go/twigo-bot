// Shown when the town was opened on another device or tab (one character per member): this one is offline until
// "Play here" takes the town back (which sends the other one here). DOM text only.

export function showElsewhere(playHere: () => void): void {
  document.getElementById('elsewhere')?.remove();
  const root = document.createElement('div');
  root.id = 'elsewhere';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Playing somewhere else');
  const card = document.createElement('div');
  card.className = 'ew-card';
  const title = document.createElement('h2');
  title.textContent = "You're in town somewhere else";
  const line = document.createElement('p');
  line.textContent = 'Your character is on another device or tab right now. Play here to bring it to this one.';
  const button = document.createElement('button');
  button.className = 'ew-play';
  button.textContent = 'Play here';
  button.addEventListener('click', () => {
    root.remove();
    playHere();
  });
  card.append(title, line, button);
  root.append(card);
  document.body.append(root);
  button.focus();
}

/** Removed from the town by a moderator: when they can come back, and a button to try (reloads the page). */
export function showKicked(until: number): void {
  document.getElementById('elsewhere')?.remove();
  const root = document.createElement('div');
  root.id = 'elsewhere';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Removed from the town');
  const card = document.createElement('div');
  card.className = 'ew-card';
  const title = document.createElement('h2');
  title.textContent = 'Removed from the town';
  const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60_000));
  const line = document.createElement('p');
  line.textContent = `A moderator removed you from Mikazuki town. You can come back in about ${minutes} minute${minutes === 1 ? '' : 's'}. Please keep the town friendly.`;
  const button = document.createElement('button');
  button.className = 'ew-play';
  button.textContent = 'Try again';
  button.addEventListener('click', () => location.reload());
  card.append(title, line, button);
  root.append(card);
  document.body.append(root);
}

/** Maintenance mode went on while you were in town (net/town.ts MAINTENANCE): out until it's off; Try again reloads
 *  (the title screen then says when it's still on). */
export function showMaintenance(note: string): void {
  document.getElementById('elsewhere')?.remove();
  const root = document.createElement('div');
  root.id = 'elsewhere';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Under maintenance');
  const card = document.createElement('div');
  card.className = 'ew-card';
  const title = document.createElement('h2');
  title.textContent = '🚧 Under maintenance';
  const line = document.createElement('p');
  line.textContent = note || 'Mikazuki is being worked on. Back soon!';
  const more = document.createElement('p');
  more.textContent = 'The town is closed for a moment. Nothing is lost: come back in a bit.';
  const button = document.createElement('button');
  button.className = 'ew-play';
  button.textContent = 'Try again';
  button.addEventListener('click', () => location.reload());
  card.append(title, line, more, button);
  root.append(card);
  document.body.append(root);
}
