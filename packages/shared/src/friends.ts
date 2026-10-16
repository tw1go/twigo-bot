// 🤝 Friends (CONTEXT.md Friend, Friend request): both ways, asked and accepted. How many, and how long a request waits.

export const FRIEND_RULES = {
  /** Friends a player may have. */
  max: 100,
  /** Friend requests a player may have waiting (sent, not yet answered). */
  asks: 20,
  /** A request nobody answers lapses after this many days. */
  requestDays: 14,
} as const;

/** A player's privacy settings (Settings → Privacy; CONTEXT.md Friends-only whispers): who may whisper them. */
export interface PrivacySettings {
  whispers: 'everyone' | 'friends';
}

/** What a player who never changed them has. */
export const DEFAULT_PRIVACY: PrivacySettings = { whispers: 'everyone' };

/** "Today", "Yesterday", "3 days ago": when a friend was last online, by calendar day where `now` is. */
export function lastOnline(at: number, now: number): string {
  const day = (ms: number) => {
    const d = new Date(ms);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
  };
  const days = Math.max(0, Math.round(day(now) - day(at)));
  return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
}
