import { Collection } from 'discord.js';
import type { Command } from '../types.js';
import { gamble } from './gamble.js';
import { getCredits } from './get-credits.js';
import { jackpot } from './jackpot.js';
import { jail } from './jail.js';
import { diss, judge, praise } from './judge.js';
import { leaderboard } from './leaderboard.js';
import { ping } from './ping.js';
import { redeem } from './redeem.js';
import { steal } from './steal.js';
import { twigo } from './twigo.js';
import { twigoHelp } from './twigo-help.js';

// Register new commands here.
const all: Command[] = [ping, twigo, twigoHelp, diss, praise, judge, getCredits, gamble, steal, jackpot, leaderboard, jail, redeem];

export const commands = new Collection<string, Command>(all.map((c) => [c.data.name, c]));
