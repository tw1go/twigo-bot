import 'dotenv/config';

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
};
