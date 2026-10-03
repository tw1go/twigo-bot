// Time of day → a multiply tint for the world (not the UI), and whether the lamps are lit.
//
// The colour holds at each stop and fades over FADE_MINUTES between them. Each fade is centred between the end of
// one stop and the start of the next, so every stop below is fully reached during its stated time:
//
//   Night 19:00–05:00  #5B5F9E      Dawn 06:30  #D9C3E8
//   Day   08:00–16:30  #FFFFFF      Dusk 17:30  #F2C9A5
//
// The time source is swappable (setTimeSource) so a server clock can drive it later; ?time=HH:MM overrides it for
// testing.

export const FADE_MINUTES = 20;

interface Stop {
  name: 'night' | 'dawn' | 'day' | 'dusk';
  from: number; // minutes after midnight
  to: number; // same as from for a single moment
  colour: number;
}

const m = (hhmm: string) => {
  const [h, mm] = hhmm.split(':').map(Number);
  return h * 60 + mm;
};

// In order through the day, starting from night (which wraps past midnight).
const STOPS: Stop[] = [
  { name: 'night', from: m('19:00'), to: m('05:00') + 1440, colour: 0x5b5f9e },
  { name: 'dawn', from: m('06:30') + 1440, to: m('06:30') + 1440, colour: 0xd9c3e8 },
  { name: 'day', from: m('08:00') + 1440, to: m('16:30') + 1440, colour: 0xffffff },
  { name: 'dusk', from: m('17:30') + 1440, to: m('17:30') + 1440, colour: 0xf2c9a5 },
];

export type TimeSource = () => Date;
let timeSource: TimeSource = () => new Date();
export const setTimeSource = (source: TimeSource) => (timeSource = source);

/** Minutes after local midnight, from the current time source. */
export function minutesNow(): number {
  const d = timeSource();
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

const lerp = (a: number, b: number, t: number) => {
  const ch = (c: number, s: number) => (c >> s) & 255;
  const mix = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
};

export interface Sky {
  tint: number;
  stop: Stop['name']; // the stop we are at or fading towards
  lampsOn: boolean;
}

/** The world tint at a time of day (minutes after midnight). */
export function skyAt(minutes: number): Sky {
  // Work on a 48h line starting at the night stop, so wrap-around is just arithmetic.
  let t = ((minutes % 1440) + 1440) % 1440;
  if (t < STOPS[0].from) t += 1440;
  for (let i = 0; i < STOPS.length; i++) {
    const cur = STOPS[i];
    const next = STOPS[(i + 1) % STOPS.length];
    const nextFrom = next.from + (i + 1 === STOPS.length ? 1440 : 0);
    const mid = (cur.to + nextFrom) / 2;
    const fadeStart = mid - FADE_MINUTES / 2;
    const fadeEnd = mid + FADE_MINUTES / 2;
    if (t < fadeStart) return sky(cur.colour, cur.name);
    if (t < fadeEnd) return sky(lerp(cur.colour, next.colour, (t - fadeStart) / FADE_MINUTES), next.name);
  }
  return sky(STOPS[0].colour, 'night');
}

// Lamps: lit from dusk to dawn — on as the light turns towards dusk, off as it turns towards dawn.
const sky = (tint: number, stop: Stop['name']): Sky => ({ tint, stop, lampsOn: stop === 'dusk' || stop === 'night' });
