import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parse, parseInline } from '../public/js/fountain.js';
import { layoutScript, wrapRuns, L } from '../public/js/layout.js';
import { writePdf } from '../public/js/pdf.js';
import { SAMPLE } from '../public/js/sample.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  -', name); };

test('inline: bold/italic/underline, escapes, lone asterisk stays plain', () => {
  assert.deepEqual(parseInline('a **b** *c* _d_'), [
    { t: 'a ', b: false, i: false, u: false }, { t: 'b', b: true, i: false, u: false },
    { t: ' ', b: false, i: false, u: false }, { t: 'c', b: false, i: true, u: false },
    { t: ' ', b: false, i: false, u: false }, { t: 'd', b: false, i: false, u: true },
  ]);
  assert.equal(parseInline('(Cowboys*)')[0].i, false);
  assert.equal(parseInline('Cowboys\\*').map((r) => r.t).join(''), 'Cowboys*');
  assert.equal(parseInline('snake_case_word')[0].u, false);
});

test('parser: scene, action, dialogue, paren, transition, notes removed', () => {
  const { elements } = parse('int. kitchen - night\n\nRain taps. [[note]]\n\nMAYA\n(whispering)\nHe found me.\n\nCUT TO:\n');
  assert.deepEqual(elements.map((e) => e.type), ['scene', 'action', 'character', 'paren', 'dialogue', 'transition']);
  assert.equal(elements[1].text, 'Rain taps.');
});

test('parser: title page keys', () => {
  const { meta, elements } = parse('Title: My Movie\nAuthor: A. Writer\n\nINT. ROOM - DAY\n');
  assert.equal(meta.title, 'My Movie');
  assert.equal(meta.author, 'A. Writer');
  assert.equal(elements[0].type, 'scene');
});

test('parser: forced character and forced action', () => {
  const { elements } = parse('!BOOM\n\n@McCoy\nHello.\n');
  assert.equal(elements[0].type, 'action');
  assert.equal(elements[1].type, 'character');
});

test('wrap: respects width and keeps styles', () => {
  const lines = wrapRuns(parseInline('one **two** three four five six seven'), 10);
  assert.ok(lines.every((l) => l.reduce((n, r) => n + r.t.length, 0) <= 10));
  assert.ok(lines.flat().some((r) => r.b && r.t === 'two'));
});

const res = layoutScript(SAMPLE);

test('layout: every line inside margins, never more than 54 rows', () => {
  for (const p of res.pages) {
    for (const ln of p.lines) {
      const len = ln.runs.reduce((n, r) => n + r.t.length, 0);
      assert.ok(ln.row >= 0 && ln.row < L.LINES, 'row ' + ln.row);
      assert.ok(ln.col >= 15 && ln.col + len <= 76, `bounds col=${ln.col} len=${len}`);
    }
  }
});

test("layout: auto (CONT'D) after action", () => {
  const all = res.pages.flatMap((p) => p.lines.map((l) => l.runs.map((r) => r.t).join('')));
  assert.ok(all.includes("ELLA (CONT'D)"));
});

test('layout: column positions match industry grid', () => {
  const find = (txt) => res.pages.flatMap((p) => p.lines).find((l) => l.runs.map((r) => r.t).join('') === txt);
  assert.equal(find('INT. PICKUP TRUCK - DAY').col, 15);
  assert.equal(find('NOAH').col, 35);
  assert.equal(find('(tapping the dashboard)').col, 30);
  assert.equal(find('You said that twenty minutes ago.').col, 25);
  assert.equal(find('CUT TO:').col + 'CUT TO:'.length, 75);
});

test('layout: page number only from page 2, title page unnumbered', () => {
  assert.equal(res.hasTitlePage, true);
  assert.equal(res.pages[0].showNumber, false);
  assert.equal(res.pages[1].showNumber, false);
  assert.equal(res.pages[2]?.showNumber ?? true, true);
});

test('pagination: long dialogue splits with (MORE) and (CONT\'D); no orphan scene heading', () => {
  const long = 'INT. A - DAY\n\n' +
    Array.from({ length: 30 }, (_, i) => `Action line number ${i} that is long enough to wrap onto a second line in the page.\n`).join('\n') +
    '\nBOB\n' + Array.from({ length: 12 }, (_, i) => `Sentence ${i} of a very long speech that keeps going and going.`).join(' ') +
    '\n\nEXT. B - NIGHT\n\nShort.\n';
  const r = layoutScript(long, { titlePage: false });
  const texts = r.pages.map((p) => p.lines.map((l) => l.runs.map((x) => x.t).join('')));
  assert.ok(texts.flat().includes('(MORE)'), 'has MORE');
  assert.ok(texts.flat().includes("BOB (CONT'D)"), 'has CONT\'D');
  for (const t of texts) {
    const last = t[t.length - 1];
    assert.ok(!/^(INT|EXT)\./.test(last), 'scene heading stranded: ' + last);
  }
  assert.ok(r.pages.every((p) => p.lines.length <= L.LINES));
});

test('pdf: valid structure with correct xref', () => {
  const pdf = writePdf(res.pages, { title: 'The Last Light' });
  const s = Buffer.from(pdf).toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4'));
  const startxref = Number(/startxref\n(\d+)/.exec(s)[1]);
  assert.equal(s.slice(startxref, startxref + 4), 'xref');
  const first = /xref\n0 \d+\n0000000000 65535 f \n(\d{10})/.exec(s)[1];
  assert.equal(s.slice(Number(first), Number(first) + 7), '1 0 obj');
  mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../out/sample.pdf', import.meta.url), pdf);
});

console.log(`\n${passed} tests passed`);
console.log('pages:', res.stats, 'scenes:', res.scenes);
