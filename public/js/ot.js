// Tiny text-sync core shared by the browser and the server.
// An edit is one splice: { p: position, d: characters deleted, s: text inserted }.

export function diff(a, b) {
  if (a === b) return null;
  let p = 0;
  const max = Math.min(a.length, b.length);
  while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  let ea = a.length;
  let eb = b.length;
  while (ea > p && eb > p && a.charCodeAt(ea - 1) === b.charCodeAt(eb - 1)) { ea--; eb--; }
  return { p, d: ea - p, s: b.slice(p, eb) };
}

export const apply = (t, o) => t.slice(0, o.p) + o.s + t.slice(o.p + o.d);

/**
 * Rewrites edit `a` so it can be applied after edit `b` (both were made on the same text).
 * `before`: when both insert at the same spot, keep `a` in front of `b`.
 */
export function transform(a, b, before = false) {
  const a1 = a.p, a2 = a.p + a.d, b1 = b.p, b2 = b.p + b.d;
  if (a1 >= b2 && !(before && a1 === b1 && b.d === 0)) return { p: a1 + b.s.length - b.d, d: a.d, s: a.s };
  if (a2 <= b1) return { p: a.p, d: a.d, s: a.s };
  const left = a1 < b1 ? b1 - a1 : 0;
  const right = a2 > b2 ? a2 - b2 : 0;
  if (left && right) return { p: a1, d: left + b.s.length + right, s: a.s };
  if (left) return { p: a1, d: left, s: a.s };
  return { p: b1 + b.s.length, d: right, s: a.s };
}
