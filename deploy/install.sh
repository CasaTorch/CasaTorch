#!/usr/bin/env bash
# HouseOS installer for Raspberry Pi OS (64-bit), Debian and Ubuntu.
#
#   curl -fsSL https://gethouseos.com/install.sh | sudo bash          # or, from a clone:  sudo ./deploy/install.sh
#
# Installs Node.js 22 if needed, puts HouseOS in /opt/houseos, keeps settings in
# /var/lib/houseos, and runs it as a service (houseos.service) on port 8090.
# Run it again any time to update; your settings are kept.
set -euo pipefail

REPO="${HOUSEOS_REPO:-https://github.com/gethouseos/houseos.git}"
BRANCH="${HOUSEOS_BRANCH:-main}"
APP_DIR=/opt/houseos
DATA_DIR=/var/lib/houseos
PORT="${HOUSEOS_PORT:-8090}"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run it with sudo"
command -v systemctl >/dev/null || die "this installer needs systemd (use Docker instead: see docs/HARDWARE.md)"
. /etc/os-release 2>/dev/null || true
case "${ID:-}${ID_LIKE:-}" in *debian*|*ubuntu*|*raspbian*) ;; *) die "this installer is for Debian, Ubuntu and Raspberry Pi OS - use Docker on other systems";; esac

say "Checking packages"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git >/dev/null

need_node=1
if command -v node >/dev/null; then major=$(node -p 'process.versions.node.split(".")[0]'); [ "$major" -ge 20 ] && need_node=0; fi
if [ "$need_node" = 1 ]; then
  say "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
say "Node.js $(node -v)"

id houseos >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin houseos
mkdir -p "$DATA_DIR" && chown houseos:houseos "$DATA_DIR" && chmod 700 "$DATA_DIR"

if [ -d "$APP_DIR/.git" ]; then
  say "Updating HouseOS"
  git -C "$APP_DIR" fetch -q origin "$BRANCH" && git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
elif [ -f "$(dirname "$0")/../app/package.json" ] && [ "$(cd "$(dirname "$0")/.." && pwd)" != "$APP_DIR" ]; then
  say "Copying HouseOS from this folder"
  mkdir -p "$APP_DIR" && cp -a "$(cd "$(dirname "$0")/.." && pwd)/." "$APP_DIR/"
else
  say "Downloading HouseOS"
  git clone -q --depth 1 -b "$BRANCH" "$REPO" "$APP_DIR"
fi
chown -R houseos:houseos "$APP_DIR"

say "Installing and building"
cd "$APP_DIR/app"
sudo -u houseos npm ci --omit=dev --no-audit --no-fund --loglevel=error
sudo -u houseos node build.mjs >/dev/null

cat > /etc/systemd/system/houseos.service <<UNIT
[Unit]
Description=HouseOS
After=network-online.target
Wants=network-online.target

[Service]
User=houseos
WorkingDirectory=$APP_DIR/app
Environment=NODE_ENV=production HOUSEOS_DATA_DIR=$DATA_DIR PORT=$PORT
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable -q houseos
systemctl restart houseos
sleep 2
systemctl is-active -q houseos || { journalctl -u houseos -n 30 --no-pager; die "HouseOS did not start - the log is above"; }

ip=$(hostname -I 2>/dev/null | awk '{print $1}')
say "HouseOS is running. Open http://${ip:-this-machine}:$PORT on any screen at home to set it up."
say "Logs: journalctl -u houseos -f    Update: run this installer again."
