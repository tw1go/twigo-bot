import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
  type Client,
  type Message,
} from 'discord.js';
import { config } from '../config.js';
import { add } from '../credits/store.js';
import { blockIfJailed, jail } from './jail.js';
import { kowen } from '../kowens.js';

// Tanod Patrol: at random times the Tanod calls roll. First 3 to click win 3/2/1 credits.
// If 4+ people answer, the slowest gets 2 minutes in jail. Nobody answers → everyone was asleep.
export const BUTTON_PATROL = 'patrol:here';
const REWARDS = [3, 2, 1];
const WINDOW_MS = 60_000;
const SLOWPOKE_JAIL_MINUTES = 2;
const MIN_GAP_MS = 3 * 3_600_000;
const MAX_GAP_MS = 6 * 3_600_000;
const ACTIVE_FROM_HOUR = 10; // 10 AM
const ACTIVE_UNTIL_HOUR = 22; // 10 PM

let active: { message: Message; answered: string[] } | null = null;

const row = (disabled = false) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(BUTTON_PATROL).setLabel("I'm awake!").setEmoji('🙋').setStyle(ButtonStyle.Success).setDisabled(disabled),
  );

export async function startPatrol(client: Client): Promise<void> {
  if (active) return;
  const channel = await client.channels.fetch(config.gamesChannelId);
  if (!channel?.isSendable()) throw new Error(`Channel ${config.gamesChannelId} not found or not sendable`);

  const message = await channel.send({
    content: '🚨 **TANOD PATROL!** Who is awake? First 3 to answer get **3 / 2 / 1** Kowens! You have 60 seconds. ⏱️',
    components: [row()],
  });
  active = { message, answered: [] };
  setTimeout(() => void endPatrol().catch((e) => console.error('[patrol] end failed:', e)), WINDOW_MS);
}

async function endPatrol(): Promise<void> {
  if (!active) return;
  const { message, answered } = active;
  active = null;

  const lines = answered.slice(0, REWARDS.length).map((id, i) => `${['🥇', '🥈', '🥉'][i]} <@${id}> +${REWARDS[i]}`);
  let result: string;
  if (answered.length === 0) result = '😴 Nobody answered. Everyone is asleep on duty!';
  else {
    result = `**Roll call:**\n${lines.join('\n')}`;
    if (answered.length > REWARDS.length) {
      const slowest = answered[answered.length - 1];
      await jail(slowest, SLOWPOKE_JAIL_MINUTES, 'Slowest at Tanod Patrol');
      result += `\n🐢 <@${slowest}> was the slowest — **${SLOWPOKE_JAIL_MINUTES} minutes** in jail! 🚔`;
    }
  }
  await message.edit({ content: `🚨 **TANOD PATROL** is over!\n${result}`, components: [row(true)], allowedMentions: { parse: [] } });
}

export async function handlePatrolButton(interaction: ButtonInteraction): Promise<void> {
  if (!active || interaction.message.id !== active.message.id) {
    await interaction.reply({ content: 'This patrol is already over. ⏰', flags: MessageFlags.Ephemeral });
    return;
  }
  if (await blockIfJailed(interaction)) return;
  if (active.answered.includes(interaction.user.id)) {
    await interaction.reply({ content: 'You already answered! 🫡', flags: MessageFlags.Ephemeral });
    return;
  }

  active.answered.push(interaction.user.id);
  const place = active.answered.length;
  if (place <= REWARDS.length) {
    add(interaction.user.id, REWARDS[place - 1]);
    await interaction.reply({ content: `🫡 You're #${place}! +${REWARDS[place - 1]} ${kowen(REWARDS[place - 1])}.`, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.reply({ content: `🫡 You're #${place} — too slow for Kowens. Don't be the last one...`, flags: MessageFlags.Ephemeral });
  }
}

function hourNow(): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
}

/** Runs a patrol every 3–6 hours, only between 10 AM and 10 PM. */
export function startPatrolScheduler(client: Client): void {
  const between = (min: number, max: number) => min + Math.random() * (max - min);
  const schedule = (ms: number) => {
    console.log(`[patrol] next check in ${Math.round(ms / 60_000)} min`);
    setTimeout(tick, ms);
  };
  const tick = async () => {
    const hour = hourNow();
    if (hour < ACTIVE_FROM_HOUR || hour >= ACTIVE_UNTIL_HOUR) return schedule(between(30 * 60_000, 90 * 60_000));
    await startPatrol(client).catch((e) => console.error('[patrol] failed:', e));
    schedule(between(MIN_GAP_MS, MAX_GAP_MS));
  };
  schedule(between(MIN_GAP_MS, MAX_GAP_MS));
}
