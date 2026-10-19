/* ======================================================================
 * CasaTorch - setup: config, data folder, demo mode.
 *
 * The server is built from src/server/*.js in name order into one module
 * (build.mjs). Every house-specific value lives in data/config.json, written
 * by the setup wizard (/setup) - never in code.
 *
 *   no config.json         -> the setup wizard (/setup)
 *   config.demo = true     -> demo mode: sample data from ../demo/fixtures
 *   CASATORCH_DEMO=1         -> demo mode regardless
 *   CASATORCH_SETUP=1        -> re-open the wizard on a configured install
 * ====================================================================== */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
/* CasaTorch was called HouseOS: its old HOUSEOS_* settings still work. */
for (const [k, v] of Object.entries(process.env)) if (k.startsWith('HOUSEOS_') && process.env[`CASATORCH_${k.slice(8)}`] === undefined) process.env[`CASATORCH_${k.slice(8)}`] = v;

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(process.env.CASATORCH_DATA_DIR || path.join(APP_DIR, '..', 'data'));   // absolute, so files are always sent from the right place
/* One version for everything (package.json), and how this copy was installed - so update notices say the right thing. */
const VERSION = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8')).version;
const INSTALL = process.env.CASATORCH_INSTALL || (process.env.SUPERVISOR_TOKEN ? 'ha-addon' : fs.existsSync('/.dockerenv') ? 'docker' : 'manual');
const CONFIG_FILE = process.env.CASATORCH_CONFIG || path.join(DATA_DIR, 'config.json');
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
try { fs.chmodSync(DATA_DIR, 0o700); } catch { /* not ours to change (some NAS shares) */ }

/* ---- secrets at rest ----
   One random 256-bit key per install (data/secret.key, owner-only, kept apart from the files it protects).
   Sign-in secrets and every token, API key and password in config.json are stored AES-256-GCM sealed,
   so a copied config.json or users.json on its own is useless. */
const KEY_FILE = path.join(DATA_DIR, 'secret.key');
let secretKey = null;
/* The key is never overwritten: a key file that can't be read stops CasaTorch with a clear message (so a
   permissions slip can't quietly throw every saved secret away), and a damaged one is moved aside, kept,
   before a new key is made. A new key is written atomically, owner-only, and only if no key file exists. */
function loadKeyFile(file, tries = 0) {
  let raw = null;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (e) { if (e.code !== 'ENOENT') throw new Error(`CasaTorch can't read its key file (${file}: ${e.code}). Fix its permissions; nothing was changed.`); }
  if (raw !== null) {
    const k = Buffer.from(raw.trim(), 'base64');
    if (k.length === 32) {
      try { if (process.platform !== 'win32' && (fs.statSync(file).mode & 0o077)) fs.chmodSync(file, 0o600); } catch { /* not ours to change */ }
      return k;
    }
    const aside = `${file}.damaged-${Date.now()}`;
    try { fs.renameSync(file, aside); } catch { /* read-only: making the new key below fails too, and says so */ }
    console.error(`${path.basename(file)} was damaged: kept as ${path.basename(aside)}; a new key was made, so saved passwords and tokens must be entered again.`);
  }
  if (tries > 2) throw new Error(`CasaTorch couldn't make its key file (${file}).`);
  const k = crypto.randomBytes(32), tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeFileSync(fd, k.toString('base64')); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.linkSync(tmp, file); fs.rmSync(tmp, { force: true }); }   // only if there is still no key file
  catch {
    if (fs.existsSync(file)) { fs.rmSync(tmp, { force: true }); return loadKeyFile(file, tries + 1); }   // another copy of CasaTorch made one first: use that
    fs.renameSync(tmp, file);   // no hard links on this file system (some NAS shares): a plain swap
  }
  try { const d = fs.openSync(path.dirname(file), 'r'); fs.fsyncSync(d); fs.closeSync(d); } catch { /* Windows can't fsync a folder */ }
  return k;
}
const keyOf = () => secretKey || (secretKey = loadKeyFile(KEY_FILE));
/* Sealed values: AES-256-GCM, a fresh 96-bit nonce each time.
     v1.<nonce>.<data>.<tag>   older values (and other files' secrets): the value alone
     v2.<nonce>.<data>.<tag>   the value bound to its place: the field's name ("homeAssistant.token") is sealed in with
                               it (inside the authenticated data), so a sealed value moved to another field won't open there.
   seal(text, field) makes v2 when given a field; unseal(s, field) opens v2 only for that same field (unseal(s) with no
   field opens either - for checks like "does the key file still open these settings"; the settings always pass their field). */
