/* ======================================================================
 * The demo's sample agent: with no AI connected, the demo still shows what
 * the Home AI Agent does. It is not an AI - a few fixed rules pick the
 * lookups (the same tools a real AI uses, so the numbers are the sample
 * house's real ones) and fill in a written answer with a chart or a table.
 * Tests and screenshots use it too (CASATORCH_ASK_FAKE=1 adds a stand-in
 * web search with example.org pages; it is never on otherwise).
 * ====================================================================== */
const ASK_SAMPLE = {
  name: 'Sample agent',
  async turn(_c, { messages, tools, onText }) {
    const li = messages.map((m) => m.role).lastIndexOf('user'), q = String(messages[li]?.text || ''), t = q.toLowerCase();
    const after = messages.slice(li + 1), results = after.filter((m) => m.role === 'tool').flatMap((m) => m.results);
    const has = (n) => tools.some((x) => x.name === n);
    const say = async (text) => { for (const part of text.match(/[\s\S]{1,48}/g) || []) { onText(part); await sleep(12); } return { text, calls: [], sources: [] }; };
    if (!results.length) {
      const calls = askSamplePlan(t).filter((c) => has(c.name)).map((c, i) => ({ id: `s${i}`, ...c }));
      if (calls.length) return { text: '', calls, sources: [] };
      if (/who|what is|what's|when did|search|web|look up|news about|how (tall|old|far|many)/.test(t)) return say(has('web_search') ? 'I couldn\'t find that.' : 'The demo\'s sample agent can\'t search the web. Connect an AI in Settings › Connections & AI - Claude and OpenAI search the web and list their sources.\n\n```offer\n{"text":"Want to see what I can tell you about the house?","ask":["What\'s using the most power?","Will it rain this week?"]}\n```');
      return say('In the demo I answer about lights, energy, the weather, the calendar, scores, music, bins and chores, cameras, the internet and alerts. Connect an AI in Settings › Connections & AI to ask anything.\n\n```offer\n{"text":"Try one of these?","ask":["Show energy for the last 7 days","Will it rain this week?","Did my team win?"]}\n```');
    }
    const R = Object.fromEntries(results.map((r) => [r.name, askJson(r.content) || {}]));
    return say(askSampleWrite(t, R, q));
  },
};
function askSamplePlan(t) {
  if (process.env.CASATORCH_ASK_FAKE === '1' && /^(who|what is|what was|when did|search|look up)\b/.test(t)) return [{ name: 'web_search', args: { query: t.replace(/[?.!]+$/, '').slice(0, 80) } }];
  if (/light/.test(t)) return [{ name: 'home_devices', args: { kind: 'light' } }];
  if (/music|song|speaker|playing/.test(t)) return [{ name: 'home_devices', args: { kind: 'media' } }];
  if (/power|energy|watt|electric|kwh|bill|cost/.test(t)) return [{ name: 'energy', args: { what: /last week|vs|compare/.test(t) ? 'compare_weeks' : /bill|month|forecast/.test(t) ? 'forecast' : /most|top|biggest|right now|using/.test(t) ? 'now' : 'days', days: 7 } }];
  if (/weather|rain|forecast|jacket|umbrella|cold|hot|temperature outside/.test(t)) return [{ name: 'weather', args: {} }];
  if (/score|game|win|won|team|niners|49ers|warriors|giants/.test(t)) return [{ name: 'sports', args: {} }];
  if (/bin|trash|recycl|mail|plant|laundry|washer|dryer/.test(t)) return [{ name: 'household', args: {} }];
  if (/chore|shopping|grocer|list|dinner|meal|stars/.test(t)) return [{ name: 'family', args: {} }];
  if (/calendar|schedule|plan|today|tomorrow|this week|event/.test(t)) return [{ name: 'calendar', args: { days: 7 } }];
  if (/camera|driveway|front door|someone|package|detect/.test(t)) return [{ name: 'cameras', args: {} }];
  if (/internet|wi-?fi|speed|network|ping/.test(t)) return [{ name: 'internet_network', args: {} }];
  if (/zoom|teams|netflix|app test|slow/.test(t)) return [{ name: 'app_tests', args: {} }];
  if (/alert|ok\b|okay|wrong|problem|everything|leak/.test(t)) return [{ name: 'alerts', args: {} }];
  if (/room|floor|3d|upstairs|downstairs/.test(t)) return [{ name: 'rooms_3d', args: {} }];
  if (process.env.CASATORCH_ASK_FAKE === '1' && /who|what is|what's|when|search|web|look up|history of|how (tall|old|far|many)/.test(t)) return [{ name: 'web_search', args: { query: t.replace(/[?.!]+$/, '').slice(0, 80) } }];
  return [];
}
const askOffer = (o) => `\n\n\`\`\`offer\n${JSON.stringify(o)}\n\`\`\``;
const askRound = (v, d = 1) => (v == null ? '-' : Math.round(v * 10 ** d) / 10 ** d);
function askSampleWrite(t, R, q) {
  const asOf = Object.values(R)[0]?.asOf, at = asOf ? ` (as of ${asOf.replace(/^\w+, \w+ \d+, /, '')})` : '';
  if (R.home_devices) {
    const ds = R.home_devices.devices || [];
    if (/music|song|speaker|playing/.test(t)) {
      const p = ds.filter((d) => d.playing);
      return p.length ? `**${p.length === 1 ? `${p[0].name} is` : `${p.length} speakers are`} playing**${at}:\n${p.map((d) => `- ${d.name}: ${d.nowPlaying || 'music'}`).join('\n')}\n\n\`\`\`devices\n${JSON.stringify(p.map((d) => d.id))}\n\`\`\`${askOffer({ text: 'Want me to pause it?', actions: [{ deviceIds: p.map((d) => d.id), action: 'toggle' }] })}` : `Nothing is playing${at}.${askOffer({ text: 'Anything else?', ask: ['Which lights are on?'] })}`;
    }
    const on = ds.filter((d) => d.on);
    if (!on.length) return `All ${ds.length} lights are off${at}.${askOffer({ text: 'Want to check something else?', ask: ['What\'s using the most power?'] })}`;
    return `**${on.length} of ${ds.length} lights are on**${at}:\n${on.map((d) => `- ${d.name}${d.room && d.room !== d.name ? ` (${d.room})` : ''}${d.brightness ? ` - ${d.brightness}%` : ''}`).join('\n')}\n\n\`\`\`devices\n${JSON.stringify(on.map((d) => d.id))}\n\`\`\`${askOffer({ text: `Want me to turn off the ${on.length === 1 ? 'light' : `${on.length} lights`} that ${on.length === 1 ? 'is' : 'are'} on?`, actions: [{ deviceIds: on.map((d) => d.id), action: 'off' }], ask: ['What\'s using the most power?'] })}`;
  }
  if (R.energy) {
    const e = R.energy, cur = e.currency === 'USD' || !e.currency ? '$' : `${e.currency} `;
    if (e.wattsNow != null) {
      const top = (e.topNow || []).slice(0, 5);
      return `The house is using **${(e.wattsNow / 1000).toFixed(1)} kW**${at}${e.costPerDayIfSteady != null ? ` - about ${cur}${e.costPerDayIfSteady.toFixed(2)} a day if it stays like this` : ''}. ${top[0] ? `The biggest draw is ${top[0].name} at ${top[0].watts} W.` : ''}\n\n\`\`\`stats\n${JSON.stringify([{ label: 'Using now', value: `${(e.wattsNow / 1000).toFixed(1)} kW`, sub: asOf ? asOf.replace(/^\w+, \w+ \d+, /, '') : null }, ...(e.costPerDayIfSteady != null ? [{ label: 'Per day at this rate', value: `${cur}${e.costPerDayIfSteady.toFixed(2)}` }] : []), ...(top[0] ? [{ label: 'Biggest draw', value: `${top[0].watts} W`, sub: top[0].name }] : [])])}\n\`\`\`\n\n\`\`\`chart\n${JSON.stringify({ type: 'bar', title: 'Biggest draws right now', unit: 'W', x: top.map((d) => d.name), series: [{ name: 'Watts', values: top.map((d) => d.watts) }] })}\n\`\`\`${askOffer({ text: 'Want to see how this week compares?', ask: ['Show this week vs last week', 'Show energy for the last 7 days'] })}`;
    }
    if (e.thisWeek) {
      const tw = e.thisWeek, lw = e.lastWeek, ch = e.changePct;
      return `You used **${askRound(tw.kwh)} kWh** in the last 7 days${tw.cost != null ? ` (${cur}${tw.cost.toFixed(2)})` : ''} - ${ch == null ? 'not enough history to compare with the week before' : `${Math.abs(ch)}% ${ch < 0 ? 'less' : 'more'} than the 7 days before (${askRound(lw.kwh)} kWh)`}.\n\n\`\`\`chart\n${JSON.stringify({ type: 'line', title: 'This week vs last week', unit: 'kWh', x: tw.days.map((d) => d.day.split(',')[0]), series: [{ name: 'This week', values: tw.days.map((d) => d.kwh) }, { name: 'Last week', values: lw.days.map((d) => d.kwh) }] })}\n\`\`\`${askOffer({ text: 'Want to see which devices used the most?', ask: ['What used the most energy this week?'] })}`;
    }
    if (e.days) {
      const d = e.days.filter((x) => x.kwh != null), full = d.filter((x) => !x.partialToday), peak = full.slice().sort((a, b) => b.kwh - a.kwh)[0];
      const rows = d.map((x) => `| ${x.day}${x.partialToday ? ' (so far)' : ''} | ${askRound(x.kwh)} | ${x.cost != null ? `${cur}${x.cost.toFixed(2)}` : '-'} |`).join('\n');
      return `**${askRound(e.totalKwh)} kWh** over the last ${full.length} full days - ${askRound(e.avgKwhPerDay)} kWh a day on average. The biggest day was ${peak?.day} at ${askRound(peak?.kwh)} kWh.\n\n\`\`\`chart\n${JSON.stringify({ type: 'bar', title: `Energy, last ${d.length} days`, unit: 'kWh', x: d.map((x) => x.day.split(',')[0] + (x.partialToday ? '*' : '')), series: [{ name: 'Used', values: d.map((x) => x.kwh) }] })}\n\`\`\`\n\n| Day | kWh | Cost |\n| --- | --- | --- |\n${rows}${askOffer({ text: 'Want me to compare it with the week before?', ask: ['Show this week vs last week', 'What\'s using the most power?'] })}`;
    }
    if (e.kwh != null && e.month) return `This month's bill is heading for **${cur}${askRound(e.cost, 2)}** (${askRound(e.kwh)} kWh)${e.budget ? ` against a budget of ${cur}${e.budget}` : ''}. So far: ${cur}${askRound(e.costSoFar, 2)}.\n\n\`\`\`stats\n${JSON.stringify([{ label: 'Forecast', value: `${cur}${askRound(e.cost, 0)}`, status: e.overBudget ? 'bad' : 'good' }, { label: 'So far', value: `${cur}${askRound(e.costSoFar, 0)}` }, { label: 'Per day', value: `${askRound(e.avgKwhPerDay)} kWh` }])}\n\`\`\`${askOffer({ text: 'Want to see the daily use?', ask: ['Show energy for the last 7 days'] })}`;
    return `I don't know - ${e.error || 'there is no energy data yet'}.${askOffer({ text: 'Anything else?', ask: ['What\'s using the most power?'] })}`;
  }
  if (R.weather) {
    const w = R.weather; if (w.error) return `I don't know - ${w.error}.${askOffer({ text: 'Anything else?', ask: ['Which lights are on?'] })}`;
    const rainy = (w.days || []).filter((d) => d.rainMm > 1);
    const rows = (w.days || []).slice(0, 7).map((d) => `| ${d.day.split(',')[0]} | ${d.high}° | ${d.low}° | ${d.words} | ${d.rainMm ? `${d.rainMm} mm` : '-'} |`).join('\n');
    return `**${w.now?.temp}° and ${String(w.now?.words || '').toLowerCase()}**${w.place ? ` in ${w.place}` : ''}${at}. ${rainy.length ? `Rain is likely ${rainy.map((d) => d.day.split(',')[0]).join(' and ')}.` : 'No real rain in the week ahead.'}\n\n| Day | High | Low | Sky | Rain |\n| --- | --- | --- | --- | --- |\n${rows}\n\n\`\`\`chart\n${JSON.stringify({ type: 'line', title: 'Highs and lows', unit: w.units || '°', x: (w.days || []).slice(0, 7).map((d) => d.day.split(',')[0]), series: [{ name: 'High', values: (w.days || []).slice(0, 7).map((d) => d.high) }, { name: 'Low', values: (w.days || []).slice(0, 7).map((d) => d.low) }] })}\n\`\`\`${askOffer({ text: rainy.length ? 'Want me to check which windows are open?' : 'Anything else for the week?', ask: [rainy.length ? 'Are any windows open?' : 'What\'s on the calendar this week?'] })}`;
  }
  if (R.sports) {
    const g = R.sports.games || []; if (!g.length) return `I don't see any games${R.sports.note ? ` - ${R.sports.note}` : ''}.${askOffer({ text: 'Anything else?', ask: ['What\'s on the calendar this week?'] })}`;
    const line = (x) => (x.state === 'live' ? `**Live:** ${x.away} at ${x.home} - ${x.detail}` : x.state === 'final' ? `**Final:** ${x.away} at ${x.home}${x.winner ? ` - ${x.winner} won` : ''}` : `**Next:** ${x.away} at ${x.home} - ${x.start}${x.tv ? ` on ${x.tv}` : ''}`);
    return `${g.slice(0, 4).map(line).join('\n\n')}\n\n| League | Game | Status |\n| --- | --- | --- |\n${g.slice(0, 8).map((x) => `| ${x.league} | ${x.away} at ${x.home} | ${x.state === 'upcoming' ? x.start : x.detail} |`).join('\n')}${askOffer({ text: 'Want me to put the next game on the calendar view?', ask: ['When is the next game?', 'What\'s on the calendar this week?'] })}`;
  }
  if (R.calendar) {
    const ev = R.calendar.events || []; if (!ev.length) return `Nothing on the calendar in the next 7 days.${askOffer({ text: 'Anything else?', ask: ['Will it rain this week?'] })}`;
    return `**${ev.length} event${ev.length === 1 ? '' : 's'}** in the next 7 days. Next up: ${ev[0].title}, ${ev[0].start}.\n\n| When | What | Calendar |\n| --- | --- | --- |\n${ev.slice(0, 12).map((e) => `| ${e.start} | ${e.title} | ${e.calendar || ''} |`).join('\n')}${askOffer({ text: 'Want the weather for those days too?', ask: ['Will it rain this week?'] })}`;
  }
  if (R.household) {
    const h = R.household, bins = (h.bins || []).filter((b) => b.next), thirsty = (h.plants || []).filter((p) => p.thirsty);
    return `${bins.length ? `**${bins[0].name}** goes out ${bins[0].state === 'tonight' ? 'tonight' : bins[0].next}.` : 'No bins coming up.'}${h.mail?.state === 'post' ? ' There\'s mail in the mailbox.' : ''}${thirsty.length ? ` ${thirsty.map((p) => p.name).join(' and ')} need water.` : ''}\n\n| Bin | Next | Out? |\n| --- | --- | --- |\n${bins.map((b) => `| ${b.name} | ${b.next} | ${b.out ? 'Yes' : 'No'} |`).join('\n')}${askOffer({ text: 'Want to see today\'s chores too?', ask: ['What chores are left today?'] })}`;
  }
  if (R.family) {
    const f = R.family, left = (f.choresToday || []).flatMap((c) => c.who.filter((w) => !w.done).map((w) => `${c.chore} (${w.person})`));
    const shop = (f.lists || []).find((l) => /shop|grocer/i.test(l.name));
    return `${left.length ? `**${left.length} chore${left.length === 1 ? '' : 's'} left today:** ${left.join(', ')}.` : 'All of today\'s chores are done.'}${shop?.open?.length ? `\n\nOn the ${shop.name}: ${shop.open.join(', ')}.` : ''}${f.meals?.[0] ? `\n\nDinner tonight: ${f.meals[0].meal}.` : ''}\n\n\`\`\`chart\n${JSON.stringify({ type: 'bar', title: 'Stars this week', unit: 'stars', x: (f.people || []).map((p) => p.name), series: [{ name: 'Stars', values: (f.people || []).map((p) => p.starsThisWeek || 0) }] })}\n\`\`\`${askOffer({ text: 'Want the meal plan for the week?', ask: ['What\'s for dinner this week?'] })}`;
  }
  if (R.cameras) { const c = R.cameras; return `**${(c.cameras || []).length} cameras**, ${(c.cameras || []).filter((x) => x.online).length} online.${c.latest?.length ? `\n\n${c.latest.map((x) => `- ${x}`).join('\n')}` : ''}${(c.recentAlerts || []).length ? `\n\nRecently: ${c.recentAlerts.slice(0, 3).map((a) => `${a.title} (${a.at})`).join('; ')}.` : ''}${askOffer({ text: 'Want to check the doors too?', ask: ['Is everything OK at home?'] })}`; }
  if (R.internet_network) { const n = R.internet_network, i = n.internet || {}; return `The internet is **${i.online ? 'up' : 'down'}**${at}: ${askRound(i.downMbps, 0)} down / ${askRound(i.upMbps, 0)} up Mbps, ${i.pingMs} ms ping, ${i.devicesOnNetwork} devices on the network.\n\n\`\`\`stats\n${JSON.stringify([{ label: 'Download', value: `${askRound(i.downMbps, 0)} Mbps`, status: 'good' }, { label: 'Upload', value: `${askRound(i.upMbps, 0)} Mbps` }, { label: 'Ping', value: `${i.pingMs} ms` }])}\n\`\`\`${(n.servers || []).length ? `\n\n| Server | Up | Response |\n| --- | --- | --- |\n${n.servers.slice(0, 8).map((s) => `| ${s.name} | ${s.up ? 'Yes' : 'No'} | ${s.ms ?? '-'} ms |`).join('\n')}` : ''}${askOffer({ text: 'Want to see the app tests?', ask: ['Are any apps slow?'] })}`; }
  if (R.app_tests) { const ts = R.app_tests.tests || []; const bad = ts.filter((x) => !x.ok || x.slow); return `${bad.length ? `**${bad.length} need a look:** ${bad.map((x) => x.name).join(', ')}.` : `**All ${ts.length} app tests are working.**`}\n\n\`\`\`chart\n${JSON.stringify({ type: 'bar', title: 'App response time', unit: 'ms', x: ts.slice(0, 10).map((x) => x.name), series: [{ name: 'Now', values: ts.slice(0, 10).map((x) => x.ms) }, { name: 'Usual', values: ts.slice(0, 10).map((x) => x.usualMs) }] })}\n\`\`\`${askOffer({ text: 'Want the network path for one of them?', ask: [`Show the path to ${ts[0]?.name || 'Zoom'}`] })}`; }
  if (R.alerts) { const a = R.alerts.open || []; return `${a.length ? `**${a.length} thing${a.length === 1 ? '' : 's'} need${a.length === 1 ? 's' : ''} a look:**\n${a.map((x) => `- ${x.title}`).join('\n')}` : '**All clear** - no open alerts.'}${(R.alerts.recent || []).length ? `\n\nRecently: ${R.alerts.recent.slice(0, 3).map((x) => `${x.title} (${x.at})`).join('; ')}.` : ''}${askOffer({ text: 'Want me to check which lights are still on?', ask: ['Which lights are on?'] })}`; }
  if (R.rooms_3d) { const f = R.rooms_3d.floors || []; return `Your 3D home has **${f.length} floors**:\n${f.map((x) => `- ${x.floor}: ${x.rooms.join(', ')}${x.devices.length ? ` (${x.devices.length} devices placed)` : ''}`).join('\n')}${askOffer({ text: 'Want to see which lights are on?', ask: ['Which lights are on?'] })}`; }
  if (R.web_search) { const r = R.web_search.results || []; return r.length ? `Here's what I found about "${q.replace(/[?]+$/, '')}" - see the sources below. ${r[0].title} has a summary.${askOffer({ text: 'Want me to look up anything else?', ask: ['Will it rain this week?'] })}` : `I couldn't find that.${askOffer({ text: 'Anything else?', ask: ['Which lights are on?'] })}`; }
  return `I don't know.${askOffer({ text: 'Try one of these?', ask: ['Which lights are on?'] })}`;
}
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchAsk = { askParse, askChart, askTable, askStats, askActions, askUrl, askStr, askSources, askFrom, askCiteLine, askRun, askToolsFor, askSystem, askShare, ASK_TOOLS, AI, aiSse, aiLines, antMessages, oaiInput, ASK_SAMPLE, useProvider: (p) => { askTestProvider = p; } };
