// Numbskull: app entry. Wires menus, input, the match simulation, rendering and sound.
import { CFG, GADGETS, GADGET_LABEL, STREAKS, TEAM_NAME, TEAM_COLOR, SHIRT_COLORS, SKIN_TONES, HATS, MODES } from './config.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { Hud, esc } from './hud.js';
import { UI } from './ui.js';
import { audio } from './audio.js';
import { Game } from './game.js';
import { HostSession, ClientSession } from './session.js';
import { MAP_LIST } from './maps.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const store = {
  get(k, d) { try { const v = localStorage.getItem('numbskull.' + k); return v ? { ...d, ...JSON.parse(v) } : { ...d }; } catch { return { ...d }; } },
  set(k, v) { try { localStorage.setItem('numbskull.' + k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};
const MISS_TEXT = {
  nobody: "Nobody has that number", sight: "They're not in sight", self: "That's your own number", team: "That's a teammate",
  protected: "They just spawned, give it a sec", decoy: "That was a decoy", wait: 'Not yet!',
};

class SoloSession {
  constructor(app) { this.app = app; this.type = 'solo'; }
  requestKill(code, ms) { this.app.game.tryKill(this.app.game.localId, code, ms); }
  requestThrow(type) { this.app.game.throwGadget(this.app.game.localId, type); }
  requestPhoto() { return this.app.game.takePhoto(this.app.game.localId); }
  tick() { this.app.game.outEvents.length = 0; }
  sendChat() {}
  close() {}
}

class App {
  constructor() {
    this.profile = store.get('profile', { name: 'Reader ' + (100 + Math.floor(Math.random() * 900)), shirt: pick(SHIRT_COLORS), skin: pick(SKIN_TONES), hat: pick(HATS) });
    const coarse = matchMedia('(pointer: coarse)').matches;
    this.settings = store.get('settings', { sens: 1, fov: CFG.fov, volume: 0.7, quality: coarse ? 1 : 2, scale: coarse ? 0.85 : 1, invertY: false, watchWarn: true, announcer: true, showFps: false, touch: 'auto' });
    this.match = store.get('match', { mode: 'dm', mapId: 'plaza', bots: 7, difficulty: 'normal', digits: 4, scoreLimit: 20, timeLimit: 300 });
    if (!MODES[this.match.mode]) this.match.mode = 'dm';
    if (!MAP_LIST.some(m => m.id === this.match.mapId)) this.match.mapId = 'plaza';
    this.previewNum = String(1000 + Math.floor(Math.random() * 9000));
    this.canvas = document.getElementById('gl');
    this.renderer = new Renderer(this.canvas);
    this.input = new Input(this.canvas);
    this.hud = new Hud();
    this.ui = new UI(this);
    this.view = { mode: 'attract', gadget: 'flash' };
    this.state = 'menu';
    this.session = null;
    this.game = null;
    this.buffer = '';
    this.pending = false;
    this.chatOpen = false;
    this.time = 0;
    this.watchT = 0; this.watched = false;
    this.lastCount = 0;
    this.fpsAcc = 0; this.fpsN = 0;
    this.bindInput();
    this.applySettings();
    this.startAttract();
    this.ui.go('home');
    if (document.fonts) {
      document.fonts.load('100px "Permanent Marker"').then(() => { this.renderer.redrawNotes(); if (this.ui.cur === 'home') this.ui.preview.set(this.profile, this.previewNum); }).catch(() => {});
    }
    // audio needs a user gesture
    const unlock = () => { audio.init(); removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); };
    addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);
    document.getElementById('ctpBtn').addEventListener('click', () => { audio.init(); this.input.lock(true); });
    document.getElementById('chatform').addEventListener('submit', (e) => { e.preventDefault(); this.sendChat(); });
    document.getElementById('chatin').addEventListener('keydown', (e) => { if (e.key === 'Escape') this.closeChat(); e.stopPropagation(); });
    this.input.bindTouch(document.getElementById('touch'));
    addEventListener('pagehide', () => { try { this.session?.close(); } catch { /* closing anyway */ } });
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  saveProfile() { store.set('profile', this.profile); this.renderer.setViewmodelColors(this.profile.shirt, this.profile.skin); }
  saveMatch() { store.set('match', this.match); }
  applySettings() {
    const S = this.settings;
    store.set('settings', S);
    audio.setVolume(S.volume);
    audio.announcer = S.announcer;
    this.input.sens = S.sens; this.input.invertY = S.invertY;
    this.renderer.fovBase = S.fov;
    if (this.renderer.scale !== S.scale) this.renderer.setQuality(this.renderer.quality, S.scale);
    this.touchMode = S.touch === 'on' || (S.touch === 'auto' && this.input.isTouch);
    document.body.classList.toggle('touch', this.touchMode && this.state !== 'menu');
    document.body.classList.toggle('playing', this.state === 'play');
    document.getElementById('touch').hidden = !(this.touchMode && this.game && this.state === 'play');
    document.getElementById('fps').hidden = !S.showFps;
  }

  // ---------------------------------------------------------------- flow
  startAttract() {
    this.game = null;
    const mapId = pick(['plaza', 'depot', 'neon']);
    const g = new Game({ mapId, mode: Math.random() < 0.5 ? 'dm' : 'tdm', attract: true, difficulty: 'hard', digits: 4, timeLimit: 99999 });
    g.addBots(10);
    g.balanceTeams();
    g.phase = 'play';
    this.attract = g;
    this.renderer.setQuality(Math.min(this.settings.quality, 1), this.settings.scale);
    this.renderer.load(g);
    this.view.mode = 'attract';
    this.state = 'menu';
  }

  startSolo() {
    const M = this.match;
    const g = new Game({ mapId: M.mapId, mode: M.mode, digits: M.digits, scoreLimit: M.scoreLimit, timeLimit: M.timeLimit, difficulty: M.difficulty, authority: true });
    const me = g.addPlayer({ ...this.profile, name: (this.profile.name || 'You').slice(0, 16) });
    g.localId = me.id;
    g.addBots(M.bots);
    g.balanceTeams();
    this.session = new SoloSession(this);
    this.beginMatch(g);
  }

  hostRoom() {
    this.session?.close();
    this.session = new HostSession(this);
    this.session.open();
  }

  joinRoom(code) {
    this.session?.close();
    this.session = new ClientSession(this);
    this.session.join(code);
  }

  beginMatch(game) {
    audio.init();
    this.attract = null;
    this.game = game;
    game.on((ev) => this.onEvent(ev));
    this.renderer.setQuality(this.settings.quality, this.settings.scale);
    this.renderer.load(game);
    const me = game.local;
    this.renderer.setViewmodelColors(me && game.teams ? TEAM_COLOR[me.team] : this.profile.shirt, this.profile.skin);
    this.hud.setup(game);
    this.hud.show(true);
    this.ui.showMenu(false);
    this.state = 'play';
    this.buffer = ''; this.pending = false;
    this.view.gadget = 'flash';
    this.view.mode = 'wait';
    this.lastCount = 0;
    this.endShown = false;
    this.input.enabled = true;
    this.input.zoomToggle = false;
    this.applySettings();
    if (!this.touchMode) this.input.lock(false);
    if (game.teams && me) setTimeout(() => this.hud.center(`You're on ${TEAM_NAME[me.team]}`, '', 2.5), 300);
  }

  endMatchView() {
    this.input.enabled = false;
    this.input.unlock();
    this.hud.show(false);
    document.getElementById('touch').hidden = true;
    document.body.classList.remove('touch', 'playing');
    this.startAttract();
  }

  abandonMatch() {
    this.endMatchView();
  }

  leaveMatch() {
    this.session?.close();
    this.session = null;
    this.endMatchView();
    this.ui.go('home');
  }

  playAgain() {
    if (this.session?.type === 'host') this.session.restart();
    else this.startSolo();
  }

  pause() {
    if (this.state !== 'play') return;
    this.state = 'paused';
    document.body.classList.remove('playing');
    this.input.unlock();
    document.getElementById('touch').hidden = true;
    this.ui.go('pause', { code: this.session?.code, online: this.session?.type !== 'solo', host: this.session?.type === 'host' });
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'play';
    this.ui.showMenu(false);
    this.applySettings();
    if (!this.touchMode) this.input.lock();
  }

  menuBack(target) {
    if (target === 'pause') return this.ui.go('pause', { code: this.session?.code, online: this.session?.type !== 'solo', host: this.session?.type === 'host' });
    if (target === 'lobby') return this.session?.showLobby ? this.session.showLobby() : this.ui.go('home');
    if (target === 'closeRoom' || target === 'leaveRoom') { this.session?.close(); this.session = null; return this.ui.go('home'); }
    this.ui.go('home');
  }

  // ---------------------------------------------------------------- input
  canAct() {
    return this.state === 'play' && this.game && this.game.local && !this.chatOpen && (this.touchMode || this.input.locked || this.input.lockFailed);
  }

  bindInput() {
    const h = this.input.handlers;
    h.digit = (d) => {
      if (!this.canAct()) return;
      const p = this.game.local;
      if (!p.alive || this.game.phase === 'end') return;
      if (this.game.phase === 'countdown') { this.hud.center('Wait for GO', '', 0.7); return; }
      if (p.jam > 0) { audio.jam(); this.hud.center('Jammed!', 'bad', 0.6); return; }
      if (this.pending) return;
      if (!this.buffer.length) this.typeStart = performance.now();
      this.buffer += d;
      audio.key(d);
      this.hud.setBuffer(this.buffer);
      if (this.buffer.length >= this.game.digits) this.submit();
    };
    h.backspace = () => {
      if (!this.canAct() || this.pending) return;
      if (!this.buffer.length) return;
      this.buffer = this.buffer.slice(0, -1);
      audio.backspace();
      this.hud.setBuffer(this.buffer);
    };
    h.primary = () => {
      if (!this.canAct()) return;
      const p = this.game.local;
      if (!p.alive || this.game.phase === 'end') return;
      const g = this.view.gadget;
      if (p.inv[g] <= 0) {
        const next = GADGETS.find(x => p.inv[x] > 0);
        if (next) { this.view.gadget = next; this.hud.center(`Switched to ${GADGET_LABEL[next]}`, '', 0.9); }
        else this.hud.center('Out of gadgets. Find a green crate.', 'bad', 1.2);
        return;
      }
      if (this.game.time - (p.lastThrow || -9) < 0.6) return;
      this.session.requestThrow(g);
    };
    h.cycle = (dir) => {
      if (!this.canAct()) return;
      const i = GADGETS.indexOf(this.view.gadget);
      this.view.gadget = GADGETS[(i + (dir > 0 ? 1 : -1) + GADGETS.length) % GADGETS.length];
      audio.ui();
    };
    h.photo = () => {
      if (!this.canAct()) return;
      const p = this.game.local;
      if (!p.alive) return;
      if (p.camCd > 0) { this.hud.center(`Camera ready in ${Math.ceil(p.camCd)}s`, '', 0.8); return; }
      if (this.session.requestPhoto()) { this.photoPending = true; this.renderer.vmPhoto = 0.45; audio.shutter(); }
    };
    h.escape = () => {
      if (this.chatOpen) return this.closeChat();
      if (this.state === 'play') this.pause();
      else if (this.state === 'paused' && this.ui.cur === 'pause') this.resume();
    };
    h.chat = () => {
      if (this.state !== 'play' || !this.session || this.session.type === 'solo' || this.chatOpen) return;
      this.chatOpen = true;
      const f = document.getElementById('chatform');
      f.hidden = false;
      this.input.unlock();
      setTimeout(() => document.getElementById('chatin').focus(), 0);
    };
    h.mute = () => { this.settings.volume = this.settings.volume > 0 ? 0 : 0.7; this.applySettings(); this.hud.center(this.settings.volume ? 'Sound on' : 'Sound off', '', 0.8); };
    h.toggleZoom = () => { this.input.zoomToggle = !this.input.zoomToggle; };
    h.score = () => { this.touchScore = !this.touchScore; };
    h.lockChange = (locked, failed) => {
      if (failed) {
        if (this.state === 'play') this.ui.toast("Mouse capture isn't available here. Drag to look, G to throw.", 4500);
        return;
      }
      if (!locked && this.state === 'play' && !this.touchMode && !this.chatOpen && this.game && this.game.phase !== 'end') this.pause();
    };
  }

  submit() {
    const code = this.buffer;
    const ms = performance.now() - this.typeStart;
    this.pending = true;
    clearTimeout(this.pendingT);
    this.pendingT = setTimeout(() => { this.pending = false; this.buffer = ''; this.hud.setBuffer(''); }, 1500);
    this.session.requestKill(code, ms);
  }

  sendChat() {
    const inp = document.getElementById('chatin');
    const text = inp.value.trim();
    inp.value = '';
    if (text) this.session.sendChat(text);
    this.closeChat();
  }
  closeChat() {
    this.chatOpen = false;
    document.getElementById('chatform').hidden = true;
    document.getElementById('chatin').blur();
    if (this.state === 'play' && !this.touchMode) this.input.lock();
  }

  // ---------------------------------------------------------------- game events
  onEvent(ev) {
    const g = this.game;
    if (!g) return;
    const me = g.localId;
    const P = (id) => g.players.get(id);
    switch (ev.k) {
      case 'spawn':
        if (ev.id === me) { audio.spawn(); this.buffer = ''; this.pending = false; this.hud.setBuffer(''); this.view.mode = 'fp'; }
        break;
      case 'kill': {
        const a = P(ev.a), v = P(ev.v);
        const r = this.renderer;
        if (v) {
          const [hx, hy, hz] = g.forehead(v);
          r.effects?.poof(hx, hy, hz, v.team ? TEAM_COLOR[v.team] : v.shirt);
          if (ev.v !== me) audio.killAt([hx, hy, hz]);
        }
        this.hud.killFeed(a, v, ev.code, ev.a === me || ev.v === me);
        if (ev.a === me) {
          clearTimeout(this.pendingT); this.pending = false;
          this.hud.setBuffer(this.buffer, 'hit');
          this.hud.flashResult('hit', `Read ${v ? v.name : ''}!${ev.dist > 40 ? ` ${ev.dist} m away` : ''}`);
          this.buffer = '';
          audio.kill();
          const s = a.streak;
          if (STREAKS[s]) { this.hud.big(STREAKS[s]); audio.say(STREAKS[s]); }
        }
        if (ev.v === me) {
          this.buffer = ''; this.pending = false; this.hud.setBuffer('');
          this.input.zoomToggle = false;
          this.view.mode = 'death';
          audio.died();
        }
        break;
      }
      case 'miss':
        if (ev.id === me) {
          clearTimeout(this.pendingT); this.pending = false;
          this.hud.flashResult('miss', MISS_TEXT[ev.reason] || 'Miss');
          this.buffer = '';
          if (ev.reason === 'sight') audio.notInSight(); else audio.miss();
        }
        break;
      case 'gren': {
        if (ev.owner === me) { this.renderer.vmThrow = 0.4; audio.throwWhoosh(); }
        else this.renderer.avatars.get(ev.owner)?.playThrow();
        break;
      }
      case 'det': {
        const pos = [ev.x, ev.y, ev.z];
        if (ev.type === 'flash') {
          this.renderer.effects?.flashBurst(ev.x, ev.y + 0.2, ev.z);
          audio.flashBang(pos);
          const l = g.local;
          if (l && l.alive && l.lastFlash > 0.12) { audio.tinnitus(l.lastFlash); l.lastFlash = 0; }
        } else if (ev.type === 'smoke') audio.smokePop(pos);
        break;
      }
      case 'photo':
        if (ev.id !== me) { const p = P(ev.id); if (p) audio.shutterAt([p.x, p.y + 1.6, p.z]); }
        break;
      case 'pick': {
        const pk = g.pickups[ev.i];
        if (pk) this.renderer.effects?.pickupFx(pk.x, pk.y, pk.z);
        if (ev.id === me) { audio.pickup(); this.hud.center(`+1 ${GADGET_LABEL[ev.type]}`, 'good', 1); }
        break;
      }
      case 'flag': {
        const l = g.local; if (!l) break;
        const mine = ev.team === l.team;
        const by = P(ev.by);
        if (ev.st === 'carried') {
          this.hud.feed(`${this.hud.name(by)} took the ${TEAM_NAME[ev.team]} flag`, ev.by === me);
          audio.flagTaken(mine);
          if (ev.by === me) this.hud.big('Flag taken! Run home');
          else if (mine) this.hud.center('Your flag was taken!', 'bad', 2);
        } else if (ev.st === 'home' && ev.ret) { this.hud.feed(`${this.hud.name(by)} returned the ${TEAM_NAME[ev.team]} flag`); audio.pickup(); }
        else if (ev.st === 'home' && ev.auto) this.hud.feed(`The ${TEAM_NAME[ev.team]} flag went back to base`);
        break;
      }
      case 'cap': {
        const l = g.local;
        const good = l && l.team === ev.team;
        this.hud.big(`${TEAM_NAME[ev.team]} scores!`);
        this.hud.feed(`${this.hud.name(P(ev.by))} captured the ${TEAM_NAME[ev.flagTeam]} flag`, ev.by === me);
        audio.capture(good);
        break;
      }
      case 'phase':
        if (ev.phase === 'play') { this.hud.big('GO!'); audio.countdown(true); }
        if (ev.phase === 'end') this.onMatchEnd(ev.results);
        break;
      case 'join':
        if (ev.p.id !== me) this.hud.chat(null, `${ev.p.name} joined`);
        break;
      case 'leave':
        if (ev.left) this.hud.chat(null, 'A player left');
        break;
      case 'chat': {
        const p = P(ev.id);
        this.hud.chat(p ? p.name : '?', ev.msg, p?.team);
        break;
      }
    }
  }

  onMatchEnd(results) {
    const g = this.game;
    const me = g.local;
    const won = results.teams ? me && me.team === results.winner : results.winner === g.localId;
    this.hud.big(won ? 'YOU WIN' : 'MATCH OVER');
    if (won) audio.win(); else audio.lose();
    this.state = 'end';
    document.body.classList.remove('playing');
    this.input.unlock();
    setTimeout(() => {
      if (this.game !== g) return;
      this.endShown = true;
      document.getElementById('touch').hidden = true;
      const type = this.session?.type;
      this.ui.go('end', { results, you: g.localId, canRestart: type !== 'client', host: type === 'host', online: type !== 'solo', ctf: g.mode.id === 'ctf' });
    }, 2600);
  }

  // ---------------------------------------------------------------- per frame
  controlLocal(dt) {
    const g = this.game, p = g.local;
    const [dx, dy] = this.input.takeLook();
    if (!p || !p.alive) return;
    const active = this.canAct() && g.phase !== 'end';
    if (active) {
      const zf = p.zoom ? CFG.binoFov / this.settings.fov : 1;
      const k = 0.0022 * this.settings.sens * zf;
      p.yaw -= dx * k;
      p.pitch -= dy * k * (this.settings.invertY ? -1 : 1);
      p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch));
    }
    const inp = active ? this.input.state() : { fwd: 0, right: 0 };
    g.applyInput(p, inp, dt);
    if (p.landed > 6) audio.land();
    if (p.onGround && p.speed > 2.5 && !p.crouch) {
      p.stepT += dt * p.speed / 2.6;
      if (p.stepT >= 1) { p.stepT = 0; audio.step(null, 0.06); }
    }
  }

  sounds(dt) {
    const g = this.game;
    for (const d of g.distracts) {
      d.beepT = (d.beepT || 0) - dt;
      if (d.beepT <= 0) { d.beepT = 0.3; d.k = (d.k || 0) + 1; audio.distractBeep([d.x, d.y, d.z], d.k); }
    }
    for (const p of g.players.values()) {
      if (p.id === g.localId || !p.alive || !p.onGround || p.crouch || p.speed < 2.5) continue;
      p.stepT += dt * p.speed / 2.6;
      if (p.stepT >= 1) { p.stepT = 0; audio.step([p.x, p.y, p.z], 0.22); }
    }
    for (const gr of g.grenades) if (gr.bounceNow) { gr.bounceNow = false; audio.bounce([gr.x, gr.y, gr.z]); }
    if (g.phase === 'countdown') {
      const n = Math.ceil(g.phaseT);
      if (n !== this.lastCount && n > 0 && n <= 3) { this.lastCount = n; this.hud.big(String(n)); audio.countdown(false); }
    }
  }

  updateWatch(dt) {
    const g = this.game, me = g.local;
    this.watchT -= dt;
    if (this.watchT > 0) return;
    this.watchT = 0.12;
    let best = null, bestD = 1e9;
    if (me && me.alive && this.settings.watchWarn && me.protect <= 0) {
      for (const e of g.players.values()) {
        if (!e.alive || !g.isEnemy(me, e) || e.blind > CFG.blindKillThreshold) continue;
        if (g.facing(me, e) < 0.2) continue;
        const d = Math.hypot(e.x - me.x, e.z - me.z);
        if (d > (e.zoom ? 130 : 30) || d >= bestD) continue;
        if (!g.canSee(e, me, { fov: e.zoom ? 12 : 24, aspect: 1, range: e.zoom ? 130 : 30 })) continue;
        best = e; bestD = d;
      }
    }
    const on = !!best;
    if (on) {
      const yawTo = Math.atan2(-(best.x - me.x), -(best.z - me.z));
      const rel = angDiff(me.yaw, yawTo);
      const wx = 50 + Math.max(-1, Math.min(1, rel / (Math.PI / 2))) * 50;
      this.hud.setWatched(true, wx, 50);
      if (!this.watched) audio.warn();
    } else this.hud.setWatched(false);
    this.watched = on;
  }

  markers() {
    const g = this.game, me = g.local;
    const out = [];
    if (me && g.mode.id === 'ctf' && this.view.mode === 'fp') {
      for (const t of [1, 2]) {
        const f = g.flags[t];
        if (f.state === 'carried' && f.carrier === me.id) continue;
        let label;
        if (t === me.team) label = f.state === 'home' ? 'Your flag' : f.state === 'dropped' ? 'Your flag, dropped' : 'Your flag carrier';
        else label = f.state === 'carried' ? (g.players.get(f.carrier)?.team === me.team ? 'Escort' : 'Enemy flag') : 'Enemy flag';
        const s = this.renderer.project(f.x, f.y + 3.1, f.z);
        if (!s || s.x < 20 || s.y < 20 || s.x > innerWidth - 20 || s.y > innerHeight - 20) continue;
        out.push({ x: s.x, y: s.y, label: `${label} · ${Math.round(Math.hypot(f.x - me.x, f.z - me.z))} m`, color: TEAM_COLOR[t] });
      }
      if (me.carrying) {
        const h = g.flags[me.team].home;
        const s = this.renderer.project(h.x, h.y + 3, h.z);
        if (s && s.x > 20 && s.y > 20 && s.x < innerWidth - 20 && s.y < innerHeight - 20) out.push({ x: s.x, y: s.y, label: `Bring it here · ${Math.round(Math.hypot(h.x - me.x, h.z - me.z))} m`, color: '#ffffff' });
      }
    }
    this.hud.markers(out);
  }

  frame(t) {
    requestAnimationFrame((tt) => this.frame(tt));
    let dt = (t - this.last) / 1000;
    this.last = t;
    if (!(dt > 0)) dt = 0.016;
    dt = Math.min(dt, 0.05);
    this.time += dt;

    const g = this.game || this.attract;
    if (g) {
      const frozen = this.state === 'paused' && this.session?.type === 'solo';
      if (!frozen) {
        if (this.game) this.controlLocal(dt);
        g.update(dt);
        if (this.game) { this.session?.tick(dt); this.sounds(dt); }
      }
      if (this.game) {
        const me = this.game.local;
        this.view.mode = me && me.alive ? 'fp' : me && me.deathPos ? 'death' : 'wait';
        this.hud.update(dt, this.game, me, this.view);
        this.updateWatch(dt);
        const showScore = this.state === 'play' && (this.input.state().score || this.touchScore);
        this.hud.scoreboard(this.game, showScore);
        const ctp = this.state === 'play' && !this.touchMode && !this.input.locked && !this.input.lockFailed && !this.chatOpen;
        this.hud.el.ctp.hidden = !ctp;
        if (me) audio.setListener(me.x, me.y + 1.6, me.z, me.yaw);
      } else {
        const c = this.renderer.camera.position;
        audio.setListener(c.x, c.y, c.z, 0);
      }
    }
    if (!this.game && this.session && this.session.type !== 'solo') this.session.tick(dt);
    this.renderer.sync(dt, this.time, this.view);
    if (this.game) {
      this.markers();
      this.hud.root.hidden = !(this.state === 'play' || (this.state === 'end' && !this.endShown));
    }
    if (this.photoPending) {
      this.photoPending = false;
      this.renderer.render((cv) => this.hud.showPhoto(cv));
    } else this.renderer.render();
    this.ui.frame(dt);

    if (this.settings.showFps) {
      this.fpsAcc += dt; this.fpsN++;
      if (this.fpsAcc > 0.5) { document.getElementById('fps').textContent = `${Math.round(this.fpsN / this.fpsAcc)} fps${this.session?.ping ? ' · ' + this.session.ping + ' ms' : ''}`; this.fpsAcc = 0; this.fpsN = 0; }
    }
  }
}

async function boot() {
  try {
    // let the embedded fonts settle so canvas-drawn notes and signs use them
    if (document.fonts) await Promise.race([Promise.all(['100px "Permanent Marker"', '40px "Dela Gothic One"', '16px "Atkinson Hyperlegible"'].map(f => document.fonts.load(f))).catch(() => {}), new Promise(r => setTimeout(r, 1200))]);
    window.numbskull = new App();
  } catch (e) {
    console.error(e);
    document.getElementById('screens').innerHTML = `<section class="screen" style="max-width:520px"><div class="note pink"><h2>Numbskull couldn't start</h2><p>${esc(e.message || String(e))}</p><p>The game needs WebGL. Try another browser or turn on hardware acceleration.</p></div></section>`;
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
