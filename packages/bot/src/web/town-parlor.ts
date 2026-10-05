import type { OutfitData, TownParlorActionResponse, TownParlorResponse } from '@mikazuki/shared';
import { balance, take } from '../credits/store.js';
import { kowen } from '../kowens.js';
import { getOutfit, parseOutfit, saveOutfit } from './outfit.js';
import { TITLES, ownedTitles, titleIdOf, titleOf, wearTitle } from './titles.js';

// 💇 The Parlor (GET/POST /town/parlor): a new look for LOOK_COST Kowens, or another of your titles to show (free).
// Everyone in town sees the change at once (Town.restyle, through `restyled`). The creator's first look is free
// (PUT /outfit, only until the member has a look and a nickname); every look after that is changed here.

export const LOOK_COST = 3;

export function townParlor(userId: string): TownParlorResponse {
  const worn = titleIdOf(userId);
  return {
    kowens: balance(userId),
    lookCost: LOOK_COST,
    outfit: getOutfit(userId),
    titles: ownedTitles(userId).map((id) => {
      const { name, color, description } = TITLES[id];
      return { id, name, color, ...(description ? { description } : {}), worn: id === worn };
    }),
  };
}

/** The same look, whatever order its fields come in. */
const sameLook = (a: OutfitData | null, b: OutfitData) => !!a && Object.keys({ ...a, ...b }).every((k) => a[k as keyof OutfitData] === b[k as keyof OutfitData]);

export function parlorAction(
  userId: string,
  body: { action?: unknown; outfit?: unknown; id?: unknown },
  restyled: (userId: string, outfit: OutfitData) => void,
): TownParlorActionResponse | null {
  const done = (ok: boolean, message: string) => ({ ...townParlor(userId), ok, message });
  if (body.action === 'look') {
    const outfit = parseOutfit(body.outfit);
    if (!outfit) return null;
    const was = getOutfit(userId);
    if (sameLook(was, outfit)) return done(false, "That's the look you have.");
    if (balance(userId) < LOOK_COST) return done(false, `A new look is ${LOOK_COST} ${kowen(LOOK_COST)}, and you have ${balance(userId)}.`);
    take(userId, LOOK_COST);
    saveOutfit(userId, outfit);
    restyled(userId, outfit);
    return done(true, `New look! (−${LOOK_COST} ${kowen(LOOK_COST)})`);
  }
  if (body.action === 'title') {
    if (typeof body.id !== 'string') return null;
    if (titleIdOf(userId) === body.id) return done(false, 'You already show that title.');
    if (!wearTitle(userId, body.id)) return done(false, "You don't have that title.");
    const outfit = getOutfit(userId);
    if (outfit) restyled(userId, outfit);
    return done(true, `You now show <${titleOf(userId).name}>.`);
  }
  return null;
}
