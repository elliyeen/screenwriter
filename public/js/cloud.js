// Thin client for the /api endpoints. Every call returns { ok, status, data }.
// If the app is hosted without the server (static only), calls come back "not ok"
// and the app keeps working with browser-only saving.

async function req(method, path, body) {
  try {
    const r = await fetch('/api' + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    let data = null;
    if ((r.headers.get('content-type') || '').includes('application/json')) {
      try { data = await r.json(); } catch { /* not json */ }
    }
    if (r.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('auth-required'));
    return { ok: r.ok && data !== null, status: r.status, data };
  } catch {
    return { ok: false, status: 0, data: null }; // offline
  }
}

// s = { id, owner } where owner is null for my own scripts
function path(s, sub = '', params = {}) {
  const q = new URLSearchParams(params);
  if (s.owner) q.set('owner', s.owner);
  const qs = q.toString();
  return '/scripts/' + s.id + sub + (qs ? '?' + qs : '');
}

export const api = {
  me: () => req('GET', '/me'),
  authRequest: (email) => req('POST', '/auth/request', { email }),
  authVerify: (email, code) => req('POST', '/auth/verify', { email, code }),
  logout: (all) => req('POST', all ? '/auth/logout-all' : '/auth/logout', {}),
  list: () => req('GET', '/scripts'),
  get: (s) => req('GET', path(s)),
  put: (s, text, base, snapshot) => req('PUT', path(s, '', snapshot ? { snapshot: 1 } : {}), { text, base }),
  patch: (s, body) => req('PATCH', path(s), body),
  del: (s) => req('DELETE', path(s)),
  snapshot: (s) => req('POST', path(s, '/snapshot')),
  restore: (s) => req('POST', path(s, '/restore')),
  getState: () => req('GET', '/state'),
  putState: (data) => req('PUT', '/state', data),
  versions: (s) => req('GET', path(s, '/versions')),
  version: (s, vid) => req('GET', path(s, '/versions/' + vid)),
  shares: (s) => req('GET', path(s, '/shares')),
  share: (s, email, role) => req('PUT', path(s, '/shares'), { email, role }),
  unshare: (s, email) => req('DELETE', path(s, '/shares', { email })),
  liveUrl: (s) => (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api' + path(s, '/live'),
};
