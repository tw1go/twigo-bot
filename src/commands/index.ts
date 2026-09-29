import { Collection } from 'discord.js';
import type { Command } from '../types.js';
import { diss } from './diss.js';
import { getCredits } from './get-credits.js';
import { ping } from './ping.js';
import { praise } from './praise.js';
import { twigo } from './twigo.js';

// Register new commands here.
const all: Command[] = [ping, twigo, diss, praise, getCredits];

export const commands = new Collection<string, Command>(all.map((c) => [c.data.name, c]));