function seal(text, field) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', keyOf(), iv);
  const plain = field ? Buffer.concat([Buffer.from(String(field), 'utf8'), Buffer.from([0]), Buffer.from(String(text), 'utf8')]) : Buffer.from(String(text), 'utf8');
  const enc = Buffer.concat([c.update(plain), c.final()]); plain.fill(0);
  return `${field ? 'v2' : 'v1'}.${iv.toString('base64url')}.${enc.toString('base64url')}.${c.getAuthTag().toString('base64url')}`;
}
function unseal(s, field) {
  const [v, iv, enc, tag, extra] = String(s || '').split('.');
  if ((v !== 'v1' && v !== 'v2') || extra !== undefined || !iv || !tag) return null;
  let out = null;
  try { const d = crypto.createDecipheriv('aes-256-gcm', keyOf(), Buffer.from(iv, 'base64url')); d.setAuthTag(Buffer.from(tag, 'base64url')); out = Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]); }
  catch { return null; }
  try {
    if (v === 'v1') return out.toString('utf8');
    const z = out.indexOf(0); if (z < 0) return null;
    if (field !== undefined && out.subarray(0, z).toString('utf8') !== String(field)) return null;   // sealed for another field
    return out.subarray(z + 1).toString('utf8');
  } finally { out.fill(0); }   // the opened bytes don't linger in memory (the text itself is a JavaScript string, which can't be wiped)
}
/* Which config.json values are secrets: anything called token, refreshToken, apiKey, secret, password or
   clientSecret, anywhere in the file, plus the Hue bridge's username (it is the bridge's password). */
const SECRET_KEYS = /^(token|refreshToken|apiKey|secret|password|clientSecret|privateKey|license|snapshotUrl)$/;   // snapshot addresses can carry a camera login
const SEALED = /^v[12]\.[\w-]+\.[\w-]*\.[\w-]+$/;
const isSecretKey = (k, v, trail) => typeof v === 'string' && v !== '' && (SECRET_KEYS.test(k) || (trail === 'hue' && k === 'username') || (trail === 'dns' && k === 'key') || (trail === 'yolink' && k === 'uaid') || (trail === 'calendars' && k === 'url'));   // a private calendar link is a password too
/** fn(value, place) for every secret; place is where it sits, like "homeAssistant.token" or "cameras[].password".
    For the settings in memory, fn gets the sealed value as kept (nothing is opened to walk them). */
