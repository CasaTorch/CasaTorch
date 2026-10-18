/* ======================================================================
 * "Who is it?" for the Security Center's device list (45-security.js).
 *
 *  - The maker, from the first half of the device's hardware (MAC) address:
 *    the IEEE's public list of company prefixes, shipped in
 *    catalog/oui.txt.gz (built by tools/make-oui.mjs; see THIRD_PARTY_NOTICES).
 *    Read once, the first time it's needed.
 *  - What kind of device it likely is: from the names it announces, the
 *    maker, and the services it has open (an AV receiver answers on the
 *    Telnet port because that's how it's controlled; a NAS shares folders).
 *  - What each open port is for on that kind of device, and whether it's
 *    normal there (shown as information) or worth fixing (a warning).
 *  - Names the network already knows, gathered cheaply and only on the home
 *    network: Home Assistant's own device list (by hardware address), mDNS
 *    (Bonjour) names, Windows (NetBIOS) names and UPnP descriptions.
 * Nothing here leaves the box.
 * ====================================================================== */
const MK_FILE = path.join(APP_DIR, 'catalog', 'oui.txt.gz');
let mkOui = null;
function ouiMap() {
  if (mkOui) return mkOui;
  mkOui = new Map();
  try {
    for (const line of zlib.gunzipSync(fs.readFileSync(MK_FILE)).toString('utf8').split('\n')) {
      if (!line || line[0] === '#') continue;
      const tab = line.indexOf('\t'); if (tab < 1) continue;
      const name = line.slice(0, tab);
      for (const p of line.slice(tab + 1).split(' ')) if (p) mkOui.set(p, name);
    }
  } catch { /* no list: devices just show without a maker */ }
  return mkOui;
}
/* The IEEE company name for a hardware address, or null (unknown, or a private/randomized address). */
function ouiName(mac) {
  const m = String(mac || '').toLowerCase();
  if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(m) || /^.[26ae]/.test(m)) return null;   // locally administered: made up by the device, says nothing about the maker
  return ouiMap().get(m.slice(0, 8).replace(/:/g, '').toUpperCase()) || null;
}

/* ---- kinds of device ---- */
const DEV_TYPES = {
  receiver: { label: 'AV receiver', short: 'receiver' },
  speaker: { label: 'Speaker or soundbar', short: 'speaker' },
  voice: { label: 'Smart speaker or display', short: 'smart speaker' },
  tv: { label: 'TV or streaming box', short: 'TV' },
  nas: { label: 'NAS (network storage)', short: 'NAS' },
  printer: { label: 'Printer', short: 'printer' },
  camera: { label: 'Camera or doorbell', short: 'camera' },
  router: { label: 'Router or Wi-Fi point', short: 'router' },
  phone: { label: 'Phone or tablet', short: 'phone' },
  computer: { label: 'Computer', short: 'computer' },
  board: { label: 'Small computer (like a Raspberry Pi)', short: 'small computer' },
  hub: { label: 'Smart-home hub', short: 'hub' },
  smart: { label: 'Smart-home gadget (plug, bulb, sensor)', short: 'gadget' },
  console: { label: 'Game console', short: 'game console' },
  appliance: { label: 'Home appliance', short: 'appliance' },
};

/* Makers common in homes: a friendly name and the kinds of device they make, most likely first.
   [pattern on the IEEE name, friendly name, short name, kinds, note]. Anything else shows its IEEE name as is. */
