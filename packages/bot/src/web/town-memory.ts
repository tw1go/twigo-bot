import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TownChatLine, TownSystemLine } from '@mikazuki/shared';
import { kvLoad, kvSave } from '../db/db.js';
import { DATA_DIR } from '../paths.js';

// 🧠 What the town remembers across a bot restart, so a restart is quiet: the last chat lines (web/town.ts keeps 20) and
// the system feed's last lines. The chat goes to a small file of its own, data/town-chat.json, overwritten each time
// (never in the database, so never in the backups: older lines simply stop existing); the feed, which is posted in
// Discord anyway, to kv 'town-feed-recent'. Written a couple of seconds after a change, and at shutdown.

const CHAT_FILE = join(DATA_DIR, 'town-chat.json');
const FEED_KEY = 'town-feed-recent';
const SAVE_MS = 2_000;

export interface TownMemory {
  chat: TownChatLine[];
  system: TownSystemLine[];
  save(chat: TownChatLine[], system: TownSystemLine[]): void;
}

let pending: { chat: TownChatLine[]; system: TownSystemLine[] } | null = null;
let timer: NodeJS.Timeout | null = null;

function write(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!pending) return;
  const { chat, system } = pending;
  pending = null;
  try {
    writeFileSync(`${CHAT_FILE}.tmp`, JSON.stringify(chat));
    renameSync(`${CHAT_FILE}.tmp`, CHAT_FILE);
  } catch (err) {
    console.error('[town] chat not saved:', err);
  }
  kvSave(FEED_KEY, system);
}

function readChat(): TownChatLine[] {
  try {
    const lines = JSON.parse(readFileSync(CHAT_FILE, 'utf8')) as unknown;
    return Array.isArray(lines) ? (lines as TownChatLine[]) : [];
  } catch {
    return []; // none yet
  }
}

export function townMemory(): TownMemory {
  return {
    chat: readChat(),
    system: kvLoad<TownSystemLine[]>(FEED_KEY, []),
    save(chat, system) {
      pending = { chat: [...chat], system: [...system] };
      timer ??= setTimeout(write, SAVE_MS);
    },
  };
}

/** Writes anything waiting (at shutdown, before the database closes). */
export const flushTownMemory = write;
