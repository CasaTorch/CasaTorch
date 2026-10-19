/* ======================================================================
 * Family board (server: 79c-family.js): shared lists (two-way with Home Assistant's to-do lists), chores with
 * stars, kids' morning and evening routines, the week's meals - the Family page, its Home widgets and its
 * Settings - plus three things for every screen:
 *  - "Show only when..." on any Home widget (a device's state, a time of day, someone home, days of the week),
 *    worked out here in the browser; a hidden widget makes room for the others (05-grid.js asks famShowWhen).
 *  - Status chips in the wall-panel status bar ("3 lights on", "Garage open", "18° outside").
 *  - Tonight's dinner on the Today widget.
 * ====================================================================== */
Object.assign(ICONS, {
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  tooth: 'M7.5 3C5 3 4 5 4 7.5c0 3 1.5 4.5 2 7.5.4 2.5 1 6 2.5 6 1.3 0 1.5-4.5 3.5-4.5s2.2 4.5 3.5 4.5c1.5 0 2.1-3.5 2.5-6 .5-3 2-4.5 2-7.5C20 5 19 3 16.5 3c-1.8 0-2.7 1-4.5 1s-2.7-1-4.5-1z',
  bed: 'M3 19V6M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6M7 12.5a1.5 1.5 0 1 0 0-.01',
  shirt: 'M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3a3 3 0 0 1-8 0z',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M19 19v2H6M8 7h7',
  backpack: 'M6 9a6 6 0 0 1 12 0v12H6zM9 4.5V3h6v1.5M6 13h12M10 16h4',
  broom: 'M14 3l-3.5 8M7 11h7l3 10H4zM9 15v6M12.5 15v6',
  dish: 'M3 13h18M5 13a7 7 0 0 0 14 0M12 6v2M8 21h8',
  bath: 'M4 12h17v3a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM6 12V5a2 2 0 0 1 4 0M7 20l-1 2M17 20l1 2',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  apple: 'M12 7c-1.5-1-5-1.5-6.5 1.5S5 16 7.5 19c1.5 1.8 3 2 4.5 1 1.5 1 3 .8 4.5-1 2.5-3 3.5-7.5 2-10.5S13.5 6 12 7zM12 7c0-2 1-3.5 3-4',
  toy: 'M12 3l3 5h-6zM5 21a4 4 0 1 1 0-.01M19 21a4 4 0 1 1 0-.01M9 12h6v6H9z',
  cart: 'M3 4h2l2.4 11h10.2L20 7H6.2M9 20a1 1 0 1 0 0-.01M17 20a1 1 0 1 0 0-.01',
  meal: 'M7 3v8M5 3v4a2 2 0 0 0 4 0V3M7 11v10M16 3c-2 1.5-3 4-3 7h3v11',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  bike: 'M6 18a3 3 0 1 0 0-.01M18 18a3 3 0 1 0 0-.01M6 18l4-8h5l3 8M10 10 8 6H6M15 10l-2-4h3',
  water: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11zM9 14a3 3 0 0 0 3 3',
});
document.head.append(el('style', {}, `
.fam-av { display: inline-grid; place-items: center; flex: none; width: 34px; height: 34px; border-radius: 50%; font-weight: 700; font-size: 15px; color: #06101e; box-shadow: inset 0 0 0 2px rgba(255,255,255,.25); }
.fam-av.lg { width: 64px; height: 64px; font-size: 28px; } .fam-av.xs { width: 24px; height: 24px; font-size: 11px; }
.fam-stars { display: inline-flex; align-items: center; gap: 3px; font-weight: 700; color: #f59e0b; font-variant-numeric: tabular-nums; } .fam-stars svg { width: 15px; height: 15px; fill: currentColor; }
.fam-seg { margin-bottom: 14px; display: flex; width: max-content; max-width: 100%; overflow-x: auto; scrollbar-width: none; }
@media (max-width: 760px) { .fam-seg { width: 100%; } .fam-seg a { flex: 1; justify-content: center; padding: 8px 6px !important; font-size: 14px; } .fam-seg a svg { display: none; } } .fam-wrap { display: grid; gap: 14px; }
.fam-rows { display: grid; gap: 6px; min-width: 0; }
.fam-row { position: relative; border-radius: 12px; overflow: hidden; touch-action: pan-y; }
.fam-del { position: absolute; inset: 0 0 0 auto; width: 88px; border: 0; background: var(--bad); color: #fff; font: inherit; font-weight: 650; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; opacity: 0; transition: opacity .15s; border-radius: 12px; }
.fam-row.reveal .fam-del, .fam-row.dragging .fam-del, .fam-del:focus-visible { opacity: 1; }
.fam-it { position: relative; display: flex; align-items: center; gap: 10px; min-width: 0; padding: 8px 10px; background: var(--surface-2); border-radius: 12px; transition: transform .18s ease; }
.fam-row.reveal .fam-it { transform: translateX(-88px); } .fam-row.dragging .fam-it { transition: none; }
.fam-chk { flex: none; width: 26px; height: 26px; border-radius: 50%; border: 2px solid var(--line-2); background: transparent; display: grid; place-items: center; cursor: pointer; color: transparent; padding: 0; }
.fam-chk svg { width: 15px; height: 15px; } .fam-chk.on { background: var(--good); border-color: var(--good); color: #06101e; }
.fam-txt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .fam-row.done .fam-txt { color: var(--muted); text-decoration: line-through; }
.fam-add { display: flex; gap: 8px; margin-bottom: 8px; } .fam-add input { flex: 1; min-width: 0; }
.fam-more { font-size: 12px; color: var(--muted); padding: 2px 4px; }
.fam-pills { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.fam-pill { display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--line); background: var(--surface-2); color: var(--text); padding: 8px 14px; border-radius: 999px; cursor: pointer; font: inherit; font-size: 14px; }
.fam-pill svg { width: 16px; height: 16px; } .fam-pill.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); font-weight: 650; } .fam-pill .n { color: var(--muted); font-size: 12px; }
.fam-people { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; align-items: start; }
.fam-pcard .head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; } .fam-pcard .head b { font-size: 18px; }
.fam-goal { height: 8px; border-radius: 99px; background: var(--surface-3); overflow: hidden; margin-top: 4px; } .fam-goal i { display: block; height: 100%; background: linear-gradient(90deg, #fbbf24, #f59e0b); border-radius: 99px; transition: width .4s; }
.fam-chore { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; font: inherit; color: inherit; padding: 10px 12px; border-radius: 14px; border: 1px solid var(--line); background: var(--surface-2); cursor: pointer; min-width: 0; position: relative; }
.fam-chore + .fam-chore { margin-top: 8px; } .fam-chore .ic { flex: none; width: 36px; height: 36px; border-radius: 11px; display: grid; place-items: center; background: var(--surface-3); } .fam-chore .ic svg { width: 20px; height: 20px; }
.fam-chore .grow { min-width: 0; } .fam-chore b { display: block; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .fam-chore small { color: var(--muted); }
.fam-chore.done { border-color: color-mix(in srgb, var(--good) 40%, transparent); background: color-mix(in srgb, var(--good) 10%, var(--surface-2)); } .fam-chore.done b { color: var(--muted); text-decoration: line-through; }
.fam-chore:disabled { cursor: default; } .fam-sub { font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin: 14px 0 8px; display: flex; align-items: center; gap: 6px; } .fam-sub svg { width: 14px; height: 14px; }
.fam-pop { position: absolute; right: 14px; top: 50%; pointer-events: none; color: #f59e0b; font-weight: 800; animation: famPop .9s ease-out forwards; } .fam-pop svg { width: 22px; height: 22px; fill: currentColor; }
@keyframes famPop { 0% { transform: translateY(-50%) scale(.4); opacity: 0; } 25% { transform: translateY(-60%) scale(1.3); opacity: 1; } 100% { transform: translateY(-160%) scale(1); opacity: 0; } }
.fam-kids { display: flex; flex-wrap: wrap; gap: 14px; justify-content: center; margin: 4px 0 18px; }
.fam-kid { display: grid; justify-items: center; gap: 6px; border: 3px solid transparent; background: none; color: var(--text); font: inherit; font-weight: 700; font-size: 17px; cursor: pointer; padding: 8px; border-radius: 22px; }
.fam-kid.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }
.fam-steps { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 14px; }
.fam-step { position: relative; display: grid; justify-items: center; align-content: center; gap: 10px; min-height: 170px; padding: 18px 12px; border-radius: 24px; border: 2px solid var(--line); background: var(--surface); color: var(--text); font: inherit; font-size: 19px; font-weight: 700; text-align: center; cursor: pointer; transition: transform .12s, background .2s, border-color .2s; -webkit-tap-highlight-color: transparent; }
.fam-step:active { transform: scale(.97); } .fam-step .ic { width: 76px; height: 76px; border-radius: 24px; display: grid; place-items: center; background: var(--surface-3); } .fam-step .ic svg { width: 46px; height: 46px; }
.fam-step .num { position: absolute; left: 14px; top: 10px; font-size: 14px; color: var(--muted); } .fam-step .tick { position: absolute; right: 12px; top: 10px; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: var(--good); color: #06101e; } .fam-step .tick svg { width: 18px; height: 18px; }
.fam-step.done { border-color: var(--good); background: color-mix(in srgb, var(--good) 14%, var(--surface)); } .fam-step.done .ic { background: color-mix(in srgb, var(--good) 25%, transparent); }
.fam-prog { display: flex; align-items: center; gap: 12px; margin: 0 0 16px; font-weight: 650; } .fam-prog .bar { flex: 1; height: 14px; border-radius: 99px; background: var(--surface-3); overflow: hidden; } .fam-prog .bar i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--good), #a3e635); transition: width .4s; }
.fam-yay { text-align: center; padding: 18px; border-radius: 24px; margin-bottom: 16px; background: linear-gradient(135deg, color-mix(in srgb, #fbbf24 22%, transparent), color-mix(in srgb, var(--good) 18%, transparent)); font-size: 26px; font-weight: 800; }
.fam-yay small { display: block; font-size: 15px; font-weight: 600; color: var(--muted); margin-top: 4px; }
.fam-week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 10px; }
.fam-day { display: flex; flex-direction: column; gap: 6px; min-height: 130px; padding: 12px; border-radius: 16px; border: 1px solid var(--line); background: var(--surface); color: inherit; font: inherit; text-align: left; cursor: pointer; min-width: 0; }
.fam-day.today { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); } .fam-day .d { font-size: 12px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .05em; }
.fam-day b { font-size: 15px; overflow-wrap: anywhere; } .fam-day .none { color: var(--faint); font-size: 13px; } .fam-day a { font-size: 12.5px; } .fam-day small { color: var(--muted); font-size: 12px; }
.fam-dinner { display: flex; align-items: center; gap: 10px; padding: 7px 10px; margin-bottom: 8px; border-radius: 12px; background: color-mix(in srgb, var(--accent) 9%, transparent); min-width: 0; }
.fam-dinner svg { width: 18px; height: 18px; flex: none; color: var(--accent); } .fam-dinner span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fam-icons { display: grid; grid-template-columns: repeat(auto-fill, minmax(44px, 1fr)); gap: 6px; } .fam-icons button { height: 44px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface-2); color: var(--text); cursor: pointer; display: grid; place-items: center; }
.fam-icons button.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--surface-2)); } .fam-icons svg { width: 22px; height: 22px; }
.fam-colors { display: flex; flex-wrap: wrap; gap: 8px; } .fam-colors button { width: 30px; height: 30px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; } .fam-colors button.on { border-color: var(--text); }
.fam-starpick { display: inline-flex; gap: 2px; } .fam-starpick button { border: 0; background: none; padding: 4px; cursor: pointer; color: var(--faint); } .fam-starpick button.on { color: #f59e0b; } .fam-starpick svg { width: 24px; height: 24px; } .fam-starpick button.on svg { fill: currentColor; }
.fam-cond { display: grid; gap: 8px; } .fam-crow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--line); }
.fam-cond .fam-crow select, .fam-cond .fam-crow input { width: auto !important; min-width: 0; max-width: 100%; flex: 0 1 auto; } .fam-cond .fam-crow input[type=time] { width: 130px !important; } .fam-cond .fam-crow select.dev { flex: 1 1 180px; } .fam-crow .lbl { font-size: 13px; color: var(--muted); } .fam-crow .x { margin-left: auto; }
.tile.cond-off { display: none; } .grid.editing .tile.cond-off { display: flex; opacity: .5; } .grid.editing .tile.cond-off::after { content: attr(data-hidden-now); position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); font-size: 12.5px; font-weight: 650; padding: 3px 8px; border-radius: 99px; background: var(--surface-3); color: var(--muted); pointer-events: none; }
#statusbar .fam-sbchips { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; min-width: 0; flex: 0 1 auto; } #statusbar .fam-sbchips:empty { display: none; }
#statusbar .fam-sbchip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--line); font-size: 12.5px; font-weight: 600; white-space: nowrap; } #statusbar .fam-sbchip svg { width: 14px; height: 14px; color: var(--muted); }
#statusbar .fam-sbchip.warn { border-color: color-mix(in srgb, var(--warn) 45%, transparent); background: color-mix(in srgb, var(--warn) 12%, var(--surface-2)); } #statusbar .fam-sbchip.warn svg { color: var(--warn); }
@media (max-width: 760px) { #statusbar .fam-sbchips { order: 5; flex: 1 1 100%; } .fam-week { grid-template-columns: 1fr; } .fam-day { min-height: 0; flex-direction: row; align-items: center; flex-wrap: wrap; gap: 4px 10px; } .fam-day .d { width: 64px; } .fam-steps { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; } .fam-step { min-height: 140px; font-size: 16px; } .fam-step .ic { width: 60px; height: 60px; } .fam-step .ic svg { width: 36px; height: 36px; } }
`));

