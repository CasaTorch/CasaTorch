#!/usr/bin/env bash
# Downloads a pinned Node.js 22 (LTS) for one platform, checks it against Node's published
# checksums, and leaves just the binary.
#   deploy/packaging/fetch-node.sh <linux-x64|linux-arm64|darwin-arm64|darwin-x64|win-x64> <output dir>
# The version is pinned (not "newest") so a release always ships the Node.js it was tested with. Move it with each
# Node.js security release (https://nodejs.org/en/blog/vulnerability), together with the node:22.x image tags in
# app/Dockerfile and ha-addon/. NODE_VERSION (vX.Y.Z) overrides it.
set -euo pipefail
PLAT=$1 OUT=$2
VER=${NODE_VERSION:-v22.23.4}   # 2026-10-21 security release
[[ "$VER" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "fetch-node.sh: bad version $VER" >&2; exit 1; }
case "$PLAT" in win-x64) FILE=win-x64/node.exe ;; *) FILE=node-$VER-$PLAT.tar.xz ;; esac
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
curl -fsSL "https://nodejs.org/dist/$VER/$FILE" -o "$TMP/dl"
want=$(curl -fsSL "https://nodejs.org/dist/$VER/SHASUMS256.txt" | awk -v f="$FILE" '$2==f{print $1}')
got=$( (sha256sum "$TMP/dl" 2>/dev/null || shasum -a 256 "$TMP/dl") | cut -d' ' -f1)
[ -n "$want" ] && [ "$want" = "$got" ] || { echo "checksum mismatch for node $VER $PLAT" >&2; exit 1; }
mkdir -p "$OUT"
if [ "$PLAT" = win-x64 ]; then cp "$TMP/dl" "$OUT/node.exe"
else tar xJf "$TMP/dl" -C "$TMP" && cp "$TMP/node-$VER-$PLAT/bin/node" "$OUT/node" && chmod 755 "$OUT/node"; fi
echo "node $VER ($PLAT) -> $OUT"
