#!/usr/bin/env bash
# CasaTorch installer for Raspberry Pi OS (64-bit), Debian and Ubuntu.
#
#   curl -fsSL https://casatorch.com/install.sh | sudo bash          # or, from a clone:  sudo ./deploy/install.sh
#
# Installs Node.js 22 if needed, puts CasaTorch in /opt/casatorch, keeps settings in
# /var/lib/casatorch, and runs it as a service (casatorch.service) on port 8090.
# Run it again any time to update; your settings are kept. Before updating it saves a copy of the settings, and
# if the new version doesn't start it goes back to the one you had (Settings > Updates shows how it went).
#
# It installs the newest *release* (a version tag such as v0.8.1), never the work in progress on `main`, and checks
# every file against the release's checksums signed with CasaTorch's offline release key (the same key the Linux/Pi
# updater trusts) before anything is built or run. Releases made before 0.8.0 have no signed file list: then it says
# so and carries on (CASATORCH_REQUIRE_SIGNED=1 stops instead). Developers: CASATORCH_REF=main (or any branch/tag)
# installs that instead, without the check.
# Everything is inside main(), so a download cut off halfway runs nothing.
set -euo pipefail

main() {
REPO="${CASATORCH_REPO:-https://github.com/casatorch/casatorch.git}"
REF="${CASATORCH_REF:-${CASATORCH_BRANCH:-}}"   # empty: the newest release
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
# (Settings > Health can put it back with one tap), and which version is installed now (to go back to).
snap=""; prev=""; prev_ver=""
if [ -d "$APP_DIR/.git" ]; then prev=$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || true); prev_ver=$(node -p "require('$APP_DIR/app/package.json').version" 2>/dev/null || true); fi
upd_status() {   # for Settings > Updates and the "An update didn't work" troubleshooter
  [ -n "$prev" ] || return 0
  new_ver=$(node -p "require('$APP_DIR/app/package.json').version" 2>/dev/null || true)
  printf '{"state":"%s","from":"%s","to":"%s","at":"%s","message":"%s"}\n' "$1" "$prev_ver" "${3:-$new_ver}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${2:-}" > "$DATA_DIR/.update-status.json" 2>/dev/null || true
  chown casatorch:casatorch "$DATA_DIR/.update-status.json" 2>/dev/null || true; chmod 600 "$DATA_DIR/.update-status.json" 2>/dev/null || true
}
if [ -f "$DATA_DIR/config.json" ]; then
  snap="$DATA_DIR/.settings-history/$(date -u +%Y%m%dT%H%M%SZ)-before-update"
  mkdir -p "$snap" && chmod 700 "$DATA_DIR/.settings-history" "$snap"
  for f in config.json users.json secret.key; do [ -f "$DATA_DIR/$f" ] && cp -p "$DATA_DIR/$f" "$snap/$f"; done
  chown -R casatorch:casatorch "$DATA_DIR/.settings-history" 2>/dev/null || true
  say "Saved a copy of your settings first"
fi

# Which version (for a download or an update): the newest published release, unless asked for something else.
GH=""; case "$REPO" in https://github.com/*) GH="${REPO%.git}" ;; esac
release=0
resolve_ref() {
  if [ -z "$REF" ]; then
    [ -n "$GH" ] && REF=$(curl -fsSLI -o /dev/null -w '%{url_effective}' --max-time 30 "$GH/releases/latest" 2>/dev/null | sed -n 's#.*/releases/tag/##p' || true)
    [ -n "$REF" ] || REF=$(git ls-remote --tags --refs "$REPO" 'v*' 2>/dev/null | sed 's#.*refs/tags/##' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1 || true)
    [ -n "$REF" ] || die "couldn't find the newest CasaTorch release - check the internet connection and try again"
  fi
  if printf '%s' "$REF" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; then release=1; fi
  say "Version: $REF"
}
fetched=0; fresh=0
if [ -d "$APP_DIR/.git" ]; then
  resolve_ref
  say "Updating CasaTorch"
  git -C "$APP_DIR" fetch -q origin "$REF" && git -C "$APP_DIR" reset -q --hard FETCH_HEAD
  fetched=1
elif [ -f "$(dirname "$0")/../app/package.json" ] && [ "$(cd "$(dirname "$0")/.." && pwd)" != "$APP_DIR" ]; then
  say "Copying CasaTorch from this folder"
  mkdir -p "$APP_DIR" && cp -a "$(cd "$(dirname "$0")/.." && pwd)/." "$APP_DIR/"