const BOXES = new WeakMap();   // object -> { field: its sealed value } (sealedView)
function mapSecrets(obj, fn, trail = '', place = '') {
  if (Array.isArray(obj)) return obj.map((v) => mapSecrets(v, fn, trail, `${place}[]`));
  if (!obj || typeof obj !== 'object') return obj;
  const out = {}, boxes = BOXES.get(obj);
  for (const k of Object.keys(obj)) {
    const v = boxes && Object.hasOwn(boxes, k) ? boxes[k] : obj[k], at = place ? `${place}.${k}` : k;
    out[k] = isSecretKey(k, v, trail) ? fn(v, at) : mapSecrets(v, fn, k, at);
  }
  return out;
}
const sealConfig = (c) => mapSecrets(c, (v, at) => {
  if (!SEALED.test(v)) return seal(v, at);
  if (v.startsWith('v2.') && unseal(v, at) !== null) return v;
  const plain = unseal(v); return plain === null ? v : seal(plain, at);   // an older value, or one moved here in memory: bound to this field now (one that won't open is kept as it is)
});
const openConfig = (c) => mapSecrets(c, (v, at) => (SEALED.test(v) ? (unseal(v, v.startsWith('v2.') ? at : undefined) ?? '') : v));
/* In memory, too, every secret in the settings stays sealed: each one is kept as its sealed value, and opened only at
   the moment it's read (config.homeAssistant.token opens the token for that one use). Nothing keeps an opened copy,
   and saving writes the sealed values as they are. Writing a secret (h.token = '...') seals it on the spot. */
function sealedView(obj, trail = '', place = '') {
  if (Array.isArray(obj)) { obj.forEach((v) => sealedView(v, trail, `${place}[]`)); return obj; }
  if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) return obj;
  let boxes = BOXES.get(obj);
  for (const k of Object.keys(obj)) {
    const at = place ? `${place}.${k}` : k;
    if (boxes && Object.hasOwn(boxes, k)) continue;   // already kept sealed
    const v = obj[k];
    if (!isSecretKey(k, v, trail)) { sealedView(v, k, at); continue; }
    if (!boxes) BOXES.set(obj, boxes = {});
    boxes[k] = SEALED.test(v) ? v : seal(v, at);
    if (boxes[k].startsWith('v2.') && unseal(boxes[k], at) === null && unseal(boxes[k]) !== null) { console.warn(`A saved secret was in the wrong place in the settings file (${at}), so it isn't used. Enter it again.`); boxes[k] = ''; }   // sealed for another field: moved by hand
    Object.defineProperty(obj, k, {
      enumerable: true, configurable: true,
      get: () => { const b = boxes[k]; return typeof b === 'string' && b ? unseal(b, b.startsWith('v2.') ? at : undefined) ?? '' : b; },   // '' when sealed for another field
      set: (nv) => { boxes[k] = typeof nv === 'string' && nv !== '' && !SEALED.test(nv) ? seal(nv, at) : nv; },
    });
  }
  return obj;
}
/** A secret from config: the plain value, opened into the caller's own variable at the moment it's used. */
const secretOf = (v) => (SEALED.test(String(v || '')) ? unseal(v) || '' : String(v || ''));
/** What a page may be shown of a saved secret: that one is saved, and a short fingerprint to tell two apart
    (a keyed hash - not any part of the secret itself). */
const maskSecret = (v) => { const s = secretOf(v); return s ? `•••• ${crypto.createHmac('sha256', keyOf()).update(`mask:${s}`).digest('hex').slice(0, 4)}` : null; };
let plaintextOnDisk = false;
/* Passwords and keys typed into CasaTorch's pages arrive sealed to this box (02s-sealed-input.js): every JSON body
   is opened right after it's read, by the one body reader every route uses. */
{
  const json0 = express.json;
  express.json = (opts) => { const parse = json0(opts); return (req, res, next) => parse(req, res, (err) => (err ? next(err) : openSealedRequest(req, res, next))); };
}

/* Never fetch the cloud's own metadata service (it hands out credentials when CasaTorch runs on a cloud
   server). Every address CasaTorch is given - cameras, monitors, app tests, AI, Home Assistant - goes
   through fetch, so this one check covers them. */
