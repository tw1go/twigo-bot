import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../paths.js';
import { today } from '../time.js';

// 🗄️ The bot's state lives in one SQLite database: DATA_DIR/mikazuki.db (WAL mode).
//
// Phase 1 (this file):
//  • The economy core has real tables: accounts (Kowens & limits), dig_state + inventory_items, loans + loan_credit.
//  • Every other store keeps its old JSON shape as one document in the `kv` table, keyed by its old file name
//    (e.g. 'jail.json'). They're transactional and backed up with everything else; phase 2 can give them tables.
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

// ── Key/value documents (phase-1 stores) ──
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

// ── Nightly backups (scheduled in scheduler.ts) ──
export const BACKUP_KEEP = 7;
export async function backupDatabase(): Promise<void> {
  const dir = join(DATA_DIR, 'backups');
  mkdirSync(dir, { recursive: true });
  await db.backup(join(dir, `mikazuki-${today()}.db`)); // server-timezone date
  const old = readdirSync(dir).filter((f) => /^mikazuki-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -BACKUP_KEEP);
  for (const f of old) unlinkSync(join(dir, f));
  console.log(`[db] backup saved (keeping the last ${BACKUP_KEEP})`);
}

/** Flushes the WAL and closes the database (on shutdown). */
export function closeDatabase(): void {
  if (!db.open) return;
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
}

importLegacyJson();
