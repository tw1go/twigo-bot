import { db } from '../db/db.js';
import { type FriendData, type FriendSaves, pair } from './town-friends.js';

// 🤝 Friends as saved (schema v19: friends, friend_requests, last_seen; v21: blocks): loaded once as the town starts, each change
// written as it happens (web/town-friends.ts keeps them in memory).

const friendsStmt = db.prepare<[], { a: string; b: string; since: number }>('SELECT a, b, since FROM friends');
const requestsStmt = db.prepare<[], { from_id: string; to_id: string; at: number }>('SELECT from_id, to_id, at FROM friend_requests');
const seenStmt = db.prepare<[], { user_id: string; at: number }>('SELECT user_id, at FROM last_seen');
const addFriendStmt = db.prepare('INSERT INTO friends (a, b, since) VALUES (?, ?, ?) ON CONFLICT(a, b) DO UPDATE SET since = excluded.since');
const dropFriendStmt = db.prepare('DELETE FROM friends WHERE a = ? AND b = ?');
const addRequestStmt = db.prepare('INSERT INTO friend_requests (from_id, to_id, at) VALUES (?, ?, ?) ON CONFLICT(from_id, to_id) DO UPDATE SET at = excluded.at');
const dropRequestStmt = db.prepare('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?');
const setSeenStmt = db.prepare('INSERT INTO last_seen (user_id, at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET at = excluded.at');
const blocksStmt = db.prepare<[], { user_id: string; blocked_id: string; at: number }>('SELECT user_id, blocked_id, at FROM blocks');
const addBlockStmt = db.prepare('INSERT INTO blocks (user_id, blocked_id, at) VALUES (?, ?, ?) ON CONFLICT(user_id, blocked_id) DO UPDATE SET at = excluded.at');
const dropBlockStmt = db.prepare('DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?');

export function loadFriends(): FriendData {
  return {
    friends: friendsStmt.all().map((r) => [r.a, r.b, r.since]),
    requests: requestsStmt.all().map((r) => ({ from: r.from_id, to: r.to_id, at: r.at })),
    seen: seenStmt.all().map((r) => [r.user_id, r.at]),
    blocks: blocksStmt.all().map((r) => ({ by: r.user_id, who: r.blocked_id, at: r.at })),
  };
}

export const friendSaves: FriendSaves = {
  friend(a, b, since) {
    const [x, y] = pair(a, b);
    if (since === null) dropFriendStmt.run(x, y);
    else addFriendStmt.run(x, y, since);
  },
  request(from, to, at) {
    if (at === null) dropRequestStmt.run(from, to);
    else addRequestStmt.run(from, to, at);
  },
  seen(user, at) {
    setSeenStmt.run(user, at);
  },
  block(by, who, at) {
    if (at === null) dropBlockStmt.run(by, who);
    else addBlockStmt.run(by, who, at);
  },
};
