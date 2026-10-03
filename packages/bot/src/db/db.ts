import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../paths.js';
import { today } from '../time.js';

// 🗄️ The bot's state lives in one SQLite database: DATA_DIR/mikazuki.db (WAL mode).
//
// Tables (schema in MIGRATIONS below):
//  • v1, the economy core: accounts (Kowens & limits), dig_state + inventory_items, loans + loan_credit.
//  • v2, per-member stores: quests, minewars_payouts, room_find_codes/claims, potion_stock/effects, secret_progress,
//    jail, redemptions, jackpot_tickets, eggs_found, easter_egg_finds, boosters.
//  • kv: small singleton documents keyed by their old file name (e.g. 'race.json', 'rotation.json').
// Stores cache their state in memory (the bot is the only writer) and save through db/sync.ts, which writes only
// the rows that changed.
//
// On the first start after the switch, legacy JSON files in DATA_DIR are imported in ONE transaction (all or
// nothing), then moved to DATA_DIR/legacy-json/ — never deleted — so rolling back is possible.

mkdirSync(DATA_DIR, { recursive: true });
export const DB_FILE = join(DATA_DIR, 'mikazuki.db');
export const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL'); // safe with WAL; a power cut can lose only the last moment, never corrupt
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// ── Schema (versioned) ──
const MIGRATIONS: string[] = [
  /* v1 */ `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL);

  CREATE TABLE accounts (
    user_id              TEXT PRIMARY KEY,
    balance              INTEGER NOT NULL DEFAULT 0,
    last_claim           TEXT,     -- YYYY-MM-DD
    voice_minutes        INTEGER,  -- progress toward the next voice Kowen
    voice_total_minutes  INTEGER,  -- lifetime, for /leaderboard
    last_steal           INTEGER,  -- ms
    last_active          TEXT,     -- YYYY-MM-DD
    fence_until          INTEGER,  -- ms (Bakod)
    voice_credits_day    TEXT,
    voice_credits_today  INTEGER,
    voice_week           TEXT,     -- Monday YYYY-MM-DD
    voice_week_minutes   INTEGER,
    has_vault            INTEGER,  -- 0/1
    vault                INTEGER,
    give_day             TEXT,
    give_sent_today      INTEGER
  );

  CREATE TABLE dig_state (
    user_id        TEXT PRIMARY KEY,
    shovel         INTEGER NOT NULL DEFAULT 0,
    dig_day        TEXT,
    digs_today     INTEGER,
    shovel_day     TEXT,
    shovels_today  INTEGER,
    keys           INTEGER,
    bags           TEXT      -- JSON array of bag reward ids
  );
  CREATE TABLE inventory_items (
    user_id  TEXT NOT NULL,
    item_id  TEXT NOT NULL,
    count    INTEGER NOT NULL CHECK (count > 0),
    PRIMARY KEY (user_id, item_id)
  );

  CREATE TABLE loans (
    id         TEXT PRIMARY KEY,
    lender     TEXT NOT NULL,   -- 'bank' or a member id
    borrower   TEXT NOT NULL,
    principal  INTEGER NOT NULL,
    owed       INTEGER NOT NULL,
    created    INTEGER NOT NULL,
    due        INTEGER NOT NULL,
    late_days  INTEGER NOT NULL DEFAULT 0,
    status     TEXT NOT NULL CHECK (status IN ('active', 'paid', 'defaulted'))
  );
  CREATE INDEX loans_borrower ON loans (borrower);
  CREATE INDEX loans_lender ON loans (lender);
  CREATE TABLE loan_credit (
    user_id          TEXT PRIMARY KEY,
    on_time          INTEGER NOT NULL DEFAULT 0,
    blacklist_until  INTEGER
  );
  `,
  /* v2: per-member stores get tables (their kv documents are moved by moveKvToTables) */ `
  CREATE TABLE quests (
    id           TEXT PRIMARY KEY,
    requester    TEXT NOT NULL,
    task         TEXT NOT NULL,
    reward       INTEGER NOT NULL,
    status       TEXT NOT NULL CHECK (status IN ('open', 'accepted', 'done', 'cancelled')),
    accepted_by  TEXT,
    channel_id   TEXT NOT NULL,
    message_id   TEXT,
    created      INTEGER NOT NULL
  );
  CREATE TABLE minewars_payouts (
    night    TEXT NOT NULL,   -- YYYY-MM-DD
    user_id  TEXT NOT NULL,
    amount   INTEGER NOT NULL,
    PRIMARY KEY (night, user_id)
  );
  CREATE TABLE room_find_codes (
    code       TEXT PRIMARY KEY,
    character  TEXT NOT NULL,
    expires    INTEGER NOT NULL  -- ms
  );
  CREATE TABLE room_find_claims (
    user_id  TEXT PRIMARY KEY,
    day      TEXT NOT NULL,
    count    INTEGER NOT NULL
  );
  CREATE TABLE potion_stock (
    user_id    TEXT NOT NULL,
    potion_id  TEXT NOT NULL,
    count      INTEGER NOT NULL CHECK (count > 0),
    PRIMARY KEY (user_id, potion_id)
  );
  CREATE TABLE potion_effects (
    user_id      TEXT PRIMARY KEY,
    tago_until   INTEGER,  -- ms
    swerte_digs  INTEGER,
    hints_heard  TEXT      -- JSON array of Marites Tea hint indexes
  );
  CREATE TABLE secret_progress (
    user_id          TEXT PRIMARY KEY,
    praise_bot       INTEGER,  -- lifetime praises of the bot
    praise_rewarded  INTEGER,  -- 1 once rewarded
    salute_day       TEXT      -- last patrol salute reward, YYYY-MM-DD
  );
  CREATE TABLE jail (
    user_id  TEXT PRIMARY KEY,
    until    INTEGER NOT NULL,  -- ms
    reason   TEXT NOT NULL,
    no_bail  INTEGER            -- 1 for admin /jail
  );
  CREATE TABLE redemptions (
    id       INTEGER PRIMARY KEY,
    user_id  TEXT NOT NULL,
    reward   TEXT NOT NULL,
    cost     INTEGER NOT NULL,
    at       TEXT NOT NULL      -- ISO timestamp
  );
  CREATE INDEX redemptions_user ON redemptions (user_id);
  CREATE TABLE jackpot_tickets (
    user_id  TEXT PRIMARY KEY,
    tickets  INTEGER NOT NULL CHECK (tickets > 0)
  );
  CREATE TABLE eggs_found (
    user_id  TEXT NOT NULL,
    egg      TEXT NOT NULL,
    PRIMARY KEY (user_id, egg)
  );
  CREATE TABLE easter_egg_finds (
    message_id  TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id)
  );
  CREATE TABLE boosters (
    user_id  TEXT PRIMARY KEY,
    count    INTEGER NOT NULL,
    since    TEXT NOT NULL      -- ISO; a new value means a new boosting session
  );
  `,
];

