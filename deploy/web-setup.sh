#!/usr/bin/env bash
# One-time: HTTPS for the room API. Run on the server as root:
#   ssh ubuntu@SERVER 'sudo bash -s' < deploy/web-setup.sh your-name.duckdns.org
set -euo pipefail
DOMAIN="${1:?usage: web-setup.sh your-name.duckdns.org}"
PORT="${2:-8787}"

# Caddy, from its official repository.
apt-get update -qq
apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update -qq
apt-get install -y -qq caddy

# Oracle's Ubuntu images ship an iptables REJECT rule: allow 80/443 ahead of it.
# (The VCN security list in the Oracle console must allow them too.)
for p in 80 443; do
  if ! iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null; then
    # Insert just above the first REJECT rule (its position varies), or append if there is none.
    reject=$(iptables -L INPUT --line-numbers -n | awk '$2 == "REJECT" {print $1; exit}')
    if [ -n "$reject" ]; then iptables -I INPUT "$reject" -p tcp --dport "$p" -j ACCEPT; else iptables -A INPUT -p tcp --dport "$p" -j ACCEPT; fi
  fi
done
if command -v netfilter-persistent >/dev/null; then netfilter-persistent save; fi

# Caddy fetches and renews the certificate itself; the bot stays on localhost.
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	reverse_proxy 127.0.0.1:$PORT
}
CADDY
systemctl enable caddy
systemctl reload caddy || systemctl restart caddy
echo "Caddy is serving https://$DOMAIN -> 127.0.0.1:$PORT"
