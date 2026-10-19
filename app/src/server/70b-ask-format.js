/* ======================================================================
 * Home AI Agent answers: what the AI writes is turned into checked blocks
 * before it reaches a screen. The AI writes short Markdown with a few fenced
 * blocks (```chart, ```stats, ```devices, ```offer) and pipe tables; this
 * file keeps only what fits the shapes below - no HTML, no styles, no
 * colors, links only to http(s) - and makes the action buttons itself from
 * the real device list, so the safety rule can't be talked around.
 * The browser checks everything again (25c-ask-render.js).
 * ====================================================================== */
const ASK_CHART_TYPES = new Set(['line', 'bar', 'area', 'pie']);
const ASK_STATUS = new Set(['good', 'warn', 'bad']);
const ASK_ACT_KINDS = new Set(['light', 'switch', 'plug', 'media', 'fan']);
const ASK_ACTIONS = new Set(['on', 'off', 'toggle']);
/* Plain text from the AI: control characters and HTML tags out, length capped. Never HTML on the way out. */
const askStr = (v, max = 200) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g, '').replace(/<\/?[a-z][^>]*>/gi, '').trim().slice(0, max);
/* A link the answer may show: http(s) only, no sign-in inside, no javascript:/data:. */
function askUrl(u) {
  try { const x = new URL(String(u || '').trim()); return /^https?:$/.test(x.protocol) && !x.username && !x.password && x.hostname ? x.href : null; } catch { return null; }
}
const askNum = (v) => (v === null || v === '' || v === undefined ? null : Number.isFinite(Number(v)) ? Math.round(Number(v) * 1000) / 1000 : null);

/* ---- a chart: line, bar or area over up to 60 points and 3 series, or a pie of up to 6 slices ---- */
function askChart(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null;
  const type = ASK_CHART_TYPES.has(spec.type) ? spec.type : null; if (!type) return null;
  const x = (Array.isArray(spec.x) ? spec.x : []).slice(0, 60).map((v) => askStr(v, 24));
  if (!x.length) return null;
  let series = (Array.isArray(spec.series) ? spec.series : []).filter((s) => s && typeof s === 'object').slice(0, type === 'pie' ? 1 : 3)
    .map((s, i) => ({ name: askStr(s.name, 40) || `Series ${i + 1}`, values: x.map((_, k) => askNum(Array.isArray(s.values) ? s.values[k] : null)) }))
    .filter((s) => s.values.some((v) => v !== null));
  if (!series.length) return null;
  if (type === 'pie') {
    // slices are parts of a whole: no negatives; more than 5 fold into "Other" so every slice keeps its own color
    let parts = x.map((label, k) => ({ label, v: Math.max(0, series[0].values[k] || 0) })).filter((p) => p.v > 0).sort((a, b) => b.v - a.v);
    if (!parts.length) return null;
    if (parts.length > 6) { const rest = parts.slice(5).reduce((s, p) => s + p.v, 0); parts = [...parts.slice(0, 5), { label: 'Other', v: Math.round(rest * 1000) / 1000 }]; }
    return { type, title: askStr(spec.title, 80), unit: askStr(spec.unit, 12), x: parts.map((p) => p.label), series: [{ name: series[0].name, values: parts.map((p) => p.v) }] };
  }
  return { type, title: askStr(spec.title, 80), unit: askStr(spec.unit, 12), x, series };
}
function askTable(t) {
  if (!t || typeof t !== 'object') return null;
  const columns = (Array.isArray(t.columns) ? t.columns : []).slice(0, 8).map((c) => askStr(c, 40));
  if (!columns.length) return null;
  const rows = (Array.isArray(t.rows) ? t.rows : []).filter(Array.isArray).slice(0, 40).map((r) => columns.map((_, i) => askStr(r[i] ?? '', 120)));
  return rows.length ? { columns, rows } : null;
}
function askStats(list) {
  const items = (Array.isArray(list) ? list : []).filter((s) => s && typeof s === 'object')
    .map((s) => ({ label: askStr(s.label, 30), value: askStr(s.value, 24), sub: askStr(s.sub, 48) || null, status: ASK_STATUS.has(s.status) ? s.status : null })).filter((s) => s.label && s.value).slice(0, 6);
  return items.length ? items : null;
}
/* Markdown pipe tables become table blocks: | a | b |, then | --- | --- |, then rows. */
function askPipeTables(md) {
  const out = [], lines = md.split('\n'); let buf = [];
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const flush = () => { const t = buf.join('\n').trim(); if (t) out.push({ type: 'md', text: t }); buf = []; };
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\|.*\|\s*$/.test(lines[i]) && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1] || '')) {
      const columns = cells(lines[i]); const rows = []; i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i]).map((c) => c.replace(/\*\*/g, ''))); i++; }
      i--; const t = askTable({ columns: columns.map((c) => c.replace(/\*\*/g, '')), rows });
      if (t) { flush(); out.push({ type: 'table', ...t }); }
      continue;
    }
    buf.push(lines[i]);
  }
  flush();
  return out;
}
const askJson = (s) => { try { return JSON.parse(String(s).trim()); } catch { return undefined; } };
/* Action buttons, made here from the real device: the AI only names which devices and on/off/toggle.
   Doors, gates, locks, alarms and anything the safety rule holds back are never offered. */
