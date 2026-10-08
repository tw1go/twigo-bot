// Shared between the bot (Node) and the web game (browser). Types, plus one pure module of code: the stats rules
// (stats.ts: levels, stats, gear requirements, skills, damage, XP; items.ts: item rolls, names, bags; forge.ts: enhancing, repairs, agimats, disassembly, weapon auras; trade.ts: what can be traded; leveling.ts: the Tanod's leveling quests and the mini bosses). Keep this package free of Node or browser APIs so
// both sides can import it.
export type * from './room-api.js';
export type * from './town.js';
export type * from './adventure.js';
export * from './stats.js';
export * from './items.js';
export * from './forge.js';
export * from './trade.js';
export * from './leveling.js';
