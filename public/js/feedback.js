// Studio check: rule-based format feedback and safe auto-fixes. No LLM.
// It checks format and common screenwriting conventions. It cannot judge story quality.

import { parse, parseInline, nameBase } from './fountain.js';
import { wrapRuns, L } from './layout.js';

const TIMES = /\b(DAY|NIGHT|MORNING|EVENING|AFTERNOON|DAWN|DUSK|SUNRISE|SUNSET|NOON|MIDNIGHT|LATER|MOMENTS LATER|CONTINUOUS|SAME|SAME TIME|MAGIC HOUR)\b\s*(\(.*\))?$/;
const PREFIX = /^(INT|EXT|EST|INT\.?\/EXT|I\/E)\.?\s/i;
const CAMERA = /\b(we see|we hear|we watch|camera (pans|moves|pulls|pushes|tracks|zooms|tilts)|close on|close[- ]up|angle on|pan to|zoom (in|out)|smash cut|pov shot)\b/i;

const plainLen = (text, width) => wrapRuns(parseInline(text), width).length;

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/**
 * check(src, pages) -> { items:[{level:'fix'|'tip', msg, line}], fixes, tips, summary }
 * level 'fix' = a studio reader would mark it as a format error; 'tip' = convention worth a look.
 */
export function check(src, pages = 0) {
  const { meta, elements } = parse(src);
  const items = [];
  const add = (level, msg, line = 0) => items.push({ level, msg, line });

  if (!meta.title) add('fix', 'No title page. Add "Title:" and "Author:" lines at the top.', 0);
  else if (!meta.author) add('fix', 'Title page has no author. Add an "Author:" line.', 0);
  if (/^your name$/i.test(meta.author || '')) add('fix', 'Author still says "Your Name".', 0);

  const speakers = {};
  let parens = 0;
  let speeches = 0;
  let transitions = 0;
  const introduced = new Set();
  const flaggedIntro = new Set();
  const allSpeakers = new Set(elements.filter((e) => e.type === 'character').map((e) => nameBase(e.text)));

  elements.forEach((el, idx) => {
    const prev = elements[idx - 1];
    const next = elements[idx + 1];

    if (el.type === 'scene') {
      const h = el.text.toUpperCase();
      if (!PREFIX.test(h)) add('fix', `Scene heading should start with INT. or EXT.: "${el.text}"`, el.line);
      else if (!/^(INT|EXT|EST|INT\.\/EXT|I\/E)\.\s/i.test(el.text)) add('fix', `Put a period after INT/EXT: "${el.text}"`, el.line);
      if (!TIMES.test(h)) add('fix', `Scene heading has no time of day (like " - DAY" or " - NIGHT"): "${el.text}"`, el.line);
      else if (!/\s-\s[^-]*$/.test(h)) add('tip', `Use " - " before the time of day: "${el.text}"`, el.line);
      if (el.text !== h) add('fix', `Scene heading should be ALL CAPS: "${el.text}"`, el.line);
      if (next && next.type === 'scene') add('tip', `Scene has no action or dialogue: "${el.text}"`, el.line);
      if (next && next.type === 'character') add('tip', `Add a line of action after the heading before anyone speaks: "${el.text}"`, el.line);
    }

    if (el.type === 'action') {
      const n = plainLen(el.text, L.ACTION.w);
      if (n > 4) add('tip', `Action block is ${n} lines. Readers prefer 4 or fewer, so split it up.`, el.line);
      const cam = CAMERA.exec(el.text);
      if (cam) add('tip', `Camera direction ("${cam[0]}"). Spec scripts leave shots to the director.`, el.line);
      // character introductions: first mention in action should be ALL CAPS
      for (const name of allSpeakers) {
        if (introduced.has(name) || name.length < 2) continue;
        const caps = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
        const any = new RegExp(caps.source, 'i');
        if (caps.test(el.text)) introduced.add(name);
        else if (any.test(el.text) && !flaggedIntro.has(name)) {
          flaggedIntro.add(name);
          add('tip', `First time ${name} appears in action, write the name in ALL CAPS.`, el.line);
          introduced.add(name);
        }
      }
    }

    if (el.type === 'character') {
      speeches++;
      const base = nameBase(el.text);
      speakers[base] = (speakers[base] || 0) + 1;
      introduced.add(base);
      if (/\(cont[’']?d\)/i.test(el.text)) add('tip', `You typed (CONT'D) on ${base}. The app adds it for you, so you can remove it.`, el.line);
      let lines = 0;
      for (let k = idx + 1; k < elements.length && (elements[k].type === 'dialogue' || elements[k].type === 'paren'); k++) {
        if (elements[k].type === 'dialogue') lines += plainLen(elements[k].text, L.DIALOGUE.w);
      }
      if (lines > 10) add('tip', `${base} speaks for ${lines} lines in a row. Long speeches read slow, so consider a break.`, el.line);
    }

    if (el.type === 'paren') {
      parens++;
      if (plainLen(el.text, L.PAREN.w) > 2) add('tip', 'Parenthetical is long. Keep it to a few words, or move it to action.', el.line);
      if (!next || (next.type !== 'dialogue' && next.type !== 'paren')) add('fix', 'Parenthetical has no dialogue after it.', el.line);
    }

    if (el.type === 'transition') {
      transitions++;
      if (prev && prev.type === 'transition') add('tip', 'Two transitions in a row.', el.line);
    }
  });

  // name typos: two speaker names that are almost the same
  const names = Object.keys(speakers);
  for (let a = 0; a < names.length; a++) {
    for (let b = a + 1; b < names.length; b++) {
      const [x, y] = [names[a], names[b]];
      if (Math.min(x.length, y.length) >= 4 && editDistance(x, y) <= (Math.max(x.length, y.length) >= 7 ? 2 : 1)) {
        const rare = speakers[x] <= speakers[y] ? x : y;
        const line = (elements.find((e) => e.type === 'character' && nameBase(e.text) === rare) || {}).line || 0;
        add('fix', `"${x}" and "${y}" look like the same character spelled two ways.`, line);
      }
    }
  }

  if (speeches >= 8 && parens / speeches > 0.33) add('tip', `Parentheticals on ${Math.round((parens / speeches) * 100)}% of speeches. Most pros use them rarely.`, 0);
  const sceneCount = elements.filter((e) => e.type === 'scene').length;
  if (sceneCount >= 4 && transitions >= sceneCount * 0.6) add('tip', 'A transition after almost every scene. Spec scripts usually skip "CUT TO:".', 0);
  if (!sceneCount && elements.length) add('fix', 'No scene headings found. Start scenes with INT. or EXT.', 0);

  if (pages) {
    let kind = 'short film length';
    if (pages >= 85 && pages <= 125) kind = 'feature film length (90-120 is the studio norm)';
    else if (pages > 125) kind = 'long for a feature. Studios expect 90-120 pages';
    else if (pages >= 45 && pages < 85) kind = pages <= 65 ? 'one-hour TV length (45-65 pages)' : 'between TV and feature length';
    else if (pages >= 22 && pages < 45) kind = 'half-hour TV length (22-45 pages)';
    add('tip', `${pages} page${pages === 1 ? '' : 's'}: ${kind}.`, 0);
  }

  items.sort((a, b) => a.line - b.line || (a.level === 'fix' ? -1 : 1));
  const fixes = items.filter((i) => i.level === 'fix').length;
  const tips = items.length - fixes;
  const summary = fixes === 0 ? `Format looks studio-ready. ${tips} suggestion${tips === 1 ? '' : 's'}.` : `${fixes} format fix${fixes === 1 ? '' : 'es'} needed, ${tips} suggestion${tips === 1 ? '' : 's'}.`;
  return { items, fixes, tips, summary };
}

/** studioFix(src) -> { text, changes }  Safe, mechanical fixes only. Never rewrites the author's words. */
export function studioFix(src) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  let changes = 0;
  const set = (i, v) => { if (lines[i] !== v) { lines[i] = v; changes++; } };
  const blank = (i) => i < 0 || i >= lines.length || lines[i].trim() === '';

  // skip the title page block
  let start = 0;
  if (/^(title|credit|author|authors|source|draft date|date|contact|copyright)\s*:/i.test(lines[0] || '')) {
    while (start < lines.length && lines[start].trim() !== '') start++;
  }

  for (let i = start; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (raw !== raw.trimEnd()) set(i, raw.trimEnd());
    if (!t) continue;
    const prevBlank = blank(i - 1);

    // scene headings
    if (prevBlank && /^(int|ext|est|int\.?\s?\/\s?ext|i\/e)[.\s]/i.test(t) && (blank(i + 1) || /^(int|ext|est)\./i.test(t))) {
      let h = t.toUpperCase();
      h = h.replace(/^(INT|EXT|EST)\s+(?!\/)/, '$1. ').replace(/^INT\.?\s?\/\s?EXT\.?\s*/, 'INT./EXT. ').replace(/^(INT|EXT|EST)\.(?=\S)/, '$1. ');
      h = h.replace(/\s*(?:--|–|—)\s*/g, ' - ').replace(/\s+-\s+/g, ' - ').replace(/\s{2,}/g, ' ').replace(/[.,;:]+$/, '');
      set(i, h);
      continue;
    }
    // character cues: caps line, blank above, text below
    if (prevBlank && !blank(i + 1) && !/^[!@.>]/.test(t)) {
      const base = t.replace(/\(.*$/, '').trim();
      if (base && base === base.toUpperCase() && /[A-Z]/.test(base)) {
        const cleaned = t.replace(/\s*\(cont[’']?d\)/gi, '').replace(/\s{2,}/g, ' ').trim();
        set(i, cleaned);
        continue;
      }
    }
    // transitions
    if (prevBlank && blank(i + 1) && /^(cut to|dissolve to|smash cut to|match cut to|fade to)\s*[:.]?$/i.test(t)) {
      set(i, t.toUpperCase().replace(/[:.]?$/, ':'));
    }
  }

  // collapse 3+ blank lines to one blank line
  const out = [];
  let run = 0;
  for (const l of lines) {
    if (l.trim() === '') { run++; if (run > 1) { changes++; continue; } } else run = 0;
    out.push(l);
  }
  return { text: out.join('\n'), changes };
}
