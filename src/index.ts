import { Client, Events, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';
import { onInteractionCreate } from './events/interactionCreate.js';
import { startScheduler } from './scheduler.js';
import { startBanter } from './banter/flow.js';
import { startVoiceCredits } from './credits/voice.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  startScheduler(c);
  startBanter(c);
  startVoiceCredits(c);
});

client.on(Events.InteractionCreate, onInteractionCreate);

const shutdown = async () => {
  await client.destroy();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await client.login(config.token);
