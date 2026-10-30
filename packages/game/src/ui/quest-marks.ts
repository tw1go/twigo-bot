import { type QuestDef, type QuestObjectiveDef, objectiveCount, readyToReport } from '@mikazuki/shared';
import { adventure, heldOf, offeredNow, questDef, questItemMob } from '../net/adventure';
import { NPC_PLACES } from '../world/npcs';
import { type MapNpc, type MapZone, type SlumsPlaces, type WorldMap, worldPoint } from './world-map';

// 🎯 Quest marks: where an active quest sends you, on the world map's picture (the quest map, ui/quest-map.ts, and the
// Map menu, ui/map-menu.ts) and on the minimap (ui/minimap.ts, the map you're on), in the quest's colour (violet main,
// yellow side; a zone or an NPC two quests share is drawn once, main's):
//   • a hunt (kill, mini boss, or a quest item a mob drops: the Old Market's collects; one ready to report shows nothing)
//     on its mob's zone in the Slums or the Old Market: kill / collect the zone as a diamond, filled at 25% with a dashed
//     1 px edge marching slowly, a kill pin at its middle and under it the zone's name with the count ("Tin Can Alley ·
//     12/20", "Vegetable Row · Fresh Onions 4/10", "Dry Goods · 12/20 · Clean Rice Scoops 4/10"); mini boss: the diamond
//     faintly (12%), a mini boss pin on each of its mini boss spots;
//   • a field boss (the Great Scale's fight and its bell): a mini boss pin on its tile, its name under it;
//   • an NPC to talk to or bring something to (the Tanod, Aling Nena, Aling Conching, Mang Pido, Tisay, Kuya Jun…; an
//     offered quest's giver too): the head marker's own sign ("!" to talk, "…" waiting on you) in a round badge on
//     their spot, their name under it. The town's NPCs where they live (world/npcs.ts), the Old Market's by its map (Tisay
//     at her new stall once The Note is done);
//   • visit (the Tanod's The Market Up North): a pin on the Slums' gate to its map, "To the Old Market" under it.
// Pins (manifest guide.pin: 13 × 18, kill 0–1, mini boss 2–3, 3 fps, anchored at (6, 17)); nothing else moves.

export interface QuestMarkArt {
  /** The pins' sheet by the quest's type. */
  pin: (type: QuestDef['type']) => string;
  pinFrame: [number, number];
  pinAnchor: [number, number];
  colours: { main: string; side: string };
  /** A town NPC's name (npc-dialogue.json); the Old Market's come with its map. */
  npcName?: (id: string) => string | undefined;
}

/** The maps quest marks go on. */
export type QuestArea = 'town' | 'slums' | 'palengke';
const AREAS: QuestArea[] = ['slums', 'palengke', 'town'];

/** A hunt's mark: a zone (kill, collect, mini boss) or a field boss's tile. */
export interface QuestMark {
  map: QuestArea;
  kind: 'kill' | 'miniBoss' | 'boss';
  type: QuestDef['type'];
  zone?: MapZone;
  /** A field boss's tile. */
  tile?: [number, number];
  /** What's written under it ("Tin Can Alley · 12/20"). */
  text: string;
}

/** An NPC a quest needs: their spot and the head marker's sign. */
export interface NpcMark {
  kind: 'npc';
  map: QuestArea;
  type: QuestDef['type'];
  npc: string;
  name: string;
  tile: [number, number];
  symbol: string;
}

/** A visit's mark: the Slums' gate to its map (a tile), and the map's name. */
export interface VisitMark {
  kind: 'visit';
  type: QuestDef['type'];
  tile: [number, number];
  to: string;
}

/** What each map says about where things are (its zones, its field boss, its NPCs), by map. */
export type QuestPlaces = (map: QuestArea) => SlumsPlaces | undefined;

/** The town's NPCs where they live (they wander a little round it; the Tanod patrols from it). */
const TOWN_NPCS: MapNpc[] = NPC_PLACES.map((p) => ({ id: p.id, tile: p.home }));

/** The world map's places by map. */
export const placesIn =
  (w: WorldMap): QuestPlaces =>
  (map) =>
    map === 'town' ? { ...w.town, npcs: TOWN_NPCS } : map === 'slums' ? w.slums : w.palengke;

/** One map's places (the minimap's: the map you're on), the town's NPCs added in the town. */
export const placesOn =
  (area: string, places: SlumsPlaces): QuestPlaces =>
  (map) =>
    map !== area ? undefined : map === 'town' ? { ...places, npcs: TOWN_NPCS } : places;

