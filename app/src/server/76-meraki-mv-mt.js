/* ======================================================================
 * Cisco Meraki cameras (MV) and sensors (MT) - Pro, through the Meraki
 * source connected in Network › Network devices (same API key).
 *
 * Cameras: a fresh picture asked of Meraki's cloud (generateSnapshot), at
 * most every 15 s while someone is looking. Sensors: the latest readings
 * (temperature, humidity, water, door, battery) once a minute - and they
 * feed the usual alerts (water, low battery, freezing or very hot).
 * ====================================================================== */
const merakiSrc = () => netSources().find((s) => s.kind === 'meraki');
const merakiBase = (s) => process.env.CASATORCH_MERAKI_BASE || MERAKI_BASES[s.region] || MERAKI_BASES.us;
const merakiH = (s) => ({ Authorization: `Bearer ${secretOf(s.secret)}` });
const merakiDevs = (type) => { const s = merakiSrc(); return (s && netState[s.id]?.devices || []).filter((d) => d.type === type && d.serial); };
async function merakiReadings(s) {
  const org = netState[s.id]?.summary?.orgId; if (!org) return [];
  return (await cached(`meraki:mt:${org}`, 60_000, async () => ({ list: await netRequest(`${merakiBase(s)}/organizations/${encodeURIComponent(org)}/sensor/readings/latest`, { headers: merakiH(s) }).catch(() => []) }))).list || [];
}
function mtDevice(r, names) {
  const d = { id: `meraki:${r.serial}`, provider: 'meraki', kind: 'sensor', name: names.get(r.serial) || r.serial, online: true, source: 'Cisco Meraki' };
  for (const x of r.readings || []) {
    if (x.metric === 'temperature' && Number.isFinite(x.temperature?.celsius)) d.tempC = x.temperature.celsius;
    if (x.metric === 'humidity' && Number.isFinite(x.humidity?.relativePercentage)) d.humidity = x.humidity.relativePercentage;
    if (x.metric === 'water' && typeof x.water?.present === 'boolean') d.water = x.water.present;
    if (x.metric === 'door' && typeof x.door?.open === 'boolean') d.open = x.door.open;
    if (x.metric === 'battery' && Number.isFinite(x.battery?.percentage)) d.battery = x.battery.percentage;
  }
  return d;
}
integration({
  id: 'meraki', pro: true,
  async list() {
    const s = merakiSrc(); if (!s || !proStatus().pro) return [];
    const cams = merakiDevs('camera').map((c) => camDevice('meraki', c.serial, { name: c.name, online: c.online, source: 'Cisco Meraki' }));
    const names = new Map(merakiDevs('sensor').map((d) => [d.serial, d.name]));
    const sensors = names.size ? (await merakiReadings(s)).filter((r) => r.serial).map((r) => mtDevice(r, names)) : [];
    return [...cams, ...sensors];
  },
  camera: {
    every: 15_000, idle: 5 * 60_000,   // Meraki makes each picture in its cloud: a few seconds each, and rate-limited
    known: (serial) => merakiDevs('camera').some((c) => c.serial === serial),
    async snapshot(serial) {
      const s = merakiSrc(); if (!s) throw new Error('Meraki is not connected');
      const g = await netRequest(`${merakiBase(s)}/devices/${encodeURIComponent(serial)}/camera/generateSnapshot`, { method: 'POST', headers: merakiH(s), body: {} });
      if (!g?.url) throw new Error('Meraki did not return a picture');
      for (let i = 0; i < 10; i++) {   // the picture takes a few seconds to appear at its address
        await new Promise((ok) => setTimeout(ok, i ? 1000 : 1500));
        const r = await fetch(g.url, { signal: AbortSignal.timeout(8000) }).catch(() => null);
        const type = r?.headers.get('content-type') || '';
        if (r?.ok && type.startsWith('image/')) return { buf: Buffer.from(await r.arrayBuffer()), type };
      }
      throw new Error('the Meraki picture was not ready in time');
    },
  },
});
