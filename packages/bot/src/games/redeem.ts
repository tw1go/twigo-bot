import type { MessageMentionOptions } from 'discord.js';
import { config } from '../config.js';
import { kowen } from '../kowens.js';
import { addFence, balance, fencedUntil, giveVault, hasVault, take } from '../credits/store.js';
import { SHOVELS_PER_DAY, addBag, addMasterKey, addShovel, capacity, ownedBags, shovelsBoughtToday } from '../dig/store.js';
import { debtOf } from '../loans/loans.js';
import { POTIONS, addPotions, hintsLeft, type PotionId } from '../potions/potions.js';
import { FENCE_DAYS, FENCE_MAX_DAYS, GAME_NAME, type Reward, recordRedemption } from './rewards.js';
import { feed } from '../web/town-feed.js';
import { freeSlots } from '../dig/bag.js';
import { addMegaphones, megaphones } from '../items/megaphone.js';
import { addRenameCards, renameCards } from '../items/rename-card.js';

// 🎁 Redeeming a reward, shared by /redeem and the town's rewards shop: every check, then the purchase. Each caller
// words the outcome its own way (Discord markdown, or plain town text).

export type { Reward };

/** Rewards that can be bought several at a time. */
export const stackable = (r: Reward) => r.kind === 'shovel' || r.kind === 'key' || r.kind === 'potion' || r.kind === 'megaphone' || r.kind === 'rename';

/** Rewards kept in the bag: one slot each (megaphones all share one, and so do Rename Cards). */
export const inBag = (r: Reward) => r.kind === 'key' || r.kind === 'potion' || r.kind === 'megaphone' || r.kind === 'rename';

const fmt = (n: number) => n.toLocaleString('en-US');

export type RedeemResult =
  | { ok: false; reward: Reward; reason: 'quantity' | 'loan' | 'owned' | 'shovels-today' | 'marites' | 'testers' }
  | { ok: false; reward: Reward; reason: 'kowens'; quantity: number; total: number; have: number; canAfford: number }
  | { ok: false; reward: Reward; reason: 'fence-max'; until: number }
  | { ok: false; reward: Reward; reason: 'bag-full'; free: number }
  | {
      ok: true;
      reward: Reward;
      quantity: number;
      asked: number;
      total: number;
      /** What the member has now: potions of that kind, Master Keys, megaphones, digs on the shovel, inventory slots, Bakod end. */
      potions?: number;
      keys?: number;
      megaphones?: number;
      renameCards?: number;
      uses?: number;
      slots?: number;
      fenceUntil?: number;
    };

/** Whether the member already owns this one-time reward (the vault, a bag). */
export const owns = (userId: string, r: Reward) =>
  (r.kind === 'vault' && hasVault(userId)) || (r.kind === 'bag' && ownedBags(userId).includes(r.id));

/** Shovels the member can still buy today. */
export const shovelsLeftToday = (userId: string) => Math.max(0, SHOVELS_PER_DAY - shovelsBoughtToday(userId));

/** `tester`: whether they have the Tester role (games/testers.ts): passes are for testers only. */
export function redeemReward(userId: string, reward: Reward, asked: number, tester: boolean): RedeemResult {
  const have = balance(userId);
  if (asked > 1 && !stackable(reward)) return { ok: false, reward, reason: 'quantity' };
  if (reward.kind === 'pass' && !tester) return { ok: false, reward, reason: 'testers' };
  if (reward.kind === 'pass' && debtOf(userId)) return { ok: false, reward, reason: 'loan' };
  if (owns(userId, reward)) return { ok: false, reward, reason: 'owned' };

  // How many can actually be bought: Shovels are limited per day.
  let quantity = asked;
  if (reward.kind === 'shovel') {
    const left = shovelsLeftToday(userId);
    if (left <= 0) return { ok: false, reward, reason: 'shovels-today' };
    quantity = Math.min(asked, left);
  }
  // Master Keys and potions are held in the bag, one slot each; megaphones share one slot (needed only for the first).
  const slots = reward.kind === 'megaphone' ? (megaphones(userId) ? 0 : 1) : reward.kind === 'rename' ? (renameCards(userId) ? 0 : 1) : quantity;
  if (inBag(reward) && freeSlots(userId) < slots) return { ok: false, reward, reason: 'bag-full', free: freeSlots(userId) };
  const total = reward.cost * quantity;
  if (have < total) return { ok: false, reward, reason: 'kowens', quantity, total, have, canAfford: Math.floor(have / reward.cost) };

  const done = { ok: true as const, reward, quantity, asked, total };
  switch (reward.kind) {
    case 'potion': {
      const pid = reward.id.replace('potion-', '') as PotionId;
      if (pid === 'marites' && hintsLeft(userId) <= 0) return { ok: false, reward, reason: 'marites' };
      take(userId, total);
      return { ...done, potions: addPotions(userId, pid, quantity) };
    }
    case 'vault':
      take(userId, total);
      giveVault(userId);
      return done;
    case 'key': {
      take(userId, total);
      let keys = 0;
      for (let i = 0; i < quantity; i++) keys = addMasterKey(userId);
      return { ...done, keys };
    }
    case 'megaphone':
      take(userId, total);
      return { ...done, megaphones: addMegaphones(userId, quantity) };
    case 'rename':
      take(userId, total);
      return { ...done, renameCards: addRenameCards(userId, quantity) };
    case 'shovel': {
      take(userId, total);
      let uses = 0;
      for (let i = 0; i < quantity; i++) uses = addShovel(userId);
      return { ...done, uses };
    }
    case 'bag':
      take(userId, total);
      addBag(userId, reward.id);
      return { ...done, slots: capacity(userId) };
    case 'fence': {
      const current = fencedUntil(userId);
      if (current && current - Date.now() > (FENCE_MAX_DAYS - FENCE_DAYS) * 86_400_000) return { ok: false, reward, reason: 'fence-max', until: current };
      take(userId, total);
      return { ...done, fenceUntil: addFence(userId, FENCE_DAYS * 86_400_000, FENCE_MAX_DAYS * 86_400_000) };
    }
    case 'pass':
      take(userId, total);
      recordRedemption(userId, reward.id, reward.cost);
      console.log(`[redeem] ${userId} redeemed ${reward.id} for ${reward.cost}`);
      return done;
  }
}

