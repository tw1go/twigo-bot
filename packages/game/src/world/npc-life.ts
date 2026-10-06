import Phaser from 'phaser';
import type { Dir, Manifest, NpcDefs } from '../assets/types';
import { hearGossip, playSound } from '../audio/sound';
import { Character, SPEED, dirForStep } from '../characters/character';
import type { Outfit } from '../characters/doll';
import type { BubbleArt } from '../ui/labels';
import { openNpcDialog, talkingTo } from '../ui/npc-dialog';
import { visible } from '../util/pixels';
import type { Tile, WalkGrid } from './grid';
import { type WorldObjects, characterDepth } from './objects';
import { NPC_PLACES, type NpcPlace } from './npcs';

// 🧑‍🤝‍🧑 The town's ambient NPCs (who and where: world/npcs.ts), run on each player's own page: never sent to the
// server, never in the online list or on the minimap, and nobody else sees the same steps. Each is a Character on flat
// pre-baked sheets (manifest npcs; not paper dolls) walking the same grid as the player, slower, without blocking
// anyone: the Tanod patrols his loop (whistling now and then, heard up close), the Alings wander near home or stay put
// and turn to the nearest player while idle. Clicked (the scene walks you over first), one stops, faces you, waves
// (the Tanod whistles) and talks in the dialog box (ui/npc-dialog.ts). Now and then one near you says a line on her
// own in a speech bubble (one at a time on screen).

/** A character's name, characteristic, portrait and lines (manifest npcs.dialogue). */
export interface NpcText {
  name: string;
  title: string;
  portrait: string;
  lines: string[];
}

interface Npc {
  place: NpcPlace;
  text: NpcText;
  char: Character;
  /** Lines still to come this session, shuffled (so none repeats until most have been said). */
  deck: string[];
  last: string | null;
  /** When the routine moves on (walks somewhere new). */
  nextAt: number;
  /** The patrol stop it's at (an index into the route). */
  stop: number;
  /** Where it's walking. */
  dest: Tile | null;
  /** An emote is playing until then (nothing turns it meanwhile). */
  busyUntil: number;
  talking: boolean;
}

/** How close you must be to talk (further: the scene walks you over first). */
export const TALK_RANGE = 3;
/** Walking further than this from the NPC you're talking to closes the box. */
export const TALK_LEAVE = 4;
const FACE_RANGE = 3;
const WHISTLE_HEARD = 2;
const GOSSIP_RANGE = 5;
const GOSSIP_EVERY: [number, number] = [30_000, 60_000];
/** Two Alings this close (tiles) are gossiping: the murmur plays near them. */
const GOSSIP_PAIR = 4;
const EMOTE_MS = 800; // 8 frames at 10 fps
const between = ([a, b]: [number, number]) => a + Math.random() * (b - a);
const dist = (a: Tile, b: Tile) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
const key = (t: Tile) => `${t.col},${t.row}`;

/** The way from `a` to look at `b`: the nearest of the 8 directions. */
function toward(a: Tile, b: Tile): Dir | null {
  let dc = b.col - a.col;
  let dr = b.row - a.row;
  if (!dc && !dr) return null;
  if (Math.abs(dc) < Math.abs(dr) / 2) dc = 0;
  if (Math.abs(dr) < Math.abs(dc) / 2) dr = 0;
  return dirForStep(dc, dr);
}

export interface NpcWorld {
  scene: Phaser.Scene;
  M: Manifest;
  grid: WalkGrid;
  objects: WorldObjects;
  /** Tiles no NPC stands on (doors and next to them, gates, benches and their seats, the spawn). */
  avoid: Set<string>;
  /** Tints a sprite for the time of day. */
  onSpawn: (obj: Phaser.GameObjects.Components.Tint) => void;
  bubbles: BubbleArt | null;
  /** An asset's URL (for the portrait in the dialog box). */
  asset: (file: string) => string;
}

export class NpcLife {
  private readonly npcs: Npc[] = [];
  private nextGossip: number;
  private bubbleUntil = 0;
  /** Who's saying the line in the bubble (her murmur plays meanwhile). */
  private bubbleBy: Npc | null = null;