/** The maps a visit can lead to, by area id. */
const AREA_NAMES: Record<string, string> = { palengke: 'the Old Market' };

const mainFirst = <T extends { type: QuestDef['type'] }>(list: T[]): T[] => list.sort((a, b) => (a.type === b.type ? 0 : a.type === 'main' ? -1 : 1));

/** The active quests with their current objective (main's first); `ready`: done, to be reported by radio. */
export function currentObjectives(): { q: QuestDef; o: QuestObjectiveDef; count: number; ready: boolean }[] {
  const s = adventure();
  if (!s) return [];
  const out: { q: QuestDef; o: QuestObjectiveDef; count: number; ready: boolean; type: QuestDef['type'] }[] = [];
  for (const p of s.quests.active) {
    const q = questDef(p.id);
    const o = q?.objectives[p.step];
    if (q && o) out.push({ q, o, count: p.count ?? 0, ready: readyToReport(q, p), type: q.type });
  }
  return mainFirst(out);
}

/** The active quests' visits not yet made whose map the Slums has a gate to: a mark on that gate (main's first). */
export function visitMarks(world: WorldMap): VisitMark[] {
  const out: VisitMark[] = [];
  for (const { q, o, ready } of currentObjectives()) {
    const gate = o.type === 'visit' && o.area ? world.slums.gates?.[o.area] : undefined;
    if (!gate?.length || ready || out.some((m) => m.to === o.area)) continue;
    const [c, r] = gate[Math.floor(gate.length / 2)];
    out.push({ kind: 'visit', type: q.type, tile: [c, r], to: o.area! });
  }
  return out;
}

/** The active quests' hunts: one a zone (main's when two share one), and the field bosses' fights. */
export function questMarks(places: QuestPlaces): QuestMark[] {
  const out: QuestMark[] = [];
  for (const { q, o, count, ready } of currentObjectives()) {
    if (ready) continue;
    // A field boss's fight, or its bell: its tile.
    if (o.type === 'fieldBoss' || o.type === 'bell') {
      for (const map of AREAS) {
        const b = places(map)?.boss;
        if (!b?.tile || b.id !== o.mob || out.some((m) => m.kind === 'boss' && m.map === map)) continue;
        out.push({ map, kind: 'boss', type: q.type, tile: b.tile, text: o.type === 'bell' ? 'Ring the bell' : (b.name ?? 'Field boss') });
      }
      continue;
    }
    // A hunt's zone: its mob's (a collect's: the mob its item drops from).
    const hunt = o.type === 'kill' || o.type === 'miniBoss';
    const mob = hunt ? o.mob : o.type === 'collect' ? questItemMob(o.item) : undefined;
    if (!mob) continue;
    for (const map of AREAS) {
      const zone = places(map)?.mobZones?.find((z) => z.mob === mob);
      if (!zone || out.some((m) => m.zone === zone)) continue;
      const name = zone.name ?? 'Hunt';
      const need = objectiveCount(o);
      const text =
        o.type === 'miniBoss' ? `${name} · Mini boss`
        : o.type === 'collect' ? `${name} · ${o.label ?? o.text} ${Math.min(heldOf(o.item), need)}/${need}`
        : `${name} · ${Math.min(count, need)}/${need}${o.collect ? ` · ${o.collect.label ?? o.collect.item} ${Math.min(heldOf(o.collect.item), o.collect.count)}/${o.collect.count}` : ''}`;
      out.push({ map, kind: o.type === 'miniBoss' ? 'miniBoss' : 'kill', type: q.type, zone, text });
      break;
    }
  }
  return out;
}

/** Where an NPC stands now (the last of their `moves` whose quest is done), on whichever map has them. */
export function npcSpot(places: QuestPlaces, id: string): { map: QuestArea; npc: MapNpc; tile: [number, number] } | null {
  const done = adventure()?.quests.done ?? [];
  for (const map of AREAS) {
    const npc = places(map)?.npcs?.find((n) => n.id === id);
    if (!npc) continue;
    const moved = [...(npc.moves ?? [])].reverse().find((m) => done.includes(m.after.replace(/^q(\d+)$/, (_, n: string) => `palengke-${n.padStart(2, '0')}`)));
    return { map, npc, tile: moved?.tile ?? npc.tile };
  }
  return null;
}

