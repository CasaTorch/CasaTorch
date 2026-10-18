#!/usr/bin/env bash
# CasaTorch installer for Raspberry Pi OS (64-bit), Debian and Ubuntu.
#
#   curl -fsSL https://casatorch.com/install.sh | sudo bash          # or, from a clone:  sudo ./deploy/install.sh
#
# Installs Node.js 22 if needed, puts CasaTorch in /opt/casatorch, keeps settings in
# /var/lib/casatorch, and runs it as a service (casatorch.service) on port 8090.
# Run it again any time to update; your settings are kept.
set -euo pipefail

REPO="${CASATORCH_REPO:-https://github.com/casatorch/casatorch.git}"
BRANCH="${CASATORCH_BRANCH:-main}"
APP_DIR=/opt/casatorch
DATA_DIR=/var/lib/casatorch
PORT="${CASATORCH_PORT:-8090}"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run it with sudo"
command -v systemctl >/dev/null || die "this installer needs systemd (use Docker instead: see docs/HARDWARE.md)"
. /etc/os-release 2>/dev/null || true
case "${ID:-}${ID_LIKE:-}" in *debian*|*ubuntu*|*raspbian*) ;; *) die "this installer is for Debian, Ubuntu and Raspberry Pi OS - use Docker on other systems";; esac

# Enough room to install (about 400 MB with Node.js), and the port free for CasaTorch.
free_mb=$(df -Pm /opt 2>/dev/null | awk 'NR==2 {print $4}')
[ -z "$free_mb" ] || [ "$free_mb" -ge 400 ] || die "only ${free_mb} MB free - CasaTorch needs about 400 MB. Free some space, then run this again."
if command -v ss >/dev/null && ss -ltnH "sport = :$PORT" 2>/dev/null | grep -q . && ! systemctl is-active -q casatorch 2>/dev/null; then
  die "port $PORT is already used by another program. Stop it, or pick another port: CASATORCH_PORT=8095 sudo ./install.sh"
fi

say "Checking packages"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git traceroute iputils-tracepath mtr-tiny >/dev/null

need_node=1
if command -v node >/dev/null; then major=$(node -p 'process.versions.node.split(".")[0]'); [ "$major" -ge 20 ] && need_node=0; fi
if [ "$need_node" = 1 ]; then
  say "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
say "Node.js $(node -v)"

id casatorch >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin casatorch
mkdir -p "$DATA_DIR" && chown casatorch:casatorch "$DATA_DIR" && chmod 700 "$DATA_DIR"

# Before updating: a copy of the settings, sign-ins and key in CasaTorch's settings history
# (Settings > Health can put it back with one tap).
if [ -f "$DATA_DIR/config.json" ]; then
  snap="$DATA_DIR/.settings-history/$(date -u +%Y%m%dT%H%M%SZ)-before-update"
  mkdir -p "$snap" && chmod 700 "$DATA_DIR/.settings-history" "$snap"
  for f in config.json users.json secret.key; do [ -f "$DATA_DIR/$f" ] && cp -p "$DATA_DIR/$f" "$snap/$f"; done
  chown -R casatorch:casatorch "$DATA_DIR/.settings-history" 2>/dev/null || true
  say "Saved a copy of your settings first"
fi

if [ -d "$APP_DIR/.git" ]; then
  say "Updating CasaTorch"
  git -C "$APP_DIR" fetch -q origin "$BRANCH" && git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
elif [ -f "$(dirname "$0")/../app/package.json" ] && [ "$(cd "$(dirname "$0")/.." && pwd)" != "$APP_DIR" ]; then
  say "Copying CasaTorch from this folder"
  mkdir -p "$APP_DIR" && cp -a "$(cd "$(dirname "$0")/.." && pwd)/." "$APP_DIR/"
else
  say "Downloading CasaTorch"
  git clone -q --depth 1 -b "$BRANCH" "$REPO" "$APP_DIR"
fi
chown -R casatorch:casatorch "$APP_DIR"

say "Installing and building"
cd "$APP_DIR/app"
sudo -u casatorch npm ci --omit=dev --no-audit --no-fund --loglevel=error
sudo -u casatorch node build.mjs >/dev/null

cat > /etc/systemd/system/casatorch.service <<UNIT
[Unit]
Description=CasaTorch
After=network-online.target
Wants=network-online.target
# Never give up restarting it (CasaTorch also restarts itself if it ever stops responding).
StartLimitIntervalSec=0

[Service]
User=casatorch
WorkingDirectory=$APP_DIR/app
# CASATORCH_INSTALL tells CasaTorch a service manager runs it: its watchdog may restart a stuck process, and
# Settings > Health can offer "Restart CasaTorch" (systemd starts it again because of Restart=always).
Environment=NODE_ENV=production CASATORCH_DATA_DIR=$DATA_DIR PORT=$PORT CASATORCH_INSTALL=script
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=5
TimeoutStopSec=20
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable -q casatorch
systemctl restart casatorch
# Wait until it answers (up to a minute on a slow Raspberry Pi), not just until the process exists.
up=0
for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then up=1; break; fi
  systemctl is-active -q casatorch || break
  sleep 1
done
[ "$up" = 1 ] || { journalctl -u casatorch -n 30 --no-pager; die "CasaTorch did not start - the log is above"; }
# It knows it runs as a service (self-restart and the watchdog depend on that), not as a copy started by hand.
health=$(curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/health" 2>/dev/null || true)
case "$health" in
  *'"install":"script"'*) say "Service checks passed: restarts and the watchdog are on" ;;
  *) die "CasaTorch is running but doesn't see CASATORCH_INSTALL=script (health: ${health:-no answer}) - check /etc/systemd/system/casatorch.service" ;;
esac

ip=$(hostname -I 2>/dev/null | awk '{print $1}')
say "CasaTorch is running. Open http://${ip:-this-machine}:$PORT on any screen at home to set it up."
say "Logs: journalctl -u casatorch -f    Update: run this installer again."