/* ==================== pure: conditional widgets (test/family-unit.mjs runs this part in Node) ==================== */
/* pure:start */
/** A device's state as one plain word, the same whatever brand it is: on/off, open/closed, locked/unlocked, home/away, playing... */
function famDevState(d) {
  if (!d) return '';
  if (d.kind === 'presence') return d.home ? 'home' : 'away';
  if (d.kind === 'lock') return d.locked === false ? 'unlocked' : d.locked ? 'locked' : String(d.state || '');
  if (d.open != null) return d.open ? 'open' : 'closed';
  if (d.kind === 'media') return d.playing ? 'playing' : d.on ? 'on' : 'off';
  if (d.kind === 'alarm') return d.triggered ? 'triggered' : d.armed ? 'armed' : 'disarmed';
  if (typeof d.on === 'boolean') return d.on ? 'on' : 'off';
  if (d.water != null) return d.water ? 'wet' : 'dry';
  if (d.motion != null) return d.motion ? 'motion' : 'clear';
  if (d.value != null) return String(d.value).toLowerCase();
  return String(d.state || '').toLowerCase();
}
/** The words a device can be (for the "is" picker). */
function famStatesFor(d) {
  if (!d) return [];
  if (d.kind === 'presence') return ['home', 'away'];
  if (d.kind === 'lock') return ['locked', 'unlocked'];
  if (d.open != null) return ['open', 'closed'];
  if (d.kind === 'media') return ['playing', 'on', 'off'];
  if (d.kind === 'alarm') return ['armed', 'disarmed', 'triggered'];
  if (typeof d.on === 'boolean') return ['on', 'off'];
  if (d.water != null) return ['wet', 'dry'];
  if (d.motion != null) return ['motion', 'clear'];
  return [];
}
/** A device's number (temperature in the home's units, watts, %, a value), or null. */
function famDevNum(d, units = 'F') {
  if (!d) return null;
  if (d.tempC != null) return units === 'C' ? d.tempC : Math.round((d.tempC * 9 / 5 + 32) * 10) / 10;
  for (const k of ['powerW', 'humidity', 'battery', 'co2', 'percent', 'brightness']) if (typeof d[k] === 'number') return d[k];
  const n = Number(d.value); return d.value !== '' && d.value != null && Number.isFinite(n) ? n : null;
}
/** Is "HH:MM" inside from-to? A range can run past midnight (22:00 to 06:30). */
function famTimeIn(hhmm, from, to) {
  if (!/^\d\d:\d\d$/.test(from || '') || !/^\d\d:\d\d$/.test(to || '') || from === to) return true;
  return from < to ? hhmm >= from && hhmm < to : hhmm >= from || hhmm < to;
}
/** One condition. env: { devices (null = not known yet), hhmm "HH:MM", dow 0-6, units }. Something we can't tell (a device that
    isn't there right now) counts as met, so a widget never disappears because a sensor went quiet. */
function famCondOk(c, env) {
  const devs = env.devices;
  switch (c?.type) {
    case 'time': return famTimeIn(env.hhmm, c.from, c.to);
    case 'days': return !Array.isArray(c.days) || !c.days.length || c.days.includes(env.dow);
    case 'home': {
      if (!devs) return true;
      const people = devs.filter((d) => d.kind === 'presence' && (d.domain === 'person' || /^ha:person\./.test(d.id || '')));
      const ppl = people.length ? people : devs.filter((d) => d.kind === 'presence');
      if (c.who && c.who !== 'anyone' && c.who !== 'nobody') { const p = devs.find((d) => d.id === c.who); return p ? !!p.home === (c.away !== true) : true; }
      if (!ppl.length) return true;
      const any = ppl.some((d) => d.home);
      return c.who === 'nobody' ? !any : any;
    }
    case 'state': {
      if (!devs) return true;
      const d = devs.find((x) => x.id === c.id); if (!d) return true;
      if (c.op === 'above' || c.op === 'below') { const n = famDevNum(d, env.units), v = Number(c.value); if (n == null || !Number.isFinite(v)) return true; return c.op === 'above' ? n > v : n < v; }
      const s = famDevState(d), want = String(c.value ?? '').trim().toLowerCase();
      if (!want) return true;
      return c.op === 'not' ? s !== want : s === want;
    }
    default: return true;
  }
}
/** A widget's rule: { mode: 'all' | 'any', conds: [...] }. No conditions = always shown. */
function famRuleOk(rule, env) {
  const conds = Array.isArray(rule?.conds) ? rule.conds.filter((c) => c && c.type) : [];
  if (!conds.length) return true;
  return rule.mode === 'any' ? conds.some((c) => famCondOk(c, env)) : conds.every((c) => famCondOk(c, env));
}
/* pure:end */

/* ==================== data ==================== */
const FAM = { data: null, chips: [], chipsAt: 0 };
const famPut = (node, ...kids) => node.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
async function famLoad(fresh) {
  if (fresh) WCACHE.delete('/api/family');
  FAM.data = await wget('/api/family', 4000);
  return FAM.data;
}
let famCanAct = null;
const famRole = async () => { if (famCanAct == null) famCanAct = (await nudgeRole()) !== 'viewer'; return famCanAct; };
async function famDo(url, body, method = 'POST', okMsg) {
  try { const r = await post(url, body || {}, method); WCACHE.delete('/api/family'); if (okMsg) toast(okMsg); return r; }
  catch (e) { toast(e.message, 3500); return null; }
}
const famDel = async (url) => { try { await api(url, { method: 'DELETE' }); WCACHE.delete('/api/family'); return true; } catch (e) { toast(e.message, 3500); return false; } };
const famPerson = (d, id) => d?.people?.find((p) => p.id === id) || null;
const famAvatar = (p, size = '') => el('span', { class: `fam-av ${size}`, style: `background:${safeColor(p?.color, '#94a3b8')}`, 'aria-hidden': 'true' }, p ? String(p.name || '?').trim().charAt(0).toUpperCase() : icon('user', 16));
const famStarsEl = (n) => el('span', { class: 'fam-stars', title: T('{n} stars this week', { n }) }, icon('star'), String(n || 0));
const famDayName = (ymd, o = { weekday: 'long' }) => dtf(dateLoc(), { timeZone: 'UTC', ...o }).format(new Date(`${ymd}T12:00:00Z`));
const famAddDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const famRepeatWords = (c) => (c.repeat === 'weekly' ? T('Once a week') : c.repeat === 'days' ? (c.days || []).map((d) => famDayName(famAddDays('2026-10-18', d), { weekday: 'short' })).join(' ') : T('Every day'));
const famEditingOn = () => document.body.classList.contains('editing-on');
/* A star flying up from what you just did. */
function famPop(host, n) { if (!n || !host) return; const s = el('span', { class: 'fam-pop' }, icon('star'), ` +${n}`); host.append(s); setTimeout(() => s.remove(), 950); try { navigator.vibrate?.(10); } catch { /* not here */ } }

