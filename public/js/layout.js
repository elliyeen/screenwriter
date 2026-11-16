// Screenplay layout engine: elements -> pages of positioned lines.
// Industry grid: Courier 12pt = 10 chars/inch, 6 lines/inch, US Letter.
// Every line gets an absolute column, so the preview and the PDF match exactly.

import { parse, parseInline, nameBase } from './fountain.js';

export const L = {
  LINES: 54, // 9in of text area / 12pt
  ACTION: { col: 15, w: 60 }, // 1.5in left, 6.0in wide
  DIALOGUE: { col: 25, w: 35 }, // 2.5in, 3.5in wide
  PAREN: { col: 30, w: 25 }, // 3.0in
  CUE: { col: 35 }, // 3.5in
  RIGHT: 75, // 7.5in right edge
  PAGE_NUM_END: 72.5, // 7.25in
};

const runLen = (runs) => runs.reduce((n, r) => n + r.t.length, 0);
const upper = (runs) => runs.map((r) => ({ ...r, t: r.t.toUpperCase() }));
const plain = (runs) => runs.map((r) => r.t).join('');

function charsToRuns(chars) {
  const runs = [];
  for (const ch of chars) {
    const last = runs[runs.length - 1];
    if (last && last.b === ch.b && last.i === ch.i && last.u === ch.u) last.t += ch.c;
    else runs.push({ t: ch.c, b: ch.b, i: ch.i, u: ch.u });
  }
  return runs;
}

/** Greedy word wrap that keeps bold/italic/underline. firstWidth/restWidth in columns. */
export function wrapRuns(runs, firstWidth, restWidth = firstWidth) {
  const paras = [[]];
  for (const r of runs) {
    r.t.split('\n').forEach((part, idx) => {
      if (idx > 0) paras.push([]);
      if (part) paras[paras.length - 1].push({ ...r, t: part });
    });
  }
  const out = [];
  for (const para of paras) {
    const words = [];
    let cur = [];
    for (const r of para) {
      for (const c of r.t) {
        if (c === ' ') {
          if (cur.length) { words.push(cur); cur = []; }
        } else cur.push({ c, b: r.b, i: r.i, u: r.u });
      }
    }
    if (cur.length) words.push(cur);
    if (!words.length) { out.push([]); continue; }

    let line = [];
    let w = firstWidth;
    const flush = () => { out.push(line); line = []; w = restWidth; };
    for (let word of words) {
      while (word.length > w) {
        if (line.length) flush();
        line = word.slice(0, w);
        word = word.slice(w);
        flush();
      }
      if (!line.length) line = word.slice();
      else if (line.length + 1 + word.length <= w) {
        const prev = line[line.length - 1];
        line = line.concat({ c: ' ', b: prev.b, i: prev.i, u: prev.u && word[0].u }, word);
      } else {
        flush();
        line = word.slice();
      }
    }
    if (line.length) out.push(line);
  }
  return out.map(charsToRuns);
}

