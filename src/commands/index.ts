import { Collection } from 'discord.js';
import type { Command } from '../types.js';
import { balanceCommand } from './balance.js';
import { claim } from './claim.js';
import { gamble } from './gamble.js';
import { getCredits } from './get-credits.js';
import { gift } from './gift.js';
import { give } from './give.js';
import { jackpot } from './jackpot.js';
import { jail } from './jail.js';
import { dig } from './dig.js';
import { diss, judge, praise } from './judge.js';
import { inventory } from './inventory.js';
import { sell } from './sell.js';
import { leaderboard } from './leaderboard.js';
import { ping } from './ping.js';
import { redeem } from './redeem.js';
import { request } from './request.js';
import { steal } from './steal.js';
import { twigo } from './twigo.js';
import { twigoHelp } from './twigo-help.js';

// Register new commands here.
const all: Command[] = [ping, twigo, twigoHelp, diss, praise, judge, getCredits, balanceCommand, gamble, steal, jackpot, leaderboard, jail, redeem, gift, give, dig, inventory, sell, request, claim];

export const commands = new Collection<string, Command>(all.map((c) => [c.data.name, c]));
