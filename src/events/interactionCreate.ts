import { MessageFlags, type ButtonInteraction, type Interaction } from 'discord.js';
import { commands } from '../commands/index.js';
import { BUTTON_NO, BUTTON_YES, handleAnswer } from '../match/flow.js';
import { BUTTON_TOGGLE_ROLE, handleToggleRole } from '../minewars/flow.js';

const buttonHandlers: Record<string, (i: ButtonInteraction) => Promise<void>> = {
  [BUTTON_YES]: handleAnswer,
  [BUTTON_NO]: handleAnswer,
  [BUTTON_TOGGLE_ROLE]: handleToggleRole,
};

export async function onInteractionCreate(interaction: Interaction) {
  if (interaction.isButton()) {
    const handler = buttonHandlers[interaction.customId];
    if (!handler) return;
    try {
      await handler(interaction);
    } catch (err) {
      console.error(`Error handling button ${interaction.customId}:`, err);
      const payload = { content: 'Something went wrong.', flags: MessageFlags.Ephemeral } as const;
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
      else await interaction.reply(payload);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`Error in /${interaction.commandName}:`, err);
    const payload = { content: 'Something went wrong running that command.', flags: MessageFlags.Ephemeral } as const;
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
    else await interaction.reply(payload);
  }
}
