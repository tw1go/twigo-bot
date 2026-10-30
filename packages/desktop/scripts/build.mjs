// npm run desktop:build: stages the start page (scripts/stage.mjs), then builds the app at its own version (tauri.conf.json
// `version`, bumped by hand when the app itself changes: packages/desktop, its Rust or its Tauri plugins; the game is the live
// site's and never needs a new app). Installers land in src-tauri/target/release/bundle/ (dmg on a Mac; msi and nsis on
// Windows).
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('../', import.meta.url));
execSync('node scripts/stage.mjs', { cwd: here, stdio: 'inherit' });
const config = JSON.stringify({ build: { beforeBuildCommand: '' } });
// (Arguments pass straight through, e.g. --bundles app, or another --config, which Tauri merges over this one.)
execFileSync('npx', ['tauri', 'build', '--config', config, ...process.argv.slice(2)], { cwd: here, stdio: 'inherit' });
