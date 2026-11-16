import { verifyAccess } from './access.js';
import { ScriptRoom } from './room.js';
import { SESSION_COOKIE, sessionUser, requestCode, verifyCode, logout, cleanup } from './auth.js';
export { ScriptRoom };

const MAX_TEXT = 1_000_000;
const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATUSES = ['idea', 'outline', 'draft', 'revision', 'final'];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const cookie = (request, name) => {
  const m = new RegExp('(?:^|;\\s*)' + name + '=([^;]+)').exec(request.headers.get('cookie') || '');
  return m ? decodeURIComponent(m[1]) : null;
};

async function identify(request, env) {
  const sess = cookie(request, SESSION_COOKIE);
  if (sess) { const who = await sessionUser(sess, env); if (who) return who; }
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    const token = request.headers.get('Cf-Access-Jwt-Assertion') || cookie(request, 'CF_Authorization');
    return verifyAccess(token, env);
  }
  // Local development only. DEV_EMAIL lives in .dev.vars and is never set in production.
  const dev = cookie(request, 'dev_user');
  const local = ['localhost', '127.0.0.1'].includes(new URL(request.url).hostname); // defense in depth: never honour the dev login on a real domain
  if (env.DEV_EMAIL && dev && local) return String(dev).toLowerCase();
  return null;
}

/** Nightly copy of every script (deleted ones too) into separate R2 storage. Skipped if no bucket is bound. */
export async function backup(env, now = new Date()) {
  if (!env.BACKUPS) return { skipped: true };
  const day = now.toISOString().slice(0, 10);
  const { results: owners } = await env.DB.prepare('SELECT DISTINCT owner FROM scripts').all();
  let scripts = 0;
  for (const { owner } of owners) {
    const { results } = await env.DB.prepare('SELECT id, title, text, status, meta, created, updated, deleted FROM scripts WHERE owner = ?').bind(owner).all();
    scripts += results.length;
    await env.BACKUPS.put(`daily/${day}/${encodeURIComponent(owner)}.json`, JSON.stringify({ owner, day, scripts: results }), { httpMetadata: { contentType: 'application/json' } });
  }
  // keep 30 days
  const old = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const stale = await env.BACKUPS.list({ prefix: `daily/${old}/` });
  for (const o of stale.objects) await env.BACKUPS.delete(o.key);
  return { day, owners: owners.length, scripts };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(backup(env).then((r) => console.log('backup', JSON.stringify(r))));
    ctx.waitUntil(cleanup(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      // Block other websites from acting as a signed-in user: browsers send Origin on writes and WebSocket upgrades.
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin && (request.method !== 'GET' || request.headers.get('upgrade'))) return json({ error: 'forbidden' }, 403);
      if (url.pathname.startsWith('/api/auth/')) return await authRoute(request, env, url);
      const me = await identify(request, env);
      if (!me) return json({ error: 'unauthorized' }, 401);
      return await route(request, env, me, url);
    } catch (e) {
      console.error(e);
      return json({ error: 'server error' }, 500);
    }
  },
};

async function authRoute(request, env, url) {
  const send = (r) => { const res = json(r.data, r.status); if (r.setCookie) res.headers.append('set-cookie', r.setCookie); return res; };
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  let body = {};
  try { body = await request.json(); } catch {}
  const sess = cookie(request, SESSION_COOKIE);
  switch (url.pathname) {
    case '/api/auth/request': return send(await requestCode(request, env, body));
    case '/api/auth/verify': return send(await verifyCode(request, env, body));
    case '/api/auth/logout': return send(await logout(request, env, sess, false));
    case '/api/auth/logout-all': return send(await logout(request, env, sess, true, await sessionUser(sess, env)));
    default: return json({ error: 'not found' }, 404);
  }
}

