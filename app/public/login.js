document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('msg'); msg.textContent = '';
  const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: document.getElementById('u').value, password: document.getElementById('p').value, remember: document.getElementById('r').checked }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { msg.textContent = j.error || 'Could not sign in.'; return; }
  const next = new URLSearchParams(location.search).get('next');
  location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
});
