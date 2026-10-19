/* ======================================================================
 * Links to the guides on casatorch.com/docs - the ONE list of them, for
 * the app (index.html) and setup (setup.html) alike.
 *
 * A key names a place in CasaTorch ("setup.cameras", "settings.people",
 * "page.energy"); its value is a docs page and, after #, a section on it.
 * app/test/docs-links-unit.mjs checks that every page and every section
 * here exists in the docs sources (sitework/docs-src), so a renamed page
 * or heading fails the tests instead of sending someone to a dead link.
 *
 * CasaDocs.link(key) makes the small "Learn more" (or "?") link: it opens
 * in a new tab - and inside the CasaTorch phone app, in the phone's own
 * browser (the app bridge's openExternal), so the app never leaves home.
 * ====================================================================== */
(() => {
  const SITE = 'https://casatorch.com/docs/';
  const MAP = Object.freeze({
    /* setup, step by step (setup-help.js) */
    'setup.welcome': 'start/setup.html#open',
    'setup.code': 'start/setup.html#open',
    'setup.progress': 'start/setup.html#moving',
    'setup.house': 'start/setup.html#language',
    'setup.account': 'start/setup.html#everyday',
    'setup.protect': 'start/setup.html#protect',
    'setup.phone': 'start/setup.html#phone',
    'setup.calendars': 'connect/everyday.html#calendars',
    'setup.sports': 'connect/everyday.html#teams',
    'setup.news': 'connect/everyday.html#news',
    'setup.reminders': 'use/reminders.html#setup',
    'setup.ai': 'pro/ask.html#setup',
    'setup.homeassistant': 'connect/home-assistant.html#signin',
    'setup.cameras': 'connect/cameras.html',
    'setup.controls': 'connect/lights-plugs.html',
    'setup.sensors': 'connect/sensors.html#alerts',
    'setup.network': 'connect/network.html',
    'setup.apptests': 'use/app-tests.html#setup',
    'setup.energy': 'connect/energy.html',
    'setup.alerts': 'use/phone-app.html#alerts',
    'setup.look': 'use/home-screen.html#look',
    'setup.themes': 'use/home-screen.html#look',
    'setup.review': 'start/setup.html#safe',
    'setup.done': 'start/setup.html#done',
    'setup.errors': 'start/setup.html#errors',
    'setup.found': 'start/setup.html#found',
    'setup.later': 'start/setup.html#later',
    'setup.frigate': 'start/setup.html#frigate',
    /* Settings: each section's header, and a few cards */
    'settings.general': 'start/setup.html#later',
    'settings.health': 'use/health.html',
    'settings.appearance': 'use/home-screen.html#look',
    'settings.people': 'use/family.html',
    'settings.safety': 'help/privacy-safety.html#never',
    'settings.connections': 'connect/overview.html',
    'settings.household': 'use/household.html',
    'settings.family': 'use/family-board.html',
    'settings.phones': 'use/phone-app.html',
    'settings.alerts': 'use/alerts.html',
    'settings.updates': 'help/updates.html',
    'settings.pro': 'pro/about.html',
    'settings.help': 'help/get-help.html',
    'settings.advanced': 'help/troubleshooting.html',
    'settings.voice': 'use/voice.html',
    'settings.voice.siri': 'use/voice.html#siri',
    'settings.ai': 'pro/ask.html#setup',
    'settings.twostep': 'use/family.html#two-step',
    'settings.change': 'start/setup.html#later',
    'settings.backup': 'help/backup.html#make',
    'settings.remote': 'help/remote-access.html',
    'settings.app': 'use/mobile-app.html',
    /* the pages: the "?" next to each page's title */
    'page.home': 'use/home-screen.html',
    'page.alerts': 'use/phone-app.html#alerts',
    'page.controls': 'connect/lights-plugs.html',
    'page.cameras': 'connect/cameras.html',
    'page.security': 'use/security.html',
    'page.calendar': 'connect/everyday.html#calendars',
    'page.photos': 'connect/everyday.html#photos',
    'page.energy': 'connect/energy.html#page',
    'page.network': 'pro/network.html',
    'page.house3d': 'pro/3d-home.html',
    'page.ask': 'pro/ask.html',
    'page.connect': 'connect/overview.html',
    'page.family': 'use/family-board.html',
    'page.reminders': 'use/reminders.html',
    'page.household': 'use/household.html',
    'page.apptests': 'use/app-tests.html',
    'page.settings': 'help/get-help.html',
    /* Health and the troubleshooters (Settings › Health) */
    'health': 'use/health.html#checks',
    'health.fix': 'use/health.html#fix',
    'health.signins': 'use/family.html#two-step',
    'health.backup': 'help/backup.html#make',
    'health.updates': 'help/updates.html',
    'health.remote': 'help/remote-access.html#trouble',
    'health.ha': 'help/troubleshooting.html#ha-test',
    'health.frigate': 'help/troubleshooting.html#frigate-cert',
    'health.certs': 'help/troubleshooting.html#secure-address',
    'health.internet': 'connect/network.html#internet',
    'trouble': 'help/troubleshooting.html',
    'trouble.reach': 'help/troubleshooting.html#phone',
    'trouble.ha': 'help/troubleshooting.html#ha-test',
    'trouble.cameras': 'help/troubleshooting.html#camera',
    'trouble.slow3d': 'help/troubleshooting.html#slow',
    'trouble.remote': 'help/troubleshooting.html#secure-access',
    'trouble.locked': 'help/troubleshooting.html#password',
    'trouble.alerts': 'help/troubleshooting.html#alerts',
    'trouble.tablet': 'help/troubleshooting.html#tablet-sleep',
    'trouble.frigate': 'help/troubleshooting.html#frigate-cert',
    'trouble.update': 'help/troubleshooting.html#update-failed',
    /* Connect: one per card (by setup step, or a brand of its own) */
    'connect.calendars': 'connect/everyday.html#calendars',
    'connect.sports': 'connect/everyday.html#teams',
    'connect.news': 'connect/everyday.html#news',
    'connect.reminders': 'use/reminders.html',
    'connect.homeassistant': 'connect/home-assistant.html',
    'connect.cameras': 'connect/cameras.html',
    'connect.controls': 'connect/lights-plugs.html',
    'connect.sensors': 'connect/sensors.html',
    'connect.energy': 'connect/energy.html',
    'connect.network': 'connect/network.html',
    'connect.frigate': 'connect/cameras.html#frigate',
    'connect.reolink-local': 'connect/cameras.html#reolink',
    'connect.ring-labs': 'pro/ring.html',
    'connect.meraki-mv': 'connect/cameras.html#meraki',
    'connect.hue-local': 'connect/lights-plugs.html#hue',
    'connect.shelly-local': 'connect/lights-plugs.html#shelly',
    'connect.yolink-cloud': 'connect/sensors.html#yolink',
    'connect.meraki-mt': 'connect/sensors.html#meraki',
    'connect.utility': 'connect/energy.html#utility',
    'connect.unifi': 'pro/network.html#unifi',
    'connect.meraki': 'pro/network.html#meraki',
    'connect.dns:pihole': 'pro/network.html#pihole',
    'connect.dns:adguard': 'pro/network.html#adguard',
    /* empty pages and cards: what to connect, and how */
    'empty.home': 'connect/overview.html',
    'empty.controls': 'connect/lights-plugs.html',
    'empty.cameras': 'connect/cameras.html',
    'empty.security': 'use/security.html',
    'empty.energy': 'connect/energy.html#measure',
    'empty.network': 'pro/network.html#connect',
    'empty.family': 'use/family-board.html#lists',
    'empty.house3d': 'pro/3d-home.html#start',
    'empty.apptests': 'use/app-tests.html#add',
  });
  const url = (key) => (Object.hasOwn(MAP, key) ? SITE + MAP[key] : null);
  /* In the phone app, hand the address to the phone's browser; elsewhere a new tab. */
  const outside = (e) => { const n = window.CasaNative; if (n && typeof n.openExternal === 'function') { e.preventDefault(); n.openExternal(e.currentTarget.href); } };
  /** The small link: "Learn more" (or { label }), or a round "?" with { icon: true }. Null for a key that isn't here. */
  function link(key, opts = {}) {
    const href = url(key); if (!href) return null;
    const T = window.T || ((s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m)));
    const a = document.createElement('a');
    a.href = href; a.target = '_blank'; a.rel = 'noopener';
    a.className = `doclink${opts.icon ? ' doclink-q' : ''}${opts.className ? ` ${opts.className}` : ''}`;
    a.dataset.doc = key;
    if (opts.icon) { a.textContent = '?'; a.setAttribute('aria-label', opts.topic ? T('Learn more about {topic} (opens the guide)', { topic: opts.topic }) : T('Learn more (opens the guide)')); a.title = T('Learn more'); }
    else { a.textContent = T(opts.label || 'Learn more'); a.setAttribute('aria-label', `${a.textContent} - ${T('opens the guide')}`); }
    a.addEventListener('click', outside);
    return a;
  }
  window.CasaDocs = Object.freeze({ SITE, MAP, url, link });
})();
