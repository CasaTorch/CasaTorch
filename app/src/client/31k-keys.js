/* ======================================================================
 * Settings › Health › Secret key: where the key that seals every saved password is kept, and (owner) a new key
 * (09k-keys.js on the server).
 * ====================================================================== */
async function keyCard(me) {
  let k; try { k = await api('/api/security/key'); } catch { return null; }
  const owner = !me || me.signIn === false || me.user?.role === 'owner';
  const where = k.kind === 'systemd' && k.tpm ? T('systemd credentials, sealed with this computer\'s TPM2 chip') : T(k.name);
  const card = el('div', { class: 'card' }, el('h2', {}, icon('lock', 15), T('Secret key')),
    el('p', { class: 'small muted', style: 'margin-top:0' }, T('Every saved password, token and private key on this CasaTorch is sealed (AES-256-GCM) with one secret key that never leaves it.')),
    el('dl', { class: 'kv' }, el('dt', {}, T('Kept in')), el('dd', {}, where),
      el('dt', {}, T('Last new key')), el('dd', {}, k.rotatedAt ? fmtWhen(k.rotatedAt) : T('Never'))),
    k.locked ? el('p', { class: 'small', style: 'color:var(--bad)' }, T('The key store didn\'t open your secret key, so CasaTorch made a new one: saved passwords and keys need entering again. The old key is kept and is put back by itself if the key store opens it again.')) : null);
  if (owner && !k.demo) {
    const btn = el('button', { class: 'btn' }, icon('reset', 14), T('Make a new secret key…'));
    btn.onclick = () => newKeyModal(me, k);
    card.append(el('div', { class: 'row wrap', style: 'margin-top:10px' }, btn));
  }
  return card;
}
function newKeyModal(me, k) {
  const pw = el('input', { type: 'password', autocomplete: 'current-password', placeholder: T('Your CasaTorch password') });
  const code = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: T('6-digit code or a recovery code') });
  const msg = el('p', { class: 'small', style: 'min-height:1.2em;color:var(--bad)', role: 'alert' });
  const go = el('button', { class: 'btn primary' }, T('Make a new key'));
  go.onclick = async () => {
    go.disabled = true; msg.textContent = '';
    try {
      const r = await post('/api/security/key/rotate', { password: pw.value, code: code.value });
      $('#modal')?.remove(); toast(T(r.message || 'Done'), 6000);
      if (r.restarting) setTimeout(() => location.reload(), 9000);
    } catch (e) { msg.textContent = e.message; go.disabled = false; }
  };
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
  modal(el('div', {},
    el('p', { class: 'small muted', style: 'margin-top:0' }, T('CasaTorch makes a new secret key, restarts, and seals every saved password, token and private key again with it. Nothing needs entering again. Backup files made before keep working with their passphrase; make a new backup afterwards.')),
    k.restarts ? null : el('p', { class: 'small' }, T('This copy was started by hand: the new key is used the next time you start it.')),
    el('label', { class: 'field' }, el('span', {}, T('Your password')), pw),
    el('label', { class: 'field' }, el('span', {}, T('Two-step code (if it\'s on)')), code),
    msg, el('div', { class: 'row wrap' }, go, el('button', { class: 'btn ghost', onclick: () => $('#modal')?.remove() }, T('Cancel')))), { title: T('New secret key') });
  setTimeout(() => pw.focus(), 50);
}
