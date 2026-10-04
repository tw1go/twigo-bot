import dotenv from 'dotenv';
import { ENV_FILE } from './paths.js';

dotenv.config({ path: ENV_FILE, quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const timezone = required('TIMEZONE');
try {
  new Intl.DateTimeFormat('en-US', { timeZone: timezone });
} catch {
  throw new Error(`Invalid TIMEZONE: ${timezone} (use an IANA name like Asia/Manila)`);
}

export const config = {
  token: required('DISCORD_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  guildId: process.env.DISCORD_GUILD_ID || undefined,
  timezone,
  adminRoleId: required('ADMIN_ROLE_ID'),
  adminChannelId: required('ADMIN_CHANNEL_ID'),
  matchChannelId: required('MATCH_CHANNEL_ID'),
  mineWarsChannelId: required('MINE_WARS_CHANNEL_ID'),
  mineWarsRoleId: required('MINE_WARS_ROLE_ID'),
  greetingsChannelId: required('GREETINGS_CHANNEL_ID'),
  banterChannelId: required('BANTER_CHANNEL_ID'),
  gamesChannelId: required('GAMES_CHANNEL_ID'),
  jailRoleId: required('JAIL_ROLE_ID'),
  rewardOwnerId: required('REWARD_OWNER_ID'),
  // Gambling here has a much lower chance of getting busted by the Tanod.
  gamblingChannelId: required('GAMBLING_CHANNEL_ID'),
  // Where twigo's room finds (/claim) are announced.
  roomFindsChannelId: required('ROOM_FINDS_CHANNEL_ID'),
  boostChannelId: required('BOOST_CHANNEL_ID'),
  easterEggChannelId: required('EASTER_EGG_CHANNEL_ID'),
  easterEggMessageId: required('EASTER_EGG_MESSAGE_ID'),
  // Room finds (/claim) are announced here; falls back to the games channel.
  // Local port for the room API (src/web/server.ts). Empty = API off.
  webPort: Number(process.env.WEB_PORT) || 0,
  // Discord login for the web game (src/web/auth.ts): the app's OAuth2 client secret and the public HTTPS address
  // the game is served from (redirect URI = <WEB_PUBLIC_URL>/auth/callback). Both empty = login off.
  clientSecret: process.env.DISCORD_CLIENT_SECRET || undefined,
  publicUrl: (process.env.WEB_PUBLIC_URL || '').replace(/\/+$/, '') || undefined,
  /** The Discord channel linked to the web town's chat (optional; needs the Message Content intent). */
  townChatChannelId: process.env.TOWN_CHAT_CHANNEL_ID || undefined,
  // Write-only Object Storage URL for off-server backup copies (src/db/offsite.ts). Empty = local backups only.
  backupUploadUrl: process.env.BACKUP_UPLOAD_URL || undefined,
};
