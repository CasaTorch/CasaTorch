#!/usr/bin/env bash
# Builds dist/bundle: CasaTorch ready to run (server.js, the web app, catalog, demo house and
# production node_modules) - everything except Node.js itself, which each installer adds for its platform.
#   deploy/packaging/bundle.sh [output dir]
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT=${1:-$ROOT/dist/bundle}
rm -rf "$OUT"; mkdir -p "$OUT/app"
( cd "$ROOT/app" && node build.mjs >/dev/null )
cp -R "$ROOT/app/server.js" "$ROOT/app/package.json" "$ROOT/app/package-lock.json" "$ROOT/app/public" "$ROOT/app/catalog" "$OUT/app/"
mkdir -p "$OUT/app/src" && cp -R "$ROOT/app/src/voice" "$OUT/app/src/"   # the Matter bridge's own process (79v-voice.js)
cp -R "$ROOT/demo" "$OUT/demo"
( cd "$OUT/app" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error )
node -p "require('$ROOT/app/package.json').version" > "$OUT/VERSION"
# Readable by the service account on every platform (source checkouts can be owner-only).
chmod -R u+rwX,go+rX,go-w "$OUT"
echo "bundle: $OUT ($(du -sh "$OUT" | cut -f1), version $(cat "$OUT/VERSION"))"
