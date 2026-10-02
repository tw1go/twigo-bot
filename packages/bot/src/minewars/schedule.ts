// Cron patterns in config.timezone. Mine Wars alerts daily at 12 PM and 9 PM.
export const MINE_WARS_NAME = 'Mine Wars';

export const schedule = {
  warning: '55 11,20 * * *', // 5 minutes before each start
  start: '0 12,21 * * *',
};
