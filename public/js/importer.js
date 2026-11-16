// Upload-and-format: turns a Word doc, Final Draft file, or plain text into Fountain.
// Rule-based only (no LLM). Works in the browser and in Node 18+.

// ---------- tiny zip reader (a .docx is a zip) ----------
async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export async function unzipEntry(buffer, wanted) {
  const b = new Uint8Array(buffer);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid .docx file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
    if (name === wanted) {
      const ln = dv.getUint16(local + 26, true);
      const le = dv.getUint16(local + 28, true);
      const start = local + 30 + ln + le;
      const data = b.subarray(start, start + csize);
      const out = method === 0 ? data : await inflateRaw(data);
      return new TextDecoder().decode(out);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('This .docx has no document text');
}

// ---------- readers: each returns paragraphs [{ plain, marked, indent, align, style }] ----------
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
const on = (rpr, tag) => {
  const m = new RegExp(`<w:${tag}(?:\\s[^>]*)?/?>`).exec(rpr);
  return !!m && !/w:val="(0|false|none)"/.test(m[0]);
};

export function docxToParas(xml) {
  const paras = [];
  const body = xml.replace(/<w:instrText[\s\S]*?<\/w:instrText>/g, '');
  for (const pm of body.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)) {
    const inner = pm[1];
    const ppr = (/<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(inner) || [, ''])[1];
    const align = (/<w:jc w:val="(\w+)"/.exec(ppr) || [])[1] || null;
    const ind = /<w:ind[^>]*w:(?:left|start)="(-?\d+)"/.exec(ppr);
    const style = ((/<w:pStyle w:val="([^"]+)"/.exec(ppr) || [])[1] || '').toLowerCase();
    let plain = '';
    let marked = '';
    for (const rm of inner.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)) {
      const r = rm[1];
      const rpr = (/<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(r) || [, ''])[1];
      let t = '';
      for (const tm of r.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g)) {
        if (tm[0].startsWith('<w:t') && tm[1] !== undefined) t += unxml(tm[1]);
        else if (tm[0] === '<w:tab/>') t += '    ';
        else t += ' ';
      }
      if (!t) continue;
      if (on(rpr, 'caps')) t = t.toUpperCase();
      plain += t;
      const core = t.trim();
      if (!core) { marked += t; continue; }
      const lead = t.slice(0, t.indexOf(core));
      const trail = t.slice(lead.length + core.length);
      let m = core.replace(/\*/g, '\\*');
      if (on(rpr, 'u')) m = `_${m}_`;
      if (on(rpr, 'b') && on(rpr, 'i')) m = `***${m}***`;
      else if (on(rpr, 'b')) m = `**${m}**`;
      else if (on(rpr, 'i')) m = `*${m}*`;
      marked += lead + m + trail;
    }
    // join neighbouring styled runs:  *a* *b* -> *a b*
    marked = marked.replace(/\*\*\*(\s*)\*\*\*/g, '$1').replace(/\*\*(\s*)\*\*/g, '$1').replace(/(?<!\*)\*(\s*)\*(?!\*)/g, '$1').replace(/_(\s*)_/g, '$1');
    const leadSpaces = plain.length - plain.trimStart().length;
    paras.push({
      plain: plain.trim(),
      marked: marked.trim(),
      indent: (ind ? Math.round(Number(ind[1]) / 144) : 0) + leadSpaces,
      align: align === 'center' ? 'center' : align === 'right' || align === 'end' ? 'right' : null,
      style,
    });
  }
  return paras;
}

export function fdxToParas(xml) {
  const map = { 'scene heading': 'scene', action: 'action', character: 'character', dialogue: 'dialogue', parenthetical: 'parenthetical', transition: 'transition', general: 'action', shot: 'scene' };
  const paras = [];
  const content = (/<Content>([\s\S]*?)<\/Content>/.exec(xml) || [, xml])[1];
  for (const pm of content.matchAll(/<Paragraph([^>]*)>([\s\S]*?)<\/Paragraph>/g)) {
    const type = ((/Type="([^"]+)"/.exec(pm[1]) || [])[1] || 'Action').toLowerCase();
    let plain = '';
    for (const tm of pm[2].matchAll(/<Text[^>]*>([\s\S]*?)<\/Text>/g)) plain += unxml(tm[1]);
    paras.push({ plain: plain.trim(), marked: plain.trim(), indent: 0, align: null, style: map[type] || 'action' });
  }
  return paras;
}

