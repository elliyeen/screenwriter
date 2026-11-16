// "Save to a folder on this computer": every script is written as a plain .fountain file in a folder
// the person picks, like Obsidian. Needs the File System Access API (Chrome and Edge on a computer).
export const supported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('screenwriter-folder', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function kv(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}
export const remembered = () => kv('readonly', (s) => s.get('dir')).catch(() => null);
export const forget = () => kv('readwrite', (s) => s.delete('dir'));

export async function pick() {
  const dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'screenwriter' });
  await kv('readwrite', (s) => s.put(dir, 'dir'));
  return dir;
}
/** Browsers ask again for permission after a restart. `ask` must come from a click. */
export async function allowed(dir, ask) {
  if (!dir.queryPermission) return true;
  const o = { mode: 'readwrite' };
  if ((await dir.queryPermission(o)) === 'granted') return true;
  return ask ? (await dir.requestPermission(o)) === 'granted' : false;
}

const safe = (t) => (t.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '') || 'Untitled').slice(0, 80);
const hash = (t) => { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return t.length + ':' + h; };

/**
 * writeScripts(dir, [{ id, title, text }], names) -> names
 * names = { [id]: { file, hash } } remembers what was written so unchanged files are skipped
 * and a renamed script does not leave its old file behind.
 */
export async function writeScripts(dir, items, names = {}) {
  const used = new Set();
  for (const it of items) {
    let file = safe(it.title) + '.fountain';
    if (used.has(file.toLowerCase())) file = safe(it.title) + ' (' + it.id.slice(0, 4) + ').fountain';
    used.add(file.toLowerCase());
    const prev = names[it.id];
    const h = hash(it.text);
    if (prev && prev.file === file && prev.hash === h) continue;
    const fh = await dir.getFileHandle(file, { create: true });
    const w = await fh.createWritable();
    await w.write(it.text);
    await w.close();
    if (prev && prev.file !== file) { try { await dir.removeEntry(prev.file); } catch { /* already gone */ } }
    names[it.id] = { file, hash: h };
  }
  return names;
}
