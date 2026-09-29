// Cron patterns in config.timezone. Mine Wars runs daily at 12 PM, 3 PM, 6 PM, 9 PM.
export const MINE_WARS_NAME = 'Mine Wars';

export const schedule = {
  warning: '55 11,14,17,20 * * *', // 5 minutes before each start
  start: '0 12,15,18,21 * * *',
};