const BLOCKED_HOSTS = /^(169\.254\.\d+\.\d+|\[?fd00:ec2::254\]?|100\.100\.100\.200|\[?::ffff:(a9fe:[0-9a-f]{1,4}|6464:64c8)\]?|metadata\.google\.internal|metadata|instance-data)$/i;   // the IPv6 forms are the same addresses written another way
const blockedUrl = (u) => { try { return BLOCKED_HOSTS.test(new URL(String(u?.url || u)).hostname.replace(/\.$/, '')); } catch { return false; } };
/* The same rule for a name that points at one of those addresses (169.254.169.254.nip.io and the like), and for
   every hop of a redirect - each one is checked before it is fetched. On a redirect to another site, sign-ins
   (Authorization, Cookie) are dropped, as browsers do. A name's answer is remembered for 5 minutes. */
const NOT_ALLOWED = () => new TypeError('That address is not allowed.');
const dnsOk = new Map();
/* Returns true when the address is this computer itself (127.x, ::1, or a name that points there). */
const isLoop = (ip) => /^(127\.|::1$|0\.0\.0\.0$|::$)/.test(String(ip).replace(/^::ffff:(?=\d)/i, ''));
async function assertFetchable(u) {
  if (blockedUrl(u)) throw NOT_ALLOWED();
  let h; try { h = new URL(String(u?.url || u)).hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase(); } catch { return false; }   // fetch reports a bad address itself
  if (!h) return false;
  if (/^[\d.]+$|:/.test(h)) return isLoop(h);   // an address, already checked above
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  const hit = dnsOk.get(h); if (hit && Date.now() - hit.at < 5 * 60_000) return hit.loop;
  const addrs = await dnsP.lookup(h, { all: true }).catch(() => []);   // fetch reports a name that doesn't resolve
  if (addrs.some((a) => BLOCKED_HOSTS.test(String(a.address).replace(/^::ffff:/i, '')) || BLOCKED_HOSTS.test(String(a.address)))) throw NOT_ALLOWED();
  const loop = addrs.some((a) => isLoop(a.address));
  if (addrs.length) { dnsOk.set(h, { at: Date.now(), loop }); if (dnsOk.size > 500) dnsOk.delete(dnsOk.keys().next().value); }
  return loop;
}
/* A request CasaTorch itself makes to this computer is marked, so it is never mistaken for the owner sitting at
   this computer (setupTrusted, 04-setup-code.js) - whatever address or redirect led it there. */
const INTERNAL_HEADER = 'x-casatorch-internal', SELF_PORTS = new Set();   // CasaTorch's own ports (filled in by 99-start.js)
const selfPort = (u) => { try { const x = new URL(String(u?.url || u)); return SELF_PORTS.has(Number(x.port || (x.protocol === 'https:' ? 443 : 80))); } catch { return false; } };
const markInternal = (opts, loop) => { if (!loop) return opts; const h = new Headers(opts?.headers || {}); h.set(INTERNAL_HEADER, '1'); return { ...opts, headers: h }; };
/* Links anyone signed in can give CasaTorch to read (a member's city bin calendar, say) must be on the internet:
   not this box, not the home network, not the provider's shared range. Admins' own settings may still point home. */
