import { DEFAULT_PRIVACY, type PrivacySettings, VISIBILITIES, type Visibility } from '@mikazuki/shared';
import { db } from '../db/db.js';
import { isCmsUser } from './auth.js';

// 🔒 Members' privacy settings (Settings → Privacy in the web game): who may whisper them (CONTEXT.md Friends-only
// whispers), and who can see their Balance and their Status (CONTEXT.md Who can see: everyone, friends, or only them).
// Schema v20/v22 `privacy`, a row only once someone changes one; everyone else has DEFAULT_PRIVACY. `maySee` is the
// one rule the town's player menu, Discord's /balance and /status and the leaderboards ask.

const getStmt = db.prepare<[string], { whispers: string; balance: string; status: string }>('SELECT whispers, balance, status FROM privacy WHERE user_id = ?');
const setStmt = db.prepare(
  'INSERT INTO privacy (user_id, whispers, balance, status) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET whispers = excluded.whispers, balance = excluded.balance, status = excluded.status',
);

const visibility = (v: string | undefined, fallback: Visibility): Visibility => (VISIBILITIES.includes(v as Visibility) ? (v as Visibility) : fallback);

export function privacyOf(userId: string): PrivacySettings {
  const row = getStmt.get(userId);
  return {
    whispers: row?.whispers === 'friends' ? 'friends' : DEFAULT_PRIVACY.whispers,
    balance: visibility(row?.balance, DEFAULT_PRIVACY.balance),
    status: visibility(row?.status, DEFAULT_PRIVACY.status),
  };
}

/** Changes what's given (anything else stays); the settings now. */
export function setPrivacy(userId: string, change: Partial<PrivacySettings>): PrivacySettings {
  const next = { ...privacyOf(userId), ...change };
  setStmt.run(userId, next.whispers, next.balance, next.status);
  return next;
}

/** Whether two members are friends (the town keeps friends: server.ts connects it once the town is up). */
let friendsWith: (a: string, b: string) => boolean = () => false;
export function seeFriendsBy(fn: (a: string, b: string) => boolean): void {
  friendsWith = fn;
}

/** Whether `viewer` may see `owner`'s Balance or Status: always their own, and Game Masters always; else by the
 *  owner's setting. `viewer` null: the public (the website, a Discord post everyone sees), who only see 'everyone'. */
export function maySee(viewer: string | null, owner: string, what: 'balance' | 'status'): boolean {
  if (viewer === owner || (viewer && isCmsUser(viewer))) return true;
  const v = privacyOf(owner)[what];
  return v === 'everyone' || (v === 'friends' && !!viewer && friendsWith(viewer, owner));
}

/** Discord's private answer when `viewer` may not see `owner`'s Balance or Status (`name`: theirs to show), or null when
 *  they may. */
export function hiddenLine(viewer: string, owner: string, name: string, what: 'balance' | 'status'): string | null {
  if (maySee(viewer, owner, what)) return null;
  return privacyOf(owner)[what] === 'friends' ? `🔒 ${name}'s ${what} is only shown to their friends.` : `🔒 ${name} keeps their ${what} to themselves.`;
}