/** Who owns the script being asked for, and what may the caller do with it? */
async function access(db, me, ownerParam, id) {
  const owner = (ownerParam || me).toLowerCase();
  if (owner === me) return { owner, role: 'owner' };
  const row = await db.prepare('SELECT role FROM shares WHERE owner = ? AND script_id = ? AND email = ?').bind(owner, id, me).first();
  return row ? { owner, role: row.role === 'reviewer' ? 'reviewer' : 'editor' } : null;
}

function room(env, acc, id, me, path, init = {}) {
  const stub = env.ROOMS.get(env.ROOMS.idFromName(acc.owner + '/' + id));
  const req = new Request('https://room' + path, init);
  req.headers.set('x-owner', acc.owner);
  req.headers.set('x-script', id);
  req.headers.set('x-user', me);
  req.headers.set('x-role', acc.role);
  return stub.fetch(req);
}

async function route(request, env, me, url) {
  const seg = url.pathname.replace(/\/+$/, '').split('/').slice(2);
  const method = request.method;
  const db = env.DB;

  if (seg[0] === 'me' && method === 'GET') return json({ email: me });

  if (seg[0] === 'state') {
    if (method === 'GET') {
      const row = await db.prepare('SELECT data FROM user_state WHERE email = ?').bind(me).first();
      let data = {};
      try { data = JSON.parse(row ? row.data : '{}'); } catch { /* keep empty */ }
      return json({ state: data });
    }
    if (method === 'PUT') {
      const raw = await request.text();
      try { JSON.parse(raw); } catch { return json({ error: 'bad json' }, 400); }
      if (raw.length > 4000) return json({ error: 'too large' }, 400);
      await db.prepare('INSERT INTO user_state (email, data, updated) VALUES (?, ?, ?) ON CONFLICT (email) DO UPDATE SET data = excluded.data, updated = excluded.updated').bind(me, raw, Date.now()).run();
      return json({ ok: true });
    }
  }

  if (seg[0] === 'scripts' && seg.length === 1 && method === 'GET') {
    // my scripts include the ones in the trash (deleted = 1) so the trash follows me across devices
    const { results } = await db.prepare(
      `SELECT id, owner, title, status, meta, updated, deleted, 'owner' AS role FROM scripts WHERE owner = ?1
       UNION ALL
       SELECT s.id, s.owner, s.title, s.status, s.meta, s.updated, 0 AS deleted, sh.role FROM shares sh
         JOIN scripts s ON s.owner = sh.owner AND s.id = sh.script_id
        WHERE sh.email = ?1 AND s.deleted = 0`
    ).bind(me).all();
    return json({ scripts: results });
  }

  if (seg[0] !== 'scripts' || !seg[1]) return json({ error: 'not found' }, 404);
  const id = seg[1];
  if (!ID_RE.test(id)) return json({ error: 'bad id' }, 400);
  const acc = await access(db, me, url.searchParams.get('owner'), id);
  if (!acc) return json({ error: 'not found' }, 404);
  const canWrite = acc.role !== 'reviewer';
  const sub = seg[2];

  if (!sub && method === 'GET') {
    const row = await db.prepare('SELECT id, title, text, status, meta, updated, deleted FROM scripts WHERE owner = ? AND id = ?').bind(acc.owner, id).first();
    return row && (!row.deleted || acc.role === 'owner') ? json(row) : json({ error: 'not found' }, 404);
  }

  if (!sub && method === 'PUT') {
    if (!canWrite) return json({ error: 'read only' }, 403);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
    if (typeof body.text !== 'string' || body.text.length > MAX_TEXT) return json({ error: 'bad text' }, 400);
    return room(env, acc, id, me, '/put', {
      method: 'POST',
      body: JSON.stringify({ text: body.text, base: Number(body.base) || 0, snapshot: url.searchParams.has('snapshot') }),
    });
  }

  if (!sub && method === 'PATCH') {
    if (!canWrite) return json({ error: 'read only' }, 403);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
    const sets = [];
    const vals = [];
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) return json({ error: 'bad status' }, 400);
      sets.push('status = ?'); vals.push(body.status);
    }
    if (body.meta !== undefined) {
      const meta = JSON.stringify(body.meta);
      if (!body.meta || typeof body.meta !== 'object' || Array.isArray(body.meta) || meta.length > 2000) return json({ error: 'bad meta' }, 400);
      sets.push('meta = ?'); vals.push(meta);
    }
    if (!sets.length) return json({ error: 'nothing to change' }, 400);
    const r = await db.prepare(`UPDATE scripts SET ${sets.join(', ')} WHERE owner = ? AND id = ?`).bind(...vals, acc.owner, id).run();
    return r.meta.changes ? json({ ok: true }) : json({ error: 'not found' }, 404);
  }

  if (!sub && method === 'DELETE') {
    if (acc.role !== 'owner') return json({ error: 'only the owner can delete' }, 403);
    // moves to trash; the text and its history stay in the database
    await db.prepare('UPDATE scripts SET deleted = 1 WHERE owner = ? AND id = ?').bind(acc.owner, id).run();
    await room(env, acc, id, me, '/deleted', { method: 'POST' });
    return json({ ok: true });
  }

  if (sub === 'restore' && method === 'POST') {
    if (acc.role !== 'owner') return json({ error: 'only the owner can restore' }, 403);
    await db.prepare('UPDATE scripts SET deleted = 0 WHERE owner = ? AND id = ?').bind(acc.owner, id).run();
    await room(env, acc, id, me, '/restored', { method: 'POST' });
    return json({ ok: true });
  }

  if (sub === 'live' && method === 'GET') {
    if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected websocket' }, 426);
    return room(env, acc, id, me, '/live', { headers: { Upgrade: 'websocket' } });
  }

  if (sub === 'snapshot' && method === 'POST') {
    if (!canWrite) return json({ error: 'read only' }, 403);
    return room(env, acc, id, me, '/snapshot', { method: 'POST' });
  }

  if (sub === 'versions' && seg.length === 3 && method === 'GET') {
    const { results } = await db.prepare('SELECT id, saved, length(text) AS size FROM versions WHERE owner = ? AND script_id = ? ORDER BY id DESC LIMIT 200').bind(acc.owner, id).all();
    return json({ versions: results });
  }
  if (sub === 'versions' && seg[3] && method === 'GET') {
    const row = await db.prepare('SELECT id, saved, text FROM versions WHERE owner = ? AND script_id = ? AND id = ?').bind(acc.owner, id, Number(seg[3])).first();
    return row ? json(row) : json({ error: 'not found' }, 404);
  }

  if (sub === 'shares') {
    if (acc.role !== 'owner') return json({ error: 'only the owner can share' }, 403);
    if (method === 'GET') {
      const { results } = await db.prepare('SELECT email, role FROM shares WHERE owner = ? AND script_id = ? ORDER BY created').bind(acc.owner, id).all();
      return json({ shares: results });
    }
    if (method === 'PUT') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      const email = String(body.email || '').trim().toLowerCase();
      const role = body.role === 'reviewer' ? 'reviewer' : 'editor';
      if (!EMAIL_RE.test(email) || email.length > 200 || email === me) return json({ error: 'bad email' }, 400);
      const exists = await db.prepare('SELECT 1 FROM scripts WHERE owner = ? AND id = ? AND deleted = 0').bind(acc.owner, id).first();
      if (!exists) return json({ error: 'not found' }, 404);
      await db.prepare(
        `INSERT INTO shares (owner, script_id, email, role, created) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (owner, script_id, email) DO UPDATE SET role = excluded.role`
      ).bind(acc.owner, id, email, role, Date.now()).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      await db.prepare('DELETE FROM shares WHERE owner = ? AND script_id = ? AND email = ?').bind(acc.owner, id, String(url.searchParams.get('email') || '').toLowerCase()).run();
      return json({ ok: true });
    }
  }
  return json({ error: 'not found' }, 404);
}
