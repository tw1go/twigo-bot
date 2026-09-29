import { config } from './config.js';

/** Today's date as YYYY-MM-DD in config.timezone. */
export function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(new Date());
}