/** The NPCs the active quests need now (a talk, a delivery, a class to choose: as the head markers say), and the givers
 *  of offered quests; one mark an NPC (main's). */
export function npcMarks(places: QuestPlaces, nameOf?: (id: string) => string | undefined): NpcMark[] {
  const want: { npc: string; type: QuestDef['type']; symbol: string }[] = [];
  for (const { q, o } of currentObjectives()) {
    const npc = o.type === 'talk' || o.type === 'deliver' ? o.npc : o.type === 'chooseClass' ? q.giver : undefined;
    if (npc) want.push({ npc, type: q.type, symbol: o.type === 'talk' ? '!' : '…' });
  }
  for (const q of mainFirst([...offeredNow()])) if (q.giver) want.push({ npc: q.giver, type: q.type, symbol: '!' });
  const out: NpcMark[] = [];
  for (const w of want) {
    if (out.some((m) => m.npc === w.npc)) continue;
    const at = npcSpot(places, w.npc);
    if (!at) continue;
    out.push({ kind: 'npc', map: at.map, type: w.type, npc: w.npc, name: at.npc.name ?? nameOf?.(w.npc) ?? w.npc, tile: at.tile, symbol: w.symbol });
  }
  return out;
}

/** Where the quest trail should lead (world/quest-trail.ts, TownScene trailGoal): the first active quest's current
 *  objective (main's first) that has somewhere to go, else the giver of an offered main quest. Not a quest ready to
 *  report by radio. The same places the marks use, so the trail and the map agree. */
export type TrailTarget =
  | { kind: 'npc'; map: QuestArea; type: QuestDef['type']; tile: [number, number] }
  | { kind: 'zone'; map: QuestArea; type: QuestDef['type']; zone: MapZone }
  | { kind: 'spots'; map: QuestArea; type: QuestDef['type']; spots: [number, number][] }
  | { kind: 'tile'; map: QuestArea; type: QuestDef['type']; tile: [number, number] }
  | { kind: 'visit'; map: string; type: QuestDef['type'] };

export function trailTarget(places: QuestPlaces): TrailTarget | null {
  const toNpc = (npc: string | undefined, type: QuestDef['type']): TrailTarget | null => {
    const at = npc ? npcSpot(places, npc) : null;
    return at ? { kind: 'npc', map: at.map, type, tile: at.tile } : null;
  };
  for (const { q, o, ready } of currentObjectives()) {
    if (ready) continue;
    const type = q.type;
    if (o.type === 'talk' || o.type === 'deliver') {
      const t = toNpc(o.npc, type);
      if (t) return t;
      continue;
    }
    if (o.type === 'chooseClass') {
      const t = toNpc(q.giver, type);
      if (t) return t;
      continue;
    }
    if (o.type === 'visit') {
      if (o.area) return { kind: 'visit', map: o.area, type };
      continue;
    }
    if (o.type === 'fieldBoss' || o.type === 'bell') {
      for (const map of AREAS) {
        const b = places(map)?.boss;
        if (b?.tile && b.id === o.mob) return { kind: 'tile', map, type, tile: b.tile };
      }
      continue;
    }
    const mob = o.type === 'kill' || o.type === 'miniBoss' ? o.mob : o.type === 'collect' ? questItemMob(o.item) : undefined;
    if (!mob) continue;
    for (const map of AREAS) {
      const zone = places(map)?.mobZones?.find((z) => z.mob === mob);
      if (!zone) continue;
      if (o.type === 'miniBoss') {
        const spots = (zone.miniBosses ?? []).map((b) => b.tile);
        if (spots.length) return { kind: 'spots', map, type, spots };
        continue;
      }
      return { kind: 'zone', map, type, zone };
    }
  }
  for (const q of mainFirst([...offeredNow()])) {
    if (q.type !== 'main') continue;
    const t = toNpc(q.giver, q.type);
    if (t) return t;
  }
  return null;
}

/** Draws the marks on a picture stage (its img first: the marks go over it, under whatever is added after): positions at
 *  the picture's scale `k`, pins, badges and writing at `ik` (the Map menu's icon scale; the picture's own elsewhere). */
