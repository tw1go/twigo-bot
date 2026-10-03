import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type ButtonInteraction } from 'discord.js';
import { config } from '../config.js';
import { add } from '../credits/store.js';
import { db } from '../db/db.js';
import { kowen } from '../kowens.js';

// 🎮 Pre-registration for the Mikazuki web game. Members sign up in Discord (/preregister, or the panel button the
// gifter posts with /gift prereg-panel) or in the game itself once logged in with Discord. At launch the gifter
// runs /gift launch: every registrant gets LAUNCH_REWARD once, straight into their wallet, and sign-ups close.

export const LAUNCH_REWARD = 50;
export const BUTTON_PREREG = 'prereg:join';

export type PreregSource = 'discord' | 'web';
export type PreregResult = 'joined' | 'already' | 'closed';

const insert = db.prepare('INSERT OR IGNORE INTO preregistrations (user_id, registered, source) VALUES (?, ?, ?)');
const findOne = db.prepare<[string], { user_id: string }>('SELECT user_id FROM preregistrations WHERE user_id = ?');
const countAll = db.prepare<[], { n: number }>('SELECT COUNT(*) n FROM preregistrations');
const unpaid = db.prepare<[], { user_id: string }>('SELECT user_id FROM preregistrations WHERE rewarded IS NULL ORDER BY registered');
const markPaid = db.prepare('UPDATE preregistrations SET rewarded = ? WHERE user_id = ? AND rewarded IS NULL');
const launchedAt = db.prepare<[], { value: string }>("SELECT value FROM meta WHERE key = 'game_launched'");
const markLaunched = db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('game_launched', ?)");

export const launched = () => !!launchedAt.get();
export const preregCount = () => countAll.get()!.n;
export const isPreregistered = (userId: string) => !!findOne.get(userId);

export function preregister(userId: string, source: PreregSource): PreregResult {
  if (launched()) return 'closed';
  const joined = insert.run(userId, Date.now(), source).changes > 0;
  if (joined) console.log(`[prereg] ${userId} pre-registered (${source}), ${preregCount()} total`);
  return joined ? 'joined' : 'already';
}

/** Launch: closes sign-ups and pays every registrant who hasn't been paid. Safe to run again. */
export function launchPayout(): { paid: number; total: number } {
  markLaunched.run(new Date().toISOString());
  const ids = unpaid.all().map((r) => r.user_id);
  let paid = 0;
  for (const id of ids) {
    // Marked before paying: a crash in between can leave someone unpaid (fixable by hand), never paid twice.
    if (markPaid.run(Date.now(), id).changes === 0) continue;
    add(id, LAUNCH_REWARD, { garnish: false }); // a gift, so loans don't take a cut
    paid++;
  }
  console.log(`[prereg] launch: paid ${paid} member(s) ${LAUNCH_REWARD} each`);
  return { paid, total: preregCount() };
}

const gameUrl = () => (config.publicUrl ? `${config.publicUrl}/play/` : null);

export function preregReply(result: PreregResult): string {
  const reward = `**${LAUNCH_REWARD}** ${kowen(LAUNCH_REWARD)}`;
  if (result === 'joined') return `✅ You're pre-registered for the Mikazuki web game! You'll get ${reward} when it launches. 🎮\n-# ${preregCount()} pre-registered so far.`;
  if (result === 'already') return `You're already pre-registered ✅ Your ${reward} will arrive at launch.`;
  return 'Pre-registration is closed: the game is out! 🎮' + (gameUrl() ? ` Play at ${gameUrl()}` : '');
}

/** The panel the gifter posts: a button anyone can press, with a live count. */
export function preregPanel() {
  const url = gameUrl();
  const content = [
    '🎮 **The Mikazuki web game is coming!**',
    `Pre-register now and get **${LAUNCH_REWARD} ${kowen(LAUNCH_REWARD)}** when it launches.`,
    url ? `You can also pre-register in the game: ${url} (log in with Discord).` : null,
    `-# ${preregCount()} pre-registered so far`,
  ].filter(Boolean).join('\n');
  const button = new ButtonBuilder().setCustomId(BUTTON_PREREG).setLabel('Pre-register').setEmoji('🎮').setStyle(ButtonStyle.Success);
  return { content, components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)] };
}

export async function handlePreregButton(interaction: ButtonInteraction): Promise<void> {
  const result = preregister(interaction.user.id, 'discord');
  await interaction.reply({ content: preregReply(result), flags: MessageFlags.Ephemeral });
  if (result !== 'joined') return;
  // Refresh the count line, keeping the rest of the message (the panel, or an announcement with this button).
  const COUNT = /-# \d+ pre-registered so far/;
  const content = interaction.message.content;
  if (COUNT.test(content)) await interaction.message.edit({ content: content.replace(COUNT, `-# ${preregCount()} pre-registered so far`) }).catch(() => {});
}
