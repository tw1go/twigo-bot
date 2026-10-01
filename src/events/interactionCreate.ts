import { MessageFlags, type ButtonInteraction, type Interaction } from 'discord.js';
import { commands } from '../commands/index.js';
import { BUTTON_NO, BUTTON_YES, handleAnswer } from '../match/flow.js';
import { BUTTON_TOGGLE_ROLE, handleToggleRole } from '../minewars/flow.js';
import { handleAnnounceModal, isAnnounceModal } from '../announce/flow.js';
import { BUTTON_PATROL, handlePatrolButton } from '../games/patrol.js';
import { touch } from '../credits/store.js';
import { handlePayoutInteraction, isPayoutInteraction } from '../minewars/payout.js';
import { handleQuestButton, isQuestButton } from '../quests/board.js';
import { handleRaceButton, handleRaceModal, isRaceButton, isRaceModal } from '../games/race.js';
import { handleWishButton, isWishButton } from '../games/secrets.js';
import { handleLoanButton, isLoanButton } from '../commands/loan.js';

const buttonHandlers: Record<string, (i: ButtonInteraction) => Promise<void>> = {
  [BUTTON_YES]: handleAnswer,
  [BUTTON_NO]: handleAnswer,
  [BUTTON_TOGGLE_ROLE]: handleToggleRole,
  [BUTTON_PATROL]: handlePatrolButton,
};

export async function onInteractionCreate(interaction: Interaction) {
  touch(interaction.user.id);

  if ((interaction.isButton() || interaction.isUserSelectMenu()) && isPayoutInteraction(interaction.customId)) {
    try {
      await handlePayoutInteraction(interaction);
    } catch (err) {
      console.error('Error in Mine Wars payout panel:', err);
      const payload = { content: 'Something went wrong with the payout panel.', flags: MessageFlags.Ephemeral } as const;
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
      else await interaction.reply(payload);
    }
    return;
  }

  if ((interaction.isButton() && isRaceButton(interaction.customId)) || (interaction.isModalSubmit() && isRaceModal(interaction.customId))) {
    try {
      if (interaction.isButton()) await handleRaceButton(interaction);
      else if (interaction.isModalSubmit()) await handleRaceModal(interaction);
    } catch (err) {
      console.error('Error in Mosang race:', err);
      const payload = { content: 'Something went wrong with the race.', flags: MessageFlags.Ephemeral } as const;
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
      else await interaction.reply(payload);
    }
    return;
  }

  if (interaction.isButton() && isLoanButton(interaction.customId)) {
    await handleLoanButton(interaction).catch((err) => console.error('Loan button failed:', err));
    return;
  }

  if (interaction.isButton() && isWishButton(interaction.customId)) {
    await handleWishButton(interaction).catch((err) => console.error('Wish failed:', err));
    return;
  }

  if (interaction.isButton() && isQuestButton(interaction.customId)) {
    try {
      await handleQuestButton(interaction);
    } catch (err) {
      console.error('Error handling quest button:', err);
      const payload = { content: 'Something went wrong with that quest.', flags: MessageFlags.Ephemeral } as const;
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
      else await interaction.reply(payload);
    }
    return;
  }

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

  if (interaction.isModalSubmit()) {
    if (!isAnnounceModal(interaction.customId)) return;
    try {
      await handleAnnounceModal(interaction);
    } catch (err) {
      console.error('Error posting announcement:', err);
      const payload = { content: 'Something went wrong posting that.', flags: MessageFlags.Ephemeral } as const;
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
      else await interaction.reply(payload);
    }
    return;
  }

  if (interaction.isAutocomplete()) {
    await commands.get(interaction.commandName)?.autocomplete?.(interaction).catch((err) => console.error('Autocomplete failed:', err));
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
