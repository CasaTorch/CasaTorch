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
function keyOf() {
  if (secretKey) return secretKey;
  try { secretKey = Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'base64'); if (secretKey.length !== 32) throw new Error('bad key'); }
  catch { secretKey = crypto.randomBytes(32); fs.writeFileSync(KEY_FILE, secretKey.toString('base64'), { mode: 0o600 }); }
  return secretKey;
}
function seal(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', keyOf(), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${enc.toString('base64url')}.${c.getAuthTag().toString('base64url')}`;
}
function unseal(s) {
  const [v, iv, enc, tag] = String(s || '').split('.');
  if (v !== 'v1') return null;
  try { const d = crypto.createDecipheriv('aes-256-gcm', keyOf(), Buffer.from(iv, 'base64url')); d.setAuthTag(Buffer.from(tag, 'base64url')); return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8'); }
  catch { return null; }
}
/* Which config.json values are secrets: anything called token, refreshToken, apiKey, secret, password or
   clientSecret, anywhere in the file, plus the Hue bridge's username (it is the bridge's password). */
const SECRET_KEYS = /^(token|refreshToken|apiKey|secret|password|clientSecret|privateKey|license|snapshotUrl)$/;   // snapshot addresses can carry a camera login
const SEALED = /^v1\.[\w-]+\.[\w-]*\.[\w-]+$/;
function mapSecrets(obj, fn, trail = '') {
  if (Array.isArray(obj)) return obj.map((v) => mapSecrets(v, fn, trail));
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const secret = typeof v === 'string' && v !== '' && (SECRET_KEYS.test(k) || (trail === 'hue' && k === 'username') || (trail === 'dns' && k === 'key') || (trail === 'yolink' && k === 'uaid') || (trail === 'calendars' && k === 'url'));   // a private calendar link is a password too
    out[k] = secret ? fn(v) : mapSecrets(v, fn, k);
  }
  return out;
}
const sealConfig = (c) => mapSecrets(c, (v) => (SEALED.test(v) ? v : seal(v)));
const openConfig = (c) => mapSecrets(c, (v) => (SEALED.test(v) ? (unseal(v) ?? '') : v));
let plaintextOnDisk = false;

/* Never fetch the cloud's own metadata service (it hands out credentials when CasaTorch runs on a cloud
   server). Every address CasaTorch is given - cameras, monitors, app tests, AI, Home Assistant - goes
   through fetch, so this one check covers them. */
const BLOCKED_HOSTS = /^(169\.254\.\d+\.\d+|\[?fd00:ec2::254\]?|100\.100\.100\.200|\[?::ffff:(a9fe:[0-9a-f]{1,4}|6464:64c8)\]?|metadata\.google\.internal|metadata|instance-data)$/i;   // the IPv6 forms are the same addresses written another way
const blockedUrl = (u) => { try { return BLOCKED_HOSTS.test(new URL(String(u?.url || u)).hostname.replace(/\.$/, '')); } catch { return false; } };
{ const realFetch = globalThis.fetch; globalThis.fetch = (u, o) => (blockedUrl(u) ? Promise.reject(new TypeError('That address is not allowed.')) : realFetch(u, o)); }

let config = {};
/* As a Home Assistant add-on, CasaTorch reaches Home Assistant through the Supervisor with the add-on's
   own token: nothing to paste, and that token is never written to disk. */
const SUPERVISOR_HA = 'http://supervisor/core';
const withAddonHa = (c) => (process.env.SUPERVISOR_TOKEN && (!c.homeAssistant?.url || c.homeAssistant.url === SUPERVISOR_HA) ? { ...c, homeAssistant: { ...(c.homeAssistant || {}), url: SUPERVISOR_HA, token: process.env.SUPERVISOR_TOKEN } } : c);
const loadConfig = () => {
  try {
    const disk = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    plaintextOnDisk = JSON.stringify(sealConfig(disk)) !== JSON.stringify(disk);
    config = withAddonHa(openConfig(disk));
  } catch { config = withAddonHa({}); }
};
loadConfig();
/** Written owner-only: it holds tokens and API keys. */
function saveConfig(next) {
  const disk = next.homeAssistant?.url === SUPERVISOR_HA ? { ...next, homeAssistant: { ...next.homeAssistant, token: undefined } } : next;
  writeFileSafe(CONFIG_FILE, JSON.stringify(sealConfig(disk), null, 2), 0o600);
  config = withAddonHa(next);
}
/** Every save: write a temp file, flush it to the disk, then swap it in - so a power cut mid-save
    can never leave a half-written file. Used for every file CasaTorch keeps. */
function writeFileSafe(file, data, mode = 0o600) {
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w', mode);
  try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  try { const d = fs.openSync(path.dirname(file), 'r'); fs.fsyncSync(d); fs.closeSync(d); } catch { /* Windows can't fsync a folder */ }
}
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
