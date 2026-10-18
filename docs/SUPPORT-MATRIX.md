# What CasaTorch supports, and how

CasaTorch works **without Home Assistant**. Home Assistant is an optional add-on that brings in
hundreds more devices. Everything below is chosen for one test: *can a normal person connect it
with a login, a key, or a button press, in under two minutes?*

Legend: **Direct** = CasaTorch talks to it itself · **Via HA** = needs Home Assistant ·
**Labs** = works through an unofficial API that the vendor could change or block (opt-in, Pro) ·
**No** = not supported, and why.

## Everyday (no hardware needed)

| Feature | How | Source | Notes |
| --- | --- | --- | --- |
| Weather + 7-day forecast | Direct | MET Norway (api.met.no) | Free, global, commercial use allowed with credit ("Weather: MET Norway"). Location from a city search or the browser. |
| Calendars | Direct | Any ICS/iCal link | Google, iCloud, Outlook, school and sports calendars all offer a private link. No sign-in. |
| Sports scores + schedules | Direct | ESPN public scoreboard JSON | Pick leagues and teams. Unofficial endpoints: kept behind a provider so it can be swapped (TheSportsDB) if ESPN changes. |
| News headlines | Direct | RSS feeds the user picks | Defaults: AP, NPR, BBC, Reuters-style feeds; any RSS link. |
| Notes, reminders, clock | Direct | Local | Trash night, recurring reminders, a family note. |
| Internet status | Direct | Public IP and country (Cloudflare), ISP (RIPEstat), latency to 1.1.1.1 / 8.8.8.8 / gateway, Cloudflare speed test | Works on every network with no router access. |

## Devices

| Category | Gear | How | Notes |
| --- | --- | --- | --- |
| Cameras | Frigate | Direct | Detections, snapshots, live via go2rtc |
| | Reolink | Direct | Local login; snapshots + RTSP |
| | Amcrest, Dahua, Hikvision, Lorex, Axis, Tapo C-series, any RTSP/ONVIF | Direct | Address + camera login; snapshot + stream |
| | UniFi Protect | Direct | Local user on the console |
| | Cisco Meraki MV | Direct | API key |
| | **Ring** | **Labs (Pro)** | Ring login + 2-factor code; snapshots, motion and doorbell events. Unofficial API (the one ring-mqtt uses); Ring could block it. |
| | Google Nest | Via HA | Google charges a one-time US$5 developer fee and needs a cloud project per user; too much to ask in a wizard. |
| | Wyze | Direct (via wyze-bridge) | Guide only; the bridge turns them into RTSP |
| | Arlo, Eufy, Blink | No (v1) | No stable API; may come to Labs later |
| Lights & switches | Philips Hue | Direct | Press the bridge button |
| | Shelly | Direct | Local, documented API |
| | Kasa/Tapo, Lutron, Z-Wave, Zigbee, Matter, everything else | Via HA | |
| Locks & thermostats | Any | Via HA | Locks need PIN + confirm in CasaTorch |
| Sensors | Shelly (H&T, Flood, Door) | Direct | Local |
| | YoLink | Direct | Official cloud API (keys from the YoLink app) |
| | Ecowitt weather stations | Direct | The station pushes to CasaTorch |
| | Cisco Meraki MT | Direct | API key |
| | Zigbee/Z-Wave/others | Via HA | |
| Network | UniFi | Direct | Local API key |
| | Cisco Meraki | Direct | API key |
| | Pi-hole, AdGuard Home | Direct | |
| | Omada, OPNsense/pfSense | Planned | |
| | eero, Google Wifi, ISP routers | Basic | Internet status, public IP, ISP, speed, latency, devices seen on the network (ARP scan when CasaTorch runs on the network) |
| Energy | Price per kWh / time-of-use | Direct | Typed in the wizard |
| | Utility bill and usage | Via HA (Opower); Green Button upload planned | Green Button "Download My Data" works with most US utilities, no HA needed (0.3) |
| | Shelly plugs / EM meters | Direct | Local |
| | UPS | Planned (0.3) | Through the CasaTorch agent (NUT/USB); via HA today |
| | Kasa/Tapo plugs, Sense, Enphase, Powerwall, Wall Connector | Via HA | Direct versions planned |
| Servers | Docker host CasaTorch runs on | Planned (0.3) | Docker socket |
| | Other NAS/servers | Planned (0.3) | CasaTorch agent (one command) |

## Why not more "direct" on day one

Every direct integration is code we maintain forever. v1 goes direct only where the vendor
publishes a local or official API (Hue, Shelly, Reolink, UniFi, Meraki, YoLink, Frigate) or where
the payoff is huge (Ring, in Labs). Everything else goes through Home Assistant, which already
maintains 2,000+ integrations.
