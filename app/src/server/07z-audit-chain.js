/* ======================================================================
 * The activity log, tamper-evident (audit.log, written by audit() in 08-signin.js).
 *
 * Every line carries "ch": an HMAC-SHA256 of the line before's ch and this line, with a key only this CasaTorch has
 * (audit-key.json, sealed with the secret key - a new secret key seals it again). So a line changed, taken out or
 * slipped in breaks the chain from there on, and only CasaTorch could have written a chain that checks out. Trimming
 * the oldest lines (a year, 5,000 events) is fine: the chain is checked from the oldest line kept. Lines from before
 * this (no ch) are counted as older, never as broken - unless they turn up after the chain began.
 * The JSON export (Settings › People & sign-in › Activity) is signed (Ed25519, this CasaTorch's own audit key) with the
 * public key in the file: anyone can check later that it wasn't edited after it was downloaded.
 * ====================================================================== */
const AUDIT_KEY_FILE = path.join(DATA_DIR, 'audit-key.json');
let auditKeys = null;   // { mac: Buffer, priv: KeyObject, pub: base64 }
function auditKeysGet() {
  if (auditKeys) return auditKeys;
  let j = null; try { j = JSON.parse(fs.readFileSync(AUDIT_KEY_FILE, 'utf8')); } catch { /* first time */ }
  let mac = j?.mac ? unseal(j.mac, 'audit.mac') : null, priv = j?.sig ? unseal(j.sig, 'audit.sig') : null;
  const fresh = !mac || !priv;
  if (fresh) {   // the first time, or the secret key changed underneath (a new chain starts; the old one is reported as such)
    const kp = crypto.generateKeyPairSync('ed25519');
    mac = crypto.randomBytes(32).toString('base64'); priv = kp.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
    if (!isDemo0()) { try { writeFileSafe(AUDIT_KEY_FILE, JSON.stringify({ mac: seal(mac, 'audit.mac'), sig: seal(priv, 'audit.sig'), pub: kp.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64'), at: new Date().toISOString() }), 0o600); } catch { /* a read-only data folder: in memory for now */ } }
  }
  const key = crypto.createPrivateKey({ key: Buffer.from(priv, 'base64'), format: 'der', type: 'pkcs8' });
  auditKeys = { mac: Buffer.from(mac, 'base64'), priv: key, pub: crypto.createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64') };
  // A new key while the log already has a chain (the secret key was lost and made again): say so in the log, and start
  // the chain again from that line - the lines before it are then "older", not "changed".
  // Only then: an ordinary start goes on with the same chain, so lines cut off the end before a restart still show.
  if (j && fresh && !isDemo0()) {
    try {
      const body = JSON.stringify({ at: new Date().toISOString(), event: 'audit-chain-restart', reason: 'new key' }), ch = auditMac(null, body);
      fs.appendFileSync(AUDIT_FILE, `${body.slice(0, -1)},"ch":"${ch}"}\n`, { mode: 0o600 }); auditHead = ch;
    } catch { /* no log yet */ }
  }
  return auditKeys;
}
const auditMac = (prev, body) => crypto.createHmac('sha256', auditKeysGet().mac).update(`${prev || ''}\n${body}`).digest('base64url');
let auditHead;   // the last line's ch (undefined: not read yet)
function auditLastCh() {
  if (auditHead !== undefined) return auditHead;
  auditHead = null;
  try {
    const st = fs.statSync(AUDIT_FILE), len = Math.min(st.size, 64 * 1024), buf = Buffer.alloc(len), fd = fs.openSync(AUDIT_FILE, 'r');
    try { fs.readSync(fd, buf, 0, len, st.size - len); } finally { fs.closeSync(fd); }
    const last = buf.toString('utf8').trim().split('\n').pop(); auditHead = JSON.parse(last).ch || null;
  } catch { /* no log yet */ }
  return auditHead;
}
/** One audit line, chained to the one before. */
function auditChainLine(entry) {
  const { ch: _drop, ...e } = entry, body = JSON.stringify(e);
  let ch = null; try { auditKeysGet(); ch = auditMac(auditLastCh(), body); } catch { /* no key: the line goes in unchained, and the check says so */ }
  if (ch) auditHead = ch;
  return ch ? `${body.slice(0, -1)}${body.length > 2 ? ',' : ''}"ch":"${ch}"}` : body;
}
/** Check a log's lines: { ok, lines, chained, older, brokenAt (1-based line number), headMatches }. Pure but for the key. */
function auditVerify(lines) {
  let prev = null, started = false, chained = 0, older = 0;
  for (let i = 0; i < lines.length; i++) {
    let j; try { j = JSON.parse(lines[i]); } catch { return { ok: false, lines: lines.length, chained, older, brokenAt: i + 1 }; }
    if (!j.ch) { if (started) return { ok: false, lines: lines.length, chained, older, brokenAt: i + 1 }; older++; continue; }
    const { ch, ...e } = j, body = JSON.stringify(e);
    if (e.event === 'audit-chain-restart' && auditMac(null, body) === ch) { older += chained; chained = 0; started = true; prev = ch; chained++; continue; }   // a new key: the chain starts again here
    if (started && auditMac(prev, body) !== ch) return { ok: false, lines: lines.length, chained, older, brokenAt: i + 1 };
    started = true;   // (the oldest chained line kept is the anchor: what came before it may have been trimmed)
    prev = ch; chained++;
  }
  return { ok: true, lines: lines.length, chained, older, brokenAt: null, head: prev };
}
const auditFileLines = () => { try { return fs.readFileSync(AUDIT_FILE, 'utf8').split('\n').filter(Boolean); } catch { return []; } };
let auditCheckMemo = { at: 0, r: null };
function auditCheck(fresh = false) {
  if (!fresh && auditCheckMemo.r && Date.now() - auditCheckMemo.at < 10 * 60_000) return auditCheckMemo.r;
  const lines = auditFileLines(), r = auditVerify(lines);
  if (r.ok && r.chained && auditHead && r.head !== auditHead) Object.assign(r, { ok: false, brokenAt: lines.length, ends: 'early' });   // lines taken off the end while CasaTorch ran
  auditCheckMemo = { at: Date.now(), r };
  return r;
}
/** A signed export: the events, the chain check, and an Ed25519 signature over the rest (with the public key). */
function auditSignedExport(events, meta) {
  const k = auditKeysGet(), body = { ...meta, chain: (({ ok, lines, chained, older, brokenAt }) => ({ ok, lines, chained, older, brokenAt }))(auditCheck(true)), events };
  const text = JSON.stringify(body), sig = crypto.sign(null, Buffer.from(text), k.priv).toString('base64');
  return { ...body, signature: { alg: 'Ed25519', publicKey: k.pub, value: sig, signed: 'this object without "signature", as JSON.stringify writes it' } };
}
/** Health: the activity log's chain. */
function docAuditLog() {
  if (!isConfigured() || isDemo()) return null;
  const r = auditCheck();
  if (!r.ok) return chk('auditlog', 'safety', 'Activity log', 'bad', ['The activity log was changed outside CasaTorch, from line {n} on.', { n: r.brokenAt }], { why: 'A line was edited, taken out or added by something other than CasaTorch. Download it (Settings › People & sign-in › Activity) and keep the copy; new events are chained again from here.', fix: { action: 'link', href: '#settings/people', label: 'See the activity log' } });
  return chk('auditlog', 'safety', 'Activity log', 'ok', r.chained ? ['Intact: {n} events, each sealed to the one before.', { n: r.chained }] : 'Intact.');
}
