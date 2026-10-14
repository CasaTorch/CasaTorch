# CasaTorch

## Install

1. Install this add-on and press **Start**. The first start builds CasaTorch on your machine
   (about 3-5 minutes on a Raspberry Pi, under a minute on a PC). Watch the **Log** tab.
2. Turn on **Start on boot** and **Watchdog**.
3. Press **Open web UI** (or go to `http://homeassistant.local:8090`) and follow the setup screens.

Home Assistant is connected for you: the add-on talks to it through the Supervisor, so there is no
long-lived token to create. In the setup's Home Assistant step just press **Next**.

## Put it on a Home Assistant dashboard

Install the **CasaTorch card** with HACS (HACS > ⋮ > Custom repositories > add
`https://github.com/casatorch/casatorch`, type **Dashboard**), then add a card:

```yaml
type: custom:casatorch-card
url: http://homeassistant.local:8090
view: 3d        # home | panel | 3d | ask
height: 600
```

No HACS? Use Home Assistant's own **Webpage** card with the same address.

If you open Home Assistant over https (Nabu Casa or a reverse proxy), the browser blocks an
http:// CasaTorch inside it. Open Home Assistant on your home network, or put CasaTorch behind https too.

## Wall panel

On the tablet or screen on the wall, open `http://homeassistant.local:8090/?panel=1`. Panel mode
keeps the screen awake and shows the status bar and the "Ask the house" bar.

## Your data

Settings, floor plans and photos are stored in the add-on's own folder and are included in Home
Assistant backups. Passwords for Ring or your power company are never stored.

## Updating

When a new version of the add-on is out, Home Assistant offers the update like any other add-on.
