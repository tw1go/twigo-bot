// 📊 The front page's numbers, read from the game's own data (the files it plays by), so the page never drifts from the
// game: class stat pairs and skill levels, mob levels, the field boss's timer, the dungeon's rules and areas, quest and
// mini boss counts, the wardrobe's sizes, and every sprite's cell (so each canvas is its size before its art loads).
// Pure: the page's build step (vite.config.ts frontPage) reads the files and hands them in.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export interface GameData {
  manifest: Json;
  stats: Json;
  classes: Json;
  leveling: Json;
  dungeons: Json;
  slums: Json;
  warrens: Json;
}

export interface ClassFacts {
  name: string;
  main: string;
  second: string;
  /** Damage skills by name → the level they unlock at. */
  skills: Record<string, number>;
}

export interface Facts {
  classes: Record<string, ClassFacts>;
  mobLevel: Record<string, number>;
  dungeon: { areas: { name: string; boss: string; last: boolean }[]; lastBoss: { name: string; title: string } };
  /** Filled into the content's `{name}` tokens. */
  tokens: Record<string, string | number>;
}

export function gameFacts(d: GameData): Facts {
  const list: Json[] = d.classes.classes ?? [];
  const classes: Record<string, ClassFacts> = {};
  for (const c of list) {
    const s = d.stats.classes?.[c.id] ?? {};
    classes[c.id] = { name: c.name, main: s.main ?? c.mainStat, second: s.second ?? c.secondStat, skills: Object.fromEntries((c.skills ?? []).map((k: Json) => [k.name, k.level])) };
  }
  const mobLevel: Record<string, number> = Object.fromEntries(Object.entries(d.stats.mobs?.list ?? {}).map(([id, m]: [string, Json]) => [id, m.level]));
  const first = list[0] ?? {};
  const mobility: Json[] = first.mobility ?? [];
  const W = d.dungeons.warrens;
  const mapAreas: Json[] = d.warrens.dungeon?.areas ?? [];
  const areas = (W.areas as Json[]).map((a) => ({ name: a.name, boss: a.miniBoss.name, last: false }));
  const hall = mapAreas[mapAreas.length - 1];
  areas.push({ name: hall?.name ?? 'Shanty Hall', boss: W.lastBoss.name, last: true });
  const quests: Json[] = d.leveling.quests ?? [];
  const wardrobe = d.manifest.characters.wardrobe;
  const skins = Object.keys(d.manifest.characters.skinTones).filter((k) => k !== 'keys' && k !== 'faceTweak');
  const boss = d.slums.boss ?? {};
  const partyMax = W.entry?.partyMax ?? 6;
  return {
    classes,
    mobLevel,
    dungeon: { areas, lastBoss: { name: W.lastBoss.name, title: W.lastBoss.title } },
    tokens: {
      skillCount: (first.skills ?? []).length,
      dashLevel: mobility[0]?.level ?? 5,
      moveLevel: mobility[1]?.level ?? 8,
      golemName: boss.name ?? 'Scrapheap Golem',
      golemLevel: boss.level ?? mobLevel['scrapheap-golem'],
      golemHours: Math.round(((boss.everyMinutes ?? 120) / 60) * 10) / 10,
      golemWarn: boss.warnMinutes ?? 5,
      dungeonLevel: W.entry?.minLevel ?? 15,
      dungeonMinutes: W.run?.timeLimitMinutes ?? 20,
      partyFriends: ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'][partyMax - 1] ?? String(partyMax - 1),
      questCount: quests.length,
      questTop: Math.max(...quests.map((q) => q.targetLevel ?? 0), 0),
      miniBosses: (d.slums.mobZones ?? []).reduce((n: number, z: Json) => n + (z.miniBosses?.length ?? 0), 0),
      skins: skins.length,
      hairs: (wardrobe.hair ?? []).length,
    },
  };
}

/** `{name}` tokens in a text filled from the facts (an unknown one stays as it is, so it shows up in review). */
export const fill = (text: string, tokens: Record<string, string | number>): string => text.replace(/\{(\w+)\}/g, (all, k: string) => (k in tokens ? String(tokens[k]) : all));
