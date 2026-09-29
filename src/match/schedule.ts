// All times are cron patterns in config.timezone. 6 = Saturday.
export const MATCH_NAME = 'Ancient Battlefield';

export const schedule = {
  askAdmin: '30 12 * * 6', // Sat 12:30 PM — ask admins if there's a match
  closePoll: '0 18 * * 6', // Sat 6:00 PM — close poll, post participants
  remind: '45 19 * * 6', // Sat 7:45 PM — ping participants
  start: '0 20 * * 6', // Sat 8:00 PM — ping participants: time to brawl
};

export const MATCH_TIME_LABEL = '8:00 PM';
export const POLL_CLOSE_LABEL = '6:00 PM';
