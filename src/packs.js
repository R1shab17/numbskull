// Optional content packs: an extra map plus a matching look, added by the page that hosts
// the game. The open-source game ships without any and plays exactly the same without them.
//
// A pack is plain data, registered before the game script runs:
//
//   (globalThis.NumbskullPacks = globalThis.NumbskullPacks || []).push({
//     id: 'mypack',
//     secret: 'word',                 // optional: map stays hidden until this is typed on the home screen
//     images: { logo: 'data:...' },   // optional: pictures the map and theme can use by name
//     map: { id, name, blurb, swatch, build: (kit) => mapDefinition },
//     fonts: ['600 16px "My Font"'],  // optional: faces (declared with @font-face in theme.css) to load first
//     theme: { css, note, lingo, champion, bots },   // optional: see lingo.js and theme.js
//   });
//
// `build` receives the same helpers the built-in maps use (B, flight, mirror, mirrorPts,
// perimeter) and returns a map in the same shape as those in maps.js. Scenery can use the
// generic decor types in scene.js ('banner', 'floor', 'image', 'sign', 'lamp', ...).
//
// A secret pack can also ship sealed, so the page gives away neither what it is nor its word:
// the script above is encrypted (AES-GCM, key = PBKDF2 of the secret word) and the page only
// carries the result:
//
//   (globalThis.NumbskullSealed = globalThis.NumbskullSealed || []).push({ id, salt, iv, data, len, iter });
//
// Typing the word decrypts and runs it (len is the word's length, so only that many typed
// letters are tried). A host playing its map passes the key to the room, so friends who don't
// know the word can still join; they get the map for that visit only.
import { MAPS, MAP_LIST, mapKit, finalize } from './maps.js';

export const PACKS = new Map();
const imageCache = {};

export function loadPacks() {
  const list = globalThis.NumbskullPacks;
  if (!Array.isArray(list)) return;
  for (const p of list) {
    try { registerPack(p); } catch (e) { console.warn('Numbskull: skipped a pack that failed to load', e); }
  }
}

function registerPack(p) {
  if (!p || typeof p.id !== 'string' || PACKS.has(p.id) || !p.map || typeof p.map.build !== 'function') return;
  const mapId = String(p.map.id || p.id);
  if (MAPS[mapId]) return; // never replace a built-in map
  const images = {};
  if (typeof Image !== 'undefined') {
    for (const [name, src] of Object.entries(p.images || {})) {
      const img = imageCache[src] || (imageCache[src] = new Image());
      if (!img.src) img.src = src;
      images[name] = img;
    }
  }
  MAPS[mapId] = () => {
    const m = finalize(p.map.build(mapKit));
    m.id = mapId;
    m.images = images;
    m.pack = p.id;
    return m;
  };
  MAP_LIST.push({ id: mapId, name: p.map.name || mapId, blurb: p.map.blurb || '', swatch: p.map.swatch, pack: p.id, secret: !!p.secret });
  PACKS.set(p.id, { ...p, mapId });
  // the theme's CSS is scoped to :root.theme-<id>, so it can go in straight away (its fonts too)
  const css = p.theme && p.theme.css;
  if (css && typeof document !== 'undefined' && !document.getElementById('pack-css-' + p.id)) {
    const el = document.createElement('style');
    el.id = 'pack-css-' + p.id;
    el.textContent = css;
    document.head.append(el);
  }
}

// Resolve once every pack picture and font is ready (or after `ms`), so scenery and the
// numbers on people's heads are drawn with them.
export function packImagesReady(ms = 2500) {
  const waits = Object.values(imageCache).map(img => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()));
  if (typeof document !== 'undefined' && document.fonts) {
    for (const p of PACKS.values()) for (const f of p.fonts || []) waits.push(document.fonts.load(f).catch(() => {}));
  }
  if (!waits.length) return Promise.resolve();
  return Promise.race([Promise.all(waits), new Promise(r => setTimeout(r, ms))]);
}

export function packForMap(mapId) {
  for (const p of PACKS.values()) if (p.mapId === mapId) return p;
  return null;
}

// ---------------------------------------------------------------- secret maps
const KEY = 'numbskull.unlocked';
const sessionUnlocked = new Set();
function unlockedIds() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } }
export const isUnlocked = (packId) => sessionUnlocked.has(packId) || unlockedIds().includes(packId);

