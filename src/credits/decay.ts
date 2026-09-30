import type { Client } from 'discord.js';
import { decayInactive } from './store.js';
import { kowen } from '../kowens.js';

/** Runs just after midnight (see scheduler). */
export async function runDecay(_client: Client): Promise<void> {
  const charged = decayInactive();
  if (charged.length) {
    const total = charged.reduce((sum, [, lost]) => sum + lost, 0);
    console.log(`[decay] ${charged.length} inactive member(s) lost ${total} ${kowen(total)}`);
  }
}
