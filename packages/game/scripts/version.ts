import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';
import { packedFiles } from './packs';

// The game's version: v<major.minor from package.json>.<commits on this branch>, e.g. v0.1.153 — it goes up with
// every deploy. A build writes it to version.json next to the page (fetched fresh: see deploy/Caddyfile) and into
// the code as __BUILD__, so an open game can tell when a newer one is live (src/ui/version.ts). Dev: "dev".

export interface BuildInfo {
  version: string;
  commit: string;
  built: string;
}

function git(args: string): string {
  try {
    return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

export function buildInfo(base: string, build: boolean): BuildInfo {
  if (!build) return { version: 'dev', commit: '', built: '' };
  const [major, minor] = base.split('.');
  const count = git('rev-list --count HEAD') || '0';
  const dirty = git('status --porcelain --untracked-files=no') ? '+' : ''; // built with uncommitted changes
  return { version: `v${major}.${minor}.${count}${dirty}`, commit: git('rev-parse --short HEAD'), built: new Date().toISOString() };
}

/** Writes version.json into the build. */
export function versionFile(info: BuildInfo): Plugin {
  return {
    name: 'mikazuki-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify(info)}\n` });
    },
  };
}

/** The files a build's game may keep on the device (asset-files.json, next to version.json), for the page to drop what a
 *  deploy changed (net/pwa.ts tidyCaches): `files`, every loose file under assets/ the game asks for by name (data,
 *  sounds, the art that isn't packed) with the first 10 hex of its SHA-1; `hashed`, the files whose names carry their
 *  content's hash (the art sheets, scripts, stylesheets). The art packed into sheets is left out: never asked for loose. */
export function assetFiles(info: BuildInfo): Plugin {
  let outDir = '';
  return {
    name: 'mikazuki-asset-files',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const assets = join(outDir, 'assets');
      const files: Record<string, string> = {};
      const hashed: string[] = [];
      const walk = (dir: string) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (e.name.startsWith('.')) continue; // (.DS_Store and the like)
          const full = join(dir, e.name);
          if (e.isDirectory()) walk(full);
          else {
            const path = relative(assets, full).split('\\').join('/');
            if (isHashed(path)) hashed.push(`assets/${path}`);
            else if (!packedFiles.has(path)) files[`assets/${path}`] = createHash('sha1').update(readFileSync(full)).digest('hex').slice(0, 10);
          }
        }
      };
      walk(assets);
      writeFileSync(join(outDir, 'asset-files.json'), `${JSON.stringify({ version: info.version, files, hashed: hashed.sort() })}\n`);
    },
  };
}

/** A file named by its content (deploy/Caddyfile's @hashed, the service worker's mk-hashed): a sheet in packs/, or a
 *  script or stylesheet directly in assets/. */
const isHashed = (path: string) => path.startsWith('packs/') || /^[^/]+\.(?:js|css)$/.test(path);