// The maps this player can pick: built-in ones plus packs that aren't secret or are unlocked.
export function pickableMaps() { return MAP_LIST.filter(m => !m.secret || isUnlocked(m.pack)); }
export const builtInMaps = () => MAP_LIST.filter(m => !m.pack);

// Every secret word this page knows, for the home screen to listen for.
export function secretWords() {
  const out = [];
  for (const p of PACKS.values()) if (typeof p.secret === 'string' && p.secret) out.push({ word: p.secret.toLowerCase(), pack: p });
  return out;
}

// ---------------------------------------------------------------- sealed packs
const KEYS = 'numbskull.keys';
const sealedOpen = new Map();   // sealed id -> { key (base64), packs }
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const sealedList = () => (Array.isArray(globalThis.NumbskullSealed) ? globalThis.NumbskullSealed : []).filter(x => x && x.id && x.data);
const savedKeys = () => { try { return JSON.parse(localStorage.getItem(KEYS) || '{}') || {}; } catch { return {}; } };

// true if this page has any secret map to find (so the phone shortcut has something to open)
export const hasSecrets = () => sealedList().length > 0 || secretWords().length > 0;

async function openWith(entry, rawKey) {
  if (sealedOpen.has(entry.id)) return sealedOpen.get(entry.id).packs;
  if (!globalThis.crypto || !crypto.subtle) return null;
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  let text;
  try { text = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(entry.iv) }, key, unb64(entry.data))); }
  catch { return null; } // wrong word
  const before = new Set(PACKS.keys());
  try { new Function(text)(); } catch (e) { console.warn('Numbskull: a sealed pack failed to run', e); return null; }
  loadPacks();
  const packs = [...PACKS.values()].filter(p => !before.has(p.id));
  sealedOpen.set(entry.id, { key: b64(new Uint8Array(rawKey)), packs });
  for (const p of packs) p.sealed = entry.id;
  return packs;
}

async function keyFromWord(word, entry) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(word), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(entry.salt), iterations: entry.iter || 100000 }, base, 256);
}

// The word someone typed (or the last letters of what they typed). Returns the packs it
// unlocked, if any, and remembers the key so they open by themselves on later visits.
export async function tryWord(typed) {
  const word = String(typed || '').toLowerCase();
  const found = [];
  for (const w of secretWords()) if (word.endsWith(w.word)) found.push(w.pack);
  if (!globalThis.crypto || !crypto.subtle) return found;
  for (const entry of sealedList()) {
    if (sealedOpen.has(entry.id) || word.length < entry.len) continue;
    const raw = await keyFromWord(word.slice(-entry.len), entry);
    const packs = await openWith(entry, raw);
    if (!packs) continue;
    try { localStorage.setItem(KEYS, JSON.stringify({ ...savedKeys(), [entry.id]: b64(new Uint8Array(raw)) })); } catch { /* this visit only */ }
    found.push(...packs);
  }
  return found;
}

// Open the sealed packs this browser has unlocked before.
export async function openSavedPacks() {
  const keys = savedKeys();
  for (const entry of sealedList()) if (keys[entry.id]) { try { await openWith(entry, unb64(keys[entry.id])); } catch { /* stale key */ } }
}

// Hosts: the key to pass on for a map that came from a sealed pack (null for any other map).
export function sealedKeyFor(mapId) {
  const p = packForMap(mapId);
  if (!p || !p.sealed || !sealedOpen.has(p.sealed)) return null;
  return { id: p.sealed, key: sealedOpen.get(p.sealed).key };
}

// Players joining a room on a sealed map: open it with the key the host sent.
export async function openWithKey(pk) {
  if (!pk || typeof pk.id !== 'string' || typeof pk.key !== 'string') return false;
  const entry = sealedList().find(e => e.id === pk.id);
  if (!entry) return false;
  try { return !!(await openWith(entry, unb64(pk.key))); } catch { return false; }
}

// returns false if it was already unlocked
export function unlockPack(pack) {
  if (isUnlocked(pack.id)) return false;
  sessionUnlocked.add(pack.id);
  try { localStorage.setItem(KEY, JSON.stringify([...unlockedIds(), pack.id])); } catch { /* storage blocked: unlocked for this visit only */ }
  return true;
}
