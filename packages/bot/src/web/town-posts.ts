import { randomBytes } from 'node:crypto';
import type { TownNewsPost } from '@mikazuki/shared';
import { kvLoad, kvSave } from '../db/db.js';

// 📣 Announcements for the web town only (never posted in Discord): listed in the town's News with the Discord ones
// (web/town-news.ts), newest first. Same markdown as Discord. `at` is kept when a post is edited, so the News dot
// shows once per post. Written in the CMS and kept in the database (kv 'town-posts'); the first start seeds it with
// the post below.

export interface TownPost extends TownNewsPost {
  id: string;
}

const SEED: TownNewsPost[] = [
  {
    at: Date.UTC(2026, 9, 5, 8, 30), // 2026-10-05
    title: '🌙 Welcome to the Mikazuki close beta!',
    body: [
      'Mabuhay, testers! 🫡 You are among the very first to walk the streets of **Mikazuki town**. 🏘️✨',
      '',
      '**🗺️ Things to try**',
      '• Walk around, chat and emote with everyone in town',
      '• ⛏️ Dig at the **Mine**, 🪙 flip **Kara y Krus** at the **Casino**, 🎟️ try your luck at the **jackpot booth**',
      '• 🏦 Visit the **bank**, the 🎁 **sari-sari store**, the 📜 **notice board** and the 🏆 **leaderboard monument**',
      '• Click another player to give Kowens, or to praise, diss or judge them',
      '• 🎒 Press **B** for your bag',
      '',
      '**🛠️ It is a beta**',
      '• Things may break or change while we build. Your Kowens and items are the same ones as in Discord.',
      '• Found a bug or have an idea? Tell twigo in Discord 💬',
      '',
      'Thank you for helping build the town! 💛',
      '-# The Tanod is watching. Behave out there. 🚨',
    ].join('\n'),
  },
];

const KEY = 'town-posts';
const posts = kvLoad<TownPost[]>(KEY, SEED.map((p) => ({ id: newId(), ...p })));
const save = () => kvSave(KEY, posts);
save(); // the seed, the first time

function newId(): string {
  return randomBytes(6).toString('hex');
}

export const TITLE_MAX = 120;
export const BODY_MAX = 4000;

/** The town-only posts, newest first. */
export const townPosts = (): TownPost[] => [...posts].sort((a, b) => b.at - a.at);

/** Adds a post dated now; `id` given = changes that post (keeping its date unless `bump`). False if it's gone. */
export function savePost(id: string | null, title: string, body: string, bump = false): TownPost | null {
  if (!id) {
    const post = { id: newId(), at: Date.now(), title, body };
    posts.push(post);
    save();
    return post;
  }
  const post = posts.find((p) => p.id === id);
  if (!post) return null;
  Object.assign(post, { title, body }, bump ? { at: Date.now() } : {});
  save();
  return post;
}

export function deletePost(id: string): boolean {
  const i = posts.findIndex((p) => p.id === id);
  if (i < 0) return false;
  posts.splice(i, 1);
  save();
  return true;
}
