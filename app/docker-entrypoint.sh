#!/bin/sh
# Make sure the settings folder belongs to the app user, then run CasaTorch as that user (never root).
# NAS apps (Synology, QNAP, Unraid, TrueNAS) usually create the mapped /data folder as root; without
# this the app could not save its settings there.
set -e
if [ "$(id -u)" = 0 ]; then
  mkdir -p "${CASATORCH_DATA_DIR:-/data}"
  chown -R node:node "${CASATORCH_DATA_DIR:-/data}" 2>/dev/null || echo "note: could not change the owner of ${CASATORCH_DATA_DIR:-/data}"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
