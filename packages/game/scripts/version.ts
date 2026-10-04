import { execSync } from 'node:child_process';
import type { Plugin } from 'vite';

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