// ---------- classification rules ----------
const SCENE = /^(INT|EXT|EST|INT\.?\s?\/\s?EXT|I\/E)[.\s]/i;
const TRANS = /^(CUT TO|DISSOLVE TO|SMASH CUT( TO)?|MATCH CUT( TO)?|FADE TO( BLACK)?|FADE OUT|JUMP CUT( TO)?|WIPE TO)\s*[:.]?$/i;
const NOISE = /^(\d{1,3}\.?|\(MORE\)|\(CONTINUED\)|CONTINUED:?(\s*\(\d+\))?)$/i;
const stripContd = (s) => s.replace(/\s*\(CONT[’']?D\)/gi, '').trim();

function isCue(s) {
  const base = s.replace(/\(.*?\)/g, '').trim();
  if (!base || base.length > 38) return false;
  if (base !== base.toUpperCase() || !/[A-Z]/.test(base)) return false;
  if (/[.!?:,;]$/.test(base)) return false;
  if (SCENE.test(s) || TRANS.test(s)) return false;
  return base.split(/\s+/).length <= 4;
}
const NAME_COLON = /^([A-Za-z][A-Za-z0-9 .'’\-]{0,28}?)(\s*\([^)]*\))?\s*:\s+(\S.*)$/;
const isParen = (s) => /^\(.*\)$/.test(s);
const safeAction = (s) => (/^([#=>@!]|\.(?!\.))/.test(s) ? '!' + s : s);

function styleKind(style) {
  if (!style) return null;
  if (/scene|slug/.test(style)) return 'scene';
  if (/character/.test(style)) return 'character';
  if (/parenth/.test(style)) return 'parenthetical';
  if (/dialog/.test(style)) return 'dialogue';
  if (/transition/.test(style)) return 'transition';
  if (/action|general/.test(style)) return 'action';
  return null;
}

/** paragraphs -> { fountain, report } */
export function parasToFountain(input) {
  const P = input.filter((p) => p.plain && !NOISE.test(p.plain));
  const out = [];
  const report = { scenes: 0, dialogue: 0, action: 0, transitions: 0 };
  const emit = (block) => out.push(block);

  // Speakers written as "Name: line". Trust all-caps names, or names used at least twice.
  const counts = {};
  for (const p of P) {
    const m = NAME_COLON.exec(p.plain);
    if (m && !SCENE.test(p.plain)) counts[m[1].trim().toUpperCase()] = (counts[m[1].trim().toUpperCase()] || 0) + 1;
  }
  const colonSpeaker = (s) => {
    const m = NAME_COLON.exec(s);
    if (!m || SCENE.test(s) || /^(title|author|written by|by|draft|contact|note|notes)$/i.test(m[1].trim())) return null;
    const name = m[1].trim();
    if (name.split(/\s+/).length > 3) return null;
    if (name === name.toUpperCase() || counts[name.toUpperCase()] >= 2) return m;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total >= 3 && name.split(/\s+/).length <= 2 && name.split(/\s+/).every((w) => /^[A-Z]/.test(w))) return m;
    return null;
  };

  // Title page: short first lines before the first scene heading, with a "by" line.
  let i = 0;
  const firstScene = P.findIndex((p) => SCENE.test(p.plain) || styleKind(p.style) === 'scene');
  const head = P.slice(0, firstScene < 0 ? Math.min(P.length, 6) : Math.min(firstScene, 6));
  const byIdx = head.findIndex((p) => /^(written\s+)?by\b/i.test(p.plain));
  if (head.length && byIdx >= 1 && head[0].plain.length <= 80) {
    const title = head.slice(0, byIdx).map((p) => p.plain).join(' ');
    let author = head[byIdx].plain.replace(/^(written\s+)?by\s*:?\s*/i, '');
    let used = byIdx + 1;
    if (!author && head[byIdx + 1]) { author = head[byIdx + 1].plain; used++; }
    let block = `Title: ${title}\nCredit: Written by\nAuthor: ${author}`;
    if (firstScene >= 0 && firstScene - used <= 4) {
      const extra = P.slice(used, firstScene).map((p) => p.plain);
      const draft = extra.filter((x) => /draft|revision|\b(19|20)\d\d\b|\d{1,2}\/\d{1,2}/i.test(x));
      const contact = extra.filter((x) => !draft.includes(x));
      if (draft.length) block += `\nDraft date: ${draft.join(', ')}`;
      if (contact.length) block += `\nContact:\n` + contact.map((x) => '    ' + x).join('\n');
      used = firstScene;
    }
    emit(block);
    i = used;
  } else if (head.length && head[0].align === 'center' && head[0].plain.length <= 80 && !isCue(head[0].plain)) {
    emit(`Title: ${head[0].plain}`);
    i = 1;
  }

  const kindOf = (p) => {
    const k = styleKind(p.style);
    if (k) return k;
    const s = p.plain;
    if (SCENE.test(s)) return 'scene';
    if (TRANS.test(s) || (s === s.toUpperCase() && /\bTO:$/.test(s)) || (p.align === 'right' && s === s.toUpperCase() && s.length < 30)) return 'transition';
    return null;
  };

  while (i < P.length) {
    const p = P[i];
    const s = p.plain;
    const k = kindOf(p);

    if (k === 'scene') { emit(s.toUpperCase().replace(/^(INT|EXT|EST)\s/, '$1. ')); report.scenes++; i++; continue; }
    if (k === 'transition') {
      const t = s.toUpperCase();
      emit(/TO:$/.test(t) ? t : '> ' + t);
      report.transitions++; i++; continue;
    }

    const colon = k ? null : colonSpeaker(s);
    if (colon) {
      const lines = [colon[1].trim().toUpperCase() + (colon[2] ? ' ' + colon[2].trim().toUpperCase() : '')];
      const rest = colon[3].trim();
      const pm = /^(\([^)]*\))\s*(.*)$/.exec(rest);
      if (pm && pm[2]) { lines.push(pm[1], pm[2]); } else lines.push(rest);
      emit(lines.join('\n'));
      report.dialogue++; i++; continue;
    }

    const next = P[i + 1];
    const cueByStyle = k === 'character';
    if (cueByStyle || (!k && isCue(s) && next && !kindOf(next) && !isCue(next.plain))) {
      const lines = [stripContd(s).toUpperCase()];
      const cueIndent = p.indent;
      i++;
      let dialogueIndent = null;
      let lastWasParen = false;
      while (i < P.length) {
        const q = P[i];
        const qk = styleKind(q.style);
        if (qk === 'parenthetical' || (!qk && isParen(q.plain))) { lines.push(q.plain.startsWith('(') ? q.plain : `(${q.plain})`); lastWasParen = true; i++; continue; }
        if (qk && qk !== 'dialogue') break;
        if (!qk && (kindOf(q) || isCue(q.plain) || colonSpeaker(q.plain))) break;
        const sameColumn = dialogueIndent !== null && q.indent === dialogueIndent && q.indent > 0 && q.indent < cueIndent;
        if (qk === 'dialogue' || dialogueIndent === null || lastWasParen || sameColumn) {
          lines.push(q.marked);
          if (dialogueIndent === null) dialogueIndent = q.indent;
          lastWasParen = false;
          i++;
          continue;
        }
        break;
      }
      if (lines.length > 1) { emit(lines.join('\n')); report.dialogue++; }
      else { emit(safeAction(s)); report.action++; }
      continue;
    }

    if (p.align === 'center' && !k) emit(`> ${p.marked} <`);
    else emit(safeAction(p.marked));
    report.action++;
    i++;
  }
  return { fountain: out.join('\n\n') + '\n', report };
}

/** Plain text -> paragraphs. Handles hard-wrapped scripts (blank lines between blocks) and one-paragraph-per-line text. */
export function textToParas(text) {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\f/g, '\n').replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n');
  const nonBlank = lines.filter((l) => l.trim()).length;
  const blanks = lines.length - nonBlank;
  const para = (raw) => ({ plain: raw.trim(), marked: raw.trim(), indent: raw.replace(/\t/g, '    ').length - raw.replace(/\t/g, '    ').trimStart().length, align: null, style: '' });
  if (blanks < nonBlank * 0.1) return lines.filter((l) => l.trim()).map(para);

  const paras = [];
  let block = [];
  const ind = (raw) => para(raw).indent;
  const columned = lines.some((l) => l.trim() && ind(l) >= 15);
  const flush = () => {
    if (!block.length) return;
    const first = block[0].trim();
    const cueShape = block.length > 1 && isCue(first) && !SCENE.test(first) && (!columned || ind(block[0]) > ind(block[1]));
    if (cueShape) {
      paras.push(para(block[0]));
      let buf = [];
      const push = () => { if (buf.length) { paras.push({ ...para(buf[0]), plain: buf.map((x) => x.trim()).join(' '), marked: buf.map((x) => x.trim()).join(' ') }); buf = []; } };
      let open = null; // a parenthetical wrapped over several lines
      for (const l of block.slice(1)) {
        const tl = l.trim();
        if (open !== null) {
          open += ' ' + tl;
          if (tl.endsWith(')')) { paras.push({ ...para(l), plain: open, marked: open }); open = null; }
        } else if (isParen(tl)) { push(); paras.push(para(l)); }
        else if (tl.startsWith('(') && !tl.includes(')') && !buf.length) { push(); open = tl; }
        else buf.push(l);
      }
      if (open !== null) buf.push(open);
      push();
    } else if (block.every((l) => NAME_COLON.test(l.trim())) || SCENE.test(first)) {
      const rest = SCENE.test(first) ? block.slice(1) : [];
      if (SCENE.test(first)) {
        paras.push(para(block[0]));
        if (rest.length) paras.push({ ...para(rest[0]), plain: rest.map((x) => x.trim()).join(' '), marked: rest.map((x) => x.trim()).join(' ') });
      } else block.forEach((l) => paras.push(para(l)));
    } else {
      const joined = block.map((x) => x.trim()).join(' ');
      paras.push({ ...para(block[0]), plain: joined, marked: joined });
    }
    block = [];
  };
  for (const l of lines) { if (l.trim()) block.push(l); else flush(); }
  flush();
  return paras;
}

/**
 * PDF -> plain text that keeps indentation and blank lines, so the text rules above can read it.
 * pdfjsLib is passed in (loaded only when someone uploads a PDF).
 */
export async function pdfToText(data, pdfjsLib) {
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  const rows = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    const byY = new Map();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      let key = [...byY.keys()].find((k) => Math.abs(k - y) <= 2);
      if (key === undefined) { key = y; byY.set(key, []); }
      byY.get(key).push({ x: it.transform[4], str: it.str, w: it.width || 0 });
    }
    const ys = [...byY.keys()].sort((a, b) => b - a);
    ys.forEach((y, idx) => {
      const items = byY.get(y).sort((a, b) => a.x - b.x);
      let text = '';
      let endX = null;
      for (const it of items) {
        if (endX !== null && it.x - endX > 2 && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' ';
        text += it.str;
        endX = it.x + it.w;
      }
      rows.push({ text: text.trim(), x: items[0].x, y, first: idx === 0 });
    });
  }
  if (!rows.length) throw new Error('This PDF has no readable text. It may be a scan. Try a .docx or .txt file.');
  const gaps = [];
  for (let i = 1; i < rows.length; i++) if (!rows[i].first) gaps.push(rows[i - 1].y - rows[i].y);
  gaps.sort((a, b) => a - b);
  const lineGap = gaps.length ? gaps[Math.floor(gaps.length / 4)] || 12 : 12; // tight spacing = single line
  const body = rows.filter((r) => !NOISE.test(r.text));
  const minX = Math.min(...body.map((r) => r.x));
  const charW = 7.2 * (lineGap / 12);
  let out = '';
  rows.forEach((r, i) => {
    const blank = r.first || rows[i - 1].y - r.y > lineGap * 1.4;
    if (i > 0 && blank) out += '\n';
    out += ' '.repeat(Math.max(0, Math.round((r.x - minX) / charW))) + r.text + '\n';
  });
  return out;
}

const looksLikeFountain = (t) => /^(title|author|credit|draft date):/im.test(t.slice(0, 400)) && /\n\n/.test(t);

/** importFile(File) -> { text, report, formatted } */
export async function importFile(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.docx')) {
    const xml = await unzipEntry(await file.arrayBuffer(), 'word/document.xml');
    const { fountain, report } = parasToFountain(docxToParas(xml));
    return { text: fountain, report, formatted: true };
  }
  if (name.endsWith('.fdx')) {
    const { fountain, report } = parasToFountain(fdxToParas(await file.text()));
    return { text: fountain, report, formatted: true };
  }
  if (name.endsWith('.pdf')) {
    const pdfjsLib = await import('../vendor/pdf.min.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
    const text = await pdfToText(new Uint8Array(await file.arrayBuffer()), pdfjsLib);
    const { fountain, report } = parasToFountain(textToParas(text));
    return { text: fountain, report, formatted: true };
  }
  if (name.endsWith('.doc') || name.endsWith('.rtf') || name.endsWith('.pages')) {
    throw new Error('That file type is not supported yet. Save it as .docx, .pdf, or .txt and upload again.');
  }
  const raw = await file.text();
  if (name.endsWith('.fountain') || looksLikeFountain(raw)) return { text: raw, report: null, formatted: false };
  const { fountain, report } = parasToFountain(textToParas(raw));
  return { text: fountain, report, formatted: true };
}
