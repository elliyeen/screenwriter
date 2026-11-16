// Email one-time-code sign in. No passwords. Sessions are random tokens in a secure cookie;
// only hashes of codes and tokens are stored.
const CODE_TTL = 10 * 60_000;
const SESSION_TTL = 30 * 86_400_000;
const MAX_TRIES = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const SESSION_COOKIE = 'sw_session';

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hmac(env, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.AUTH_SECRET || 'dev-only-secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const randomCode = () => {
  const n = new Uint32Array(1);
  let v;
  do { crypto.getRandomValues(n); v = n[0]; } while (v >= 4_294_000_000); // no modulo bias
  return String(v % 1_000_000).padStart(6, '0');
};
const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const normEmail = (e) => String(e || '').trim().toLowerCase();

function cookieHeader(request, value, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

/** Who is signed in from the session cookie, or null. */
export async function sessionUser(token, env, now = Date.now()) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = await env.DB.prepare('SELECT email, expires FROM sessions WHERE hash = ?').bind(await hmac(env, 's:' + token)).first();
  if (!row || row.expires < now) return null;
  return row.email;
}

async function count(env, key, since) {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM auth_events WHERE key = ? AND ts > ?').bind(key, since).first();
  return r ? r.n : 0;
}

async function sendMail(env, to, code) {
  const from = env.MAIL_FROM || 'Screenwriter <onboarding@resend.dev>';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      from, to: [to], subject: `Your Screenwriter code: ${code}`,
      text: `Your Screenwriter sign-in code is ${code}\n\nIt works for 10 minutes. If you did not ask for it, you can ignore this email.`,
      html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:420px;margin:auto;padding:24px"><p style="font-size:15px;color:#333">Your Screenwriter sign-in code:</p><p style="font-size:34px;letter-spacing:8px;font-weight:700;margin:12px 0">${code}</p><p style="font-size:13px;color:#777">It works for 10 minutes. If you did not ask for it, you can ignore this email.</p></div>`,
    }),
  });
  if (!r.ok) throw new Error('mail failed ' + r.status + ' ' + (await r.text()).slice(0, 200));
}

export async function requestCode(request, env, body, now = Date.now()) {
  const email = normEmail(body && body.email);
  if (!EMAIL_RE.test(email) || email.length > 254) return { status: 400, data: { error: 'Enter a valid email address.' } };
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  // limits: 1 code a minute per email, 5 an hour per email, 20 an hour per network address
  if ((await count(env, 'e:' + email, now - 60_000)) >= 1) return { status: 429, data: { error: 'Please wait a minute before asking for another code.' } };
  if ((await count(env, 'e:' + email, now - 3_600_000)) >= 5 || (await count(env, 'i:' + ip, now - 3_600_000)) >= 20)
    return { status: 429, data: { error: 'Too many tries. Please try again in an hour.' } };
  await env.DB.batch([
    env.DB.prepare('INSERT INTO auth_events (key, ts) VALUES (?, ?), (?, ?)').bind('e:' + email, now, 'i:' + ip, now),
  ]);
  const code = randomCode();
  await env.DB.prepare('INSERT INTO login_codes (email, hash, expires, tries) VALUES (?, ?, ?, 0) ON CONFLICT(email) DO UPDATE SET hash = excluded.hash, expires = excluded.expires, tries = 0')
    .bind(email, await hmac(env, 'c:' + email + ':' + code), now + CODE_TTL).run();
  if (env.RESEND_API_KEY) await sendMail(env, email, code);
  else if (env.DEV_EMAIL) return { status: 200, data: { ok: true, devCode: code } }; // local development only
  else throw new Error('RESEND_API_KEY is not set');
  // same answer whether or not the address has an account
  return { status: 200, data: { ok: true } };
}

export async function verifyCode(request, env, body, now = Date.now()) {
  const email = normEmail(body && body.email);
  const code = String((body && body.code) || '').replace(/\s/g, '');
  const bad = { status: 400, data: { error: 'That code did not work. Check it or ask for a new one.' } };
  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) return bad;
  const row = await env.DB.prepare('SELECT hash, expires, tries FROM login_codes WHERE email = ?').bind(email).first();
  if (!row || row.expires < now || row.tries >= MAX_TRIES) return bad;
  await env.DB.prepare('UPDATE login_codes SET tries = tries + 1 WHERE email = ?').bind(email).run();
  if (!same(row.hash, await hmac(env, 'c:' + email + ':' + code))) return bad;
  await env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run(); // one use only
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (email, created, last_login) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET last_login = excluded.last_login').bind(email, now, now),
    env.DB.prepare('INSERT INTO sessions (hash, email, created, expires) VALUES (?, ?, ?, ?)').bind(await hmac(env, 's:' + token), email, now, now + SESSION_TTL),
  ]);
  return { status: 200, data: { ok: true, email }, setCookie: cookieHeader(request, token, SESSION_TTL / 1000) };
}

export async function logout(request, env, token, all, email) {
  if (all && email) await env.DB.prepare('DELETE FROM sessions WHERE email = ?').bind(email).run();
  else if (token) await env.DB.prepare('DELETE FROM sessions WHERE hash = ?').bind(await hmac(env, 's:' + token)).run();
  return { status: 200, data: { ok: true }, setCookie: cookieHeader(request, '', 0) };
}

export async function cleanup(env, now = Date.now()) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_codes WHERE expires < ?').bind(now),
    env.DB.prepare('DELETE FROM sessions WHERE expires < ?').bind(now),
    env.DB.prepare('DELETE FROM auth_events WHERE ts < ?').bind(now - 86_400_000),
  ]);
}
