// npm run desktop:build: stages the game (scripts/stage.mjs), then builds the app with the game's version (v0.1.N →
// 0.1.N), so the app and /downloads/latest.json speak the same numbers. Installers land in
// src-tauri/target/release/bundle/ (dmg on a Mac; msi and nsis on Windows).
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('../', import.meta.url));
execSync('node scripts/stage.mjs', { cwd: here, stdio: 'inherit' });
const { version } = JSON.parse(readFileSync(`${here}web/play/version.json`, 'utf8'));
const semver = /^v?(\d+\.\d+\.\d+)/.exec(version)?.[1];
if (!semver) throw new Error(`Odd game version ${version}`);
const config = JSON.stringify({ version: semver, build: { beforeBuildCommand: '' } });
execSync(`npx tauri build --config '${config}' ${process.argv.slice(2).join(' ')}`, { cwd: here, stdio: 'inherit' });
