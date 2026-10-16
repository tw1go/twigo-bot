import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ✉️ Mail (web/mail.ts), against the game's real item data and a throwaway database (never the real .env or data/): a
// draft is checked (no training gear or quest items); a send makes each member their own row and items; reading,
// claiming (items and Kusing into the bag all or nothing, Kowens into the wallet, once), deleting, and the days it lasts.
const dir = mkdtempSync(join(tmpdir(), 'mail-test-'));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = join(dir, 'none.env');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ADMIN_ROLE_ID', 'ADMIN_CHANNEL_ID', 'MATCH_CHANNEL_ID', 'MINE_WARS_CHANNEL_ID',
  'MINE_WARS_ROLE_ID', 'GREETINGS_CHANNEL_ID', 'BANTER_CHANNEL_ID', 'BOOST_CHANNEL_ID', 'EASTER_EGG_CHANNEL_ID', 'EASTER_EGG_MESSAGE_ID',
  'GAMBLING_CHANNEL_ID', 'GAMES_CHANNEL_ID', 'JAIL_ROLE_ID', 'REWARD_OWNER_ID', 'ROOM_FINDS_CHANNEL_ID']) process.env[name] = 'test';
process.env.TIMEZONE = 'Asia/Manila';

const { mailAction, mailboxOf, onMail, parseMailDraft, purgeMail, sendMail, unreadMail } = await import('./mail.js');
const { adventureOf, newUid, withItems } = await import('./adventure.js');
const { makeItem } = await import('./combat-bag.js');
const { balance } = await import('../credits/store.js');
const { closeDatabase } = await import('../db/db.js');
const { loadItemData } = await import('./stats-data.js');
const { MAIL_RULES, isGearDef } = await import('@mikazuki/shared');

const D = loadItemData();
const gear = [...D.defs.values()].find((d) => isGearDef(d) && !d.training)!;
const training = [...D.defs.values()].find((d) => isGearDef(d) && d.training)!;
const quest = [...D.defs.values()].find((d) => !isGearDef(d) && d.kind === 'quest')!;
const whetstone = [...D.defs.values()].find((d) => !isGearDef(d) && d.forge === 'whetstone')!;
const DAY = 86_400_000;

const draft = (extra: Record<string, unknown> = {}) => ({ from: 'The Tanod', title: 'Sorry for the downtime', body: 'Here is something for your trouble.', ...extra });

test('a draft: who it is from, a title and a letter; whole amounts; no training gear or quest items', () => {
  assert.equal(parseMailDraft(draft({ title: '' })).ok, false);
  assert.equal(parseMailDraft(draft({ body: 'x'.repeat(MAIL_RULES.bodyMax + 1) })).ok, false);
  assert.equal(parseMailDraft(draft({ kowens: -1 })).ok, false);
  assert.equal(parseMailDraft(draft({ kusing: 1.5 })).ok, false);
  assert.equal(parseMailDraft(draft({ items: [{ defId: training.id }] })).ok, false);
  assert.equal(parseMailDraft(draft({ items: [{ defId: quest.id }] })).ok, false);
  assert.equal(parseMailDraft(draft({ items: [{ defId: gear.id, rarity: 'purple' }] })).ok, false);
  assert.equal(parseMailDraft(draft({ items: Array.from({ length: MAIL_RULES.itemsMax + 1 }, () => ({ defId: whetstone.id })) })).ok, false);
  const ok = parseMailDraft(draft({ kowens: 5, kusing: 1000, items: [{ defId: gear.id, rarity: 'darkBlue', plus: 7 }, { defId: whetstone.id, count: 3 }] }));
  assert.ok(ok.ok);
  assert.deepEqual(ok.ok && ok.draft.items, [{ defId: gear.id, rarity: 'darkBlue', plus: 7 }, { defId: whetstone.id, count: 3 }]);
});

