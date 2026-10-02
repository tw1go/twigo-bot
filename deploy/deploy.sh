#!/usr/bin/env bash
# Deploy from this machine to the server: ./deploy/deploy.sh user@SERVER_IP
#
# Server layout (/opt/twigo-bot, the monorepo root):
#   .env, data/              untouched by deploys (data/ is excluded; .env is uploaded from here)
#   package.json, package-lock.json, packages/*/package.json   workspace manifests (npm needs all of them)
#   packages/bot/dist        the built bot, run by systemd (deploy/twigo-bot.service)
#   packages/shared/dist     built shared types (the bot only imports types, so nothing loads it at runtime)
#   web/play                 the built web game, served by Caddy at /play (deploy/Caddyfile)
set -euo pipefail
TARGET="${1:?usage: deploy/deploy.sh user@host}"
cd "$(dirname "$0")/.."

npm run build

# Code + manifests. Sources, the game's build and local state stay behind. Excluded paths are also protected
# from --delete on the server, so data/, node_modules/ and web/ are never removed.
rsync -az --delete \
  --exclude node_modules --exclude /data --exclude /web --exclude .git --exclude .deps-installed \
  --exclude 'packages/*/src' --exclude 'packages/*/scripts' --exclude 'packages/*/tsconfig.json' \
  --exclude 'packages/game/dist' --exclude 'packages/game/index.html' --exclude 'packages/game/vite.config.ts' \
  --rsync-path="sudo rsync" \
  ./ "$TARGET:/opt/twigo-bot/"

# The web game, as static files for Caddy.
rsync -az --delete --rsync-path="sudo rsync" packages/game/dist/ "$TARGET:/opt/twigo-bot/web/play/"

ssh "$TARGET" 'set -e
  cd /opt/twigo-bot
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
  sudo cp deploy/twigo-bot.service /etc/systemd/system/twigo-bot.service
  sudo systemctl daemon-reload
  sudo systemctl enable twigo-bot
  sudo systemctl restart twigo-bot
  sleep 3
  sudo systemctl --no-pager status twigo-bot | head -5
  sudo journalctl -u twigo-bot -n 10 --no-pager'
