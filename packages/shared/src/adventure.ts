// Classes, quests and equipment: the shapes of the game's data files (classes/classes.json, quests/quests.json,
// items/equipment.json under the game's public/assets/, read by the bot too) and of each member's saved state.

import type { Item } from './items.js';
import type { StatName, StatPoints } from './stats.js';

/** classes/classes.json */
export interface ClassInfo {
  id: string;
  name: string;
  weapon: string;
  role: string;
  damage: string;
  mainStat: string;
  secondStat: string | null;
  /** Gear type (combat-guide.md): Heavy, Light or Household. */
  gear: string;
  blurb: string;
  poses: string;
  fx: string;
  fxNotes: string;
  resting: string;
  skills: { level: number; name: string; desc: string }[];
  /** The two movement skills: Dash and the class's Lv 8 move (`id` names the move: TownMove). */
  mobility?: { id: string; level: number; name: string; desc: string }[];
  /** The class's buffs (name, unlock level; stats.json skills.mpCost.buffs by name). All play its `buff-cast` anim; not
   *  castable yet, only shown in the skill preview. */
  buffs?: { name: string; level: number; effect?: string; minutes?: number; permanent?: boolean }[];
}

export interface ClassesFile {
  classes: ClassInfo[];
}

export type QuestType = 'main' | 'side';

/** An objective: talk (to `npc`), chooseClass, kill (`count` of `mob`; its mini bosses don't count) or miniBoss (one
 *  of `mob`'s mini bosses). Kill and miniBoss are reported to the giver when reached (the tracker's Report). */
export interface QuestObjectiveDef {
  id: string;
  type: string;
  text: string;
  npc?: string;
  mob?: string;
  count?: number;
}

export interface QuestDef {
  id: string;
  type: QuestType;
  title: string;
  /** The NPC who gives it (world/npcs.ts id). */
  giver: string;
  summary: string;
  /** The brief storyline the quest log shows: what's going on and why it matters. */
  story?: string;
  autoStart?: boolean;
  objectives: QuestObjectiveDef[];
  /** The giver's lines while it's on: talk (in order), remind, complete ({class} = the chosen class's name); give (as
   *  it starts) and report (as it's reported over the radio): the leveling chain's. */
  dialogue?: { talk?: string[]; remind?: string[]; complete?: string[]; give?: string[]; report?: string[] };
  /** Given into the combat bag when it's completed (items/items.json kinds). */
  rewards?: QuestReward[];
  /** XP and Kusing given when it's completed (the leveling chain's: the same for everyone). */
  rewardXP?: number;
  rewardKusing?: number;
  next: string | null;
}

/** A quest's reward: `count` of an item kind (items/items.json or equipment.json id). */
export interface QuestReward {
  item: string;
  count: number;
}

export interface QuestsFile {
  /** (The leveling chain's entries are filled in from classes/leveling.json: @mikazuki/shared withLeveling.) */
  quests: import('./leveling.js').QuestFileEntry[];
}

/** The kinds of equipment (an item's slot; in the order of ui.equipSlots' silhouettes). */
export type EquipSlot = 'weapon' | 'head' | 'body' | 'hands' | 'bottoms' | 'feet' | 'necklace' | 'earrings' | 'bracers' | 'ring';

/** Where equipment is worn: one place per kind, but two for bracers and two for rings. The panel shows Weapon, Head,
 *  Body, Hands, Bottoms and Feet on the left; Necklace, Earrings, both Bracers and both Rings on the right. */
export type EquipPlace = Exclude<EquipSlot, 'bracers' | 'ring'> | 'bracers1' | 'bracers2' | 'ring1' | 'ring2';

export interface EquipStats {
  atk?: number;
  def?: number;
  hp?: number;
  mp?: number;
  str?: number;
  dex?: number;
  int?: number;
  crit?: number;
}

/** An item's rarity (classes/stats.json `rarity`): its name's colour, which says its affix and agimat slots. */
export type GearRarity = 'brown' | 'white' | 'grey' | 'lightBlue' | 'darkBlue' | 'lightOrange' | 'darkOrange';

/** items/equipment.json: an item that goes in an equipment slot. Who can wear it comes from its level and its class (a
 *  weapon) or gear type (armor), by the stats rules' requirements (stats.ts `requirements`). */