export function drawQuestMarks(stage: HTMLElement, world: WorldMap, k: number, art: QuestMarkArt, ik = k): (QuestMark | NpcMark | VisitMark)[] {
  const places = placesIn(world);
  const marks = questMarks(places);
  const npcs = npcMarks(places, art.npcName);
  const visits = visitMarks(world);
  const L = world.layout;
  const [pw, ph] = art.pinFrame;
  const [ax, ay] = art.pinAnchor;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('qm-areas'); // (as big as the stage: its points are the stage's pixels)
  svg.setAttribute('aria-hidden', 'true');
  stage.append(svg);
  const pin = (type: QuestDef['type'], kind: QuestMark['kind'] | 'visit', at: [number, number]) => {
    const p = document.createElement('span');
    p.className = `qm-pin qm-${kind}`;
    p.style.backgroundImage = `url("${art.pin(type)}")`;
    p.style.setProperty('--k', String(ik));
    p.style.setProperty('--pw', `${pw}px`);
    p.style.setProperty('--ph', `${ph}px`);
    p.style.left = `${Math.round(at[0] * k - ax * ik)}px`;
    p.style.top = `${Math.round(at[1] * k - ay * ik)}px`;
    stage.append(p);
  };
  // Writing under a spot, `dy` icon px lower.
  const label = (text: string, colour: string, at: [number, number], dy: number) => {
    const t = document.createElement('span');
    t.className = 'qm-label';
    t.style.setProperty('--k', String(ik));
    t.style.color = colour;
    t.style.left = `${Math.round(at[0] * k)}px`;
    t.style.top = `${Math.round(at[1] * k + dy * ik)}px`;
    t.textContent = text;
    stage.append(t);
  };
  for (const m of marks) {
    const colour = art.colours[m.type];
    if (m.kind === 'boss') {
      const at = worldPoint(L, m.map, m.tile![0] + 0.5, m.tile![1] + 0.5);
      if (!at) continue;
      pin(m.type, 'miniBoss', at);
      label(m.text, colour, at, 2);
      continue;
    }
    const [c0, r0, c1, r1] = m.zone!.rect;
    // The zone's outer corners (tile space): its top, right, bottom and left on the picture.
    const corners = [worldPoint(L, m.map, c0, r0), worldPoint(L, m.map, c1 + 1, r0), worldPoint(L, m.map, c1 + 1, r1 + 1), worldPoint(L, m.map, c0, r1 + 1)];
    if (corners.some((c) => !c)) continue;
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', corners.map((c) => `${(c![0] * k).toFixed(1)},${(c![1] * k).toFixed(1)}`).join(' '));
    poly.setAttribute('fill', colour);
    poly.setAttribute('fill-opacity', m.kind === 'kill' ? '0.25' : '0.12');
    poly.setAttribute('stroke', colour);
    poly.setAttribute('stroke-opacity', m.kind === 'kill' ? '1' : '0.45');
    poly.setAttribute('stroke-width', String(ik));
    poly.setAttribute('stroke-dasharray', `${3 * ik} ${2 * ik}`);
    poly.classList.add('qm-edge');
    svg.append(poly);
    const mid = worldPoint(L, m.map, (c0 + c1 + 1) / 2, (r0 + r1 + 1) / 2)!;
    if (m.kind === 'kill') pin(m.type, 'kill', mid);
    else for (const b of m.zone!.miniBosses ?? []) pin(m.type, 'miniBoss', worldPoint(L, m.map, b.tile[0] + 0.5, b.tile[1] + 0.5)!);
    label(m.text, colour, mid, 4); // (under the Map menu's own zone name)
  }
  // NPCs: the sign in a badge on their spot, their name under it.
  for (const n of npcs) {
    const at = worldPoint(L, n.map, n.tile[0] + 0.5, n.tile[1] + 0.5);
    if (!at) continue;
    const colour = art.colours[n.type];
    const b = document.createElement('span');
    b.className = 'qm-npc';
    b.style.setProperty('--k', String(ik));
    b.style.setProperty('--c', colour);
    b.style.left = `${Math.round(at[0] * k)}px`;
    b.style.top = `${Math.round(at[1] * k)}px`;
    b.textContent = n.symbol;
    stage.append(b);
    label(n.name, colour, at, 6);
  }
  // Visits: a pin on the gate, the way under it.
  for (const v of visits) {
    const at = worldPoint(L, 'slums', v.tile[0] + 0.5, v.tile[1] + 0.5);
    if (!at) continue;
    pin(v.type, 'visit', at);
    label(`To ${AREA_NAMES[v.to] ?? v.to}`, art.colours[v.type], at, 3);
  }
  return [...marks, ...npcs, ...visits];
}
