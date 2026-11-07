/* ======================================================================
 * Settings › Alerts › Which alerts: every alert CasaTorch can raise, in
 * groups, each with a switch, one line saying what it is, "how important"
 * and its own thresholds where they make sense. Saves at once (the switch
 * moves first; a failed save puts it back and says why). Owners and admins
 * change it; everyone else sees it. The server decides: 40a-alert-types.js.
 * ====================================================================== */
const AT_LEVEL_LABEL = { critical: 'Urgent', warning: 'Important', notice: 'Info' };
/* Temperatures are kept in °C; a home in °F sees and types °F. */
const atToShow = (n, unit, F) => (unit === '°C' && F ? Math.round(n * 9 / 5 + 32) : n);
const atFromShow = (v, unit, F) => (unit === '°C' && F ? Math.round((v - 32) * 5 / 9 * 10) / 10 : v);
const atUnit = (unit, F) => (unit === '°C' ? (F ? '°F' : '°C') : unit === '% free' ? T('% free') : unit === 'min' ? T('min') : unit);

async function alertTypesCard() {
  const card = el('div', { class: 'card ar-card at-card' });
  let d;
  try { d = await api('/api/alerts/types'); } catch (e) { card.append(el('p', { class: 'muted' }, e.message)); return card; }
  const F = d.units !== 'C';
  /** Save one change; on failure put the page back as it was. */
  const save = async (body, undo) => {
    try { d = await post('/api/alerts/types', body, 'PUT'); toast(T('Saved')); return true; }
    catch (err) { undo?.(); toast(err.message, 5000); return false; }
  };
  const row = (x) => {
    const ro = !d.admin;
    const extra = el('div', { class: 'at-extra' });
    const paintExtra = () => {
      extra.hidden = !x.on;
      extra.replaceChildren(...[
        ...(x.nums || []).map((n) => {
          const inp = el('input', { type: 'number', inputmode: 'decimal', class: 'at-n', value: String(atToShow(n.value, n.unit, F)), min: String(atToShow(n.min, n.unit, F)), max: String(atToShow(n.max, n.unit, F)), step: '1', disabled: ro ? true : null, 'aria-label': `${T(x.label)}: ${T(n.label)}` });
          inp.onchange = async () => {
            const was = n.value, v = atFromShow(Number(inp.value), n.unit, F);
            if (inp.value === '' || !Number.isFinite(v)) { inp.value = String(atToShow(was, n.unit, F)); return; }
            n.value = v;
            await save({ id: x.id, nums: { [n.key]: v } }, () => { n.value = was; inp.value = String(atToShow(was, n.unit, F)); });
          };
          return el('label', { class: 'at-num' }, el('span', {}, T(n.label)), inp, el('span', { class: 'muted' }, atUnit(n.unit, F)));
        }),
        x.level ? el('label', { class: 'at-num' }, el('span', {}, T('How important')), arSelect(x.level, d.levels.map((l) => [l, T(AT_LEVEL_LABEL[l])]), async (v) => {
          const was = x.level; x.level = v;
          await save({ id: x.id, level: v }, () => { x.level = was; paintExtra(); });
        }, `${T(x.label)}: ${T('How important')}`)) : null].filter(Boolean));
      if (ro) for (const s of extra.querySelectorAll('select')) s.disabled = true;
      if (!extra.childElementCount) extra.hidden = true;
    };
    const sw = arSwitch(x.on, async (e) => {
      const on = e.target.checked, input = e.target;
      if (!on && x.safety && !confirm(T('{name} is a safety alert. Turn it off? You could miss a leak, smoke or a freezing pipe.', { name: T(x.label) }))) { input.checked = true; return; }
      x.on = on; paintExtra();
      await save({ id: x.id, on, ...(x.safety && !on ? { confirm: true } : {}) }, () => { x.on = !on; input.checked = !on; paintExtra(); });
    }, { label: T(x.label), disabled: ro || x.locked, title: x.locked ? T('Always on') : null });
    paintExtra();
    return el('div', { class: 'at-row' },
      el('div', { class: 'grow', style: 'min-width:0' },
        el('div', { class: 'at-name' }, el('b', {}, T(x.label)), x.safety ? el('span', { class: 'pill ar-safe' }, T('Safety')) : null, x.pro && !d.pro ? el('span', { class: 'pill pro' }, 'Pro') : null),
        el('div', { class: 'tiny muted' }, T(x.desc)), extra),
      sw);
  };
  card.append(el('p', { class: 'small muted', style: 'margin-top:0' }, d.admin ? T('Turn each alert on or off. Changes save right away.') : T('Only an owner or admin can change these.')),
    ...d.groups.flatMap((g) => {
      const list = d.types.filter((x) => x.group === g.id);
      return list.length ? [el('h3', { class: 'sub' }, T(g.label)), el('div', { class: 'at-list' }, list.map(row))] : [];
    }));
  return card;
}