function buildBlocks(elements, opts) {
  const blocks = [];
  let lastSpeaker = null;
  let sceneIndex = -1;
  for (let k = 0; k < elements.length; k++) {
    const el = elements[k];
    if (el.type === 'scene') {
      sceneIndex++;
      lastSpeaker = null;
      let runs = upper(parseInline(el.text));
      if (opts.boldScenes) runs = runs.map((r) => ({ ...r, b: true }));
      const lines = wrapRuns(runs, opts.sceneNumbers ? 52 : L.ACTION.w).map((r) => ({ col: L.ACTION.col, runs: r }));
      if (opts.sceneNumbers && lines.length) {
        const num = String(sceneIndex + 1);
        lines[0].extras = [{ col: L.ACTION.col - 2 - num.length, runs: [{ t: num }] }, { col: 76, runs: [{ t: num }] }];
      }
      blocks.push({ kind: 'scene', lines, sceneIndex, el, gap: opts.sceneSpacing === 2 ? 2 : 1 });
    } else if (el.type === 'action') {
      const lines = wrapRuns(parseInline(el.text), L.ACTION.w).map((r) => ({ col: L.ACTION.col, runs: r }));
      blocks.push({ kind: 'action', lines, el });
    } else if (el.type === 'center') {
      const lines = wrapRuns(parseInline(el.text), L.ACTION.w).map((r) => ({
        col: L.ACTION.col + Math.floor((L.ACTION.w - runLen(r)) / 2),
        runs: r,
      }));
      blocks.push({ kind: 'center', lines, el });
    } else if (el.type === 'transition') {
      const lines = wrapRuns(upper(parseInline(el.text)), 30).map((r) => ({ col: L.RIGHT - runLen(r), runs: r }));
      blocks.push({ kind: 'transition', lines, el });
    } else if (el.type === 'pagebreak') {
      blocks.push({ kind: 'break' });
    } else if (el.type === 'character') {
      const name = el.text.trim();
      const base = nameBase(name);
      const hasContd = /\(cont[’']?d\)/i.test(name);
      const contd = !hasContd && opts.contd && base === lastSpeaker;
      const cueText = name.toUpperCase() + (contd ? " (CONT'D)" : '');
      const body = [];
      while (k + 1 < elements.length && (elements[k + 1].type === 'dialogue' || elements[k + 1].type === 'paren')) {
        const d = elements[++k];
        if (d.type === 'paren') {
          wrapRuns(parseInline(d.text), L.PAREN.w, L.PAREN.w - 1).forEach((r, idx) =>
            body.push({ col: L.PAREN.col + (idx ? 1 : 0), runs: r, paren: true }));
        } else {
          wrapRuns(parseInline(d.text), L.DIALOGUE.w).forEach((r) =>
            body.push({ col: L.DIALOGUE.col, runs: r, paren: false }));
        }
      }
      lastSpeaker = base;
      blocks.push({ kind: 'dialogue', cueText, name, body, el });
    }
  }
  return blocks;
}

const headMin = (nx) =>
  nx.kind === 'dialogue' ? Math.min(1 + nx.body.length, 3) : nx.lines ? Math.min(nx.lines.length, 2) : 0;

export function paginate(blocks) {
  const pages = [];
  const scenePages = [];
  let cur = { lines: [] };
  let used = 0;
  const place = (ln) => {
    cur.lines.push({ row: used, col: ln.col, runs: ln.runs });
    if (ln.extras) for (const x of ln.extras) cur.lines.push({ row: used, col: x.col, runs: x.runs });
    used++;
  };
  const newPage = () => { pages.push(cur); cur = { lines: [] }; used = 0; };
  const cueLine = (text) => ({ col: L.CUE.col, runs: [{ t: text }] });
  const MORE = { col: L.CUE.col, runs: [{ t: '(MORE)' }] };

  const placeDialogue = (b) => {
    let body = b.body.slice();
    let cueText = b.cueText;
    for (let guard = 0; guard < 500; guard++) {
      const gap = used > 0 ? 1 : 0;
      const av = L.LINES - used - gap;
      if (1 + body.length <= av) {
        used += gap;
        place(cueLine(cueText));
        body.forEach(place);
        return;
      }
      const maxK = Math.min(av - 2, body.length - 2);
      let k = -1;
      for (let t = maxK; t >= Math.max(2, maxK - 4); t--) {
        if (!body[t - 1].paren && /[.?!…"”’)]$/.test(plain(body[t - 1].runs))) { k = t; break; }
      }
      if (k < 0) for (let t = maxK; t >= 2; t--) if (!body[t - 1].paren) { k = t; break; }
      if (k >= 2) {
        used += gap;
        place(cueLine(cueText));
        body.slice(0, k).forEach(place);
        place(MORE);
        newPage();
        body = body.slice(k);
        cueText = /\(cont[’']?d\)/i.test(b.name) ? b.name.toUpperCase() : b.name.toUpperCase() + " (CONT'D)";
        continue;
      }
      if (used > 0) { newPage(); continue; }
      // Cannot split and page is empty: force it (should not happen)
      place(cueLine(cueText));
      body.forEach(place);
      return;
    }
  };

  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    if (b.kind === 'break') { if (used > 0) newPage(); continue; }
    if (b.kind === 'dialogue') { placeDialogue(b); continue; }

    let lines = b.lines;
    const h = lines.length;
    const gap = used > 0 ? b.gap || 1 : 0;
    let need = h;
    if (b.kind === 'scene') {
      const nx = blocks[bi + 1];
      if (nx && nx.kind !== 'break') need = h + 1 + headMin(nx);
    }
    if (need <= L.LINES - used - gap) {
      used += gap;
      if (b.kind === 'scene') scenePages[b.sceneIndex] = pages.length + 1;
      lines.forEach(place);
      continue;
    }
    if (b.kind === 'action') {
      for (let guard = 0; guard < 500; guard++) {
        const g = used > 0 ? 1 : 0;
        const av = L.LINES - used - g;
        if (lines.length <= av) { used += g; lines.forEach(place); break; }
        const k = Math.min(av, lines.length - 2);
        if (k >= 2) { used += g; lines.slice(0, k).forEach(place); lines = lines.slice(k); newPage(); continue; }
        if (used > 0) { newPage(); continue; }
        lines.forEach(place);
        break;
      }
      continue;
    }
    // scene / transition / center: move to next page
    if (used > 0) newPage();
    if (b.kind === 'scene') scenePages[b.sceneIndex] = pages.length + 1;
    lines.forEach(place);
  }
  if (cur.lines.length || !pages.length) pages.push(cur);
  return { pages, scenePages };
}

function titlePage(meta) {
  const lines = [];
  const centerLine = (runs, row) => lines.push({ row, col: L.ACTION.col + Math.floor((L.ACTION.w - runLen(runs)) / 2), runs });
  let row = 16;
  const titleLines = wrapRuns(upper(parseInline(meta.title || 'UNTITLED')).map((r) => ({ ...r, u: true })), 40);
  titleLines.forEach((r) => centerLine(r, row++));
  row += 2;
  if (meta.credit || meta.author) {
    centerLine([{ t: meta.credit || 'Written by' }], row);
    row += 2;
  }
  if (meta.author) {
    wrapRuns(parseInline(meta.author), 50).forEach((r) => centerLine(r, row++));
    row += 1;
  }
  if (meta.source) {
    wrapRuns(parseInline(meta.source), 50).forEach((r) => centerLine(r, row++));
  }
  const left = [meta.contact, meta.copyright].filter(Boolean).join('\n');
  if (left) {
    const ls = wrapRuns(parseInline(left), 30);
    ls.forEach((r, idx) => lines.push({ row: L.LINES - ls.length + idx, col: L.ACTION.col, runs: r }));
  }
  if (meta.draft) {
    const ds = wrapRuns(parseInline(meta.draft), 24);
    ds.forEach((r, idx) => lines.push({ row: L.LINES - ds.length + idx, col: L.RIGHT - runLen(r), runs: r }));
  }
  return { lines, title: true, showNumber: false, number: 0 };
}

/**
 * layoutScript(src, {contd, titlePage}) ->
 *   { meta, pages, scenes, characters, stats }
 * pages[]: { lines:[{row,col,runs}], title?, number, showNumber }
 */
export function layoutScript(src, opts = {}) {
  const o = { contd: true, titlePage: true, boldScenes: false, sceneNumbers: false, sceneSpacing: 1, ...opts };
  const { meta, elements } = parse(src);
  const blocks = buildBlocks(elements, o);
  const { pages: body, scenePages } = paginate(blocks);
  body.forEach((p, idx) => { p.number = idx + 1; p.showNumber = idx >= 1; });

  const hasMeta = Object.values(meta).some(Boolean);
  const pages = o.titlePage && hasMeta ? [titlePage(meta), ...body] : body;

  const scenes = blocks
    .filter((b) => b.kind === 'scene')
    .map((b) => ({ text: plain(b.lines.map((l) => l.runs).flat()), line: b.el.line, page: scenePages[b.sceneIndex] }));

  const characters = {};
  for (const b of blocks) {
    if (b.kind === 'dialogue') {
      const base = nameBase(b.name);
      characters[base] = (characters[base] || 0) + 1;
    }
  }
  const words = (String(src).match(/\S+/g) || []).length;
  return {
    meta,
    pages,
    hasTitlePage: pages.length > body.length,
    scenes,
    characters,
    stats: { pages: body.length, scenes: scenes.length, words, minutes: body.length },
  };
}
