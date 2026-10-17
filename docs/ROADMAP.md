# Roadmap: phones, tablets and away from home

CasaTorch runs on a small always-on box in your home (a Raspberry Pi, a NAS, a mini PC or a Windows
PC) and every screen in the house opens it in a browser. This page explains what has to stay
local, and how CasaTorch reaches phones, tablets and the outside world.

## Why there's a box at home

| | Must be on your home network | Why |
| --- | :---: | --- |
| Hue and Shelly (local), Frigate, Reolink and snapshot/RTSP cameras | Yes | They only answer on your home network |
| Home Assistant | Usually | It lives at home (or reach it through its own cloud) |
| Network info, devices on the network, speed tests of *your* line | Yes | Has to run inside the house |
| Private AI with Ollama | Yes | Runs on a computer at home |
| Alerts that watch 24/7 | Needs something always on | Phones and tablets pause apps in the background |
| Weather, calendars, scores, news | No | Internet services |
| Ring, YoLink, Claude/OpenAI | No | Cloud services |
| Layout, names, colors, calendar, photos, 3D scans | No | Just data |

An iPhone or iPad can't be the box: iOS and Android pause apps in the background, so they can't
watch your home around the clock. The box does that; your devices are screens for it.

## The plan

1. **Install on your home screen** *(next)* - CasaTorch as an installable web app: on iPhone/iPad
   Share > Add to Home Screen, on Android "Install app". Full screen, its own icon, no app store.
2. **Away from home + phone alerts** *(Pro)* - your box keeps one secure, outgoing connection to
   the CasaTorch relay; your phone connects through it. No port forwarding, no VPN to set up. Your
   data stays on your box - the relay only passes it through. Push notifications for leaks,
   doorbell and alarms.
3. **App Store and Play Store apps** *(built, in testing; free in every edition)* - the same app, with
   Face ID / fingerprint lock, end-to-end encrypted alerts, a box finder and LiDAR room scans. See
   [mobile/README.md](../mobile/README.md).
4. **CasaTorch Lite** *(exploring)* - a cloud-only version with no box, for weather, calendars,
   scores, Ring, YoLink and Home AI Agent - an easy way to try CasaTorch before adding a Raspberry Pi.

## Also coming

Smart alerts, a bill forecast, self-healing, the CasaTorch agent for watching NAS and
Docker hosts (apps, drives, backups, UPS), Green Button energy import, multi-home.
