import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// Persistent "no repeat" rotation: every line is used once before any repeats, the last line of a round
// is never the first of the next, and progress survives restarts. Lines added mid-round join the round.

interface BagState {
  remaining: string[];
  used: string[];
}

const DIR = 'data';
const FILE = `${DIR}/rotation.json`;
let state: Record<string, BagState> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};

function save(): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(state));
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Returns a function that draws the next line for `name` from `items`. */
export function shuffleBag(name: string, items: readonly string[]): () => string {
  return () => {
    const current = new Set(items);
    const bag = state[name] ?? { remaining: [], used: [] };
    // Drop lines that were removed from the list; add brand-new lines to this round.
    bag.remaining = bag.remaining.filter((l) => current.has(l));
    bag.used = bag.used.filter((l) => current.has(l));
    const known = new Set([...bag.remaining, ...bag.used]);
    for (const l of items) if (!known.has(l)) bag.remaining.splice(Math.floor(Math.random() * (bag.remaining.length + 1)), 0, l);

    if (bag.remaining.length === 0) {
      const last = bag.used.at(-1);
      bag.remaining = shuffle([...items]);
      // remaining is popped from the end — make sure the first pick isn't the line we just used.
      if (bag.remaining.length > 1 && bag.remaining.at(-1) === last) {
        [bag.remaining[0], bag.remaining[bag.remaining.length - 1]] = [bag.remaining[bag.remaining.length - 1], bag.remaining[0]];
      }
      bag.used = last ? [last] : [];
    }

    const line = bag.remaining.pop()!;
    bag.used.push(line);
    state[name] = bag;
    save();
    return line;
  };
}
