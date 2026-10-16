import { randomBytes } from 'node:crypto';
import { type GearRarity, type Item, type TownMail, type TownMailAction, type TownMailActionResponse, type TownMailResponse, MAIL_RULES, claimInto, isGearDef, itemName, mailRefusal } from '@mikazuki/shared';
import { db } from '../db/db.js';
import { add } from '../credits/store.js';
import { newUid, withItems } from './adventure.js';
import { makeItem } from './combat-bag.js';
import { loadItemData } from './stats-data.js';

// ✉️ Mail (CONTEXT.md "Mail"; the rules in @mikazuki/shared mail.ts): letters from the game and its Game Masters (the
// CMS's Mail tab, or `sendMail` from the bot's own code) to members' mailboxes, schema v18 `mail`, a row per member. Each
// may carry items (made as it's sent: gear rolled like a drop at the rarity and + picked), Kusing and Kowens, claimed
// all at once: items and Kusing into the combat bag (all or nothing: "Make room in your bag first."), Kowens into the
// wallet. Gone MAIL_RULES.days after it was sent, claimed or not. Every send and claim goes in the bot's log.

const DAY = 86_400_000;
const RARITIES: GearRarity[] = ['brown', 'white', 'grey', 'lightBlue', 'darkBlue', 'lightOrange', 'darkOrange'];

/** An item to attach, as the CMS asks for it (made per member as it's sent). */
export interface MailItemSpec {
  defId: string;
  /** A stack's size (gear: always one). */
  count?: number;
  /** Gear only. */
  rarity?: GearRarity;
  plus?: number;
  /** An agimat's or a pet's level. */
  level?: number;
}

export interface MailDraft {
  from: string;
  title: string;
  body: string;
  kowens: number;
  kusing: number;
  items: MailItemSpec[];
}

interface Row {
  id: number;
  member: string;
  batch: string;
  sender: string;
  sent_by: string | null;
  title: string;
  body: string;
  kowens: number;
  kusing: number;
  items: string;
  sent_at: number;
  expires_at: number;
  read_at: number | null;
  claimed_at: number | null;
}

const insertStmt = db.prepare(
  'INSERT INTO mail (member, batch, sender, sent_by, title, body, kowens, kusing, items, sent_at, expires_at) VALUES (@member, @batch, @sender, @sent_by, @title, @body, @kowens, @kusing, @items, @sent_at, @expires_at)',
);
const listStmt = db.prepare<[string, number], Row>('SELECT * FROM mail WHERE member = ? AND expires_at > ? ORDER BY sent_at DESC, id DESC');
const oneStmt = db.prepare<[number, string, number], Row>('SELECT * FROM mail WHERE id = ? AND member = ? AND expires_at > ?');
const unreadStmt = db.prepare<[string, number], { n: number }>('SELECT COUNT(*) AS n FROM mail WHERE member = ? AND read_at IS NULL AND expires_at > ?');
const readStmt = db.prepare('UPDATE mail SET read_at = ? WHERE id = ? AND read_at IS NULL');
const claimedStmt = db.prepare('UPDATE mail SET claimed_at = ?, read_at = COALESCE(read_at, ?) WHERE id = ? AND claimed_at IS NULL');
const deleteStmt = db.prepare('DELETE FROM mail WHERE id = ?');
const purgeStmt = db.prepare('DELETE FROM mail WHERE expires_at <= ?');
const membersStmt = db.prepare<[], { user_id: string }>('SELECT user_id FROM nicknames');
const batchesStmt = db.prepare<[number, number], { batch: string; sender: string; sent_by: string | null; title: string; at: number; kowens: number; kusing: number; items: string; sent: number; read: number; claimed: number }>(
  `SELECT batch, sender, sent_by, title, MIN(sent_at) AS at, MAX(kowens) AS kowens, MAX(kusing) AS kusing, MAX(items) AS items, COUNT(*) AS sent,
          SUM(read_at IS NOT NULL) AS read, SUM(claimed_at IS NOT NULL) AS claimed
     FROM mail WHERE expires_at > ? GROUP BY batch ORDER BY at DESC LIMIT ?`,
);

/** Something attached that hasn't been claimed. */
const attached = (r: Row) => r.claimed_at === null && (r.kowens > 0 || r.kusing > 0 || r.items !== '[]');

function view(r: Row): TownMail {
  const items = JSON.parse(r.items) as Item[];
  return {
    id: r.id, from: r.sender, title: r.title, body: r.body, at: r.sent_at, expires: r.expires_at,
    read: r.read_at !== null, claimed: r.claimed_at !== null || (!r.kowens && !r.kusing && !items.length),
    kowens: r.kowens, kusing: r.kusing, items,
  };
}

// ── Sending ──

/** Told when a member gets mail (the town shows it if they're in): set by the web server. */
let hook: ((member: string, unread: number, from: string, title: string) => void) | null = null;
export const onMail = (f: typeof hook) => (hook = f);

const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : NaN);

