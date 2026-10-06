import type { TownRaceLane, TownRaceStop } from '@mikazuki/shared';

// 🏁 The Mosang race's track and words (data; the running is world/npc-life.ts). The track is the main road, west to
// east: lane by lane, where each runner lines up (the left end of the road) and where she finishes (just before the
// bridge to the neighbourhood). [col, row] in town.json, on walkable tiles (one that isn't is swapped for the nearest
// reachable tile, with a warning).

export const RACE_START: [number, number][] = [[2, 33], [2, 34], [2, 35], [2, 36], [2, 37]];
export const RACE_FINISH: [number, number][] = [[66, 33], [68, 34], [68, 35], [68, 36], [66, 37]]; // (67–68 on rows 33 and 37 are the bridge's lamps and trees)

/** What a runner says when she stops (the bot's script picks the kind and a number; the line is that number modulo
 *  the list). */
export const STOP_LINES: Record<TownRaceStop['kind'], string[]> = {
  arthritis: ['Aray, ang tuhod ko!', 'Teka… sumasakit ang rayuma ko.', 'Hay, ang likod ko!', 'Pahinga muna, mga mare…'],
  asthma: ['*hingal* Teka lang… *hingal*', 'Nasaan ang inhaler ko?!', 'Hindi na ako bata, ha!', 'Ay, hinihingal na ako…'],
  gossip: ["Ay, ano 'yon?! Sino'ng naghiwalay?", "Teka, narinig ko 'yan!", 'Psst! Ano’ng balita?', "Totoo ba 'yan?! Ikuwento mo!"],
  phone: ['Teka, may bagong message sa GC!', 'Ay, nag-chat si Mareng Lourdes!', 'Seen lang?! Hmp!', 'Wait lang, nagla-live ako!'],
  fall: ['Ay! Nadapa ako!', 'Aray ko po!', "Sino'ng naglagay ng bato dito?!", 'Okay lang ako! Okay lang!'],
};

/** Now and then at the starting line, while the bets come in. */
export const WARMUP_LINES = ['Handa na ako!', "Kaya ko 'to!", 'Tumaya kayo sa akin!', 'Mag-iinat muna ako.', 'Unahan tayo sa chismis!'];

/** How far along the track a lane is `ms` into the race (0–1), the stop she's in and how long it has left. The bot's laneAt
 *  (games/race-script.ts) is the reference: keep them in step. */
export function laneAt(l: TownRaceLane, ms: number): { at: number; stop: TownRaceStop | null; stopLeft: number } {
  let t = 0;
  let at = 0;
  for (const s of l.stops) {
    const walk = ((s.at - at) / l.speed) * 1000;
    if (ms < t + walk) return { at: at + ((ms - t) / 1000) * l.speed, stop: null, stopLeft: 0 };
    t += walk;
    at = s.at;
    if (ms < t + s.ms) return { at, stop: s, stopLeft: t + s.ms - ms };
    t += s.ms;
  }
  return { at: Math.min(1, at + ((ms - t) / 1000) * l.speed), stop: null, stopLeft: 0 };
}
