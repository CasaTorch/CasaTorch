# HouseOS

**The wall panel for your house and your homelab: one screen, plain-English alerts, and it fixes itself.**

HouseOS is a self-hosted dashboard for people who run Home Assistant, a NAS and Docker at home.
It puts the house (controls, cameras, sensors), the network, the servers and the power bill on one
screen built for a wall-mounted tablet, and tells you in plain words when something needs you.

> **Status: early.** HouseOS is being extracted from a private dashboard that has run one house
> daily for a year. The tabs are being ported one at a time (see [docs/MODULES.md](docs/MODULES.md)).
> Today it runs in **demo mode** with sample data.

## Try it (demo mode)

```bash
git clone https://github.com/<you>/HouseOS && cd HouseOS/app
npm install
npm run demo          # → http://localhost:8090
```

Or with Docker: `cd deploy && docker compose up -d`.

## What's in it

| Tab | What it does | Edition |
| --- | --- | --- |
| Home | Wall panel: time, weather, calendar, what's happening now, reminders | Free |
| Alerts | Everything that needs you, in plain words, with what to do | Free |
| Controls | Lights, locks, climate, covers from Home Assistant; PIN + confirm for locks | Free |
| Cameras | Frigate + go2rtc live view, detections, cars and people | Free |
| Sensors | Leak, motion, temperature, batteries | Free |
| Network | Internet, devices, Wi-Fi, a live network map (Meraki first, UniFi next) | Free |
| Servers | Docker apps, uptime, drive health, RAID, backups, UPS, one-tap updates | Free |
| Energy | What every device costs, from smart plugs, PoE, UPS and your meter | Free |
| 3D floor plan | Your home from an iPhone/iPad LiDAR scan, with live devices in their rooms | **Pro** |
| Ask the house | Ask questions in plain English (bring your own AI key) | **Pro** |
| Self-healing | Restarts stuck or unhealthy apps, CPU watchdog | **Pro** |
| Energy insights | Bill forecast, always-on load, what each degree of heat costs | **Pro** |

**Free** is open source (AGPL-3.0), forever. **Pro** is an optional license key that supports the project.

## Works with

Home Assistant · Frigate · go2rtc · Docker hosts (Synology, UGREEN, Unraid, TrueNAS, Proxmox) ·
Pi-hole · NUT/USB UPSs · Cisco Meraki · *coming:* UniFi, AdGuard Home, OPNsense.

## Roadmap

1. **Foundation**: repo, privacy scan, demo mode *(now)*
2. **Private alpha**: Home, Alerts, Controls, Cameras, Sensors, Servers
3. **Public v0.9**: Network (Meraki, UniFi), Energy, docs site
4. **Pro**: 3D floor plan from LiDAR, license keys
5. **Grow**: Ask the house, self-healing, energy insights

## Contributing

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).
Never include anything from your own house in an issue or PR (IPs, names, serials): the
pre-commit hook in this repo checks for that.

## License

HouseOS (this repository) is licensed under the [GNU AGPL-3.0](LICENSE).
HouseOS Pro is a separate, commercially licensed add-on.
