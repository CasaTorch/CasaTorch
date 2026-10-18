#!/usr/bin/env bash
# Builds dist/casatorch_<arch>.deb (amd64 or arm64) from dist/bundle: CasaTorch with its own Node.js
# in /opt/casatorch, running as the "casatorch" system user under systemd, data in /var/lib/casatorch.
#   deploy/packaging/linux/build-deb.sh amd64|arm64
set -euo pipefail
ARCH=${1:?amd64 or arm64}; HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../../.." && pwd)
BUNDLE=$ROOT/dist/bundle; [ -d "$BUNDLE" ] || "$ROOT/deploy/packaging/bundle.sh"
VERSION=${CASATORCH_VERSION:-$(cat "$BUNDLE/VERSION")}
case "$ARCH" in amd64) NODEPLAT=linux-x64 ;; arm64) NODEPLAT=linux-arm64 ;; *) echo "amd64 or arm64" >&2; exit 1 ;; esac
PKG=$(mktemp -d); trap 'rm -rf "$PKG"' EXIT
mkdir -p "$PKG/opt/casatorch" "$PKG/lib/systemd/system" "$PKG/DEBIAN"
cp -R "$BUNDLE/app" "$BUNDLE/demo" "$BUNDLE/VERSION" "$PKG/opt/casatorch/"
if [ -n "${NODE_BIN:-}" ]; then mkdir -p "$PKG/opt/casatorch/node"; cp "$NODE_BIN" "$PKG/opt/casatorch/node/node"; else "$ROOT/deploy/packaging/fetch-node.sh" "$NODEPLAT" "$PKG/opt/casatorch/node"; fi
cp "$HERE/casatorch.service" "$HERE/casatorch-update.service" "$HERE/casatorch-update.timer" "$PKG/lib/systemd/system/"
cp "$HERE/casatorch-update" "$PKG/opt/casatorch/casatorch-update"
cp "$HERE/../release-key.pub.pem" "$PKG/opt/casatorch/release-key.pem"   # the updater checks every release against this
for s in postinst prerm postrm; do cp "$HERE/$s" "$PKG/DEBIAN/"; chmod 755 "$PKG/DEBIAN/$s"; done
MAINT="CasaTorch <support@casatorch.com>"   # scrub-ok: public support address
SIZE=$(du -sk "$PKG/opt" | cut -f1)
cat > "$PKG/DEBIAN/control" <<CTRL
Package: casatorch
Version: $VERSION
Architecture: $ARCH
Maintainer: $MAINT
Installed-Size: $SIZE
Depends: adduser
Recommends: traceroute, iputils-tracepath, mtr-tiny
Section: web
Priority: optional
Homepage: https://casatorch.com
Description: CasaTorch - one screen for your whole house
 A self-hosted dashboard and wall panel for your home: lights, cameras, locks,
 sensors, energy, calendars and weather, with everything from Home Assistant.
 Runs as a service on port 8090; open http://<this computer>:8090 to set it up.
CTRL
chmod -R u+rwX,go+rX,go-w "$PKG/opt" "$PKG/lib"; chmod 644 "$PKG/lib/systemd/system/"casatorch*; chmod 755 "$PKG/opt/casatorch/casatorch-update"
find "$PKG" -type d -exec chmod 755 {} +
mkdir -p "$ROOT/dist"
dpkg-deb --root-owner-group -Zxz --build "$PKG" "$ROOT/dist/casatorch_$ARCH.deb" >/dev/null
echo "built dist/casatorch_$ARCH.deb ($VERSION)"
