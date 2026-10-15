#!/bin/sh
# Started by launchd (com.casatorch.server). Picks the Node.js for this Mac's chip.
case "$(uname -m)" in arm64) NODE=/Library/CasaTorch/node-arm64/node ;; *) NODE=/Library/CasaTorch/node-x64/node ;; esac
export CASATORCH_DATA_DIR="/Library/Application Support/CasaTorch" PORT=8090 NODE_ENV=production CASATORCH_INSTALL=macos
cd /Library/CasaTorch/app && exec "$NODE" server.js
