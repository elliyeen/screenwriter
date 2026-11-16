import { parse } from './fountain.js';
import { layoutScript, L as GRID } from './layout.js';
import { writePdf } from './pdf.js';
import { SAMPLE } from './sample.js';
import { api } from './cloud.js';
import { Live } from './live.js';
import { diff, apply, transform } from './ot.js';
import { importFile } from './importer.js';
import { check, studioFix } from './feedback.js';
import * as folder from './folder.js';
import { makeZip } from './zip.js';

const $ = (id) => document.getElementById(id);
const KEY = 'screenwriter.v1';
const STASH = 'screenwriter.stash.';
const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).slice(2, 12) + Date.now().toString(36));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const STARTER = 'Title: Untitled\nAuthor: Your Name\n\nINT. LOCATION - DAY\n\n';
const STAGES = [['idea', 'Idea'], ['outline', 'Outline'], ['draft', 'Drafting'], ['revision', 'Revising'], ['final', 'Final']];
const DEFAULTS = { contd: true, titlePage: true, boldScenes: false, sceneNumbers: false, sceneSpacing: 1 };
const wide = () => matchMedia('(min-width: 901px)').matches;
const wide3 = () => matchMedia('(min-width: 1241px)').matches; // room for the details column

// ---------- state (kept in the browser, synced to the cloud when signed in) ----------
const keyOf = (s) => (s.owner ? s.owner + ':' + s.id : s.id);
function newScript(text, extra = {}) {
  return { id: uid(), owner: null, role: 'owner', text, updated: Date.now(), base: 0, dirty: true, status: 'draft', meta: { type: 'feature', genre: '', ms: [] }, metaDirty: false, deleted: false, delDirty: false, ...extra };
}
function loadState() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch { /* ignore */ }
  if (!s || !Array.isArray(s.scripts) || !s.scripts.length) {
    const first = newScript(SAMPLE, { dirty: false });
    return { scripts: [first], current: keyOf(first), settings: { ...DEFAULTS }, ui: {} };
  }
  s.settings = { ...DEFAULTS, ...(s.settings || {}) };
  s.ui = s.ui || {};
  for (const x of s.scripts) {
    if (x.base === undefined) { x.base = 0; x.dirty = x.text !== SAMPLE; }
    x.owner = x.owner || null;
    x.role = x.role || 'owner';
    x.status = x.status || 'draft';
    if (x.statusDirty) { x.metaDirty = true; delete x.statusDirty; }
  }
  if (!s.scripts.find((x) => keyOf(x) === s.current)) s.current = keyOf(s.scripts[0]);
  return s;
}
let state = loadState();
let saveTimer = 0;
let saveFailed = false;
let signingOut = false;
function saveNow() {
  if (signingOut) return;
  try { localStorage.setItem(KEY, JSON.stringify(state)); saveFailed = false; } catch {
    // Never pretend a save worked. Tell the writer once and point to a safe copy.
    if (!saveFailed) { saveFailed = true; setTimeout(() => toast('This device is out of storage space. Download all scripts from the account menu to keep a safe copy.'), 0); }
  }
}
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400); }
addEventListener('pagehide', saveNow);

const cur = () => state.scripts.find((s) => keyOf(s) === state.current);
const byKey = (k) => state.scripts.find((s) => keyOf(s) === k);
const sorted = () => state.scripts.filter((s) => !s.deleted).sort((a, b) => b.updated - a.updated);
function scriptName(text) {
  const t = /^\s*title:\s*(.+)$/im.exec(text);
  if (t) return t[1].trim();
  const first = text.split('\n').find((l) => l.trim());
  return first ? first.trim().slice(0, 60) : 'Untitled';
}
function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  if (m < 60 * 24) return Math.round(m / 60) + 'h ago';
  if (m < 60 * 24 * 30) return Math.round(m / 1440) + 'd ago';
  return new Date(ts).toLocaleDateString();
}

let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
}

const ed = $('editor');
const work = $('work');
let res = null;
let parsed = { elements: [] };
let knownNames = new Set();
let inEditor = false;

