// Menu screens. Each screen is rendered from a template into #screens.
import * as THREE from 'three';
import { MODES, DIFFICULTY, SHIRT_COLORS, SKIN_TONES, HATS, HAT_LABEL, TEAM_NAME, MAX_PLAYERS, VERSION, GADGET_LABEL } from './config.js';
import { MAP_LIST } from './maps.js';
import { Avatar } from './avatar.js';
import { audio } from './audio.js';
import { esc } from './hud.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const MAP_COLORS = { plaza: 'linear-gradient(90deg,#8fd16a,#f6b8c8,#93ccff)', depot: 'linear-gradient(90deg,#b9b5ad,#4f6d9a,#ef8b5b)', neon: 'linear-gradient(90deg,#2b1d5c,#ff7ad9,#4ff0e8)' };

class Preview {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 300; this.canvas.height = 380;
    try {
      this.r = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
      this.r.outputColorSpace = THREE.SRGBColorSpace;
    } catch { this.r = null; }
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#9a7fb0', 2.2));
    const d = new THREE.DirectionalLight('#ffffff', 1.6); d.position.set(2, 3, -3); this.scene.add(d);
    this.cam = new THREE.PerspectiveCamera(30, 300 / 380, 0.1, 20);
    this.cam.position.set(0, 1.3, -4.6); this.cam.lookAt(0, 1.05, 0);
    this.avatar = null; this.t = 0;
  }
  set(p, num) {
    if (this.avatar) { this.scene.remove(this.avatar.root); this.avatar.dispose(); }
    this.avatar = new Avatar({ shirt: p.shirt, skin: p.skin, hat: p.hat, team: 0, name: p.name });
    this.avatar.setNumber(num);
    this.scene.add(this.avatar.root);
  }
  frame(dt) {
    if (!this.r || !this.avatar || !this.canvas.isConnected) return;
    this.t += dt;
    this.avatar.update(dt, { x: 0, y: 0, z: 0, yaw: Math.sin(this.t * 0.8) * 0.5, pitch: 0, crouch: 0, speed: 0, onGround: true, zoom: false, protect: 0 }, this.t);
    this.r.render(this.scene, this.cam);
  }
}

export class UI {
  constructor(app) {
    this.app = app;
    this.root = $('#screens');
    this.menu = $('#menu');
    this.preview = new Preview();
    this.cur = null;
    $('#ver').textContent = 'v' + VERSION;
    this.toastEl = $('#toast');
  }

  toast(msg, ms = 2600) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  showMenu(v) { this.menu.hidden = !v; }

  go(name, data) {
    this.cur = name;
    this.data = data;
    this.showMenu(true);
    this.root.innerHTML = this['s_' + name](data);
    this.root.scrollTop = 0;
    this['b_' + name]?.(data);
    $$('button', this.root).forEach(b => b.addEventListener('click', () => audio.ui()));
    const first = $('[autofocus]', this.root);
    if (first && !matchMedia('(pointer: coarse)').matches) first.focus();
  }

  head(title, back = 'home') {
    return `<div class="screen-head"><button class="back" data-back="${back}" aria-label="Back">←</button><h2>${title}</h2></div>`;
  }
  bindBack() { $$('[data-back]', this.root).forEach(b => b.addEventListener('click', () => this.app.menuBack(b.dataset.back))); }

