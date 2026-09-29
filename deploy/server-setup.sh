#!/usr/bin/env bash
# One-time server setup (Debian/Ubuntu). Run with sudo.
set -euo pipefail

# Node 22
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# e2-micro has 1 GB RAM — add swap so npm install doesn't run out of memory
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

id twigo >/dev/null 2>&1 || useradd --system --home /opt/twigo-bot --shell /usr/sbin/nologin twigo
mkdir -p /opt/twigo-bot
chown -R twigo:twigo /opt/twigo-bot
