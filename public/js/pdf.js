// Minimal PDF writer for screenplays. No dependencies.
// Uses the built-in Courier family (always available in every PDF reader),
// so the file is tiny and prints exactly on the industry grid.

const CP1252 = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89,
  'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95,
  '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

function pdfString(s) {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    let b;
    if (cp < 0x80) b = cp;
    else if (cp >= 0xa0 && cp <= 0xff) b = cp;
    else if (CP1252[ch] !== undefined) b = CP1252[ch];
    else b = 0x3f;
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += '\\' + String.fromCharCode(b);
    else if (b < 32 || b > 126) out += '\\' + b.toString(8).padStart(3, '0');
    else out += String.fromCharCode(b);
  }
  return '(' + out + ')';
}

const CW = 7.2; // Courier 12pt character width in points
const f2 = (n) => n.toFixed(2);

function pageStream(page) {
  let s = '';
  const text = (runs, col, row) => {
    let x = col * CW;
    const y = 792 - 72 - 12 * row - 9;
    for (const r of runs) {
      if (!r.t) continue;
      const font = r.b && r.i ? 'F4' : r.b ? 'F2' : r.i ? 'F3' : 'F1';
      s += `BT /${font} 12 Tf 1 0 0 1 ${f2(x)} ${f2(y)} Tm ${pdfString(r.t)} Tj ET\n`;
      if (r.u) s += `0.6 w ${f2(x)} ${f2(y - 1.5)} m ${f2(x + r.t.length * CW)} ${f2(y - 1.5)} l S\n`;
      x += r.t.length * CW;
    }
  };
  for (const ln of page.lines) text(ln.runs, ln.col, ln.row);
  if (page.showNumber) {
    const label = page.number + '.';
    const x = 72.5 * CW - label.length * CW;
    s += `BT /F1 12 Tf 1 0 0 1 ${f2(x)} ${f2(792 - 36 - 9)} Tm ${pdfString(label)} Tj ET\n`;
  }
  return s;
}

/** writePdf(pages, {title}) -> Uint8Array */
export function writePdf(pages, { title = 'Screenplay' } = {}) {
  const fonts = ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'];
  const objs = [];
  const n = pages.length;
  const pageId = (p) => 9 + 2 * p;
  const contentId = (p) => 8 + 2 * p;

  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Count ${n} /Kids [${pages.map((_, p) => pageId(p) + ' 0 R').join(' ')}] >>`;
  fonts.forEach((f, i) => {
    objs[3 + i] = `<< /Type /Font /Subtype /Type1 /BaseFont /${f} /Encoding /WinAnsiEncoding >>`;
  });
  const safeTitle = String(title).replace(/[^\x20-\x7e]/g, '');
  objs[7] = `<< /Title ${pdfString(safeTitle)} /Producer (Screenwriter MVP) >>`;
  pages.forEach((page, p) => {
    const stream = pageStream(page);
    objs[contentId(p)] = `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
    objs[pageId(p)] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId(p)} 0 R ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> >> >>`;
  });

  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let id = 1; id < objs.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objs[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objs.length; id++) out += String(offsets[id]).padStart(10, '0') + ' 00000 n \n';
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