function askActions(list, byId) {
  const out = [];
  for (const a of Array.isArray(list) ? list : []) {
    if (!a || typeof a !== 'object' || !ASK_ACTIONS.has(a.action)) continue;
    const ids = [...new Set([...(Array.isArray(a.deviceIds) ? a.deviceIds : []), ...(a.deviceId ? [a.deviceId] : [])].map(String))]
      .filter((id) => { const d = byId.get(id); return d && ASK_ACT_KINDS.has(d.kind) && !riskOf(d) && !blocked(d, a.action); }).slice(0, 12);
    if (!ids.length) continue;
    const ds = ids.map((id) => byId.get(id)), names = ds.map((d) => d.name);
    const verb = ds.every((d) => d.kind === 'media') && a.action === 'toggle' ? 'Play/pause' : { on: 'Turn on', off: 'Turn off', toggle: 'Switch' }[a.action];
    const what = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]}, ${names[1]} and ${names.length - 2} more`;
    out.push({ deviceIds: ids, action: a.action, label: `${verb} ${what}`.slice(0, 70) });
    if (out.length >= 3) break;
  }
  return out;
}
/* Sources: web pages (titles and http(s) links) and where in the home a fact came from. */
function askSources(list) {
  const seen = new Set(), out = [];
  for (const s of Array.isArray(list) ? list : []) {
    const url = askUrl(s?.url); if (!url) continue;
    const key = url.replace(/[#?].*$/, '').replace(/\/$/, ''); if (seen.has(key)) continue; seen.add(key);
    let host = ''; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* checked above */ }
    out.push({ title: askStr(s.title, 120) || host, url, site: host });
    if (out.length >= 8) break;
  }
  return out;
}
function askFrom(used) {
  const seen = new Map();
  for (const u of Array.isArray(used) ? used : []) { const label = askStr(u?.label, 60); if (label && !seen.has(label)) seen.set(label, { label, at: u.at || null }); }
  return [...seen.values()].slice(0, 8);
}
/* "From your home: Energy, 7 days (2:41 PM) · Weather (MET Norway)" - the plain-text form, for copying. */
function askCiteLine(from, sources, tz = houseTz()) {
  const t = (iso) => { try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)); } catch { return ''; } };
  const a = from.length ? `From your home: ${from.map((f) => (f.at ? `${f.label} (${t(f.at)})` : f.label)).join(' · ')}` : '';
  const b = sources.length ? `Sources: ${sources.map((s, i) => `[${i + 1}] ${s.title} - ${s.url}`).join('; ')}` : '';
  return [a, b].filter(Boolean).join('\n');
}
/* The whole answer: the AI's text in, checked blocks out. */
function askParse(text, { devices = [], webSources = [], used = [] } = {}) {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const blocks = []; let offer = null;
  const src = String(text || '').replace(/\r\n?/g, '\n').slice(0, 24000);
  const FENCE = /```[ \t]*([a-z]*)[^\n]*\n([\s\S]*?)(?:```|$)/gi;
  let at = 0, m;
  const addMd = (s) => { const clean = askStr(s, 8000); if (clean) blocks.push(...askPipeTables(clean)); };
  while ((m = FENCE.exec(src))) {
    addMd(src.slice(at, m.index)); at = FENCE.lastIndex;
    const kind = m[1].toLowerCase(), body = askJson(m[2]);
    if (kind === 'chart') { const c = askChart(body); if (c) blocks.push({ type: 'chart', spec: c }); }
    else if (kind === 'table') { const t = askTable(body); if (t) blocks.push({ type: 'table', ...t }); }
    else if (kind === 'stats') { const s = askStats(body); if (s) blocks.push({ type: 'stats', items: s }); }
    else if (kind === 'devices') { const ids = (Array.isArray(body) ? body : []).map(String).filter((id) => byId.has(id)).slice(0, 12); if (ids.length) blocks.push({ type: 'devices', ids }); }
    else if (kind === 'offer') { if (body && typeof body === 'object') offer = body; }
    else if (m[2].trim()) blocks.push({ type: 'code', text: askStr(m[2], 4000) });   // anything else is shown as plain text
  }
  addMd(src.slice(at));
  const merged = blocks.filter((b) => !['md', 'code'].includes(b.type) || b.text);
  const off = offer ? { text: askStr(offer.text, 160) || null, actions: askActions(offer.actions, byId), ask: (Array.isArray(offer.ask) ? offer.ask : []).map((q) => askStr(q, 90)).filter(Boolean).slice(0, 3) } : { text: null, actions: [], ask: [] };
  while (off.actions.length + off.ask.length > 3) off.ask.pop();
  const sources = askSources(webSources), from = askFrom(used);
  const plain = merged.filter((b) => b.type === 'md').map((b) => b.text).join('\n\n').replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1 ($2)');
  return { blocks: merged, offer: off, sources, from, answer: [plain, off.text].filter(Boolean).join('\n\n') || 'Sorry - I could not answer that.' };
}
