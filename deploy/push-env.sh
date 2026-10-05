#!/usr/bin/env bash
# Replace the server's .env with this machine's, on purpose: ./deploy/push-env.sh user@SERVER_IP
# Deploys never touch .env (the server's copy is the one that counts); use this after changing a setting locally.
# The server's previous .env is kept as .env.bak-<date-time> (same owner, mode 600). The bot restarts to read it.
set -euo pipefail
TARGET="${1:?usage: deploy/push-env.sh user@host}"
cd "$(dirname "$0")/.."
test -f .env || { echo "No local .env." >&2; exit 1; }

stamp=$(date +%Y%m%d-%H%M%S)
scp -q .env "$TARGET:/tmp/twigo.env.new"
ssh "$TARGET" "set -e
  cd /opt/twigo-bot
  if [ -f .env ]; then sudo cp -p .env .env.bak-$stamp; fi
  sudo install -o twigo -g twigo -m 600 /tmp/twigo.env.new .env
  rm -f /tmp/twigo.env.new
  sudo systemctl restart twigo-bot
  echo '.env replaced (previous kept as .env.bak-$stamp); bot restarted'"
