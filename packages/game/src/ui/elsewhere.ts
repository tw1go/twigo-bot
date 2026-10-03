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
