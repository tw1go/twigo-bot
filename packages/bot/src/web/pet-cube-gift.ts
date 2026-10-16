import { isGearDef } from '@mikazuki/shared';
import { db, kvLoad, kvSave } from '../db/db.js';
import { type MailDraft, mailMembers, sendMail } from './mail.js';
import { loadItemData } from './stats-data.js';

// 🎁 The pet cube gift (Mac, 16 Oct 2026): once, every member with a character gets a letter from the Tanod. Those
// without a pet get a Pet Selection Cube to open into the pet they choose; those who already have one (a pet, out or in
// the bag, or an unopened pet box) get KOWENS instead. Sent by the bot the first time it starts with this (server.ts),
// and never again: kv 'pet-cube-gift' says when and to how many. Players who make a character later get nothing.

const KEY = 'pet-cube-gift';
export const KOWENS = 100;
export const CUBE = 'pet-cube-common';

const CUBE_MAIL: MailDraft = {
  from: 'The Tanod',
  title: 'A pet for you',
  body:
    "Pets are here, citizen! Here's a **Pet Selection Cube**. Open it from your bag's Combat tab to choose one of six " +
    'pets: it follows you on every map and gives you a little extra as it levels up.\n\n' +
    'The cube and the pet you choose are bound to this character.',
  kowens: 0,
  kusing: 0,
  items: [{ defId: CUBE, count: 1 }],
};

const KOWENS_MAIL: MailDraft = {
  from: 'The Tanod',
  title: 'For adopting early',
  body: `Every citizen is getting a Pet Selection Cube today, but you already have a pet. So here are **${KOWENS} Kowens** instead. Salamat for looking after it!`,
  kowens: KOWENS,
  kusing: 0,
  items: [],
};

type Sent = { at: number; cubes: number; kowens: number };

const ownedStmt = db.prepare<[], { owner: string; def_id: string }>('SELECT DISTINCT owner, def_id FROM items');

/** Members who have a pet: a pet item (out or in the bag) or an unopened pet box. */
export function petOwners(): Set<string> {
  const data = loadItemData();
  const owners = new Set<string>();
  for (const { owner, def_id } of ownedStmt.all()) {
    const def = data.defs.get(def_id);
    if (def && !isGearDef(def) && (def.kind === 'pet' || !!def.opens)) owners.add(owner);
  }
  return owners;
}

/** Sends the gift if it hasn't gone yet: a cube to everyone with a character and no pet, KOWENS to those with one. What
 *  was sent, or null: it went before. */
export function sendPetCubeGift(now = Date.now()): Sent | null {
  if (kvLoad<Sent | null>(KEY, null)) return null;
  const owners = petOwners();
  const members = mailMembers();
  const cubes = members.filter((m) => !owners.has(m));
  const kowens = members.filter((m) => owners.has(m));
  const sent: Sent = { at: now, cubes: cubes.length, kowens: kowens.length };
  // (One transaction: the letters and the mark that they went, all or none, so a crash never sends a second letter.)
  db.transaction(() => {
    if (cubes.length) sendMail(cubes, CUBE_MAIL, null, now);
    if (kowens.length) sendMail(kowens, KOWENS_MAIL, null, now);
    kvSave(KEY, sent);
  })();
  console.log(`[pet-cube-gift] mailed a Pet Selection Cube to ${cubes.length} member(s) and ${KOWENS} Kowens to ${kowens.length} who already have a pet`);
  return sent;
}
