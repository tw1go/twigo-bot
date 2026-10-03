import { fakeLogin } from '../session';

// The member's nickname in the town. Same rule as the bot (packages/bot/src/web/nickname.ts), which has the final
// say (and checks that no one else has it).

export const NICKNAME_RULE = '3–16 letters or numbers; spaces, _ - . in between';
const SHAPE = /^[A-Za-z0-9](?:[A-Za-z0-9 _.-]{1,14})[A-Za-z0-9]$/;

/** The cleaned-up nickname (trimmed, single spaces) if valid, else null. */
export function parseNickname(raw: string): string | null {
  const nick = raw.trim().replace(/ {2,}/g, ' ');
  return SHAPE.test(nick) ? nick : null;
}

/** A starting suggestion from their Discord name: its allowed characters, if that makes a valid nickname. */
export function suggestNickname(name: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9 _.-]/g, '')
    .replace(/^[ _.-]+/, '')
    .slice(0, 16)
    .replace(/[ _.-]+$/, '');
  return parseNickname(cleaned) ?? '';
}

export async function saveNickname(nick: string): Promise<'ok' | 'taken' | 'invalid' | 'error'> {
  if (fakeLogin()) return 'ok'; // dev: no room API to save to
  const res = await fetch('/nickname', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: nick }),
  }).catch(() => null);
  if (res?.ok) return 'ok';
  return res?.status === 409 ? 'taken' : res?.status === 400 ? 'invalid' : 'error';
}
