// Shared between the bot (Node) and the web game (browser). Types, plus one pure module of code: the stats rules
// (stats.ts: levels, stats, gear requirements, skills, damage, XP; items.ts: item rolls, names, bags; forge.ts: enhancing, repairs, agimats, disassembly, weapon auras; trade.ts: what can be traded; leveling.ts: the Tanod's leveling quests and the mini bosses; quests.ts: offered quests and item objectives; dungeons.ts: the Scrap Warrens' data and party scaling; travel.ts: Lantern Posts; pets.ts: pets, their levels and pet tree; mail.ts: mail and its attachments). Keep this package free of Node or browser APIs so
// both sides can import it.
export type * from './room-api.js';
export type * from './town.js';
export type * from './adventure.js';
export * from './stats.js';
export * from './skill-effects.js';
export * from './items.js';
export * from './forge.js';
export * from './trade.js';
export * from './leveling.js';
export * from './quests.js';
export * from './dungeons.js';
export * from './silong.js';
export * from './travel.js';
export * from './loot-roll.js';
export * from './cascade.js';
export * from './palengke.js';
export * from './friends.js';
export * from './events.js';
export * from './cosmetics.js';
export * from './cosmetic-shop.js';
export * from './pets.js';
export * from './mail.js';
