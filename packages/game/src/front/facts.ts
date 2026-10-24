// 📊 The front page's numbers, read from the game's own data (the files it plays by), so the page never drifts from the
// game: class stat pairs and skill levels, mob levels, the field bosses' timers, the party size, quest and mini boss
// counts, the wardrobe's sizes, and every sprite's cell (so each canvas is its size before its art loads).
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
  palengke: Json;
  palengkeLeveling: Json;
  halloween: Json;
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
  /** When the Halloween event ends (ms), for its Town life card (gone from builds after it). */
  halloweenEnds: number;
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
  const quests: Json[] = d.leveling.quests ?? [];
  const wardrobe = d.manifest.characters.wardrobe;
  const skins = Object.keys(d.manifest.characters.skinTones).filter((k) => k !== 'keys' && k !== 'faceTweak');
  const boss = d.slums.boss ?? {};
  const partyMax = W.entry?.partyMax ?? 6;
  const scale = d.palengke.boss ?? {};
  const marketQuests: Json[] = d.palengkeLeveling.quests ?? [];
  const friends = (n: number) => ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'][n - 1] ?? String(n - 1);
  return {
    classes,
    mobLevel,
    halloweenEnds: Date.parse(d.halloween.endsAt ?? '') || 0,
    tokens: {
      skillCount: (first.skills ?? []).length,
      dashLevel: mobility[0]?.level ?? 5,
      moveLevel: mobility[1]?.level ?? 8,
      golemName: boss.name ?? 'Scrapheap Golem',
      golemLevel: boss.level ?? mobLevel['scrapheap-golem'],
      golemHours: Math.round(((boss.everyMinutes ?? 120) / 60) * 10) / 10,
      golemWarn: boss.warnMinutes ?? 5,
      partyMax,
      partyFriends: friends(partyMax),
      levelCap: d.stats.levelCap ?? 40,
      marketFrom: Math.min(...(d.palengke.mobZones ?? []).map((z: Json) => z.level ?? 99)),
      marketQuests: marketQuests.length,
      scaleName: scale.name ?? 'The Great Scale',
      scaleLevel: scale.level ?? mobLevel['great-scale'],
      scaleHours: Math.round(((scale.everyMinutes ?? 120) / 60) * 10) / 10,
      scaleWarn: scale.warnMinutes ?? 5,
      petCount: Object.keys(d.stats.pets?.list ?? {}).length,
      halloweenEnds: d.halloween.endsAt ? new Date(d.halloween.endsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' }) : '',
      questCount: quests.length,
      questTop: Math.max(...quests.map((q) => q.targetLevel ?? 0), 0),
      miniBosses: [d.slums, d.palengke].reduce((n: number, m: Json) => n + (m.mobZones ?? []).reduce((k: number, z: Json) => k + (z.miniBosses?.length ?? 0), 0), 0),
      skins: skins.length,
      hairs: (wardrobe.hair ?? []).length,
    },
  };
}

/** `{name}` tokens in a text filled from the facts (an unknown one stays as it is, so it shows up in review). */
export const fill = (text: string, tokens: Record<string, string | number>): string => text.replace(/\{(\w+)\}/g, (all, k: string) => (k in tokens ? String(tokens[k]) : all));
