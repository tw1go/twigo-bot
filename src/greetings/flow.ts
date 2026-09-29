import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Client } from 'discord.js';
import { config } from '../config.js';
import { today } from '../match/state.js';
import { categories, greetings, type Category } from './content.js';
import { holidayCountdown } from './countdown.js';

// Shuffle bags: each list is used fully before any item repeats. Persisted across restarts.
type Bags = Record<string, number[]>;
const DIR = 'data';
const FILE = `${DIR}/greetings-state.json`;

function loadBags(): Bags {
  return existsSync(FILE) ? (JSON.parse(readFileSync(FILE, 'utf8')) as Bags) : {};
}

function saveBags(bags: Bags): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(bags));
}

function shuffled(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function draw<T>(bags: Bags, key: string, items: readonly T[]): T {
  let bag = (bags[key] ?? []).filter((i) => i < items.length);
  if (bag.length === 0) bag = shuffled(items.length);
  const index = bag.pop()!;
  bags[key] = bag;
  return items[index];
}

/** Daily 7:00 AM — greeting plus a joke, sweet message or trivia. */
export async function sendGreeting(client: Client): Promise<void> {
  const bags = loadBags();
  const greeting = draw(bags, 'greetings', greetings);
  const category = draw(bags, 'category', Object.keys(categories) as Category[]);
  const { title, items } = categories[category];
  const body = draw(bags, category, items);
  saveBags(bags);

  const channel = await client.channels.fetch(config.greetingsChannelId);
  if (!channel?.isSendable()) throw new Error(`Channel ${config.greetingsChannelId} not found or not sendable`);
  await channel.send({
    content: `☀️ **${greeting}**\n\n**${title}**\n${body}\n\n${holidayCountdown(today())}`,
    allowedMentions: { parse: [] },
  });
}
