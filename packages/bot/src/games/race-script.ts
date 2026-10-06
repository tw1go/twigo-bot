import type { TownRaceLane, TownRaceStop } from '@mikazuki/shared';

// 🏁 The Mosang race's script (games/race.ts), pure so the game's dev server can run a pretend race the same way:
// each Mosang's pace and her stops, the winner (the first over the line), where a Mosang is at any moment. The game
// has its own copy of laneAt (world/race-run.ts): keep them in step.

/** Runners in a race. */
export const LANES = 5;
const PHOTO_FINISH_CHANCE = 0.03; // 🤫 two Mosangs tie; both sets of backers win
// The town's track is the main road, west to east (about TRACK_TILES tiles); a Mosang walks it at PACE tiles a second
// between her stops.
const TRACK_TILES = 66;
const PACE: [number, number] = [2.1, 2.8];
type StopKind = TownRaceStop['kind'];
const STOP_MS: Record<StopKind, [number, number]> = {
  arthritis: [2500, 4000],
  asthma: [2000, 3500],
  gossip: [2500, 5000],
  phone: [1500, 3000],
  fall: [2200, 3200],
};

const between = ([a, b]: [number, number]) => a + Math.random() * (b - a);

/** One Mosang's run: her pace and 0–3 stops along the way. */
function laneScript(): TownRaceLane {
  const kinds = Object.keys(STOP_MS) as StopKind[];
  const n = Math.random() < 0.15 ? 0 : 1 + Math.floor(Math.random() * 3);
  const stops = Array.from({ length: n }, (): TownRaceStop => {
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    return { at: Math.round(between([0.08, 0.92]) * 1000) / 1000, ms: Math.round(between(STOP_MS[kind])), kind, line: Math.floor(Math.random() * 1000) };
  }).sort((a, b) => a.at - b.at);
  return { speed: between(PACE) / TRACK_TILES, stops };
}

/** How long a lane takes, start to finish (ms). */
export const finishMs = (l: TownRaceLane) => 1000 / l.speed + l.stops.reduce((n, s) => n + s.ms, 0);

/** How far along the track a lane is `ms` into the race (0–1), and the stop she's in, if any. */
export function laneAt(l: TownRaceLane, ms: number): { at: number; stop: TownRaceStop | null } {
  let t = 0; // ms spent so far
  let at = 0;
  for (const s of l.stops) {
    const walk = ((s.at - at) / l.speed) * 1000;
    if (ms < t + walk) return { at: at + ((ms - t) / 1000) * l.speed, stop: null };
    t += walk;
    at = s.at;
    if (ms < t + s.ms) return { at, stop: s };
    t += s.ms;
  }
  return { at: Math.min(1, at + ((ms - t) / 1000) * l.speed), stop: null };
}

/** Every lane's script, the winner (the first over the line) and, now and then, a photo finish. */
export function raceScript(lanes = LANES): { lanes: TownRaceLane[]; winner: number; tie: number; ms: number } {
  const script = Array.from({ length: lanes }, laneScript);
  const times = script.map(finishMs);
  const winner = times.indexOf(Math.min(...times));
  const ms = times[winner];
  let tie = -1;
  if (lanes > 1 && Math.random() < PHOTO_FINISH_CHANCE) {
    tie = (winner + 1 + Math.floor(Math.random() * (lanes - 1))) % lanes;
    script[tie] = { speed: 1000 / (ms + 1e-6), stops: [] }; // a clean run, crossing the line with her (never a hair ahead)
  }
  return { lanes: script, winner, tie, ms };
}
