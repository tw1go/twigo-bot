// Builds the game (npm run build: shared, bot, game) and copies what the desktop app bundles into web/play/: the game's
// page and its assets/ (not the front page, the service worker or the home screen app's files: the app's art is inside
// it already). The window opens play/index.html, so the game's /play/… paths resolve inside the app as on the website.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const dist = `${root}packages/game/dist/`;
const web = fileURLToPath(new URL('../web/', import.meta.url));
if (!process.argv.includes('--no-build')) execSync('npm run build', { cwd: root, stdio: 'inherit' });
if (!existsSync(`${dist}index.html`)) throw new Error('No game build: run npm run build first.');
rmSync(web, { recursive: true, force: true });
mkdirSync(`${web}play`, { recursive: true });
for (const f of ['index.html', 'favicon.ico', 'version.json']) cpSync(`${dist}${f}`, `${web}play/${f}`);
cpSync(`${dist}assets`, `${web}play/assets`, { recursive: true });
console.log('[desktop] staged the game into packages/desktop/web/play');