test('sent to two: each their own mail and items; read, claimed once, deleted once claimed', () => {
  const told: [string, number, string][] = [];
  onMail((m, unread, from) => told.push([m, unread, from]));
  const p = parseMailDraft(draft({ kowens: 5, kusing: 1000, items: [{ defId: gear.id, rarity: 'darkBlue', plus: 7 }, { defId: whetstone.id, count: 3 }] }));
  assert.ok(p.ok);
  const { sent } = sendMail(['ana', 'ben', 'ana'], p.draft, 'gm');
  assert.equal(sent, 2);
  assert.deepEqual(told, [['ana', 1, 'The Tanod'], ['ben', 1, 'The Tanod']]);
  const [a] = mailboxOf('ana').mail;
  const [b] = mailboxOf('ben').mail;
  assert.equal(a.items.length, 2);
  assert.equal(a.items[0].plus, 7);
  assert.notEqual(a.items[0].uid, b.items[0].uid, 'items of their own');
  assert.equal(a.read, false);
  assert.equal(a.claimed, false);
  // Read: one less unread. Deleting with something attached: no.
  assert.equal(mailAction('ana', { action: 'read', id: a.id }).unread, 0);
  assert.equal(mailAction('ana', { action: 'delete', id: a.id }).ok, false);
  // Claimed: the gear and whetstones in the bag, Kusing and Kowens added; not twice.
  const kusing = adventureOf('ana').kusing;
  const wallet = balance('ana');
  const c = mailAction('ana', { action: 'claim', id: a.id });
  assert.ok(c.ok);
  assert.equal(c.got?.items.length, 2);
  const bag = adventureOf('ana').bag;
  assert.ok(bag.some((i) => i.uid === a.items[0].uid && i.plus === 7));
  assert.equal(bag.filter((i) => i.defId === whetstone.id).reduce((n, i) => n + i.count, 0), 3);
  assert.equal(adventureOf('ana').kusing, kusing + 1000);
  assert.equal(balance('ana'), wallet + 5);
  assert.equal(mailAction('ana', { action: 'claim', id: a.id }).ok, false, 'once');
  assert.equal(mailboxOf('ana').mail[0].claimed, true);
  // Someone else's mail: gone, for them.
  assert.equal(mailAction('ana', { action: 'claim', id: b.id }).ok, false);
  // Now it can go.
  assert.ok(mailAction('ana', { action: 'delete', id: a.id }).ok);
  assert.equal(mailboxOf('ana').mail.length, 0);
});

test('a full bag: nothing claimed (the Kowens neither), it waits; Claim all takes what fits, oldest first', () => {
  withItems('cy', (s) => {
    while (s.bag.length < 60) s.bag.push(makeItem(D, gear.id, {}, newUid)!);
  });
  const p = parseMailDraft(draft({ kowens: 3, items: [{ defId: gear.id }] }));
  assert.ok(p.ok);
  sendMail(['cy'], p.draft, null);
  const wallet = balance('cy');
  const [m] = mailboxOf('cy').mail;
  const r = mailAction('cy', { action: 'claim', id: m.id });
  assert.equal(r.ok, false);
  assert.equal(r.message, 'Make room in your bag first.');
  assert.equal(balance('cy'), wallet);
  assert.equal(mailboxOf('cy').mail[0].claimed, false);
  // Room for one: Claim all takes it.
  withItems('cy', (s) => void s.bag.pop());
  const all = mailAction('cy', { action: 'claim-all' });
  assert.ok(all.ok);
  assert.equal(all.got?.items.length, 1);
  assert.equal(balance('cy'), wallet + 3);
  // A letter with nothing attached counts as claimed; Delete read clears both.
  const letter = parseMailDraft(draft());
  assert.ok(letter.ok);
  sendMail(['cy'], letter.draft, null);
  assert.equal(mailboxOf('cy').mail[0].claimed, true);
  assert.equal(unreadMail('cy'), 1);
  mailAction('cy', { action: 'read', id: mailboxOf('cy').mail[0].id });
  mailAction('cy', { action: 'delete-read' });
  assert.equal(mailboxOf('cy').mail.length, 0);
});

test(`mail lasts ${MAIL_RULES.days} days, claimed or not`, () => {
  const p = parseMailDraft(draft({ kusing: 10 }));
  assert.ok(p.ok);
  const sentAt = Date.now() - (MAIL_RULES.days * DAY - 1000);
  sendMail(['dee'], p.draft, null, sentAt);
  assert.equal(mailboxOf('dee').mail.length, 1);
  assert.equal(mailboxOf('dee', Date.now() + 2000).mail.length, 0, 'not shown once it has run out');
  assert.equal(purgeMail(Date.now() + 2000), 1);
});

test.after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});
