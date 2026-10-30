// Stages what the desktop app bundles: its start page (web/index.html, kept in the repo) and the game's logo beside it
// (web/logo.png, copied from the game's assets). Since 1.0.0 the game itself isn't inside the app: the start page opens the
// live game at https://twigo.dev/play/, so a game change never needs a new app. A web/play/ left from an older build goes.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const web = fileURLToPath(new URL('../web/', import.meta.url));
if (!existsSync(`${web}index.html`)) throw new Error('No start page at packages/desktop/web/index.html');
rmSync(`${web}play`, { recursive: true, force: true });
cpSync(`${root}packages/game/public/assets/ui/ui-logo-mikazuki.png`, `${web}logo.png`);
console.log('[desktop] staged the start page and its logo into packages/desktop/web');
