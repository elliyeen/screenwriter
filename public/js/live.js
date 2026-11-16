// Real-time connection for one open script.
// "shadow" is the text exactly as the server has it. Whatever differs between the shadow
// and the editor is what still needs sending. One edit is in flight at a time.
import { diff, apply, transform } from './ot.js';

export class Live {
  /** o: { url, getText, applyRemote(op), onInit(msg, prevShadow), onAck(), onSaved(ts), onPeers(list), onStatus(open) } */
  constructor(o) {
    this.o = o;
    this.open = false;
    this.shadow = null;
    this.rev = 0;
    this.inflight = false;
    this.readOnly = false;
    this.closed = false;
    this.retry = 0;
    this.timer = 0;
    this.connect();
  }
  connect() {
    if (this.closed) return;
    const ws = (this.ws = new WebSocket(this.o.url));
    ws.onmessage = (e) => { if (this.ws === ws) this.onMsg(JSON.parse(e.data)); };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.open = false;
      this.inflight = false;
      this.o.onStatus(false);
      if (this.closed) return;
      this.retry = Math.min(this.retry + 1, 6);
      this.retryTimer = setTimeout(() => this.connect(), 400 * 2 ** this.retry);
    };
    ws.onerror = () => {};
  }
  onMsg(m) {
    if (m.t === 'init') {
      const prev = this.shadow;
      this.shadow = m.text;
      this.rev = m.rev;
      this.inflight = false;
      this.open = true;
      this.retry = 0;
      this.readOnly = m.role === 'reviewer';
      this.o.onInit(m, prev);
      this.o.onStatus(true);
      this.send();
    } else if (m.t === 'op') {
      if (m.rev !== this.rev + 1) { this.ws.close(); return; }
      const op = { p: m.p, d: m.d, s: m.s };
      if (m.mine) {
        this.shadow = apply(this.shadow, op);
        this.rev = m.rev;
        this.inflight = false;
        this.o.onAck();
        this.send();
      } else {
        const mineUnsent = diff(this.shadow, this.o.getText());
        this.o.applyRemote(mineUnsent ? transform(op, mineUnsent, true) : op);
        this.shadow = apply(this.shadow, op);
        this.rev = m.rev;
      }
    } else if (m.t === 'peers') this.o.onPeers(m.peers);
    else if (m.t === 'saved') this.o.onSaved(m.updated);
  }
  localChanged() { clearTimeout(this.timer); this.timer = setTimeout(() => this.send(), 120); }
  send() {
    if (!this.open || this.inflight || this.readOnly) return;
    const op = diff(this.shadow, this.o.getText());
    if (!op) return;
    this.inflight = true;
    this.ws.send(JSON.stringify({ t: 'op', base: this.rev, p: op.p, d: op.d, s: op.s }));
  }
  inSync() { return this.open && !this.inflight && this.shadow === this.o.getText(); }
  close() {
    clearTimeout(this.timer);
    clearTimeout(this.retryTimer);
    this.send(); // last unsent keystrokes
    this.closed = true;
    this.open = false;
    try { this.ws.close(); } catch { /* already closed */ }
  }
}
