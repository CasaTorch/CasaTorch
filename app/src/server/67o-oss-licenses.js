/* ======================================================================
 * About › Open-source licenses (/about/licenses) - the AGPL's "appropriate
 * legal notices": the copyright, that there is no warranty, the license
 * and where the source is; then THIRD_PARTY_NOTICES.md (what CasaTorch is
 * built on and connects to), and every npm package installed on this box
 * with its version and license, read from node_modules itself.
 * Behind sign-in like every other page (08-signin.js runs before this).
 * ====================================================================== */
const OSS_NOTICES = [path.join(APP_DIR, 'catalog', 'THIRD_PARTY_NOTICES.md'), path.join(APP_DIR, '..', 'THIRD_PARTY_NOTICES.md')];
let ossMemo = null;
/** Every installed package: name, version, license (SPDX text as the package states it), at most 2,000. */
function ossPackages(root = path.join(APP_DIR, 'node_modules')) {
  const out = new Map();
  const walk = (dir, depth) => {
    if (depth > 6 || out.size >= 2000) return;
    let names = []; try { names = fs.readdirSync(dir); } catch { return; }
    for (const n of names) {
      if (n.startsWith('.')) continue;
      const p = path.join(dir, n);
      if (n.startsWith('@')) { walk(p, depth); continue; }
      try {
        const j = JSON.parse(fs.readFileSync(path.join(p, 'package.json'), 'utf8'));
        const lic = typeof j.license === 'string' ? j.license : j.license?.type || (Array.isArray(j.licenses) ? j.licenses.map((x) => x.type || x).join(' OR ') : '') || 'see package';
        if (j.name && !out.has(`${j.name}@${j.version}`)) out.set(`${j.name}@${j.version}`, { name: String(j.name), version: String(j.version || ''), license: String(lic).slice(0, 60), url: typeof j.homepage === 'string' && /^https:\/\//.test(j.homepage) ? j.homepage : null });
      } catch { /* not a package */ }
      walk(path.join(p, 'node_modules'), depth + 1);
    }
  };
  walk(root, 0);
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
/** A small, safe Markdown subset (headings, tables, lists, quotes, bold, code, links): everything is escaped first. */
function ossMarkdown(md) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const lines = String(md).split('\n'), html = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,4} /.test(l)) { const n = l.match(/^#+/)[0].length; html.push(`<h${n + 1}>${inline(l.slice(n + 1))}</h${n + 1}>`); continue; }
    if (/^\|/.test(l)) {
      const rows = []; while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]); i--;
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const body = rows.filter((r, k) => k !== 1 || !/^\|[\s:|-]+\|$/.test(r));
      html.push(`<div class="tbl"><table><thead><tr>${cells(body[0]).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.slice(1).map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^[-*] /.test(l)) { const items = []; while (i < lines.length && /^[-*] /.test(lines[i])) items.push(lines[i++].slice(2)); i--; html.push(`<ul>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`); continue; }
    if (/^> ?/.test(l)) { html.push(`<blockquote>${inline(l.replace(/^> ?/, ''))}</blockquote>`); continue; }
    if (/^---+$/.test(l.trim())) { html.push('<hr>'); continue; }
    if (l.trim()) { const para = [l]; while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#|\||[-*] |> |---)/.test(lines[i + 1])) para.push(lines[++i]); html.push(`<p>${inline(para.join(' '))}</p>`); }
  }
  return html.join('\n');
}
function ossPage() {
  if (ossMemo) return ossMemo;
  let md = '# Third-party notices\n\nThe notices file is missing from this copy of CasaTorch. It is at github.com/CasaTorch/CasaTorch.';
  for (const f of OSS_NOTICES) { try { md = fs.readFileSync(f, 'utf8'); break; } catch { /* next */ } }
  const pk = ossPackages(), esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const counts = Object.entries(pk.reduce((m, p) => ({ ...m, [p.license]: (m[p.license] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  ossMemo = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Open-source licenses - CasaTorch</title>
<link rel="stylesheet" href="/legal.css"><style>body{max-width:900px;margin:0 auto;padding:24px 16px 60px;font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}.tbl{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px;margin:10px 0}th,td{border-top:1px solid rgba(128,128,128,.3);padding:6px 8px;text-align:left;vertical-align:top}code{font-size:12px}blockquote{margin:12px 0;padding:8px 12px;border-left:3px solid rgba(128,128,128,.5);opacity:.85}.lead{padding:14px 16px;border:1px solid rgba(128,128,128,.35);border-radius:12px}</style></head>
<body><p><a href="/#settings">‹ Back to CasaTorch</a></p>
<h1>Open-source licenses</h1>
<div class="lead"><p><b>CasaTorch ${esc(VERSION)}</b> - copyright © the CasaTorch contributors.</p>
<p>CasaTorch is free software: you can use, change and share it under the <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener">GNU Affero General Public License, version 3</a>. It comes with <b>no warranty</b>, to the extent the law allows. The source of every release is at <a href="https://github.com/CasaTorch/CasaTorch" target="_blank" rel="noopener">github.com/CasaTorch/CasaTorch</a>. CasaTorch Pro features are unlocked by a separate commercial license key.</p></div>
${ossMarkdown(md)}
<h2>Packages installed on this CasaTorch (${pk.length})</h2>
<p>${counts.map(([l, n]) => `${esc(l)}: ${n}`).join(' · ')}</p>
<div class="tbl"><table><thead><tr><th>Package</th><th>Version</th><th>License</th></tr></thead><tbody>${pk.map((p) => `<tr><td>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a>` : esc(p.name)}</td><td>${esc(p.version)}</td><td>${esc(p.license)}</td></tr>`).join('')}</tbody></table></div>
<p>Each package's full license text is in its folder under <code>node_modules</code> on this box.</p>
</body></html>`;
  return ossMemo;
}
app.get(['/about/licenses', '/licenses'], (_req, res) => { res.set('Cache-Control', 'private, max-age=3600'); res.type('html').send(ossPage()); });
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchOss = { ossPackages, ossMarkdown, ossPage, OSS_NOTICES };
