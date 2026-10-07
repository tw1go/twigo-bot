import type Phaser from 'phaser';
import type { ArenaServerMessage, TownPlayer, TownServerMessage } from '@mikazuki/shared';
import type { ClassArt, Manifest } from '../assets/types';
import { Character, dirForStep } from '../characters/character';
import { MOVES, isMoveKind, playMove } from './mobility';
import { loadOutfit, randomOutfit } from '../characters/doll';
import { sanitize } from '../characters/looks';
import type { BubbleArt } from '../ui/labels';
import { type WorldObjects, characterDepth } from './objects';
import { rng } from './rng';

// Everyone else in town, as the server reports them (net/town.ts): a paper doll each, with their name and title,
// walking the steps the server passes on. A character appears once its look has loaded; messages that arrive
// before that just update where it should be.

interface Other {
  state: TownPlayer;
  char: Character | null;
}

/** The Arena's messages are the arena's business (ui/arena-net.ts), not the town's players'. */
const isArena = (m: TownServerMessage): m is ArenaServerMessage => m.t.startsWith('arena-');

export class OtherPlayers {
  private readonly all = new Map<string, Other>();
  private zoom = 1;
  /** The speech bubble art, for what others say. */
  bubbleArt: BubbleArt | null = null;
  /** Called when someone arrives or leaves (the online list). */
  onChange: () => void = () => {};
  /** The resting weapon art for a worn weapon (loaded), or null (the scene knows the items and classes). */
  restFor: (weapon: string | null | undefined, cls: string | null | undefined) => Promise<ClassArt | null> = async () => null;
  /** The CSS cursor over a character (left click picks them). */
  private cursorCss = 'pointer';

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly M: Manifest,
    private readonly objects: WorldObjects,
    /** Called for each character (and its later effects) so the scene can tint it for the time of day. */
    private readonly onSpawn: (obj: Phaser.GameObjects.Components.Tint) => void,
  ) {}

  handle(m: TownServerMessage): void {
    switch (m.t) {
      case 'welcome':
        this.clear();
        for (const p of m.players) this.add(p);
        return;
      case 'join':
        this.remove(m.player.id); // also a rejoin at a new spot ('here' after a reconnect)
        return this.add(m.player);
      case 'leave':
        return this.remove(m.id);
    }
    if (m.t === 'snap' || m.t === 'say-refused' || m.t === 'say-discord' || m.t === 'emote' || m.t === 'system' || m.t === 'seat-taken' || m.t === 'announce' || m.t === 'gift' || m.t === 'gift-item' || m.t === 'new-title' || m.t === 'house' || m.t === 'race' || m.t === 'wallet' || m.t === 'stay' || m.t === 'mobs' || m.t === 'mob-move' || isArena(m)) return;
    const o = this.all.get(m.id);
    if (!o) return;
    const s = o.state;
    switch (m.t) {
      case 'step':
        Object.assign(s, { col: m.col, row: m.row, sit: false });
        return o.char?.queueStep({ col: m.col, row: m.row });
      case 'move': {
        // A mobility move: played to where it ends (the steps that follow are skipped while it plays).
        const ch = o.char;
        if (!ch || ch.busy || !isMoveKind(m.move)) return;
        const t = ch.tile;
        const dc = Math.sign(m.col - t.col);
        const dr = Math.sign(m.row - t.row);
        const n = Math.max(Math.abs(m.col - t.col), Math.abs(m.row - t.row));
        if (!n) return;
        const dir = MOVES[m.move].back ? dirForStep(-dc, -dr) : dirForStep(dc, dr);
        return void playMove(this.scene, this.M, ch, m.move, { col: m.col, row: m.row }, n, dir, this.onSpawn).then(() => {
          // Where the server has them now (the steps landed while it played).
          if (this.all.get(m.id) === o && (s.col !== m.col || s.row !== m.row)) ch.queueStep({ col: s.col, row: s.row });
        });
      }
      case 'face':
        s.dir = m.dir;
        return o.char?.face(m.dir);
      case 'sit':
        Object.assign(s, { col: m.col, row: m.row, dir: m.dir, sit: true });
        if (o.char) this.seat(o.char, s);
        return;
      case 'stand':
        s.sit = false;
        return o.char?.standUp();
      case 'say':
        if (this.bubbleArt) o.char?.say(m.text, this.bubbleArt);
        return;
      case 'jailed':
        s.jailed = m.on || undefined;
        return o.char?.setJailed(m.on);
      case 'rename':
        // A Rename Card: the new name over their head.
        s.nickname = m.nickname;
        o.char?.setNameTag(s.nickname, s.title);
        return this.onChange();
      case 'kit':
        // A class chosen or a weapon changed: their resting weapon, once its sheets have loaded.
        Object.assign(s, { cls: m.cls, weapon: m.weapon });
        return void this.dressRest(o);
      case 'look': {
        // A new look or title from the Parlor: the new layers load first, then they change in place.
        Object.assign(s, { outfit: m.outfit, title: m.title });
        const C = this.M.characters;
        const look = sanitize(C, m.outfit, randomOutfit(C, rng(parseInt(m.id.slice(0, 8), 16) || 1)));
        void loadOutfit(this.scene, C, look).then(() => {
          if (this.all.get(m.id) !== o || o.state.outfit !== m.outfit) return; // left, or changed again meanwhile
          o.char?.setOutfit(look);
          o.char?.setNameTag(s.nickname, s.title);
        });
        return;
      }
    }
  }

  /** Someone else is sitting on the bench at (col, row). */
  seatTaken(col: number, row: number): boolean {
    for (const o of this.all.values()) if (o.state.sit && o.state.col === col && o.state.row === row) return true;
    return false;
  }

  /** Someone's character, once drawn. */
  charOf(id: string): Character | null {
    return this.all.get(id)?.char ?? null;
  }

  /** The player whose character is among `over` (what the pointer is over), if any. */
  pick(over: Phaser.GameObjects.GameObject[]): TownPlayer | null {
    for (const o of this.all.values()) if (o.char && over.includes(o.char.sprite)) return o.state;
    return null;
  }

  /** Whether someone is still here. */
  has(id: string): boolean {
    return this.all.has(id);
  }

  /** The cursor over characters (it's scaled with the zoom). */
  set cursor(css: string) {
    this.cursorCss = css;
    for (const o of this.all.values()) if (o.char?.sprite.input) o.char.sprite.input.cursor = css;
  }

  /** Someone's class (the chat's badge), if they're here and have one. */
  classOf(id: string): string | null {
    return this.all.get(id)?.state.cls ?? null;
  }

  /** Someone's nickname (for the chat log), if they're here. */
  nameOf(id: string): string | null {
    return this.all.get(id)?.state.nickname ?? null;
  }

  update(deltaMs: number): void {
    for (const o of this.all.values()) o.char?.update(deltaMs);
  }

  setZoom(zoom: number): void {
    this.zoom = zoom;
    for (const o of this.all.values()) o.char?.setZoom(zoom);
  }

  /** Sprites to tint with the world. */
  get tintables(): Phaser.GameObjects.Components.Tint[] {
    return [...this.all.values()].flatMap((o) => o.char?.tintables ?? []);
  }

  get count(): number {
    return this.all.size;
  }

  clear(): void {
    for (const id of [...this.all.keys()]) this.remove(id);
  }

  /** Everyone here, as the server reported them. */
  get players(): TownPlayer[] {
    return [...this.all.values()].map((o) => o.state);
  }

  private add(p: TownPlayer): void {
    const C = this.M.characters;
    const o: Other = { state: { ...p }, char: null };
    this.all.set(p.id, o);
    this.onChange();
    // Unknown items (an older or newer wardrobe) fall back to a look seeded by their id.
    const look = sanitize(C, p.outfit, randomOutfit(C, rng(parseInt(p.id.slice(0, 8), 16) || 1)));
    void loadOutfit(this.scene, C, look).then(() => {
      if (this.all.get(p.id) !== o) return; // left while loading
      const s = o.state;
      const char = new Character(this.scene, this.M, look, { col: s.col, row: s.row });
      char.depthFn = (c, r, d, b) => characterDepth(this.objects, c, r, d, b);
      char.elevation = (c, r) => this.objects.heights.lift(c, r); // raised ground (the Slums)
      char.onSpawn = (obj) => this.onSpawn(obj);
      char.place({ col: s.col, row: s.row }, s.dir);
      if (s.sit) this.seat(char, s);
      char.setNameTag(s.nickname, s.title);
      char.setJailed(!!s.jailed);
      char.sprite.setInteractive({ pixelPerfect: true, cursor: this.cursorCss });
      char.setZoom(this.zoom);
      for (const t of char.tintables) this.onSpawn(t);
      o.char = char;
      void this.dressRest(o);
    });
  }

  /** Their resting weapon (none without a weapon), unless they changed it again meanwhile. */
  private async dressRest(o: Other): Promise<void> {
    const { weapon, cls } = o.state;
    const art = await this.restFor(weapon, cls);
    if (o.state.weapon !== weapon || !o.char) return;
    o.char.setRestingWeapon(art, this.M.classes?.bodyOffset);
  }

  private remove(id: string): void {
    this.all.get(id)?.char?.destroy();
    if (this.all.delete(id)) this.onChange();
  }

  /** Sit on the bench at the player's tile (or just stand there if there's none). */
  private seat(char: Character, s: TownPlayer): void {
    const bench = this.objects.benches.find((b) => b.col === s.col && b.row === s.row);
    if (bench) char.sit({ col: s.col, row: s.row }, bench.faces, bench.depth);
    else char.place({ col: s.col, row: s.row }, s.dir);
  }
}
