import { createHash, randomBytes } from 'node:crypto';
import { db, kvLoad, kvSave } from '../db/db.js';

// 🎟️ Close beta applications from the front page (POST /api/beta/apply): a Discord username (how staff reach them),
// the class they'd main and a note. One row per Discord username (any case): sending again updates it (its status
// kept), and so does the same Discord id when they're logged in. Stored in beta_applications (schema v14); the IP only
// as a salted hash (a few applications an hour per address). The CMS lists them (newest first, search, filters),
// changes their status and exports them as CSV.

export const BETA_CLASSES = ['Slingshot', 'Stick', 'Greatstick', 'Broom', 'Pot lid', 'Hilot', 'Not sure yet'] as const;
export const BETA_STATUSES = ['new', 'contacted', 'invited', 'declined'] as const;
export type BetaStatus = (typeof BETA_STATUSES)[number];
const USERNAME = [2, 32] as const;
const NOTE_MAX = 500;
/** Applications from one address an hour, at most. */
export const BETA_PER_HOUR = 5;

export interface BetaApplication {
  id: number;
  discordUsername: string;
  discordId: string | null;
  cls: string;
  note: string;
  status: BetaStatus;
  createdAt: number;
  updatedAt: number;
}

export type BetaForm = { discordUsername: string; cls: string; note: string };

/** The form as sent, checked and trimmed; or what's wrong with it (one line, for the page). */
export function parseBetaForm(body: unknown): { ok: true; form: BetaForm } | { ok: false; error: string } {
  const b = (body ?? {}) as { discord?: unknown; class?: unknown; note?: unknown };
  const discordUsername = typeof b.discord === 'string' ? b.discord.trim().replace(/^@/, '') : '';
  if (discordUsername.length < USERNAME[0] || discordUsername.length > USERNAME[1]) return { ok: false, error: `Your Discord username should be ${USERNAME[0]} to ${USERNAME[1]} characters.` };
  if (/[\s\u0000-\u001f]/.test(discordUsername)) return { ok: false, error: 'Your Discord username has no spaces in it.' };
  const cls = typeof b.class === 'string' ? b.class.trim() : '';
  if (!(BETA_CLASSES as readonly string[]).includes(cls)) return { ok: false, error: 'Pick a class from the list.' };
  const note = typeof b.note === 'string' ? b.note.trim() : '';
  if (note.length > NOTE_MAX) return { ok: false, error: `Your note is too long (${NOTE_MAX} characters at most).` };
  return { ok: true, form: { discordUsername, cls, note } };
}

/** An IP as a salted sha256 (the salt made once, kept in kv 'beta-salt'): the rate limit's key, never the address. */
export function ipHash(ip: string): string {
  let salt = kvLoad<string>('beta-salt', '');
  if (!salt) {
    salt = randomBytes(16).toString('hex');
    kvSave('beta-salt', salt);
  }
  return createHash('sha256').update(`${salt}|${ip}`).digest('hex');
}

/** A few applications an hour per address (kept in memory: a restart forgets, which is fine for this). */
export class BetaRateLimit {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly perHour = BETA_PER_HOUR) {}
  /** Whether `key` may send now (and counts it if so). */
  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= this.perHour) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}

interface Row {
  id: number;
  discord_username: string;
  discord_id: string | null;
  class: string;
  note: string;
  status: BetaStatus;
  created_at: number;
  updated_at: number;
}
const fromRow = (r: Row): BetaApplication => ({
  id: r.id, discordUsername: r.discord_username, discordId: r.discord_id, cls: r.class, note: r.note, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
});

/** Saves an application: a new row, or the one with the same Discord username (any case) or, logged in, the same
 *  Discord id (its username follows what they typed; its status is kept). `updated`: it was a repeat. */
export function saveBetaApplication(form: BetaForm, discordId: string | null, ip: string | null, now = Date.now()): { application: BetaApplication; updated: boolean } {
  return db.transaction(() => {
    const byName = db.prepare('SELECT * FROM beta_applications WHERE lower(discord_username) = lower(?)').get(form.discordUsername) as Row | undefined;
    const byId = discordId ? (db.prepare('SELECT * FROM beta_applications WHERE discord_id = ? ORDER BY updated_at DESC').get(discordId) as Row | undefined) : undefined;
    // (Both, but different rows: the username's, which is how they're reached; the id joins it.)
    const row = byName ?? byId;
    const hash = ip ? ipHash(ip) : null;
    if (row) {
      db.prepare('UPDATE beta_applications SET discord_username = ?, discord_id = coalesce(?, discord_id), class = ?, note = ?, updated_at = ?, ip_hash = coalesce(?, ip_hash) WHERE id = ?')
        .run(form.discordUsername, discordId, form.cls, form.note, now, hash, row.id);
      return { application: fromRow(db.prepare('SELECT * FROM beta_applications WHERE id = ?').get(row.id) as Row), updated: true };
    }
    const r = db.prepare('INSERT INTO beta_applications (discord_username, discord_id, class, note, status, created_at, updated_at, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(form.discordUsername, discordId, form.cls, form.note, 'new', now, now, hash);
    return { application: fromRow(db.prepare('SELECT * FROM beta_applications WHERE id = ?').get(r.lastInsertRowid) as Row), updated: false };
  })();
}

/** The CMS's list: newest first, by a part of the Discord username, a status and a class (each optional). */
export function listBetaApplications(filter: { q?: string; status?: string; cls?: string } = {}): BetaApplication[] {
  const where: string[] = [];
  const args: string[] = [];
  if (filter.q?.trim()) {
    where.push("lower(discord_username) LIKE '%' || lower(?) || '%' ESCAPE '\\'"); // (a backslash escapes % and _)
    args.push(filter.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`));
  }
  if (filter.status && (BETA_STATUSES as readonly string[]).includes(filter.status)) {
    where.push('status = ?');
    args.push(filter.status);
  }
  if (filter.cls && (BETA_CLASSES as readonly string[]).includes(filter.cls)) {
    where.push('class = ?');
    args.push(filter.cls);
  }
  const sql = `SELECT * FROM beta_applications${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC`;
  return (db.prepare(sql).all(...args) as Row[]).map(fromRow);
}

/** A status change from the CMS: the application after it, or null (no such one, or not a status). */
export function setBetaStatus(id: number, status: string, now = Date.now()): BetaApplication | null {
  if (!(BETA_STATUSES as readonly string[]).includes(status)) return null;
  const r = db.prepare('UPDATE beta_applications SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
  if (!r.changes) return null;
  return fromRow(db.prepare('SELECT * FROM beta_applications WHERE id = ?').get(id) as Row);
}

/** The applications as CSV (the CMS's export): a header, then one line each; text quoted, and a leading = + - @ made
 *  plain so a spreadsheet never runs it as a formula. */
export function betaCsv(list: BetaApplication[]): string {
  const cell = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) || safe !== s ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = ['id', 'discord_username', 'discord_id', 'class', 'note', 'status', 'created_at', 'updated_at'];
  const iso = (ms: number) => new Date(ms).toISOString();
  return [head.join(','), ...list.map((a) => [a.id, a.discordUsername, a.discordId, a.cls, a.note, a.status, iso(a.createdAt), iso(a.updatedAt)].map(cell).join(','))].join('\n') + '\n';
}
