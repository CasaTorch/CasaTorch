# Third-party notices

CasaTorch is free software under the GNU Affero General Public License v3.0 (see `LICENSE`). It is
built on other people's open-source work and talks to a number of outside services. This file lists
them, with their licenses or terms, so you know what is in the box and what it connects to.

The same list is in the app: **Settings › Help › About CasaTorch › Open-source licenses**. That page
also lists every npm package actually installed on your CasaTorch, with its version and license,
read from the box itself.

CasaTorch comes with **no warranty**, to the extent the law allows (AGPL-3.0 sections 15 and 16).

> This file is the project's best reading of each license and service's terms as of October 2026.
> It is not legal advice. Items marked **Owner/lawyer to confirm** need a decision by a person.

---

## 1. Software CasaTorch ships

### Server (Node.js, `app/package.json`)

| Package | License | Notes |
| --- | --- | --- |
| express 4 | MIT | Web server |
| three (three.js) 0.185 | MIT | 3D Home rendering (copyright the three.js authors) |
| web-push 3.6 | MPL-2.0 | Web push for phone alerts. Shipped unmodified; source is in `node_modules/web-push` and at github.com/web-push-libs/web-push |
| ring-client-api 14 | MIT | Ring (Pro, Labs). See section 3 - Ring's own terms |
| acme-client 5.4 | MIT | Let's Encrypt certificates for the secure address at home |
| qrcode 1.5 | MIT | QR codes in setup |
| multicast-dns 7.2 | MIT | Finding the box on the home network (Bonjour) |
| werift 0.25 | MIT | WebRTC (via ring-client-api) |
| mediabunny 1.61 | MPL-2.0 | Media handling (via werift). Shipped unmodified |
| node-forge 1.4 | BSD-3-Clause OR GPL-2.0 | Used under BSD-3-Clause |
| tar, minipass, chownr, yallist | BlueOak-1.0.0 | Permissive |
| tweetnacl | Unlicense (public domain) | |

All told, about 240 packages are installed: about 195 MIT, 16 ISC, 14 BSD-3-Clause, 5 Apache-2.0,
4 BlueOak-1.0.0, 2 MPL-2.0, 2 0BSD, 1 Unlicense and 1 dual BSD/GPL (used as BSD). None is GPL-only or
AGPL-only, and none is "source available" only. The in-app page shows the exact list for your box.

**FFmpeg (not shipped).** `ring-client-api` depends on `ffmpeg-for-homebridge`, whose install script
downloads a static FFmpeg build configured with `--enable-gpl --enable-nonfree --enable-libfdk-aac`.
FFmpeg's own documentation calls such builds unredistributable. CasaTorch does not use FFmpeg (Ring
pictures don't need it), so every official build installs packages with `--ignore-scripts`: the Docker
image, the Home Assistant add-on, the .deb, the Raspberry Pi image, the Box and the install scripts
contain no FFmpeg binary. If one is ever needed, use the operating system's own FFmpeg package.

### Phone apps (`mobile/`, coming - not in the stores yet)

| Component | License / terms |
| --- | --- |
| AndroidX (activity, appcompat, biometric, browser, core, webkit, swiperefreshlayout, splashscreen) | Apache-2.0 |
| Kotlin coroutines | Apache-2.0 |
| Firebase Cloud Messaging SDK (Android and iOS) | Apache-2.0 for the SDK; use of the service is under the Firebase / Google APIs terms |
| Google Play services code scanner | Android Software Development Kit License; Google APIs terms |

The apps must also show their own open-source notices screen before store release (**Owner to do**).

### Data and artwork shipped in CasaTorch

| What | Source | License |
| --- | --- | --- |
| Land, borders and US states outline for the radar (`app/catalog/radar-outline.json`) | Natural Earth | Public domain |
| Demo house photos (`demo/photos`) | Wikimedia Commons, credited on each photo (`demo/photos/credits.json`) | CC0 and CC BY 4.0 |
| App icons, logo, the in-app icon set | CasaTorch | Part of CasaTorch (AGPL-3.0); "CasaTorch" and the logo are the project's marks |
| Fonts | The app uses the system font of each device (it names Inter first, if installed). casatorch.com serves Inter itself | Inter: SIL Open Font License 1.1 |

---

## 2. Services your CasaTorch connects to

Your CasaTorch fetches these **itself, for your household**, from your home internet connection.
casatorch.com is not in the middle (except where marked), and nothing is resold.

