/* ======================================================================
 * Bonjour / mDNS: CasaTorch tells the home network it's here, as
 * "_casatorch._tcp" (port, and TXT id + version), so the phone apps' Find
 * sees it straight away, without casatorch.com. Only the random install id
 * and the version are announced (both are on /api/app/hello already) - never
 * the house's name. Link-local only (multicast, never routed). Off with
 * CASATORCH_MDNS=0, in the demo, and in tests. A network that has no
 * multicast just means no answers: it never stops CasaTorch.
 * ====================================================================== */
import multicastDns from 'multicast-dns';
const BONJOUR_TYPE = '_casatorch._tcp.local';
const BONJOUR = { on: false, error: null };
function bonjourRecords() {
  const id = installId(), tag = crypto.createHash('sha256').update(id).digest('hex').slice(0, 6);
  const inst = `CasaTorch-${tag}.${BONJOUR_TYPE}`, host = `casatorch-${tag}.local`;
  const ips = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal && isLanHost(a.address)).map((a) => a.address);
  return {
    inst, host,
    ptr: { name: BONJOUR_TYPE, type: 'PTR', ttl: 4500, data: inst },
    srv: { name: inst, type: 'SRV', ttl: 120, flush: true, data: { priority: 0, weight: 0, port: PORT, target: host } },
    txt: { name: inst, type: 'TXT', ttl: 4500, flush: true, data: [`id=${id}`, `version=${VERSION}`] },
    a: [...new Set(ips)].map((ip) => ({ name: host, type: 'A', ttl: 120, flush: true, data: ip })),
  };
}
function bonjourStart() {
  if (process.env.CASATORCH_TEST === '1' || process.env.CASATORCH_MDNS === '0' || isDemo()) return;
  let m;
  try { m = multicastDns({ reuseAddr: true, loopback: true }); } catch (e) { BONJOUR.error = e.message; return; }
  const stop = (e) => { BONJOUR.on = false; BONJOUR.error = String(e?.code || e?.message || e).slice(0, 80); try { m.destroy(); } catch { /* closed */ } };
  m.on('error', stop);
  m.on('warning', () => { /* a malformed packet from someone else: ignore */ });
  m.on('ready', () => { BONJOUR.on = true; });
  const last = new Map();   // name|type -> when we last answered (at most once a second each)
  const send = (key, packet) => {
    const now = Date.now(); if (now - (last.get(key) || 0) < 1000) return; last.set(key, now);
    if (packet.answers.length) try { m.respond(packet); } catch { /* not sent: they'll ask again */ }
  };
  m.on('query', (q) => {
    let r; try { r = bonjourRecords(); } catch { return; }
    for (const qq of q.questions || []) {
      const n = String(qq.name || '').toLowerCase(), t = qq.type, any = t === 'ANY';
      if (n === BONJOUR_TYPE && (t === 'PTR' || any)) send(`ptr`, { answers: [r.ptr], additionals: [r.srv, r.txt, ...r.a] });
      else if (n === '_services._dns-sd._udp.local' && (t === 'PTR' || any)) send('svc', { answers: [{ name: n, type: 'PTR', ttl: 4500, data: BONJOUR_TYPE }] });
      else if (n === r.inst.toLowerCase() && (t === 'SRV' || t === 'TXT' || any)) send(`inst|${t}`, { answers: t === 'TXT' ? [r.txt] : t === 'SRV' ? [r.srv] : [r.srv, r.txt], additionals: r.a });
      else if (n === r.host && (t === 'A' || any)) send(`a|${t}`, { answers: r.a });
    }
  });
  // Say hello when starting (twice, a second apart, as RFC 6762 suggests), so a phone already looking sees it at once.
  const announce = () => { try { const r = bonjourRecords(); if (r.a.length) m.respond({ answers: [r.ptr, r.srv, r.txt, ...r.a] }); } catch { /* next time */ } };
  setTimeout(announce, 1000).unref?.(); setTimeout(announce, 2000).unref?.();
}
bonjourStart();