  // ---------------------------------------------------------------- home
  s_home() {
    const P = this.app.profile;
    return `<section class="screen home">
      <div>
        <div class="logo"><h1>NUMB<br>SKULL</h1><span class="num">4821</span></div>
        <p class="tagline">Read their forehead. Type the number. They're out.</p>
        <div class="home-actions">
          <button class="btn big go" id="hPlay">Play vs bots</button>
          <div class="row"><button class="btn alt" id="hHost">Host a room</button><button class="btn alt" id="hJoin">Join a room</button></div>
          <div class="row"><button class="btn ghost" id="hHow" style="color:#fff">How to play</button><button class="btn ghost" id="hSet" style="color:#fff">Settings</button></div>
        </div>
      </div>
      <div style="display:grid;gap:26px">
        <div class="note" style="--tilt:1.2deg">
          <h2>Your character</h2>
          <div class="profile">
            <div id="pv"></div>
            <div>
              <div class="field"><label class="lbl" for="pName">Name</label><input id="pName" maxlength="16" value="${esc(P.name)}" autocomplete="off" spellcheck="false"></div>
              <div class="field"><span class="lbl">Shirt</span><div class="swatches" id="pShirt">${SHIRT_COLORS.map(c => `<button class="swatch" style="background:${c}" data-c="${c}" aria-label="Shirt colour ${c}" aria-pressed="${c === P.shirt}"></button>`).join('')}</div></div>
              <div class="field"><span class="lbl">Skin</span><div class="swatches" id="pSkin">${SKIN_TONES.map(c => `<button class="swatch" style="background:${c}" data-c="${c}" aria-label="Skin tone ${c}" aria-pressed="${c === P.skin}"></button>`).join('')}</div></div>
              <div class="field"><span class="lbl">Hat</span><div class="stepper"><button id="hatPrev" aria-label="Previous hat">‹</button><output id="hatName">${HAT_LABEL[P.hat]}</output><button id="hatNext" aria-label="Next hat">›</button></div></div>
            </div>
          </div>
        </div>
        <div class="note blue" style="--tilt:-1.4deg">
          <h3>How a round works</h3>
          <ol class="steps">
            <li>Everyone has a number stuck to their forehead. Yours is <span class="demo-note">${esc(this.app.previewNum)}</span></li>
            <li>Get a clear look at someone's face and type their number to take them out.</li>
            <li>They can only read yours when you face them. Turn away, duck behind cover, throw smoke.</li>
          </ol>
        </div>
      </div>
    </section>`;
  }
  b_home() {
    const P = this.app.profile;
    $('#pv').append(this.preview.canvas);
    this.preview.set(P, this.app.previewNum);
    const save = () => { this.app.saveProfile(); this.preview.set(P, this.app.previewNum); };
    $('#pName').addEventListener('input', (e) => { P.name = e.target.value.replace(/[<>]/g, '').slice(0, 16); this.app.saveProfile(); });
    $$('#pShirt .swatch').forEach(b => b.addEventListener('click', () => { P.shirt = b.dataset.c; $$('#pShirt .swatch').forEach(x => x.setAttribute('aria-pressed', x === b)); save(); }));
    $$('#pSkin .swatch').forEach(b => b.addEventListener('click', () => { P.skin = b.dataset.c; $$('#pSkin .swatch').forEach(x => x.setAttribute('aria-pressed', x === b)); save(); }));
    const hat = (d) => { const i = (HATS.indexOf(P.hat) + d + HATS.length) % HATS.length; P.hat = HATS[i]; $('#hatName').textContent = HAT_LABEL[P.hat]; save(); };
    $('#hatPrev').addEventListener('click', () => hat(-1));
    $('#hatNext').addEventListener('click', () => hat(1));
    $('#hPlay').addEventListener('click', () => this.go('setup', { kind: 'solo' }));
    $('#hHost').addEventListener('click', () => this.go('setup', { kind: 'host' }));
    $('#hJoin').addEventListener('click', () => this.go('join'));
    $('#hHow').addEventListener('click', () => this.go('howto', { back: 'home' }));
    $('#hSet').addEventListener('click', () => this.go('settings', { back: 'home' }));
  }

