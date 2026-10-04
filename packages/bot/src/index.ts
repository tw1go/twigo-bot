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
import { closeDatabase } from './db/db.js';

const client = new Client({
  // GuildMessages tells us someone posted (for inactivity). Message Content is only asked for when the town chat is
  // linked to a channel (TOWN_CHAT_CHANNEL_ID), to read what's said there; it must be on in the Developer Portal.
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    ...(config.townChatChannelId ? [GatewayIntentBits.MessageContent] : []),
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
  await client.destroy();
  closeDatabase(); // flush the WAL so mikazuki.db is complete on its own
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await client.login(config.token);