/** A draft as the CMS sent it, checked; or what's wrong with it (one line). */
export function parseMailDraft(body: unknown): { ok: true; draft: MailDraft } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const R = MAIL_RULES;
  const text = (v: unknown) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim() : '');
  const from = text(b.from).replace(/\s+/g, ' ');
  const title = text(b.title).replace(/\s+/g, ' ');
  const bodyText = text(b.body);
  if (!from || from.length > R.fromMax) return { ok: false, error: `Who it's from needs 1–${R.fromMax} characters.` };
  if (!title || title.length > R.titleMax) return { ok: false, error: `The title needs 1–${R.titleMax} characters.` };
  if (!bodyText || bodyText.length > R.bodyMax) return { ok: false, error: `The letter needs 1–${R.bodyMax} characters.` };
  const kowens = b.kowens === undefined || b.kowens === '' ? 0 : int(b.kowens);
  const kusing = b.kusing === undefined || b.kusing === '' ? 0 : int(b.kusing);
  if (!(kowens >= 0 && kowens <= R.kowensMax)) return { ok: false, error: `Kowens are a whole number, 0 to ${R.kowensMax.toLocaleString('en-US')}.` };
  if (!(kusing >= 0 && kusing <= R.kusingMax)) return { ok: false, error: `Kusing is a whole number, 0 to ${R.kusingMax.toLocaleString('en-US')}.` };
  const list = Array.isArray(b.items) ? b.items : [];
  if (list.length > R.itemsMax) return { ok: false, error: `${R.itemsMax} items at most.` };
  const data = loadItemData();
  const items: MailItemSpec[] = [];
  for (const raw of list) {
    const x = (raw ?? {}) as Record<string, unknown>;
    const defId = typeof x.defId === 'string' ? x.defId : '';
    const def = data.defs.get(defId);
    const why = mailRefusal(def);
    if (why) return { ok: false, error: `${def?.name ?? (defId || 'An item')}: ${why}` };
    const spec: MailItemSpec = { defId };
    if (isGearDef(def)) {
      const rarity = x.rarity === undefined ? def.rarity : x.rarity;
      if (!RARITIES.includes(rarity as GearRarity)) return { ok: false, error: `${def.name}: pick a rarity.` };
      const plus = x.plus === undefined ? 0 : int(x.plus);
      if (!(plus >= 0 && plus <= 20)) return { ok: false, error: `${def.name}: the + is 0 to 20.` };
      Object.assign(spec, { rarity, plus });
    } else {
      const count = x.count === undefined ? 1 : int(x.count);
      if (!(count >= 1 && count <= R.countMax)) return { ok: false, error: `${def!.name}: how many is 1 to ${R.countMax}.` };
      spec.count = count;
      if (def!.kind === 'agimat' || def!.kind === 'pet') {
        const level = x.level === undefined ? 1 : int(x.level);
        if (!(level >= 1 && level <= 100)) return { ok: false, error: `${def!.name}: its level is 1 to 100.` };
        spec.level = level;
      }
    }
    items.push(spec);
  }
  return { ok: true, draft: { from, title, body: bodyText, kowens, kusing, items } };
}

/** Everyone with a character (a town nickname): who mail "to everyone" goes to. */
export const mailMembers = (): string[] => membersStmt.all().map((r) => r.user_id);

/** Sends a mail to each member (its items made for each), and tells those in town. `sentBy`: the CMS user, or null for
 *  the game itself. */
export function sendMail(to: string[], draft: MailDraft, sentBy: string | null, now = Date.now()): { batch: string; sent: number } {
  const data = loadItemData();
  const batch = randomBytes(6).toString('hex');
  const members = [...new Set(to)];
  db.transaction(() => {
    for (const member of members) {
      const items = draft.items.flatMap((spec) => {
        const it = makeItem(data, spec.defId, spec, newUid);
        return it ? [it] : [];
      });
      insertStmt.run({
        member, batch, sender: draft.from, sent_by: sentBy, title: draft.title, body: draft.body, kowens: draft.kowens, kusing: draft.kusing,
        items: JSON.stringify(items), sent_at: now, expires_at: now + MAIL_RULES.days * DAY,
      });
    }
  })();
  console.log(`[mail] ${sentBy ?? 'the game'} sent "${draft.title}" from ${draft.from} to ${members.length} member(s) (batch ${batch})${attachedLine(draft)}`);
  for (const member of members) hook?.(member, unreadMail(member, now), draft.from, draft.title);
  return { batch, sent: members.length };
}

function attachedLine(d: Pick<MailDraft, 'kowens' | 'kusing'> & { items: { defId: string; count?: number }[] }): string {
  const data = loadItemData();
  const parts = [
    d.kowens && `${d.kowens} Kowens`,
    d.kusing && `${d.kusing} Kusing`,
    ...d.items.map((i) => `${(i.count ?? 1) > 1 ? `${i.count}× ` : ''}${data.defs.get(i.defId)?.name ?? i.defId}`),
  ].filter(Boolean);
  return parts.length ? `: ${parts.join(', ')}` : '';
}