export interface EquipmentDef {
  id: string;
  name: string;
  slot: EquipSlot;
  /** A weapon's class. */
  class?: string;
  /** An armor piece's gear type: Heavy, Light or Household. */
  gear?: string;
  /** Its item level. */
  level: number;
  rarity: GearRarity;
  /** Can't be traded. */
  bound: boolean;
  /** The Tanod's training gear (bound, and never dropped, sold, enhanced or disassembled). */
  training?: boolean;
  /** The agimats set in it (none yet). */
  agimats: string[];
  /** Its own base and extras (training gear); others' base comes from stats.json gearBase by their level. */
  stats: EquipStats;
  /** Fields whose numbers are stand-ins for now. */
  placeholder?: string[];
  /** 16x16, 32x32 and 64x64 art; until it's drawn, the slot's empty silhouette stands in. */
  icon?: string;
  showcase?: string;
  large?: string;
}

export interface EquipmentFile {
  items: EquipmentDef[];
}

/** A quest under way: which objective is current (an index into its objectives). */
export interface QuestProgress {
  id: string;
  step: number;
  /** How many so far of the current objective's count (kill, miniBoss). */
  count?: number;
}

/** A character's level, XP and points (bot web/progress.ts, by the stats rules; saved with the class). Only `level`,
 *  `xp`, `points`, `skills` and `skillPoints` are kept: `next` and `statPoints` come from them. */
export interface CharacterProgress {
  /** 1 … the level cap (stats.json levelCap). */
  level: number;
  /** XP into this level (0 at the cap). */
  xp: number;
  /** XP this level takes to the next; 0 at the cap (MAX: XP stops). */
  next: number;
  /** Stat points spent, per stat (only the class's main and second stat take them). */
  points: StatPoints;
  /** Stat points earned and not spent (banked before a class). */
  statPoints: number;
  /** Skill levels above Lv 1, by skill: a damage skill by its place in the class's order ('0'…'6'), a mobility move by
   *  its id ('dash'). Left out: Lv 1 (or not unlocked yet). */
  skills: Record<string, number>;
  /** Skill points not spent (three a level-up; banked before a class). */
  skillPoints: number;
}

/** A member's class, quests, equipment and level (bot web/adventure.ts; in /me as `adventure`). */
export interface AdventureState {
  cls: string | null;
  /** `rewarded`: done quests whose rewards have been given (one finished before it had rewards gets them on a later
   *  visit, as does one whose rewards had no room). */
  quests: { active: QuestProgress[]; done: string[]; rewarded?: string[] };
  /** What's worn in each place. */
  equipped: Partial<Record<EquipPlace, Item>>;
  /** The combat bag (stats.json inventory.slots): gear not worn, whetstones, fragments, Repair Kits, agimats, HP/MP
   *  Potions and cosmetics, one slot each (a stack in one). */
  bag: Item[];
  /** Kusing, the money mobs drop. */
  kusing: number;
  progress: CharacterProgress;
  /** The Tanod's training armor set has been given (once, with the class or on a later login). */
  trainingArmorGiven: boolean;
}

/** POST /town/quest: an objective done in the game (talked to `npc`, or chose `cls`). */
export type TownQuestAction = { quest: string; action: 'talk'; npc: string } | { quest: string; action: 'chooseClass'; cls: string } | { quest: string; action: 'report' };

/** POST /town/equip: wear an item from the combat bag (by uid; in `place`, or the first free place for its kind, else the
 *  first one; what was there goes back to the bag), or take one off (needs a free bag slot). */
export type TownEquipAction = { action: 'equip'; item: string; place?: EquipPlace } | { action: 'unequip'; place: EquipPlace };

/** POST /town/points: one stat point into the class's main or second stat, or every stat point back (free). */
export type TownPointsAction = { action: 'spend'; stat: StatName } | { action: 'reset' };

/** POST /town/skills: one skill point into a skill (its key: a damage skill's place '0'…'6', or a move's id), or every
 *  skill point back (free). */
export type TownSkillsAction = { action: 'raise'; skill: string } | { action: 'reset' };

export interface TownAdventureResponse {
  ok: boolean;
  message?: string;
  adventure: AdventureState;
  /** An item just given (the class's training weapon: its kind), for the "Received" toast. */
  given?: string;
  /** The training armor just given with it (kinds), for the "Received: Training gear" toast. */
  gear?: string[];
  /** A quest just completed. */
  completed?: string;
  /** Its rewards, just given. */
  rewards?: QuestReward[];
  /** Its XP and Kusing, just given (a report). */
  xp?: number;
  kusing?: number;
}