const nonPublicIp = (ip) => {
  const s = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/^::ffff:(?=\d+\.)/, '');
  const m = s.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) { const [a, b] = [Number(m[1]), Number(m[2])]; return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)); }
  return s === '::' || s === '::1' || /^(f[c-f]|ff)[0-9a-f]{0,2}:/.test(s) || /^::ffff:/.test(s) || /^64:ff9b:/.test(s);
};
async function publicUrlProblem(u) {
  let url; try { url = new URL(String(u)); } catch { return 'That isn\'t a web address.'; }
  if (!/^https?:$/.test(url.protocol)) return 'Only http and https links work here.';
  if (url.username || url.password) return 'Links with a sign-in in them aren\'t accepted here.';
  const h = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  const LOCAL = 'Only links on the internet work here - ask an admin to add one from your home network.';
  if (!h || (!h.includes('.') && !h.includes(':')) || /\.(local|lan|home|home\.arpa|internal|localdomain|localhost|intranet|corp|private)$/.test(h) || h === 'localhost') return LOCAL;
  if (/^[\d.]+$|:/.test(h)) return nonPublicIp(h) ? LOCAL : null;
  const addrs = await dnsP.lookup(h, { all: true }).catch(() => null);
  if (!addrs?.length) return 'That address couldn\'t be found.';
  return addrs.some((a) => nonPublicIp(a.address)) ? LOCAL : null;
}
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
function dropSignIns(headers) {
  if (!headers) return headers;
  const out = new Headers(headers); for (const k of ['authorization', 'cookie', 'proxy-authorization']) out.delete(k); return out;
}
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, o = {}) => {
    const loop0 = (await assertFetchable(u)) && selfPort(u);
    const publicOnly = !!o?.publicOnly, pubCheck = async (x) => { const why = publicOnly && await publicUrlProblem(x); if (why) throw new TypeError(why); };
    await pubCheck(u);
    if ((o?.redirect && o.redirect !== 'follow') || (typeof u !== 'string' && !(u instanceof URL))) return realFetch(u, markInternal(o, loop0));   // the caller handles redirects (or passed a Request)
    let url = String(u), opts = markInternal({ ...o, redirect: 'manual' }, loop0); delete opts.publicOnly;
    for (let hop = 0; ; hop++) {
      const r = await realFetch(url, opts), loc = r.headers.get('location');
      if (!REDIRECTS.has(r.status) || !loc) return r;
      if (hop >= 10) { r.body?.cancel?.(); throw new TypeError('too many redirects'); }
      const next = new URL(loc, url);
      if (!/^https?:$/.test(next.protocol)) { r.body?.cancel?.(); throw NOT_ALLOWED(); }
      r.body?.cancel?.();
      const loop = (await assertFetchable(next.href)) && selfPort(next.href); await pubCheck(next.href);
      if (next.origin !== new URL(url).origin) opts = { ...opts, headers: dropSignIns(opts.headers) };
      opts = markInternal(opts, loop);
      const method = String(opts.method || 'GET').toUpperCase();
      if (r.status === 303 ? method !== 'HEAD' : (r.status === 301 || r.status === 302) && method === 'POST') opts = { ...opts, method: 'GET', body: undefined };
      url = next.href;
    }
  };
}

let config = {};
/* As a Home Assistant add-on, CasaTorch reaches Home Assistant through the Supervisor with the add-on's
   own token: nothing to paste, and that token is never written to disk. */
const SUPERVISOR_HA = 'http://supervisor/core';
const withAddonHa = (c) => (process.env.SUPERVISOR_TOKEN && (!c.homeAssistant?.url || c.homeAssistant.url === SUPERVISOR_HA) ? { ...c, homeAssistant: { ...(c.homeAssistant || {}), url: SUPERVISOR_HA, token: process.env.SUPERVISOR_TOKEN } } : c);
/* No config.json means "not set up yet" (the setup wizard). A config.json that is there but damaged or can't be
   read is NOT that: loading it as empty would reopen setup and let it write over the real settings. It's
   recorded in configProblem; 00b-heal.js puts back the last good copy, and if there is none CasaTorch doesn't
   start (a recovery page only, 00b-heal.js). saveConfig refuses to write over it. */
