#!/usr/bin/env bash
# Deploy to the server: ./deploy/deploy.sh user@SERVER_IP
# Normally run by GitHub Actions on every push to main (.github/workflows/deploy.yml); by hand only as a fallback.
#
# Server layout (/opt/twigo-bot, the monorepo root):
#   .env, data/              untouched by deploys (.env lives only on the server: deploy/push-env.sh replaces it on
#                            purpose; data/ is live state, backed up to data/backups/pre-deploy-<commit>.db first)
#   package.json, package-lock.json, packages/*/package.json   workspace manifests (npm needs all of them)
#   packages/bot/dist        the built bot, run by systemd (deploy/twigo-bot.service)
#   packages/shared/dist     built shared types (the bot only imports types, so nothing loads it at runtime)
#   web/play                 the built web game, served by Caddy at /play (deploy/Caddyfile)
#
# Steps: build here → back up the database → upload → install the bot's dependencies if the lockfile changed →
# Caddy and systemd config → restart → register the slash commands → check the bot logged in and /health answers.
# Any failure stops the deploy with a non-zero exit (the pipeline shows it red).
set -euo pipefail
TARGET="${1:?usage: deploy/deploy.sh user@host}"
cd "$(dirname "$0")/.."
COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo manual)"

npm run build

# Back up the live database first (SQLite's online backup, safe while the bot runs); keep the last 5.
ssh "$TARGET" "set -e
  cd /opt/twigo-bot
  if [ -f data/mikazuki.db ]; then
    sudo -u twigo mkdir -p data/backups
    sudo -u twigo node --input-type=commonjs -e \"
      const Database = require('better-sqlite3');
      const db = new Database('data/mikazuki.db', { readonly: true, fileMustExist: true });
      db.backup('data/backups/pre-deploy-$COMMIT.db').then(() => { db.close(); console.log('database backed up: pre-deploy-$COMMIT.db'); });
    \"
    ls -1t data/backups/pre-deploy-*.db 2>/dev/null | tail -n +6 | sudo xargs -r rm -f
  fi"

# Code + manifests. Sources, the game's build, local state and .env stay behind. Excluded paths are also protected
# from --delete on the server, so .env, data/, node_modules/ and web/ are never removed.
rsync -az --delete \
  --exclude node_modules --exclude /data --exclude /web --exclude .git --exclude .deps-installed \
  --exclude /.env --exclude '/.env.bak*' --exclude /CLAUDE.local.md --exclude /packages/game/_to_delete \
  --exclude 'packages/*/src' --exclude 'packages/*/scripts' --exclude 'packages/*/tsconfig.json' \
  --exclude 'packages/game/dist' --exclude 'packages/game/index.html' --exclude 'packages/game/vite.config.ts' \
  --rsync-path="sudo rsync" \
  ./ "$TARGET:/opt/twigo-bot/"

# The web game, as static files for Caddy.
# rsync only creates one missing folder level, so make sure web/play exists first.
rsync -az --delete --rsync-path="sudo mkdir -p /opt/twigo-bot/web/play && sudo rsync" packages/game/dist/ "$TARGET:/opt/twigo-bot/web/play/"

ssh "$TARGET" 'set -e
  cd /opt/twigo-bot
  test -f .env || { echo "No .env on the server: run deploy/push-env.sh first." >&2; exit 1; }
  sudo chown -R twigo:twigo /opt/twigo-bot
  sudo chmod 600 .env
  sudo chmod -R a+rX web   # Caddy reads the game files
  # Reinstall the bot'"'"'s runtime dependencies only when the lockfile changed, with the bot stopped (a running
  # bot crashes if node_modules is swapped out underneath it). The game'"'"'s packages (Phaser, Vite) are not installed.
  if ! sha256sum -c --status .deps-installed 2>/dev/null; then
    sudo systemctl stop twigo-bot 2>/dev/null || true
    sudo -u twigo npm ci --omit=dev --no-audit --no-fund -w @mikazuki/bot
    sha256sum package-lock.json | sudo -u twigo tee .deps-installed >/dev/null
  fi
  # Caddy: install deploy/Caddyfile when it changed (validated first; the old one is kept as Caddyfile.bak).
  if ! sudo cmp -s deploy/Caddyfile /etc/caddy/Caddyfile; then
    caddy validate --config deploy/Caddyfile --adapter caddyfile >/dev/null 2>&1
    sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak
    sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
    sudo systemctl reload caddy
    echo "Caddyfile updated"
  fi
  sudo cp deploy/twigo-bot.service /etc/systemd/system/twigo-bot.service
  sudo systemctl daemon-reload
  sudo systemctl enable twigo-bot
  since=$(date "+%Y-%m-%d %H:%M:%S")
  sudo systemctl restart twigo-bot

  # Slash commands, registered with the server'"'"'s .env and a throwaway data folder (never the live database).
  tmp=$(sudo -u twigo mktemp -d)
  sudo -u twigo env DATA_DIR="$tmp" ENV_FILE=/opt/twigo-bot/.env node packages/bot/dist/deploy-commands.js
  sudo rm -rf "$tmp"

  # The bot must log in to Discord and answer /health within 60 s.
  for i in $(seq 1 30); do
    if sudo journalctl -u twigo-bot --since "$since" --no-pager | grep -q "Logged in as" && curl -sf http://127.0.0.1:8787/health >/dev/null; then
      sudo systemctl --no-pager status twigo-bot | head -3
      sudo journalctl -u twigo-bot --since "$since" --no-pager | tail -5
      echo "Deployed: the bot is logged in and /health answers."
      exit 0
    fi
    sleep 2
  done
  echo "The bot did not come up within 60 s:" >&2
  sudo journalctl -u twigo-bot --since "$since" --no-pager | tail -30 >&2
  exit 1'