const CHIP_NOTE = 'This maker makes the Wi-Fi chip inside many smart plugs, bulbs, sensors and other gadgets, so the device itself may carry another brand.';
const MAKERS = [
  [/^D&M Holdings/i, 'Denon/Marantz (D&M)', 'Denon/Marantz', ['receiver', 'speaker']],
  [/^Sound United/i, 'Denon/Marantz (Sound United)', 'Denon/Marantz', ['receiver', 'speaker']],
  [/^Onkyo/i, 'Onkyo', null, ['receiver']],
  [/^Pioneer/i, 'Pioneer', null, ['receiver']],
  [/^Yamaha$/i, 'Yamaha', null, ['receiver', 'speaker']],
  [/^Harman (Consumer|Multimedia)/i, 'Harman (JBL, Harman Kardon)', 'Harman', ['speaker', 'receiver']],
  [/^Sonos/i, 'Sonos', null, ['speaker']],
  [/^Bose$/i, 'Bose', null, ['speaker']],
  [/^Bang & Olufsen/i, 'Bang & Olufsen', null, ['speaker', 'tv']],
  [/^Lenbrook/i, 'Bluesound (Lenbrook)', 'Bluesound', ['speaker']],
  [/^Sony Interactive|^Sony Computer Entertainment/i, 'Sony PlayStation', 'PlayStation', ['console']],
  [/^Sony/i, 'Sony', null, ['tv', 'receiver', 'speaker']],
  [/^Roku/i, 'Roku', null, ['tv']],
  [/^LG Electr/i, 'LG', null, ['tv', 'appliance', 'phone']],
  [/^Samsung Electronics|^SAMSUNG Electronics/i, 'Samsung', null, ['phone', 'tv', 'appliance']],
  [/^Vizio/i, 'Vizio', null, ['tv']],
  [/^TCL/i, 'TCL', null, ['tv']],
  [/^Hisense/i, 'Hisense', null, ['tv']],
  [/^TP Vision/i, 'Philips TV (TP Vision)', 'Philips', ['tv']],
  [/^Panasonic/i, 'Panasonic', null, ['tv']],
  [/^Sharp$/i, 'Sharp', null, ['tv']],
  [/^Skyworth/i, 'Skyworth', null, ['tv']],
  [/^NVIDIA/i, 'NVIDIA', null, ['tv', 'computer']],
  [/^Synology/i, 'Synology', null, ['nas']],
  [/^QNAP/i, 'QNAP', null, ['nas']],
  [/^Ugreen/i, 'Ugreen', null, ['nas', 'computer']],
  [/^iXsystems/i, 'TrueNAS (iXsystems)', 'TrueNAS', ['nas']],
  [/^Western Digital/i, 'Western Digital', null, ['nas']],
  [/^Seagate/i, 'Seagate', null, ['nas']],
  [/^Buffalo/i, 'Buffalo', null, ['nas', 'router']],
  [/^Brother Industries/i, 'Brother', null, ['printer']],
  [/^Seiko Epson/i, 'Epson', null, ['printer']],
  [/^Canon/i, 'Canon', null, ['printer', 'camera']],
  [/^Hewlett Packard$/i, 'HP', null, ['printer', 'computer']],
  [/^Xerox/i, 'Xerox', null, ['printer']],
  [/^Lexmark/i, 'Lexmark', null, ['printer']],
  [/^Kyocera Document/i, 'Kyocera', null, ['printer']],
  [/^Ricoh/i, 'Ricoh', null, ['printer']],
  [/Hikvision/i, 'Hikvision', null, ['camera']],
  [/Ezviz/i, 'EZVIZ', null, ['camera']],
  [/Dahua/i, 'Dahua', null, ['camera']],
  [/^Amcrest/i, 'Amcrest', null, ['camera']],
  [/^Reolink/i, 'Reolink', null, ['camera']],
  [/^Axis Communications/i, 'Axis', null, ['camera']],
  [/^Zhejiang Uniview/i, 'Uniview', null, ['camera']],
  [/^Hanwha/i, 'Hanwha', null, ['camera']],
  [/^Lorex/i, 'Lorex', null, ['camera']],
  [/^Wyze/i, 'Wyze', null, ['camera', 'smart']],
  [/^Ring$/i, 'Ring', null, ['camera']],
  [/^Blink by Amazon/i, 'Blink', null, ['camera']],
  [/^Arlo/i, 'Arlo', null, ['camera']],
  [/^SimpliSafe/i, 'SimpliSafe', null, ['hub', 'camera']],
  [/^Nest Labs/i, 'Google Nest', 'Nest', ['smart', 'camera']],
  [/^Ubiquiti/i, 'Ubiquiti', null, ['router', 'camera']],
  [/^TP-Link|^TP-LINK/i, 'TP-Link', null, ['router', 'smart', 'camera']],
  [/^NETGEAR/i, 'Netgear', null, ['router']],
  [/^Linksys/i, 'Linksys', null, ['router']],
  [/^Belkin/i, 'Belkin', null, ['smart', 'router']],
  [/^ASUSTek/i, 'ASUS', null, ['router', 'computer']],
  [/^eero/i, 'eero', null, ['router']],
  [/^Plume Design/i, 'Plume', null, ['router']],
  [/^(Arris|CommScope)/i, 'Arris (CommScope)', 'Arris', ['router']],
  [/^(Technicolor|Vantiva)/i, 'Vantiva (Technicolor)', 'Vantiva', ['router']],
  [/^Sagemcom/i, 'Sagemcom', null, ['router']],
  [/^AVM( Audiovisuelles|$)/i, 'AVM (FRITZ!Box)', 'FRITZ!Box', ['router']],
  [/^Routerboard/i, 'MikroTik', null, ['router']],
  [/^Zyxel/i, 'Zyxel', null, ['router']],
  [/^D-Link/i, 'D-Link', null, ['router', 'camera']],
  [/^Actiontec/i, 'Actiontec', null, ['router']],
  [/^Calix/i, 'Calix', null, ['router']],
  [/^Arcadyan/i, 'Arcadyan', null, ['router']],
  [/^Askey/i, 'Askey', null, ['router']],
  [/^Sercomm/i, 'Sercomm', null, ['router', 'camera']],
  [/^Hitron/i, 'Hitron', null, ['router']],
  [/^GL Technologies/i, 'GL.iNet', null, ['router']],
  [/^Huawei Technologies|^HUAWEI TECHNOLOGIES/i, 'Huawei', null, ['router', 'phone']],
  [/^Huawei Device/i, 'Huawei', null, ['phone']],
  [/^zte$/i, 'ZTE', null, ['router', 'phone']],
  [/^Apple$/i, 'Apple', null, ['phone', 'computer', 'tv', 'voice']],
  [/^Google$/i, 'Google', null, ['phone', 'voice', 'tv']],
  [/^Amazon/i, 'Amazon (Echo, Fire TV, Kindle)', 'Amazon', ['voice', 'tv', 'phone']],
  [/^OnePlus/i, 'OnePlus', null, ['phone']],
  [/^GUANGDONG OPPO/i, 'OPPO', null, ['phone']],
  [/^vivo Mobile/i, 'vivo', null, ['phone']],
  [/Xiaomi/i, 'Xiaomi', null, ['phone', 'smart']],
  [/^Motorola Mobility/i, 'Motorola', null, ['phone']],
  [/^Fitbit|^Garmin/i, null, null, ['phone']],
  [/^Intel$|^Intel Wireless/i, 'Intel', null, ['computer'], 'Intel makes the Wi-Fi and network chips in many computers, so this is most likely a laptop or desktop.'],
  [/^Dell/i, 'Dell', null, ['computer']],
  [/^Lenovo/i, 'Lenovo', null, ['computer', 'phone']],
  [/^Microsoft/i, 'Microsoft', null, ['computer', 'console']],
  [/^Hon Hai/i, 'Foxconn (Hon Hai)', 'Foxconn', ['computer', 'tv', 'console'], 'Foxconn builds devices for many brands (computers, TVs, game consoles), so the device itself carries another name.'],
  [/^Lite-?on|^LiteON/i, 'Lite-On', null, ['computer'], 'Lite-On makes network chips for many computers and TVs.'],
  [/^AzureWave/i, 'AzureWave', null, ['computer', 'smart'], 'AzureWave makes the Wi-Fi module inside many laptops, TVs and gadgets.'],
  [/^Realtek/i, 'Realtek', null, ['computer', 'smart'], 'Realtek makes network chips used in many computers, TVs and gadgets.'],
  [/^Giga-?Byte/i, 'Gigabyte', null, ['computer']],
  [/^Micro-Star/i, 'MSI', null, ['computer']],
  [/^ASRock/i, 'ASRock', null, ['computer']],
  [/^Acer$/i, 'Acer', null, ['computer']],
  [/^Raspberry Pi/i, 'Raspberry Pi', null, ['board']],
  [/^Nintendo/i, 'Nintendo', null, ['console']],
  [/^Valve/i, 'Valve (Steam)', 'Valve', ['console', 'computer']],
  [/^Nabu Casa/i, 'Home Assistant (Nabu Casa)', 'Home Assistant', ['hub']],
  [/^Athom/i, 'Homey (Athom)', 'Homey', ['hub']],
  [/^SmartThings|^Samjin/i, 'SmartThings', null, ['hub', 'smart']],
  [/^Signify|^Philips Lighting/i, 'Philips Hue (Signify)', 'Philips Hue', ['hub', 'smart']],
  [/^WiZ/i, 'WiZ', null, ['smart']],
  [/^Lutron/i, 'Lutron', null, ['hub']],
  [/^Lumi United/i, 'Aqara (Lumi)', 'Aqara', ['hub', 'smart']],
  [/^ecobee/i, 'ecobee', null, ['smart']],
  [/^iRobot/i, 'iRobot (Roomba)', 'iRobot', ['smart']],
  [/Roborock/i, 'Roborock', null, ['smart']],
  [/^Shelly|^Allterco/i, 'Shelly', null, ['smart']],
  [/Meross/i, 'Meross', null, ['smart']],
  [/^Nanoleaf/i, 'Nanoleaf', null, ['smart']],
  [/^Leviton/i, 'Leviton', null, ['smart']],
  [/^Eve Systems/i, 'Eve', null, ['smart']],
  [/^ASSA ABLOY|^August Home/i, 'Yale/August (ASSA ABLOY)', 'Yale/August', ['smart']],
  [/^Chamberlain/i, 'Chamberlain (myQ)', 'Chamberlain', ['smart']],
  [/^Espressif/i, 'Espressif', null, ['smart'], CHIP_NOTE],
  [/^Tuya/i, 'Tuya', null, ['smart'], CHIP_NOTE],
  [/^Silicon Laboratories/i, 'Silicon Labs', null, ['smart'], CHIP_NOTE],
  [/^Texas Instruments/i, 'Texas Instruments', null, ['smart'], CHIP_NOTE],
  [/^Murata Manufacturing/i, 'Murata', null, ['smart', 'computer'], CHIP_NOTE],
  [/^Universal Global Scientific/i, 'USI', null, ['smart', 'computer'], CHIP_NOTE],
  [/^Whirlpool/i, 'Whirlpool', null, ['appliance']],
  [/^BSH/i, 'Bosch/Siemens (BSH)', 'Bosch/Siemens', ['appliance']],
  [/^Miele/i, 'Miele', null, ['appliance']],
  [/^Daikin|^Mitsubishi Electric$/i, null, null, ['appliance']],
  [/^Tesla$/i, 'Tesla', null, ['appliance']],
];
/* "HUAWEI TECHNOLOGIES" -> "Huawei Technologies": IEEE names are often all capitals. */
const tidyName = (s) => (/[a-z]/.test(s) ? s : s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()));
function makerOf(mac) {
  const raw = ouiName(mac); if (!raw) return null;
  const hit = MAKERS.find(([re]) => re.test(raw));
  const name = hit?.[1] || tidyName(raw);
  return { name, short: hit?.[2] || name, raw, types: hit?.[3] || [], note: hit?.[4] || null };
}

