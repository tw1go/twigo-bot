import { type QuestDef, objectiveCount, readyToReport } from '@mikazuki/shared';
import { adventure, questDef } from '../net/adventure';
import { type MapZone, type WorldMap, worldPoint } from './world-map';

// 🎯 Quest marks on the world map's picture (the quest map, ui/quest-map.ts, and the Map menu, ui/map-menu.ts): every
// active quest's current hunt (a kill or mini boss objective not yet reached; one ready to report shows nothing) on its
// mob's Slums zone, in the quest's colour (violet main, yellow side; a zone two quests share is drawn once, main's):
//   • kill: the zone as a diamond, filled at 25% with a dashed 1 px edge marching slowly, a kill pin at its middle and
//     under it the zone's name with the count ("Tin Can Alley · 12/20");
//   • mini boss: the diamond faintly (12%), a mini boss pin on each of its mini boss spots, the name under the middle;
//   • visit (the Tanod's The Market Up North): a pin on the Slums' gate to its map, "To the Old Market" under it.
// Pins (manifest guide.pin: 13 × 18, kill 0–1, mini boss 2–3, 3 fps, anchored at (6, 17)) are drawn at the picture's
// scale; nothing else moves.

export interface QuestMarkArt {
  /** The pins' sheet by the quest's type. */
  pin: (type: QuestDef['type']) => string;
  pinFrame: [number, number];
  pinAnchor: [number, number];
  colours: { main: string; side: string };
}

export interface QuestMark {
  zone: MapZone;
  kind: 'kill' | 'miniBoss';
  type: QuestDef['type'];
  count: number;
  need: number;
}

/** A visit's mark: the Slums' gate to its map (a tile), and the map's name. */
export interface VisitMark {
  kind: 'visit';
  type: QuestDef['type'];
  tile: [number, number];
  to: string;
}

/** The maps a visit can lead to, by area id. */
const AREA_NAMES: Record<string, string> = { palengke: 'the Old Market' };

/** The active quests' visits not yet made whose map the Slums has a gate to: a mark on that gate (main's first). */
export function visitMarks(world: WorldMap): VisitMark[] {
  const s = adventure();
  if (!s) return [];
  const out: VisitMark[] = [];
  for (const p of s.quests.active) {
    const q = questDef(p.id);
    const o = q?.objectives[p.step];
    const gate = o?.type === 'visit' && o.area ? world.slums.gates?.[o.area] : undefined;
    if (!q || !o || !gate?.length || readyToReport(q, p) || out.some((m) => m.to === o.area)) continue;
    const [c, r] = gate[Math.floor(gate.length / 2)];
    out.push({ kind: 'visit', type: q.type, tile: [c, r], to: o.area! });
  }
  return out.sort((a, b) => (a.type === b.type ? 0 : a.type === 'main' ? -1 : 1));
}

/** The active quests' hunts, one a zone (main's when two share one). */
export function questMarks(world: WorldMap): QuestMark[] {
  const s = adventure();
  if (!s) return [];
  const byZone = new Map<MapZone, QuestMark>();
  for (const p of s.quests.active) {
    const q = questDef(p.id);
    const o = q?.objectives[p.step];
    if (!q || !o || (o.type !== 'kill' && o.type !== 'miniBoss') || readyToReport(q, p)) continue;
    const zone = world.slums.mobZones?.find((z) => z.mob === o.mob);
    if (!zone) continue;
    const had = byZone.get(zone);
    if (had && (had.type === 'main' || q.type !== 'main')) continue;
    byZone.set(zone, { zone, kind: o.type, type: q.type, count: Math.min(p.count ?? 0, objectiveCount(o)), need: objectiveCount(o) });
  }
  return [...byZone.values()];
}

/** Draws the marks on a picture stage (its img first: the marks go over it, under whatever is added after). */
export function drawQuestMarks(stage: HTMLElement, world: WorldMap, k: number, art: QuestMarkArt, marks = questMarks(world), visits = visitMarks(world)): (QuestMark | VisitMark)[] {
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
    p.style.setProperty('--k', String(k));
    p.style.setProperty('--pw', `${pw}px`);
    p.style.setProperty('--ph', `${ph}px`);
    p.style.left = `${Math.round((at[0] - ax) * k)}px`;
    p.style.top = `${Math.round((at[1] - ay) * k)}px`;
    stage.append(p);
  };
  for (const m of marks) {
    const colour = art.colours[m.type];
    const [c0, r0, c1, r1] = m.zone.rect;
    // The zone's outer corners (tile space): its top, right, bottom and left on the picture.
    const corners = [worldPoint(L, 'slums', c0, r0), worldPoint(L, 'slums', c1 + 1, r0), worldPoint(L, 'slums', c1 + 1, r1 + 1), worldPoint(L, 'slums', c0, r1 + 1)];
    if (corners.some((c) => !c)) continue;
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', corners.map((c) => `${(c![0] * k).toFixed(1)},${(c![1] * k).toFixed(1)}`).join(' '));
    poly.setAttribute('fill', colour);
    poly.setAttribute('fill-opacity', m.kind === 'kill' ? '0.25' : '0.12');
    poly.setAttribute('stroke', colour);
    poly.setAttribute('stroke-opacity', m.kind === 'kill' ? '1' : '0.45');
    poly.setAttribute('stroke-width', String(k));
    poly.setAttribute('stroke-dasharray', `${3 * k} ${2 * k}`);
    poly.classList.add('qm-edge');
    svg.append(poly);
    const mid = worldPoint(L, 'slums', (c0 + c1 + 1) / 2, (r0 + r1 + 1) / 2)!;
    if (m.kind === 'kill') pin(m.type, 'kill', mid);
    else for (const b of m.zone.miniBosses ?? []) pin(m.type, 'miniBoss', worldPoint(L, 'slums', b.tile[0] + 0.5, b.tile[1] + 0.5)!);
    const label = document.createElement('span');
    label.className = 'qm-label';
    label.style.color = colour;
    label.style.left = `${Math.round(mid[0] * k)}px`;
    label.style.top = `${Math.round((mid[1] + 4) * k)}px`; // (under the Map menu's own zone name)
    label.textContent = `${m.zone.name ?? 'Slums'} · ${m.kind === 'kill' ? `${m.count}/${m.need}` : 'Mini boss'}`;
    stage.append(label);
  }
  // Visits: a pin on the gate, the way under it.
  for (const v of visits) {
    const at = worldPoint(L, 'slums', v.tile[0] + 0.5, v.tile[1] + 0.5);
    if (!at) continue;
    pin(v.type, 'visit', at);
    const label = document.createElement('span');
    label.className = 'qm-label';
    label.style.color = art.colours[v.type];
    label.style.left = `${Math.round(at[0] * k)}px`;
    label.style.top = `${Math.round((at[1] + 3) * k)}px`;
    label.textContent = `To ${AREA_NAMES[v.to] ?? v.to}`;
    stage.append(label);
  }
  return [...marks, ...visits];
}
