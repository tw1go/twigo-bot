// Classes, quests and equipment: the shapes of the game's data files (classes/classes.json, quests/quests.json,
// items/equipment.json under the game's public/assets/, read by the bot too) and of each member's saved state.

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
}

export interface ClassesFile {
  classes: ClassInfo[];
}

export type QuestType = 'main' | 'side';

/** An objective: talk (to `npc`) or chooseClass so far; more types (visit, collect, defeat…) can be added. */
export interface QuestObjectiveDef {
  id: string;
  type: string;
  text: string;
  npc?: string;
}

export interface QuestDef {
  id: string;
  type: QuestType;
  title: string;
  /** The NPC who gives it (world/npcs.ts id). */
  giver: string;
  summary: string;
  autoStart?: boolean;
  objectives: QuestObjectiveDef[];
  /** The giver's lines while it's on: talk (in order), remind, complete ({class} = the chosen class's name). */
  dialogue?: { talk?: string[]; remind?: string[]; complete?: string[] };
  next: string | null;
}

export interface QuestsFile {
  quests: QuestDef[];
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

/** items/equipment.json: an item that goes in an equipment slot. Usable by one class (`class`) or a gear type (`gear`). */
export interface EquipmentDef {
  id: string;
  name: string;
  slot: EquipSlot;
  class?: string;
  gear?: string;
  level: number;
  rarity: string;
  stats: EquipStats;
  /** Fields whose numbers are stand-ins for now. */
  placeholder?: string[];
  /** Given by a quest: can't be dropped, traded or sold. */
  starter?: boolean;
  /** 16x16, 32x32 and 64x64 art. */
  icon: string;
  showcase: string;
  large?: string;
}

export interface EquipmentFile {
  items: EquipmentDef[];
}

/** A quest under way: which objective is current (an index into its objectives). */
export interface QuestProgress {
  id: string;
  step: number;
}

/** A member's class, quests and equipment (bot web/adventure.ts; in /me as `adventure`). */
export interface AdventureState {
  cls: string | null;
  quests: { active: QuestProgress[]; done: string[] };
  /** What's worn in each place (item ids). */
  equipped: Partial<Record<EquipPlace, string>>;
  /** Equipment in the bag, not worn (item ids, one slot each). */
  bag: string[];
}

/** POST /town/quest: an objective done in the game (talked to `npc`, or chose `cls`). */
export type TownQuestAction = { quest: string; action: 'talk'; npc: string } | { quest: string; action: 'chooseClass'; cls: string };

/** POST /town/equip: wear an item from the bag (in `place`, or the first free place for its kind, else the first one; what
 *  was there goes back to the bag), or take one off (needs a free bag slot). */
export type TownEquipAction = { action: 'equip'; item: string; place?: EquipPlace } | { action: 'unequip'; place: EquipPlace };

export interface TownAdventureResponse {
  ok: boolean;
  message?: string;
  adventure: AdventureState;
  /** An item just given (the class's training weapon), for the "Received" toast. */
  given?: string;
  /** A quest just completed. */
  completed?: string;
}
