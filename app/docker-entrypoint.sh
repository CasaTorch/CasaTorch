#!/bin/sh
# Runs CasaTorch as its own unprivileged user (uid 1000, "node"), never as root.
#  - The image starts as that user already. If the settings folder isn't writable by it (a NAS app or `docker run -v`
#    made the folder as root), say how to fix it instead of failing with a stack trace.
#  - Started as root on purpose (`user: "0"` in compose, the Home Assistant add-on): only give the settings folder to
#    the app user, then drop to that user for good (setpriv: no root left in the process, no way back).
set -e
DATA="${CASATORCH_DATA_DIR:-/data}"
if [ "$(id -u)" = 0 ]; then
  mkdir -p "$DATA"
  chown -R node:node "$DATA" 2>/dev/null || echo "note: could not change the owner of $DATA"
  exec setpriv --reuid=node --regid=node --init-groups --inh-caps=-all "$@"
fi
[ -d "$DATA" ] || mkdir -p "$DATA" 2>/dev/null || true
if ! [ -d "$DATA" ] || ! [ -w "$DATA" ] || ! [ -x "$DATA" ]; then
  echo "CasaTorch can't write to its settings folder ($DATA): it runs as user $(id -u):$(id -g)." >&2
  echo "Fix: give the folder to that user (sudo chown -R $(id -u):$(id -g) <your folder>), or start the container once with" >&2
  echo "  user: \"0\"   (compose)  /  --user 0  (docker run)  - CasaTorch then fixes the owner and still runs as user 1000." >&2
  exit 78
fi
exec "$@"