let configProblem = null;
const loadConfig = () => {
  let raw;
  try { raw = fs.readFileSync(CONFIG_FILE, 'utf8'); }
  catch (e) {
    configProblem = e.code === 'ENOENT' ? null : { kind: 'unreadable', detail: `CasaTorch can't read its settings file (${CONFIG_FILE}: ${e.code || e.message}).` };
    config = withAddonHa({}); return;
  }
  let disk;
  try { disk = JSON.parse(raw); if (!disk || typeof disk !== 'object' || Array.isArray(disk)) throw new Error('not a settings object'); }
  catch (e) { configProblem = { kind: 'damaged', detail: `CasaTorch's settings file is damaged (${CONFIG_FILE}: ${String(e.message).slice(0, 120)}).` }; config = withAddonHa({}); return; }
  configProblem = null;
  plaintextOnDisk = false; mapSecrets(disk, (v) => { if (!v.startsWith('v2.') || !SEALED.test(v)) plaintextOnDisk = true; return v; });   // a plain or older (v1) secret: sealed again below
  config = sealedView(withAddonHa(disk));
};
loadConfig();
/** Written owner-only: it holds tokens and API keys. */
function saveConfig(next) {
  if (configProblem) throw new Error('The settings file is damaged; CasaTorch won\'t write over it.');
  const disk = next.homeAssistant?.url === SUPERVISOR_HA ? { ...next, homeAssistant: { ...next.homeAssistant, token: undefined } } : next;
  writeFileSafe(CONFIG_FILE, JSON.stringify(sealConfig(disk), null, 2), 0o600);
  config = sealedView(withAddonHa(next));
}
/** Every save: write a temp file, flush it to the disk, then swap it in - so a power cut mid-save
    can never leave a half-written file. Used for every file CasaTorch keeps. */
function writeFileSafe(file, data, mode = 0o600) {
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w', mode);
  try { try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
  catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* still the same name next time */ } throw e; }   // a full disk: no half file left behind
  fs.renameSync(tmp, file);
  try { const d = fs.openSync(path.dirname(file), 'r'); fs.fsyncSync(d); fs.closeSync(d); } catch { /* Windows can't fsync a folder */ }
}
/* Owner-only, everywhere in the data folder: files 0600, folders 0700. Files from older versions (or written
   by a helper that forgot the mode) are tightened at start and every hour. bin/ (the secure-access helper
   program) is left alone, and links are never followed. Not on Windows (no such modes there). */
function tightenDataModes(dir = DATA_DIR, depth = 0) {
  if (process.platform === 'win32' || depth > 4) return 0;
  let fixed = 0, list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of list) {
    if (depth === 0 && (e.name === 'bin' || e.name === 'radar-cache')) continue;   // the map cache: thousands of tiles, always written owner-only
    const p = path.join(dir, e.name);
    try {
      if (e.isDirectory()) { if (fs.lstatSync(p).mode & 0o077) { fs.chmodSync(p, 0o700); fixed++; } fixed += tightenDataModes(p, depth + 1); }
      else if (e.isFile() && fs.lstatSync(p).mode & 0o077) { fs.chmodSync(p, 0o600); fixed++; }
    } catch { /* not ours to change (some NAS shares) */ }
  }
  return fixed;
}
{ const n = tightenDataModes(); if (n) console.log(`Data folder: ${n} file${n === 1 ? '' : 's'} made owner-only.`); }
setInterval(() => tightenDataModes(), 3600_000).unref?.();
/* Installs from before secrets were sealed: seal them now. */
if (plaintextOnDisk && fs.existsSync(CONFIG_FILE)) { try { saveConfig(config); } catch { /* read-only data folder */ } }
/* Set up = setup has saved its answers. Bookkeeping that can land in config.json before setup (an install id
   from 0.4.1 and earlier, the old secure-address state, a Pro key, the language) doesn't count - otherwise a
   fresh install would skip the setup wizard and run with no sign-in. */
const BOOKKEEPING = new Set(['installId', 'localTls', 'find', 'license', 'lang']);
const isConfigured = () => fs.existsSync(CONFIG_FILE) && Object.keys(config).some((k) => !BOOKKEEPING.has(k));
/** The house's time zone (the demo house is on the US west coast). */
const houseTz = () => config.house?.timezone || (isDemo() ? 'America/Los_Angeles' : 'UTC');
const isDemo = () => process.env.CASATORCH_DEMO === '1' || config.demo === true;
const PORT = Number(process.env.PORT || config.port || 8090);
const nowIso = () => new Date().toISOString();

const app = express();
app.disable('x-powered-by');
