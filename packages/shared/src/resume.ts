// 🧭 The resume spot (CONTEXT.md Resume spot): a fresh visit (a new tab, the app opened again, the next day) starts where
// the player last was, by area. The bot keeps the last area a member arrived in (web/last-area.ts, schema v25) and
// sends it with /me; the page picks the start from it (BootScene.route). Pure, so the bot's tests cover both sides.

/** The areas a start goes by: the town and the neighbourhood are one ('hood'), a Scrap Warrens run 'warrens', any floor
 *  of an Ang Silong run 'silong'. */
export type ResumeArea = 'hood' | 'slums' | 'palengke' | 'warrens' | 'silong';

/** The resume area a town room is in (the room a member joined: 'town', 'hood', 'slums', 'palengke', 'warrens:<id>',
 *  'silong:<id>:<floor>'), or null for one that isn't kept. */
export function resumeAreaOf(room: string): ResumeArea | null {
  if (room === 'town' || room === 'hood') return 'hood';
  if (room === 'slums' || room === 'palengke') return room;
  if (room.startsWith('warrens:')) return 'warrens';
  if (room.startsWith('silong:')) return 'silong';
  return null;
}

/** Where a fresh visit starts: an area, and (out of a dungeon) the way in it lands at, as walking out of it does. */
export interface ResumeStart {
  area: 'town' | 'hood' | 'slums' | 'palengke';
  from?: 'warrens' | 'silong-b1';
}

/**
 * A logged-in member's fresh visit, from their last area:
 *  • town or the neighbourhood: the neighbourhood (at their door); without a house, or with a guided quest under way
 *    (the guide's arrow and trail run in town and the Slums), the town;
 *  • the Slums: its way in from town (its spawn); the Old Market: its east gate (its spawn);
 *  • a Scrap Warrens run: the Slums, at the Warren Gate; an Ang Silong floor: the Old Market, by the Cellar Hatch;
 *  • the Old Market (or the Cellar) not open to them yet: the Slums.
 * Nothing kept (a new player, or the first visit since this came in): as before, the neighbourhood with a house, else
 * the town.
 */
export function resumeStart(o: { lastArea?: ResumeArea | null; house: boolean; guided: boolean; palengkeOpen: boolean }): ResumeStart {
  const home: ResumeStart = { area: o.house && !o.guided ? 'hood' : 'town' };
  switch (o.lastArea) {
    case 'slums':
      return { area: 'slums' };
    case 'palengke':
      return o.palengkeOpen ? { area: 'palengke' } : { area: 'slums' };
    case 'warrens':
      return { area: 'slums', from: 'warrens' };
    case 'silong':
      return o.palengkeOpen ? { area: 'palengke', from: 'silong-b1' } : { area: 'slums' };
    case 'hood':
      return home;
    default:
      return { area: o.house ? 'hood' : 'town' };
  }
}
