/* Unit tests for the legal / IP round: CasaTorch always names itself to outside services (never retries as a browser),
   a source that refuses fails with a plain sentence, team logos only when the household turns them on (abbreviation +
   team color otherwise), no third-party mirrors among the news presets, and no unused Google Fonts in the content
   security policy. Run from test/unit.mjs (which loads server.js first). */
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), APP = path.resolve(HERE, '..');

export default async function legalTests(t) {
  const U = globalThis.__casatorchUtil, SP = globalThis.__casatorchSports, N = globalThis.__casatorchNews;

  await t('legal: outside requests always carry CasaTorch\'s own User-Agent, and a 403 is not retried as a browser', async () => {
    const seen = [];
    const srv = http.createServer((req, res) => { seen.push(req.headers['user-agent']); res.writeHead(req.url === '/no' ? 403 : 200, { 'Content-Type': 'text/plain' }); res.end('ok'); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    try {
      assert.equal((await U.getText(`${base}/yes`, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh)' } })).text, 'ok');
      await assert.rejects(U.getText(`${base}/no`), (e) => e.status === 403);
      assert.equal(seen.length, 2, 'one request each - no second try');
      for (const ua of seen) { assert.equal(ua, U.UA); assert.match(ua, /^CasaTorch\/\S+ \(\+https:\/\/casatorch\.com\)$/); }
    } finally { srv.close(); }
    const src = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
    assert.doesNotMatch(src, /Mozilla\/5\.0/, 'no browser User-Agent anywhere in the server');
    assert.doesNotMatch(src, /BROWSER_UA|PICKY_HOSTS/);
  });

  await t('legal: a scores service that refuses says so plainly; teams show abbreviation and color, logos only when turned on', () => {
    assert.equal(SP.sportsErr({ status: 403, message: 'HTTP 403' }).message, SP.SPORTS_DOWN);
    assert.equal(SP.sportsErr({ status: 500, message: 'HTTP 500' }).message, 'HTTP 500');
    const ev = { id: '1', date: '2026-10-18T20:00:00Z', status: { type: { state: 'pre' } }, competitions: [{ competitors: [
      { homeAway: 'home', team: { id: '9', abbreviation: 'HOM', displayName: 'Home Team', color: '0a3161', logo: 'https://a.espncdn.com/x.png' }, score: '0' },
      { homeAway: 'away', team: { id: '4', abbreviation: 'AWY', displayName: 'Away Team', color: 'nothex', logos: [{ href: 'https://a.espncdn.com/y.png' }] } }] }] };
    const g = SP.gameView(ev, 'nfl');
    assert.equal(g.home.color, '#0a3161'); assert.equal(g.away.color, null, 'only real hex colors');
    const off = SP.withLogo(g.home);   // Settings › General › "Show team logos from the scores service" is off by default
    assert.equal(off.logo, undefined); assert.equal(off.abbr, 'HOM'); assert.equal(off.color, '#0a3161');
    const cli = fs.readFileSync(path.join(APP, 'src', 'client', '10-widgets.js'), 'utf8');
    assert.match(cli, /function teamBadge\(t\)/, 'the Scores tile draws a badge when there is no logo');
  });

  await t('legal: news presets are the publishers\' own feeds; old mirror presets are swapped or dropped', () => {
    for (const f of N.NEWS_DEFAULTS) assert.doesNotMatch(f.url, /feedx\.net|hnrss\.org|rsshub|rss\.app|feedburner/i, f.name);
    assert.ok(!N.NEWS_DEFAULTS.some((f) => f.id === 'ap'));
    const out = N.newsFeeds([{ name: 'AP News', url: 'https://feedx.net/rss/ap.xml' }, { name: 'Hacker News', url: 'https://hnrss.org/frontpage' }, { name: 'BBC', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' }, { name: 'x' }]);
    assert.deepEqual(out.map((f) => f.url), ['https://news.ycombinator.com/rss', 'https://feeds.bbci.co.uk/news/world/rss.xml', undefined]);
  });

  await t('legal: no Google Fonts in the content security policy (and none used by the app)', () => {
    const sec = fs.readFileSync(path.join(APP, 'src', 'server', '01-security.js'), 'utf8');
    assert.doesNotMatch(sec, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
    for (const f of fs.readdirSync(path.join(APP, 'public')).filter((x) => /\.(html|css|js)$/.test(x))) assert.doesNotMatch(fs.readFileSync(path.join(APP, 'public', f), 'utf8'), /fonts\.googleapis\.com|fonts\.gstatic\.com/, f);
  });
}
