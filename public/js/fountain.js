// Fountain parser: plain text -> screenplay elements.
// No dependencies. Works in the browser and in Node.
// Fountain spec: https://fountain.io/syntax

const TITLE_KEYS = [
  'title', 'credit', 'author', 'authors', 'source',
  'draft date', 'date', 'contact', 'copyright', 'notes',
];
const SCENE_LC = /^(int|ext|est|int\.?\/ext|i\/e)\./i;
const SCENE_UC = /^(INT|EXT|EST|INT\/EXT|I\/E)\s/;

// Remove /* boneyard */ and [[notes]] but keep line counts so line numbers stay true.
function stripInvisible(text) {
  const keepNewlines = (m) => m.replace(/[^\n]/g, '');
  return text.replace(/\/\*[\s\S]*?\*\//g, keepNewlines).replace(/\[\[[\s\S]*?\]\]/g, keepNewlines);
}

function parseTitle(lines) {
  const meta = {};
  const first = /^([A-Za-z ]+?)\s*:\s*(.*)$/.exec(lines[0] || '');
  if (!first || !TITLE_KEYS.includes(first[1].toLowerCase())) return { meta, consumed: 0 };
  let key = null;
  let i = 0;
  for (; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.trim() === '') break;
    const m = /^([A-Za-z ]+?)\s*:\s*(.*)$/.exec(ln);
    if (m && TITLE_KEYS.includes(m[1].toLowerCase()) && !/^\s/.test(ln)) {
      key = m[1].toLowerCase();
      meta[key] = m[2];
    } else if (key && /^\s+/.test(ln)) {
      meta[key] += (meta[key] ? '\n' : '') + ln.trim();
    } else {
      break;
    }
  }
  return { meta, consumed: i };
}

export function normalizeMeta(meta) {
  return {
    title: meta.title || '',
    credit: meta.credit || '',
    author: meta.author || meta.authors || '',
    source: meta.source || '',
    draft: meta['draft date'] || meta.date || '',
    contact: meta.contact || '',
    copyright: meta.copyright || '',
  };
}

export function nameBase(name) {
  return name.replace(/\(.*?\)/g, '').replace(/\^$/, '').trim().toUpperCase();
}

/**
 * parse(src) -> { meta, elements }
 * element: { type, text, line }
 * types: scene | action | character | paren | dialogue | transition | center | pagebreak
 */
export function parse(src) {
  const text = stripInvisible(String(src).replace(/\r\n?/g, '\n'));
  const lines = text.split('\n');
  const { meta, consumed } = parseTitle(lines);
  const elements = [];
  const blank = (idx) => idx < 0 || idx >= lines.length || lines[idx].trim() === '';

  let i = consumed;
  while (i < lines.length) {
    const t = lines[i].replace(/\t/g, '    ').trim();
    if (t === '') { i++; continue; }

    if (/^={3,}$/.test(t)) { elements.push({ type: 'pagebreak', text: '', line: i }); i++; continue; }
    if (/^#+\s/.test(t) || /^=(?!=)/.test(t)) { i++; continue; } // sections / synopses

    const prevBlank = blank(i - 1);
    const nextBlank = blank(i + 1);

    // Scene heading
    if (/^\.(?!\.)/.test(t) || (prevBlank && (SCENE_LC.test(t) || SCENE_UC.test(t)))) {
      let h = t.replace(/^\.(?!\.)/, '').replace(/\s*#[^#]+#\s*$/, '').trim();
      elements.push({ type: 'scene', text: h, line: i });
      i++;
      continue;
    }

    // Centered  > text <
    if (/^>.*<$/.test(t)) {
      elements.push({ type: 'center', text: t.slice(1, -1).trim(), line: i });
      i++;
      continue;
    }
    // Transition
    if (/^>/.test(t) || (prevBlank && nextBlank && t === t.toUpperCase() && /TO:$/.test(t))) {
      elements.push({ type: 'transition', text: t.replace(/^>\s*/, ''), line: i });
      i++;
      continue;
    }

    // Character + dialogue block
    const forcedChar = /^@/.test(t);
    const baseCue = t.replace(/^@/, '').replace(/\(.*$/, '').trim();
    const looksLikeCue =
      forcedChar ||
      (prevBlank && !nextBlank && baseCue !== '' && baseCue === baseCue.toUpperCase() && /[A-Z]/.test(baseCue) && !/^!/.test(t));
    if (looksLikeCue) {
      elements.push({ type: 'character', text: t.replace(/^@/, '').replace(/\^$/, '').trim(), line: i });
      i++;
      while (i < lines.length && lines[i].trim() !== '') {
        const d = lines[i].replace(/\t/g, '    ').trim();
        if (/^\(.*\)$/.test(d)) elements.push({ type: 'paren', text: d, line: i });
        else elements.push({ type: 'dialogue', text: d, line: i });
        i++;
      }
      continue;
    }

    // Action (one paragraph = consecutive non-blank lines)
    const start = i;
    const parts = [];
    while (i < lines.length && lines[i].trim() !== '') {
      let p = lines[i].replace(/\t/g, '    ').trim();
      if (i === start) p = p.replace(/^!/, '');
      parts.push(p);
      i++;
    }
    elements.push({ type: 'action', text: parts.join('\n'), line: start });
  }
  return { meta: normalizeMeta(meta), elements };
}

/**
 * parseInline("a **b** *c* _d_") -> [{t, b, i, u}]
 * Markers only count when a closing marker exists, so "(Cowboys*)" stays plain.
 */
export function parseInline(s) {
  const runs = [];
  let buf = '';
  let b = false, i = false, u = false;
  const flush = () => { if (buf) { runs.push({ t: buf, b, i, u }); buf = ''; } };
  for (let p = 0; p < s.length;) {
    const c = s[p];
    if (c === '\\' && p + 1 < s.length) { buf += s[p + 1]; p += 2; continue; }
    let m = null;
    if (s.startsWith('***', p)) m = '***';
    else if (s.startsWith('**', p)) m = '**';
    else if (c === '*') m = '*';
    else if (c === '_') m = '_';
    if (m) {
      const active = m === '***' ? (b && i) : m === '**' ? b : m === '*' ? i : u;
      let ok;
      if (m === '_') {
        ok = active ? !/[A-Za-z0-9]/.test(s[p + 1] || '') : (p === 0 || !/[A-Za-z0-9]/.test(s[p - 1])) && s.indexOf('_', p + 1) !== -1;
      } else {
        ok = active || s.indexOf(m, p + m.length) !== -1;
      }
      if (ok) {
        flush();
        if (m === '***') { b = !b; i = !i; }
        else if (m === '**') b = !b;
        else if (m === '*') i = !i;
        else u = !u;
        p += m.length;
        continue;
      }
    }
    buf += c;
    p++;
  }
  flush();
  return runs;
}
