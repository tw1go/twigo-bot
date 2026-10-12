import { kvLoad, kvSave } from '../db/db.js';

// 🚧 Maintenance mode (the CMS's Maintenance tab): while it's on, only the CMS's users (the gifter and CMS_USER_IDS) can
// be in the town; everyone else is sent out as it goes on (web/town.ts `closeForMaintenance`, close code MAINTENANCE)
// and refused at the door after, and the game's title screen says so instead of Start (`/me` carries it). Kept in the
// bot's database (kv 'maintenance'), so a deploy's restart keeps it on until it's turned off again.

export interface MaintenanceState {
  on: boolean;
  /** What the title screen says under "Under maintenance" (empty: a plain line). */
  note: string;
  /** When it went on (ms) and who turned it (a Discord name), for the CMS. */
  since?: number;
  by?: string;
}

/** The title screen's line when there's no note. */
export const DEFAULT_NOTE = 'Mikazuki is being worked on. Back soon!';
export const NOTE_MAX = 200;

const KEY = 'maintenance';
const state = kvLoad<MaintenanceState>(KEY, { on: false, note: '' });

export const maintenance = (): Readonly<MaintenanceState> => state;

/** Turns it on (with a note, tidied) or off; returns the state. Turning it on again only changes the note. */
export function setMaintenance(on: boolean, note: string, by: string): Readonly<MaintenanceState> {
  const text = note.replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
  if (on) {
    if (!state.on) state.since = Date.now();
    state.on = true;
    state.note = text;
    state.by = by;
  } else {
    state.on = false;
    state.note = '';
    delete state.since;
    delete state.by;
  }
  kvSave(KEY, state);
  return state;
}

/** What the title screen shows: the note, or the plain line. */
export const maintenanceNote = (): string => state.note || DEFAULT_NOTE;
