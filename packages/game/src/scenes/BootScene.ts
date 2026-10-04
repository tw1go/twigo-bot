import Phaser from 'phaser';
import type { Manifest, TownMap } from '../assets/types';
import { queueSheet } from '../assets/queue';
import { loadMe, loginProblem } from '../session';
import { loadCursors } from '../ui/cursor';
import { showLogin, showTestersOnly } from '../ui/login';

// Loads the two source-of-truth files, then: not logged in → the login screen; logged in without a saved look or
// nickname → the character creator; otherwise the town (which queues every image they name). If login is off on the server
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
    // ...and for the UI font and the cursor art, so the town's name plates and cursor are right from the start.
    const font = Promise.race([document.fonts.load('10px "Pixelify Sans"').catch(() => null), new Promise((r) => setTimeout(r, 2500))]);
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
      if (me?.status === 'ok' && !me.me.canPlay) return showTestersOnly(me.me.name);
      if (me?.status === 'ok' && (!me.me.outfit || !me.me.nickname)) return this.scene.start('create', { manifest, town, me });
      this.scene.start('town', { manifest, town, me });
    });
  }
}
