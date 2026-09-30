import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { config } from '../config.js';
import { add } from '../credits/store.js';
import { kowen } from '../kowens.js';
import { CLAIMS_PER_DAY, claimCode } from '../web/finds.js';

/* How each resident of twigo's room is named in the announcement. The
   site sends the key; anything unknown falls back to "someone". */
const WHO: Record<string, string> = {
  elli: 'Elli',
  lulu: 'Lulu',
  wonwuu: 'Wonwuu the rat',
  pittuki: 'Dr. Pittuki',
  croakyangs: 'Croakyangs',
  'jords-fork': "Jord's Fork",
  pumpkin: 'Biiko Kalabasa',
  'fairy-cha': 'Fairy Cha',
  jukebox: 'the jukebox',
};

export const claim: Command = {
  data: new SlashCommandBuilder()
    .setName('claim')
    .setDescription("Claim a Kowen you found in twigo's room 🪙 · 🔒 Only you (find is announced)")
    .addStringOption((o) => o.setName('code').setDescription('The code shown on the site').setRequired(true).setMaxLength(12)),
  async execute(interaction) {
    const code = interaction.options.getString('code', true);
    const result = claimCode(interaction.user.id, code);

    if (!result.ok) {
      return void (await interaction.reply({
        content:
          result.reason === 'limit'
            ? `You've already claimed **${CLAIMS_PER_DAY}** room finds today. Come back tomorrow! 🌙`
            : "That code isn't valid — it may have expired (codes last 15 minutes) or already been claimed. 🤔",
        flags: MessageFlags.Ephemeral,
      }));
    }

    const balance = add(interaction.user.id, result.reward);
    await interaction.reply({
      content: `🪙 Claimed! +${result.reward} ${kowen(result.reward)} — you now have **${balance}**.\n-# ${CLAIMS_PER_DAY - result.claimedToday} more room finds left today.`,
      flags: MessageFlags.Ephemeral,
    });

    // Announced in general: the finder and the owner are pinged, nobody else. The claim has already
    // succeeded, so a failed announcement is only logged, never shown to the member as an error.
    const channel = await interaction.client.channels.fetch(config.generalChannelId).catch(() => null);
    if (channel?.isSendable()) {
      const who = WHO[result.character] ?? 'someone';
      const self = interaction.user.id === config.rewardOwnerId;
      await channel
        .send({
          content: self
            ? `🪙 ${interaction.user} found a Kowen in twigo's room, thanks to **${who}**! (+${result.reward})`
            : `🪙 <@${config.rewardOwnerId}> — ${interaction.user} found a Kowen in twigo's room, thanks to **${who}**! (+${result.reward})`,
          // Discord rejects duplicate IDs here.
          allowedMentions: { users: [...new Set([config.rewardOwnerId, interaction.user.id])] },
        })
        .catch((err) => console.error('[claim] announcement failed:', err));
    }
  },
};
