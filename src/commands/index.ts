import { Collection } from 'discord.js';
import type { Command } from '../types.js';
import { getCredits } from './get-credits.js';
import { diss, judge, praise } from './judge.js';
import { ping } from './ping.js';
import { twigo } from './twigo.js';
import { twigoHelp } from './twigo-help.js';

// Register new commands here.
const all: Command[] = [ping, twigo, twigoHelp, diss, praise, judge, getCredits];

export const commands = new Collection<string, Command>(all.map((c) => [c.data.name, c]));