function migrate(): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
    console.log(`[db] migrated schema to v${v + 1}`);
  }
}

migrate(); // tables must exist before the statements below are prepared

// ── Key/value documents (small singleton stores) ──
const kvGetStmt = db.prepare<[string], { value: string }>('SELECT value FROM kv WHERE key = ?');
const kvSetStmt = db.prepare('INSERT INTO kv (key, value, updated) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated');

/** Loads a store's document, or `fallback` if it has never been saved. */
export function kvLoad<T>(key: string, fallback: T): T {
  const row = kvGetStmt.get(key);
  return row ? (JSON.parse(row.value) as T) : fallback;
}

/** Saves a store's whole document. */
export function kvSave(key: string, value: unknown): void {
  kvSetStmt.run(key, JSON.stringify(value), Date.now());
}

// ── One-time import of the old JSON files ──
const TABLE_FILES = ['credits.json', 'inventory.json', 'loans.json'];
const n = (v: unknown) => (typeof v === 'number' ? v : null);
const s = (v: unknown) => (typeof v === 'string' ? v : null);

function importLegacyJson(): void {
  if (db.prepare("SELECT 1 FROM meta WHERE key = 'legacy_imported'").get()) return;
  const files = existsSync(DATA_DIR) ? readdirSync(DATA_DIR).filter((f) => f.endsWith('.json')) : [];
  const read = (f: string) => JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8'));

  const counts: Record<string, number> = {};
  db.transaction(() => {
    if (files.includes('credits.json')) {
      const insert = db.prepare(`INSERT INTO accounts (user_id, balance, last_claim, voice_minutes, voice_total_minutes, last_steal,
        last_active, fence_until, voice_credits_day, voice_credits_today, voice_week, voice_week_minutes, has_vault, vault,
        give_day, give_sent_today) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const [id, a] of Object.entries<Record<string, unknown>>(read('credits.json'))) {
        insert.run(id, n(a.balance) ?? 0, s(a.lastClaim), n(a.voiceMinutes), n(a.voiceTotalMinutes), n(a.lastSteal), s(a.lastActive),
          n(a.fenceUntil), s(a.voiceCreditsDay), n(a.voiceCreditsToday), s(a.voiceWeek), n(a.voiceWeekMinutes),
          a.hasVault ? 1 : null, n(a.vault), s(a.giveDay), n(a.giveSentToday));
        counts.accounts = (counts.accounts ?? 0) + 1;
      }
    }
    if (files.includes('inventory.json')) {
      const state = db.prepare('INSERT INTO dig_state (user_id, shovel, dig_day, digs_today, shovel_day, shovels_today, keys, bags) VALUES (?,?,?,?,?,?,?,?)');
      const item = db.prepare('INSERT INTO inventory_items (user_id, item_id, count) VALUES (?,?,?)');
      for (const [id, b] of Object.entries<Record<string, unknown>>(read('inventory.json'))) {
        state.run(id, n(b.shovel) ?? 0, s(b.digDay), n(b.digsToday), s(b.shovelDay), n(b.shovelsToday), n(b.keys),
          Array.isArray(b.bags) ? JSON.stringify(b.bags) : null);
        for (const [itemId, count] of Object.entries((b.items as Record<string, number>) ?? {})) {
          if (count > 0) item.run(id, itemId, count);
        }
        counts.dig_state = (counts.dig_state ?? 0) + 1;
      }
    }
    if (files.includes('loans.json')) {
      const l = read('loans.json') as { loans?: Record<string, Record<string, unknown>>; onTime?: Record<string, number>; blacklistUntil?: Record<string, number> };
      const loan = db.prepare('INSERT INTO loans (id, lender, borrower, principal, owed, created, due, late_days, status) VALUES (?,?,?,?,?,?,?,?,?)');
      for (const x of Object.values(l.loans ?? {})) {
        loan.run(x.id, x.lender, x.borrower, x.principal, x.owed, x.created, x.due, n(x.lateDays) ?? 0, x.status);
        counts.loans = (counts.loans ?? 0) + 1;
      }
      const onTime = db.prepare('INSERT INTO loan_credit (user_id, on_time) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET on_time = excluded.on_time');
      const blacklist = db.prepare('INSERT INTO loan_credit (user_id, blacklist_until) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET blacklist_until = excluded.blacklist_until');
      for (const [id, k] of Object.entries(l.onTime ?? {})) onTime.run(id, k);
      for (const [id, until] of Object.entries(l.blacklistUntil ?? {})) blacklist.run(id, until);
    }
    for (const f of files.filter((f) => !TABLE_FILES.includes(f))) {
      kvSave(f, read(f)); // keeps the exact old shape
      counts.kv = (counts.kv ?? 0) + 1;
    }
    db.prepare("INSERT INTO meta (key, value) VALUES ('legacy_imported', ?)").run(new Date().toISOString());
  })();

  // Only after the transaction committed: move the old files aside (kept for rollback).
  if (files.length) {
    const dir = join(DATA_DIR, 'legacy-json');
    mkdirSync(dir, { recursive: true });
    for (const f of files) {
      const target = join(dir, f);
      if (existsSync(target)) unlinkSync(target);
      renameSync(join(DATA_DIR, f), target);
    }
  }
  console.log(`[db] imported legacy JSON: ${JSON.stringify(counts)} — originals moved to data/legacy-json/`);
}

// ── kv documents → v2 tables ──
// Runs on every start, after the legacy import: any kv document of a store that now has tables is moved into
// them and deleted, in one transaction. Covers both an existing v1 database and a fresh import from JSON.
function moveKvToTables(): void {
  const moved: string[] = [];
  db.transaction(() => {
    const take = <T>(key: string, fn: (doc: T) => void) => {
      const row = kvGetStmt.get(key);
      if (!row) return;
      fn(JSON.parse(row.value) as T);
      db.prepare('DELETE FROM kv WHERE key = ?').run(key);
      moved.push(key);
    };
    const insert = (sql: string) => db.prepare(sql);

    take<Record<string, Record<string, unknown>>>('quests.json', (doc) => {
      const q = insert('INSERT INTO quests (id, requester, task, reward, status, accepted_by, channel_id, message_id, created) VALUES (?,?,?,?,?,?,?,?,?)');
      for (const x of Object.values(doc)) {
        q.run(x.id, x.requester, x.task, x.reward, x.status, s(x.acceptedBy), x.channelId, s(x.messageId), x.created);
      }
    });
    take<Record<string, Record<string, number>>>('minewars-payouts.json', (doc) => {
      const p = insert('INSERT INTO minewars_payouts (night, user_id, amount) VALUES (?,?,?)');
      for (const [night, paid] of Object.entries(doc)) for (const [id, amount] of Object.entries(paid)) p.run(night, id, amount);
    });
    take<{ codes?: Record<string, { character: string; expires: number }>; claims?: Record<string, { day: string; count: number }> }>('room-finds.json', (doc) => {
      const c = insert('INSERT INTO room_find_codes (code, character, expires) VALUES (?,?,?)');
      for (const [code, e] of Object.entries(doc.codes ?? {})) c.run(code, e.character, e.expires);
      const cl = insert('INSERT INTO room_find_claims (user_id, day, count) VALUES (?,?,?)');
      for (const [id, e] of Object.entries(doc.claims ?? {})) cl.run(id, e.day, e.count);
    });
    take<Record<string, { have?: Record<string, number>; tagoUntil?: number; swerteDigs?: number; hintsHeard?: number[] }>>('potions.json', (doc) => {
      const st = insert('INSERT INTO potion_stock (user_id, potion_id, count) VALUES (?,?,?)');
      const ef = insert('INSERT INTO potion_effects (user_id, tago_until, swerte_digs, hints_heard) VALUES (?,?,?,?)');
      for (const [id, u] of Object.entries(doc)) {
        for (const [potion, count] of Object.entries(u.have ?? {})) if (count > 0) st.run(id, potion, count);
        if (u.tagoUntil !== undefined || u.swerteDigs !== undefined || u.hintsHeard !== undefined) {
          ef.run(id, n(u.tagoUntil), n(u.swerteDigs), u.hintsHeard ? JSON.stringify(u.hintsHeard) : null);
        }
      }
    });
    take<{ praiseBot?: Record<string, number>; praiseRewarded?: string[]; salute?: Record<string, string> }>('secrets.json', (doc) => {
      const sp = insert(`INSERT INTO secret_progress (user_id, praise_bot, praise_rewarded, salute_day) VALUES (?,?,?,?)`);
      const ids = new Set([...Object.keys(doc.praiseBot ?? {}), ...(doc.praiseRewarded ?? []), ...Object.keys(doc.salute ?? {})]);
      for (const id of ids) {
        sp.run(id, n(doc.praiseBot?.[id]), doc.praiseRewarded?.includes(id) ? 1 : null, s(doc.salute?.[id]));
      }
    });
    take<Record<string, { until: number; reason: string; noBail?: boolean }>>('jail.json', (doc) => {
      const j = insert('INSERT INTO jail (user_id, until, reason, no_bail) VALUES (?,?,?,?)');
      for (const [id, e] of Object.entries(doc)) j.run(id, e.until, e.reason, e.noBail ? 1 : null);
    });
    take<{ userId: string; reward: string; cost: number; at: string }[]>('redemptions.json', (doc) => {
      const r = insert('INSERT INTO redemptions (user_id, reward, cost, at) VALUES (?,?,?,?)');
      for (const x of doc) r.run(x.userId, x.reward, x.cost, x.at);
    });
    take<Record<string, number>>('jackpot.json', (doc) => {
      const t = insert('INSERT INTO jackpot_tickets (user_id, tickets) VALUES (?,?)');
      for (const [id, count] of Object.entries(doc)) if (count > 0) t.run(id, count);
    });
    take<Record<string, string[]>>('found.json', (doc) => {
      const f = insert('INSERT OR IGNORE INTO eggs_found (user_id, egg) VALUES (?,?)');
      for (const [id, eggs] of Object.entries(doc)) for (const egg of eggs) f.run(id, egg);
    });
    take<Record<string, string[]>>('easter-eggs.json', (doc) => {
      const f = insert('INSERT OR IGNORE INTO easter_egg_finds (message_id, user_id) VALUES (?,?)');
      for (const [msg, ids] of Object.entries(doc)) for (const id of ids) f.run(msg, id);
    });
    take<{ initialized?: boolean; boosters?: Record<string, { count: number; since: string }> }>('boosts.json', (doc) => {
      const b = insert('INSERT INTO boosters (user_id, count, since) VALUES (?,?,?)');
      for (const [id, x] of Object.entries(doc.boosters ?? {})) b.run(id, x.count, x.since);
      if (doc.initialized) kvSave('boosts-initialized', true);
    });
  })();
  if (moved.length) console.log(`[db] moved kv documents into tables: ${moved.join(', ')}`);
}

// ── Nightly backups (scheduled in scheduler.ts) ──
export const BACKUP_KEEP = 7;
/** Saves today's backup and prunes old ones; returns the backup's path. */
export async function backupDatabase(): Promise<string> {
  const dir = join(DATA_DIR, 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `mikazuki-${today()}.db`); // server-timezone date
  await db.backup(file);
  const old = readdirSync(dir).filter((f) => /^mikazuki-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -BACKUP_KEEP);
  for (const f of old) unlinkSync(join(dir, f));
  console.log(`[db] backup saved (keeping the last ${BACKUP_KEEP})`);
  return file;
}

/** Flushes the WAL and closes the database (on shutdown). */
export function closeDatabase(): void {
  if (!db.open) return;
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
}

importLegacyJson();
moveKvToTables();