/* ---- what the names say ---- */
const NAME_HINTS = [
  ['receiver', /(^|[^a-z])(avr|receiver|av-?receiver|sr\d{4}|nr\d{4}|tx-nr|rx-[av]\d|denon|marantz|onkyo)/i],
  ['nas', /(^|[^a-z])(nas|diskstation|ds\d{3,4}|synology|qnap|truenas|unraid|ugreen|dxp\d|asustor|readynas|mycloud|openmediavault)/i],
  ['printer', /(printer|epson|brother|canon|laserjet|officejet|deskjet|^hp[0-9a-f]{6}$|mfc-|xerox|lexmark)/i],
  ['camera', /((^|[-_ .])cam([-_ .\d]|$)|camera|doorbell|nvr|dvr|reolink|hikvision|dahua|amcrest|wyze|arlo|eufy)/i],
  ['router', /(router|gateway|modem|mesh|eero|orbi|(^|[-_ ])deco|access.?point|unifi|(^|[-_ ])udm|fritz|mikrotik|openwrt)/i],
  ['phone', /(iphone|ipad|android|galaxy|pixel|phone|oneplus|redmi|tablet|kindle)/i],
  ['computer', /(macbook|imac|mac-?mini|mac-?studio|mac-?pro|desktop|laptop|(^|[-_ ])pc([-_ ]|$)|thinkpad|surface|windows|ubuntu|workstation|(^|[-_ ])nuc)/i],
  ['voice', /(echo|alexa|google-?home|nest-?(mini|hub|audio)|homepod)/i],
  ['speaker', /(sonos|speaker|soundbar|heos|bose)/i],
  ['tv', /((^|[-_ .])tv([-_ .\d]|$)|roku|chromecast|apple-?tv|fire-?tv|shield|bravia|webos|tizen|vizio)/i],
  ['hub', /(home-?assistant|homeassistant|hassio|hubitat|smartthings|hue-?bridge|philips-hue|homey|zigbee)/i],
  ['console', /(xbox|playstation|(^|[-_ ])ps[345]([-_ ]|$)|nintendo|steam-?deck)/i],
  ['board', /(raspberry|(^|[-_ ])rpi|(^|[-_ ])pi[-_ \d]?$)/i],
  ['smart', /(plug|bulb|light|lamp|shelly|tasmota|esphome|(^|[-_ ])esp[-_]?(32|8266)?[-_]|tuya|sonoff|wled|thermostat|ecobee|sensor|wemo|kasa|tapo|meross|switchbot|nanoleaf|govee|vacuum|roomba|roborock)/i],
];
const typeFromNames = (names) => { for (const n of names) for (const [type, re] of NAME_HINTS) if (re.test(n)) return type; return null; };

