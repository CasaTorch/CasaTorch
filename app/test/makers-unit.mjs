/* "Who is it?" in the Security Center (44m-makers.js): makers from the IEEE prefix list, the likely kind of device,
   which open ports are normal for it, and the NetBIOS/UPnP name readers. Made-up devices: real public maker
   prefixes (company data), invented second halves, 192.168.1.x addresses. Loaded by unit.mjs after the server. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export default async function makersUnit(t) {
  const M = globalThis.__casatorchMakers, H = globalThis.__casatorch;
  if (!M) { console.log('skip makers-unit (no __casatorchMakers)'); return; }
  const dev = (mac, ports = [], extra = {}) => ({ mac, ip: '192.168.1.44', ports, privateMac: /^.[26ae]/.test(mac), ...extra });   // scrub-ok: sample address

  t('makers: the shipped IEEE list is small, complete enough, and read by prefix', () => {
    const f = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'catalog', 'oui.txt.gz');
    assert.ok(fs.statSync(f).size < 600 * 1024, 'catalog file stays under 600 KB');
    assert.equal(M.ouiName('00:06:78:00:00:07'), 'D&M Holdings');   // scrub-ok: public prefix, made-up device
    assert.equal(M.ouiName('6C:1F:F7:00:00:08'), 'Ugreen Group');   // scrub-ok
    assert.equal(M.ouiName('9a:1e:4c:00:00:0b'), null, 'a private (made-up) address says nothing about the maker');   // scrub-ok
    assert.equal(M.ouiName('not a mac'), null);
    assert.equal(M.makerOf('00:06:78:00:00:07').name, 'Denon/Marantz (D&M)');   // scrub-ok
    assert.equal(M.makerOf('6c:1f:f7:00:00:08').name, 'Ugreen');   // scrub-ok
    assert.match(M.makerOf('08:a6:f7:00:00:0a').note, /Wi-Fi chip/, 'chip makers explain the device may carry another brand');   // scrub-ok
  });

  t('makers: a Denon/Marantz receiver answering on Telnet is information, not a warning', () => {
    const d = dev('00:06:78:00:00:07', [23]), g = M.deviceGuess(d);   // scrub-ok
    assert.equal(g.type, 'receiver'); assert.ok(g.sure);
    const p = M.portView(23, g, d);
    assert.equal(p.level, 'info'); assert.match(p.how, /how this receiver is controlled/); assert.match(p.how, /Home Assistant/);
    assert.equal(H.portInfo(23, d).level, 'info', 'the server-wide port check uses the same knowledge');
    assert.equal(H.portInfo(23).level, 'warning', 'without a device it stays a warning');
  });

  t('makers: a Ugreen NAS with file sharing and MQTT is normal; a Synology needs no ports to be a NAS', () => {
    const d = dev('6c:1f:f7:00:00:08', [445, 1883]), g = M.deviceGuess(d);   // scrub-ok
    assert.equal(g.type, 'nas');
    assert.deepEqual([445, 1883].map((p) => M.portView(p, g, d).level), ['info', 'info']);
    assert.equal(M.deviceGuess(dev('00:11:32:aa:00:02')).type, 'nas');   // scrub-ok
    const w = M.whoIsIt(dev('6c:1f:f7:00:00:08'));   // scrub-ok: no ports - two possibilities, not sure
    assert.equal(w.sure, false); assert.deepEqual(w.maker.kinds, ['NAS (network storage)', 'Computer']);
  });

  t('makers: Telnet stays red on an unknown device, a camera or a router; FTP stays red on a NAS', () => {
    const unknown = dev('ac:de:48:00:00:01', [23]);   // scrub-ok: IEEE "Private" block - no maker
    assert.equal(M.ouiName(unknown.mac), null);
    const u = M.portView(23, M.deviceGuess(unknown), unknown);
    assert.equal(u.level, 'warning'); assert.match(u.how, /can't identify/);
    const cam = dev('9c:8e:cd:00:00:04', [23, 554]), cg = M.deviceGuess(cam);   // scrub-ok
    assert.equal(cg.type, 'camera'); assert.equal(M.portView(23, cg, cam).level, 'warning'); assert.match(M.portView(23, cg, cam).how, /attackers/);
    assert.equal(M.portView(554, cg, cam).level, 'info');
    const rt = dev('00:ab:48:10:00:01', [23]);   // scrub-ok: eero
    assert.equal(M.portView(23, M.deviceGuess(rt), rt).level, 'warning');
    const nas = dev('00:11:32:aa:00:02', [21]);   // scrub-ok
    assert.equal(M.portView(21, M.deviceGuess(nas), nas).level, 'warning');
  });

  t('makers: a private Wi-Fi address sharing folders is probably a computer, and is told so', () => {
    const d = dev('9a:1e:4c:00:00:0b', [445]), g = M.deviceGuess(d);   // scrub-ok
    assert.equal(g.type, 'computer'); assert.equal(g.sure, false);
    const p = M.portView(445, g, d); assert.equal(p.level, 'notice'); assert.match(p.how, /most likely a computer/);
    assert.equal(M.whoIsIt(d).maker, null);
  });

  t('makers: what the person said wins; names it goes by point to the kind of device', () => {
    const d = dev('ac:de:48:00:00:02', [23], { type: 'receiver' });   // scrub-ok
    assert.equal(M.portView(23, M.deviceGuess(d), d).level, 'info');
    assert.equal(M.deviceGuess(dev('ac:de:48:00:00:03', [], { host: 'office-printer' })).type, 'printer');   // scrub-ok
    assert.equal(M.deviceGuess(dev('ac:de:48:00:00:04', [], { hints: { ha: { name: 'Living room AVR', maker: 'Denon', model: 'AVR-X1700H' } } })).type, 'receiver');   // scrub-ok
    assert.equal(M.typeFromNames(['Sams-iPhone']), 'phone');
    const w = M.whoIsIt(dev('00:06:78:00:00:07', [23], { host: 'avr', hints: { ha: { name: 'Living room AVR', model: 'AVR-X1700H' }, mdns: 'Living room AVR', netbios: 'AVR' } }));   // scrub-ok
    assert.deepEqual(w.names.map((n) => n.from), ['Home Assistant', 'Windows network name'], 'the same name is listed once');
    assert.equal(M.announcedName({ host: 'avr', hints: { upnp: { name: 'Denon AVR' } } }), 'Denon AVR');
  });

  t('makers: Windows (NetBIOS) node status and UPnP descriptions are read safely', () => {
    assert.equal(M.NB_ASK.length, 50); assert.equal(M.NB_ASK.toString('latin1', 13, 45), `CK${'A'.repeat(30)}`);
    const ans = Buffer.alloc(57 + 18 * 2); ans.writeUInt16BE(0x8400, 2); ans.writeUInt16BE(1, 6); ans[12] = 0x20; ans.write(`CK${'A'.repeat(30)}`, 13, 'latin1');
    ans.writeUInt16BE(0x21, 46); ans.writeUInt16BE(1, 48); ans.writeUInt16BE(18 * 2 + 1, 54); ans[56] = 2;
    ans.write('WORKGROUP      ', 57, 'latin1'); ans[72] = 0; ans[73] = 0x80;   // a group name first: skipped
    ans.write('STUDY-PC       ', 75, 'latin1'); ans[90] = 0; ans[91] = 0x04;
    assert.equal(M.parseNbStatus(ans), 'STUDY-PC');
    assert.equal(M.parseNbStatus(Buffer.alloc(10)), null);
    assert.deepEqual(M.parseUpnpDesc('<root><device><friendlyName>Office printer &amp; scanner</friendlyName><manufacturer>Brother</manufacturer><modelName>HL-L2350DW</modelName></device></root>'), { name: 'Office printer & scanner', maker: 'Brother', model: 'HL-L2350DW' });
    assert.equal(M.parseUpnpDesc('<html>nope</html>'), null);
  });
}
