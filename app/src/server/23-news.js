/* News - RSS/Atom feeds the user picks (config.news.feeds: [{ name, url }]). */
const NEWS_DEFAULTS = [
  { id: 'ap', name: 'AP News', url: 'https://feedx.net/rss/ap.xml' },
  { id: 'npr', name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
  { id: 'bbc', name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { id: 'verge', name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  { id: 'ars', name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
  { id: 'espn', name: 'ESPN', url: 'https://www.espn.com/espn/rss/news' },
];
async function newsNow() {
  const items = [], errors = [];
  for (const f of config.news?.feeds || []) {
    try { const feed = await cached(`rss:${f.url}`, 20 * 60_000, async () => parseFeed((await getText(f.url)).text)); for (const i of feed.items.slice(0, 15)) items.push({ ...i, source: f.name || feed.title }); }
    catch (err) { errors.push({ feed: f.name, error: String(err.message) }); }
  }
  return { items: items.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 40), errors };
}
app.get('/api/news', async (_req, res) => { try { res.json(await newsNow()); } catch (err) { res.status(502).json({ error: String(err.message) }); } });
