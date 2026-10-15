#!/usr/bin/env bash
# Builds dist/CasaTorch-macOS.pkg (Apple silicon and Intel) from dist/bundle - run on a Mac.
# Installs to /Library/CasaTorch with its own Node.js, runs as a background service (LaunchDaemon
# com.casatorch.server, user "nobody") that starts with the Mac, settings in /Library/Application Support/CasaTorch.
# Signing: set PKG_SIGN_ID="Developer ID Installer: ..." to sign (the release workflow does this and notarizes when its secrets are set).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../../.." && pwd)
BUNDLE=$ROOT/dist/bundle; [ -d "$BUNDLE" ] || "$ROOT/deploy/packaging/bundle.sh"
VERSION=${CASATORCH_VERSION:-$(cat "$BUNDLE/VERSION")}
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
R=$WORK/root; mkdir -p "$R/Library/CasaTorch" "$R/Library/LaunchDaemons" "$R/Applications"
cp -R "$BUNDLE/app" "$BUNDLE/demo" "$BUNDLE/VERSION" "$R/Library/CasaTorch/"
"$ROOT/deploy/packaging/fetch-node.sh" darwin-arm64 "$R/Library/CasaTorch/node-arm64"
"$ROOT/deploy/packaging/fetch-node.sh" darwin-x64 "$R/Library/CasaTorch/node-x64"
cp "$HERE/casatorch-run.sh" "$R/Library/CasaTorch/"; chmod 755 "$R/Library/CasaTorch/casatorch-run.sh"
cp "$HERE/uninstall.command" "$R/Library/CasaTorch/Uninstall CasaTorch.command"; chmod 755 "$R/Library/CasaTorch/Uninstall CasaTorch.command"
cp "$HERE/com.casatorch.server.plist" "$R/Library/LaunchDaemons/"; chmod 644 "$R/Library/LaunchDaemons/com.casatorch.server.plist"
cat > "$R/Applications/CasaTorch.webloc" <<'LOC'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>URL</key><string>http://localhost:8090/</string></dict></plist>
LOC
chmod -R u+rwX,go+rX,go-w "$R"
mkdir -p "$WORK/scripts"; cp "$HERE/preinstall" "$HERE/postinstall" "$WORK/scripts/"; chmod 755 "$WORK/scripts/"*
mkdir -p "$ROOT/dist"
pkgbuild --root "$R" --scripts "$WORK/scripts" --identifier com.casatorch.server --version "$VERSION" --install-location / \
  ${PKG_SIGN_ID:+--sign "$PKG_SIGN_ID"} "$ROOT/dist/CasaTorch-macOS.pkg"
echo "built dist/CasaTorch-macOS.pkg ($VERSION)"