// ====================================================================== Library
const TYPES = [['feature', 'Feature Film', 'Features'], ['tv', 'TV Series', 'TV Series'], ['short', 'Short Film', 'Short Films'], ['treatment', 'Treatment', 'Treatments'], ['pitch', 'Pitch', 'Pitches'], ['other', 'Other', 'Other']];
const typeLabel = (t) => (TYPES.find((x) => x[0] === t) || TYPES[5])[1];
const MILES = [['outline', 'Outline'], ['first', 'First Draft'], ['second', 'Second Draft'], ['final', 'Final Draft']];
const OTHER = ['treatment', 'pitch', 'other'];
const ICON = {
  library: '<path d="M4 6h16v12H4zM4 14h4l1.5 2h5L16 14h4"/>', recent: '<circle class="o" cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  favorites: '<path d="M12 4l2.4 5 5.6.7-4.1 3.8 1 5.5-4.9-2.7L7.1 19l1-5.5L4 9.7 9.6 9z"/>', shared: '<circle class="o" cx="9" cy="9" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6.5a3 3 0 0 1 0 5.5M17.5 14.5a5 5 0 0 1 3 4.5"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10 11v5M14 11v5"/>', folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;
const lib = () => (state.ui.lib ||= { view: 'library', filter: 'all', sort: 'edited', mode: 'grid', tab: 'library', sel: null });
const metaOf = (s) => {
  const m = (s.meta ||= {});
  m.type ||= 'feature';
  m.genre ||= '';
  m.ms ||= [];
  return m;
};
const live1 = () => state.scripts.filter((s) => !s.deleted);
const pageCache = new Map();
function pagesOf(s) {
  const k = keyOf(s);
  const c = pageCache.get(k);
  if (c && c.text === s.text) return c.n;
  const n = layoutScript(s.text, { titlePage: false }).stats.pages;
  pageCache.set(k, { text: s.text, n });
  return n;
}
function coverHtml(s) {
  let h = 0;
  for (const c of s.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const pick = metaOf(s).cover;
  return `<div class="cover c${Number.isInteger(pick) && pick >= 0 && pick < 6 ? pick : h % 6}">${metaOf(s).fav && !s.deleted ? '<i class="star" title="Favorite">★</i>' : ''}<span>${esc(scriptName(s.text))}</span></div>`;
}
function ringHtml(s) {
  const n = metaOf(s).ms.length;
  if (!n) return '';
  const pc = Math.round((n / MILES.length) * 100);
  const c = 2 * Math.PI * 16;
  return `<div class="ring" title="${n} of ${MILES.length} milestones done"><svg viewBox="0 0 40 40"><circle class="bg" cx="20" cy="20" r="16"/><circle class="fg" cx="20" cy="20" r="16" stroke-dasharray="${((pc / 100) * c).toFixed(1)} ${c.toFixed(1)}"/></svg><b>${pc}%</b></div>`;
}
function matchesFilter(s, f) {
  const t = metaOf(s).type;
  return f === 'all' || (f === 'othergroup' ? OTHER.includes(t) : t === f);
}
function visibleScripts() {
  const L = lib();
  let list = L.view === 'trash' ? state.scripts.filter((s) => s.deleted) : live1();
  if (L.view === 'favorites') list = list.filter((s) => metaOf(s).fav);
  if (L.view === 'shared') list = list.filter((s) => s.owner);
  list = list.filter((s) => matchesFilter(s, L.filter));
  const q = (L.q || '').trim().toLowerCase();
  if (q) list = list.filter((s) => scriptName(s.text).toLowerCase().includes(q) || s.text.toLowerCase().includes(q));
  const by = { edited: (a, b) => b.updated - a.updated, title: (a, b) => scriptName(a.text).localeCompare(scriptName(b.text)), pages: (a, b) => pagesOf(b) - pagesOf(a) };
  list = [...list].sort(L.view === 'recent' ? by.edited : by[L.sort] || by.edited);
  return L.view === 'recent' ? list.slice(0, 8) : list;
}

function renderLibrary() {
  const L = lib();
  const all = live1();
  const count = (f) => all.filter((s) => matchesFilter(s, f)).length;
  const navBtn = (id, label, icon, n, on) => `<button data-nav="${id}" class="${on ? 'on' : ''}"${on ? ' aria-current="page"' : ''}>${svg(icon)}<span>${label}</span>${n ? `<em>${n}</em>` : ''}</button>`;
  const plain = L.tab === 'library' && L.filter === 'all';
  $('libNav').innerHTML =
    navBtn('library', 'Library', 'library', all.length, plain && L.view === 'library') +
    navBtn('recent', 'Recent', 'recent', 0, plain && L.view === 'recent') +
    navBtn('favorites', 'Favorites', 'favorites', all.filter((s) => metaOf(s).fav).length, plain && L.view === 'favorites') +
    navBtn('shared', 'Shared with Me', 'shared', all.filter((s) => s.owner).length, plain && L.view === 'shared') +
    navBtn('trash', 'Trash', 'trash', state.scripts.filter((s) => s.deleted).length, plain && L.view === 'trash');
  $('libFolders').innerHTML = TYPES.slice(0, 5).map(([v, , plural]) => navBtn('type:' + v, plural, 'folder', count(v), L.tab === 'library' && L.filter === v)).join('');

  for (const b of $('libTabs').children) b.classList.toggle('on', b.dataset.tab === L.tab);
  $('libBody').hidden = L.tab !== 'library';

  const pill = (f, label) => `<button role="tab" data-filter="${f}" aria-selected="${L.filter === f || (f === 'othergroup' && OTHER.includes(L.filter))}" class="${L.filter === f || (f === 'othergroup' && OTHER.includes(L.filter)) ? 'on' : ''}">${label} <em>${count(f)}</em></button>`;
  $('pills').innerHTML = pill('all', 'All Scripts') + pill('feature', 'Features') + pill('tv', 'TV Series') + pill('short', 'Short Films') + pill('othergroup', 'Other');
  $('sortSel').value = L.sort;
  for (const b of $('modeSeg').children) b.classList.toggle('on', b.dataset.mode === L.mode);

  const list = visibleScripts();
  if (!list.find((s) => keyOf(s) === L.sel)) L.sel = wide3() && list[0] ? keyOf(list[0]) : null;
  const g = $('grid');
  g.classList.toggle('list', L.mode === 'list');
  g.innerHTML = list.map((s) => {
    const k = esc(keyOf(s));
    const sel = keyOf(s) === L.sel;
    return `<article class="scard${sel ? ' sel' : ''}" aria-current="${sel}" tabindex="${sel || (!L.sel && s === list[0]) ? 0 : -1}" data-key="${k}">
      ${coverHtml(s)}<button class="dots" data-menu="${k}" aria-label="Actions for ${esc(scriptName(s.text))}" tabindex="-1">•••</button>
      <div class="cbody"><div class="ct">${esc(scriptName(s.text))}</div>
        <div class="cm">${typeLabel(metaOf(s).type)} • ${pagesOf(s)} page${pagesOf(s) === 1 ? '' : 's'}</div>
        <div class="cm">${s.deleted ? 'In trash' : (s.owner ? 'Shared · ' : '') + 'Edited ' + ago(s.updated)}</div>${ringHtml(s)}</div>
    </article>`;
  }).join('') +
    (L.view === 'trash' ? (list.length ? '' : '<div class="emptynote">Trash is empty. Deleted scripts wait here and can be restored.</div>')
      : (list.length || !(L.q || '').trim() ? '' : '<div class="emptynote">No scripts match your search.</div>') +
        '<button class="newcard" id="newCard"><i>+</i><b>Create New Script</b><span>Start a screenplay, treatment, or pitch.</span></button>');

  const last = state.last && byKey(state.last);
  $('btnContinue').hidden = !(last && !last.deleted);
  if (last) $('btnContinue').textContent = 'Continue writing: ' + scriptName(last.text) + ' →';
  renderDetails();
}

function renderDetails() {
  const s = byKey(lib().sel);
  const el = $('details');
  if (!s) { el.innerHTML = '<div class="dempty">Select a script to see its details.</div>'; return; }
  const m = metaOf(s);
  const ro = s.role === 'reviewer' || s.deleted ? ' disabled' : '';
  const done = m.ms.length;
  el.innerHTML = `
    <div class="dhead">${coverHtml(s)}
      <div style="min-width:0"><h2>${esc(scriptName(s.text))}</h2>
        <select id="dType" aria-label="Script type"${ro}>${TYPES.map(([v, l]) => `<option value="${v}"${v === m.type ? ' selected' : ''}>${l}</option>`).join('')}</select><br>
        <select id="dStatus" class="dstatus" aria-label="Development status"${ro}>${STAGES.map(([v, l]) => `<option value="${v}"${v === s.status ? ' selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      <button class="dfav" id="dFav" aria-label="${m.fav ? 'Remove from favorites' : 'Add to favorites'}" aria-pressed="${!!m.fav}"${s.deleted ? ' disabled' : ''}>${m.fav ? '★' : '☆'}</button>
    </div>
    ${s.deleted || s.role === 'reviewer' ? '' : '<button class="link" id="dCover">Change cover</button>'}
    <div class="dsec"><h3>Progress <span>${done ? Math.round((done / MILES.length) * 100) + '%' : ''}</span></h3>
      ${done ? `<div class="bar2"><i style="width:${(done / MILES.length) * 100}%"></i></div>` : '<p class="note">Tick a milestone when you finish it.</p>'}
      ${MILES.map(([v, l]) => `<label class="mile"><input type="checkbox" data-ms="${v}"${m.ms.includes(v) ? ' checked' : ''}${ro}>${l}</label>`).join('')}
    </div>
    <div class="dsec"><h3>Project Details</h3>
      <div class="drow"><span>Pages</span><span>${pagesOf(s)}</span></div>
      <div class="drow"><span>Genre</span><input type="text" id="dGenre" value="${esc(m.genre)}" placeholder="Add a genre" maxlength="40" aria-label="Genre"${ro}></div>
      <div class="drow"><span>Format</span><span>${typeLabel(m.type)}</span></div>
      <div class="drow"><span>Last Edited</span><span>${new Date(s.updated).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span></div>
    </div>
    <div style="margin-top:14px">
      <button class="dlink" id="dHistory">Version History <span>›</span></button>
      <button class="dlink" id="dCollab"${s.owner ? ' disabled' : ''}>Collaborators <span>${s.owner ? 'Owner: ' + esc(s.owner) : '›'}</span></button>
      <button class="dlink" disabled>Notes &amp; Development <em>Coming soon</em></button>
      <button class="dlink" disabled>Attachments <em>Coming soon</em></button>
    </div>
    <div class="dactions">
      ${s.deleted ? '<button class="btn primary" id="dRestore">Restore from Trash</button>'
        : `<button class="btn primary" id="dOpen">▶&nbsp; Open in Writer</button>
      <div class="drow3"><button class="btn" id="dShare">Share</button><button class="btn" id="dExport">Export</button><button class="btn" id="dMore" aria-label="More actions">•••</button></div>`}
    </div>`;
}

function touchMeta(s) { s.metaDirty = true; saveSoon(); syncNow(); }
function selectScript(key, openPanel = true) {
  lib().sel = key;
  for (const c of $('grid').querySelectorAll('.scard')) {
    const on = c.dataset.key === key;
    c.classList.toggle('sel', on);
    c.setAttribute('aria-current', on);
    c.tabIndex = on ? 0 : -1;
  }
  renderDetails();
  if (openPanel && !wide3()) setDetails(true);
  saveSoon();
}
function setDetails(open) { $('details').classList.toggle('open', open); syncScrim(); }
function setLibSide(open) { $('libSide').classList.toggle('open', open); syncScrim(); if (typeof applySide === 'function') applySide(); }
function syncScrim() { $('libScrim').classList.toggle('on', $('details').classList.contains('open') || $('libSide').classList.contains('open')); }
$('libScrim').addEventListener('click', () => { setDetails(false); setLibSide(false); });
function applySide() {
  const off = wide() && !!state.ui.sideOff;
  $('home').classList.toggle('collapsed', off);
  const open = wide() ? !off : $('libSide').classList.contains('open');
  $('btnSide').setAttribute('aria-expanded', String(open));
  $('btnSide').setAttribute('aria-label', open ? 'Hide sidebar' : 'Show sidebar');
  $('libSide').inert = wide() && off; // hidden panel must not be tabbable
}
$('btnSide').addEventListener('click', () => {
  if (wide()) { state.ui.sideOff = !state.ui.sideOff; saveSoon(); applySide(); }
  else { setLibSide(!$('libSide').classList.contains('open')); applySide(); }
});
matchMedia('(min-width: 901px)').addEventListener('change', applySide);

function setTitle(s, title) {
  title = title.trim().replace(/\s+/g, ' ');
  if (!title || s.role === 'reviewer') return;
  s.text = /^\s*title:/im.test(s.text) ? s.text.replace(/^(\s*title:\s*).*$/im, (_, a) => a + title) : `Title: ${title}\n\n` + s.text;
  s.updated = Date.now();
  s.dirty = true;
  saveSoon();
  renderLibrary();
  pushSoon();
  folderSoon();
}
let renameTarget = null;
function openRename(s) { renameTarget = s; $('renameInput').value = scriptName(s.text); $('dlgRename').showModal(); $('renameInput').select(); }
$('renameForm').addEventListener('submit', (e) => { e.preventDefault(); setTitle(renameTarget, $('renameInput').value); $('dlgRename').close(); });
$('renameClose').addEventListener('click', () => $('dlgRename').close());
function duplicateScript(s) {
  const text = /^\s*title:/im.test(s.text) ? s.text.replace(/^(\s*title:\s*)(.+)$/im, '$1$2 (copy)') : s.text;
  const c = newScript(text, { status: s.status, meta: { ...metaOf(s), ms: [...metaOf(s).ms], fav: false }, metaDirty: true });
  state.scripts.push(c);
  lib().sel = keyOf(c);
  saveSoon(); renderLibrary(); pushSoon(); folderSoon();
  toast('Copy created.');
}
function trashScript(s) {
  if (!s || s.owner) return;
  s.deleted = true;
  s.delDirty = s.base > 0;
  if (state.last === keyOf(s)) state.last = null;
  saveSoon(); renderLibrary(); syncNow();
  toast(`"${scriptName(s.text)}" moved to Trash. You can restore it any time.`);
}
function restoreScript(s) {
  s.deleted = false;
  s.delDirty = s.base > 0;
  saveSoon(); renderLibrary(); syncNow();
  toast('Script restored.');
}
function exportPdf(s) {
  const r = layoutScript(s.text, state.settings);
  const name = scriptName(s.text).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'screenplay';
  download(name + '.pdf', new Blob([writePdf(r.pages, { title: r.meta.title || scriptName(s.text) })], { type: 'application/pdf' }));
}
function toggleFav(s) { const m = metaOf(s); m.fav = !m.fav; touchMeta(s); renderLibrary(); }

// ---------- actions menu ----------
function openMenu(s, anchor) {
  const k = esc(keyOf(s));
  const items = s.deleted ? [['restore', 'Restore']]
    : [['open', 'Open in Writer'], ['rename', 'Rename…'], ['dup', 'Duplicate'], ['fav', metaOf(s).fav ? 'Remove from Favorites' : 'Add to Favorites'], ['cover', 'Change cover…'], ['pdf', 'Export PDF'], ['fountain', 'Export .fountain']].concat(s.owner ? [] : [['share', 'Share…'], ['trash', 'Move to Trash']]);
  const m = $('ctx');
  m.innerHTML = items.map(([a, l]) => `<button role="menuitem" data-act="${a}" data-key="${k}">${l}</button>`).join('');
  m.hidden = false;
  const r = anchor.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(innerWidth - 218, r.right - 210)) + 'px';
  m.style.top = Math.max(8, Math.min(innerHeight - m.offsetHeight - 8, r.bottom + 4)) + 'px';
  m.firstElementChild.focus();
}
const closeCtx = () => { $('ctx').hidden = true; };
const COVERS = ['Blue', 'Teal', 'Green', 'Orange', 'Rose', 'Navy'];
function openCoverPicker(s, anchor) {
  if (s.role === 'reviewer' || s.deleted) return;
  const k = esc(keyOf(s));
  const m = $('ctx');
  m.innerHTML = '<div class="swhead">Cover color</div><div class="swrow">' + COVERS.map((n, i) => `<button class="sw c${i}" data-cover="${i}" data-key="${k}" aria-label="${n}" aria-pressed="${metaOf(s).cover === i}"></button>`).join('') +
    `</div><button role="menuitem" data-cover="auto" data-key="${k}">Automatic</button>`;
  m.hidden = false;
  const r = (anchor || document.querySelector(`.scard[data-key="${k}"]`) || document.body).getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(innerWidth - 228, r.left + 8)) + 'px';
  m.style.top = Math.max(8, Math.min(innerHeight - 130, r.top + 40)) + 'px';
  m.querySelector('.sw').focus();
}
$('ctx').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cover]');
  if (!b) return;
  const s = byKey(b.dataset.key);
  closeCtx();
  if (!s || s.role === 'reviewer') return;
  if (b.dataset.cover === 'auto') delete metaOf(s).cover; else metaOf(s).cover = Number(b.dataset.cover);
  touchMeta(s);
  renderLibrary();
});
$('ctx').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const s = byKey(b.dataset.key);
  closeCtx();
  if (!s) return;
  const a = b.dataset.act;
  if (a === 'open') openScript(keyOf(s));
  else if (a === 'rename') openRename(s);
  else if (a === 'dup') duplicateScript(s);
  else if (a === 'fav') toggleFav(s);
  else if (a === 'cover') openCoverPicker(s);
  else if (a === 'pdf') exportPdf(s);
  else if (a === 'fountain') download((scriptName(s.text).replace(/[^\w\- ]+/g, '').trim() || 'screenplay') + '.fountain', new Blob([s.text], { type: 'text/plain' }));
  else if (a === 'share') openShare(s);
  else if (a === 'trash') trashScript(s);
  else if (a === 'restore') restoreScript(s);
});
$('ctx').addEventListener('keydown', (e) => {
  const items = [...$('ctx').children];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  else if (e.key === 'Escape') { closeCtx(); const c = $('grid').querySelector('.scard.sel'); if (c) c.focus(); }
});
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#ctx') && !e.target.closest('[data-menu]') && !e.target.closest('#dMore')) closeCtx(); });

// ---------- grid: select, open, keyboard ----------
function newFromLibrary() {
  const f = lib().filter;
  const type = TYPES.some((t) => t[0] === f) ? f : 'feature';
  addScript(STARTER, { meta: { type, genre: '', ms: [] }, metaDirty: true });
  ed.focus();
}
$('grid').addEventListener('click', (e) => {
  if (e.target.closest('#newCard')) return newFromLibrary();
  const menu = e.target.closest('[data-menu]');
  if (menu) { selectScript(menu.dataset.menu, false); return openMenu(byKey(menu.dataset.menu), menu); }
  const c = e.target.closest('.scard');
  if (c) selectScript(c.dataset.key);
});
$('grid').addEventListener('dblclick', (e) => {
  const c = e.target.closest('.scard');
  if (c && !e.target.closest('[data-menu]') && !byKey(c.dataset.key).deleted) openScript(c.dataset.key);
});
$('grid').addEventListener('keydown', (e) => {
  const c = e.target.closest('.scard');
  if (!c) return;
  const cards = [...$('grid').querySelectorAll('.scard')];
  const i = cards.indexOf(c);
  const cols = Math.max(1, Math.round($('grid').clientWidth / (c.offsetWidth + 18)));
  const go = (j) => { const t = cards[Math.max(0, Math.min(cards.length - 1, j))]; if (t) { e.preventDefault(); selectScript(t.dataset.key, false); t.focus(); } };
  const s = byKey(c.dataset.key);
  if (e.key === 'ArrowRight') go(i + 1);
  else if (e.key === 'ArrowLeft') go(i - 1);
  else if (e.key === 'ArrowDown') go(i + cols);
  else if (e.key === 'ArrowUp') go(i - cols);
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(cards.length - 1);
  else if (e.key === 'Enter') { e.preventDefault(); if (s.deleted) restoreScript(s); else openScript(keyOf(s)); }
  else if (e.key === ' ') { e.preventDefault(); selectScript(c.dataset.key); }
  else if (e.key === 'F2') { e.preventDefault(); if (!s.deleted) openRename(s); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && !s.deleted && !s.owner) { e.preventDefault(); trashScript(s); }
  else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); openMenu(s, c.querySelector('.dots')); }
});
$('grid').addEventListener('focusin', (e) => { const c = e.target.closest('.scard'); if (c && c.dataset.key !== lib().sel && e.target === c) selectScript(c.dataset.key, false); });

// ---------- sidebar, tabs, filters, search ----------
function navTo(id) {
  const L = lib();
  L.tab = 'library';
  if (id.startsWith('type:')) { L.view = 'library'; L.filter = id.slice(5); } else { L.view = id; L.filter = 'all'; }
  setLibSide(false);
  saveSoon();
  renderLibrary();
}
$('libNav').addEventListener('click', (e) => { const b = e.target.closest('[data-nav]'); if (b) navTo(b.dataset.nav); });
$('libFolders').addEventListener('click', (e) => { const b = e.target.closest('[data-nav]'); if (b) navTo(b.dataset.nav); });
$('pills').addEventListener('click', (e) => { const b = e.target.closest('[data-filter]'); if (b) { lib().filter = b.dataset.filter; saveSoon(); renderLibrary(); } });
$('sortSel').addEventListener('change', (e) => { lib().sort = e.target.value; saveSoon(); renderLibrary(); });
$('modeSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { lib().mode = b.dataset.mode; saveSoon(); renderLibrary(); } });
$('q').addEventListener('input', (e) => { lib().q = e.target.value; if (lib().tab !== 'library') lib().tab = 'library'; renderLibrary(); });
$('libTabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const L = lib();
  const target = byKey(L.sel) || byKey(state.last) || sorted()[0];
  if (b.dataset.tab === 'write') { if (target && !target.deleted) openScript(keyOf(target)); else newFromLibrary(); return; }
  L.tab = b.dataset.tab;
  saveSoon();
  renderLibrary();
});
$('btnContinue').addEventListener('click', () => { if (byKey(state.last)) openScript(state.last); });
document.addEventListener('keydown', (e) => {
  if (inEditor) return;
  if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) { e.preventDefault(); $('q').focus(); $('q').select(); }
  else if (e.key === 'Escape') { setDetails(false); setLibSide(false); }
});

// ---------- details panel ----------
$('details').addEventListener('click', (e) => {
  const s = byKey(lib().sel);
  if (!s) return;
  const id = (e.target.closest('button') || {}).id;
  if (id === 'dOpen') openScript(keyOf(s));
  else if (id === 'dShare' || id === 'dCollab') openShare(s);
  else if (id === 'dExport') exportPdf(s);
  else if (id === 'dMore') openMenu(s, e.target.closest('button'));
  else if (id === 'dFav') toggleFav(s);
  else if (id === 'dRestore') restoreScript(s);
  else if (id === 'dHistory') openHistory(s);
});
$('details').addEventListener('click', (e) => { if (e.target.id === 'dCover') { const s = byKey(lib().sel); if (s) openCoverPicker(s, e.target); } });
$('details').addEventListener('change', (e) => {
  const s = byKey(lib().sel);
  if (!s) return;
  const m = metaOf(s);
  const t = e.target;
  if (t.id === 'dType') m.type = t.value;
  else if (t.id === 'dStatus') s.status = t.value;
  else if (t.id === 'dGenre') m.genre = t.value.trim();
  else if (t.dataset.ms) m.ms = MILES.map((x) => x[0]).filter((v) => (v === t.dataset.ms ? t.checked : m.ms.includes(v)));
  else return;
  touchMeta(s);
  renderLibrary();
});


function showHome() {
  inEditor = false;
  rememberPlace(true);
  closeLive();
  $('editorView').hidden = true;
  $('home').hidden = false;
  if (cur()) lib().sel = wide3() ? state.current : lib().sel;
  renderLibrary();
  syncNow({ pull: true });
}
function addScript(text, extra) {
  const s = newScript(text, extra);
  state.scripts.push(s);
  openScript(keyOf(s));
  pushSoon();
  folderSoon();
  return s;
}
$('btnNew').addEventListener('click', () => { setLibSide(false); newFromLibrary(); });
$('btnNew2').addEventListener('click', () => { addScript(STARTER); ed.focus(); });
$('fileIn').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  setLibSide(false);
  try {
    toast('Reading ' + f.name + '…');
    const r = await importFile(f);
    addScript(r.formatted ? studioFix(r.text).text : r.text);
    setView(wide() ? 'split' : 'pages');
    toast(r.formatted && r.report ? `Formatted ${f.name}: ${r.report.scenes} scenes, ${r.report.dialogue} speeches. Open Check for feedback.` : `Opened ${f.name}.`);
  } catch (err) {
    alert(err && err.message ? err.message : 'Could not read that file.');
  }
});

// ---------- account menu: folder sync and download-all ----------
const scriptFiles = () => live1().map((s) => ({ id: keyOf(s), title: scriptName(s.text), text: s.text }));
let folderDir = null;
let folderNames = {};
let folderTimer = 0;
function folderLabel() {
  $('btnFolder').hidden = !folder.supported;
  $('btnFolder').textContent = folderDir ? `Saving to folder “${folderDir.name}” ✓` : state.ui.folder ? `Reconnect folder “${state.ui.folder}”…` : 'Save to a folder on this computer…';
}
async function folderWrite() {
  if (!folderDir) return;
  try { folderNames = await folder.writeScripts(folderDir, scriptFiles(), folderNames); } catch { folderDir = null; folderLabel(); toast('Could not write to the folder. Reconnect it from the account menu.'); }
}
function folderSoon() { if (!folderDir) return; clearTimeout(folderTimer); folderTimer = setTimeout(folderWrite, 1500); }
$('btnFolder').addEventListener('click', async () => {
  $('menuProfile').open = false;
  try {
    let dir = state.ui.folder && !folderDir ? await folder.remembered() : null;
    if (dir && !(await folder.allowed(dir, true))) dir = null;
    if (!dir) dir = await folder.pick();
    folderDir = dir;
    folderNames = {};
    state.ui.folder = dir.name;
    saveSoon();
    await folderWrite();
    folderLabel();
    toast(`Every script is now saved as a file in “${dir.name}”. It updates as you write.`);
  } catch (err) {
    if (err && err.name !== 'AbortError') toast('Could not open that folder.');
  }
});
function downloadZip() {
  const used = new Set();
  const files = state.scripts.map((s) => {
    let name = (s.deleted ? 'Trash/' : '') + (scriptName(s.text).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Untitled');
    if (used.has(name.toLowerCase())) name += ' (' + s.id.slice(0, 4) + ')';
    used.add(name.toLowerCase());
    return { name: name + '.fountain', text: s.text };
  });
  download('screenwriter-scripts-' + new Date().toISOString().slice(0, 10) + '.zip', makeZip(files));
}
$('btnZip').addEventListener('click', () => { $('menuProfile').open = false; downloadZip(); });
document.addEventListener('click', (e) => { if (!e.target.closest('#menuProfile')) $('menuProfile').open = false; });

// ---------- remember your place ----------
let placeTimer = 0;
let stateTimer = 0;
function rememberPlace(now = false) {
  const s = cur();
  if (!s || s.deleted) return;
  s.pos = ed.selectionStart;
  state.last = keyOf(s);
  state.lastAt = Date.now();
  saveSoon();
  if (!cloud.on) return;
  clearTimeout(stateTimer);
  const send = () => api.putState({ last: { id: s.id, owner: s.owner }, pos: s.pos, at: state.lastAt });
  if (now) send(); else stateTimer = setTimeout(send, 4000);
}
function placeSoon() { clearTimeout(placeTimer); placeTimer = setTimeout(() => { if (inEditor) rememberPlace(); }, 1200); }
async function pullPlace() {
  const r = await api.getState();
  const st = r.ok && r.data.state;
  if (!st || !st.last || !(st.at > (state.lastAt || 0))) return;
  const key = st.last.owner && st.last.owner !== cloud.email ? st.last.owner + ':' + st.last.id : st.last.id;
  const s = byKey(key);
  if (!s) return;
  s.pos = st.pos;
  state.last = key;
  state.lastAt = st.at;
  saveSoon();
  if (!inEditor) renderLibrary();
}

// ====================================================================== Editor
function openScript(key) {
  closeLive();
  state.current = key;
  const s = cur();
  inEditor = true;
  $('home').hidden = true;
  $('editorView').hidden = false;
  ed.value = s.text;
  ed.readOnly = s.role === 'reviewer';
  ed.scrollTop = 0;
  renderPeers([]);
  renderEditor();
  if (s.pos > 0 && s.pos <= s.text.length) { ed.setSelectionRange(s.pos, s.pos); ed.scrollTop = Math.max(0, caretTop(s.pos) - 140); showElement(); }
  state.last = key;
  state.lastAt = Date.now();
  saveSoon();
  if (s.base > 0) openLive(s);
}

const pct = (n) => (n * 100).toFixed(3) + '%';
function runsHtml(runs) {
  return runs.map((r) => {
    let t = esc(r.t);
    if (r.u) t = `<u>${t}</u>`;
    if (r.i) t = `<i>${t}</i>`;
    if (r.b) t = `<b>${t}</b>`;
    return t;
  }).join('');
}
function pageHtml(p) {
  let h = '<div class="page"><div class="sheet">';
  for (const ln of p.lines) h += `<div class="ln" style="left:${pct((ln.col * 7.2) / 612)};top:${pct((72 + 12 * ln.row) / 792)}">${runsHtml(ln.runs)}</div>`;
  if (p.showNumber) {
    const label = p.number + '.';
    h += `<div class="pn" style="left:${pct((GRID.PAGE_NUM_END * 7.2 - label.length * 7.2) / 612)};top:${pct(36 / 792)}">${label}</div>`;
  }
  return h + '</div></div>';
}

function renderEditor() {
  const sc = cur();
  if (!sc) return;
  res = layoutScript(sc.text, state.settings);
  parsed = parse(sc.text);
  $('pages').innerHTML = res.pages.map(pageHtml).join('');
  knownNames = new Set(Object.keys(res.characters));
  $('docTitle').textContent = scriptName(sc.text);

  const st = res.stats;
  $('stats').textContent = `${st.pages} page${st.pages === 1 ? '' : 's'} · ${st.scenes} scene${st.scenes === 1 ? '' : 's'} · ${st.words} words · about ${st.minutes} min`;
  const n = res.scenes.length;
  $('sceneList').innerHTML = res.scenes.map((sn, i) =>
    `<li><span class="n">${i + 1}</span><button class="main" data-line="${sn.line}" title="${esc(sn.text)}">${esc(sn.text)}</button>` +
    `<small>p${sn.page}</small><button class="mv" data-move="${i}" data-dir="-1" title="Move up"${i === 0 ? ' disabled' : ''}>▲</button>` +
    `<button class="mv" data-move="${i}" data-dir="1" title="Move down"${i === n - 1 ? ' disabled' : ''}>▼</button></li>`
  ).join('') || '<li class="note">No scenes yet. Start one with INT. or EXT.</li>';

  $('scriptList').innerHTML = sorted().map((s) =>
    `<li class="${keyOf(s) === state.current ? 'on' : ''}"><button class="main" data-open="${esc(keyOf(s))}">${esc(scriptName(s.text))}</button><small>${s.owner ? 'Shared · ' : ''}${ago(s.updated)}</small></li>`).join('');

  const names = Object.entries(res.characters).sort((a, b) => b[1] - a[1]).map(([name]) => name);
  $('charList').innerHTML = names.map((name) => `<button data-name="${esc(name)}">${esc(name)}</button>`).join('') || '<span class="note">Characters show up here once they speak.</span>';

  const fb = check(sc.text, st.pages);
  $('checkSummary').textContent = fb.summary;
  $('checkSummary').dataset.ok = fb.fixes === 0 ? '1' : '0';
  $('checkList').innerHTML = fb.items.map((it) => `<li class="${it.level}"><button data-line="${it.line}"><b>${it.level === 'fix' ? 'Fix' : 'Tip'}</b> ${esc(it.msg)}</button></li>`).join('');
  showElement();
}
let renderTimer = 0;
function renderSoon() { clearTimeout(renderTimer); renderTimer = setTimeout(renderEditor, 150); }

function onChange() {
  const sc = cur();
  sc.text = ed.value;
  sc.updated = Date.now();
  sc.dirty = true;
  saveSoon();
  renderSoon();
  if (live && live.open) { setSync('saving'); live.localChanged(); } else pushSoon();
  folderSoon();
}
function setEditorText(t) {
  const a = ed.selectionStart;
  ed.value = t;
  const p = Math.min(a, t.length);
  ed.setSelectionRange(p, p);
}

// Enter after "int. kitchen" -> "INT. KITCHEN" + blank line. Same for known character names.
function smartEnter() {
  const pos = ed.selectionStart;
  const lines = ed.value.slice(0, pos).split('\n');
  const prev = lines[lines.length - 2];
  if (prev == null) return;
  const before = lines[lines.length - 3];
  const isScene = /^(int|ext|est|int\.?\/ext|i\/e)\./i.test(prev);
  const isName = prev.trim() !== '' && (before === undefined || before.trim() === '') && knownNames.has(prev.trim().toUpperCase());
  if ((isScene || isName) && prev !== prev.toUpperCase()) {
    const start = pos - 1 - prev.length;
    ed.setRangeText(prev.toUpperCase(), start, start + prev.length, 'preserve');
  }
  if (isScene && ed.value[pos] !== '\n') ed.setRangeText('\n', pos, pos, 'end');
}
ed.addEventListener('input', (e) => {
  if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') smartEnter();
  onChange();
});

function blockPrefix() {
  const before = ed.value.slice(0, ed.selectionStart);
  if (before === '' || before.endsWith('\n\n')) return '';
  return before.endsWith('\n') ? '\n' : '\n\n';
}
function insert(text, caretBack = 0) {
  if (ed.readOnly) return;
  ed.setRangeText(text, ed.selectionStart, ed.selectionEnd, 'end');
  const p = ed.selectionStart - caretBack;
  ed.setSelectionRange(p, p);
  ed.focus();
  onChange();
}

// ---------- elements ----------
const caretLine = () => ed.value.slice(0, ed.selectionStart).split('\n').length - 1;
function elementAt(line, elements = parsed.elements) {
  if ((ed.value.split('\n')[line] || '').trim() === '') return '';
  let t = '';
  for (const el of elements) { if (el.line <= line) t = el.type; else break; }
  return t === 'center' ? 'action' : t === 'pagebreak' ? '' : t;
}
function showElement() {
  const t = inEditor ? elementAt(caretLine()) : '';
  $('elSelect').value = t;
  for (const li of $('elList').children) li.classList.toggle('on', li.firstElementChild.dataset.el === t);
}
document.addEventListener('selectionchange', () => { if (document.activeElement === ed) { showElement(); placeSoon(); } });

function setElement(type) {
  if (ed.readOnly || !type) return;
  const lines = ed.value.split('\n');
  let ln = caretLine();
  let t = (lines[ln] || '').trim().replace(/^[!@]/, '').replace(/^>\s*/, '').replace(/^\.(?!\.)/, '');
  if (!t) {
    if (type === 'scene') insert(blockPrefix() + 'INT. ');
    else if (type === 'paren') insert('()', 1);
    else if (type === 'transition') insert(blockPrefix() + 'CUT TO:\n\n');
    else { ed.focus(); toast('Type the line first, then pick its element.'); }
    return;
  }
  if (type !== 'paren') t = t.replace(/^\((.*)\)$/, '$1');
  if (type === 'scene') { t = t.toUpperCase(); if (!/^(INT|EXT|EST|INT\.?\/EXT|I\/E)\./.test(t)) t = '.' + t; }
  else if (type === 'character') t = t.toUpperCase();
  else if (type === 'transition') { t = t.toUpperCase(); if (!/TO:$/.test(t)) t = '> ' + t; }
  else if (type === 'paren') t = '(' + t.replace(/^\(|\)$/g, '') + ')';
  lines[ln] = t;

  if (type === 'dialogue' || type === 'paren') {
    while (ln > 1 && lines[ln - 1].trim() === '') { lines.splice(ln - 1, 1); ln--; } // attach to the speech above
  } else if (ln > 0 && lines[ln - 1].trim() !== '') { lines.splice(ln, 0, ''); ln++; }
  if ((type === 'scene' || type === 'transition') && lines[ln + 1] !== undefined && lines[ln + 1].trim() !== '') lines.splice(ln + 1, 0, '');

  const got = () => { const e = parse(lines.join('\n')).elements.filter((x) => x.line <= ln).pop(); return e && e.line <= ln ? e.type : ''; };
  let now = got();
  if (now !== type) {
    if (type === 'action' && !/^!/.test(lines[ln])) lines[ln] = '!' + lines[ln];
    else if (type === 'character' && !/^@/.test(lines[ln])) lines[ln] = '@' + lines[ln];
    now = got();
  }
  if (now !== type && (type === 'dialogue' || type === 'paren')) return toast('Dialogue needs a character name on the line above it.');

  ed.value = lines.join('\n');
  let pos = 0;
  for (let i = 0; i < ln; i++) pos += lines[i].length + 1;
  pos += lines[ln].length;
  if (type === 'character' && lines[ln + 1] === undefined) { ed.value += '\n'; pos++; }
  ed.focus();
  ed.setSelectionRange(pos, pos);
  onChange();
  renderEditor();
}
$('elSelect').addEventListener('change', (e) => setElement(e.target.value));
$('elList').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setElement(b.dataset.el); });
$('charList').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) { if (!wide()) closeSides(); insert(blockPrefix() + b.dataset.name + '\n'); }
});

// ---------- navigation: drawer, inspector, views ----------
function setView(v) {
  if (v === 'split' && !wide()) v = 'write';
  work.dataset.view = v;
  state.ui.view = v;
  for (const b of $('viewSeg').children) b.classList.toggle('on', b.dataset.view === v);
}
$('viewSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setView(b.dataset.view); });
function setSide(id, open) {
  const el = $(id);
  if (open && !wide()) $(id === 'drawer' ? 'inspector' : 'drawer').classList.remove('open');
  el.classList.toggle('open', open);
  $('btnDrawer').classList.toggle('on', $('drawer').classList.contains('open'));
  $('btnInspector').classList.toggle('on', $('inspector').classList.contains('open'));
  $('scrim').classList.toggle('on', $('drawer').classList.contains('open') || $('inspector').classList.contains('open'));
  state.ui[id] = open;
  saveSoon();
}
const closeSides = () => { setSide('drawer', false); setSide('inspector', false); };
$('btnDrawer').addEventListener('click', () => setSide('drawer', !$('drawer').classList.contains('open')));
$('btnInspector').addEventListener('click', () => setSide('inspector', !$('inspector').classList.contains('open')));
$('scrim').addEventListener('click', closeSides);
$('btnHome').addEventListener('click', showHome);
function tabs(segId, map) {
  $(segId).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    for (const x of $(segId).children) x.classList.toggle('on', x === b);
    for (const [tab, id] of Object.entries(map)) $(id).hidden = tab !== b.dataset.tab;
  });
}
tabs('drawerSeg', { scenes: 'tabScenes', scripts: 'tabScripts' });
tabs('inspSeg', { elements: 'tabElements', layout: 'tabLayout', check: 'tabCheck' });

function caretTop(pos) {
  const m = document.createElement('div');
  const cs = getComputedStyle(ed);
  ['fontFamily', 'fontSize', 'lineHeight', 'paddingTop', 'paddingLeft', 'paddingRight', 'paddingBottom'].forEach((p) => { m.style[p] = cs[p]; });
  m.style.cssText += `;position:absolute;visibility:hidden;box-sizing:border-box;white-space:pre-wrap;overflow-wrap:break-word;width:${ed.clientWidth}px;`;
  m.textContent = ed.value.slice(0, pos);
  const mark = document.createElement('span');
  mark.textContent = '​';
  m.appendChild(mark);
  document.body.appendChild(m);
  const top = mark.offsetTop;
  m.remove();
  return top;
}
function jumpToLine(n) {
  if (!wide()) closeSides();
  if (work.dataset.view === 'pages') setView('write');
  const lines = ed.value.split('\n');
  let pos = 0;
  for (let i = 0; i < n && i < lines.length; i++) pos += lines[i].length + 1;
  ed.focus({ preventScroll: true });
  ed.setSelectionRange(pos, pos);
  ed.scrollTop = Math.max(0, caretTop(pos) - 60);
  // keep the page preview in step
  const sn = res.scenes.find((s) => s.line === n);
  if (sn && wide()) {
    const el = $('pages').children[sn.page - 1 + (res.hasTitlePage ? 1 : 0)];
    if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}
function moveScene(i, dir) {
  if (ed.readOnly) return;
  const j = i + dir;
  const sc = res.scenes;
  if (j < 0 || j >= sc.length) return;
  const lines = ed.value.split('\n');
  const start = (k) => sc[k].line;
  const end = (k) => (k + 1 < sc.length ? sc[k + 1].line : lines.length);
  const chunk = (k) => lines.slice(start(k), end(k)).join('\n').replace(/\s+$/, '');
  const [a, b] = i < j ? [i, j] : [j, i];
  const head = lines.slice(0, start(a)).join('\n');
  const tail = lines.slice(end(b)).join('\n');
  ed.value = (head ? head.replace(/\s+$/, '') + '\n\n' : '') + chunk(b) + '\n\n' + chunk(a) + '\n' + (tail.trim() ? '\n' + tail.replace(/^\n+/, '') : '');
  onChange();
  renderEditor();
}
$('sceneList').addEventListener('click', (e) => {
  const mv = e.target.closest('[data-move]');
  if (mv) return moveScene(Number(mv.dataset.move), Number(mv.dataset.dir));
  const b = e.target.closest('[data-line]');
  if (b) jumpToLine(Number(b.dataset.line));
});
$('scriptList').addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) { if (!wide()) closeSides(); openScript(b.dataset.open); } });
$('checkList').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) jumpToLine(Number(b.dataset.line)); });
$('btnFix').addEventListener('click', () => {
  if (ed.readOnly) return;
  const r = studioFix(ed.value);
  if (!r.changes) return toast('Nothing to fix automatically. The remaining items need your eye.');
  setEditorText(r.text);
  onChange();
  renderEditor();
  toast(`${r.changes} format fix${r.changes === 1 ? '' : 'es'} applied.`);
});

// ---------- layout options ----------
const OPTS = { optTitle: 'titlePage', optContd: 'contd', optBold: 'boldScenes', optNumbers: 'sceneNumbers' };
for (const [id, key] of Object.entries(OPTS)) {
  $(id).checked = !!state.settings[key];
  $(id).addEventListener('change', (e) => { state.settings[key] = e.target.checked; saveSoon(); renderEditor(); });
}
$('optSpace').checked = state.settings.sceneSpacing === 2;
$('optSpace').addEventListener('change', (e) => { state.settings.sceneSpacing = e.target.checked ? 2 : 1; saveSoon(); renderEditor(); });

// ---------- export ----------
function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 15000);
}
const fileBase = () => scriptName(cur().text).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'screenplay';
const closeMenu = () => { $('menuMore').open = false; };
$('btnPdf').addEventListener('click', () => {
  const r = layoutScript(cur().text, state.settings);
  download(fileBase() + '.pdf', new Blob([writePdf(r.pages, { title: r.meta.title || scriptName(cur().text) })], { type: 'application/pdf' }));
  closeMenu();
});
$('btnFountain').addEventListener('click', () => { download(fileBase() + '.fountain', new Blob([cur().text], { type: 'text/plain' })); closeMenu(); });
$('btnBackup').addEventListener('click', () => { downloadZip(); closeMenu(); });
document.addEventListener('click', (e) => { if (!e.target.closest('#menuMore')) closeMenu(); });

// ---------- voice dictation (browser speech engine, no LLM) ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const VOICE_CMDS = [
  [/\bnew paragraph\b/gi, '\n\n'], [/\bnew line\b/gi, '\n'], [/\bnew scene\b/gi, '\n\nINT. '], [/\bexterior scene\b/gi, '\n\nEXT. '],
  [/\bcut to\b/gi, '\n\nCUT TO:\n\n'], [/\bopen parenthesis\b/gi, '('], [/\bclose parenthesis\b/gi, ')'], [/\bdash\b/gi, '-'],
];
function insertSpoken(raw) {
  let s = raw.trim();
  for (const [re, rep] of VOICE_CMDS) s = s.replace(re, rep);
  s = s.replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\( /g, '(').replace(/ \)/g, ')');
  if (!s) return;
  const before = ed.value.slice(0, ed.selectionStart);
  if (!s.startsWith('\n') && before && !/\s$/.test(before)) s = ' ' + s;
  insert(s);
}
let rec = null;
let listening = false;
function voiceUi(on) { $('btnMic').classList.toggle('live', on); $('voiceBar').hidden = !on; }
$('btnMic').addEventListener('click', () => {
  if (!SR) return alert('Voice dictation is not available in this browser. You can still use the microphone key on your keyboard. It works in the editor too.');
  if (listening) { listening = false; rec.stop(); voiceUi(false); return; }
  if (work.dataset.view === 'pages') setView('write');
  rec = new SR();
  rec.continuous = true;
  rec.interimResults = false;
  rec.lang = 'en-US';
  rec.onresult = (ev) => { for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) insertSpoken(ev.results[i][0].transcript); };
  rec.onend = () => { if (listening) { try { rec.start(); } catch { /* already started */ } } else voiceUi(false); };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { listening = false; voiceUi(false); alert('Microphone permission was blocked. Allow it in your browser settings and try again.'); }
  };
  listening = true;
  rec.start();
  voiceUi(true);
});

// ====================================================================== Cloud
const cloud = { on: false, email: '', busy: false, again: false };
const SYNC_TEXT = { cloud: 'Saved to cloud', saving: 'Saving…', live: 'Live · saved', offline: 'Offline · saved on this device', local: 'Saved on this device' };
addEventListener('offline', () => setSync('offline'));
function setSync(kind) { for (const el of document.querySelectorAll('[data-sync]')) { el.textContent = SYNC_TEXT[kind] || ''; el.dataset.kind = kind; } }
function keepCopy(text) {
  const copy = /^\s*title:/im.test(text) ? text.replace(/^(\s*title:\s*)(.+)$/im, '$1$2 (my copy)') : text;
  state.scripts.push(newScript(copy));
  toast('This script was changed somewhere else. Your version was kept as "(my copy)".');
}

// ---------- real-time ----------
let live = null;
const COLORS = ['#111114', '#4a4a52', '#77777f', '#2c2c31', '#5e5e66', '#8d8d96'];
function renderPeers(list) {
  const others = list.filter((e, i) => !(e === cloud.email && list.indexOf(e) === i));
  $('peers').innerHTML = others.slice(0, 4).map((e) => {
    let h = 0;
    for (const c of e) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return `<span style="background:${COLORS[h % COLORS.length]}" title="${esc(e)} is here">${esc(e.slice(0, 2).toUpperCase())}</span>`;
  }).join('');
}
function closeLive() { if (live) { live.close(); live = null; } renderPeers([]); }
function openLive(s) {
  closeLive();
  if (!cloud.on || !inEditor) return;
  const key = keyOf(s);
  const mine = (live = new Live({
    url: api.liveUrl(s),
    getText: () => ed.value,
    onInit(m, prev) {
      if (live !== mine) return;
      ed.readOnly = m.role === 'reviewer';
      let text = ed.value;
      if (prev !== null) {
        // reconnect: put my unsent typing on top of what the others did meanwhile
        const unsent = diff(prev, text);
        const theirs = diff(prev, m.text);
        text = unsent ? apply(m.text, theirs ? transform(unsent, theirs, false) : unsent) : m.text;
      } else if (text !== m.text) {
        if (s.dirty && m.updated !== s.base) keepCopy(text);
        if (!s.dirty || m.updated !== s.base) text = m.text;
      }
      s.base = m.updated;
      if (text !== ed.value) { setEditorText(text); s.text = text; renderEditor(); }
      if (text === m.text) s.dirty = false;
      saveSoon();
    },
    applyRemote(op) {
      if (live !== mine) return;
      ed.setRangeText(op.s, op.p, op.p + op.d, 'preserve');
      s.text = ed.value;
      s.updated = Date.now();
      saveSoon();
      renderSoon();
    },
    onAck() { if (live === mine && mine.inSync()) { s.dirty = false; saveSoon(); setSync('live'); } },
    onSaved(ts) { s.base = ts; saveSoon(); },
    onPeers(list) { if (live === mine) renderPeers(list); },
    onStatus(open) { if (live === mine) setSync(open ? (mine.inSync() ? 'live' : 'saving') : navigator.onLine ? 'saving' : 'offline'); },
  }));
  mine.key = key;
}

// ---------- background sync for everything that is not open live ----------
async function pushOne(s) {
  const sent = s.text;
  const r = await api.put(s, sent, s.base, false);
  if (r.ok) {
    s.base = r.data.updated;
    if (s.text === sent) s.dirty = false;
    if (inEditor && keyOf(s) === state.current && !live) openLive(s);
    return 'ok';
  }
  if (r.status === 409 && r.data && r.data.server) {
    keepCopy(sent);
    s.text = r.data.server.text;
    s.base = r.data.server.updated;
    s.dirty = false;
    if (keyOf(s) === state.current && inEditor) { setEditorText(s.text); renderEditor(); }
    return 'conflict';
  }
  if (r.status === 401) return 'auth';
  if (r.status === 403 || r.status === 404) { s.dirty = false; return 'ok'; } // no longer shared with me
  return 'offline';
}
async function pullAll() {
  const r = await api.list();
  if (!r.ok || !Array.isArray(r.data.scripts)) return false;
  const remote = new Set();
  const parseMeta = (m) => { try { return JSON.parse(m || '{}') || {}; } catch { return {}; } };
  for (const rs of r.data.scripts) {
    const owner = rs.owner === cloud.email ? null : rs.owner;
    const key = owner ? owner + ':' + rs.id : rs.id;
    remote.add(key);
    const loc = byKey(key);
    if (loc) {
      loc.role = rs.role;
      if (!loc.metaDirty) { loc.status = rs.status; loc.meta = { ...parseMeta(rs.meta) }; }
      if (!loc.delDirty) loc.deleted = !!rs.deleted;
      if (loc.dirty || rs.updated <= loc.base || (live && live.key === key)) continue;
    }
    const g = await api.get({ id: rs.id, owner });
    if (!g.ok) continue;
    if (!loc) state.scripts.push({ id: rs.id, owner, role: rs.role, text: g.data.text, updated: g.data.updated, base: g.data.updated, dirty: false, status: rs.status, meta: parseMeta(rs.meta), metaDirty: false, deleted: !!rs.deleted, delDirty: false });
    else {
      loc.text = g.data.text; loc.base = g.data.updated; loc.updated = g.data.updated;
      if (inEditor && key === state.current) setEditorText(loc.text);
    }
  }
  // a new device starts with the sample; drop it once real scripts arrive
  if (remote.size) state.scripts = state.scripts.filter((x) => !(x.base === 0 && !x.dirty && x.text === SAMPLE) || (inEditor && keyOf(x) === state.current));
  // no longer shared with me
  state.scripts = state.scripts.filter((x) => x.base === 0 || x.dirty || remote.has(keyOf(x)));
  if (!state.scripts.some((x) => !x.deleted)) state.scripts.push(newScript(STARTER, { dirty: false }));
  if (inEditor && (!cur() || cur().deleted)) showHome();
  return true;
}
async function syncNow({ pull = false } = {}) {
  if (!cloud.on) return;
  if (cloud.busy) { cloud.again = true; return; }
  cloud.busy = true;
  let status = 'cloud';
  try {
    if (pull && !(await pullAll())) status = 'offline';
    if (status === 'cloud') {
      for (const s of state.scripts.filter((x) => x.dirty && !x.deleted && x.role !== 'reviewer' && !(live && live.open && live.key === keyOf(x)))) {
        const res2 = await pushOne(s);
        if (res2 === 'offline') { status = 'offline'; break; }
        if (res2 === 'auth') { status = 'local'; cloud.on = false; break; }
      }
    }
    if (status === 'cloud') {
      for (const s of state.scripts.filter((x) => x.metaDirty && x.base > 0)) {
        const r = await api.patch(s, { status: s.status, meta: s.meta || {} });
        if (r.ok || r.status === 403 || r.status === 404) s.metaDirty = false;
      }
      for (const s of state.scripts.filter((x) => x.delDirty && x.base > 0)) {
        const r = s.deleted ? await api.del(s) : await api.restore(s);
        if (r.ok || r.status === 403 || r.status === 404) s.delDirty = false; else status = 'offline';
      }
    }
  } finally {
    cloud.busy = false;
  }
  saveSoon();
  if (!(live && live.open)) setSync(status);
  if (!inEditor) { if (!document.activeElement || !/INPUT|SELECT/.test(document.activeElement.tagName) || document.activeElement.id === 'q') renderLibrary(); } else renderSoon();
  if (cloud.again && cloud.on) { cloud.again = false; syncNow(); }
}
let pushTimer = 0;
function pushSoon() { if (!cloud.on) return; clearTimeout(pushTimer); pushTimer = setTimeout(() => syncNow(), 1200); }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow({ pull: true }); });
addEventListener('online', () => syncNow({ pull: true }));

// ---------- version history ----------
let histTarget = null;
async function openHistory(s) {
  closeMenu();
  if (!cloud.on) return toast('Version history needs the cloud version with sign-in.');
  if (s.base === 0) return toast('Still saving. Try again in a moment.');
  histTarget = s;
  const list = $('histList');
  list.innerHTML = '<li>Loading…</li>';
  $('dlgHistory').showModal();
  const r = await api.versions(s);
  if (!r.ok) list.innerHTML = '<li>Could not load history. Check your connection.</li>';
  else if (!r.data.versions.length) list.innerHTML = '<li>No saved versions yet.</li>';
  else {
    list.innerHTML = r.data.versions.map((v) =>
      `<li><span>${new Date(v.saved).toLocaleString()}<br><small>${v.size.toLocaleString()} characters</small></span><button class="btn" data-vid="${v.id}">Restore</button></li>`).join('');
  }
}
$('btnHistory').addEventListener('click', () => openHistory(cur()));
$('histList').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  const s = histTarget;
  if (!b || !s || s.role === 'reviewer' || s.deleted) return;
  if (!confirm('Go back to this version? Your current text is saved to history first, so nothing is lost.')) return;
  if (live) live.send();
  await api.snapshot(s);
  const r = await api.version(s, b.dataset.vid);
  if (!r.ok) return alert('Could not load that version.');
  if (inEditor && keyOf(s) === state.current) { setEditorText(r.data.text); onChange(); renderEditor(); }
  else { s.text = r.data.text; s.updated = Date.now(); s.dirty = true; saveSoon(); renderLibrary(); pushSoon(); folderSoon(); }
  $('dlgHistory').close();
  toast('Version restored.');
});
$('histClose').addEventListener('click', () => $('dlgHistory').close());

// ---------- sharing ----------
let shareTarget = null;
async function loadShares() {
  const r = await api.shares(shareTarget);
  $('shareList').innerHTML = !r.ok ? '<li>Could not load. Check your connection.</li>'
    : r.data.shares.map((x) => `<li><span>${esc(x.email)}<br><small>${x.role === 'reviewer' ? 'Can read' : 'Can edit'}</small></span><button class="mini danger" data-email="${esc(x.email)}">Remove</button></li>`).join('') || '<li><small>Not shared with anyone yet.</small></li>';
}
function openShare(s) {
  closeMenu();
  if (!cloud.on) return toast('Sharing needs the cloud version with sign-in.');
  if (s.owner) return toast('Only the owner can share this script.');
  if (s.base === 0) return toast('Still saving. Try again in a moment.');
  shareTarget = s;
  $('shareList').innerHTML = '<li>Loading…</li>';
  $('dlgShare').showModal();
  loadShares();
}
$('btnShare').addEventListener('click', () => openShare(cur()));
$('shareForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await api.share(shareTarget, $('shareEmail').value, $('shareRole').value);
  if (!r.ok) return toast('Could not share. Check the email address.');
  $('shareEmail').value = '';
  loadShares();
});
$('shareList').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-email]');
  if (b) { await api.unshare(shareTarget, b.dataset.email); loadShares(); }
});
$('shareClose').addEventListener('click', () => $('dlgShare').close());

// ====================================================================== boot
setView(state.ui.view || (wide() ? 'split' : 'write'));
if (wide()) { setSide('drawer', state.ui.drawer !== false); setSide('inspector', !!state.ui.inspector); }
setSync(navigator.onLine ? 'local' : 'offline');
$('whoami').textContent = 'Not signed in. Scripts are saved on this device.';
renderLibrary();
folderLabel();
applySide();
if (folder.supported && state.ui.folder) {
  folder.remembered().then(async (dir) => { if (dir && (await folder.allowed(dir, false))) { folderDir = dir; folderLabel(); folderWrite(); } });
}
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
// ---------- sign in ----------
let authEmail = '';
function showAuth(on) {
  $('auth').hidden = !on;
  if (on) { $('aEmailForm').hidden = false; $('aCodeForm').hidden = true; $('aMsg').textContent = ''; setTimeout(() => $('aEmail').focus(), 50); }
}
function aMsg(t, ok) { const m = $('aMsg'); m.textContent = t || ''; m.className = 'amsg' + (ok ? ' ok' : ''); }
async function sendCode(email) {
  $('aSend').disabled = true; aMsg('Sending…', true);
  const r = await api.authRequest(email);
  $('aSend').disabled = false;
  if (r.status === 0) return aMsg('You are offline. Connect to the internet to sign in.');
  if (!r.ok) return aMsg((r.data && r.data.error) || 'Could not send the code. Try again.');
  authEmail = email; aMsg('');
  $('aSent').textContent = 'We sent a 6-digit code to ' + email + '. It works for 10 minutes.';
  $('aEmailForm').hidden = true; $('aCodeForm').hidden = false; $('aCode').value = '';
  if (r.data.devCode) $('aCode').dataset.dev = r.data.devCode; // only present in local development
  setTimeout(() => $('aCode').focus(), 50);
}
$('aEmailForm').addEventListener('submit', (e) => { e.preventDefault(); sendCode($('aEmail').value.trim().toLowerCase()); });
$('aResend').addEventListener('click', () => sendCode(authEmail));
$('aBack').addEventListener('click', () => { $('aCodeForm').hidden = true; $('aEmailForm').hidden = false; aMsg(''); $('aEmail').focus(); });
$('aCodeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('aCode').value.replace(/\D/g, '');
  if (code.length !== 6) return aMsg('Enter the 6 digits from your email.');
  $('aGo').disabled = true; aMsg('Checking…', true);
  const r = await api.authVerify(authEmail, code);
  $('aGo').disabled = false;
  if (!r.ok) return aMsg((r.data && r.data.error) || 'That code did not work.');
  location.reload(); // start clean as the signed-in user
});
window.addEventListener('auth-required', () => { if (navigator.onLine) showAuth(true); });
const unsaved = () => state.scripts.some((x) => x.dirty || x.metaDirty || x.delDirty);
async function signOut(all) {
  if (cloud.on) await syncNow();
  if (unsaved() && !confirm('Some changes are not in the cloud yet (no connection?). They will stay on this device and come back when you sign in again. Sign out now?')) return;
  const r = await api.logout(all);
  if (!r.ok) return alert('Could not sign out right now. Check your connection.');
  // Everything is in the cloud, so clear this device. Anything unsent is set aside under this account.
  signingOut = true; // stop the page from writing its copy back while it closes
  try {
    if (unsaved() && cloud.email) localStorage.setItem(STASH + cloud.email, JSON.stringify(state));
    localStorage.removeItem(KEY);
  } catch {}
  location.reload();
}
$('btnSignOut').addEventListener('click', () => signOut(false));
$('btnSignOutAll').addEventListener('click', () => signOut(true));

api.me().then(async (me) => {
  if (me.status === 401) { showAuth(true); return; }
  if (!me.ok || !me.data.email) return;
  cloud.on = true;
  cloud.email = me.data.email;
  // never mix two accounts on one device
  if (state.account && state.account !== me.data.email) {
    try { localStorage.setItem(STASH + state.account, JSON.stringify(state)); } catch {}
    let back = null;
    try { back = JSON.parse(localStorage.getItem(STASH + me.data.email)); localStorage.removeItem(STASH + me.data.email); } catch {}
    state = back && Array.isArray(back.scripts) ? back : (() => { const f = newScript(SAMPLE, { dirty: false }); return { scripts: [f], current: keyOf(f), settings: { ...DEFAULTS }, ui: {} }; })();
  } else if (!state.account) {
    try { const b = JSON.parse(localStorage.getItem(STASH + me.data.email)); if (b && Array.isArray(b.scripts) && b.scripts.some((x) => x.dirty || x.metaDirty || x.delDirty)) { for (const x of b.scripts) if (!state.scripts.some((y) => y.id === x.id)) state.scripts.push(x); } localStorage.removeItem(STASH + me.data.email); } catch {}
  }
  state.account = me.data.email;
  saveNow();
  renderLibrary();
  $('avatar').textContent = me.data.email[0].toUpperCase();
  $('whoami').textContent = 'Signed in as ' + me.data.email;
  await syncNow({ pull: true });
  pullPlace();
});
