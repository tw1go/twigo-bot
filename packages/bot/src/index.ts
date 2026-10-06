import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { config } from './config.js';
import { onInteractionCreate } from './events/interactionCreate.js';
import { startScheduler } from './scheduler.js';
import { startBanter } from './banter/flow.js';
import { startVoiceCredits } from './credits/voice.js';
import { startJailWatcher } from './games/jail.js';
import { startPatrolScheduler } from './games/patrol.js';
import { touch } from './credits/store.js';
import { initBoosters, onBoostMessage } from './games/boosts.js';
import { catchUpEggs, onEggReaction } from './games/easter-egg.js';
import { refundInterruptedRace } from './games/race.js';
import { onEgg67Reaction } from './games/egg67.js';
import { onSaluteReaction } from './games/secrets.js';
import { backfillFound } from './games/found.js';
import { startWebServer } from './web/server.js';
import { flushTownMemory } from './web/town-memory.js';
import { connectFeedChannel } from './web/town-feed.js';
import { closeDatabase } from './db/db.js';

/** Whether the Presence intent is on in the Developer Portal: asking for it while it's off stops the login. */
async function presenceAllowed(): Promise<boolean> {
  const res = await fetch('https://discord.com/api/v10/applications/@me', { headers: { Authorization: `Bot ${config.token}` } }).catch(() => null);
  const flags = res?.ok ? (((await res.json()) as { flags?: number }).flags ?? 0) : 0;
  return (flags & ((1 << 12) | (1 << 13))) !== 0; // GATEWAY_PRESENCE or GATEWAY_PRESENCE_LIMITED
}
const presences = await presenceAllowed();
console.log(`[presence] Discord status ${presences ? 'on' : 'off (turn on the Presence intent to show it in the town)'}`);

const client = new Client({
  // GuildMessages tells us someone posted (for inactivity). Message Content is only asked for when the town chat is
  // linked to a channel (TOWN_CHAT_CHANNEL_ID), to read what's said there; it must be on in the Developer Portal.
  // Presences (members' Discord status, for the town's profile dot) only when that intent is on there too.
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    ...(config.townChatChannelId ? [GatewayIntentBits.MessageContent] : []),
    ...(presences ? [GatewayIntentBits.GuildPresences] : []),
  ],
  // Partials let us see reactions on messages sent before the bot started (the easter egg).
  partials: [Partials.Message, Partials.Reaction, Partials.User],
});

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  startScheduler(c);
  startBanter(c);
  startVoiceCredits(c);
  startJailWatcher(c);
  startPatrolScheduler(c);
  connectFeedChannel(c); // the town's system feed, also in its Discord channel
  startWebServer(c);
  initBoosters(c).catch((err) => console.error('[boosts] init failed:', err));
  catchUpEggs(c).catch((err) => console.error('[easter-egg] catch-up failed:', err));
  refundInterruptedRace(c).catch((err) => console.error('[race] refund failed:', err));
  backfillFound();
});

client.on(Events.InteractionCreate, onInteractionCreate);
client.on(Events.MessageReactionAdd, (reaction, user) => {
  onEggReaction(reaction, user).catch((err) => console.error('[easter-egg] failed:', err));
  onEgg67Reaction(reaction, user).catch((err) => console.error('[egg67] failed:', err));
  onSaluteReaction(reaction, user).catch((err) => console.error('[salute] failed:', err));
});
client.on(Events.MessageCreate, (message) => {
  if (!message.author.bot) touch(message.author.id);
  onBoostMessage(message).catch((err) => console.error('[boosts] failed:', err));
});

const shutdown = async () => {
  flushTownMemory(); // the town's last chat and feed lines, for after the restart
  await client.destroy();
  closeDatabase(); // flush the WAL so mikazuki.db is complete on its own
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await client.login(config.token);
