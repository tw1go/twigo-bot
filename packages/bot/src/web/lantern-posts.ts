import { db } from '../db/db.js';

// 🏮 The Lantern Posts each member has restored on foot (schema v26 lantern_posts; CONTEXT.md Restored Lantern Post):
// every post starts broken for everyone; walking up to one and using it restores it for them (web/town.ts
// `lantern-restore`), and a dungeon entrance by reaching it. Kept in memory too (read on every arrival and teleport),
// written as one is restored.

const allStmt = db.prepare<[], { user_id: string; post: string }>('SELECT user_id, post FROM lantern_posts');
const addStmt = db.prepare('INSERT INTO lantern_posts (user_id, post, at) VALUES (?, ?, ?) ON CONFLICT(user_id, post) DO NOTHING');

let cache: Map<string, Set<string>> | null = null;
function all(): Map<string, Set<string>> {
  if (cache) return cache;
  cache = new Map();
  for (const r of allStmt.all()) (cache.get(r.user_id) ?? cache.set(r.user_id, new Set()).get(r.user_id)!).add(r.post);
  return cache;
}

/** The posts a member has restored (shared postKey: '<map>:<index>', '<map>:<dungeon>'). */
export const restoredPostsOf = (userId: string): string[] => [...(all().get(userId) ?? [])];

/** A member restored `post`: kept. True if it's new (false: they had it already). */
export function restorePost(userId: string, post: string, now = Date.now()): boolean {
  const mine = all().get(userId) ?? all().set(userId, new Set()).get(userId)!;
  if (mine.has(post)) return false;
  mine.add(post);
  addStmt.run(userId, post, now);
  return true;
}
