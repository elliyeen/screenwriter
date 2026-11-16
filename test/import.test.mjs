import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../public/js/fountain.js';
import { layoutScript } from '../public/js/layout.js';
import { writePdf } from '../public/js/pdf.js';
import { unzipEntry, docxToParas, parasToFountain, textToParas, pdfToText, fdxToParas } from '../public/js/importer.js';
import { check, studioFix } from '../public/js/feedback.js';
import { makeZip } from '../public/js/zip.js';
import { SAMPLE } from '../public/js/sample.js';

let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok  -', name); };
const types = (src) => parse(src).elements.map((e) => e.type);

await t('docx: title page, italics, cue/paren/dialogue, 2-paragraph speech, transition', async () => {
  const DOC = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">Harbor Lights</w:t></w:r></w:p><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">Written by</w:t></w:r></w:p><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">A. Writer</w:t></w:r></w:p><w:p><w:pPr></w:pPr><w:r><w:t xml:space="preserve">int car - day</w:t></w:r></w:p><w:p><w:pPr></w:pPr><w:r><w:t xml:space="preserve">NOAH, </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">40s, former ferry captain,</w:t></w:r><w:r><w:t xml:space="preserve"> waits in the car for his daughter &amp; friend.</w:t></w:r></w:p><w:p><w:pPr><w:ind w:left="3168"/></w:pPr><w:r><w:t xml:space="preserve">NOAH</w:t></w:r></w:p><w:p><w:pPr><w:ind w:left="2160"/></w:pPr><w:r><w:t xml:space="preserve">(honking horn)</w:t></w:r></w:p><w:p><w:pPr><w:ind w:left="1440"/></w:pPr><w:r><w:t xml:space="preserve">Hey! Come on, we told you we had to be on the road at 7.</w:t></w:r></w:p><w:p><w:pPr></w:pPr><w:r><w:t xml:space="preserve">Ella gets in the car.</w:t></w:r></w:p><w:p><w:pPr><w:ind w:left="3168"/></w:pPr><w:r><w:t xml:space="preserve">ELLA</w:t></w:r></w:p><w:p><w:pPr><w:ind w:left="1440"/></w:pPr><w:r><w:t xml:space="preserve">I can see you Dad.</w:t></w:r></w:p><w:p><w:pPr><w:ind w:left="1440"/></w:pPr><w:r><w:t xml:space="preserve">And I can hear you.</w:t></w:r></w:p><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t xml:space="preserve">CUT TO:</w:t></w:r></w:p><w:p><w:pPr></w:pPr><w:r><w:t xml:space="preserve">EXT. HARBOR - DAY</w:t></w:r></w:p><w:p><w:pPr></w:pPr><w:r><w:t xml:space="preserve">She walks away.</w:t></w:r></w:p></w:body></w:document>';
  const zip = Buffer.from(await makeZip([{ name: 'word/document.xml', text: DOC }]).arrayBuffer());
  const xml = await unzipEntry(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength), 'word/document.xml');
  const { fountain, report } = parasToFountain(docxToParas(xml));
  const { meta, elements } = parse(fountain);
  assert.equal(meta.title, 'Harbor Lights');
  assert.equal(meta.author, 'A. Writer');
  assert.deepEqual(elements.map((e) => e.type), ['scene', 'action', 'character', 'paren', 'dialogue', 'action', 'character', 'dialogue', 'dialogue', 'transition', 'scene', 'action']);
  assert.equal(elements[0].text, 'INT. CAR - DAY');
  assert.ok(elements[1].text.includes('*40s, former ferry captain,*'), elements[1].text);
  assert.ok(elements[1].text.includes('& friend'));
  assert.equal(report.scenes, 2);
});

await t('txt: "Name: line" transcript style', () => {
  const src = 'Kitchen scene\nMaya: He found me.\nJoe: (smiling) I always do.\nMaya: Leave.\nShe grabs her coat and runs.';
  const { fountain } = parasToFountain(textToParas(src));
  assert.deepEqual(types(fountain), ['action', 'character', 'dialogue', 'character', 'paren', 'dialogue', 'character', 'dialogue', 'action']);
  assert.ok(fountain.includes('MAYA\nHe found me.'));
});

