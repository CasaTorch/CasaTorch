# Installers

Everyday users never see this folder: they answer a few questions on
**casatorch.com/download** and get the right file. Tagging a release
(`git tag v0.3.0 && git push --tags`) makes `.github/workflows/release.yml`
build every file below and attach it to the GitHub release under a fixed name,
so `https://casatorch.com/dl/<name>` always serves the newest one.

| File | For | Built by |
|---|---|---|
| `CasaTorch-Setup-Windows.exe` | Windows 10/11, 64-bit | `windows/casatorch.iss` (Inno Setup) |
| `CasaTorch-macOS.pkg` | macOS 12+, Apple silicon and Intel | `macos/build-pkg.sh` |
| `casatorch_amd64.deb`, `casatorch_arm64.deb` | Ubuntu, Debian, Mint, Raspberry Pi OS | `linux/build-deb.sh` |
| `casatorch-raspberry-pi.img.xz` | Raspberry Pi 4/5 - flash with Raspberry Pi Imager | `pi/build-image.sh` |
| `casatorch-compose.yml` | Synology, QNAP, TrueNAS, Portainer, any Docker host | `deploy/downloads/` |
| Home Assistant add-on | Home Assistant OS | `ha-addon/` (one-click link, no file) |

Every installer bundles its own Node.js, so nothing else needs installing, and
runs CasaTorch as a background service on port 8090 that starts with the computer.

| | Program | Settings and data |
|---|---|---|
| Windows | `C:\Program Files\CasaTorch` (scheduled task "CasaTorch", Network Service) | `C:\ProgramData\CasaTorch` |
| macOS | `/Library/CasaTorch` (LaunchDaemon `com.casatorch.server`) | `/Library/Application Support/CasaTorch` |
| Linux / Pi | `/opt/casatorch` (systemd `casatorch.service`, user `casatorch`) | `/var/lib/casatorch` |

**Signing.** Until the Windows installer is code-signed and the macOS package is
signed and notarized (Apple Developer ID), Windows SmartScreen and macOS
Gatekeeper show a warning the first time; the download page explains the click
past it. The release workflow signs automatically once these are set in the
GitHub repository (Settings > Secrets and variables > Actions); without them it
builds unsigned, as before:

- macOS: secrets `MACOS_INSTALLER_P12` (base64 of a "Developer ID Installer"
  certificate exported as .p12), `MACOS_INSTALLER_P12_PASSWORD`, and for
  notarization `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD` (an
  app-specific password).
- Windows (Microsoft Artifact Signing): secrets `AZURE_TENANT_ID`,
  `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`; variables
  `ARTIFACT_SIGNING_ENDPOINT`, `ARTIFACT_SIGNING_ACCOUNT`,
  `ARTIFACT_SIGNING_PROFILE`.

Build one locally: `deploy/packaging/bundle.sh` (all platforms need it first),
then `linux/build-deb.sh amd64`, `macos/build-pkg.sh` (on a Mac), `iscc windows/casatorch.iss`
(on Windows), or `sudo pi/build-image.sh` (Linux, with qemu-user-static).
