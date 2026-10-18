#!/usr/bin/env node
/* Builds app/catalog/radar-outline.json: a small outline of the world's land, country borders and US
 * state lines, drawn under the rain radar when no map tiles can be loaded (offline, the map service down,
 * or the demo with no internet). Source: Natural Earth (public domain), via the world-atlas and us-atlas
 * npm packages (ISC). Only needed when the outline should change:
 *
 *   npm pack world-atlas@2.0.2 us-atlas@3.0.1   (in an empty folder, then untar both)
 *   node tools/make-radar-outline.mjs <world-atlas/package> <us-atlas/package>
 *
 * Output: { v, q, land: [ring], borders: [line], states: [line] }. Each ring or line is a flat array of
 * whole numbers: the first point in 1/q degrees (lon, lat), then the change to each next point.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [worldDir, usDir] = process.argv.slice(2);
if (!worldDir || !usDir) { console.error('usage: node tools/make-radar-outline.mjs <world-atlas/package> <us-atlas/package>'); process.exit(1); }
const Q = 100;            // 1/100 of a degree, about 1 km
const TOL = 0.015;        // simplify: drop points closer than this (degrees) to the line
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

function decodeArcs(topo) {
  const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
  return topo.arcs.map((arc) => { let x = 0, y = 0; return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; }); });
}
const arcPts = (arcs, i) => (i >= 0 ? arcs[i] : [...arcs[~i]].reverse());
function ring(arcs, idx) { const out = []; for (const i of idx) { const p = arcPts(arcs, i); out.push(...(out.length ? p.slice(1) : p)); } return out; }
function polygonsOf(g) { return g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : []; }
/* Arcs shared by two different shapes: the borders between countries (or states), never a coast. */
function interiorArcs(geoms) {
  const owners = new Map();
  geoms.forEach((g, gi) => { for (const poly of polygonsOf(g)) for (const r of poly) for (const i of r) { const k = i >= 0 ? i : ~i; if (!owners.has(k)) owners.set(k, new Set()); owners.get(k).add(gi); } });
  return [...owners].filter(([, s]) => s.size > 1).map(([k]) => k);
}
function simplify(pts, tol) {   // Douglas-Peucker; a closed ring is split at its far point first
  if (pts.length < 3) return pts;
  const [fx, fy] = pts[0], [lx, ly] = pts[pts.length - 1];
  if (fx === lx && fy === ly) {
    let far = 1, best = -1; pts.forEach(([x, y], i) => { const d = Math.hypot(x - fx, y - fy); if (d > best) { best = d; far = i; } });
    if (far <= 0 || far >= pts.length - 1) return pts;
    return [...simplify(pts.slice(0, far + 1), tol).slice(0, -1), ...simplify(pts.slice(far), tol)];
  }
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let best = 0, at = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-12;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len; if (d > best) { best = d; at = i; } }
    if (best > tol && at > 0) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function pack(pts) {
  const out = []; let px = 0, py = 0;
  for (const [x, y] of pts) { const qx = Math.round(x * Q), qy = Math.round(y * Q); if (out.length && qx === px && qy === py) continue; out.push(qx - px, qy - py); px = qx; py = qy; }
  return out;
}
const world = read(path.join(worldDir, 'land-10m.json')), countries = read(path.join(worldDir, 'countries-50m.json')), states = read(path.join(usDir, 'states-10m.json'));
const wArcs = decodeArcs(world), land = [];
for (const g of world.objects.land.geometries) for (const poly of polygonsOf(g)) for (const r of poly) { const pts = ring(wArcs, r), xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); if (Math.max(...xs) - Math.min(...xs) < 0.06 && Math.max(...ys) - Math.min(...ys) < 0.06) continue;   // specks smaller than a few km
  const s = simplify(pts, TOL); if (s.length >= 4) land.push(pack(s)); }
const cArcs = decodeArcs(countries), borders = interiorArcs(countries.objects.countries.geometries).map((i) => pack(simplify(cArcs[i], TOL))).filter((l) => l.length >= 4);
const sArcs = decodeArcs(states), stateLines = interiorArcs(states.objects.states.geometries).map((i) => pack(simplify(sArcs[i], TOL))).filter((l) => l.length >= 4);
const out = { v: 1, q: Q, source: 'Natural Earth (public domain)', land, borders, states: stateLines };
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'catalog', 'radar-outline.json');
fs.writeFileSync(file, JSON.stringify(out));
console.log(`${file}: ${(fs.statSync(file).size / 1024).toFixed(0)} KB - ${land.length} land rings, ${borders.length} borders, ${stateLines.length} state lines`);