/* ==================== lists ==================== */
/* Swipe a row left (or press and hold it) to show Delete. Tap anywhere else to put it back. */
function famSwipe(row, onDelete) {
  const it = row.querySelector('.fam-it');
  let x0 = null, y0 = 0, dx = 0, timer = null, moved = false;
  const reset = () => { row.classList.remove('reveal', 'dragging'); it.style.transform = ''; };
  row.addEventListener('pointerdown', (e) => {
    if (famEditingOn() || e.button > 0) return;
    e.stopPropagation();   // not the Home screen's "hold to arrange"
    document.querySelectorAll('.fam-row.reveal').forEach((r) => { if (r !== row) { r.classList.remove('reveal'); r.querySelector('.fam-it').style.transform = ''; } });
    if (e.target.closest('.fam-del')) return;
    x0 = e.clientX; y0 = e.clientY; dx = 0; moved = false;
    timer = setTimeout(() => { timer = null; row.classList.add('reveal'); try { navigator.vibrate?.(12); } catch { /* not here */ } }, 550);
  });
  row.addEventListener('pointermove', (e) => {
    if (x0 == null) return;
    const ddx = e.clientX - x0, ddy = e.clientY - y0;
    if (Math.abs(ddx) > 8 || Math.abs(ddy) > 8) { clearTimeout(timer); timer = null; }
    if (!moved && Math.abs(ddx) > 10 && Math.abs(ddx) > Math.abs(ddy)) { moved = true; row.classList.add('dragging'); try { row.setPointerCapture(e.pointerId); } catch { /* fine */ } }
    if (moved) { dx = Math.max(-110, Math.min(0, ddx + (row.classList.contains('reveal') ? -88 : 0))); it.style.transform = `translateX(${dx}px)`; }
  });
  const up = () => {
    clearTimeout(timer); timer = null; if (x0 == null) return; x0 = null;
    if (moved) { row.classList.remove('dragging'); it.style.transform = ''; row.classList.toggle('reveal', dx < -50); }
  };
  row.addEventListener('pointerup', up); row.addEventListener('pointercancel', up);
  row.addEventListener('click', (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
  row.addEventListener('contextmenu', (e) => { e.preventDefault(); row.classList.add('reveal'); });
  row.querySelector('.fam-del').addEventListener('click', (e) => { e.stopPropagation(); reset(); onDelete(); });
  row.querySelector('.fam-del').addEventListener('focus', () => row.classList.add('reveal'));
  row.querySelector('.fam-del').addEventListener('blur', () => setTimeout(() => { if (!row.contains(document.activeElement)) row.classList.remove('reveal'); }, 100));
}
function famItemRow(l, it, canAct, redraw) {
  const chk = el('button', { class: `fam-chk${it.done ? ' on' : ''}`, 'aria-pressed': String(!!it.done), 'aria-label': it.done ? T('Not done: {item}', { item: it.text }) : T('Done: {item}', { item: it.text }), disabled: canAct ? null : true }, icon('check'));
  const row = el('div', { class: `fam-row${it.done ? ' done' : ''}` },
    el('button', { class: 'fam-del', tabindex: canAct ? '0' : '-1', 'aria-label': T('Delete {item}', { item: it.text }) }, icon('trash', 16), T('Delete')),
    el('div', { class: 'fam-it' }, chk, el('span', { class: 'fam-txt', title: it.text }, it.text)));
  chk.onclick = async () => { chk.classList.toggle('on'); row.classList.toggle('done'); if (await famDo(`/api/family/lists/${encodeURIComponent(l.id)}/items/${encodeURIComponent(it.id)}`, { done: !it.done }, 'PUT')) redraw(); };
  if (canAct) famSwipe(row, async () => { row.style.opacity = '.4'; if (await famDel(`/api/family/lists/${encodeURIComponent(l.id)}/items/${encodeURIComponent(it.id)}`)) { toast(T('Removed "{item}"', { item: it.text })); redraw(); } else row.style.opacity = ''; });
  return row;
}
function famQuickAdd(l, redraw, { autofocus } = {}) {
  const inp = el('input', { type: 'text', maxlength: 120, placeholder: T('Add to {list}…', { list: l.name }), 'aria-label': T('Add to {list}', { list: l.name }), enterkeyhint: 'done' });
  const go = async () => { const v = inp.value.trim(); if (!v) return; inp.value = ''; inp.disabled = true; const ok = await famDo(`/api/family/lists/${encodeURIComponent(l.id)}/items`, { text: v }); inp.disabled = false; if (ok) { await redraw(); } else inp.value = v; setTimeout(() => document.querySelector(`[data-famadd="${l.id}"] input`)?.focus({ preventScroll: true }), 30); };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  inp.addEventListener('pointerdown', (e) => e.stopPropagation());
  if (autofocus) setTimeout(() => inp.focus(), 40);
  return el('div', { class: 'fam-add', 'data-famadd': l.id }, inp, el('button', { class: 'btn primary small', 'aria-label': T('Add'), onclick: go }, icon('plus')));
}
function famListEditor(d, l, done) {
  const setup = api('/api/family/setup').catch(() => ({ haLists: [], icons: d.icons }));
  const name = el('input', { value: l?.name || '', maxlength: 40, placeholder: T('Groceries') });
  let ic = l?.icon || 'cart', src = l?.source || 'local', ent = '';
  const icons = el('div', { class: 'fam-icons' });
  const drawIcons = () => famPut(icons, ...['cart', 'list', 'meal', 'home', 'heart', 'school', 'star', 'plant', 'book', 'toy'].map((k) => el('button', { type: 'button', class: k === ic ? 'on' : '', 'aria-label': k, onclick: () => { ic = k; drawIcons(); } }, icon(k))));
  drawIcons();
  const srcBox = el('div');
  const body = el('div', {}, el('label', { class: 'field' }, el('span', {}, T('Name')), name), el('div', { class: 'field' }, el('span', { class: 'small muted' }, T('Icon')), icons), srcBox,
    el('div', { class: 'row', style: 'justify-content:flex-end;gap:8px;margin-top:14px' },
      l ? el('button', { class: 'btn ghost', style: 'margin-right:auto;color:var(--bad)', onclick: async () => { if (!confirm(T('Delete the list "{name}"?', { name: l.name }))) return; m.remove(); if (await famDel(`/api/family/lists/${encodeURIComponent(l.id)}`)) done(null); } }, T('Delete list')) : null,
      el('button', { class: 'btn ghost', onclick: () => m.remove() }, T('Cancel')),
      el('button', { class: 'btn primary', onclick: async () => {
        const r = l ? await famDo(`/api/family/lists/${encodeURIComponent(l.id)}`, { name: name.value, icon: ic }, 'PUT') : await famDo('/api/family/lists', { name: name.value, icon: ic, source: src, entity: ent });
        if (r) { m.remove(); done(r.list?.id || l?.id); }
      } }, l ? T('Save') : T('Add list'))));
  const m = modal(body, { title: l ? T('Edit list') : T('New list') });
  if (!l) setup.then((s) => {
    const has = s.haLists?.length;
    const draw = () => famPut(srcBox, el('div', { class: 'field' }, el('span', { class: 'small muted' }, T('Where it lives')),
      el('div', { class: 'seg seg-wrap' }, el('button', { type: 'button', class: src === 'local' ? 'on' : '', onclick: () => { src = 'local'; draw(); } }, T('On CasaTorch')), el('button', { type: 'button', class: src === 'ha' ? 'on' : '', disabled: has ? null : true, onclick: () => { src = 'ha'; ent ||= s.haLists[0]?.entity || ''; if (!name.value) name.value = s.haLists[0]?.name || ''; draw(); } }, T('Home Assistant to-do list'))),
      src === 'ha' ? el('select', { style: 'margin-top:8px', 'aria-label': T('Home Assistant to-do list'), onchange: (e) => { ent = e.target.value; const x = s.haLists.find((y) => y.entity === ent); if (x) name.value = x.name; } }, s.haLists.map((x) => el('option', { value: x.entity, selected: x.entity === ent || null }, `${x.name} (${x.entity})`))) : null,
      el('p', { class: 'tiny muted', style: 'margin:6px 0 0' }, src === 'ha' ? T('Two-way: what you add or check here changes in Home Assistant too, and the other way round.') : has ? T('Kept on your CasaTorch. Or pick one of your Home Assistant to-do lists.') : T('Kept on your CasaTorch. With Home Assistant connected, its to-do lists can be added here too.'))));
    draw();
  });
  setTimeout(() => name.focus(), 50);
}
/* The Lists page. */
async function famListsView(host, sel) {
  const [d, canAct] = await Promise.all([famLoad(true), famRole()]);
  const cur = d.lists.find((l) => l.id === (sel || FAM.listSel)) || d.lists[0];
  if (cur) FAM.listSel = cur.id;
  const redraw = () => famListsView(host, FAM.listSel);
  const pills = el('div', { class: 'fam-pills' }, d.lists.map((l) => el('button', { class: `fam-pill${l === cur ? ' on' : ''}`, onclick: () => { FAM.listSel = l.id; redraw(); } }, icon(l.icon || 'list'), l.name, el('span', { class: 'n' }, String(l.items.filter((x) => !x.done).length)), l.source === 'ha' ? el('span', { class: 'pill ha' }, 'HA') : null)),
    canAct ? el('button', { class: 'fam-pill', onclick: () => famListEditor(d, null, (id) => { if (id) FAM.listSel = id; redraw(); }) }, icon('plus'), T('New list')) : null);
  if (!cur) { famPut(host, pills, el('div', { class: 'card' }, empty(T('No lists yet. Make a shopping list, a to-do list - anything the family shares.')))); return; }
  const open = cur.items.filter((x) => !x.done), done = cur.items.filter((x) => x.done);
  const card = el('div', { class: 'card' },
    el('div', { class: 'row between wrap', style: 'gap:8px;margin-bottom:10px' }, el('h2', { style: 'margin:0' }, icon(cur.icon || 'list', 15), cur.name, cur.source === 'ha' ? el('span', { class: 'pill ha', title: cur.entity }, T('Home Assistant')) : null),
      el('div', { class: 'row', style: 'gap:6px' }, done.length && canAct ? el('button', { class: 'btn small ghost', onclick: async () => { if (await famDo(`/api/family/lists/${encodeURIComponent(cur.id)}/clear`)) redraw(); } }, T('Clear checked ({n})', { n: done.length })) : null,
        canAct ? el('button', { class: 'btn small ghost', 'aria-label': T('Edit list'), onclick: () => famListEditor(d, cur, (id) => { FAM.listSel = id; redraw(); }) }, icon('edit', 14)) : null)),
    cur.error ? el('div', { class: 'callout small', style: 'margin-bottom:10px' }, icon('info'), el('div', {}, T('Home Assistant isn\'t answering right now: {why}', { why: cur.error }))) : null,
    canAct ? famQuickAdd(cur, redraw, { autofocus: window.innerWidth > 760 }) : null,
    el('div', { class: 'fam-rows' }, open.map((it) => famItemRow(cur, it, canAct, redraw))),
    !open.length ? el('p', { class: 'small muted' }, T('Nothing on this list.')) : null,
    done.length ? el('div', { class: 'fam-sub' }, icon('check'), T('Checked')) : null,
    el('div', { class: 'fam-rows' }, done.slice(0, 50).map((it) => famItemRow(cur, it, canAct, redraw))),
    canAct ? el('p', { class: 'tiny faint', style: 'margin:12px 0 0' }, T('Swipe an item left, or press and hold it, to delete it.')) : null);
  famPut(host, pills, card);
}

/* ==================== chores and stars ==================== */
function famSlotRows(d, c, personId) { return c.slots.filter((s) => s.person === personId); }
async function famTick(c, s, done, host, by) {
  if (!done) famPop(host, c.stars);
  const r = await famDo(`/api/family/chores/${encodeURIComponent(c.id)}/done`, { person: s.person, done: !done, by });
  return !!r;
}
function famChoreBtn(d, c, s, canAct, redraw) {
  const who = s.person === '*' ? famPerson(d, s.by) : null;
  const b = el('button', { class: `fam-chore${s.done ? ' done' : ''}`, 'aria-pressed': String(s.done), disabled: canAct ? null : true },
    el('span', { class: 'ic' }, icon(c.icon || 'star')),
    el('span', { class: 'grow' }, el('b', {}, c.title), el('small', {}, [c.stars ? `${'★'.repeat(Math.min(5, c.stars))}` : null, c.repeat !== 'daily' ? famRepeatWords(c) : null, who ? T('done by {name}', { name: who.name }) : null].filter(Boolean).join(' · '))),
    s.done ? el('span', { class: 'fam-chk on', 'aria-hidden': 'true' }, icon('check')) : el('span', { class: 'fam-chk', 'aria-hidden': 'true' }, icon('check')));
  b.onclick = async () => {
    if (s.person === '*' && !s.done && d.people.length) return famWhoDidIt(d, (pid) => famTick(c, s, false, b, pid).then((ok) => ok && redraw()));
    b.classList.toggle('done'); if (await famTick(c, s, s.done, b)) setTimeout(redraw, s.done ? 0 : 450);
  };
  return b;
}
function famWhoDidIt(d, pick) {
  const m = modal(el('div', { class: 'fam-kids' }, d.people.map((p) => el('button', { class: 'fam-kid', onclick: () => { m.remove(); pick(p.id); } }, famAvatar(p, 'lg'), p.name))), { title: T('Who did it?') });
}
const famGoalBar = (p, n) => (p.goal ? el('div', { class: 'small muted', style: 'margin:-4px 0 12px' }, el('div', { class: 'row between' }, el('span', {}, p.reward ? T('{n} of {goal} for {reward}', { n, goal: p.goal, reward: p.reward }) : T('{n} of {goal} stars', { n, goal: p.goal }))), el('div', { class: 'fam-goal' }, el('i', { style: `width:${Math.min(100, Math.round((n / p.goal) * 100))}%` }))) : null);
async function famChoresView(host) {
  const [d, canAct] = await Promise.all([famLoad(true), famRole()]);
  const redraw = () => famChoresView(host);
  const top = el('div', { class: 'row between wrap', style: 'gap:8px;margin-bottom:12px' },
    el('div', { class: 'small muted' }, T('Stars count from {day} - they start again every week.', { day: famDayName(d.week) })),
    canAct ? el('button', { class: 'btn small', onclick: () => famManageChores(d, redraw) }, icon('edit', 14), T('Manage chores')) : null);
  if (!d.people.length) { famPut(host, el('div', { class: 'card' }, empty(T('Add the family first - then give everyone their chores.'), '#settings/family', T('Add the family')))); return; }
  const card = (p) => {
    const mine = d.chores.filter((c) => c.slots.some((s) => s.person === p.id));
    const n = d.stars.week[p.id] || 0, last = d.stars.lastWeek[p.id] || 0;
    const groups = [['', T('Chores'), mine.filter((c) => !c.routine)], ['morning', T('Morning'), mine.filter((c) => c.routine === 'morning')], ['evening', T('Evening'), mine.filter((c) => c.routine === 'evening')]].filter((g) => g[2].length);
    const left = mine.reduce((k, c) => k + famSlotRows(d, c, p.id).filter((s) => !s.done).length, 0);
    return el('div', { class: 'card fam-pcard' },
      el('div', { class: 'head' }, famAvatar(p, 'lg'), el('div', { class: 'grow', style: 'min-width:0' }, el('b', {}, p.name), el('div', { class: 'small muted' }, left ? T('{n} to do today', { n: left }) : mine.length ? T('All done today!') : T('Nothing today'))),
        el('div', { style: 'text-align:right' }, el('div', { style: 'font-size:22px' }, famStarsEl(n)), last ? el('div', { class: 'tiny muted' }, T('Last week: {n}', { n: last })) : null)),
      famGoalBar(p, n),
      ...groups.flatMap(([k, label, cs]) => [groups.length > 1 || k ? el('div', { class: 'fam-sub' }, icon(k === 'morning' ? 'sun' : k === 'evening' ? 'moon' : 'list'), label) : null, ...cs.flatMap((c) => famSlotRows(d, c, p.id).map((s) => famChoreBtn(d, c, s, canAct, redraw)))]).filter(Boolean),
      !mine.length ? el('p', { class: 'small muted' }, T('No chores for {name} today.', { name: p.name })) : null);
  };
  const shared = d.chores.filter((c) => c.slots.some((s) => s.person === '*'));
  famPut(host, top, el('div', { class: 'fam-people' }, ...d.people.map(card),
    shared.length ? el('div', { class: 'card fam-pcard' }, el('div', { class: 'head' }, famAvatar(null, 'lg'), el('div', { class: 'grow' }, el('b', {}, T('Anyone')), el('div', { class: 'small muted' }, T('Whoever does it gets the stars.')))),
      ...shared.map((c) => famChoreBtn(d, c, c.slots[0], canAct, redraw))) : null));
}
function famChoreEditor(d, c, done) {
  const v = { title: c?.title || '', icon: c?.icon || 'star', stars: c?.stars ?? 1, repeat: c?.repeat || 'daily', days: [...(c?.days || [1, 2, 3, 4, 5])], who: [...(c?.who || [])], routine: c?.routine || null };
  const box = el('div');
  const draw = () => {
    const title = el('input', { value: v.title, maxlength: 60, placeholder: T('Feed the cat'), oninput: (e) => { v.title = e.target.value; } });
    famPut(box, 
      el('label', { class: 'field' }, el('span', {}, T('Chore')), title),
      el('div', { class: 'field' }, el('span', { class: 'small muted' }, T('Picture')), el('div', { class: 'fam-icons' }, d.icons.filter((k) => k !== 'check').map((k) => el('button', { type: 'button', class: k === v.icon ? 'on' : '', 'aria-label': k, onclick: () => { v.icon = k; draw(); } }, icon(k))))),
      el('div', { class: 'field' }, el('span', { class: 'small muted' }, T('For')), el('div', { class: 'chips' }, el('button', { type: 'button', class: `chip${!v.who.length ? ' on' : ''}`, onclick: () => { v.who = []; draw(); } }, T('Anyone')),
        d.people.map((p) => el('button', { type: 'button', class: `chip${v.who.includes(p.id) ? ' on' : ''}`, onclick: () => { v.who = v.who.includes(p.id) ? v.who.filter((x) => x !== p.id) : [...v.who, p.id]; draw(); } }, p.name))),
        el('div', { class: 'tiny muted', style: 'margin-top:6px' }, v.who.length > 1 ? T('Each of them does their own.') : !v.who.length ? T('One check for the whole family - whoever does it gets the stars.') : '')),
      el('div', { class: 'field' }, el('span', { class: 'small muted' }, T('Repeats')), el('div', { class: 'seg seg-wrap' }, [['daily', T('Every day')], ['days', T('Some days')], ['weekly', T('Once a week')]].map(([k, l]) => el('button', { type: 'button', class: v.repeat === k ? 'on' : '', onclick: () => { v.repeat = k; draw(); } }, l))),
        v.repeat === 'days' ? el('div', { class: 'chips', style: 'margin-top:8px' }, [0, 1, 2, 3, 4, 5, 6].map((k) => el('button', { type: 'button', class: `chip${v.days.includes(k) ? ' on' : ''}`, onclick: () => { v.days = v.days.includes(k) ? v.days.filter((x) => x !== k) : [...v.days, k]; draw(); } }, famDayName(famAddDays('2026-10-18', k), { weekday: 'short' })))) : null,
        v.repeat === 'weekly' ? el('div', { class: 'tiny muted', style: 'margin-top:6px' }, T('On the list every day until it\'s done that week.')) : null),
      el('div', { class: 'field' }, el('span', { class: 'small muted' }, T('Stars')), el('div', { class: 'fam-starpick', role: 'group', 'aria-label': T('Stars') }, [1, 2, 3, 4, 5].map((k) => el('button', { type: 'button', class: k <= v.stars ? 'on' : '', 'aria-label': T('{n} stars', { n: k }), onclick: () => { v.stars = v.stars === k ? k - 1 : k; draw(); } }, icon('star'))))),
      el('div', { class: 'field' }, el('span', { class: 'small muted' }, T('Part of a routine')), el('div', { class: 'seg seg-wrap' }, [[null, T('No')], ['morning', T('Morning')], ['evening', T('Evening')]].map(([k, l]) => el('button', { type: 'button', class: v.routine === k ? 'on' : '', onclick: () => { v.routine = k; draw(); } }, l)))),
      el('div', { class: 'row', style: 'justify-content:flex-end;gap:8px;margin-top:14px' },
        c ? el('button', { class: 'btn ghost', style: 'margin-right:auto;color:var(--bad)', onclick: async () => { m.remove(); if (await famDel(`/api/family/chores/${encodeURIComponent(c.id)}`)) done(); } }, T('Delete')) : null,
        el('button', { class: 'btn ghost', onclick: () => m.remove() }, T('Cancel')),
        el('button', { class: 'btn primary', onclick: async () => { const r = c ? await famDo(`/api/family/chores/${encodeURIComponent(c.id)}`, v, 'PUT') : await famDo('/api/family/chores', v); if (r) { m.remove(); done(); } } }, c ? T('Save') : T('Add chore'))));
    if (!v.title) setTimeout(() => title.focus(), 40);
  };
  draw();
  const m = modal(box, { title: c ? T('Edit chore') : T('New chore'), wide: true });
}
function famManageChores(d, done) {
  const box = el('div');
  const draw = async () => {
    const dd = await famLoad(true), all = dd.allChores;
    const groups = [[null, T('Chores')], ['morning', T('Morning routine')], ['evening', T('Evening routine')]];
    famPut(box, el('button', { class: 'btn primary', style: 'margin-bottom:12px', onclick: () => famChoreEditor(dd, null, () => { draw(); done(); }) }, icon('plus'), T('New chore')),
      ...groups.map(([k, label]) => {
        const cs = all.filter((c) => (c.routine || null) === k).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        if (!cs.length) return null;
        return el('div', {}, el('div', { class: 'fam-sub' }, label), ...cs.map((c, i) => el('div', { class: 'row', style: 'gap:6px;margin-bottom:6px' },
          el('button', { class: 'fam-chore', style: 'margin:0', onclick: () => famChoreEditor(dd, c, () => { draw(); done(); }) }, el('span', { class: 'ic' }, icon(c.icon)), el('span', { class: 'grow' }, el('b', {}, c.title), el('small', {}, [c.who.length ? c.who.map((p) => famPerson(dd, p)?.name).filter(Boolean).join(', ') : T('Anyone'), famRepeatWords(c), `${c.stars} ★`].join(' · ')))),
          k ? el('button', { class: 'btn small ghost', 'aria-label': T('Move up'), disabled: i === 0 || null, onclick: async () => { const ids = cs.map((x) => x.id); [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; await famDo('/api/family/order', { ids }, 'PUT'); draw(); done(); } }, '↑') : null)));
      }).filter(Boolean), !all.length ? el('p', { class: 'muted small' }, T('No chores yet.')) : null);
  };
  draw();
  modal(box, { title: T('Manage chores'), wide: true });
}

/* ==================== routines: the big-tap screen ==================== */
const famRoutineNow = () => (Number(fmt(new Date().toISOString(), { hour: 'numeric', hourCycle: 'h23' })) < 14 ? 'morning' : 'evening');
async function famRoutinesView(host) {
  const [d, canAct] = await Promise.all([famLoad(true), famRole()]);
  const redraw = () => famRoutinesView(host);
  const kids = d.people.filter((p) => d.chores.some((c) => c.routine && c.slots.some((s) => s.person === p.id)));
  if (!kids.length) { famPut(host, el('div', { class: 'card' }, empty(T('Routines are chores in order - mark a chore "Morning" or "Evening" to put it here.'), canAct ? '#family/chores' : null, T('Chores')))); return; }
  FAM.kid = kids.some((p) => p.id === FAM.kid) ? FAM.kid : kids[0].id; FAM.when ||= famRoutineNow();
  const p = famPerson(d, FAM.kid);
  const steps = d.chores.filter((c) => c.routine === FAM.when).flatMap((c) => c.slots.filter((s) => s.person === p.id).map((s) => ({ c, s }))).sort((a, b) => a.c.order - b.c.order);
  const doneN = steps.filter((x) => x.s.done).length, earned = steps.filter((x) => x.s.done).reduce((k, x) => k + (x.c.stars || 0), 0);
  famPut(host, 
    el('div', { class: 'fam-kids' }, kids.map((k) => el('button', { class: `fam-kid${k.id === p.id ? ' on' : ''}`, 'aria-pressed': String(k.id === p.id), onclick: () => { FAM.kid = k.id; redraw(); } }, famAvatar(k, 'lg'), k.name, famStarsEl(d.stars.week[k.id] || 0)))),
    el('div', { style: 'display:flex;justify-content:center;margin-bottom:16px' }, el('div', { class: 'seg' }, [['morning', 'sun', T('Morning')], ['evening', 'moon', T('Evening')]].map(([k, ic, l]) => el('button', { class: FAM.when === k ? 'on' : '', style: 'display:inline-flex;align-items:center;gap:6px;font-size:16px;padding:10px 18px', onclick: () => { FAM.when = k; redraw(); } }, icon(ic, 18), l)))),
    steps.length && doneN === steps.length ? el('div', { class: 'fam-yay', role: 'status' }, T('All done, {name}!', { name: p.name }), ' ⭐', el('small', {}, T('+{n} stars this routine', { n: earned }))) : null,
    steps.length ? el('div', { class: 'fam-prog' }, el('span', {}, T('{n} of {total}', { n: doneN, total: steps.length })), el('div', { class: 'bar' }, el('i', { style: `width:${Math.round((doneN / steps.length) * 100)}%` }))) : el('p', { class: 'muted', style: 'text-align:center' }, T('Nothing in this routine for {name} today.', { name: p.name })),
    el('div', { class: 'fam-steps' }, steps.map(({ c, s }, i) => {
      const b = el('button', { class: `fam-step${s.done ? ' done' : ''}`, 'aria-pressed': String(s.done), disabled: canAct ? null : true, 'aria-label': `${i + 1}. ${c.title}` },
        el('span', { class: 'num' }, String(i + 1)), s.done ? el('span', { class: 'tick' }, icon('check')) : null, el('span', { class: 'ic' }, icon(c.icon || 'star')), el('span', {}, c.title));
      b.onclick = async () => { b.classList.toggle('done'); if (await famTick(c, s, s.done, b)) setTimeout(redraw, s.done ? 0 : 500); };
      return b;
    })));
}

/* ==================== meals ==================== */
async function famMealsView(host, from) {
  const [d, canAct] = await Promise.all([famLoad(), famRole()]);
  FAM.mealFrom = from || FAM.mealFrom || d.week;
  const wk = await api(`/api/family/meals?from=${FAM.mealFrom}`), redraw = (f) => famMealsView(host, f || FAM.mealFrom);
  const hasEmpty = wk.days.some((x) => !x.title);
  const head = el('div', { class: 'row between wrap', style: 'gap:8px;margin-bottom:12px' },
    el('div', { class: 'row', style: 'gap:6px' }, el('button', { class: 'btn small ghost', 'aria-label': T('Last week'), onclick: () => redraw(famAddDays(FAM.mealFrom, -7)) }, icon('chevl')),
      el('b', {}, `${famDayName(wk.from, { month: 'short', day: 'numeric' })} - ${famDayName(famAddDays(wk.from, 6), { month: 'short', day: 'numeric' })}`),
      el('button', { class: 'btn small ghost', 'aria-label': T('Next week'), onclick: () => redraw(famAddDays(FAM.mealFrom, 7)) }, icon('chevr')),
      FAM.mealFrom !== d.week ? el('button', { class: 'btn small ghost', onclick: () => redraw(d.week) }, T('This week')) : null),
    canAct && wk.lastWeek ? el('button', { class: 'btn small', onclick: async () => {
      if (!hasEmpty || wk.days.some((x) => x.title) ? !confirm(T('Copy last week\'s dinners onto this week? Days that had a dinner last week are replaced.')) : false) return;
      if (await famDo('/api/family/meals/copy', { to: wk.from }, 'POST', T('Copied last week'))) redraw();
    } }, icon('reset', 14), T('Copy last week')) : null);
  const recent = [...new Set(Object.values(d.meals || {}).map((m) => m.title).filter(Boolean))].slice(0, 12);
  famPut(host, head, el('div', { class: 'fam-week' }, wk.days.map((x) => {
    const href = x.url ? safeHref(x.url) : null;
    return el('div', { class: `fam-day${x.date === d.today ? ' today' : ''}`, role: canAct ? 'button' : null, tabindex: canAct ? '0' : null, onclick: (e) => { if (canAct && !e.target.closest('a')) famMealEditor(x, recent, () => redraw()); } },
      el('span', { class: 'd' }, x.date === d.today ? T('Today') : famDayName(x.date, { weekday: 'short', day: 'numeric' })),
      x.title ? el('b', {}, x.title) : el('span', { class: 'none' }, canAct ? T('+ Add dinner') : T('Not planned')),
      x.note ? el('small', {}, x.note) : null,
      href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, T('Recipe')) : null);
  })), el('p', { class: 'tiny faint', style: 'margin-top:10px' }, T('Today\'s dinner shows on the Today widget.')));
}
function famMealEditor(x, recent, done) {
  const title = el('input', { value: x.title || '', maxlength: 80, placeholder: T('Tacos') }), url = el('input', { type: 'url', value: x.url || '', placeholder: 'https://', maxlength: 500 }), note = el('input', { value: x.note || '', maxlength: 120, placeholder: T('Kids make their own') });
  const save = async (clear) => { const r = await famDo(`/api/family/meals/${x.date}`, clear ? {} : { title: title.value, url: url.value, note: note.value }, 'PUT'); if (r) { m.remove(); done(); } };
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  const m = modal(el('div', {}, el('label', { class: 'field' }, el('span', {}, T('Dinner')), title),
    recent.length ? el('div', { class: 'chips', style: 'margin:-2px 0 8px' }, recent.filter((r) => r !== x.title).slice(0, 8).map((r) => el('button', { type: 'button', class: 'chip', onclick: () => { title.value = r; } }, r))) : null,
    el('label', { class: 'field' }, el('span', {}, T('Recipe link (optional)')), url), el('label', { class: 'field' }, el('span', {}, T('Note (optional)')), note),
    el('div', { class: 'row', style: 'justify-content:flex-end;gap:8px;margin-top:12px' }, x.title ? el('button', { class: 'btn ghost', style: 'margin-right:auto', onclick: () => save(true) }, T('Clear')) : null, el('button', { class: 'btn ghost', onclick: () => m.remove() }, T('Cancel')), el('button', { class: 'btn primary', onclick: () => save() }, T('Save')))),
  { title: famDayName(x.date, { weekday: 'long', month: 'long', day: 'numeric' }) });
  setTimeout(() => title.focus(), 50);
}

/* ==================== the Family page ==================== */
/* A page of tiles (06-pagegrid.js), like every other page: lists, chores, routines and meals, each a tile you can move,
   resize or remove with Edit. #family/<view> (links from the widgets and the docs) scrolls to that tile. */
const FAM_VIEWS = [['lists', 'list', 'Lists', 'Shopping and to-do lists everyone can add to', (b) => famListsView(b)], ['chores', 'star', 'Chores', 'Chores with stars, for each person', (b) => famChoresView(b)],
  ['routines', 'sun', 'Routines', 'Morning and evening routines kids tap through', (b) => famRoutinesView(b)], ['meals', 'meal', 'Meals', 'The week\'s dinners', (b) => famMealsView(b)]];
for (const [k, ic, title, blurb, view] of FAM_VIEWS) {
  pageTile({ id: `fam-${k}`, page: 'family', auto: true, title, icon: ic, blurb, size: [k === 'lists' || k === 'chores' ? 6 : 12, 1], async render(b) { b.classList.add('fam-wrap'); await view(b); } });
}
tab({ id: 'family', label: 'Family', icon: 'star', after: 'reminders', async render(main, sub) {
  const refresh = await pageGrid(main, { page: 'family', auto: true, title: tabLabel({ id: 'family', label: T('Family') }), sub: T('Lists, chores, routines and meals'), load: () => famLoad(true),
    actions: [el('a', { class: 'btn', href: '#settings/family' }, icon('gear', 14), el('span', { class: 'hide-phone' }, T('Family settings')))] });
  if (FAM_VIEWS.some(([k]) => k === sub)) requestAnimationFrame(() => main.querySelector(`.tile[data-id^="fam-${sub}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  // not while someone is typing into a list or has a row open
  return refresh && (async () => { if (main.querySelector('.fam-row.reveal, .fam-add input:focus') || document.activeElement?.closest?.('.fam-add')) return; await refresh(); });
} });

/* ==================== Home widgets ==================== */
widget({ id: 'lists', title: 'Lists', icon: 'cart', cat: 'personal', multi: true, blurb: 'Shopping and to-do lists - add, check off, swipe to delete', keywords: 'shopping grocery todo to-do list home assistant', min: [2, 2], size: [3, 4],
  options: () => [{ key: 'list', type: 'select', label: T('List'), choices: [['', T('The first list')], ...((FAM.data?.lists || []).map((l) => [l.id, l.name]))] }, { key: 'add', type: 'toggle', label: T('Quick add'), text: T('A box to add things (when there\'s room)'), default: true }],
  async render(b, ctx, { w, h }) {
    const o = optsOf(b._t || {});
    const [d, canAct] = await Promise.all([famLoad(), famRole()]);
    const l = d.lists.find((x) => x.id === o.list) || d.lists[0];
    if (!l) return famPut(b, empty(T('Make a shopping or to-do list.'), '#family/lists', T('Lists')));
    const ttl = b.parentElement?.querySelector('.ttl'); if (ttl && !b._t?.title) ttl.textContent = l.name;
    const redraw = async () => { await famLoad(true); return WIDGETS.lists.render(b, ctx, { w, h }); };
    const open = l.items.filter((x) => !x.done);
    const withAdd = canAct && o.add !== false && h >= 3;
    const room = Math.max(1, fits(h, 42, 46 + (withAdd ? 46 : 0)));
    const rows = open.slice(0, open.length > room ? room - 1 : room).map((it) => famItemRow(l, it, canAct, redraw));
    famPut(b, ...[withAdd ? famQuickAdd(l, redraw) : null, el('div', { class: 'fam-rows' }, rows),
      open.length > rows.length ? el('a', { class: 'fam-more', href: '#family/lists', onclick: () => { FAM.listSel = l.id; } }, T('+{n} more', { n: open.length - rows.length })) : null,
      !open.length ? el('div', { class: 'small muted', style: 'padding:6px 2px' }, l.items.length ? T('All checked off.') : T('Nothing on this list.')) : null,
      l.error ? el('div', { class: 'tiny muted' }, T('Home Assistant isn\'t answering right now.')) : null].filter(Boolean));
  } });

widget({ id: 'chores', title: 'Chores', icon: 'star', cat: 'personal', blurb: 'Who has chores left today, and their stars this week', keywords: 'chores stars kids rewards chart routine', min: [2, 2], size: [4, 3],
  async render(b, ctx, { w, h }) {
    const [d, canAct] = await Promise.all([famLoad(), famRole()]);
    if (!d.people.length) return famPut(b, empty(T('Chores with stars for the family.'), '#settings/family', T('Set up')));
    const redraw = async () => { await famLoad(true); return WIDGETS.chores.render(b, ctx, { w, h }); };
    const per = h >= 4 && w >= 4 ? 2 : 0;   // with room, each person's next chores to tap
    const rows = d.people.slice(0, fits(h, per ? 96 : 50)).map((p) => {
      const todo = d.chores.flatMap((c) => c.slots.filter((s) => s.person === p.id && !s.done).map((s) => ({ c, s })));
      const n = d.stars.week[p.id] || 0;
      return el('div', { style: 'min-width:0' },
        el('a', { class: 'row', href: '#family/chores', style: 'gap:10px;padding:5px 0;color:inherit;text-decoration:none;min-width:0' }, famAvatar(p), el('div', { class: 'grow', style: 'min-width:0' }, el('b', { class: 'ellipsis', style: 'display:block' }, p.name), w >= 3 ? el('span', { class: 'tiny muted' }, todo.length ? T('{n} to do today', { n: todo.length }) : T('All done today!')) : null), famStarsEl(n)),
        per ? el('div', { class: 'chips', style: 'margin:2px 0 4px 44px;gap:6px' }, todo.slice(0, per).map(({ c, s }) => el('button', { class: 'chip', disabled: canAct ? null : true, style: 'position:relative;display:inline-flex;align-items:center;gap:5px', onclick: async (e) => { const bt = e.currentTarget; bt.style.opacity = '.5'; if (await famTick(c, s, false, bt)) setTimeout(redraw, 450); } }, icon(c.icon, 14), c.title))) : null);
    });
    famPut(b, el('div', { class: 'fam-rows', style: 'gap:2px' }, rows));
  } });

widget({ id: 'routine', title: 'Routine', icon: 'sun', cat: 'personal', multi: true, blurb: 'A morning or evening routine to tap through', keywords: 'kids routine morning evening checklist bedtime', min: [3, 3], size: [4, 4],
  options: () => [{ key: 'who', type: 'select', label: T('Whose'), choices: [['', T('The first one')], ...((FAM.data?.people || []).map((p) => [p.id, p.name]))] }, { key: 'when', type: 'select', label: T('Which'), default: 'auto', choices: [['auto', T('Morning until 2 PM, then evening')], ['morning', T('Morning')], ['evening', T('Evening')]] }],
  async render(b, ctx, { w, h }) {
    const o = optsOf(b._t || {});
    const [d, canAct] = await Promise.all([famLoad(), famRole()]);
    const kids = d.people.filter((p) => d.chores.some((c) => c.routine && c.slots.some((s) => s.person === p.id)));
    const p = kids.find((x) => x.id === o.who) || kids[0];
    if (!p) return famPut(b, empty(T('Routines are chores in order - mark a chore "Morning" or "Evening".'), '#family/chores', T('Chores')));
    const when = o.when === 'morning' || o.when === 'evening' ? o.when : famRoutineNow();
    const steps = d.chores.filter((c) => c.routine === when).flatMap((c) => c.slots.filter((s) => s.person === p.id).map((s) => ({ c, s }))).sort((a, x) => a.c.order - x.c.order);
    const doneN = steps.filter((x) => x.s.done).length;
    const redraw = async () => { await famLoad(true); return WIDGETS.routine.render(b, ctx, { w, h }); };
    const ttl = b.parentElement?.querySelector('.ttl'); if (ttl && !b._t?.title) ttl.textContent = `${p.name} · ${when === 'morning' ? T('Morning') : T('Evening')}`;
    const room = Math.max(1, fits(h, 50, 46 + 30));
    famPut(b, el('div', { class: 'fam-prog', style: 'margin-bottom:8px;font-size:13px' }, el('span', {}, T('{n} of {total}', { n: doneN, total: steps.length })), el('div', { class: 'bar', style: 'height:9px' }, el('i', { style: `width:${steps.length ? Math.round((doneN / steps.length) * 100) : 0}%` }))),
      steps.length && doneN === steps.length ? el('div', { class: 'allclear' }, el('div', {}, el('div', { style: 'font-size:30px' }, '⭐'), el('b', {}, T('All done, {name}!', { name: p.name })))) :
        el('div', {}, steps.filter((x) => !x.s.done).slice(0, room).map(({ c, s }) => { const bt = famChoreBtn(d, c, s, canAct, redraw); bt.style.padding = '7px 10px'; return bt; })));
  } });

widget({ id: 'meals', title: 'Dinner', icon: 'meal', cat: 'personal', blurb: 'Tonight\'s dinner and the next few days', keywords: 'meal plan dinner menu food recipe week', min: [2, 2], size: [3, 3],
  async render(b, ctx, { w, h }) {
    const d = await famLoad();
    const days = Array.from({ length: 7 }, (_, i) => famAddDays(d.today, i)).map((x) => ({ date: x, ...(d.meals[x] || {}) }));
    if (!days.some((x) => x.title)) return famPut(b, empty(T('Plan the week\'s dinners.'), '#family/meals', T('Meals')));
    const t = days[0], href = t.url ? safeHref(t.url) : null;
    const rest = days.slice(1, 1 + Math.max(0, fits(h, 31, 46 + 80)));
    famPut(b, el('a', { href: '#family/meals', style: 'color:inherit;text-decoration:none;display:block;min-width:0' }, el('div', { class: 'tiny muted' }, T('Tonight')), el('div', { class: 'ellipsis', style: `font-size:${w <= 2 ? 17 : 21}px;font-weight:700` }, t.title || T('Not planned'))),
      href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer', class: 'small' }, T('Recipe')) : null,
      h >= 3 ? el('ul', { class: 'list', style: 'margin-top:8px' }, rest.map((x) => el('li', { class: 'row', style: 'gap:8px;padding:4px 0' }, el('b', { style: 'width:44px;flex:none' }, famDayName(x.date, { weekday: 'short' })), el('span', { class: `grow ellipsis${x.title ? '' : ' muted'}` }, x.title || '-')))) : null);
  } });

/* Tonight's dinner at the top of the Today widget. */
{
  const todayW = WIDGETS.today;
  if (todayW) {
    const orig = todayW.render;
    todayW.blurb = 'Today\'s reminders, tonight\'s dinner and the house note';
    todayW.render = async function famToday(b, ctx, size) {
      await orig.call(this, b, ctx, size);
      const d = await famLoad().catch(() => null);
      if (!d?.dinner?.title || !b.isConnected && !size?.preview) return;
      const row = el('a', { class: 'fam-dinner', href: '#family/meals', style: 'color:inherit;text-decoration:none' }, icon('meal'), el('span', {}, el('span', { class: 'tiny muted' }, `${T('Dinner')} · `), d.dinner.title));
      const emptyEl = b.querySelector(':scope > .allclear'); if (emptyEl) emptyEl.remove();
      b.prepend(row);
      const last = () => b.lastElementChild; for (let i = 0; i < 12 && b.scrollHeight > b.clientHeight + 2 && b.children.length > 1 && last() !== row; i++) last().remove();
    };
  }
}

/* ==================== "Show only when..." (05-grid.js asks these) ==================== */
function famEnv(ctx) {
  const now = new Date().toISOString();
  const hhmm = fmt(now, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).replace(/^24/, '00');
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(fmt(now, { weekday: 'short' }));
  return { devices: ctx?.data?.devices?.devices || null, hhmm, dow, units: S.units };
}
/** Should this tile show right now? */
function famShowWhen(t, ctx) { return !t?.showWhen?.conds?.length || famRuleOk(t.showWhen, famEnv(ctx)); }
/** The words for a rule, for the "Hidden right now" tag. */
function famRuleWords(rule, devices) {
  const one = (c) => {
    if (c.type === 'time') return T('{from} to {to}', { from: hm(c.from || '00:00'), to: hm(c.to || '00:00') });
    if (c.type === 'days') return (c.days || []).map((k) => famDayName(famAddDays('2026-10-18', k), { weekday: 'short' })).join(' ');
    if (c.type === 'home') return c.who === 'nobody' ? T('Nobody home') : c.who && c.who !== 'anyone' ? T('{name} home', { name: devices?.find((d) => d.id === c.who)?.name || '?' }) : T('Someone home');
    const d = devices?.find((x) => x.id === c.id); return `${d?.name || '?'} ${c.op === 'above' ? '>' : c.op === 'below' ? '<' : c.op === 'not' ? '≠' : '='} ${c.value ?? ''}`;
  };
  return (rule?.conds || []).map(one).join(rule?.mode === 'any' ? ` ${T('or')} ` : ', ');
}
/** The "Show only when…" part of Customize. */
function famCondField(t, ctx, changed) {
  const box = el('div', { class: 'fam-cond' });
  const devs = [...(ctx?.data?.devices?.devices || [])].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const people = devs.filter((d) => d.kind === 'presence');
  const rule = () => (t.showWhen ||= { mode: 'all', conds: [] });
  const done = () => { if (!t.showWhen?.conds?.length) delete t.showWhen; draw(); changed(); };
  const draw = () => {
    const r = t.showWhen, conds = r?.conds || [];
    const rows = conds.map((c, i) => {
      const x = el('button', { type: 'button', class: 'btn small ghost x', 'aria-label': T('Remove this condition'), onclick: () => { conds.splice(i, 1); done(); } }, icon('x', 14));
      const up = (k, v) => { c[k] = v; changed(); };
      if (c.type === 'time') return el('div', { class: 'fam-crow' }, icon('clock', 16), el('span', { class: 'lbl' }, T('Between')), el('input', { type: 'time', value: c.from || '07:00', onchange: (e) => up('from', e.target.value) }), el('span', { class: 'lbl' }, T('and')), el('input', { type: 'time', value: c.to || '09:00', onchange: (e) => up('to', e.target.value) }), x);
      if (c.type === 'days') return el('div', { class: 'fam-crow' }, icon('calendar', 16), el('div', { class: 'chips' }, [1, 2, 3, 4, 5, 6, 0].map((k) => el('button', { type: 'button', class: `chip${(c.days || []).includes(k) ? ' on' : ''}`, onclick: (e) => { c.days = (c.days || []).includes(k) ? c.days.filter((y) => y !== k) : [...(c.days || []), k]; e.currentTarget.classList.toggle('on'); changed(); } }, famDayName(famAddDays('2026-10-18', k), { weekday: 'short' })))), x);
      if (c.type === 'home') return el('div', { class: 'fam-crow' }, icon('user', 16), el('select', { onchange: (e) => up('who', e.target.value) }, el('option', { value: 'anyone', selected: (c.who || 'anyone') === 'anyone' || null }, T('Someone is home')), el('option', { value: 'nobody', selected: c.who === 'nobody' || null }, T('Nobody is home')),
        people.map((p) => el('option', { value: p.id, selected: c.who === p.id || null }, T('{name} is home', { name: p.name })))), x);
      const d = devs.find((y) => y.id === c.id), states = famStatesFor(d), numeric = famDevNum(d, S.units) != null && !states.length;
      if (!c.op) c.op = numeric ? 'above' : 'is';
      if (c.value == null && states.length) c.value = states[0];
      const valEl = c.op === 'above' || c.op === 'below' ? el('input', { type: 'number', step: 'any', value: c.value ?? '', style: 'width:90px', 'aria-label': T('Value'), oninput: (e) => up('value', e.target.value) })
        : states.length ? el('select', { 'aria-label': T('State'), onchange: (e) => up('value', e.target.value) }, states.map((s) => el('option', { value: s, selected: c.value === s || null }, T(s)))) : el('input', { type: 'text', value: c.value ?? '', style: 'width:110px', maxlength: 40, 'aria-label': T('State'), oninput: (e) => up('value', e.target.value) });
      return el('div', { class: 'fam-crow' }, icon(d ? devIconName(d) : 'plug', 16),
        el('select', { class: 'dev', 'aria-label': T('Device'), onchange: (e) => { c.id = e.target.value; delete c.value; delete c.op; draw(); changed(); } }, el('option', { value: '' }, T('Pick a device…')), devs.slice(0, 1500).map((y) => el('option', { value: y.id, selected: y.id === c.id || null }, `${y.name}${y.area ? ` · ${y.area}` : ''}`))),
        d ? el('select', { 'aria-label': T('Is'), onchange: (e) => { c.op = e.target.value; if (['above', 'below'].includes(c.op) !== numeric) delete c.value; draw(); changed(); } }, [...(states.length || !numeric ? [['is', T('is')], ['not', T('is not')]] : []), ...(famDevNum(d, S.units) != null ? [['above', T('is above')], ['below', T('is below')]] : [])].map(([k, l]) => el('option', { value: k, selected: c.op === k || null }, l))) : null,
        d ? valEl : null, x);
    });
    const add = (c) => { rule().conds.push(c); draw(); changed(); };
    famPut(box, 
      conds.length > 1 ? el('div', { class: 'seg seg-mini', style: 'justify-self:start' }, [['all', T('All of these')], ['any', T('Any of these')]].map(([k, l]) => el('button', { type: 'button', class: (r.mode || 'all') === k ? 'on' : '', onclick: () => { r.mode = k; draw(); changed(); } }, l))) : null,
      ...rows,
      !conds.length ? el('div', { class: 'tiny muted' }, T('Always shown.')) : null,
      conds.length < 6 ? el('div', { class: 'chips' }, el('button', { type: 'button', class: 'chip', onclick: () => add({ type: 'state', id: devs.find((y) => y.kind === 'cover' || y.open != null)?.id || devs[0]?.id || '' }) }, `+ ${T('A device')}`),
        el('button', { type: 'button', class: 'chip', onclick: () => add({ type: 'time', from: '07:00', to: '09:00' }) }, `+ ${T('Time of day')}`),
        el('button', { type: 'button', class: 'chip', onclick: () => add({ type: 'home', who: 'anyone' }) }, `+ ${T('Someone home')}`),
        el('button', { type: 'button', class: 'chip', onclick: () => add({ type: 'days', days: [1, 2, 3, 4, 5] }) }, `+ ${T('Days of the week')}`)) : null,
      conds.length ? el('div', { class: 'tiny muted' }, T('When it doesn\'t apply, the widget is hidden and the others close up. While you arrange the Home screen it shows faded.')) : null);
  };
  draw();
  return box;
}

/* ==================== status chips in the panel bar ==================== */
async function famChipsLoad() {
  try { const r = await api('/api/family/chips'); FAM.chips = r.chips || []; FAM.chipsAt = Date.now(); } catch { /* keep the last ones */ }
  famChipsPaint();
}
function famChipsPaint() {
  const bar = $('#statusbar'); if (!bar || bar.hidden) return;
  let box = bar.querySelector('.fam-sbchips');
  if (!box) { box = el('div', { class: 'fam-sbchips', role: 'status', 'aria-label': T('At a glance') }); const items = bar.querySelector('.sb-items'); if (items) items.before(box); else bar.append(box); }
  famPut(box, ...FAM.chips.map((c) => el('span', { class: `fam-sbchip${c.tone === 'warn' ? ' warn' : ''}` }, icon(c.icon || 'dotc'), TM(c.text, c.msg, c.vars))));
}
{
  const draw0 = statusBar.draw, load0 = statusBar.load;
  statusBar.draw = function famDraw(...a) { const r = draw0.apply(this, a); if (this.visible()) { famChipsPaint(); if (Date.now() - FAM.chipsAt > 20_000) { FAM.chipsAt = Date.now(); famChipsLoad(); } } return r; };
  statusBar.load = function famLoadBar(...a) { famChipsLoad(); return load0.apply(this, a); };
  setInterval(() => { if (!document.hidden && statusBar.visible()) famChipsLoad(); }, 20_000);
}

/* ==================== Settings ==================== */
/* Settings › Family board: the family, the week, lists from Home Assistant. */
async function familyCards() {
  const host = el('div', { style: 'display:contents' });
  const draw = async () => {
    let s; try { s = await api('/api/family/setup'); } catch (e) { famPut(host, el('div', { class: 'card' }, el('p', { class: 'small muted' }, e.message))); return; }
    const canEdit = await famRole();
    const people = s.people.map((p) => ({ ...p }));
    const savePeople = async () => { if (await famDo('/api/family/people', { people }, 'PUT', T('Saved'))) draw(); };
    const personRow = (p) => el('button', { class: 'hh-item', disabled: canEdit ? null : true, onclick: () => famPersonEditor(s, p, (np) => { if (np === null) people.splice(people.indexOf(p), 1); else Object.assign(p, np); savePeople(); }) },
      famAvatar(p), el('div', { class: 'grow' }, el('b', { style: 'display:block' }, p.name), el('span', { class: 'small muted' }, p.goal ? (p.reward ? T('Goal: {n} stars for {reward}', { n: p.goal, reward: p.reward }) : T('Goal: {n} stars a week', { n: p.goal })) : T('No weekly goal'))), canEdit ? icon('chevr', 16) : null);
    const fam1 = el('div', { class: 'card hh-card' }, el('h2', {}, icon('user', 16), T('The family')),
      el('p', { class: 'small muted', style: 'margin-top:0' }, T('Everyone who has chores and stars. Kids don\'t need a sign-in.')),
      el('div', { class: 'hh-list' }, people.map(personRow)),
      canEdit && people.length < 12 ? el('div', { class: 'row wrap', style: 'gap:8px' }, el('button', { class: 'btn small primary', onclick: () => famPersonEditor(s, null, (np) => { if (np) { people.push(np); savePeople(); } }) }, icon('plus', 14), T('Add someone')),
        s.suggest.length ? el('div', { class: 'chips' }, s.suggest.slice(0, 6).map((x) => el('button', { class: 'chip', onclick: () => { people.push({ name: x.name, color: s.colors[people.length % s.colors.length], icon: 'star', goal: 0, reward: '' }); savePeople(); } }, `+ ${x.name}`))) : null) : null,
      s.suggest.length && canEdit ? el('p', { class: 'tiny faint' }, T('Suggested from the people who sign in and the people Home Assistant tracks.')) : null);
    const week = el('div', { class: 'card hh-card' }, el('h2', {}, icon('star', 16), T('Stars and the week')),
      el('div', { class: 'hh-set' }, el('span', { class: 'lbl' }, T('The week starts on')), el('div', { class: 'seg' }, [[0, famDayName('2026-10-18')], [1, famDayName('2026-10-19')]].map(([k, l]) => el('button', { class: s.weekStart === k ? 'on' : '', disabled: canEdit ? null : true, onclick: async () => { if (await famDo('/api/family/settings', { weekStart: k }, 'PUT', T('Saved'))) draw(); } }, l)))),
      el('p', { class: 'hh-note' }, T('Stars start again from zero that morning, and the meal plan\'s week starts that day too. Last week\'s stars stay visible for a week.')),
      el('div', { class: 'row wrap', style: 'gap:8px;margin-top:12px' }, el('a', { class: 'btn small', href: '#family/chores' }, T('Chores')), el('a', { class: 'btn small', href: '#family/routines' }, T('Routines')), el('a', { class: 'btn small', href: '#family/meals' }, T('Meals'))));
    const lists = el('div', { class: 'card hh-card' }, el('h2', {}, icon('cart', 16), T('Lists')),
      el('p', { class: 'small muted', style: 'margin-top:0' }, T('Shopping and to-do lists for everyone. Lists from Home Assistant stay in sync both ways.')),
      s.haLists.length ? el('div', { class: 'hh-sug' }, el('b', { class: 'small' }, T('Found in Home Assistant')), ...s.haLists.map((x) => el('div', { class: 'hh-sugrow' }, icon('list', 18), el('div', { class: 'grow', style: 'min-width:0' }, el('div', { class: 'ellipsis' }, x.name), el('div', { class: 'tiny muted' }, T('{n} to do', { n: x.open }))),
        canEdit ? el('button', { class: 'btn small', onclick: async () => { if (await famDo('/api/family/lists', { name: x.name, icon: /shop|grocer/i.test(x.name) ? 'cart' : 'list', source: 'ha', entity: x.entity }, 'POST', T('Added'))) draw(); } }, icon('plus', 14), T('Add')) : null))) : el('p', { class: 'hh-note' }, s.ha ? T('Every Home Assistant to-do list is already here.') : T('With Home Assistant connected, its to-do lists show up here to add.')),
      el('a', { class: 'btn small', href: '#family/lists', style: 'margin-top:10px' }, T('Open Lists')),
      s.demo ? el('p', { class: 'tiny muted' }, T('This is the demo: the family is a sample, and changes are kept only until it restarts.')) : null);
    famPut(host, fam1, week, lists);
  };
  await draw();
  return [host];
}
function famPersonEditor(s, p, done) {
  const v = { name: p?.name || '', color: p?.color || s.colors[(s.people.length) % s.colors.length], icon: p?.icon || 'star', goal: p?.goal || 0, reward: p?.reward || '' };
  const box = el('div');
  const draw = () => {
    const name = el('input', { value: v.name, maxlength: 24, placeholder: T('Name'), oninput: (e) => { v.name = e.target.value; } });
    famPut(box, el('div', { class: 'row', style: 'gap:12px;margin-bottom:8px' }, famAvatar(v, 'lg'), el('label', { class: 'field grow', style: 'margin:0' }, el('span', {}, T('Name')), name)),
      el('div', { class: 'field' }, el('span', { class: 'small muted' }, T('Color')), el('div', { class: 'fam-colors' }, s.colors.map((c) => el('button', { type: 'button', class: c === v.color ? 'on' : '', style: `background:${c}`, 'aria-label': c, onclick: () => { v.color = c; draw(); } })))),
      el('label', { class: 'field' }, el('span', {}, T('Weekly star goal (0 for none)')), el('input', { type: 'number', min: 0, max: 500, value: v.goal, style: 'max-width:120px', oninput: (e) => { v.goal = Number(e.target.value) || 0; } })),
      el('label', { class: 'field' }, el('span', {}, T('Reward (optional)')), el('input', { value: v.reward, maxlength: 60, placeholder: T('Movie night pick'), oninput: (e) => { v.reward = e.target.value; } })),
      el('div', { class: 'row', style: 'justify-content:flex-end;gap:8px;margin-top:12px' },
        p ? el('button', { class: 'btn ghost', style: 'margin-right:auto;color:var(--bad)', onclick: () => { if (confirm(T('Remove {name}? Their chores stay, for anyone.', { name: p.name }))) { m.remove(); done(null); } } }, T('Remove')) : null,
        el('button', { class: 'btn ghost', onclick: () => m.remove() }, T('Cancel')),
        el('button', { class: 'btn primary', onclick: () => { if (!v.name.trim()) return toast(T('Give everyone a name.')); m.remove(); done({ ...(p || {}), ...v }); } }, T('Save'))));
    if (!v.name) setTimeout(() => name.focus(), 40);
  };
  draw();
  const m = modal(box, { title: p ? p.name : T('Add someone') });
}
/* Settings › General: your own weather station. */
async function famOutsideCard() {
  const card = el('div', { class: 'card hh-card' });
  const draw = async () => {
    const [s, dv, canEdit] = await Promise.all([api('/api/family/setup').catch(() => null), api('/api/devices').catch(() => ({ devices: [] })), famRole()]);
    if (!s) return famPut(card, );
    const devs = dv.devices || [], o = { ...s.outside };
    const temps = devs.filter((d) => d.tempC != null && d.kind === 'sensor').sort((a, b) => (/outdoor|outside|garden|yard|patio|porch|weather|balcony/i.test(`${b.name} ${b.area}`) - /outdoor|outside|garden|yard|patio|porch|weather|balcony/i.test(`${a.name} ${a.area}`)) || a.name.localeCompare(b.name));
    const rains = devs.filter((d) => /rain|precip/i.test(`${d.id} ${d.name}`) || (d.water != null && /outdoor|outside|roof|garden/i.test(`${d.name} ${d.area}`)) || (d.kind === 'value' && /^(mm|in)(\/h)?$/i.test(d.unit || '')));
    const save = async (patch) => { Object.assign(o, patch); if (await famDo('/api/family/settings', { outside: o }, 'PUT', T('Saved'))) { WCACHE.clear(); draw(); } };
    const cur = (id) => devs.find((d) => d.id === id);
    const sel = (list, val, key, none) => el('select', { disabled: canEdit ? null : true, onchange: (e) => save({ [key]: e.target.value || null }) }, el('option', { value: '' }, none), list.map((d) => el('option', { value: d.id, selected: d.id === val || null }, `${d.name}${d.area ? ` · ${d.area}` : ''}${d.tempC != null ? ` (${tempOf(d.tempC)})` : ''}`)));
    const t = cur(o.temp), r = cur(o.rain);
    famPut(card, el('h2', {}, icon('thermo', 16), T('Outside temperature and rain')),
      el('p', { class: 'small muted', style: 'margin-top:0' }, T('Have your own weather station or an outdoor sensor? Its reading replaces the forecast\'s "now" on the Weather widget, the status bar and the 3D home.')),
      el('div', { class: 'hh-set' }, el('span', { class: 'lbl' }, T('Outside temperature from')), temps.length ? sel(temps, o.temp, 'temp', T('The forecast')) : el('span', { class: 'small muted' }, T('No temperature sensors found yet.'))),
      t ? el('p', { class: 'hh-note' }, T('Now: {t} from {name}', { t: tempOf(t.tempC), name: t.name })) : null,
      el('div', { class: 'hh-set' }, el('span', { class: 'lbl' }, T('Rain from')), rains.length ? sel(rains, o.rain, 'rain', T('The forecast')) : el('span', { class: 'small muted' }, T('No rain sensors found. A rain sensor or rain gauge in Home Assistant, Shelly or YoLink shows up here.'))),
      r ? el('p', { class: 'hh-note' }, famDevState(r) === 'on' || famDevState(r) === 'wet' || Number(r.value) > 0 ? T('Raining now, says {name}', { name: r.name }) : T('Dry now, says {name}', { name: r.name })) : null,
      o.rain ? el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: !!o.rainAlert, disabled: canEdit ? null : true, onchange: (e) => save({ rainAlert: e.target.checked }) }), el('span', {}, T('Tell me when it starts raining (an alert, and on phones with alerts on)'))) : null);
  };
  await draw();
  return card;
}
/* Settings › Look & main bar: the status chips. */
const FAM_COUNT_NAMES = { lights: 'Lights on', doors: 'Doors open', windows: 'Windows open', unlocked: 'Unlocked locks', people: 'Who\'s home', media: 'Music and TV playing', plugs: 'Plugs and switches on' };
async function famChipsCard() {
  const card = el('div', { class: 'card hh-card' });
  const draw = async () => {
    const [s, dv, canEdit] = await Promise.all([api('/api/family/setup').catch(() => null), api('/api/devices').catch(() => ({ devices: [] })), famRole()]);
    if (!s) return famPut(card, );
    const chips = s.chips.map((c) => ({ ...c })), devs = (dv.devices || []).filter((d) => !['camera', 'action'].includes(d.kind)).sort((a, b) => a.name.localeCompare(b.name));
    const save = async () => { if (await famDo('/api/family/settings', { chips }, 'PUT')) { FAM.chipsAt = 0; famChipsLoad(); draw(); } };
    const label = (c) => (c.kind === 'count' ? T(FAM_COUNT_NAMES[c.what]) : c.kind === 'outside' ? T('Outside temperature') : devs.find((d) => d.id === c.id)?.name || c.id);
    const preview = await api('/api/family/chips').catch(() => ({ chips: [] }));
    famPut(card, el('h2', {}, icon('grid', 16), T('Status chips')),
      el('p', { class: 'small muted', style: 'margin-top:0' }, T('Small chips in the status bar across the top (in panel mode, or always - see above): "3 lights on", "Garage open", "18° outside". Counts only show when there\'s something to count.')),
      preview.chips.length ? el('div', { class: 'row wrap', style: 'gap:6px;margin-bottom:10px' }, preview.chips.map((c) => el('span', { class: `hh-c${c.tone === 'warn' ? ' hot' : ''}` }, icon(c.icon || 'dotc'), el('span', {}, TM(c.text, c.msg, c.vars))))) : null,
      el('div', { class: 'hh-list' }, chips.map((c, i) => el('div', { class: 'hh-item', style: 'cursor:default' }, icon(c.kind === 'count' ? 'grid' : c.kind === 'outside' ? 'thermo' : 'plug', 18), el('div', { class: 'grow ellipsis' }, label(c)),
        c.kind === 'device' && canEdit ? el('select', { style: 'width:auto;flex:none;max-width:140px;padding-right:24px', 'aria-label': T('When'), onchange: (e) => { c.when = e.target.value; save(); } }, el('option', { value: 'always', selected: c.when !== 'active' || null }, T('Always')), el('option', { value: 'active', selected: c.when === 'active' || null }, T('Only when on or open'))) : null,
        canEdit ? el('button', { class: 'btn small ghost', 'aria-label': T('Move up'), disabled: i === 0 || null, onclick: () => { [chips[i - 1], chips[i]] = [chips[i], chips[i - 1]]; save(); } }, '↑') : null,
        canEdit ? el('button', { class: 'btn small ghost', 'aria-label': T('Remove'), onclick: () => { chips.splice(i, 1); save(); } }, icon('x', 14)) : null))),
      canEdit && chips.length < 10 ? el('div', { class: 'chips', style: 'margin-top:8px' },
        Object.keys(FAM_COUNT_NAMES).filter((k) => !chips.some((c) => c.kind === 'count' && c.what === k)).map((k) => el('button', { class: 'chip', onclick: () => { chips.push({ kind: 'count', what: k }); save(); } }, `+ ${T(FAM_COUNT_NAMES[k])}`)),
        !chips.some((c) => c.kind === 'outside') ? el('button', { class: 'chip', onclick: () => { chips.push({ kind: 'outside' }); save(); } }, `+ ${T('Outside temperature')}`) : null) : null,
      canEdit && chips.length < 10 ? el('select', { style: 'margin-top:10px', 'aria-label': T('Add a device'), onchange: (e) => { if (e.target.value) { chips.push({ kind: 'device', id: e.target.value, when: 'always' }); save(); } } }, el('option', { value: '' }, T('+ Add a device…')), devs.slice(0, 1500).map((d) => el('option', { value: d.id }, `${d.name}${d.area ? ` · ${d.area}` : ''}`))) : null);
  };
  await draw();
  return card;
}
