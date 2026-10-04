// Keyboard, mouse (pointer lock) and touch input.
// Physical key codes are used, so WASD and the number row work on any layout.

const DIGIT = {};
for (let i = 0; i <= 9; i++) { DIGIT['Digit' + i] = i; DIGIT['Numpad' + i] = i; }

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.dx = 0; this.dy = 0;
    this.mouseL = false; this.mouseR = false;
    this.locked = false;
    this.enabled = false;
    this.sens = 1; this.invertY = false;
    this.handlers = {};      // event callbacks set by the app
    this.touch = { active: false, mx: 0, my: 0, lookId: null, moveId: null, lx: 0, ly: 0, zoom: false, crouch: false, sprint: false, jump: false };
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

    addEventListener('keydown', (e) => this.onKey(e, true));
    addEventListener('keyup', (e) => this.onKey(e, false));
    addEventListener('blur', () => { this.keys.clear(); this.mouseL = this.mouseR = false; });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      this.handlers.lockChange?.(this.locked);
    });
    document.addEventListener('pointerlockerror', () => this.lockError());
    addEventListener('mousemove', (e) => {
      if (this.locked) { this.dx += e.movementX; this.dy += e.movementY; }
      else if (this.dragLook && this.enabled) { this.dx += e.movementX; this.dy += e.movementY; this._moved = (this._moved || 0) + Math.abs(e.movementX) + Math.abs(e.movementY); }
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (this.noLock) {
        // spectating: plain mouse, drag to move the camera, click to pick a player
        this.dragLook = true; this._down = [e.clientX, e.clientY]; this._moved = 0;
        return;
      }
      if (!this.locked && !this.isTouch && !this.lockFailed) { this.lock(true); return; }
      if (this.lockFailed && !this.locked) {
        // no pointer lock available: drag to look, G to throw, right button for binoculars
        this.dragLook = true;
        if (e.button === 2) this.mouseR = true;
        return;
      }
      if (e.button === 0) { this.mouseL = true; this.handlers.primary?.(); }
      if (e.button === 2) this.mouseR = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseL = false; if (e.button === 2) this.mouseR = false;
      if (this.noLock && this._down && (this._moved || 0) < 6 && e.target === this.canvas) this.handlers.pick?.(e.clientX, e.clientY);
      this._down = null; this.dragLook = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // touch drag / tap on the 3D view while spectating
    let tId = null, tx = 0, ty = 0, tMoved = 0;
    canvas.addEventListener('touchstart', (e) => {
      if (!this.noLock || tId !== null) return;
      const t = e.changedTouches[0]; tId = t.identifier; tx = t.clientX; ty = t.clientY; tMoved = 0;
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      if (!this.noLock) return;
      for (const t of e.changedTouches) if (t.identifier === tId) {
        const mx = t.clientX - tx, my = t.clientY - ty; tx = t.clientX; ty = t.clientY;
        this.dx += mx * 1.6; this.dy += my * 1.6; tMoved += Math.abs(mx) + Math.abs(my);
      }
    }, { passive: true });
    canvas.addEventListener('touchend', (e) => {
      for (const t of e.changedTouches) if (t.identifier === tId) {
        if (this.noLock && tMoved < 8) this.handlers.pick?.(t.clientX, t.clientY);
        tId = null;
      }
    });
    addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      if (this.noLock) { if (e.target === this.canvas) this.handlers.wheel?.(Math.sign(e.deltaY)); return; }
      if (this.locked || this.lockFailed) this.handlers.cycle?.(Math.sign(e.deltaY));
    }, { passive: true });
  }

  // fromClick: the request came straight from a mouse click, so a failure means
  // pointer lock really isn't available here (not just the browser's re-lock cooldown)
  lock(fromClick = false) {
    this._fromClick = fromClick;
    if (!this.canvas.requestPointerLock) { if (fromClick) this.lockError(); return; }
    try {
      const r = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (r && r.catch) r.catch(() => {
        try { const r2 = this.canvas.requestPointerLock(); if (r2 && r2.catch) r2.catch(() => this.lockError()); } catch { this.lockError(); }
      });
    } catch { this.lockError(); }
  }
  lockError() {
    if (this.locked) return;
    if (this._fromClick) { this.lockFailed = true; this.handlers.lockChange?.(false, true); }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  onKey(e, down) {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (down && e.code === 'Escape') e.target.blur();
      return;
    }
    const c = e.code;
    if (down) this.keys.add(c); else this.keys.delete(c);
    if (!down) return;
    if (c === 'Tab' || c === 'Space' || c.startsWith('Arrow') || c === 'Backspace' || c === 'Slash') e.preventDefault();
    if (e.repeat) return;
    const h = this.handlers;
    if (c in DIGIT) { h.digit?.(DIGIT[c]); return; }
    if (c === 'Backspace' || c === 'Delete' || c === 'NumpadDecimal') { h.backspace?.(); return; }
    if (c === 'Escape') { h.escape?.(); return; }
    if (c === 'KeyQ' || c === 'KeyE') { h.cycle?.(c === 'KeyQ' ? -1 : 1); return; }
    if (c === 'KeyF') { h.photo?.(); return; }
    if (c === 'KeyG') { h.primary?.(); return; }
    if (c === 'KeyT' || c === 'Enter' || c === 'NumpadEnter') { h.chat?.(); return; }
    if (c === 'KeyM') { h.mute?.(); return; }
    if (c === 'KeyZ') { h.toggleZoom?.(); return; }
    if (c === 'KeyV') { h.view?.(); return; }
    if (c === 'ArrowLeft' || c === 'ArrowRight') { h.arrow?.(c === 'ArrowLeft' ? -1 : 1); return; }
  }

  down(code) { return this.keys.has(code); }

  // movement + action state for this frame
  state() {
    const k = this.keys, t = this.touch;
    let fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let right = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    if (t.moveId !== null) { fwd = -t.my; right = t.mx; }
    return {
      fwd, right,
      jump: k.has('Space') || t.jump,
      sprint: k.has('ShiftLeft') || k.has('ShiftRight') || t.sprint || (t.moveId !== null && Math.hypot(t.mx, t.my) > 0.95),
      crouch: k.has('KeyC') || k.has('ControlRight') || t.crouch,
      zoom: this.mouseR || k.has('KeyX') || t.zoom || this.zoomToggle,
      score: k.has('Tab'),
    };
  }

  takeLook() {
    const dx = this.dx, dy = this.dy;
    this.dx = 0; this.dy = 0;
    return [dx, dy];
  }

  // ---------------------------------------------------------------- touch
  bindTouch(root) {
    const stickZone = root.querySelector('[data-touch="move"]');
    const lookZone = root.querySelector('[data-touch="look"]');
    const knob = root.querySelector('.stick-knob');
    const t = this.touch;
    let sx = 0, sy = 0;
    stickZone.addEventListener('touchstart', (e) => {
      const tt = e.changedTouches[0]; t.moveId = tt.identifier; sx = tt.clientX; sy = tt.clientY;
      knob.style.transform = 'translate(-50%,-50%)'; e.preventDefault();
    }, { passive: false });
    lookZone.addEventListener('touchstart', (e) => {
      const tt = e.changedTouches[0]; t.lookId = tt.identifier; t.lx = tt.clientX; t.ly = tt.clientY; e.preventDefault();
    }, { passive: false });
    const move = (e) => {
      for (const tt of e.changedTouches) {
        if (tt.identifier === t.moveId) {
          let mx = (tt.clientX - sx) / 50, my = (tt.clientY - sy) / 50;
          const L = Math.hypot(mx, my); if (L > 1) { mx /= L; my /= L; }
          t.mx = mx; t.my = my;
          knob.style.transform = `translate(calc(-50% + ${mx * 40}px), calc(-50% + ${my * 40}px))`;
        } else if (tt.identifier === t.lookId) {
          this.dx += (tt.clientX - t.lx) * 2.2; this.dy += (tt.clientY - t.ly) * 2.2;
          t.lx = tt.clientX; t.ly = tt.clientY;
        }
      }
    };
    const end = (e) => {
      for (const tt of e.changedTouches) {
        if (tt.identifier === t.moveId) { t.moveId = null; t.mx = t.my = 0; knob.style.transform = 'translate(-50%,-50%)'; }
        if (tt.identifier === t.lookId) t.lookId = null;
      }
    };
    root.addEventListener('touchmove', move, { passive: true });
    root.addEventListener('touchend', end);
    root.addEventListener('touchcancel', end);
    root.querySelectorAll('[data-key]').forEach(btn => {
      const key = btn.dataset.key;
      const press = (e) => {
        e.preventDefault(); e.stopPropagation();
        btn.classList.add('down');
        const h = this.handlers;
        if (/^\d$/.test(key)) h.digit?.(+key);
        else if (key === 'back') h.backspace?.();
        else if (key === 'throw') h.primary?.();
        else if (key === 'cycle') h.cycle?.(1);
        else if (key === 'photo') h.photo?.();
        else if (key === 'pause') h.escape?.();
        else if (key === 'jump') t.jump = true;
        else if (key === 'crouch') t.crouch = !t.crouch;
        else if (key === 'zoom') t.zoom = !t.zoom;
        else if (key === 'score') h.score?.();
        else if (key === 'specPrev') h.arrow?.(-1);
        else if (key === 'specNext') h.arrow?.(1);
        else if (key === 'specView') h.view?.();
      };
      const release = (e) => { btn.classList.remove('down'); if (key === 'jump') t.jump = false; btn.classList.toggle('on', (key === 'crouch' && t.crouch) || (key === 'zoom' && t.zoom)); };
      btn.addEventListener('touchstart', press, { passive: false });
      btn.addEventListener('touchend', release);
      btn.addEventListener('mousedown', press);
      btn.addEventListener('mouseup', release);
    });
  }
}
