#!/usr/bin/env bash
# Deploy from this machine to the server: ./deploy/deploy.sh user@SERVER_IP
set -euo pipefail
TARGET="${1:?usage: deploy/deploy.sh user@host}"
cd "$(dirname "$0")/.."

rm -rf dist && npm run build
rsync -az --delete \
  --exclude node_modules --exclude data --exclude .git --exclude src --exclude .deps-installed \
  --rsync-path="sudo rsync" \
  ./ "$TARGET:/opt/twigo-bot/"
ssh "$TARGET" 'set -e
  cd /opt/twigo-bot
  sudo chown -R twigo:twigo /opt/twigo-bot
  sudo chmod 600 .env
  # Reinstall deps only when the lockfile changed, with the bot stopped (a running
  # bot crashes if node_modules is swapped out underneath it).
  if ! sha256sum -c --status .deps-installed 2>/dev/null; then
    sudo systemctl stop twigo-bot 2>/dev/null || true
    sudo -u twigo npm ci --omit=dev --no-audit --no-fund
    sha256sum package-lock.json | sudo -u twigo tee .deps-installed >/dev/null
  fi
  sudo cp deploy/twigo-bot.service /etc/systemd/system/twigo-bot.service
  sudo systemctl daemon-reload
  sudo systemctl enable twigo-bot
  sudo systemctl restart twigo-bot
  sleep 3
  sudo systemctl --no-pager status twigo-bot | head -5
  sudo journalctl -u twigo-bot -n 10 --no-pager'
