/* ======================================================================
 * Device controls, shared by the dashboard and the 3D Home: one place that
 * knows how to show and change every kind of device - lights (brightness,
 * color, warmth), plugs, fans (speed), media (play, skip, volume),
 * thermostats (target, mode), blinds (open, close, position), locks (lock
 * only), alarms (arm only), vacuums and scenes.
 *
 * The safety rule is the server's (30-devices.js): CasaTorch never unlocks,
 * opens a garage door or gate, or disarms an alarm. The buttons for those are
 * simply not offered, and a short note says where to do it instead.
 *
 * Use: CasaControls.build(device, { act(action, value), units: 'F' | 'C', compact })
 * returns DOM nodes. act() sends the change; the caller refreshes afterwards.
 * ====================================================================== */
(() => {
  const h = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  };
  const tr = (s, v) => (window.T ? window.T(s, v) : String(s).split('|')[0]);   // the home's language (i18n.js), English otherwise
  const SWATCHES = ['#ffc477', '#fff4e0', '#ff6b6b', '#f59e0b', '#fde047', '#4ade80', '#38bdf8', '#818cf8', '#e879f9', '#f472b6'];
  const MODE_NAMES = { off: 'Off|mode', heat: 'Heat', cool: 'Cool|mode', auto: 'Auto', heat_cool: 'Heat/Cool', dry: 'Dry', fan_only: 'Fan' };
  const pretty = (s) => String(s ?? '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  const allowed = (d, action) => !Array.isArray(d.guarded) || d.guarded.includes(action);
  /* What a device can do: what its integration says (d.can), or a fair guess from what it reports. */
  const can = (d, x) => (Array.isArray(d.can) ? d.can.includes(x) : ({
    brightness: d.kind === 'light' && d.brightness != null, color: d.kind === 'light' && d.rgb != null, kelvin: d.kind === 'light' && d.kelvin != null,
    percent: d.kind === 'fan' && d.percent != null, volume: d.kind === 'media' && d.volume != null, next: d.kind === 'media', prev: false,
    target: d.kind === 'climate' && d.targetC != null, mode: d.kind === 'climate' && Array.isArray(d.modes) && d.modes.length > 0, position: d.kind === 'cover' && d.position != null && !d.risky,
    arm_home: d.kind === 'alarm', arm_away: d.kind === 'alarm', arm_night: false,
  })[x] ?? false);

  function slider({ label, min, max, step = 1, value, fmt = (v) => `${v}%`, onset, cls = '' }) {
    const out = h('span', { class: 'dc-val' }, fmt(value));
    const input = h('input', { type: 'range', min, max, step, value, class: `dc-range ${cls}`, 'aria-label': label,
      oninput: (e) => { out.textContent = fmt(Number(e.target.value)); }, onchange: (e) => onset(Number(e.target.value)) });
    return h('label', { class: 'dc-slider' }, h('span', { class: 'dc-lab' }, tr(label), out), input);
  }
  const toggle = (on, onflip, label) => h('label', { class: 'dc-switch', title: label }, h('input', { type: 'checkbox', checked: on ? true : null, 'aria-label': label, onchange: onflip }), h('span'));
  const btn = (text, onclick, kind = '') => h('button', { type: 'button', class: `dc-btn ${kind}`, onclick }, tr(text));
  const note = (t) => h('p', { class: 'dc-note' }, tr(t));
  const stat = (label, value) => h('div', { class: 'dc-stat' }, h('b', {}, value), h('small', {}, tr(label)));
  const fmtW = (w) => (w >= 1000 ? `${(w / 1000).toFixed(w >= 10000 ? 0 : 1)} kW` : `${Math.round(w)} W`);

  function build(d, opts) {
    const { act, units = 'F' } = opts, out = [];
    const tC = (c) => (c == null ? '-' : units === 'C' ? `${(Math.round(c * 2) / 2).toFixed(1).replace(/\.0$/, '')}°` : `${Math.round(c * 9 / 5 + 32)}°`);
    const head = (text, ctrl) => h('div', { class: 'dc-head' }, h('span', { class: 'dc-state' }, tr(text)), ctrl || null);
    const send = (action, value, patch) => { if (patch) Object.assign(d, patch); act(action, value); };
    if (d.online === false) out.push(note('Not answering right now.'));
    switch (d.kind) {
      case 'light': {
        out.push(head(d.on ? (d.brightness != null ? `${d.brightness}%` : 'On') : 'Off', toggle(d.on, () => send(d.on ? 'off' : 'on', null, { on: !d.on }), 'On or off')));
        if (can(d, 'brightness')) out.push(slider({ label: 'Brightness', min: 1, max: 100, value: d.brightness ?? (d.on ? 100 : 60), onset: (v) => send('brightness', v, { on: true, brightness: v }), cls: 'warm' }));
        if (can(d, 'kelvin')) out.push(slider({ label: 'Warmth', min: d.minK || 2000, max: d.maxK || 6500, step: 100, value: d.kelvin ?? 3000, fmt: (v) => tr(v < 3300 ? 'Warm' : v < 5000 ? 'Neutral' : 'Cool'), onset: (v) => send('kelvin', v, { on: true, kelvin: v, rgb: null }), cls: 'kelvin' }));
        if (can(d, 'color')) {
          const pick = (c) => send('color', c, { on: true, rgb: c });
          out.push(h('div', { class: 'dc-swatches', role: 'group', 'aria-label': tr('Color') }, ...SWATCHES.map((c) => h('button', { type: 'button', class: `dc-sw${d.rgb === c ? ' on' : ''}`, style: `--c:${c}`, title: c, 'aria-label': `Color ${c}`, onclick: () => pick(c) })),
            h('label', { class: 'dc-sw custom', title: tr('Any color') }, h('input', { type: 'color', value: d.rgb || '#ffc477', 'aria-label': tr('Any color'), onchange: (e) => pick(e.target.value) }))));
        }
        break;
      }
      case 'plug': case 'switch': {
        const ok = allowed(d, d.on ? 'off' : 'on');
        out.push(head(d.on ? 'On' : 'Off', ok ? toggle(d.on, () => send(d.on ? 'off' : 'on', null, { on: !d.on }), 'On or off') : null));
        if (d.powerW != null || d.energyKWh != null) out.push(h('div', { class: 'dc-stats' }, d.powerW != null ? stat('using now', d.on === false ? '0 W' : fmtW(d.powerW)) : null, d.energyKWh != null ? stat('today', `${(+d.energyKWh).toFixed(2)} kWh`) : null));
        if (!ok) out.push(note('This looks like a door, gate, lock or alarm control, so CasaTorch leaves it alone. An owner can allow it in Settings › Security.'));
        break;
      }
      case 'fan': {
        out.push(head(d.on ? (d.percent != null ? `${d.percent}%` : 'On') : 'Off', allowed(d, 'on') ? toggle(d.on, () => send(d.on ? 'off' : 'on', null, { on: !d.on }), 'On or off') : null));
        if (can(d, 'percent') && allowed(d, 'percent')) out.push(slider({ label: 'Speed', min: 0, max: 100, step: 5, value: d.percent ?? 50, onset: (v) => send('percent', v, { on: v > 0, percent: v }) }));
        break;
      }
      case 'media': {
        out.push(head(d.playing ? (d.title || 'Playing') : d.on ? 'Paused' : 'Off'));
        out.push(h('div', { class: 'dc-row' }, can(d, 'prev') ? btn('⏮', () => act('prev'), 'icon') : null, btn(d.playing ? 'Pause' : 'Play', () => send('toggle', null, { playing: !d.playing }), 'primary'), can(d, 'next') ? btn('⏭', () => act('next'), 'icon') : null));
        if (can(d, 'volume')) out.push(slider({ label: 'Volume', min: 0, max: 100, value: Math.round((d.volume ?? 0.3) * 100), onset: (v) => send('volume', v, { volume: v / 100 }) }));
        break;
      }
      case 'climate': {
        out.push(h('div', { class: 'dc-climate' }, h('div', {}, h('small', {}, tr('Now')), h('b', {}, tC(d.tempC))), d.humidity != null ? h('div', {}, h('small', {}, tr('Humidity')), h('b', {}, `${Math.round(d.humidity)}%`)) : null, h('div', {}, h('small', {}, tr('Mode')), h('b', {}, MODE_NAMES[d.mode] ? tr(MODE_NAMES[d.mode]) : pretty(d.mode)))));
        if (can(d, 'target') && d.targetC != null && d.mode !== 'off') {
          const stepC = units === 'C' ? (d.stepC || 0.5) : 5 / 9, lo = d.minC ?? 5, hi = d.maxC ?? 35;
          const nudge = (k) => { const v = Math.max(lo, Math.min(hi, d.targetC + k * stepC)); const r = units === 'C' ? Math.round(v * 2) / 2 : Math.round((Math.round(v * 9 / 5 + 32) - 32) * 5 / 9 * 100) / 100; send('target', r, { targetC: r }); };
          out.push(h('div', { class: 'dc-target' }, btn('−', () => nudge(-1), 'round'), h('div', {}, h('small', {}, tr('Set to')), h('b', {}, tC(d.targetC))), btn('+', () => nudge(1), 'round')));
        }
        if (can(d, 'mode') && d.modes?.length) out.push(h('div', { class: 'dc-chips', role: 'group', 'aria-label': tr('Mode') }, ...d.modes.map((m) => h('button', { type: 'button', class: `dc-chip${m === d.mode ? ' on' : ''}`, onclick: () => send('mode', m, { mode: m }) }, MODE_NAMES[m] ? tr(MODE_NAMES[m]) : pretty(m)))));
        break;
      }
      case 'cover': {
        const canOpen = allowed(d, 'open') && !d.risky;
        out.push(head(d.open ? (d.position != null ? `${tr('Open|state')} · ${d.position}%` : 'Open|state') : (d.state && d.state !== 'closed' ? pretty(d.state) : 'Closed')));
        out.push(h('div', { class: 'dc-row' }, canOpen ? btn('Open', () => send('open', null, { open: true })) : null, btn('Stop', () => act('stop')), btn('Close', () => send('close', null, { open: false }), 'primary')));
        if (canOpen && can(d, 'position') && allowed(d, 'position')) out.push(slider({ label: 'Position', min: 0, max: 100, step: 5, value: d.position ?? 0, fmt: (v) => (v === 0 ? tr('Closed') : v === 100 ? tr('Open|state') : `${v}%`), onset: (v) => send('position', v, { position: v, open: v > 0 }) }));
        if (!canOpen) out.push(note('Garage doors, gates and doors only close from CasaTorch. Open them in their own app or Home Assistant.'));
        break;
      }
      case 'lock': {
        out.push(head(d.locked ? 'Locked' : d.locked === false ? 'Unlocked' : pretty(d.state)));
        if (d.locked === false) out.push(h('div', { class: 'dc-row' }, btn('Lock', () => send('lock', null, { locked: true }), 'primary')));
        out.push(note('CasaTorch can lock, never unlock. Unlock with the lock\'s own app or keypad.'));
        break;
      }
      case 'alarm': {
        out.push(head(d.triggered ? 'Triggered!' : d.armed ? pretty(d.state) : 'Disarmed'));
        const arms = [['arm_home', 'Arm home'], ['arm_away', 'Arm away'], ['arm_night', 'Arm night']].filter(([a]) => can(d, a) && allowed(d, a));
        if (!d.armed && arms.length) out.push(h('div', { class: 'dc-row' }, ...arms.map(([a, t]) => btn(t, () => send(a, null, { armed: true, state: `armed_${a.slice(4)}` })))));
        out.push(note('CasaTorch can arm the alarm, never disarm it. Disarm with your keypad or the alarm\'s app.'));
        break;
      }
      case 'vacuum':
        out.push(head(pretty(d.state)), h('div', { class: 'dc-row' }, btn('Start', () => act('start'), 'primary'), btn('Stop', () => act('stop')), btn('Send home', () => act('dock'))));
        break;
      case 'action':
        out.push(h('div', { class: 'dc-row' }, allowed(d, 'run') ? btn(d.domain === 'scene' ? 'Turn on scene' : 'Run', () => act('run'), 'primary') : note('CasaTorch leaves this one alone for safety.')));
        break;
      case 'presence':
        out.push(head(d.home ? 'Home|house' : 'Away'));
        break;
      default: {
        const vals = [['tempC', 'Temperature', tC], ['humidity', 'Humidity', (v) => `${Math.round(v)}%`], ['co2', 'CO₂', (v) => `${Math.round(v)} ppm`], ['powerW', 'Power', fmtW], ['battery', 'Battery', (v) => `${Math.round(v)}%`]].filter(([k]) => d[k] != null);
        const main = d.water ? 'Water detected!' : d.smoke ? 'Smoke!' : d.open != null ? (d.open ? 'Open|state' : 'Closed') : d.motion != null ? (d.motion ? 'Motion' : 'Clear') : d.value != null ? `${d.value}${d.unit ? ` ${d.unit}` : ''}` : vals.length ? null : pretty(d.state);
        if (main) out.push(head(main));
        if (vals.length) out.push(h('div', { class: 'dc-stats' }, ...vals.map(([k, l, f]) => stat(l, f(d[k])))));
      }
    }
    return out;
  }

  /* Styles, once per page. Colors come from the page: the dashboard's --accent or the 3D Home's --hl. */
  const css = `
.dc-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:2px 0 8px}.dc-state{font-size:20px;font-weight:650;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dc-switch{position:relative;width:46px;height:26px;flex:none;cursor:pointer}.dc-switch input{position:absolute;opacity:0;inset:0;margin:0;cursor:pointer}
.dc-switch span{position:absolute;inset:0;border-radius:99px;background:color-mix(in srgb,var(--text) 18%,transparent);transition:background .2s}.dc-switch span::after{content:"";position:absolute;left:3px;top:3px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #0005;transition:transform .2s}
.dc-switch input:checked+span{background:var(--accent,var(--hl))}.dc-switch input:checked+span::after{transform:translateX(20px)}.dc-switch input:focus-visible+span{outline:2px solid var(--accent,var(--hl));outline-offset:2px}
.dc-slider{display:block;margin:10px 0 4px}.dc-lab{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:4px}.dc-val{color:var(--text);font-variant-numeric:tabular-nums}
.dc-range{width:100%;accent-color:var(--accent,var(--hl));height:22px;margin:0}.dc-range.kelvin{accent-color:#f5c27a}
.dc-swatches{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 2px}.dc-sw{width:24px;height:24px;border-radius:50%;border:2px solid color-mix(in srgb,var(--text) 15%,transparent);background:var(--c);cursor:pointer;padding:0;position:relative}
.dc-sw.on{box-shadow:0 0 0 2px var(--accent,var(--hl))}.dc-sw.custom{background:conic-gradient(#f87171,#fbbf24,#4ade80,#38bdf8,#a78bfa,#f472b6,#f87171);overflow:hidden}.dc-sw.custom input{opacity:0;position:absolute;inset:0;width:100%;height:100%;cursor:pointer}
.dc-row{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 2px}.dc-btn{flex:1 1 auto;min-height:36px;padding:7px 12px;border-radius:11px;border:1px solid var(--line);background:color-mix(in srgb,var(--text) 6%,transparent);color:var(--text);font:inherit;font-size:14px;font-weight:550;cursor:pointer}
.dc-btn:hover{background:color-mix(in srgb,var(--text) 11%,transparent)}.dc-btn.primary{background:var(--accent,var(--hl));color:var(--on-accent,var(--hl-ink,#06101e));border-color:transparent}.dc-btn.icon{flex:0 0 44px}
.dc-btn.round{flex:0 0 44px;height:44px;border-radius:50%;font-size:22px;line-height:1;padding:0}
.dc-climate{display:grid;grid-template-columns:repeat(auto-fit,minmax(80px,1fr));gap:6px;margin:2px 0 8px}.dc-climate small,.dc-target small,.dc-stat small{display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}.dc-climate b{font-size:17px}
.dc-target{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px;border-radius:14px;background:color-mix(in srgb,var(--text) 5%,transparent);text-align:center;margin:6px 0}.dc-target b{font-size:26px;font-variant-numeric:tabular-nums}
.dc-chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 2px}.dc-chip{border:1px solid var(--line);background:none;color:var(--text);border-radius:99px;padding:4px 11px;font:inherit;font-size:13px;cursor:pointer}.dc-chip.on{background:var(--accent,var(--hl));color:var(--on-accent,var(--hl-ink,#06101e));border-color:transparent}
.dc-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(80px,1fr));gap:8px;margin:6px 0 2px}.dc-stat b{font-size:16px;font-variant-numeric:tabular-nums}
.dc-note{font-size:12px;color:var(--muted);margin:8px 0 0;line-height:1.45}`;
  const style = document.createElement('style'); style.textContent = css; document.head.append(style);
  window.CasaControls = { build, can, allowed };
})();
