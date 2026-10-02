import { kvLoad, kvSave } from '../db/db.js';
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

const KEY = 'match-state.json'; // kv key (its old file name)

export { today };

/** Returns today's state, or undefined if nothing has happened today. */
export function loadToday(): MatchState | undefined {
  const state = kvLoad<MatchState | null>(KEY, null);
  return state?.date === today() ? state : undefined;
}

export function save(state: MatchState): void {
  kvSave(KEY, state);
}