await t('txt: hard-wrapped, indented script text', () => {
  const src = [
    'INT. KITCHEN - NIGHT', '', 'Rain taps the window. Maya stares at a cold cup of coffee', 'that she made an hour ago.', '',
    '                    MAYA', '               (whispering)', '          He found me. I knew this', '          would happen.', '',
    'THE PHONE BUZZES AGAIN', 'and she flinches.', '', '                                        CUT TO:', '',
  ].join('\n');
  const { fountain } = parasToFountain(textToParas(src));
  const els = parse(fountain).elements;
  assert.deepEqual(els.map((e) => e.type), ['scene', 'action', 'character', 'paren', 'dialogue', 'action', 'transition']);
  assert.equal(els[1].text, 'Rain taps the window. Maya stares at a cold cup of coffee that she made an hour ago.');
  assert.equal(els[4].text, 'He found me. I knew this would happen.');
  assert.equal(els[5].text, 'THE PHONE BUZZES AGAIN and she flinches.');
});

await t('fdx: Final Draft file', () => {
  const xml = '<FinalDraft><Content><Paragraph Type="Scene Heading"><Text>INT. CAR - DAY</Text></Paragraph><Paragraph Type="Action"><Text>Matt waits.</Text></Paragraph><Paragraph Type="Character"><Text>MATT</Text></Paragraph><Paragraph Type="Parenthetical"><Text>(low)</Text></Paragraph><Paragraph Type="Dialogue"><Text>Come </Text><Text>on.</Text></Paragraph></Content></FinalDraft>';
  const { fountain } = parasToFountain(fdxToParas(xml));
  assert.deepEqual(types(fountain), ['scene', 'action', 'character', 'paren', 'dialogue']);
});

await t('pdf: round trip of a formatted screenplay PDF keeps every element', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = writePdf(layoutScript(SAMPLE).pages);
  const text = await pdfToText(new Uint8Array(pdf), pdfjs);
  const { fountain } = parasToFountain(textToParas(text));
  const a = parse(SAMPLE);
  const b = parse(fountain);
  const norm = (els) => els.map((e) => e.type + '|' + e.text.replace(/[*_\\]/g, '').replace(/\s+/g, ' ').replace(/ \(CONT'D\)/, ''));
  assert.equal(b.meta.title, 'THE LAST LIGHT');
  assert.equal(b.meta.author, 'Your Name');
  assert.deepEqual(norm(b.elements), norm(a.elements));
});

await t('feedback: flags the right things', () => {
  const src = 'INT. KITCHEN\n\nWe see Maya at the table. ' + 'She waits and waits and waits. '.repeat(12) + '\n\nMAYA\n(whispering)\n\nint car - night\n\nDana sits.\n\nDANA\nHi.\n\nDANNA\nHi again.\n';
  const r = check(src, 3);
  const msgs = r.items.map((i) => i.msg).join('\n');
  assert.match(msgs, /No title page/);
  assert.match(msgs, /no time of day/);
  assert.match(msgs, /Action block is \d+ lines/);
  assert.match(msgs, /Camera direction/);
  assert.match(msgs, /same character spelled two ways/);
  assert.match(msgs, /ALL CAPS/);
  assert.ok(r.fixes >= 3);
});

await t('feedback: clean sample has no format fixes except placeholder author', () => {
  const r = check(SAMPLE, 3);
  assert.deepEqual(r.items.filter((i) => i.level === 'fix').map((i) => i.msg), ['Author still says "Your Name".']);
});

await t('studioFix: mechanical fixes only', () => {
  const { text, changes } = studioFix('Title: T\n\nint kitchen -- night.\n\nRain.   \n\n\n\nMAYA (CONT\'D)\nHe found me.\n\ncut to\n\next.park – day\n');
  assert.ok(text.includes('INT. KITCHEN - NIGHT\n'));
  assert.ok(text.includes('\nMAYA\nHe found me.'));
  assert.ok(text.includes('\nCUT TO:\n'));
  assert.ok(text.includes('EXT. PARK - DAY'));
  assert.ok(!/\n\n\n/.test(text));
  assert.ok(text.includes('Rain.\n'));
  assert.ok(changes > 0);
  assert.equal(studioFix(text).changes, 0, 'idempotent');
});
console.log(`\n${n} import/feedback tests passed`);
{
  const { fountain } = parasToFountain(textToParas('Kitchen at night\nMaya: He found me.\nJoe: (smiling) I always do.\nMaya: Leave.\nShe grabs her coat and runs.\n'));
  assert.deepEqual(types(fountain), ['action', 'character', 'dialogue', 'character', 'paren', 'dialogue', 'character', 'dialogue', 'action']);
  console.log('ok  - txt: trailing newline does not break paragraph mode');
}
