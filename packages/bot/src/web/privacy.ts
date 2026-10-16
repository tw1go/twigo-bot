import { DEFAULT_PRIVACY, type PrivacySettings } from '@mikazuki/shared';
import { db } from '../db/db.js';

// 🔒 Members' privacy settings (Settings → Privacy in the web game; CONTEXT.md Friends-only whispers): who may whisper
// them. Schema v20 `privacy`, a row only once someone changes one; everyone else has DEFAULT_PRIVACY.

const getStmt = db.prepare<[string], { whispers: string }>('SELECT whispers FROM privacy WHERE user_id = ?');
const setStmt = db.prepare('INSERT INTO privacy (user_id, whispers) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET whispers = excluded.whispers');

export function privacyOf(userId: string): PrivacySettings {
  const row = getStmt.get(userId);
  return { whispers: row?.whispers === 'friends' ? 'friends' : DEFAULT_PRIVACY.whispers };
}

/** Changes what's given (anything else stays); the settings now. */
export function setPrivacy(userId: string, change: Partial<PrivacySettings>): PrivacySettings {
  const next = { ...privacyOf(userId), ...change };
  setStmt.run(userId, next.whispers);
  return next;
}
