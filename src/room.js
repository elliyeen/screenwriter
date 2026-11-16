// One room per script. It holds the live text, merges everyone's edits in order,
// and saves to the database. All writes to a script go through its room.
import { DurableObject } from 'cloudflare:workers';
import { apply, transform, diff } from '../public/js/ot.js';

const MAX_TEXT = 1_000_000;
const SNAPSHOT_EVERY_MS = 5 * 60 * 1000;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export function titleOf(text) {
  const t = /^\s*title:\s*(.+)$/im.exec(text);
  if (t) return t[1].trim().slice(0, 120);
  const first = text.split('\n').find((l) => l.trim());
  return first ? first.trim().slice(0, 120) : 'Untitled';
}

export class ScriptRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sockets = new Map();
    this.text = '';
    this.rev = 0;
    this.ops = [];
    this.opsBase = 0;
    this.updated = 0;
    this.exists = false;
    this.savedText = null;
    this.lastSnap = 0;
    this.lastSnapText = null;
    this.timer = null;
    this.queue = Promise.resolve();
  }

  load(owner, id) {
    this.loading ||= (async () => {
      this.owner = owner;
      this.id = id;
      const db = this.env.DB;
      const row = await db.prepare('SELECT text, updated, deleted FROM scripts WHERE owner = ? AND id = ?').bind(owner, id).first();
      if (row) {
        this.updated = row.updated;
        if (!row.deleted) { this.exists = true; this.text = row.text; this.savedText = row.text; this.rev = 0; this.ops = []; this.opsBase = 0; }
      }
      const v = await db.prepare('SELECT text, saved FROM versions WHERE owner = ? AND script_id = ? ORDER BY id DESC LIMIT 1').bind(owner, id).first();
      if (v) { this.lastSnap = v.saved; this.lastSnapText = v.text; }
    })();
    return this.loading;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const h = request.headers;
    await this.load(h.get('x-owner'), h.get('x-script'));
    const user = h.get('x-user');
    const role = h.get('x-role');

    if (url.pathname === '/live') {
      if (!this.exists) return json({ error: 'not found' }, 404);
      const pair = new WebSocketPair();
      const ws = pair[1];
      ws.accept();
      this.sockets.set(ws, { user, role });
      ws.addEventListener('message', (e) => this.onMessage(ws, e.data));
      const bye = () => this.onClose(ws);
      ws.addEventListener('close', bye);
      ws.addEventListener('error', bye);
      this.sendInit(ws);
      this.sendPeers();
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (url.pathname === '/put') {
      const body = await request.json();
      const text = body.text;
      if (this.exists && this.updated !== (Number(body.base) || 0)) {
        if (text === this.text) return json({ updated: this.updated });
        return json({ error: 'conflict', server: { text: this.text, updated: this.updated } }, 409);
      }
      if (!this.exists && role !== 'owner') return json({ error: 'not found' }, 404);
      const op = diff(this.text, text);
      this.exists = true;
      if (op) this.applyOp(op, null);
      await this.flush(!!body.snapshot);
      return json({ updated: this.updated });
    }

    if (url.pathname === '/snapshot') {
      await this.flush(true);
      return json({ updated: this.updated });
    }

    if (url.pathname === '/deleted') {
      this.exists = false;
      this.savedText = null;
      for (const ws of this.sockets.keys()) { try { ws.close(1000, 'deleted'); } catch { /* gone */ } }
      this.sockets.clear();
      return json({ ok: true });
    }

    if (url.pathname === '/restored') {
      this.loading = null; // read the row again
      this.exists = false;
      await this.load(this.owner, this.id);
      return json({ ok: true });
    }
    return json({ error: 'not found' }, 404);
  }

  sendInit(ws) {
    const info = this.sockets.get(ws);
    ws.send(JSON.stringify({ t: 'init', text: this.text, rev: this.rev, updated: this.updated, role: info.role, you: info.user }));
  }
  sendPeers() {
    const peers = [...this.sockets.values()].map((s) => s.user);
    this.broadcast({ t: 'peers', peers });
  }
  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const ws of this.sockets.keys()) { try { ws.send(data); } catch { /* closing */ } }
  }

  applyOp(op, sender) {
    this.text = apply(this.text, op);
    this.rev++;
    this.ops.push(op);
    if (this.ops.length > 2000) { this.ops.splice(0, 1000); this.opsBase += 1000; }
    for (const ws of this.sockets.keys()) {
      try { ws.send(JSON.stringify({ t: 'op', rev: this.rev, p: op.p, d: op.d, s: op.s, mine: ws === sender })); } catch { /* closing */ }
    }
    if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.ctx.waitUntil(this.flush(false)); }, 1500);
  }

  onMessage(ws, data) {
    const info = this.sockets.get(ws);
    if (!info || typeof data !== 'string' || data.length > MAX_TEXT + 1000) return;
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (m.t !== 'op' || info.role === 'reviewer' || !this.exists) return;
    const ok = Number.isInteger(m.p) && Number.isInteger(m.d) && Number.isInteger(m.base) && typeof m.s === 'string' && m.p >= 0 && m.d >= 0;
    if (!ok || m.base < this.opsBase || m.base > this.rev) return this.sendInit(ws);
    let op = { p: m.p, d: m.d, s: m.s };
    for (let i = m.base; i < this.rev; i++) op = transform(op, this.ops[i - this.opsBase], false);
    if (op.p + op.d > this.text.length || this.text.length - op.d + op.s.length > MAX_TEXT) return this.sendInit(ws);
    this.applyOp(op, ws);
  }

  onClose(ws) {
    if (!this.sockets.delete(ws)) return;
    try { ws.close(); } catch { /* already closed */ }
    this.sendPeers();
    if (this.sockets.size === 0) this.ctx.waitUntil(this.flush(false));
  }

  flush(force) {
    this.queue = this.queue.then(() => this.doFlush(force)).catch((e) => console.error('flush failed', e));
    return this.queue;
  }
  async doFlush(force) {
    if (!this.exists) return;
    const db = this.env.DB;
    const text = this.text;
    const now = Date.now();
    if (text !== this.savedText) {
      const updated = Math.max(now, this.updated + 1);
      await db.prepare(
        `INSERT INTO scripts (owner, id, title, text, created, updated, deleted) VALUES (?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT (owner, id) DO UPDATE SET title = excluded.title, text = excluded.text, updated = excluded.updated, deleted = 0`
      ).bind(this.owner, this.id, titleOf(text), text, now, updated).run();
      this.updated = updated;
      this.savedText = text;
      this.broadcast({ t: 'saved', updated });
    }
    if (text !== this.lastSnapText && (force || this.lastSnapText === null || now - this.lastSnap > SNAPSHOT_EVERY_MS)) {
      await db.prepare('INSERT INTO versions (owner, script_id, text, saved) VALUES (?, ?, ?, ?)').bind(this.owner, this.id, text, now).run();
      this.lastSnap = now;
      this.lastSnapText = text;
    }
  }
}
