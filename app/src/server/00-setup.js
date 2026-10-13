/* ======================================================================
 * HouseOS - setup: config, data folder, demo mode.
 *
 * The server is built from src/server/*.js in name order into one module
 * (build.mjs), the same way homedash is. Every house-specific value lives in
 * config.json (see config.example.json) - never in code.
 *
 * Demo mode (HOUSEOS_DEMO=1, or no config.json at all) serves the fixtures in
 * ../demo/fixtures, so anyone can try HouseOS - and every screenshot is taken
 * - without a real house behind it.
 * ====================================================================== */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.HOUSEOS_DATA_DIR || path.join(APP_DIR, '..', 'data');
const CONFIG_FILE = process.env.HOUSEOS_CONFIG || path.join(DATA_DIR, 'config.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { /* none yet: demo mode */ }
const DEMO = process.env.HOUSEOS_DEMO === '1' || !fs.existsSync(CONFIG_FILE);
const PORT = Number(process.env.PORT || config.port || 8090);
const nowIso = () => new Date().toISOString();

const app = express();
app.disable('x-powered-by');
