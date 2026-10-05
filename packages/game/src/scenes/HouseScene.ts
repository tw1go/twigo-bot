import Phaser from 'phaser';
import type { TownHoodResponse } from '@mikazuki/shared';
import { queueImage } from '../assets/queue';
import type { Manifest, TownMap } from '../assets/types';
import { assetProblems } from '../characters/doll';
import { type HouseArt, composeHouse, houseFiles, houseStyles } from '../houses/art';
import { hoodTownMap, loadHood, saveHouse } from '../net/hood';
import type { MeResult } from '../session';
import { mountHouseCreator } from '../ui/house-creator';

// A member's first time in the neighbourhood: build a house first (ui/house-creator.ts over black, like the
// character creator), then into the neighbourhood with it standing on its lot.

interface Data {
  manifest: Manifest;
  town: TownMap;
  me: MeResult & { status: 'ok' };
  art: HouseArt;
}

export class HouseScene extends Phaser.Scene {
  private args!: Data;

  constructor() {
    super('house');
  }

  init(data: Data): void {
    this.args = data;
  }

  preload(): void {
    this.load.setPath(`${import.meta.env.BASE_URL}assets/`);
    for (const s of houseStyles(this.args.art)) for (const f of houseFiles(this.args.art, s)) queueImage(this.load, this.textures, f);
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => assetProblems.add(`failed to load ${file.src}`));
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#000000');
    const { manifest, art } = this.args;
    const frame = manifest.ui.inventory?.itemFrame;
    mountHouseCreator({
      art,
      initial: null,
      cost: 0,
      kowens: this.args.me.me.kowens,
      frame: frame ? { url: `${import.meta.env.BASE_URL}assets/${frame.file}`, slice: frame.nineSlice } : null,
      draw: (look) => composeHouse(this, art, look),
      save: async (look) => {
        const r = await saveHouse(look);
        if (!r) return { ok: false, message: "Couldn't build it. Try again?" };
        if (r.ok) this.enter(r);
        return r;
      },
    });
  }

  private enter(hood: TownHoodResponse): void {
    this.scene.start('town', { ...this.args, town: hoodTownMap(hood, this.args.town), hood, firstVisit: false });
  }
}

/** Boots the neighbourhood: its houses, then the house creator (no house yet) or the neighbourhood itself. Null if it
 *  can't be reached (the caller goes to the town instead). */
export async function bootHood(scene: Phaser.Scene, args: Omit<Data, 'art'>, art: HouseArt | null): Promise<boolean> {
  const hood = art && (await loadHood());
  if (!art || !hood) return false;
  if (!hood.me.house) scene.scene.start('house', { ...args, art });
  else scene.scene.start('town', { ...args, art, town: hoodTownMap(hood, args.town), hood });
  return true;
}