  constructor(private readonly w: NpcWorld) {
    const defs = w.M.npcs;
    const lines = defs && (w.scene.cache.json.get('npc-dialogue') as { npcs?: Record<string, NpcText> } | undefined)?.npcs;
    this.nextGossip = w.scene.time.now + between(GOSSIP_EVERY);
    if (!defs || !lines) {
      console.warn('[npcs] no manifest npcs section or dialogue file: none in town');
      return;
    }
    for (const place of NPC_PLACES) {
      const text = lines[place.id];
      const home = { col: place.home[0], row: place.home[1] };
      if (!text) {
        console.warn(`[npcs] ${place.id}: not in the dialogue file, left out`);
        continue;
      }
      if (!this.free(home)) {
        console.warn(`[npcs] ${place.id}: home ${key(home)} is blocked or by a door, bench, gate or the spawn, left out`);
        continue;
      }
      if (place.behaviour.kind === 'patrol') {
        const ok = place.behaviour.route.filter(([c, r]) => this.free({ col: c, row: r }));
        if (ok.length < place.behaviour.route.length) console.warn(`[npcs] ${place.id}: ${place.behaviour.route.length - ok.length} patrol stop(s) left out (blocked, or by a door…)`);
        place.behaviour.route = ok;
      }
      const sheets = this.sheets(defs, place.id);
      if (!sheets) continue;
      const char = new Character(w.scene, w.M, {} as Outfit, home, sheets);
      char.speed = SPEED * place.speed;
      char.depthFn = (c, r, d, b) => characterDepth(w.objects, c, r, d, b);
      char.onSpawn = (obj) => w.onSpawn(obj);
      for (const t of char.tintables) w.onSpawn(t);
      char.place(home, place.faces ?? 's');
      // Just the name over the head (the characteristic is in the dialog box).
      char.setNameTag(text.name, { name: text.title, color: '#FFFFFF' }, { nameOnly: true });
      char.sprite.setInteractive({ pixelPerfect: true });
      const npc: Npc = { place, text, char, deck: [], last: null, nextAt: 0, stop: 0, dest: null, busyUntil: 0, talking: false };
      npc.nextAt = w.scene.time.now + this.restMs(npc);
      char.onArrive = () => this.arrived(npc);
      this.npcs.push(npc);
    }
  }

  /** A tile an NPC may stand on. */
  private free(t: Tile): boolean {
    return this.w.grid.walkable(t.col, t.row) && !this.w.avoid.has(key(t));
  }

  /** The NPC's animations (made once) and how it's drawn; null without its art. */
  private sheets(defs: NpcDefs, id: string) {
    const { scene } = this.w;
    let missing = 0;
    for (const [anim, a] of Object.entries(defs.animations)) {
      if (a.only && !a.only.includes(id)) continue;
      for (const dir of defs.directions) {
        const file = defs.file.replace('{id}', id).replace('{anim}', anim).replace('{dir}', dir);
        const k = `npc:${id}:${anim}:${dir}`;
        if (scene.anims.exists(k)) continue;
        if (!scene.textures.exists(file)) {
          missing++;
          continue;
        }
        scene.anims.create({ key: k, frames: scene.anims.generateFrameNumbers(file, { start: 0, end: a.frames - 1 }), frameRate: a.fps, repeat: a.loop ? -1 : 0 });
      }
    }
    if (missing) console.warn(`[npcs] ${id}: ${missing} sheet(s) missing`);
    const idle = defs.file.replace('{id}', id).replace('{anim}', 'idle').replace('{dir}', 's');
    if (!scene.textures.exists(idle)) return null;
    return { key: (anim: string, dir: Dir) => `npc:${id}:${anim}:${dir}`, head: headRow(scene, idle, defs.cell), directions: defs.directions };
  }

  /** How long it stays put before moving on. */
  private restMs(npc: Npc): number {
    const b = npc.place.behaviour;
    return b.kind === 'patrol' ? between(b.pauseMs) : b.kind === 'wander' ? between(b.everyMs) : Infinity;
  }

