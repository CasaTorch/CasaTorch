/* News - RSS/Atom feeds the user picks (config.news.feeds: [{ name, url }]). */
/* Sources to pick from, by kind: only feeds the publishers themselves offer (no third-party mirrors).
   Feeds belong to their publishers and can change; any feed can also be added by address. */
const NEWS_DEFAULTS = [
  // world
  { id: 'bbc', group: 'World', name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { id: 'guardian-world', group: 'World', name: 'The Guardian - World', url: 'https://www.theguardian.com/world/rss' },
  { id: 'nyt-world', group: 'World', name: 'New York Times - World', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml' },
  { id: 'aljazeera', group: 'World', name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { id: 'dw', group: 'World', name: 'DW (Deutsche Welle)', url: 'https://rss.dw.com/rdf/rss-en-all' },
  { id: 'france24', group: 'World', name: 'France 24', url: 'https://www.france24.com/en/rss' },
  { id: 'npr-world', group: 'World', name: 'NPR - World', url: 'https://feeds.npr.org/1004/rss.xml' },
  // United States
  { id: 'npr', group: 'United States', name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
  { id: 'pbs', group: 'United States', name: 'PBS NewsHour', url: 'https://www.pbs.org/newshour/feeds/rss/headlines' },
  { id: 'cbs', group: 'United States', name: 'CBS News', url: 'https://www.cbsnews.com/latest/rss/main' },
  { id: 'nbc', group: 'United States', name: 'NBC News', url: 'https://feeds.nbcnews.com/nbcnews/public/news' },
  { id: 'abc', group: 'United States', name: 'ABC News', url: 'https://abcnews.go.com/abcnews/topstories' },
  { id: 'wapo', group: 'United States', name: 'Washington Post - National', url: 'https://feeds.washingtonpost.com/rss/national' },
  // tech, business, science, sports
  { id: 'verge', group: 'Technology', name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  { id: 'ars', group: 'Technology', name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
  { id: 'techcrunch', group: 'Technology', name: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
  { id: 'wired', group: 'Technology', name: 'Wired', url: 'https://www.wired.com/feed/rss' },
  { id: 'hn', group: 'Technology', name: 'Hacker News', url: 'https://news.ycombinator.com/rss' },
  { id: 'cnbc', group: 'Business', name: 'CNBC - Top news', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
  { id: 'nasa', group: 'Science', name: 'NASA', url: 'https://www.nasa.gov/news-release/feed/' },
  { id: 'espn', group: 'Sports', name: 'ESPN', url: 'https://www.espn.com/espn/rss/news' },
];
/* Headlines for where you live, in your language, from Google News' public feeds (any country):
   local (your town), national (your country's top stories), world, and topics. */
const GN_KINDS = [
  ['gn-local', 'Local'], ['gn-national', 'National'], ['gn-world', 'World'],
  ['gn-business', 'Business'], ['gn-technology', 'Technology'], ['gn-science', 'Science'], ['gn-health', 'Health'], ['gn-sports', 'Sports'], ['gn-entertainment', 'Entertainment'],
];
function gnEdition(lang = 'en', cc = 'US') {
  cc = /^[A-Z]{2}$/.test(String(cc || '')) ? cc : 'US'; lang = String(lang || 'en').toLowerCase();
  const l = lang === 'zh' ? (['TW', 'HK'].includes(cc) ? 'zh-Hant' : 'zh-Hans') : lang === 'pt' && cc === 'BR' ? 'pt-419' : lang === 'es' && cc !== 'ES' ? 'es-419' : lang;
  return { hl: lang === 'en' || lang === 'zh' || lang === 'pt' ? `${lang === 'zh' ? 'zh' : lang}-${cc}` : lang, gl: cc, ceid: `${cc}:${l}` };
}
function gnFeed(id, { town, cc, lang }) {
  const e = gnEdition(lang, cc), q = `hl=${encodeURIComponent(e.hl)}&gl=${e.gl}&ceid=${encodeURIComponent(e.ceid)}`;
  let country = cc; try { country = new Intl.DisplayNames([lang || 'en'], { type: 'region' }).of(cc) || cc; } catch { /* plain code */ }
  if (id === 'gn-local') return town ? { name: `Local - ${town}`, url: `https://news.google.com/rss/headlines/section/geo/${encodeURIComponent(town)}?${q}` } : null;
  if (id === 'gn-national') return { name: `Top stories - ${country}`, url: `https://news.google.com/rss?${q}` };
  const topic = id.slice(3).toUpperCase();
  return GN_KINDS.some(([k]) => k === id) ? { name: `${GN_KINDS.find(([k]) => k === id)[1]} - Google News`, url: `https://news.google.com/rss/headlines/section/topic/${topic}?${q}` } : null;
}
const homeTown = (loc) => String(loc?.name || '').split(',')[0].trim().slice(0, 60) || null;
const homeCountry = (loc) => (/^[A-Z]{2}$/.test(String(loc?.cc || '')) ? loc.cc : (/,\s*([A-Z]{2})$/.exec(String(loc?.name || ''))?.[1] || null));
/* Presets that pointed at unofficial mirrors in older versions: swapped for the publisher's own feed, or dropped. */
const NEWS_RETIRED = { 'https://feedx.net/rss/ap.xml': null, 'https://hnrss.org/frontpage': 'https://news.ycombinator.com/rss' };
const newsFeeds = (feeds = config.news?.feeds || []) => feeds.flatMap((f) => (Object.hasOwn(NEWS_RETIRED, f?.url ?? "") ? (NEWS_RETIRED[f.url] ? [{ ...f, url: NEWS_RETIRED[f.url] }] : []) : [f]));
async function newsNow() {
  const items = [], errors = [];
  for (const f of newsFeeds()) {
    try { const feed = await cached(`rss:${f.url}`, 20 * 60_000, async () => parseFeed((await getText(f.url)).text)); for (const i of feed.items.slice(0, 15)) { const gn = /news\.google\.com/.test(f.url) && /^(.*\S)\s+-\s+([^-]{2,60})$/.exec(i.title || ''); items.push({ ...i, ...(gn ? { title: gn[1], publisher: gn[2] } : {}), source: f.name || feed.title }); } }
    catch (err) { errors.push({ feed: f.name, error: String(err.message) }); }
  }
  return { items: items.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 40), errors };
}
app.get('/api/news', async (_req, res) => { try { res.json(await newsNow()); } catch (err) { res.status(502).json({ error: String(err.message) }); } });
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchNews = { NEWS_DEFAULTS, NEWS_RETIRED, newsFeeds };

/* ---- The Headlines drawer: more from each source, newest first, with the publisher and the time ----
   The same feeds and the same cache as Home (nothing extra is fetched when Home has just read them). */
async function newsBySource() {
  const sources = [];
  for (const f of newsFeeds()) {
    try {
      const feed = await cached(`rss:${f.url}`, 20 * 60_000, async () => parseFeed((await getText(f.url)).text));
      const gn = /news\.google\.com/.test(f.url);
      sources.push({ name: f.name, items: feed.items.slice(0, 25).map((i) => { const m = gn && /^(.*\S)\s+-\s+([^-]{2,60})$/.exec(i.title || ''); return { title: m ? m[1] : i.title, publisher: m ? m[2] : f.name, link: i.link, at: i.at }; }) });
    } catch (err) { sources.push({ name: f.name, items: [], error: String(err.message) }); }
  }
  return { sources, at: new Date().toISOString() };
}
/* The demo: a few made-up headlines for each sample source. */
function demoNewsMore() {
  const now = Date.now(), m = (min) => new Date(now - min * 60_000).toISOString();
  const S = { 'Local News': ['City council approves new bike lanes downtown', 'Farmers market moves to Saturday mornings for the winter', 'Library opens a maker space with 3D printers', 'Road work on Main Street wraps up a week early', 'High school robotics team heads to the state finals'],
    'Weather Desk': ['Storm system expected midweek with heavy rain', 'How to get your gutters ready before the first big storm', 'Cooler nights ahead: frost possible in the valleys', 'Why this fall has been so dry, explained'],
    Tech: ['New phone chips promise twice the battery life', 'A beginner\'s guide to a home network that just works', 'Smart plugs that measure power, compared', 'Open-source home dashboards are having a moment'] };
  return { sources: Object.entries(S).map(([name, titles], k) => ({ name, items: titles.map((title, i) => ({ title, publisher: name, link: `https://example.com/${k}-${i}`, at: m(20 + k * 35 + i * 95) })) })), at: new Date(now).toISOString(), demo: true };
}
app.get('/api/news/more', async (_req, res) => { if (isDemo()) return res.json(demoNewsMore()); try { res.json(await newsBySource()); } catch (err) { res.status(502).json({ error: String(err.message) }); } });
