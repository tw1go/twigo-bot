import Phaser from 'phaser';
import { queueTown } from '../assets/queue';
import type { Manifest, TownMap } from '../assets/types';
import { assetProblems, headTop, loadOutfit, sheetKey } from '../characters/doll';
import { saveOutfit, startingOutfit } from '../characters/looks';
import { saveNickname, suggestNickname } from '../characters/nickname';
import type { MeResult } from '../session';
import { mountCreator } from '../ui/creator';

// A logged-in member with no saved look or nickname picks them first (ui/creator.ts draws it from the sheets built here).
// Meanwhile the town's art loads in the background (TownPreloadScene), so saving goes straight into the town.

interface Data {
  manifest: Manifest;
  town: TownMap;
  me: MeResult & { status: 'ok' };
}

export class CreateScene extends Phaser.Scene {
  private args!: Data;

  constructor() {
    super('create');
  }

  init(data: Data): void {
    this.args = data;
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#000000');
    document.getElementById('hud')?.removeAttribute('hidden'); // your name and Log out, over the creator
    this.load.setPath(`${import.meta.env.BASE_URL}assets/`);
    const { manifest, me } = this.args;
    const C = manifest.characters;
    const frame = manifest.ui.inventory?.itemFrame;
    const asset = (file: string) => `${import.meta.env.BASE_URL}assets/${file}`;
    const townLoaded = new Promise<void>((done) => this.scene.launch('town-preload', { ...this.args, done }));
    mountCreator(C, {
      name: me.me.name,
      nickname: me.me.nickname ?? suggestNickname(me.me.name),
      title: me.me.title,
      frame: frame ? { url: asset(frame.file), slice: frame.nineSlice } : null,
      initial: startingOutfit(C, me),
      apply: (o) => loadOutfit(this, C, o),
      sheet: (o, dir) => {
        const key = sheetKey(o, 'idle', dir);
        return this.textures.exists(key) ? (this.textures.get(key).getSourceImage() as HTMLCanvasElement) : null;
      },
      head: (o) => headTop(this, o),
      save: async (o, nickname) => {
        const nick = await saveNickname(nickname);
        if (nick !== 'ok') return nick;
        if ((await saveOutfit(o, true)) !== 'account') return 'error';
        await townLoaded;
        this.scene.stop('town-preload');
        this.scene.start('town', { ...this.args, me: { ...me, me: { ...me.me, outfit: o, nickname } }, firstVisit: true });
        return 'ok';
      },
    });
  }
}

/** Loads the town's art while the creator is open; calls `done` when it's all in. */
export class TownPreloadScene extends Phaser.Scene {
  private args!: { manifest: Manifest; town: TownMap; done: () => void };

  constructor() {
    super('town-preload');
  }

  init(data: { manifest: Manifest; town: TownMap; done: () => void }): void {
    this.args = data;
  }

  preload(): void {
    this.load.setPath(`${import.meta.env.BASE_URL}assets/`);
    queueTown(this.load, this.textures, this.args.manifest, this.args.town);
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => assetProblems.add(`failed to load ${file.src}`));
  }

  create(): void {
    this.args.done();
  }
}
