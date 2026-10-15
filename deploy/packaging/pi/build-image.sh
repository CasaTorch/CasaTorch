#!/usr/bin/env bash
# Builds dist/casatorch-raspberry-pi.img.xz: Raspberry Pi OS Lite (64-bit) with CasaTorch installed and
# switched on, hostname "casatorch". Flash it with Raspberry Pi Imager - its settings screen (user,
# Wi-Fi) still works - and open http://casatorch.local:8090 a few minutes after the first boot.
# Needs Linux, root, and qemu-user-static (so arm64 programs run during the build):
#   sudo apt-get install -y qemu-user-static binfmt-support parted e2fsprogs xz-utils
#   sudo deploy/packaging/pi/build-image.sh [path to casatorch_arm64.deb]
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../../.." && pwd)
DEB=${1:-$ROOT/dist/casatorch_arm64.deb}; [ -f "$DEB" ] || { echo "build $DEB first (linux/build-deb.sh arm64)" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "run with sudo" >&2; exit 1; }
BASE_URL=${RASPIOS_URL:-https://downloads.raspberrypi.com/raspios_lite_arm64_latest}
WORK=$(mktemp -d); MNT=$WORK/root; LOOP=
cleanup() { set +e; umount "$MNT/boot/firmware" "$MNT/dev/pts" "$MNT/dev" "$MNT/proc" "$MNT/sys" "$MNT" 2>/dev/null; [ -n "$LOOP" ] && losetup -d "$LOOP"; rm -rf "$WORK"; }
trap cleanup EXIT

echo "==> Downloading Raspberry Pi OS Lite (64-bit)"
curl -fsSL "$BASE_URL" -o "$WORK/base.img.xz"
xz -d -T0 "$WORK/base.img.xz"; IMG=$WORK/base.img

echo "==> Making room for CasaTorch"
truncate -s +768M "$IMG"
parted -s "$IMG" resizepart 2 100%
LOOP=$(losetup -fP --show "$IMG")
e2fsck -pf "${LOOP}p2" || [ $? -le 1 ]
resize2fs "${LOOP}p2" >/dev/null

echo "==> Installing CasaTorch"
mkdir -p "$MNT"; mount "${LOOP}p2" "$MNT"; mount "${LOOP}p1" "$MNT/boot/firmware"
mount --bind /dev "$MNT/dev"; mount --bind /dev/pts "$MNT/dev/pts"; mount -t proc proc "$MNT/proc"; mount -t sysfs sys "$MNT/sys"
cp "$DEB" "$MNT/tmp/casatorch.deb"
chroot "$MNT" /usr/bin/env DEBIAN_FRONTEND=noninteractive dpkg -i /tmp/casatorch.deb
rm -f "$MNT/tmp/casatorch.deb"
# Raspberry Pi image: CasaTorch updates itself (casatorch-update.timer), and so does the system -
# Debian security fixes install automatically every night.
mkdir -p "$MNT/etc/systemd/system/casatorch.service.d"
printf '[Service]\nEnvironment=CASATORCH_INSTALL=pi-image\n' > "$MNT/etc/systemd/system/casatorch.service.d/install.conf"
cp -L /etc/resolv.conf "$MNT/etc/resolv.conf.casatorch" && mount --bind "$MNT/etc/resolv.conf.casatorch" "$MNT/etc/resolv.conf" 2>/dev/null || true
chroot "$MNT" /usr/bin/env DEBIAN_FRONTEND=noninteractive sh -c 'apt-get update -qq && apt-get install -y -qq unattended-upgrades dnsmasq-base && printf "APT::Periodic::Update-Package-Lists \"1\";\nAPT::Periodic::Unattended-Upgrade \"1\";\n" > /etc/apt/apt.conf.d/20auto-upgrades && apt-get clean'
umount "$MNT/etc/resolv.conf" 2>/dev/null || true; rm -f "$MNT/etc/resolv.conf.casatorch"
# Wi-Fi setup without a cable: when the Box has no network it opens its own setup Wi-Fi (see wifi-setup/).
# The setup Wi-Fi's name and password go on the boot partition per Box (tools/pi-setup-label.mjs).
mkdir -p "$MNT/opt/casatorch/wifi-setup" "$MNT/etc/NetworkManager/dnsmasq-shared.d"
install -m 0755 "$HERE/wifi-setup/casatorch-wifi-setup.mjs" "$MNT/opt/casatorch/wifi-setup/"
install -m 0644 "$HERE/wifi-setup/casatorch-wifi-setup.service" "$MNT/etc/systemd/system/"
# Every name points at the Box on the setup Wi-Fi, so phones open the setup page by themselves (NetworkManager uses this only for hotspots).
printf '# CasaTorch setup Wi-Fi only\naddress=/#/10.42.0.1\n' > "$MNT/etc/NetworkManager/dnsmasq-shared.d/casatorch-captive.conf"   # scrub-ok: NetworkManager's standard hotspot address
chroot "$MNT" systemctl enable casatorch-wifi-setup.service
# The name it answers to on the network: http://casatorch.local:8090 (Raspberry Pi Imager can change it).
echo casatorch > "$MNT/etc/hostname"
sed -i 's/\braspberrypi\b/casatorch/g' "$MNT/etc/hosts"
# A note on the boot partition, readable from any computer that the card is plugged into.
cat > "$MNT/boot/firmware/CASATORCH.txt" <<'NOTE'
CasaTorch for Raspberry Pi
==========================
Put this card in a Raspberry Pi 4 or 5 and power it on. Then either:
  - plug it into your router with a network cable, or
  - Wi-Fi: set your Wi-Fi in Raspberry Pi Imager before flashing, or put a file named
    casatorch-setup.txt next to this one with two lines:
        SETUP_SSID=CasaTorch-Setup
        SETUP_PASSWORD=<a password you choose, 8+ characters>
    With no network it then opens that setup Wi-Fi: join it on your phone and pick your home Wi-Fi.
After 3-5 minutes open  http://casatorch.local:8090  on any phone or computer on the same network.
Can't reach it? Look for "casatorch" in your router's list of devices and open  http://<that address>:8090
Help: https://casatorch.com/download
NOTE
sync
umount "$MNT/boot/firmware" "$MNT/dev/pts" "$MNT/dev" "$MNT/proc" "$MNT/sys" "$MNT"
losetup -d "$LOOP"; LOOP=

echo "==> Compressing"
mkdir -p "$ROOT/dist"
xz -T0 -6 -c "$IMG" > "$ROOT/dist/casatorch-raspberry-pi.img.xz"
echo "built dist/casatorch-raspberry-pi.img.xz ($(du -h "$ROOT/dist/casatorch-raspberry-pi.img.xz" | cut -f1))"