/** What a potion does, for the shop. */
export const potionEffect = (r: Reward) => POTIONS[r.id.replace('potion-', '') as PotionId].effect;

/** The public Discord message for a redemption (passes ping the reward owner, who sends them by hand). */
export function redeemPost(userId: string, result: Extract<RedeemResult, { ok: true }>): { content: string; allowedMentions: MessageMentionOptions } {
  const { reward, quantity, asked } = result;
  const who = `<@${userId}>`;
  const pub = (content: string) => ({ content, allowedMentions: { parse: [] as [] } });
  switch (reward.kind) {
    case 'potion':
      return pub(`${reward.emoji} ${who} bought ${quantity > 1 ? `**${quantity}× ${reward.name}**` : `a **${reward.name}**`}!\n-# ${potionEffect(reward)}. Use it with \`/potion use\` (you have ${result.potions}).`);
    case 'vault':
      return pub(`🔐 ${who} bought a **Vault**! Kowens inside are safe from thieves 🥷 and don't raise your bail 💸\n-# Store up to 30% of your Kowens with \`/vault deposit\`.`);
    case 'key': {
      const keys = result.keys!;
      return pub(`🗝️ ${who} bought ${quantity > 1 ? `**${quantity} Master Keys**` : 'a **Master Key**'}… no Bakod is safe now 👀\n-# You have ${keys} key${keys === 1 ? '' : 's'}. A key is only used when you /steal from someone with a Bakod (50% to break in).`);
    }
    case 'megaphone': {
      const n = result.megaphones!;
      return pub(`📢 ${who} bought ${quantity > 1 ? `**${quantity} Megaphones**` : 'a **Megaphone**'}! Time to make some noise in town.\n-# You have ${n}. In the town's chat, \`/m your message\` runs it across everyone's screen.`);
    }
    case 'rename': {
      const n = result.renameCards!;
      return pub(`🪪 ${who} bought ${quantity > 1 ? `**${quantity} Rename Cards**` : 'a **Rename Card**'}! A new name is coming 👀\n-# You have ${n}. Use one from your bag in the web town to change your nickname.`);
    }
    case 'shovel': {
      const uses = result.uses!;
      const capped = quantity < asked ? ` (you asked for ${asked}, but only ${quantity} more ${quantity === 1 ? 'was' : 'were'} available today)` : '';
      return pub(`🪏 ${who} bought ${quantity > 1 ? `**${quantity} Shovels**` : 'a **Shovel**'}${capped}! Time to \`/dig\` for treasure ⛏️\n-# ${uses} dig${uses === 1 ? '' : 's'} on your shovel · ${shovelsLeftToday(userId)} more shovel(s) available today.`);
    }
    case 'bag':
      return pub(`${reward.emoji} ${who} got a **${reward.name}**! Inventory is now **${result.slots}** slots. 🎒`);
    case 'fence':
      return pub(`🧱 ${who} built a **Bakod**! Nobody can steal from them until <t:${Math.floor(result.fenceUntil! / 1000)}:f>. 🛡️`);
    case 'pass':
      return {
        content: `🎉 ${who} redeemed the ${reward.emoji} **${GAME_NAME} ${reward.name}** for **${fmt(reward.cost)}** ${kowen(reward.cost)}!\n<@${config.rewardOwnerId}> — please send it over. 🫡`,
        allowedMentions: { users: [config.rewardOwnerId] },
      };
  }
}

/** The town's feed line for a redemption (passes in gold). */
export function redeemFeed(name: string, result: Extract<RedeemResult, { ok: true }>): void {
  const n = result.quantity;
  feed('shop', `${name} bought ${n > 1 ? `${n}× ` : 'a '}${result.reward.name}`, result.reward.kind === 'pass' ? 'legendary' : 'shop');
}
