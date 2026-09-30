import { Client, Events, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';
import { onInteractionCreate } from './events/interactionCreate.js';
import { startScheduler } from './scheduler.js';
import { startBanter } from './banter/flow.js';
import { startVoiceCredits } from './credits/voice.js';
import { startJailWatcher } from './games/jail.js';
import { startPatrolScheduler } from './games/patrol.js';
import { touch } from './credits/store.js';
import { initBoosters, onBoostMessage } from './games/boosts.js';

const client = new Client({
  // GuildMessages only tells us someone posted (for inactivity); we don't have or need Message Content.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages],
});

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  startScheduler(c);
  startBanter(c);
  startVoiceCredits(c);
  startJailWatcher(c);
  startPatrolScheduler(c);
  initBoosters(c).catch((err) => console.error('[boosts] init failed:', err));
});

client.on(Events.InteractionCreate, onInteractionCreate);
client.on(Events.MessageCreate, (message) => {
  if (!message.author.bot) touch(message.author.id);
  onBoostMessage(message).catch((err) => console.error('[boosts] failed:', err));
});

const shutdown = async () => {
  await client.destroy();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await client.login(config.token);
