// ⏱ The bot stalling: a timer that should fire every `everyMs` and comes late means the bot's one thread was busy
// (a long job, a big save, a join that took a while), and every player's game froze with it: no steps, mobs or hits
// reached them meanwhile. A stall over `overMs` is reported (server.ts logs it with who's on, for the lag report's
// "server quiet then a burst" lines to be matched against). Pure but for its clock: `now` and `every` are given in tests.

export interface StallWatch {
  stop(): void;
}

export function watchStalls(
  onStall: (ms: number) => void,
  { everyMs = 100, overMs = 250, now = () => performance.now(), every = (fn: () => void, ms: number) => setInterval(fn, ms) as unknown as { unref?: () => void } } = {},
): StallWatch {
  let last = now();
  const timer = every(() => {
    const t = now();
    const late = t - last - everyMs;
    last = t;
    if (late > overMs) onStall(Math.round(late));
  }, everyMs);
  timer.unref?.(); // (never keeps the bot from stopping)
  return { stop: () => clearInterval(timer as unknown as NodeJS.Timeout) };
}
