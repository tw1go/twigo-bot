import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { today } from '../time.js';

// Persisted so a restart mid-Saturday doesn't lose the poll/participants.
export type MatchStatus = 'asked' | 'skipped' | 'polling' | 'closed';

export interface MatchState {
  date: string; // YYYY-MM-DD in config.timezone
  status: MatchStatus;
  askMessageId?: string;
  pollMessageId?: string;
  participantIds: string[];
}

const DIR = 'data';
const FILE = `${DIR}/match-state.json`;

export { today };

/** Returns today's state, or undefined if nothing has happened today. */
export function loadToday(): MatchState | undefined {
  if (!existsSync(FILE)) return undefined;
  const state = JSON.parse(readFileSync(FILE, 'utf8')) as MatchState;
  return state.date === today() ? state : undefined;
}

export function save(state: MatchState): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(state, null, 2));
}
