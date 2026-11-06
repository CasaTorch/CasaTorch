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

## How each install is locked down (and what is left open, on purpose)

| Install | Runs as | Sandbox | Secret key kept in |
|---|---|---|---|
| Linux .deb / Raspberry Pi | `casatorch` system user | systemd: `ProtectSystem=strict`, no capabilities, `SystemCallFilter=@system-service` minus privileged/resources, private /tmp and devices, hidden processes, task and memory limits (`systemd-analyze security casatorch.service`: 1.3) | systemd credentials (TPM2 when there is one), opened by `casatorch-key` before each start |
| macOS .pkg | `_casatorch` (hidden system user; `nobody` if it can't be made) | launchd starts it as root only to read the Keychain; CasaTorch drops to its user before anything else and refuses to go on as root; data folder 0700 | the System keychain |
| Windows | Network Service (not an administrator) | data folder ACL: SYSTEM, Administrators and Network Service only | Windows data protection (DPAPI) for Network Service |
| Docker / NAS / Unraid | uid 1000 (`node`) | read-only root, tmpfs /tmp (noexec), `cap_drop: ALL`, no-new-privileges, pids/memory/CPU limits, no setuid programs or npm in the image | a `casatorch_key` Docker secret if given, else the key file |
| Home Assistant add-on | root inside the container only to give /data to `node`, then `node` | Home Assistant's AppArmor, no Supervisor/Docker/hardware access | the key file (the add-on has no key store) |

Left open, and why:
- **MemoryDenyWriteExecute** (systemd): Node.js's JIT needs memory that is written and then run.
- **Network**: CasaTorch talks to devices on the home network, so no `PrivateNetwork`/`IPAddressDeny`; `host_network` /
  `network_mode: host` let it find them. `AF_NETLINK` is how Node.js lists network interfaces.
- **PrivateUsers / ProcSubset** (systemd): some Raspberry Pi and NAS kernels lack user namespaces; Health reads
  /proc for processor and memory figures.
- **COEP** (browser): camera pictures, news and map images come from other sites that send no CORP header.
- **mtr** is not in the Docker image: it needs raw sockets, which the container never gets (traceroute and tracepath
  work without them).
- The container's one-time owner fix (`user: "0"` with `CHOWN, DAC_OVERRIDE, FOWNER, SETUID, SETGID`) is only for a
  settings folder a NAS made as root; once it belongs to 1000:1000 both lines can go.
- **Without a TPM2 chip** (most Raspberry Pis), systemd's host key sits on the same disk: the key store then protects a
  copy of the data folder, not a stolen disk. Use disk encryption for that.