else
  resolve_ref
  say "Downloading CasaTorch"
  git clone -q --depth 1 -b "$REF" "$REPO" "$APP_DIR"
  fetched=1; fresh=1
fi
# Check what was downloaded against the signed release before anything of it runs.
if [ "$fetched" = 1 ]; then
  vrc=0
  if [ "$release" = 1 ] && [ -n "$GH" ]; then
    say "Checking the download against CasaTorch's signed release"
    verify_release "$GH/releases/download/$REF" || vrc=$?
  else
    vrc=3
  fi
  if [ "$vrc" = 1 ]; then
    if [ "$fresh" = 1 ]; then rm -rf "$APP_DIR"; elif [ -n "$prev" ]; then git -C "$APP_DIR" reset -q --hard "$prev" || true; fi
    die "The download doesn't match CasaTorch's signed release, so nothing was installed or changed. Try again later, or ask at support@casatorch.com."
  elif [ "$vrc" != 0 ]; then
    [ "${CASATORCH_REQUIRE_SIGNED:-0}" = 1 ] && { if [ "$fresh" = 1 ]; then rm -rf "$APP_DIR"; elif [ -n "$prev" ]; then git -C "$APP_DIR" reset -q --hard "$prev" || true; fi; die "$REF has no signed file list to check (CASATORCH_REQUIRE_SIGNED=1)"; }
    if [ "$vrc" = 2 ]; then say "Note: $REF was released before signed file lists - installing it from GitHub over HTTPS without that check"
    else say "Note: $REF is not a release - installing it without the signature check"; fi
  fi
fi
chown -R casatorch:casatorch "$APP_DIR"

say "Installing and building"
cd "$APP_DIR/app"
sudo -u casatorch npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error
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
# An update that doesn't start: go back to the version (and the settings) from before.
if [ "$up" != 1 ] && [ -n "$prev" ] && [ "$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null)" != "$prev" ]; then
  journalctl -u casatorch -n 30 --no-pager || true
  failed_ver=$(node -p "require('$APP_DIR/app/package.json').version" 2>/dev/null || true)
  say "The new version didn't start - going back to the one you had"
  systemctl stop casatorch || true
  git -C "$APP_DIR" reset -q --hard "$prev" && chown -R casatorch:casatorch "$APP_DIR"
  (cd "$APP_DIR/app" && sudo -u casatorch npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error && sudo -u casatorch node build.mjs >/dev/null)
  if [ -n "$snap" ]; then
    for f in config.json users.json secret.key; do if [ -f "$snap/$f" ]; then cp -p "$snap/$f" "$DATA_DIR/$f"; fi; done
    chown casatorch:casatorch "$DATA_DIR/config.json" "$DATA_DIR/users.json" "$DATA_DIR/secret.key" 2>/dev/null || true
  fi
  systemctl restart casatorch || true
  upd_status rolled-back "Version ${failed_ver:-new} didn't start, so the installer put back ${prev_ver:-the previous version} with your settings from before." "$failed_ver"
  die "The update didn't start, so CasaTorch went back to the version you had, with your settings from before. Try again later."
fi
[ "$up" = 1 ] || { journalctl -u casatorch -n 30 --no-pager; die "CasaTorch did not start - the log is above"; }
[ -z "$prev" ] || [ "$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null)" = "$prev" ] || upd_status done
# It knows it runs as a service (self-restart and the watchdog depend on that), not as a copy started by hand.
health=$(curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/health" 2>/dev/null || true)
case "$health" in
  *'"install":"script"'*) say "Service checks passed: restarts and the watchdog are on" ;;
  *) die "CasaTorch is running but doesn't see CASATORCH_INSTALL=script (health: ${health:-no answer}) - check /etc/systemd/system/casatorch.service" ;;
esac

ip=$(hostname -I 2>/dev/null | awk '{print $1}')
say "CasaTorch is running. Open http://${ip:-this-machine}:$PORT on any screen at home to set it up."
say "Logs: journalctl -u casatorch -f    Update: run this installer again."
}

