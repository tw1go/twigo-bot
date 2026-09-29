import { Collection } from 'discord.js';
import type { Command } from '../types.js';
import { diss } from './diss.js';
import { ping } from './ping.js';
import { twigo } from './twigo.js';

// Register new commands here.
const all: Command[] = [ping, twigo, diss];

export const commands = new Collection<string, Command>(all.map((c) => [c.data.name, c]));
