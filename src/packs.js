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
  for (const p of PACKS.values()) if (p.secret) out.push({ word: String(p.secret).toLowerCase(), pack: p });
  return out;
}

// returns false if it was already unlocked
export function unlockPack(pack) {
  if (isUnlocked(pack.id)) return false;
  sessionUnlocked.add(pack.id);
  try { localStorage.setItem(KEY, JSON.stringify([...unlockedIds(), pack.id])); } catch { /* storage blocked: unlocked for this visit only */ }
  return true;
}
