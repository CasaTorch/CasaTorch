/* ======================================================================
 * Settings › Health › Security score: which of CasaTorch's protections are on here, each with where to turn it on.
 * Facts only (nothing is sent anywhere), read from the settings and the latest Health checks (79-doctor.js).
 * ====================================================================== */
function securityScore() {
  const st = (id) => DOC.checks.find((c) => c.id === id)?.status, owner = (users?.list || []).find((u) => u.role === 'owner');
  const items = [
    { id: 'signin', on: signInOn(), title: 'Everyone signs in', fix: '#settings/people' },
    { id: 'twostep', on: !!(users?.policy?.require2fa || owner?.totp?.on), title: 'Two-step sign-in for the owner', fix: '#settings/people' },
    { id: 'https', on: !!LOCAL_TLS.url, title: 'The secure address at home (https)', fix: '#settings/connections' },
    { id: 'keystore', on: KS.kind !== 'file', title: 'Secret key in the system\'s key store', fix: null },
    { id: 'updates', on: updatePrefs().auto || st('updates') === 'ok', title: 'Up to date', fix: '#settings/updates' },
    { id: 'backup', on: st('backup') === 'ok', title: 'A recent backup', fix: '#settings/updates' },
    { id: 'remote', on: !config.remote?.on || st('edgegate') === 'ok', title: 'Access from away only on approved devices', fix: '#settings/devices' },
    { id: 'auditlog', on: st('auditlog') !== 'bad', title: 'Activity log intact', fix: '#settings/people' },
    { id: 'pinned', on: vendorMismatch().length === 0, title: 'CasaTorch\'s own files unchanged', fix: null },
  ];
  return { on: items.filter((i) => i.on).length, of: items.length, items };
}
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchAudit = { auditVerify, auditChainLine, auditSignedExport, auditCheck, auditMac, securityScore, resetHead: () => { auditHead = undefined; } };