  /** At its destination: a rest (the Tanod's stop: now and then a whistle). */
  private arrived(npc: Npc): void {
    npc.dest = null;
    const now = this.w.scene.time.now;
    npc.nextAt = now + this.restMs(npc);
    const b = npc.place.behaviour;
    if (b.kind !== 'patrol' || npc.talking || Math.random() >= b.whistleChance) return;
    this.emote(npc, 'whistle');
    if (this.players.some((p) => dist(p, npc.char.tile) <= WHISTLE_HEARD)) playSound('busted');
  }

  private emote(npc: Npc, anim: 'wave' | 'cheer' | 'whistle'): void {
    npc.char.emote(anim);
    npc.busyUntil = this.w.scene.time.now + EMOTE_MS;
  }

  /** Where the players are (you first), for facing, not walking into them, and range. */
  private players: Tile[] = [];

  update(deltaMs: number, players: Tile[]): void {
    this.players = players;
    const now = this.w.scene.time.now;
    const taken = new Set(players.map(key));
    for (const npc of this.npcs) {
      npc.char.update(deltaMs);
      if (npc.talking) continue;
      // Walking somewhere a player has stepped onto: stop (after this step) and pick again later.
      if (npc.dest && taken.has(key(npc.dest))) {
        npc.dest = null;
        npc.char.cancelPath();
      }
      if (!npc.char.isIdle || now < npc.busyUntil) continue;
      this.turn(npc);
      if (now >= npc.nextAt) this.move(npc, taken);
    }
    this.gossip(now);
    this.murmur(now);
  }

  /** The gossip murmur: as loud as the nearest gossiping Aling is near you (gossiping: another Aling within
   *  GOSSIP_PAIR tiles of her, or saying her line on her own), ducked under an open dialog box. */
  private murmur(now: number): void {
    const me = this.players[0];
    if (!me) return;
    const alings = this.npcs.filter((n) => n.place.gossip);
    let nearest: number | null = null;
    for (const a of alings) {
      const at = a.char.tile;
      const chatting = (a === this.bubbleBy && now < this.bubbleUntil) || alings.some((b) => b !== a && dist(b.char.tile, at) <= GOSSIP_PAIR);
      if (!chatting) continue;
      const d = Math.hypot(at.col - me.col, at.row - me.row);
      if (nearest === null || d < nearest) nearest = d;
    }
    hearGossip(nearest, talkingTo() !== null);
  }

  /** Idle: Nena keeps watching the plaza; the others look at the nearest player close by. */
  private turn(npc: Npc): void {
    const at = npc.char.tile;
    if (npc.place.watch) {
      const dir = toward(at, { col: npc.place.watch[0], row: npc.place.watch[1] });
      if (dir) npc.char.face(dir);
      return;
    }
    let near: Tile | null = null;
    for (const p of this.players) if (dist(p, at) <= FACE_RANGE && (!near || dist(p, at) < dist(near, at))) near = p;
    const dir = near && toward(at, near);
    if (dir) npc.char.face(dir);
  }

  private move(npc: Npc, taken: Set<string>): void {
    const b = npc.place.behaviour;
    const from = npc.char.tile;
    const now = this.w.scene.time.now;
    let to: Tile | null = null;
    if (b.kind === 'patrol' && b.route.length) {
      npc.stop = (npc.stop + 1) % b.route.length;
      to = { col: b.route[npc.stop][0], row: b.route[npc.stop][1] };
    } else if (b.kind === 'wander') {
      const [hc, hr] = npc.place.home;
      const spots: Tile[] = [];
      for (let r = hr - b.radius; r <= hr + b.radius; r++) {
        for (let c = hc - b.radius; c <= hc + b.radius; c++) {
          const t = { col: c, row: r };
          if ((c !== from.col || r !== from.row) && this.free(t) && !taken.has(key(t))) spots.push(t);
        }
      }
      to = spots[Math.floor(Math.random() * spots.length)] ?? null;
    }
    const path = to && !taken.has(key(to)) ? this.w.grid.findPath(from, to) : null;
    // Too long a way round (a fence between): not this time.
    if (!to || !path || (b.kind === 'wander' && path.length > b.radius * 4)) {
      npc.nextAt = now + 2_000;
      return;
    }
    npc.dest = to;
    npc.char.walk(path);
  }

