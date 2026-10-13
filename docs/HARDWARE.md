# What to run HouseOS on

HouseOS is bring-your-own-hardware: install it on something that is always on, then open it on
any screen. It needs about 300 MB of RAM and almost no CPU (Frigate, if you use it, is separate).

## The box that runs HouseOS

| Option | Good for | Install |
| --- | --- | --- |
| **Raspberry Pi 5 (4 GB+), with an SSD** | Recommended. Quiet, ~5 W, always on | `sudo ./deploy/install.sh` (Raspberry Pi OS 64-bit) |
| Raspberry Pi 4 (4 GB+) | Fine; use an SSD or a good SD card | Same |
| Intel N100 mini PC | If you also run Frigate or Home Assistant on it | `sudo ./deploy/install.sh` (Debian/Ubuntu) or Docker |
| A NAS with Docker (Synology, UGREEN, QNAP, Unraid, TrueNAS) | You already have one | Docker / Container Manager: image `ghcr.io/gethouseos/houseos`, volume `/data`, port 8090 |
| Windows 10/11 PC that stays on | Trying it out, or an old PC | `deploy\install.ps1` in PowerShell (as Administrator) |
| macOS | Development, trying it out | `cd app && npm install && npm start`, or Docker Desktop |
| Any Linux with Docker (x86-64 or ARM64) | | `docker compose up -d` |

Not recommended: Raspberry Pi 3 and older (too little RAM), anything that sleeps.

## The screen on the wall (optional)

Any device with a browser works. Popular choices:

| Screen | Notes |
| --- | --- |
| Amazon Fire HD 10 + Fully Kiosk Browser | Cheapest wall panel; motion wake, keeps the screen on |
| Lenovo Tab M10 / Samsung Galaxy Tab A | Android + Fully Kiosk |
| An old iPad | Guided Access keeps it on HouseOS |
| A Raspberry Pi with the official 7"/10" touchscreen | HouseOS and the screen in one box (kiosk mode) |
| An old laptop | Chrome in kiosk mode |

## Optional add-ons

- **Home Assistant** (on the same Pi 5/N100, or a Home Assistant Green) for locks, Zigbee/Z-Wave and the long tail of devices.
- **Frigate + a Coral or Intel N100** for people/car/package detection.
- **A UPS** with USB, so HouseOS can shut servers down cleanly and track power cuts.

## Installing

**Raspberry Pi, Debian, Ubuntu** - a service that starts at boot, settings in `/var/lib/houseos`:

```bash
git clone https://github.com/gethouseos/houseos && cd houseos
sudo ./deploy/install.sh          # run it again later to update
```

**Docker** (any Linux, NAS, Docker Desktop) - settings in `./data`:

```bash
cd deploy && docker compose up -d
```

Images are multi-arch (amd64 + arm64), published by `.github/workflows/release.yml` when a version is tagged.

**Windows 10/11** - starts at boot as a scheduled task, settings in `C:\ProgramData\HouseOS\data`.
Download the repo (Code > Download ZIP), unzip, then in PowerShell **as Administrator**:

```powershell
Set-ExecutionPolicy -Scope Process Bypass; .\deploy\install.ps1
```

Then open `http://<that machine>:8090` from any screen at home and follow the setup screens.
