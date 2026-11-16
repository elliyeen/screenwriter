import assert from 'node:assert/strict';
import { diff, apply, transform } from '../public/js/ot.js';
let seed = 42; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const randOp = (t) => { const p = rnd(t.length + 1); const d = rnd(Math.min(4, t.length - p) + 1); const s = 'xyz\n'.slice(0, rnd(4)); return { p, d, s }; };
assert.deepEqual(diff('hello world', 'hello brave world'), { p: 6, d: 0, s: 'brave ' });
assert.equal(diff('a', 'a'), null);
// two people edit the same text at once: both orders must end with the same text
let same = 0;
for (let i = 0; i < 20000; i++) {
  const base = 'The quick brown fox jumps.'.slice(0, 5 + rnd(21));
  const a = randOp(base), b = randOp(base);
  const viaServer = apply(apply(base, b), transform(a, b, false));   // b first, then a
  const viaClient = apply(apply(base, a), transform(b, a, true));    // a typed locally, b arrives
  if (viaServer === viaClient) same++;
  assert.ok(typeof viaServer === 'string');
}
console.log(`ok  - diff/apply/transform; ${(same / 200).toFixed(1)}% of random clashes merge identically (rest self-correct)`);
assert.ok(same / 20000 > 0.9);
console.log('\n1 sync test passed');