/* ---- open ports: what each is for, and when it's normal ---- */
const PORT_USE = {
  21: 'Sending files (FTP)', 23: 'Remote login (Telnet), or controlling some AV receivers', 2323: 'Remote login (Telnet, second port)',
  445: 'Shared folders (Windows file sharing)', 554: 'Camera video streams (RTSP)', 631: 'Printing (IPP / AirPrint)', 9100: 'Printing (sent straight to the printer)',
  1883: 'Smart-home messages (MQTT)', 3389: 'Taking over a Windows computer\'s screen (Remote Desktop)', 5900: 'Screen sharing (VNC)',
};
/* [kinds, port, how] - normal for that kind of device: shown as information, not a warning. */
const PORT_NORMAL = [
  [['receiver'], 23, 'Telnet is how this receiver is controlled on your network (Home Assistant uses it). It\'s fine on a home network; keep it off the internet.'],
  [['nas'], 445, 'Normal on a NAS: it\'s how computers open its shared folders. Make sure guest access is off and every share needs a password.'],
  [['nas', 'hub', 'board'], 1883, 'Normal here: many NAS boxes, smart-home hubs and small computers run the MQTT service that smart-home gadgets talk to. Make sure it needs a username and password.'],
  [['printer'], 631, 'How computers and phones send pages to this printer. Normal.'],
  [['printer'], 9100, 'How computers send pages to this printer. Normal.'],
  [['camera'], 554, 'How this camera sends video to a recorder or Home Assistant. Normal - make sure the camera\'s video needs a password.'],
  [['computer'], 445, 'Normal on a computer that shares folders. Make sure guest access is off and every share needs a password.'],
];
/* Ports that are worse than usual on some kinds of device. */
const PORT_WORSE = [
  [['camera', 'router'], 23, 'Telnet on a camera or router is one of the most common ways attackers get in. Update its firmware and turn Telnet off; if it can\'t be turned off, replace the device or keep it off the internet.'],
  [['unknown'], 23, 'An old, unencrypted way to log in remotely, on a device CasaTorch can\'t identify. Find out what it is (see "Who is it?") - AV receivers use it to be controlled, but almost nothing else should have it on.'],
];
const PORT_PRIVATE_SMB = 'Phones and tablets don\'t share folders, so this is most likely a computer using a private Wi-Fi address (Windows and Mac can too). Fine if you share folders on purpose; make sure every share needs a password.';
/* The likely kind of device: what the person said, then names, then maker + open ports. why: a short reason in plain words. */
function deviceGuess(d, maker = makerOf(d?.mac)) {
  const ports = (d?.ports || []).map((p) => (typeof p === 'object' ? p.port : p));
  const has = (p) => ports.includes(p), cands = maker?.types || [];
  const h = d?.hints || {}, names = [h.ha?.name, h.ha?.model, h.upnp?.name, h.upnp?.model, h.mdns, h.netbios, d?.host].filter(Boolean).map(String);
  if (d?.type && DEV_TYPES[d.type]) return { type: d.type, sure: true, userType: true, why: 'You said so.' };
  const byName = typeFromNames(names);
  if (byName) return { type: byName, sure: true, why: 'From the name it goes by.' };
  const pick = (t, why) => ({ type: t, sure: true, why });
  if (has(23) && cands.includes('receiver')) return pick('receiver', 'Its maker makes AV receivers, and it answers on the port receivers are controlled through.');
  if ((has(631) || has(9100)) && (!maker || cands.includes('printer') || !cands.length)) return pick('printer', 'It accepts print jobs.');
  if (has(445) && cands.includes('nas')) return pick('nas', 'Its maker makes NAS boxes, and it shares folders.');
  if (has(554) && (cands.includes('camera') || !maker)) return pick('camera', 'It sends a camera video stream.');
  if (has(3389) && !cands.length) return pick('computer', 'It has Remote Desktop on.');
  if (has(445) && d?.privateMac) return { type: 'computer', sure: false, why: 'It shares folders, which phones and tablets don\'t do.' };
  if (cands.length) return { type: cands[0], sure: cands.length === 1, why: 'From what its maker makes.' };
  if (d?.privateMac) return { type: null, sure: false, why: null };
  return { type: null, sure: false, why: null };
}
/* One open port, explained for this device. level: warning (fix it), notice (check it), info (normal here). */
function portView(port, guess, d) {
  const r = RISKY_PORTS.find(([p]) => p === port);
  const base = r ? { port, name: r[1], level: r[2], how: r[3] } : { port, name: `Port ${port}`, level: 'notice', how: '' };
  base.use = PORT_USE[port] || null;
  const t = guess?.type || 'unknown';
  if (port === 445 && d?.privateMac && !guess?.userType) return { ...base, how: PORT_PRIVATE_SMB };
  const normal = guess?.sure && PORT_NORMAL.find(([types, p]) => p === port && types.includes(t));
  if (normal) return { ...base, level: 'info', how: normal[2], normal: true };
  const worse = PORT_WORSE.find(([types, p]) => p === port && types.includes(t));
  if (worse) return { ...base, level: 'warning', how: worse[2] };
  return base;
}
/* Everything the device card shows under "Who is it?". */
function whoIsIt(d) {
  const maker = makerOf(d.mac), guess = deviceGuess(d, maker), h = d.hints || {};
  const names = [];
  const add = (from, name, extra) => { const n = String(name || '').trim().slice(0, 80); if (n && !names.some((x) => x.name.toLowerCase() === n.toLowerCase())) names.push({ from, name: n, ...(extra ? { extra: String(extra).slice(0, 80) } : {}) }); };
  if (h.ha?.name) add('Home Assistant', h.ha.name, [h.ha.maker, h.ha.model].filter(Boolean).join(' '));
  if (h.upnp?.name) add('UPnP', h.upnp.name, [h.upnp.maker, h.upnp.model].filter(Boolean).join(' '));
  if (h.mdns) add('Bonjour (mDNS)', h.mdns);
  if (h.netbios) add('Windows network name', h.netbios);
  if (d.host) add('Router (DNS)', d.host);
  const T_ = guess.type ? DEV_TYPES[guess.type] : null;
  return { maker: maker ? { name: maker.name, short: maker.short, ieee: maker.raw, note: maker.note, kinds: maker.types.map((t) => DEV_TYPES[t].label) } : null,
    type: guess.type, typeLabel: T_?.label || null, typeShort: T_?.short || null, sure: !!guess.sure, why: guess.why, userType: !!d.type, names };
}

