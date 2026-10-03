import { db } from './db.js';

// Keeps a table in step with a store's in-memory state, writing only the rows that changed.
//
// Stores keep their state in memory (the bot is the only writer) and, after a change, hand `save()` every row the
// table should hold. The sync remembers what it last wrote, so a save upserts only rows whose values differ and
// deletes rows that are gone — one row for a /give, not the whole table — all in one transaction.

export type Value = string | number | null | undefined; // undefined is stored as NULL
export type Row = Record<string, Value>;

export interface TableSync<R extends Row> {
  /** Reads the table (in insertion order) and remembers it as written. */
  load(): R[];
  /** Makes the table hold exactly `rows`. */
  save(rows: R[]): void;
}

interface Internal {
  plan(rows: Row[]): () => void; // returns the commit step for the in-memory snapshot
  refresh(): void;
}
const internals = new WeakMap<object, Internal>();

export function tableSync<R extends Row>(table: string, keys: (keyof R & string)[], values: (keyof R & string)[]): TableSync<R> {
  const cols = [...keys, ...values];
  const upsert = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
    ON CONFLICT (${keys.join(', ')}) DO ${values.length ? `UPDATE SET ${values.map((c) => `${c} = excluded.${c}`).join(', ')}` : 'NOTHING'}`);
  const remove = db.prepare(`DELETE FROM ${table} WHERE ${keys.map((k) => `${k} = ?`).join(' AND ')}`);
  const select = db.prepare(`SELECT ${cols.join(', ')} FROM ${table} ORDER BY rowid`);

  const written = new Map<string, string>(); // row key -> row values, as last written (both JSON)
  const keyOf = (r: Row) => JSON.stringify(keys.map((k) => r[k] ?? null));
  const valuesOf = (r: Row) => cols.map((c) => r[c] ?? null);

  const refresh = () => {
    written.clear();
    const rows = select.all() as R[];
    for (const r of rows) written.set(keyOf(r), JSON.stringify(valuesOf(r)));
    return rows;
  };

  // Runs inside a transaction; the snapshot is only updated once the transaction has committed.
  const plan = (rows: Row[]) => {
    const seen = new Set<string>();
    const changed: [string, string][] = [];
    for (const r of rows) {
      const key = keyOf(r);
      const vals = valuesOf(r);
      const json = JSON.stringify(vals);
      seen.add(key);
      if (written.get(key) !== json) {
        upsert.run(...vals);
        changed.push([key, json]);
      }
    }
    const gone = [...written.keys()].filter((key) => !seen.has(key));
    for (const key of gone) remove.run(...(JSON.parse(key) as Value[]));
    return () => {
      for (const [key, json] of changed) written.set(key, json);
      for (const key of gone) written.delete(key);
    };
  };

  const sync: TableSync<R> = {
    load: refresh,
    save: (rows) => saveTogether([sync, rows]),
  };
  internals.set(sync, { plan, refresh });
  return sync;
}

/** Saves several tables in one transaction (e.g. dig_state and inventory_items). */
export function saveTogether(...pairs: [TableSync<any>, Row[]][]): void {
  const parts = pairs.map(([sync, rows]) => [internals.get(sync)!, rows] as const);
  let commits: (() => void)[] = [];
  try {
    db.transaction(() => {
      commits = parts.map(([part, rows]) => part.plan(rows));
    })();
  } catch (err) {
    for (const [part] of parts) part.refresh(); // rolled back: re-read what the tables really hold
    throw err;
  }
  for (const commit of commits) commit();
}
