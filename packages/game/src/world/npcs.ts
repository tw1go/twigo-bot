import type { Dir } from '../assets/types';

// 🧑‍🤝‍🧑 The town's ambient NPCs: where each one lives and what they do there. Data only (tweak freely); the life is in
// world/npc-life.ts and the talking in ui/npc-dialog.ts. Names, titles and lines come from the art's
// npcs/npc-dialogue.json (manifest npcs.dialogue).
//
// Tiles are [col, row] in town.json: walkable, not on or next to a door, a gate, a bench (or where you sit on it) or
// the spawn, and not where a building or a big prop is drawn over them (they'd be hidden, and unclickable). The town checks them as it starts and leaves out (with a console warning) any that don't hold.

export type NpcBehaviour =
  /** Walks `route` in a loop, pausing at each stop; now and then whistles there. */
  | { kind: 'patrol'; route: [number, number][]; pauseMs: [number, number]; whistleChance: number }
  /** Every `everyMs`, walks to a random free tile within `radius` of home, then idles. */
  | { kind: 'wander'; radius: number; everyMs: [number, number] }
  /** Never moves. */
  | { kind: 'still' };

export interface NpcPlace {
  id: string;
  home: [number, number];
  behaviour: NpcBehaviour;
  /** Walking speed as a share of the player's. */
  speed: number;
  /** While idle, always faces this tile (Aling Nena keeps her binoculars on the plaza); else the nearest player. */
  watch?: [number, number];
  /** Facing at the start. */
  faces?: Dir;
  /** Says her lines on her own now and then (a speech bubble), when a player is near. */
  gossip: boolean;
  /** Their voice: the playback rate of the talk blips while a line types out (1 = as recorded; lower = deeper). */
  voice: number;
  /** Which way their portrait faces in the dialog box: the art faces SE; 'sw' mirrors it. */
  portrait: 'se' | 'sw';
}

const SMALL: NpcBehaviour = { kind: 'wander', radius: 2, everyMs: [6_000, 12_000] };
const SLOW: NpcBehaviour = { kind: 'wander', radius: 3, everyMs: [10_000, 20_000] };
const STILL: NpcBehaviour = { kind: 'still' };
/** The middle of the plaza (the fountain), for Nena's binoculars. */
const PLAZA: [number, number] = [35, 35];

export const NPC_PLACES: NpcPlace[] = [
  {
    id: 'tanod',
    home: [38, 53], // by the Tanod outpost
    // Up the south road, round the plaza (SW, NW, NE, SE corners) and back down to the outpost.
    behaviour: { kind: 'patrol', route: [[38, 53], [36, 47], [31, 41], [29, 33], [34, 30], [39, 32], [41, 40], [37, 45]], pauseMs: [2_000, 4_000], whistleChance: 0.25 },
    speed: 0.8,
    gossip: false,
    voice: 0.75,
    portrait: 'se',
  },
  { id: 'marites', home: [37, 36], behaviour: SMALL, speed: 0.6, faces: 'sw', gossip: true, voice: 1.1, portrait: 'sw' }, // the plaza, by the fountain
  { id: 'nena', home: [31, 38], behaviour: STILL, speed: 0.6, watch: PLAZA, gossip: true, voice: 0.95, portrait: 'se' }, // the plaza's south-west side, in plain view (by the bank's wall the bank hid her)
  { id: 'puring', home: [31, 33], behaviour: SMALL, speed: 0.6, faces: 'se', gossip: true, voice: 1.05, portrait: 'sw' }, // the plaza's benches
  { id: 'tessie', home: [29, 14], behaviour: STILL, speed: 0.6, faces: 'sw', gossip: true, voice: 1.12, portrait: 'se' }, // beside the sari-sari store
  { id: 'dolor', home: [38, 45], behaviour: SMALL, speed: 0.6, faces: 'sw', gossip: true, voice: 1.22, portrait: 'sw' }, // the south road, where people arrive
  { id: 'bebang', home: [29, 52], behaviour: SLOW, speed: 0.6, faces: 's', gossip: true, voice: 0.92, portrait: 'se' }, // by twigo's house
  { id: 'charing', home: [29, 24], behaviour: STILL, speed: 0.6, faces: 'se', gossip: true, voice: 1.3, portrait: 'sw' }, // near the notice board
  { id: 'lourdes', home: [24, 40], behaviour: SMALL, speed: 0.6, faces: 'sw', gossip: true, voice: 1.18, portrait: 'se' }, // near the jackpot booth
  { id: 'pacita', home: [50, 31], behaviour: STILL, speed: 0.6, faces: 'sw', gossip: true, voice: 1.0, portrait: 'sw' }, // by the bank
  { id: 'rosing', home: [42, 25], behaviour: SLOW, speed: 0.6, faces: 'sw', gossip: true, voice: 0.9, portrait: 'se' }, // near the leaderboard monument
];