| Service | What for | Terms in short | Edition |
| --- | --- | --- | --- |
| **RainViewer** (api.rainviewer.com, tilecache.rainviewer.com) | Rain radar, the past 2 hours | Free API "for personal and educational use only"; credit with a link required; about 100 requests a minute per address, zoom 7 at most. CasaTorch fetches it per home, for that household's own use, shows "RainViewer" on the map, keeps the radar in **Basic** (never sold as Pro) and caches tiles. **Owner/lawyer to confirm** this reading with RainViewer in writing before Pro goes on sale, or switch the default. | Basic |
| **NOAA / National Weather Service** (opengeo.ncep.noaa.gov) | Rain radar alternative for the lower 48 US states | US government work, public domain; credit shown | Basic (setting) |
| **OpenStreetMap** tiles (tile.openstreetmap.org) | Map under the radar | Map data © OpenStreetMap contributors, ODbL; tiles under the OSMF Tile Usage Policy: credit shown, identifying User-Agent, at least 7 days of caching, no bulk downloads. Heavy use needs another tile provider. | Basic |
| **Nominatim** (nominatim.openstreetmap.org) | Turning a town name into a place | ODbL data; usage policy: 1 request a second at most, identifying User-Agent, **no autocomplete-as-you-type**. Setup searches on demand; the widget town picker searches as you type (debounced) - **to fix**: search on Enter, or move to a provider that allows autocomplete. | Basic |
| **MET Norway** (api.met.no) | Weather forecast | Free, CC BY 4.0 and NLOD 2.0; identifying User-Agent required; credit "Weather data: MET Norway" | Basic |
| **ESPN** (site.api.espn.com) | Sports scores | **Unofficial, undocumented endpoint** - no published terms for outside use; can change or stop without notice; ESPN's site terms limit use to personal, non-commercial use. Personal display only, cached. **Lawyer to review**; be ready to switch to a licensed sports data feed. | Basic |
| **Google News RSS** and publishers' RSS feeds (BBC, NPR, NYT, DW and others) | Headlines | Feeds offered for feed readers; headlines link to the publisher; personal use. Google's Terms of Service apply to Google News. CasaTorch shows titles and links only, never article text. **Lawyer to review** for commercial distribution. | Basic |
| **Yahoo Finance** (query1.finance.yahoo.com) | Stocks widget | **Unofficial endpoint**, personal use; may stop working. **Lawyer to review**. | Basic |
| **ipinfo.io** | Your internet provider and city on the Internet tile | Free tier without a token: 1,000 requests a day per address (CasaTorch asks about twice an hour). IPinfo calls this "legacy" and recommends IPinfo Lite (free, commercial use allowed, needs a token and a link credit). **Owner to do**: move to Lite with credit before the legacy API ends. | Basic |
| **Team Cymru** IP-to-ASN DNS service (origin.asn.cymru.com) | Who runs each network on an App test path | Free community service; no published restriction on commercial use; asks for modest volume and the DNS interface for repeat lookups (CasaTorch uses DNS and caches each answer 7 days). Not for geolocation (CasaTorch doesn't use it for that). | Basic |
| **Cloudflare** speed test (speed.cloudflare.com) | Speed tests | Public endpoint behind Cloudflare's speed test; occasional use | Basic |
| **Let's Encrypt** | The certificate for the secure address at home | Turning that address on accepts the Let's Encrypt Subscriber Agreement for the box | Basic |
| **Cloudflare Tunnel** (`cloudflared`, downloaded from Cloudflare's GitHub releases) | Secure access away from home (coming) | cloudflared: Apache-2.0. Traffic passes through Cloudflare under Cloudflare's terms | Pro (coming) |
| **Anthropic** (Claude) or **OpenAI** API, or your own Ollama | Home AI Agent | Your own API key, under your own agreement with that company; billed by them | Pro |
| **Ring** (via ring-client-api) | Ring doorbells and cameras without Home Assistant | **Unofficial API** - not made or approved by Ring; it may break or Ring may object; your Ring account's terms apply. Marked "Labs" in the app. | Pro |
| **Cisco Meraki, UniFi, Pi-hole, AdGuard Home, YoLink, Philips Hue, Shelly, Frigate, Reolink, Home Assistant** | Your own devices and accounts | Official APIs, with your own keys or on your own network | Basic / Pro as listed in docs/EDITIONS.md |
| **Web Speech** (the browser's own speech recognition) | Voice in the Home AI Agent and 3D Home | Runs in the browser. In Chrome and Edge the audio goes to Google or Microsoft to be turned into text, under their terms; Safari uses Apple's. CasaTorch never receives audio, only the text. | Pro |
| **Google sign-in** (optional) | Signing in to CasaTorch with Google | Google's OAuth terms; only if the household turns it on | Basic |

### Run by casatorch.com (the CasaTorch business)

| Service | What for | Provider |
| --- | --- | --- |
| Find my CasaTorch, update checks, secure address names, secure-access tunnels | See PRIVACY.md and casatorch.com/privacy | Cloudflare (Pages, Workers KV, DNS, Tunnel) |
| App alert relay (phone apps) | Waking the phone; alerts are end-to-end encrypted | Cloudflare, Google Firebase Cloud Messaging, Apple Push Notification service |
| Payments, tax | Buying Pro or a Box | Stripe |
| E-mail (keys, codes, the early-access list) | | Resend |
| Shipping labels for the Box | | Shippo and the carrier |
| Downloads | Installers | GitHub Releases |

---

## 3. Names and marks

Home Assistant, Ring, Philips Hue, Cisco Meraki, UniFi and the other product names are trademarks of
their owners. CasaTorch is not affiliated with or endorsed by them; names are used only to say what
CasaTorch works with.

---

## 4. The GNU AGPL and your copy

You may use, change and share CasaTorch under the AGPL-3.0. If you run a **modified** CasaTorch for
other people over a network, the AGPL asks you to offer them the source of your version. The source
of every official release is at github.com/CasaTorch/CasaTorch. Pro keys are a separate commercial
license for CasaTorch's paid features; the AGPL code itself stays free.
