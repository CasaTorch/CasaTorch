#!/bin/sh
# Started by launchd (com.casatorch.server). Picks the Node.js for this Mac's chip.
case "$(uname -m)" in arm64) NODE=/Library/CasaTorch/node-arm64/node ;; *) NODE=/Library/CasaTorch/node-x64/node ;; esac
# CasaTorch's own user (made by postinstall; nobody if it couldn't be): CasaTorch reads its wrapping key from the System
# keychain, then switches to this user for good (it never runs as root).
RUN_AS=$(cat /Library/CasaTorch/run-as 2>/dev/null); id -u "$RUN_AS" >/dev/null 2>&1 || RUN_AS=nobody
export CASATORCH_DATA_DIR="/Library/Application Support/CasaTorch" PORT=8090 NODE_ENV=production CASATORCH_INSTALL=macos CASATORCH_RUN_AS="$RUN_AS"
cd /Library/CasaTorch/app && exec "$NODE" server.js
