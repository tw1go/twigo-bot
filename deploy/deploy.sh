#!/usr/bin/env bash
# Deploy from this machine to the server: ./deploy/deploy.sh user@SERVER_IP
set -euo pipefail
TARGET="${1:?usage: deploy/deploy.sh user@host}"
cd "$(dirname "$0")/.."

npm run build
rsync -az --delete \
  --exclude node_modules --exclude data --exclude .git --exclude src \
  --rsync-path="sudo rsync" \
  ./ "$TARGET:/opt/twigo-bot/"
ssh "$TARGET" 'set -e
  cd /opt/twigo-bot
  sudo chown -R twigo:twigo /opt/twigo-bot
  sudo chmod 600 .env
  sudo -u twigo npm ci --omit=dev --no-audit --no-fund
  sudo cp deploy/twigo-bot.service /etc/systemd/system/twigo-bot.service
  sudo systemctl daemon-reload
  sudo systemctl enable twigo-bot
  sudo systemctl restart twigo-bot
  sleep 3
  sudo systemctl --no-pager status twigo-bot | head -5
  sudo journalctl -u twigo-bot -n 10 --no-pager'
