import type { TownDailyClaim, TownDailyInfo, TownStayClaim, TownStayInfo } from '@mikazuki/shared';
import { add, claim, claimedToday, dailyAmount, dailyCredits } from '../credits/store.js';
import { setting } from '../games/settings.js';
import { kvLoad, kvSave } from '../db/db.js';
import { markFound } from '../games/found.js';
import { today } from '../time.js';

// ⏳ Staying in the web town pays: every stayMinutes() of being in town (connected; counted a minute at a time by the
// web server) a Kowen becomes ready to claim, shown as a pop-up above the town's system feed. The counter waits while
// one is ready and starts on the next once it's claimed. At most stayDailyCap() a day (the bot's day); time already
// counted is kept across visits. Kept in kv 'town-stay'.
// The daily Kowens (/get-kowens) can be claimed here too: the same claim, once a day whichever comes first.

/** Minutes per stay Kowen and the most a day (the CMS's Rewards tab; games/settings.ts). */
export const stayMinutes = () => setting('stay-minutes');
export const stayDailyCap = () => setting('stay-cap');

type Stay = { day: string; claimed: number; minutes: number; ready: boolean };
const KEY = 'town-stay';
let stays = kvLoad<Record<string, Stay>>(KEY, {});

/** Their record, with today's claims (a new day starts them at 0; a Kowen still waiting stays ready). */
function stayOf(userId: string): Stay {
  const day = today();
  const s = (stays[userId] ??= { day, claimed: 0, minutes: 0, ready: false });
  if (s.day !== day) Object.assign(s, { day, claimed: 0 });
  return s;
}

export function stayInfo(userId: string): TownStayInfo {
  const s = stayOf(userId);
  return { ready: s.ready, minutes: s.minutes, every: stayMinutes(), claimed: s.claimed, max: stayDailyCap() };
}

/** A minute in town for each of these members; returns who now has a Kowen ready. */
export function stayMinute(userIds: string[]): string[] {
  const ready: string[] = [];
  for (const id of userIds) {
    const s = stayOf(id);
    if (s.ready || s.claimed >= stayDailyCap()) continue;
    s.minutes += 1;
    if (s.minutes < stayMinutes()) continue;
    s.minutes = 0;
    s.ready = true;
    ready.push(id);
  }
  if (userIds.length) {
    stays = { ...stays };
    kvSave(KEY, stays);
  }
  return ready;
}

/** Claims the Kowen that's ready (the next one starts counting). */
export function claimStay(userId: string): TownStayClaim {
  const s = stayOf(userId);
  if (!s.ready) return { ok: false, error: 'Nothing to claim yet.' };
  s.ready = false;
  s.claimed += 1;
  stays = { ...stays };
  kvSave(KEY, stays);
  const kowens = add(userId, 1);
  return { ok: true, kowens, stay: stayInfo(userId) };
}

export const dailyInfo = (userId: string): TownDailyInfo => ({ claimed: claimedToday(userId), amount: dailyAmount() });

/** The daily Kowens, as /get-kowens (doubled on Christmas, which finds that egg). */
export function claimDaily(userId: string): TownDailyClaim {
  const amount = dailyAmount();
  const kowens = claim(userId);
  if (kowens === null) return { ok: false, error: 'You already claimed today. Come back tomorrow!' };
  if (amount > dailyCredits()) markFound(userId, 'christmas');
  return { ok: true, amount, kowens, christmas: amount > dailyCredits() };
}
