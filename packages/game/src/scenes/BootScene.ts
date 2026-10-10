import Phaser from 'phaser';
import type { Manifest, TownMap } from '../assets/types';
import { queueSheet } from '../assets/queue';
import { loadMe, loginProblem } from '../session';
import { loadCursors } from '../ui/cursor';
import { showLogin } from '../ui/login';
import { loadHouseArt } from '../houses/art';
import { currentArea, freshVisit, markHood, markSlums, markTown, slumsTownMap } from '../net/hood';
import { bootHood } from './HouseScene';

// Loads the two source-of-truth files, then: not logged in → the login screen; logged in without a saved look or
// nickname → the character creator; otherwise the town (which queues every image they name), or with ?area=hood the
// neighbourhood (after building a house, the first time: scenes/HouseScene.ts), with ?area=slums the Slums
// (maps/slums.json), or with ?area=warrens your Scrap Warrens run (maps/warrens.json). If login is off on the server
// (or the API is down), everyone goes straight to the town with a look saved in this browser.
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload(): void {
    this.load.setPath(`${import.meta.env.BASE_URL}assets/`);
    this.load.json('manifest', 'manifest.json');
    this.load.json('town', 'maps/town.json');
  }

  create(): void {
    const manifest = this.cache.json.get('manifest') as Manifest;
    const town = this.cache.json.get('town') as TownMap;
    const debug = new URLSearchParams(location.search).get('debug');
    // Wait briefly for the login, so a saved look is on the player from the first frame.
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 2500));
    // ...and for the UI fonts (the digits' too) and the cursor art, so the town's name plates and cursor are right from the start.
    const fonts = Promise.all([document.fonts.load('10px "Pixelify Sans"'), document.fonts.load('10px "Mk Numbers"', '0123456789')]).catch(() => null);
    const font = Promise.race([fonts, new Promise((r) => setTimeout(r, 2500))]);
    const cursors = Promise.race([loadCursors(manifest), new Promise((r) => setTimeout(r, 2500))]);
    // ...and for the loading moon, so it's there above the bar while the town's art downloads.
    const moon = new Promise<void>((done) => {
      const m = manifest.ui.loadingMoon;
      if (!m) return done();
      queueSheet(this.load, this.textures, m.file, m.size[0], m.size[1]);
      this.load.once(Phaser.Loader.Events.COMPLETE, () => done());
      this.load.start();
    });
    void Promise.all([Promise.race([loadMe(), timeout]), font, cursors, moon]).then(([me]) => {
      if (debug === 'wardrobe') return this.scene.start('wardrobe', { manifest });
      if (me?.status === 'anon') return showLogin(loginProblem());
      if (me?.status === 'ok' && (!me.me.outfit || !me.me.nickname)) return this.scene.start('create', { manifest, town, me });
      // A fresh visit with a house of your own: the neighbourhood, at your door (not after a gate, which led to the town,
      // nor on a reload, which stays where you were).
      if (currentArea() === 'town' && freshVisit() && me?.status === 'ok' && me.me.house) markHood();
      // ?area=hood: the neighbourhood (members only; the town if it can't be reached).
      if (currentArea() === 'hood' && me?.status === 'ok') {
        void loadHouseArt(manifest).then(async (art) => (await bootHood(this, { manifest, town, me }, art)) || this.scene.start('town', { manifest, town, me }));
        return;
      }
      // ?area=slums: the Slums, for every member (a guest, or a map that won't load, lands back in town). ?area=warrens:
      // your Scrap Warrens run (maps/warrens.json; the server puts you in it, or sends you back to the Slums).
      const area = currentArea();
      if (area === 'slums' || area === 'warrens') {
        if (me?.status !== 'ok') {
          markTown();
          return this.scene.start('town', { manifest, town, me });
        }
        this.load.json(area, `maps/${area}.json`);
        this.load.once(Phaser.Loader.Events.COMPLETE, () => {
          const json = this.cache.json.get(area) as TownMap | undefined;
          if (!json) area === 'warrens' ? markSlums() : markTown();
          this.scene.start('town', json ? { manifest, town: slumsTownMap(json), me, area } : { manifest, town, me });
        });
        this.load.start();
        return;
      }
      this.scene.start('town', { manifest, town, me });
    });
  }
}