  /** Now and then a gossiping Aling near you says a line on her own (one bubble on screen at a time). */
  private gossip(now: number): void {
    if (now < this.nextGossip || now < this.bubbleUntil || !this.w.bubbles) return;
    const me = this.players[0];
    const near = me ? this.npcs.filter((n) => n.place.gossip && !n.talking && dist(n.char.tile, me) <= GOSSIP_RANGE) : [];
    const npc = near[Math.floor(Math.random() * near.length)];
    if (!npc) {
      this.nextGossip = now + 5_000;
      return;
    }
    const line = this.draw(npc);
    npc.char.say(line, this.w.bubbles);
    this.bubbleBy = npc;
    if (line.trim().endsWith('!') && npc.char.isIdle) this.emote(npc, 'cheer');
    this.bubbleUntil = now + 4000 + line.length * 60 + 600; // as long as Character.say shows it, and its fade
    this.nextGossip = now + between(GOSSIP_EVERY);
  }

  /** The next line: through all of them in a shuffled order, never the same one twice in a row. */
  private draw(npc: Npc): string {
    if (!npc.deck.length) {
      npc.deck = Phaser.Utils.Array.Shuffle([...npc.text.lines]);
      if (npc.deck.length > 1 && npc.deck[npc.deck.length - 1] === npc.last) npc.deck.unshift(npc.deck.pop()!);
    }
    npc.last = npc.deck.pop() ?? '';
    return npc.last;
  }

  /** The NPC whose sprite is among `over` (what the pointer is over), if any. */
  pick(over: Phaser.GameObjects.GameObject[]): string | null {
    return this.npcs.find((n) => over.includes(n.char.sprite))?.place.id ?? null;
  }

  tileOf(id: string): Tile | null {
    return this.npcs.find((n) => n.place.id === id)?.char.tile ?? null;
  }

  /** Talk to an NPC (you're close enough: the scene checks): it stops, faces you, waves, and the box opens. */
  talk(id: string, me: Tile): void {
    const npc = this.npcs.find((n) => n.place.id === id);
    if (!npc) return;
    npc.talking = true;
    npc.dest = null;
    npc.char.place(npc.char.tile, toward(npc.char.tile, me) ?? npc.char.facing); // stop where it is
    this.emote(npc, id === 'tanod' ? 'whistle' : 'wave');
    openNpcDialog({
      id,
      name: npc.text.name,
      title: npc.text.title,
      portrait: this.w.asset(npc.text.portrait),
      next: () => this.draw(npc),
      voice: npc.place.voice,
      mirror: npc.place.portrait === 'sw',
      onClose: () => {
        npc.talking = false;
        npc.nextAt = this.w.scene.time.now + this.restMs(npc);
      },
    });
  }

  /** The NPC you're talking to, if any. */
  get talkingTo(): string | null {
    return talkingTo();
  }

  setZoom(zoom: number): void {
    for (const n of this.npcs) n.char.setZoom(zoom);
  }

  /** The cursor over NPCs (it's scaled with the zoom). */
  set cursor(css: string) {
    for (const n of this.npcs) if (n.char.sprite.input) n.char.sprite.input.cursor = css;
  }

  get tintables(): Phaser.GameObjects.Components.Tint[] {
    return this.npcs.flatMap((n) => n.char.tintables);
  }

  get count(): number {
    return this.npcs.length;
  }

  /** Where everyone is (for the debug API). */
  get positions(): Record<string, Tile> {
    return Object.fromEntries(this.npcs.map((n) => [n.place.id, n.char.tile]));
  }
}


/** The first row with a visible pixel in an NPC's idle sheet facing south, frame 0 (name plates sit above it). */
function headRow(scene: Phaser.Scene, file: string, cell: [number, number]): number {
  const src = scene.textures.get(file).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const canvas = document.createElement('canvas');
  canvas.width = cell[0];
  canvas.height = cell[1];
  const frame = scene.textures.getFrame(file, 0);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, frame.cutX, frame.cutY, cell[0], cell[1], 0, 0, cell[0], cell[1]);
  const data = ctx.getImageData(0, 0, cell[0], cell[1]).data;
  for (let i = 3; i < data.length; i += 4) if (visible(data[i])) return Math.floor((i - 3) / 4 / cell[0]);
  return 0;
}