/* ---- names the network already knows (cheap, home network only) ---- */
const MK_HA = { at: 0, map: new Map() };
async function haNamesByMac() {
  if (!config.homeAssistant?.url || typeof haWs !== 'function') return MK_HA.map;
  if (Date.now() - MK_HA.at < 3600_000) return MK_HA.map;
  MK_HA.at = Date.now();
  try {
    const list = await haWs({ type: 'config/device_registry/list' }, 20000), map = new Map();
    for (const dv of Array.isArray(list) ? list : []) for (const [kind, val] of dv.connections || []) if (kind === 'mac') {
      const mac = normMac(val); if (macOk(mac)) map.set(mac, { name: String(dv.name_by_user || dv.name || '').slice(0, 80) || null, maker: String(dv.manufacturer || '').slice(0, 60) || null, model: String(dv.model || '').slice(0, 60) || null });
    }
    MK_HA.map = map;
  } catch { /* Home Assistant busy or older: keep what we had */ }
  return MK_HA.map;
}
/* mDNS reverse names: "20.1.168.192.in-addr.arpa" -> "Living-Room.local". One packet asks for many addresses. */
async function mdnsNames(ips) {
  const out = {}, rev = (ip) => `${ip.split('.').reverse().join('.')}.in-addr.arpa`;
  for (let i = 0; i < ips.length; i += 16) {
    const chunk = ips.slice(i, i + 16), recs = await mdnsAsk(chunk.map(rev), 12, 1500).catch(() => []);
    for (const ip of chunk) { const r = recs.find((x) => x.type === 12 && x.name === rev(ip).toLowerCase()); if (r?.data) out[ip] = String(r.data).replace(/\.local\.?$/i, '').slice(0, 63); }
  }
  return out;
}
/* Windows (NetBIOS) names: a 50-byte "node status" question to each address, the computer's name back. */
const NB_ASK = (() => { const b = Buffer.alloc(50); b.writeUInt16BE(0x4354, 0); b.writeUInt16BE(1, 4); b[12] = 0x20; b.write('CKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 13, 'latin1'); b.writeUInt16BE(0x21, 46); b.writeUInt16BE(1, 48); return b; })();
function parseNbStatus(buf) {
  try {
    if (buf.length < 57 || buf.readUInt16BE(6) < 1) return null;
    let off = 12; while (off < buf.length && buf[off] !== 0) off += buf[off] + 1; off += 1 + 10;   // the name, then type/class/ttl/length
    const n = buf[off]; off++;
    for (let i = 0; i < n && off + 18 <= buf.length; i++, off += 18) {
      const name = buf.toString('latin1', off, off + 15).trim(), suffix = buf[off + 15], group = buf[off + 16] & 0x80;
      if (suffix === 0 && !group && /^[\x21-\x7e][\x20-\x7e]*$/.test(name)) return name.slice(0, 15);
    }
  } catch { /* broken answer */ }
  return null;
}
function netbiosNames(ips, ms = 1500) {
  return new Promise((done) => {
    const out = {}; let s;
    try { s = dgram.createSocket('udp4'); } catch { done(out); return; }
    const finish = () => { try { s.close(); } catch { /* closed */ } done(out); };
    s.on('error', finish);
    s.on('message', (m, r) => { if (ips.includes(r.address) && !out[r.address]) { const n = parseNbStatus(m); if (n) out[r.address] = n; } });
    s.bind(0, () => { for (const ip of ips) s.send(NB_ASK, 137, ip, () => {}); setTimeout(finish, ms); });
  });
}
/* UPnP: who answers an SSDP search, and the name in its description (only fetched from the address that answered). */
const upnpTag = (x, t) => { const m = String(x).match(new RegExp(`<${t}>([^<]{1,120})</${t}>`, 'i')); return m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, '\'').trim() : null; };
function parseUpnpDesc(xml) { const name = upnpTag(xml, 'friendlyName'), maker = upnpTag(xml, 'manufacturer'), model = upnpTag(xml, 'modelName'); return name || model ? { name, maker, model } : null; }
function upnpFetch(url, ip) {
  return new Promise((ok) => {
    let u; try { u = new URL(url); } catch { ok(null); return; }
    if (u.protocol !== 'http:' || u.hostname !== ip || !PRIVATE4.test(ip)) { ok(null); return; }   // only the device that answered, only on the home network
    const rq = http.get({ host: ip, port: u.port || 80, path: u.pathname + u.search, timeout: 2500, headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); ok(null); return; }
      let body = ''; res.setEncoding('utf8');
      res.on('data', (c) => { body += c; if (body.length > 65536) { rq.destroy(); ok(parseUpnpDesc(body)); } });
      res.on('end', () => ok(parseUpnpDesc(body)));
    });
    rq.on('timeout', () => { rq.destroy(); ok(null); }); rq.on('error', () => ok(null));
  });
}
function ssdpNames(ips, ms = 2500) {
  return new Promise((done) => {
    const loc = {}; let s;
    try { s = dgram.createSocket('udp4'); } catch { done({}); return; }
    const finish = async () => {
      try { s.close(); } catch { /* closed */ }
      const out = {};
      await Promise.all(Object.entries(loc).map(async ([ip, url]) => { const r = await upnpFetch(url, ip); if (r) out[ip] = r; }));
      done(out);
    };
    s.on('error', () => done({}));
    s.on('message', (m, r) => { if (!ips.includes(r.address) || loc[r.address]) return; const l = String(m).match(/^location:\s*(\S+)/im); if (l) loc[r.address] = l[1].slice(0, 300); });
    s.bind(0, () => { s.send(Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: upnp:rootdevice\r\n\r\n'), 1900, '239.255.255.250', () => {}); setTimeout(finish, ms); });
  });
}
/* Fills d.hints for the devices that need it (new, or not looked at for 12 hours). Never throws. */
async function gatherHints(devs) {
  const now = Date.now(), due = devs.filter((d) => PRIVATE4.test(d.ip) && (!d.hintsAt || now - Date.parse(d.hintsAt) > 12 * 3600_000));
  const ha = await haNamesByMac().catch(() => new Map());
  for (const d of devs) { const x = ha.get(d.mac); if (x) (d.hints ||= {}).ha = x; }
  if (!due.length) return;
  const ips = due.map((d) => d.ip);
  const [md, nb, up] = await Promise.all([mdnsNames(ips).catch(() => ({})), netbiosNames(ips).catch(() => ({})), ssdpNames(ips).catch(() => ({}))]);
  for (const d of due) {
    const hh = (d.hints ||= {});
    if (md[d.ip]) hh.mdns = md[d.ip]; if (nb[d.ip]) hh.netbios = nb[d.ip]; if (up[d.ip]) hh.upnp = up[d.ip];
    d.hintsAt = nowIso();
  }
}
/* The best name the network gave it (shown when the person hasn't named it). */
const announcedName = (d) => d.hints?.ha?.name || d.hints?.upnp?.name || d.hints?.mdns || d.hints?.netbios || d.host || null;

if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchMakers = { ouiName, makerOf, deviceGuess, portView, whoIsIt, typeFromNames, parseNbStatus, parseUpnpDesc, mdnsNames, announcedName, DEV_TYPES, NB_ASK };
