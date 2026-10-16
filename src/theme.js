// Switches the page look to a map pack's theme (or back to the normal one).
// A theme can bring CSS (scoped under :root.theme-<pack id>), new words (lingo.js) and
// a sticky-note style for the numbers on everyone's heads.
import { setLingo } from './lingo.js';
import { setNoteStyle } from './scene.js';

let current = null;

// returns true if the look changed
export function applyTheme(pack) {
  const id = pack ? pack.id : null;
  if (id === current) return false;
  const root = document.documentElement;
  if (current) root.classList.remove('theme-' + current);
  current = id;
  const T = (pack && pack.theme) || null;
  if (pack) {
    if (T && T.css && !document.getElementById('pack-css-' + id)) {
      const s = document.createElement('style');
      s.id = 'pack-css-' + id;
      s.textContent = T.css;
      document.head.append(s);
    }
    // pictures are available to the pack's CSS as var(--pack-<name>)
    for (const [k, src] of Object.entries(pack.images || {})) root.style.setProperty(`--pack-${k}`, `url("${src}")`);
    root.classList.add('theme-' + id);
  }
  setLingo(T ? { ...(T.lingo || {}), champion: T.champion } : null);
  setNoteStyle(T && T.note);
  return true;
}

export const currentTheme = () => current;
