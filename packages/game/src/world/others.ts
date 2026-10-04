import type Phaser from 'phaser';
import type { TownPlayer, TownServerMessage } from '@mikazuki/shared';
import type { Manifest } from '../assets/types';
import { Character } from '../characters/character';
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

export class OtherPlayers {
  private readonly all = new Map<string, Other>();
  private zoom = 1;
  /** The speech bubble art, for what others say. */
  bubbleArt: BubbleArt | null = null;
  /** Called when someone arrives or leaves (the online list). */
  onChange: () => void = () => {};

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
    if (m.t === 'snap' || m.t === 'say-refused' || m.t === 'say-discord' || m.t === 'emote' || m.t === 'system' || m.t === 'seat-taken' || m.t === 'announce') return;
    const o = this.all.get(m.id);
    if (!o) return;
    const s = o.state;
    switch (m.t) {
      case 'step':
        Object.assign(s, { col: m.col, row: m.row, sit: false });
        return o.char?.queueStep({ col: m.col, row: m.row });
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
      char.onSpawn = (obj) => this.onSpawn(obj);
      char.place({ col: s.col, row: s.row }, s.dir);
      if (s.sit) this.seat(char, s);
      char.setNameTag(s.nickname, s.title);
      char.setZoom(this.zoom);
      for (const t of char.tintables) this.onSpawn(t);
      o.char = char;
    });
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
