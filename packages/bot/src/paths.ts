import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Where the bot keeps its state and secrets. Every store writes under DATA_DIR and config reads ENV_FILE.
// These used to be relative to the working directory; in the monorepo the bot may run from packages/bot
// (npm workspace scripts) or from the repo root (the server), so they're resolved explicitly:
//   DATA_DIR = $DATA_DIR, else <root>/data      ENV_FILE = $ENV_FILE, else <root>/.env
// where <root> = $TWIGO_ROOT, else the nearest folder up from the working directory whose package.json has
// "workspaces" (the monorepo root), else the working directory. On the server systemd sets DATA_DIR and runs
// from /opt/twigo-bot, so the existing /opt/twigo-bot/data and /opt/twigo-bot/.env are used as before.
function findRoot(): string {
  if (process.env.TWIGO_ROOT) return resolve(process.env.TWIGO_ROOT);
  let dir = process.cwd();
  for (;;) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        if (JSON.parse(readFileSync(pkg, 'utf8')).workspaces) return dir;
      } catch {
        // unreadable package.json: keep looking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

export const ROOT_DIR = findRoot();
export const DATA_DIR = resolve(process.env.DATA_DIR ?? join(ROOT_DIR, 'data'));
export const ENV_FILE = resolve(process.env.ENV_FILE ?? join(ROOT_DIR, '.env'));
