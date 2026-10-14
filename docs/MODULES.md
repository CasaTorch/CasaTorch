# Module map: homedash → CasaTorch

Every source file of the private dashboard (`homedash/dashboard/src`) and where it goes.
Files move **one at a time** with `tools/port.sh`, which refuses to copy anything that
fails the privacy scan (`tools/scrub-check.mjs`).

| Action | Meaning |
| --- | --- |
| **core** | Port to `app/` (free, AGPL). Personal values become settings. |
| **split** | Part core, part dropped or Pro — port only the core part. |
| **provider** | Becomes a pluggable provider (`app/src/providers/<name>`), off unless configured. |
| **pro** | Goes to the private `casatorch-pro` repo, loaded only with a license key. |
| **later** | Not in v1; may return as a generic Home Assistant feature. |
| **drop** | Entertainment / download stack. Never ported. |

## Server (`src/server`)

| File | Action | Notes |
| --- | --- | --- |
| 00-setup.js | core | Config loader; remove house defaults, add demo mode |
| 00b-version.js | core | |
| 01-gpu-pihole.js | core | Pi-hole; add AdGuard Home later |
| 02-network-test.js | drop | Too niche for v1 |
| 03-home-assistant.js | core | The main data source |
| 04-host-and-apps.js | split | Keep host + generic services; drop Jellyfin/*arr/qBittorrent pollers |
| 05-meraki.js | provider | `meraki` network provider |
| 06-meraki-cameras.js | provider | `meraki` camera provider |
| 07-sensors-rf.js | core | |
| 08-home-panel.js | core | Wall-panel data; news/weather sources as settings |
| 08t-teams.js | drop | |
| 09-youtube-notes.js | split | Keep notes; drop YouTube |
| 10-snapshot.js | core | |
| 11-nas-agent.js | core | Becomes the generic "host agent" for any Docker host |
| 12-live-tv-nas.js | drop | |
| 12d-disk-history-nas.js | core | |
| 12h-heal-update-nas.js | split | One-tap updates = core; self-healing = pro |
| 12l-hostlogs-nas.js | core | |
| 12m-dvr-nas.js | drop | |
| 12n-vpn-picker-nas.js | drop | |
| 12p-pi-backup-nas.js | core | Generalize: back up any host to the agent |
| 12p-power-nas.js | core | |
| 12q-media-check-nas.js | drop | Download-stack only |
| 12r-ring-watch-nas.js | later | Ring via Home Assistant |
| 12s-cpu-watch-nas.js | pro | CPU watchdog |
| 12t-tv-quality-nas.js | drop | |
| 12u-ups-nas.js | core | NUT / USB UPS |
| 12y-yt-audio-nas.js | drop | |
| 12z-agent-catch-all.js | core | |
| 13-sign-in.js | core | |
| 14-vpn-apps.js | drop | |
| 15-ask-helpers.js | pro | Ask the house |
| 16-speed-test.js | core | |
| 17-notifications-chats.js | split | Alerts engine core; media alerts dropped |
| 18-movies-shows.js | drop | |
| 19-frigate-updates.js | core | |
| 19a-auto-update.js | split | Keep generic container updates; drop IPTV specifics |
| 20-apps-and-health.js | core | |
| 21-about.js | core | |
| 22-live-tv-web.js | drop | |
| 23-water.js | core | Irrigation via Home Assistant (any brand) |
| 24-ask-the-house.js | pro | |
| 25-routes.js | split | Keep routes for kept features only |
| 26-controls.js | core | Keep PIN / confirm / protected-plug rules |
| 27-live-events.js | core | Frigate MQTT pop-ups; car names → settings |
| 28-video-relay.js | core | Camera stream relay |
| 29-music.js | drop | |
| 30-markets-standings.js | drop | |
| 31-webhook.js | provider | `meraki` webhook |
| 32-uptime.js | core | |
| 33-new-devices.js | core | |
| 34-dvr.js | drop | |
| 35-watch-extras.js | drop | |
| 36-ask-actions.js | pro | |
| 37-vpn-picker.js | drop | |
| 38-backups-heal-web.js | split | Backups core; heal view pro |
| 39-drives-web.js | core | |
| 40-ask-more.js | pro | |
| 41-ups-web.js | core | |
| 42-ask-reach.js | pro | |
| 43-hosts.js | core | |
| 44-admin.js | core | |
| 45-media-check-web.js | drop | |
| 45c-torrent-guard.js | drop | |
| 46-admin-console.js | later | Web terminal: security review first |
| 47-energy-web.js | split | Measuring + bill = core; insights/forecast = pro; tariffs → data files |
| 47h-heating.js | core | Thermostat via Home Assistant |
| 47r-reminders.js | core | Reminders become user-defined |
| 47t-tesla-trip.js | later | Generic "car on the way home" via Home Assistant |
| 48-weekly-report.js | pro | |
| 49-camera-heatmap.js | pro | |
| 50-netmap.js | core | Network map; vendor bits through the provider |
| 50b-ip-watch.js | core | |
| 99-start.js | core | |

## Client (`src/client`)

| File | Action | Notes |
| --- | --- | --- |
| 00-core.js | core | |
| 01-tabs-tables.js | core | Remove the Entertainment tab group |
| 02-kpi-pihole.js | core | |
| 03-services-charts.js | split | Drop media service tiles |
| 04-calendar.js | core | |
| 05-rf.js | core | |
| 06-drawers.js | split | Drop media drawers |
| 07-network-drawers.js | core | |
| 08-home.js | core | |
| 09-music.js | drop | |
| 10-sensors-cameras.js | core | |
| 11-chrome-polling.js | core | |
| 12-ha-cameras.js | core | |
| 13-popups-door-kitchen.js | core | Pop-ups and door card |
| 14-car-and-devices.js | split | Devices core; car later |
| 15-live-tv.js | drop | |
| 16-movies-about.js | split | Keep About; drop Movies |
| 17-network-test.js | drop | |
| 18-look-and-feel.js | core | |
| 19-ask.js | pro | |
| 20-notifications-media.js | split | Alerts core; media dropped |
| 21-charging-theme.js | core | |
| 22-uptime-guest.js | core | |
| 23-dvr.js | drop | |
| 24-watch-extras.js | drop | |
| 25-ask-actions.js | pro | |
| 26-backups-heal.js | split | |
| 27-drives.js | core | |
| 28-ups.js | core | |
| 29-notif-drawer.js | core | |
| 30-server-subtabs.js | core | |
| 31-hosts.js | core | |
| 32-backup-drives.js | core | |
| 33-admin.js | core | |
| 34-media-check.js | drop | |
| 35-admin-console.js | later | |
| 36-energy.js | split | |
| 37-weekly-report.js | pro | |
| 38-continue-watching.js | drop | |
| 39-camera-heatmap.js | pro | |
| 40-netmap.js | core | |
| 41-home-now.js | core | |

New in CasaTorch (no homedash file): `providers/unifi` (network), `demo/` fixtures and demo mode,
`pro/floorplan3d` (LiDAR .glb → NeonPlan-style 3D view with live devices), license-key loader.
