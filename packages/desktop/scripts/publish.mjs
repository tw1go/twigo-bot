// npm run desktop:publish -- <ssh-target> [version] [--dry] [--from=<dir>]: publishes the desktop app's installers from the
// Desktop app workflow's artifacts (mikazuki-windows-<v>.zip and mikazuki-mac-<v>.zip in ~/Downloads, or the unzipped
// folders of the same names in --from's directory, as the workflow's own publish job has them; the newest version there
// unless one is given). On a Mac (it opens the .dmg): packs Mikazuki.app as the Mac update (Mikazuki.app.tar.gz), signs it
// and the Windows setup .exe with the updater's key (~/.tauri/mikazuki-updater.key, or the file MIKAZUKI_UPDATER_KEY names;
// bound to the version: the app's updater requires it), writes latest.json (the front page's buttons, and `platforms` for
// the updater) and uploads them to /opt/twigo-bot/web/downloads, latest.json last, then removes older versions there.
// --dry stops before uploading.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const from = args.find((a) => a.startsWith('--from='))?.slice('--from='.length);
const [target, wanted] = args.filter((a) => !a.startsWith('--'));
if (!target && !dry) throw new Error('Usage: npm run desktop:publish -- <ssh-target> [version] [--dry] [--from=<dir>]');
const KEY = process.env.MIKAZUKI_UPDATER_KEY || join(homedir(), '.tauri', 'mikazuki-updater.key');
if (!existsSync(KEY)) throw new Error(`No updater key at ${KEY}: updates can't be signed without it.`);
const SITE = 'https://twigo.dev/downloads';
const DIR = '/opt/twigo-bot/web/downloads';
const run = (cmd, a, o = {}) => execFileSync(cmd, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...o });

// The artifacts: zips, or folders already unzipped (the workflow's publish job).
const downloads = from ?? join(homedir(), 'Downloads');
const zipOf = (os) => readdirSync(downloads).map((f) => new RegExp(`^mikazuki-${os}-(\\d+\\.\\d+\\.\\d+)(\\.zip)?$`).exec(f)).filter(Boolean);
const versions = [...new Set([...zipOf('windows'), ...zipOf('mac')].map((m) => m[1]))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const version = wanted?.replace(/^v/, '') ?? versions.at(-1);
if (!version) throw new Error(`No mikazuki-windows-<v>.zip / mikazuki-mac-<v>.zip in ${downloads}`);
const work = join(tmpdir(), `mikazuki-publish-${version}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const out = join(work, 'out');
mkdirSync(out);
const find = (dir, re) => {
  for (const f of readdirSync(dir, { recursive: true })) if (re.test(String(f))) return join(dir, String(f));
  return null;
};
const unzip = (os) => {
  const folder = join(downloads, `mikazuki-${os}-${version}`);
  if (existsSync(folder) && statSync(folder).isDirectory()) return folder;
  const zip = `${folder}.zip`;
  if (!existsSync(zip)) return null;
  const to = join(work, os);
  run('unzip', ['-q', '-o', zip, '-d', to]);
  return to;
};

// Signs a file for the updater, bound to this version; its signature (the .sig's text).
const sign = (file) => {
  run('npx', ['tauri', 'signer', 'sign', '-f', KEY, '--app-version', version, file], { env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '' }, cwd: new URL('..', import.meta.url).pathname });
  return readFileSync(`${file}.sig`, 'utf8').trim();
};

const latest = { version: `v${version}`, pub_date: new Date().toISOString(), platforms: {} };

const win = unzip('windows');
const exe = win && find(win, new RegExp(`nsis/Mikazuki_${version.replace(/\./g, '\\.')}_x64-setup\\.exe$`));
if (exe) {
  const name = `Mikazuki_${version}_x64-setup.exe`;
  cpSync(exe, join(out, name));
  latest.windows = `${SITE}/${name}`;
  latest.windowsSize = statSync(join(out, name)).size;
  latest.platforms['windows-x86_64'] = { url: latest.windows, signature: sign(join(out, name)) };
}

const mac = unzip('mac');
const dmg = mac && find(mac, new RegExp(`Mikazuki_${version.replace(/\./g, '\\.')}_universal\\.dmg$`));
if (dmg) {
  const name = `Mikazuki_${version}_universal.dmg`;
  cpSync(dmg, join(out, name));
  latest.mac = `${SITE}/${name}`;
  latest.macSize = statSync(join(out, name)).size;
  // The update is the app itself, packed (the updater swaps it in place); one universal app for both Macs.
  const mount = join(work, 'mnt');
  mkdirSync(mount);
  run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, dmg]);
  try {
    run('ditto', [join(mount, 'Mikazuki.app'), join(work, 'app', 'Mikazuki.app')]);
  } finally {
    run('hdiutil', ['detach', '-quiet', mount]);
  }
  const tgz = `Mikazuki_${version}_universal.app.tar.gz`;
  run('tar', ['-czf', join(out, tgz), '-C', join(work, 'app'), 'Mikazuki.app'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  const update = { url: `${SITE}/${tgz}`, signature: sign(join(out, tgz)) };
  latest.platforms['darwin-aarch64'] = update;
  latest.platforms['darwin-x86_64'] = update;
}
if (!exe && !dmg) throw new Error(`No installers for ${version} in the artifacts`);
writeFileSync(join(out, 'latest.json'), JSON.stringify(latest, null, 2) + '\n');
for (const f of readdirSync(out)) console.log(`[publish] ${f} ${statSync(join(out, f)).size}`);
if (dry) {
  console.log(`[publish] --dry: ready in ${out}, nothing uploaded`);
  process.exit(0);
}

// Upload: the files first, latest.json last (it never points at a file that isn't there yet), then older versions go.
const files = readdirSync(out).filter((f) => !f.endsWith('.sig') && f !== 'latest.json');
run('scp', ['-q', ...files.map((f) => join(out, f)), join(out, 'latest.json'), `${target}:/tmp/`], { stdio: 'inherit' });
const keep = new Set(files);
run('ssh', [target, [
  `sudo mkdir -p ${DIR}`,
  ...files.map((f) => `sudo mv /tmp/${f} ${DIR}/${f}`),
  `sudo mv /tmp/latest.json ${DIR}/latest.json`,
  `sudo chmod 644 ${DIR}/*`,
  `cd ${DIR} && for f in Mikazuki_*; do case " ${[...keep].join(' ')} " in *" $f "*) ;; *) sudo rm -f "$f" ;; esac; done`,
  `ls -l ${DIR}`,
].join(' && ')], { stdio: 'inherit' });
console.log(`[publish] v${version} is live: ${SITE}/latest.json`);
