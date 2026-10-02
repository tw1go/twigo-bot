import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { markFound } from './found.js';
import type { MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js';
import { config } from '../config.js';
import { add } from '../credits/store.js';
import { kowen } from '../kowens.js';

// 🤫 6-7 Easter egg: on the morning 67 days remain until Christmas, the greeting says "6️⃣7️⃣!". Reacting to that
// greeting with BOTH 6️⃣ and 7️⃣ gives EGG67_REWARD once per member. Not announced in patch notes.
export const EGG67_REWARD = 5;
const SIX = '6️⃣';
const SEVEN = '7️⃣';

interface State {
  messageId?: string;
  rewarded: string[];
}
const DIR = 'data';
const FILE = `${DIR}/egg67.json`;
let state: State = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : { rewarded: [] };
function save(): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(state));
}

/** Called by the greeting on the 67-day morning: this message is the egg (a new year's egg resets the finders). */
export function setEgg67Message(messageId: string): void {
  state = { messageId, rewarded: [] };
  save();
}

export async function onEgg67Reaction(reaction: MessageReaction | PartialMessageReaction, rawUser: User | PartialUser): Promise<void> {
  if (!state.messageId || reaction.message.id !== state.messageId) return;
  const name = reaction.emoji.name;
  if (name !== SIX && name !== SEVEN) return;
  const user = rawUser.partial ? await rawUser.fetch() : rawUser;
  if (user.bot || state.rewarded.includes(user.id)) return;

  // Needs both: check whether they also reacted with the other one.
  const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
  const other = message.reactions.cache.find((r) => r.emoji.name === (name === SIX ? SEVEN : SIX));
  if (!other) return;
  const otherUsers = await other.users.fetch().catch(() => null);
  if (!otherUsers?.has(user.id)) return;

  state.rewarded.push(user.id);
  save();
  add(user.id, EGG67_REWARD);
  markFound(user.id, '67');
  console.log(`[egg67] ${user.id} found it (+${EGG67_REWARD})`);
  const channel = await user.client.channels.fetch(config.gamesChannelId).catch(() => null);
  if (channel?.isSendable()) {
    await channel
      .send({ content: `6️⃣7️⃣ **${user} found the 67 egg!** +${EGG67_REWARD} ${kowen(EGG67_REWARD)} 🫲🫱\n-# 67! 67! 67!`, allowedMentions: { users: [user.id] } })
      .catch(() => {});
  }
}
