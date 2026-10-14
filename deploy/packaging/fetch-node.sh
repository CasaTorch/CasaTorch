#!/usr/bin/env bash
# Downloads the newest Node.js 22 (LTS) for one platform, checks it against Node's published
# checksums, and leaves just the binary.
#   deploy/packaging/fetch-node.sh <linux-x64|linux-arm64|darwin-arm64|darwin-x64|win-x64> <output dir>
set -euo pipefail
PLAT=$1 OUT=$2
VER=${NODE_VERSION:-$(curl -fsSL https://nodejs.org/dist/index.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).find(r=>r.version.startsWith('v22.')).version))")}
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