# Checks $APP_DIR (a git checkout) against the release at $1: 0 verified, 2 no signed file list, 1 wrong.
verify_release() {
  local vt rc=0
  vt=$(mktemp -d)
  for f in SHA256SUMS SHA256SUMS.sig casatorch-source-files.sha256; do curl -fsSL --max-time 60 -o "$vt/$f" "$1/$f" 2>/dev/null || rm -f "$vt/$f"; done
  cat > "$vt/verify-release.js" <<'VERIFY_JS'
// verify-release.js - checks a CasaTorch source tree against the release's signed checksums, before it is built or run.
// Used by deploy/install.sh, deploy/install.ps1 and the Home Assistant add-on build (keep the copies the same:
// app/test/security-unit.mjs checks). Needs Node.js 20+ only.
//
//   node verify-release.js <dir> <SHA256SUMS> <SHA256SUMS.sig> <casatorch-source-files.sha256> [<list of files>]
//
// SHA256SUMS must carry CasaTorch's offline release signature (Ed25519, the key below - the same one the Linux/Pi
// updater trusts), list casatorch-source-files.sha256 with the right checksum, and every file in that list must be in
// <dir> with the right checksum. With no <list of files>, <dir> must hold nothing else (a fresh download); with one
// (e.g. `git ls-files` of a checkout), that list must match exactly.
// Exit codes: 0 verified; 2 the release has no signed file list (made before 0.8.0); 1 anything else is wrong.
'use strict';
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const RELEASE_KEY = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAjZpfFYZVcjzY0N8vFCEfIX7l6t5E7SSRB6Cfe2LdzIY=\n-----END PUBLIC KEY-----\n';
const LIST = 'casatorch-source-files.sha256';
const stop = (msg, code = 1) => { process.stderr.write(`verify-release: ${msg}\n`); process.exit(code); };
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const sums = (txt) => new Map(String(txt).split('\n').map((l) => l.match(/^([0-9a-f]{64}) [ *](.+)$/)).filter(Boolean).map((m) => [m[2], m[1]]));
const [dir, sumsFile, sigFile, listFile, namesFile] = process.argv.slice(2);
if (!dir || !sumsFile || !sigFile || !listFile) stop('usage: verify-release.js <dir> <SHA256SUMS> <SHA256SUMS.sig> <file list> [names]');
const read = (f) => { try { return fs.readFileSync(f); } catch { return null; } };
const S = read(sumsFile), G = read(sigFile);
if (!S || !G) stop('the release has no signed checksums', 2);
const key = process.env.CASATORCH_RELEASE_KEY_FILE ? fs.readFileSync(process.env.CASATORCH_RELEASE_KEY_FILE, 'utf8') : RELEASE_KEY;   // tests only
let good = false; try { good = crypto.verify(null, S, key, G); } catch { good = false; }
if (!good) stop('SHA256SUMS is not signed by CasaTorch\'s release key');
const signed = sums(S);
if (!signed.has(LIST)) stop('this release has no signed file list', 2);
const L = read(listFile);
if (!L || sha(L) !== signed.get(LIST)) stop(`${LIST} doesn't match the signed release`);
const want = sums(L);
if (!want.size) stop(`${LIST} is empty`);
for (const [name, h] of want) {
  const full = path.resolve(dir, name);
  if (!full.startsWith(path.resolve(dir) + path.sep)) stop(`bad path in the list: ${name}`);
  const b = read(full);
  if (!b) stop(`missing: ${name}`);
  if (sha(b) !== h) stop(`changed: ${name}`);
}
let have;
if (namesFile) have = String(read(namesFile) || '').split(/\r?\n/).filter(Boolean);
else {
  have = []; const walk = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(path.join(d, e.name), r); else have.push(r); } };
  walk(path.resolve(dir), '');
}
const extra = have.filter((n) => !want.has(n));
if (extra.length) stop(`not in the release: ${extra.slice(0, 5).join(', ')}${extra.length > 5 ? ` and ${extra.length - 5} more` : ''}`);
if (have.length !== want.size) stop('the file list doesn\'t match the release');
process.stdout.write(`verified ${want.size} files against the signed release\n`);
VERIFY_JS
  git -C "$APP_DIR" ls-files > "$vt/names"
  node "$vt/verify-release.js" "$APP_DIR" "$vt/SHA256SUMS" "$vt/SHA256SUMS.sig" "$vt/casatorch-source-files.sha256" "$vt/names" || rc=$?
  rm -rf "$vt"
  return "$rc"
}

main "$@"