  // ---------------------------------------------------------------- match setup (solo + host)
  s_setup({ kind }) {
    const M = this.app.match;
    const isHost = kind !== 'solo';
    const modeCards = Object.values(MODES).map(m => `<button class="card" data-mode="${m.id}" aria-pressed="${m.id === M.mode}"><b>${m.name}</b><span>${m.blurb}</span></button>`).join('');
    const mapCards = MAP_LIST.map(m => `<button class="card" data-map="${m.id}" aria-pressed="${m.id === M.mapId}"><div class="swatchmap" style="background:${MAP_COLORS[m.id]}"></div><b>${m.name}</b><span>${m.blurb}</span></button>`).join('');
    const seg = (key, opts, label) => `<div class="field"><span class="lbl">${label}</span><div class="seg" data-seg="${key}">${opts.map(([v, t]) => `<button data-v="${v}" aria-pressed="${String(M[key]) === String(v)}">${t}</button>`).join('')}</div></div>`;
    return `<section class="screen setup">
      ${this.head(kind === 'hostEdit' ? 'Room settings' : isHost ? 'Host a room' : 'Play vs bots', kind === 'hostEdit' ? 'lobby' : 'home')}
      <div class="note" style="--tilt:-.6deg">
        <div class="field"><span class="lbl">Mode</span><div class="cards">${modeCards}</div></div>
        <div class="field" style="margin-top:8px"><span class="lbl">Map</span><div class="cards">${mapCards}</div></div>
      </div>
      <div class="note mint" style="--tilt:.8deg">
        <div class="rowfields">
          <div class="field"><span class="lbl">Bots</span><div class="stepper"><button data-step="bots" data-d="-1" aria-label="Fewer bots">−</button><output id="o_bots">${M.bots}</output><button data-step="bots" data-d="1" aria-label="More bots">+</button></div></div>
          <div class="field"><span class="lbl" id="slLbl">${M.mode === 'ctf' ? 'Captures to win' : 'Reads to win'}</span><div class="stepper"><button data-step="scoreLimit" data-d="-1" aria-label="Lower">−</button><output id="o_scoreLimit">${M.scoreLimit}</output><button data-step="scoreLimit" data-d="1" aria-label="Higher">+</button></div></div>
        </div>
        ${seg('difficulty', Object.entries(DIFFICULTY).map(([k, d]) => [k, d.name]), 'Bot skill')}
        ${seg('digits', [[3, '3 digits'], [4, '4 digits'], [5, '5 digits']], 'Forehead numbers')}
        ${seg('timeLimit', [[180, '3 min'], [300, '5 min'], [480, '8 min'], [720, '12 min']], 'Time limit')}
        <div class="startrow">
          <button class="btn big go" id="sStart">${kind === 'hostEdit' ? 'Save settings' : isHost ? 'Open room' : 'Start match'}</button>
          <span id="sNote" style="font-weight:700;font-size:.9rem"></span>
        </div>
      </div>
    </section>`;
  }
  b_setup({ kind }) {
    const M = this.app.match;
    this.bindBack();
    const limits = { bots: [0, MAX_PLAYERS - 1], scoreLimit: [1, 100] };
    const note = () => {
      const n = $('#sNote');
      if (kind !== 'solo') n.textContent = `Up to ${MAX_PLAYERS} players in a room, bots included.`;
      else n.textContent = M.bots === 0 ? 'No bots? You will be lonely.' : `${M.bots + 1} players`;
    };
    $$('[data-mode]', this.root).forEach(b => b.addEventListener('click', () => {
      M.mode = b.dataset.mode;
      M.scoreLimit = MODES[M.mode].scoreLimit;
      $$('[data-mode]', this.root).forEach(x => x.setAttribute('aria-pressed', x === b));
      $('#o_scoreLimit').textContent = M.scoreLimit;
      $('#slLbl').textContent = M.mode === 'ctf' ? 'Captures to win' : M.mode === 'tdm' ? 'Team reads to win' : 'Reads to win';
      this.app.saveMatch();
    }));
    $$('[data-map]', this.root).forEach(b => b.addEventListener('click', () => {
      M.mapId = b.dataset.map;
      $$('[data-map]', this.root).forEach(x => x.setAttribute('aria-pressed', x === b));
      this.app.saveMatch();
    }));
    $$('[data-seg]', this.root).forEach(seg => {
      const key = seg.dataset.seg;
      $$('button', seg).forEach(b => b.addEventListener('click', () => {
        const v = b.dataset.v;
        M[key] = /^\d+$/.test(v) ? +v : v;
        $$('button', seg).forEach(x => x.setAttribute('aria-pressed', x === b));
        this.app.saveMatch();
      }));
    });
    $$('[data-step]', this.root).forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.step, d = +b.dataset.d;
      const step = k === 'scoreLimit' && M.scoreLimit >= 10 ? 5 : 1;
      M[k] = Math.max(limits[k][0], Math.min(limits[k][1], M[k] + d * step));
      $('#o_' + k).textContent = M[k];
      note(); this.app.saveMatch();
    }));
    note();
    $('#sStart').addEventListener('click', () => kind === 'host' ? this.app.hostRoom() : kind === 'hostEdit' ? this.app.session.settingsChanged() : this.app.startSolo());
  }

  // ---------------------------------------------------------------- join
  s_join() {
    return `<section class="screen" style="max-width:560px">
      ${this.head('Join a room')}
      <div class="note" style="--tilt:-1deg">
        <p>Ask your host for the 4-letter room code.</p>
        <form id="jForm" class="field">
          <label class="lbl" for="jCode">Room code</label>
          <input id="jCode" class="codein" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" style="font-family:var(--f-display);font-size:2rem;letter-spacing:.2em;text-transform:uppercase" autofocus>
          <div class="startrow"><button class="btn big go" type="submit" id="jGo">Join</button><span id="jMsg" style="font-weight:700"></span></div>
        </form>
        <p style="font-size:.88rem;margin-top:8px">Online rooms connect browsers directly to each other. Most home networks work. Some strict office or school networks block it.</p>
      </div>
    </section>`;
  }
  b_join() {
    this.bindBack();
    const inp = $('#jCode');
    inp.addEventListener('input', () => { inp.value = inp.value.toUpperCase().replace(/[^A-Z]/g, ''); });
    $('#jForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (inp.value.length !== 4) { $('#jMsg').textContent = 'Codes are 4 letters.'; return; }
      $('#jMsg').textContent = 'Connecting…';
      $('#jGo').disabled = true;
      this.app.joinRoom(inp.value);
    });
  }
  joinError(msg) { if (this.cur === 'join') { $('#jMsg').textContent = msg; $('#jGo').disabled = false; } else { this.go('join'); setTimeout(() => this.joinError(msg), 0); } }

  // ---------------------------------------------------------------- lobby
  s_lobby(d) {
    const isHost = d.host;
    const M = d.settings || this.app.match;
    const players = d.players || [];
    const teams = MODES[M.mode].teams;
    const list = players.map(p => `<li><span class="dot" style="background:${p.shirt}"></span><span class="nm">${esc(p.name)}</span>${p.id === d.you ? '<span class="tag">You</span>' : ''}${p.host ? '<span class="tag">Host</span>' : ''}</li>`).join('');
    return `<section class="screen setup">
      ${this.head(isHost ? 'Your room' : 'Room ' + esc(d.code), isHost ? 'closeRoom' : 'leaveRoom')}
      <div class="note" style="--tilt:-1deg">
        <span class="lbl">Room code</span>
        <div class="roomcode" id="lCode">${esc(d.code || '····')}</div>
        <div class="startrow"><button class="btn alt" id="lCopy">Copy code</button></div>
        <p style="margin-top:12px">Friends pick <b>Join a room</b> and type this code. They can also join while a match is running.</p>
        <p style="font-size:.9rem"><b>${MODES[M.mode].name}</b> on <b>${esc(MAP_LIST.find(m => m.id === M.mapId)?.name || '')}</b> · ${M.digits}-digit numbers · ${DIFFICULTY[M.difficulty]?.name || ''} bots${teams ? ' · teams are balanced at the start' : ''}</p>
      </div>
      <div class="note mint" style="--tilt:.8deg">
        <h2>Players <small style="font-family:var(--f-body);font-size:.9rem">${players.length}/${MAX_PLAYERS}</small></h2>
        <ul class="plist">${list}</ul>
        ${isHost ? `<div class="field" style="margin-top:14px"><span class="lbl">Bots</span><div class="stepper"><button id="lbMinus" aria-label="Fewer bots">−</button><output id="lbN">${M.bots}</output><button id="lbPlus" aria-label="More bots">+</button></div></div>
        <div class="startrow"><button class="btn big go" id="lStart">Start match</button><button class="btn ghost" id="lSettings">Change settings</button></div>`
        : `<p style="margin-top:14px;font-weight:700">Waiting for the host to start…</p>`}
      </div>
    </section>`;
  }
  b_lobby(d) {
    this.bindBack();
    $('#lCopy').addEventListener('click', () => {
      const code = d.code;
      const done = () => this.toast('Room code copied');
      try { navigator.clipboard.writeText(code).then(done, () => this.selectCode()); } catch { this.selectCode(); }
    });
    if (d.host) {
      const M = this.app.match;
      const set = (n) => { M.bots = Math.max(0, Math.min(MAX_PLAYERS - 1, n)); $('#lbN').textContent = M.bots; this.app.saveMatch(); };
      $('#lbMinus').addEventListener('click', () => set(M.bots - 1));
      $('#lbPlus').addEventListener('click', () => set(M.bots + 1));
      $('#lStart').addEventListener('click', () => this.app.session.startMatch());
      $('#lSettings').addEventListener('click', () => this.go('setup', { kind: 'hostEdit' }));
    }
  }
  selectCode() {
    const el = $('#lCode'); if (!el) return;
    const r = document.createRange(); r.selectNodeContents(el);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    this.toast('Select and copy the code');
  }

  // ---------------------------------------------------------------- how to play
  s_howto(d) {
    return `<section class="screen howgrid">
      ${this.head('How to play', d?.back || 'home')}
      <div class="note" style="--tilt:-1deg">
        <h2>The rules</h2>
        <ol class="steps">
          <li>Everybody has a number on their forehead. A new one every life.</li>
          <li>Look someone in the face, read their number and type it on the number keys.</li>
          <li>If they're in your view when you hit the last digit, they're out. No shooting needed.</li>
          <li>Typing a wrong number jams you for a moment. Typing a teammate's number does nothing.</li>
          <li>Numbers get blurry with distance. Binoculars let you read and take out people far away.</li>
          <li>Others can only read you when you face them. Your number is shown bottom-left.</li>
        </ol>
      </div>
      <div class="note white" style="--tilt:.8deg">
        <h2>Controls</h2>
        <div class="keys">
          <kbd>0–9</kbd><span>Type a number (number row or numpad)</span>
          <kbd>Backspace</kbd><span>Delete a digit</span>
          <kbd>WASD</kbd><span>Move</span>
          <kbd>Mouse</kbd><span>Look</span>
          <kbd>Right mouse</kbd><span>Binoculars (or hold X)</span>
          <kbd>Left mouse</kbd><span>Throw the selected gadget (or G)</span>
          <kbd>Q / E / wheel</kbd><span>Switch gadget</span>
          <kbd>F</kbd><span>Snap a photo you can read for a few seconds</span>
          <kbd>Shift</kbd><span>Sprint</span>
          <kbd>C</kbd><span>Duck (hides you behind low walls)</span>
          <kbd>Space</kbd><span>Jump</span>
          <kbd>Tab</kbd><span>Scores</span>
          <kbd>T / Enter</kbd><span>Chat (online)</span>
          <kbd>Esc</kbd><span>Pause</span>
        </div>
        <p style="margin-top:10px;font-size:.9rem">On a phone or tablet you get a joystick, a look pad and an on-screen keypad.</p>
      </div>
      <div class="note pink" style="--tilt:-.6deg">
        <h2>Gadgets</h2>
        <p><b>${GADGET_LABEL.flash}.</b> Whites out everyone looking at it. Blinded players can't read or type anyone out. Look away when you throw it.</p>
        <p><b>${GADGET_LABEL.smoke}.</b> A thick cloud nobody can read through. Great for crossing open ground.</p>
        <p><b>${GADGET_LABEL.distract}.</b> Beeps and projects a fake number. Bots turn to stare at it, and typing the fake number jams you.</p>
        <p><b>Camera.</b> Freezes your view in a photo for a few seconds so you can read numbers at your own pace. They still need to be in sight when you finish typing.</p>
        <p>Grab mint-green crates around the map to refill gadgets.</p>
      </div>
      <div class="note mint" style="--tilt:1deg">
        <h2>Modes</h2>
        ${Object.values(MODES).map(m => `<p><b>${m.name}.</b> ${m.blurb}</p>`).join('')}
        <p style="font-size:.9rem">You can't be read for two seconds after you spawn (the shimmering bubble).</p>
      </div>
    </section>`;
  }
  b_howto() { this.bindBack(); }

  // ---------------------------------------------------------------- settings
  s_settings(d) {
    const S = this.app.settings;
    const rng = (id, label, min, max, step, v, fmt) => `<div class="field"><label class="lbl" for="${id}">${label} <output id="${id}O">${fmt(v)}</output></label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}"></div>`;
    return `<section class="screen" style="max-width:640px">
      ${this.head('Settings', d?.back || 'home')}
      <div class="note white" style="--tilt:-.5deg">
        ${rng('stSens', 'Mouse sensitivity', 0.2, 3, 0.05, S.sens, v => (+v).toFixed(2))}
        ${rng('stFov', 'Field of view', 60, 100, 1, S.fov, v => v + '°')}
        ${rng('stVol', 'Volume', 0, 1, 0.05, S.volume, v => Math.round(v * 100) + '%')}
        <div class="field"><label class="lbl" for="stQ">Graphics</label>
          <select id="stQ"><option value="2" ${S.quality == 2 ? 'selected' : ''}>High (sharp shadows)</option><option value="1" ${S.quality == 1 ? 'selected' : ''}>Medium</option><option value="0" ${S.quality == 0 ? 'selected' : ''}>Low (no shadows, fastest)</option></select></div>
        ${rng('stScale', 'Resolution', 0.5, 1, 0.05, S.scale, v => Math.round(v * 100) + '%')}
        <label class="check"><input type="checkbox" id="stInv" ${S.invertY ? 'checked' : ''}> Invert mouse Y</label>
        <label class="check"><input type="checkbox" id="stWatch" ${S.watchWarn ? 'checked' : ''}> Warn me when someone is reading my number</label>
        <label class="check"><input type="checkbox" id="stAnn" ${S.announcer ? 'checked' : ''}> Announcer voice for streaks</label>
        <label class="check"><input type="checkbox" id="stFps" ${S.showFps ? 'checked' : ''}> Show frame rate</label>
        <div class="field"><label class="lbl" for="stTouch">Touch controls</label>
          <select id="stTouch"><option value="auto" ${S.touch === 'auto' ? 'selected' : ''}>Automatic</option><option value="on" ${S.touch === 'on' ? 'selected' : ''}>Always on</option><option value="off" ${S.touch === 'off' ? 'selected' : ''}>Off</option></select></div>
        <p style="font-size:.88rem;margin-top:6px">Graphics changes apply from the next match.</p>
      </div>
    </section>`;
  }
  b_settings() {
    this.bindBack();
    const S = this.app.settings;
    const bindR = (id, key, fmt) => { const el = $('#' + id); el.addEventListener('input', () => { S[key] = +el.value; $('#' + id + 'O').textContent = fmt(+el.value); this.app.applySettings(); }); };
    bindR('stSens', 'sens', v => v.toFixed(2));
    bindR('stFov', 'fov', v => v + '°');
    bindR('stVol', 'volume', v => Math.round(v * 100) + '%');
    bindR('stScale', 'scale', v => Math.round(v * 100) + '%');
    $('#stQ').addEventListener('change', (e) => { S.quality = +e.target.value; this.app.applySettings(); });
    $('#stTouch').addEventListener('change', (e) => { S.touch = e.target.value; this.app.applySettings(); });
    for (const [id, key] of [['stInv', 'invertY'], ['stWatch', 'watchWarn'], ['stAnn', 'announcer'], ['stFps', 'showFps']]) $('#' + id).addEventListener('change', (e) => { S[key] = e.target.checked; this.app.applySettings(); });
  }

  // ---------------------------------------------------------------- pause
  s_pause(d) {
    return `<section class="screen" style="max-width:460px;min-height:100%;align-content:center">
      <div class="note" style="--tilt:-1.2deg;text-align:center">
        <h2>Paused</h2>
        ${d.code ? `<p>Room code <b style="font-family:var(--f-display);font-size:1.4rem;letter-spacing:.1em">${esc(d.code)}</b></p>` : ''}
        ${d.online ? '<p style="font-size:.9rem">The match keeps going while you are in this menu.</p>' : ''}
        <div style="display:grid;gap:10px;margin-top:8px">
          <button class="btn big go" id="pResume">Resume</button>
          <button class="btn alt" id="pSettings">Settings</button>
          <button class="btn alt" id="pHow">How to play</button>
          <button class="btn ghost" id="pLeave">${d.host ? 'End match and close room' : 'Leave match'}</button>
        </div>
      </div>
    </section>`;
  }
  b_pause() {
    $('#pResume').addEventListener('click', () => this.app.resume());
    $('#pSettings').addEventListener('click', () => this.go('settings', { back: 'pause' }));
    $('#pHow').addEventListener('click', () => this.go('howto', { back: 'pause' }));
    $('#pLeave').addEventListener('click', () => this.app.leaveMatch());
  }

  // ---------------------------------------------------------------- end
  s_end(d) {
    const R = d.results, me = d.you;
    let title, sub;
    if (R.teams) {
      title = R.winner ? `${TEAM_NAME[R.winner]} team wins` : 'Draw';
      const mine = R.players.find(p => p.id === me);
      sub = mine && R.winner ? (mine.team === R.winner ? 'Nice reading.' : 'They had your number.') : `${R.teamScore[1]} – ${R.teamScore[2]}`;
      sub += ` · Red ${R.teamScore[1]}, Blue ${R.teamScore[2]}`;
    } else {
      const w = R.players.find(p => p.id === R.winner);
      title = w ? (w.id === me ? 'You win' : `${esc(w.name)} wins`) : 'Draw';
      sub = w && w.id === me ? 'Human calculator.' : 'Better luck next time.';
    }
    const sorted = [...R.players].sort((a, b) => (b.kills - a.kills) || (a.deaths - b.deaths));
    const row = (p) => `<tr class="${p.id === me ? 'me' : ''}"><td>${R.teams ? `<span class="tag ${p.team === 1 ? 'red' : 'blue'}">${TEAM_NAME[p.team]}</span> ` : ''}${esc(p.name)}${p.isBot ? ' <small style="opacity:.6">bot</small>' : ''}</td><td class="n">${p.kills}</td><td class="n">${p.deaths}</td>${d.ctf ? `<td class="n">${p.caps}</td>` : ''}<td class="n">${p.misses}</td><td class="n">${p.best}</td><td class="n">${p.fastest ? (p.fastest / 1000).toFixed(2) + 's' : '–'}</td></tr>`;
    return `<section class="screen" style="max-width:860px">
      <div class="end-banner"><h2>${title}</h2><p>${esc(sub)}</p></div>
      <div class="note white" style="--tilt:-.4deg">
        <div class="tablewrap"><table class="res"><tr><th>Player</th><th class="n">Reads</th><th class="n">Deaths</th>${d.ctf ? '<th class="n">Caps</th>' : ''}<th class="n">Misses</th><th class="n">Best streak</th><th class="n">Fastest read</th></tr>${sorted.map(row).join('')}</table></div>
        <div class="startrow" style="margin-top:14px">
          ${d.canRestart ? '<button class="btn big go" id="eAgain">Play again</button>' : '<span style="font-weight:700">Waiting for the host…</span>'}
          ${d.host ? '<button class="btn alt" id="eLobby">Back to room</button>' : ''}
          <button class="btn ghost" id="eMenu">${d.online ? 'Leave' : 'Main menu'}</button>
        </div>
      </div>
    </section>`;
  }
  b_end(d) {
    $('#eAgain')?.addEventListener('click', () => this.app.playAgain());
    $('#eLobby')?.addEventListener('click', () => this.app.session.backToLobby());
    $('#eMenu').addEventListener('click', () => this.app.leaveMatch());
  }

  // ---------------------------------------------------------------- misc
  s_message(d) {
    return `<section class="screen" style="max-width:520px;min-height:100%;align-content:center">
      <div class="note pink" style="--tilt:-1deg"><h2>${esc(d.title)}</h2><p>${esc(d.text)}</p>
      <div class="startrow">${d.busy ? '' : '<button class="btn" id="mOk">OK</button>'}</div></div></section>`;
  }
  b_message(d) { $('#mOk')?.addEventListener('click', () => (d.onOk ? d.onOk() : this.go('home'))); }

  frame(dt) { if (this.cur === 'home' && !this.menu.hidden) this.preview.frame(dt); }
}