// ── A member's mailbox ──

export const unreadMail = (member: string, now = Date.now()): number => unreadStmt.get(member, now)?.n ?? 0;

export function mailboxOf(member: string, now = Date.now()): TownMailResponse {
  return { mail: listStmt.all(member, now).map(view), unread: unreadMail(member, now) };
}

/** Claims one mail's attachments: items and Kusing into the combat bag (all or nothing), Kowens into the wallet. */
function claim(member: string, r: Row, now: number): { ok: true; got: { kowens: number; kusing: number; items: Item[] } } | { ok: false; message: string } {
  if (!attached(r)) return { ok: false, message: 'Nothing left to claim.' };
  const items = JSON.parse(r.items) as Item[];
  const data = loadItemData();
  const why = withItems(member, (s) => claimInto(data, s, { items, kusing: r.kusing }, newUid), (w) => w === null);
  if (why) return { ok: false, message: why };
  claimedStmt.run(now, now, r.id);
  if (r.kowens > 0) add(member, r.kowens);
  console.log(`[mail] ${member} claimed mail #${r.id} "${r.title}"${attachedLine({ kowens: r.kowens, kusing: r.kusing, items: items.map((i) => ({ defId: i.defId, count: i.count })) })}`);
  return { ok: true, got: { kowens: r.kowens, kusing: r.kusing, items } };
}

/** Reads, claims or deletes (one, or all of them) for a member. */
export function mailAction(member: string, a: TownMailAction, now = Date.now()): TownMailActionResponse {
  const done = (ok: boolean, extra: Partial<TownMailActionResponse> = {}): TownMailActionResponse => ({ ...mailboxOf(member, now), ok, ...extra });
  if (a.action === 'claim-all') {
    const got = { kowens: 0, kusing: 0, items: [] as Item[] };
    let message: string | undefined;
    for (const r of listStmt.all(member, now).reverse()) { // (oldest first: those run out first)
      if (!attached(r)) continue;
      const c = claim(member, r, now);
      if (!c.ok) {
        message = c.message;
        break;
      }
      got.kowens += c.got.kowens;
      got.kusing += c.got.kusing;
      got.items.push(...c.got.items);
    }
    const any = got.kowens > 0 || got.kusing > 0 || got.items.length > 0;
    return done(any || !message, { ...(any ? { got } : {}), ...(message ? { message: any ? `${message} Some mail is still waiting.` : message } : {}) });
  }
  if (a.action === 'delete-read') {
    let n = 0;
    for (const r of listStmt.all(member, now)) if (r.read_at !== null && !attached(r)) n += deleteStmt.run(r.id).changes;
    return done(true, { message: n ? `Deleted ${n} mail.` : 'Nothing to delete: mail with something to claim stays.' });
  }
  const r = oneStmt.get(a.id, member, now);
  if (!r) return done(false, { message: 'That mail is gone.' });
  if (a.action === 'read') {
    readStmt.run(now, r.id);
    return done(true);
  }
  if (a.action === 'claim') {
    const c = claim(member, r, now);
    return c.ok ? done(true, { got: c.got }) : done(false, { message: c.message });
  }
  if (attached(r)) return done(false, { message: 'Claim what’s attached first.' });
  deleteStmt.run(r.id);
  return done(true);
}

/** Drops mail past its time (the web server, now and then): how many went. */
export const purgeMail = (now = Date.now()): number => purgeStmt.run(now).changes;

// ── The CMS ──

/** What can be attached: every kind but training gear, quest items and filled Temper Stones. */
export function mailKinds(): { id: string; name: string; kind: string; gear: boolean; rarity: GearRarity; level?: boolean }[] {
  const data = loadItemData();
  return [...data.defs.values()]
    .filter((d) => !mailRefusal(d))
    .map((d) => ({ id: d.id, name: d.name, kind: isGearDef(d) ? 'gear' : d.kind, gear: isGearDef(d), rarity: d.rarity, ...(!isGearDef(d) && (d.kind === 'agimat' || d.kind === 'pet') ? { level: true } : {}) }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

/** The latest sends (one line each, however many members it went to): how many read and claimed it. */
export function recentSends(limit = 20) {
  const data = loadItemData();
  return batchesStmt.all(Date.now(), limit).map((b) => {
    const items = JSON.parse(b.items) as Item[];
    return {
      batch: b.batch, from: b.sender, sentBy: b.sent_by, title: b.title, at: b.at, sent: b.sent, read: b.read, claimed: b.claimed,
      attached: !!(b.kowens || b.kusing || items.length),
      attachments: [b.kowens && `${b.kowens.toLocaleString('en-US')} Kowens`, b.kusing && `${b.kusing.toLocaleString('en-US')} Kusing`, ...items.map((i) => `${itemName(data, i)}${i.count > 1 ? ` ×${i.count}` : ''}`)].filter(Boolean) as string[],
    };
  });
}
