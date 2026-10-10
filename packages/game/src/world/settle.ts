// ⏳ The work an arrival waits for behind the loading cover (ui/loading-cover.ts): other players' looks and combat poses
// being built, and anything else that would stall frames in the first moments. Each is a promise, tracked until it's
// settled. TownScene keeps the cover up while any is (with the world still streaming in, or the server's first word
// still to come), then once frames run smoothly it lifts it and the title card plays.

const pending = new Map<Promise<unknown>, string>();

/** Tracks `p` (the arrival waits for it; `what` says what it is) and gives it back. */
export function settleOn<T>(p: Promise<T>, what = ''): Promise<T> {
  pending.set(p, what);
  const done = () => pending.delete(p);
  p.then(done, done);
  return p;
}

/** How much is still being built. */
export const settling = (): number => pending.size;

/** What's still being built (debugging). */
export const settlingWhat = (): string[] => [...pending.values()];

if (import.meta.env.DEV) (globalThis as { __settling?: () => string[] }).__settling = settlingWhat;
