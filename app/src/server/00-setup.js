/* ======================================================================
 * HouseOS - setup: config, data folder, demo mode.
 *
 * The server is built from src/server/*.js in name order into one module
 * (build.mjs). Every house-specific value lives in data/config.json, written
 * by the setup wizard (/setup) - never in code.
 *
 *   no config.json         -> the setup wizard (/setup)
 *   config.demo = true     -> demo mode: sample data from ../demo/fixtures
 *   HOUSEOS_DEMO=1         -> demo mode regardless
 *   HOUSEOS_SETUP=1        -> re-open the wizard on a configured install
 * ====================================================================== */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.HOUSEOS_DATA_DIR || path.join(APP_DIR, '..', 'data');
const CONFIG_FILE = process.env.HOUSEOS_CONFIG || path.join(DATA_DIR, 'config.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

let config = {};
/* As a Home Assistant add-on, HouseOS reaches Home Assistant through the Supervisor with the add-on's
   own token: nothing to paste, and that token is never written to disk. */
const SUPERVISOR_HA = 'http://supervisor/core';
const withAddonHa = (c) => (process.env.SUPERVISOR_TOKEN && (!c.homeAssistant?.url || c.homeAssistant.url === SUPERVISOR_HA) ? { ...c, homeAssistant: { ...(c.homeAssistant || {}), url: SUPERVISOR_HA, token: process.env.SUPERVISOR_TOKEN } } : c);
const loadConfig = () => { try { config = withAddonHa(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))); } catch { config = withAddonHa({}); } };
loadConfig();
/** Written owner-only: it holds tokens and API keys. */
function saveConfig(next) {
  const disk = next.homeAssistant?.url === SUPERVISOR_HA ? { ...next, homeAssistant: { ...next.homeAssistant, token: undefined } } : next;
  fs.writeFileSync(`${CONFIG_FILE}.tmp`, JSON.stringify(disk, null, 2), { mode: 0o600 });
  fs.renameSync(`${CONFIG_FILE}.tmp`, CONFIG_FILE);
  config = withAddonHa(next);
}
const isConfigured = () => fs.existsSync(CONFIG_FILE) && Object.keys(config).length > 0;
/** The house's time zone (the demo house is on the US west coast). */
const houseTz = () => config.house?.timezone || (isDemo() ? 'America/Los_Angeles' : 'UTC');
const isDemo = () => process.env.HOUSEOS_DEMO === '1' || config.demo === true;
const PORT = Number(process.env.PORT || config.port || 8090);
const nowIso = () => new Date().toISOString();

const app = express();
app.disable('x-powered-by');
