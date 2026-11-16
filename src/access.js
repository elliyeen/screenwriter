// Verifies the Cloudflare Access login token (Cf-Access-Jwt-Assertion).
// We never trust the plain email header: anyone could forge it. We check the signature instead.

const enc = new TextEncoder();
const keyCache = { at: 0, keys: [] };

export function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  s += '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const decodeJson = (part) => JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));

async function getKeys(team, fetchFn, now, kid) {
  const fresh = now - keyCache.at < 3600_000;
  if (fresh && keyCache.keys.some((k) => k.kid === kid)) return keyCache.keys;
  const r = await fetchFn(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) return keyCache.keys;
  const data = await r.json();
  keyCache.keys = data.keys || [];
  keyCache.at = now;
  return keyCache.keys;
}

/** Returns the signed-in email, or null if the token is missing or not valid. */
export async function verifyAccess(token, env, fetchFn = fetch, now = Date.now()) {
  try {
    if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = decodeJson(parts[0]);
    const payload = decodeJson(parts[1]);
    if (header.alg !== 'RS256') return null;
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(env.ACCESS_AUD)) return null;
    if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
    if (!payload.exp || payload.exp * 1000 < now) return null;
    if (payload.nbf && payload.nbf * 1000 > now + 60_000) return null;
    const jwk = (await getKeys(env.ACCESS_TEAM_DOMAIN, fetchFn, now, header.kid)).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), enc.encode(parts[0] + '.' + parts[1]));
    return ok && payload.email ? String(payload.email).toLowerCase() : null;
  } catch {
    return null;
  }
}

export function _resetKeyCache() { keyCache.at = 0; keyCache.keys = []; }
