// The match simulation. One Game runs on every machine:
//  - authority = true  (single player, or the host of an online room): runs bots,
//    validates kills, detonates grenades, scores, flags, timers.
//  - authority = false (an online client): simulates only its own movement and
//    mirrors everything else from host events + snapshots.
// Discrete changes travel as events ("kill", "spawn", "det", ...) that every
// machine applies with the same applyEvent(), so state stays in step.
import { CFG, MODES, TEAM, GADGETS, STREAKS, DIFFICULTY, BOT_NAMES, SHIRT_COLORS, SKIN_TONES, HATS, MAX_PLAYERS, ZONE } from './config.js';
import { World } from './world.js';
import { MAPS } from './maps.js';
import { BotBrain } from './bot.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Network smoothing: other players are shown slightly in the past, interpolated between
// the two states that surround that moment. Movement stays smooth even when packets
// arrive unevenly. The delay adapts to the connection (about 70 ms on a steady one).
export const NET = { snapRate: 20, stateRate: 20 };
const wrapAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const nowSec = () => performance.now() / 1000;

function pushState(p, t, x, y, z, yaw, pitch, fl) {
  const b = p.buf;
  const last = b[b.length - 1];
  if (last && t <= last.t) return;
  // a big jump is a teleport (respawn): don't slide across the map
  if (last && Math.hypot(x - last.x, z - last.z) > 6) b.length = 0;
  b.push({ t, x, y, z, yaw, pitch, fl });
  if (b.length > 32) b.shift();
}

function sampleState(p, T) {
  const b = p.buf;
  if (!b.length) return false;
  while (b.length > 2 && b[1].t <= T) b.shift();
  const a = b[0];
  let c = b.length > 1 ? b[1] : null;
  let k = 0;
  // a late packet: keep moving along the last known path for up to 0.1 s rather than freezing
  if (c && T > c.t) k = 1 + Math.min(0.1, T - c.t) / (c.t - a.t);
  else if (c && T > a.t) k = (T - a.t) / (c.t - a.t);
  if (!c) c = a;
  p.x = a.x + (c.x - a.x) * k; p.y = a.y + (c.y - a.y) * k; p.z = a.z + (c.z - a.z) * k;
  p.yaw = a.yaw + wrapAngle(c.yaw - a.yaw) * k;
  p.pitch = a.pitch + (c.pitch - a.pitch) * k;
  const fl = k < 0.5 ? a.fl : c.fl;
  p.crouch = !!(fl & 2); p.zoom = !!(fl & 4); p.onGround = !!(fl & 8);
  p.netSpeed = c !== a && c.t > a.t ? Math.hypot(c.x - a.x, c.z - a.z) / (c.t - a.t) : 0;
  return true;
}

export function eyeHeight(p) { return lerp(CFG.eyeStand, CFG.eyeCrouch, p.crouchK); }
export function foreheadHeight(p) { return lerp(CFG.foreheadStand, CFG.foreheadCrouch, p.crouchK); }

export class Game {
  constructor(opts) {
    this.opts = opts;
    this.mapId = opts.mapId;
    this.map = MAPS[opts.mapId]();
    this.world = new World(this.map);
    this.mode = MODES[opts.mode];
    this.teams = this.mode.teams;
    this.digits = opts.digits || 4;
    this.scoreLimit = opts.scoreLimit || this.mode.scoreLimit;
    this.timeLimit = opts.timeLimit || this.mode.timeLimit;
    this.difficulty = opts.difficulty || 'normal';
    this.authority = opts.authority !== false;
    this.attract = !!opts.attract; // menu background demo
    this.players = new Map();
    this.order = [];
    this.nextId = 1;
    this.localId = null;
    this.grenades = [];
    this.smokes = this.world.smokes; // shared with the world for line-of-sight
    this.distracts = [];
    this.teamScore = [0, 0, 0];
    this.phase = 'countdown';
    this.phaseT = this.attract ? 0.01 : 3.2;
    this.timeLeft = this.timeLimit;
    this.time = 0;
    this.gid = 1;
    this.listeners = [];
    this.outEvents = [];
    this.results = null;
    this.flags = {};
    if (this.mode.id === 'ctf') {
      for (const t of [1, 2]) {
        const [x, z] = this.map.flags[t];
        const y = this.world.heightAt(x, z);
        this.flags[t] = { team: t, home: { x, y, z }, x, y, z, state: 'home', carrier: 0, dropT: 0 };
      }
    }
    this.pickups = (this.map.pickups || []).map(([x, z]) => ({ x, z, y: this.world.heightAt(x, z) + 0.75, active: true, t: 0 }));
    // Battle Royale: one life each and a shrinking zone
    this.br = this.mode.id === 'br';
    this.lives = this.br ? Math.max(1, Math.min(3, opts.lives || 2)) : 1;
    this.zone = null;
    if (this.br) {
      const W = this.map.width, D = this.map.depth;
      const R0 = Math.hypot(W / 2, D / 2) + 4;
      const x = rand(-W * 0.08, W * 0.08), z = rand(-D * 0.08, D * 0.08);
      this.zone = { x, z, r: R0, R0, nx: x, nz: z, nr: R0, stage: -1, state: 'wait', t: 0, dur: 0, fx: x, fz: z, fr: R0 };
      if (this.authority) this.nextZoneStage();
    }
  }

  on(fn) { this.listeners.push(fn); }

  // ---------------------------------------------------------------- BR zone
  nextZoneStage() {
    const z = this.zone;
    z.stage++;
    const st = ZONE.stages[z.stage];
    if (!st) { z.state = 'final'; z.t = 0; z.x = z.nx; z.z = z.nz; z.r = z.nr; return; }
    z.state = 'wait'; z.t = st.wait; z.dur = st.shrink;
    const nr = st.to * z.R0;
    const room = Math.max(0, z.r - nr);
    let cx = z.x, cz = z.z;
    // the next circle sits inside the current one, centred on somewhere you can actually stand
    for (let k = 0; k < 40; k++) {
      const [x, zz] = this.world.randomNavPoint();
      if (Math.hypot(x - z.x, zz - z.z) <= room * 0.9 && Math.abs(x) < this.world.hw - 3 && Math.abs(zz) < this.world.hd - 3) { cx = x; cz = zz; break; }
    }
    z.nx = cx; z.nz = cz; z.nr = nr;
  }

  updateZone(dt) {
    const z = this.zone;
    if (!z || this.phase !== 'play') return;
    if (this.authority) {
      z.t -= dt;
      if (z.state === 'wait' && z.t <= 0) { z.state = 'shrink'; z.t = z.dur; z.fx = z.x; z.fz = z.z; z.fr = z.r; }
      else if (z.state === 'shrink') {
        const k = 1 - Math.max(0, z.t) / (z.dur || 1);
        z.x = lerp(z.fx, z.nx, k); z.z = lerp(z.fz, z.nz, k); z.r = lerp(z.fr, z.nr, k);
        if (z.t <= 0) this.nextZoneStage();
      }
    } else if (z.t > 0) z.t -= dt;
    for (const p of this.players.values()) {
      if (!p.alive) { p.outT = 0; continue; }
      const outside = Math.hypot(p.x - z.x, p.z - z.z) > z.r;
      p.outT = outside ? (p.outT || 0) + dt : Math.max(0, (p.outT || 0) - dt * 2);
      if (this.authority && outside && p.outT > ZONE.grace && this.phase === 'play') {
        this.emit({ k: 'kill', a: 0, v: p.id, code: 'ZONE', zone: true });
        this.checkWin();
      }
    }
  }

  inZone(x, z, margin = 0, next = false) {
    const Z = this.zone;
    if (!Z) return true;
    const cx = next ? Z.nx : Z.x, cz = next ? Z.nz : Z.z, r = next ? Z.nr : Z.r;
    return Math.hypot(x - cx, z - cz) <= r - margin;
  }

  aliveCount() { let n = 0; for (const p of this.players.values()) if (p.alive) n++; return n; }

  // ---------------------------------------------------------------- players
  makePlayer(o) {
    const p = {
      id: o.id ?? this.nextId++, name: o.name || 'Player', isBot: !!o.isBot, team: o.team || 0,
      shirt: o.shirt || pick(SHIRT_COLORS), skin: o.skin || pick(SKIN_TONES), hat: o.hat || 'none',
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, crouch: false, crouchK: 0, onGround: true, landed: 0,
      zoom: false, fov: CFG.fov, aspect: 1.7, alive: false, respawnT: 0.5, num: '', protect: 0, blind: 0, jam: 0,
      kills: 0, deaths: 0, caps: 0, misses: 0, streak: 0, bestStreak: 0, fastest: 0, reads: 0,
      inv: { flash: 0, smoke: 0, distract: 0 }, camCd: 0, carrying: 0, speed: 0, stepT: 0,
      remote: !!o.remote, human: !o.isBot, ping: 0,
      // interpolation targets for mirrored players
      tx: 0, ty: 0, tz: 0, tyaw: 0, tpitch: 0, hasT: false,
      buf: [], off: null, jit: 0.03, netSpeed: 0,
    };
    if (this.nextId <= p.id) this.nextId = p.id + 1;
    return p;
  }

  addPlayer(o) {
    const p = this.makePlayer(o);
    if (this.teams && !p.team) p.team = this.smallerTeam();
    if (!this.teams) p.team = 0;
    if (this.br && this.phase !== 'countdown' && !this.attract) p.out = true;
    this.players.set(p.id, p);
    this.order.push(p.id);
    if (p.isBot && this.authority) p.brain = new BotBrain(this, p, DIFFICULTY[o.difficulty || this.difficulty]);
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.carrying) this.dropFlag(p);
    this.players.delete(id);
    this.order = this.order.filter(x => x !== id);
  }

  smallerTeam(exclude) {
    let r = 0, b = 0;
    for (const p of this.players.values()) { if (p.id === exclude) continue; if (p.team === 1) r++; else if (p.team === 2) b++; }
    return r <= b ? 1 : 2;
  }

  addBots(n) {
    const used = new Set([...this.players.values()].map(p => p.name));
    const names = BOT_NAMES.filter(x => !used.has(x)).sort(() => Math.random() - 0.5);
    for (let i = 0; i < n && this.players.size < MAX_PLAYERS; i++) {
      const name = names[i] || `Bot ${i + 1}`;
      this.addPlayer({ name, isBot: true, hat: Math.random() < 0.7 ? pick(HATS.slice(1)) : 'none' });
    }
  }

  // Rebalance bots on teams so humans + bots split evenly.
  balanceTeams() {
    if (!this.teams) return;
    const bots = [...this.players.values()].filter(p => p.isBot);
    let r = 0, b = 0;
    for (const p of this.players.values()) if (!p.isBot) { if (p.team === 1) r++; else b++; }
    for (const p of bots) { if (r <= b) { p.team = 1; r++; } else { p.team = 2; b++; } }
  }

  get local() { return this.players.get(this.localId); }

  uniqueNumber() {
    const used = new Set();
    for (const p of this.players.values()) if (p.alive && p.num) used.add(p.num);
    for (const d of this.distracts) used.add(d.fake);
    const lo = Math.pow(10, this.digits - 1), hi = Math.pow(10, this.digits);
    for (let k = 0; k < 200; k++) {
      const n = String(Math.floor(lo + Math.random() * (hi - lo)));
      // avoid boring numbers like 1111
      if (/^(\d)\1+$/.test(n) && Math.random() < 0.9) continue;
      if (!used.has(n)) return n;
    }
    return String(Math.floor(lo + Math.random() * (hi - lo)));
  }

  eye(p) { return [p.x, p.y + eyeHeight(p), p.z]; }
  forehead(p) {
    const h = foreheadHeight(p);
    return [p.x - Math.sin(p.yaw) * 0.32, p.y + h, p.z - Math.cos(p.yaw) * 0.32];
  }
  lookDir(p) {
    const cp = Math.cos(p.pitch);
    return [-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp];
  }

  // Is `t`'s forehead inside s's view and not blocked? (the rule for a valid kill)
  canSee(s, t, opts = {}) {
    if (!s.alive || !t.alive) return false;
    if (s.blind > CFG.blindKillThreshold) return false;
    const [ex, ey, ez] = this.eye(s);
    const [hx, hy, hz] = this.forehead(t);
    const dx = hx - ex, dy = hy - ey, dz = hz - ez;
    const d = Math.hypot(dx, dy, dz);
    const range = opts.range ?? (s.zoom ? CFG.binoRange : CFG.killRange);
    if (d > range) return false;
    const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
    const lx = dx * cy - dz * sy;
    const lf = -dx * sy - dz * cy;
    const cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
    const fwd = lf * cp + dy * sp;
    const up = -lf * sp + dy * cp;
    if (fwd <= 0.05) return false;
    const fov = opts.fov ?? (s.zoom ? CFG.binoFov : s.fov);
    const tanV = Math.tan((fov * Math.PI / 180) / 2) * 1.04;
    const tanH = tanV * (opts.aspect ?? s.aspect);
    if (Math.abs(up) / fwd > tanV || Math.abs(lx) / fwd > tanH) return false;
    return !this.world.segmentBlocked(ex, ey, ez, hx, hy, hz, true);
  }

  // how much of t's note faces s (1 = straight on, <0 = back of head)
  facing(t, s) {
    const dx = s.x - t.x, dz = s.z - t.z;
    const L = Math.hypot(dx, dz) || 1;
    return (-Math.sin(t.yaw) * dx - Math.cos(t.yaw) * dz) / L;
  }

  isEnemy(a, b) { return a.id !== b.id && (!this.teams || a.team !== b.team); }

  // ---------------------------------------------------------------- events
  emit(ev) {
    this.applyEvent(ev);
    this.outEvents.push(ev);
  }

  applyEvent(ev) {
    const P = (id) => this.players.get(id);
    switch (ev.k) {
      case 'spawn': {
        const p = P(ev.id); if (!p) break;
        Object.assign(p, { x: ev.x, y: ev.y, z: ev.z, tx: ev.x, ty: ev.y, tz: ev.z, yaw: ev.yaw, tyaw: ev.yaw, pitch: 0, vx: 0, vy: 0, vz: 0,
          alive: true, num: ev.num, protect: CFG.spawnProtect, blind: 0, jam: 0, carrying: 0, zoom: false, crouch: false, camCd: 0, hasT: false });
        p.buf.length = 0;
        if (ev.team) p.team = ev.team;
        p.spawned = true; p.outT = 0; p.notes = this.lives;
        if (this.br) p.protect = ZONE.dropProtect + Math.max(0, this.phase === 'countdown' ? this.phaseT : 0);
        for (const g of GADGETS) p.inv[g] = CFG.gadgets[g].start;
        if (p.brain) p.brain.onSpawn();
        break;
      }
      case 'kill': {
        const a = P(ev.a), v = P(ev.v);
        if (!v) break;
        v.alive = false; v.respawnT = CFG.respawnTime; v.deaths++; v.streak = 0; v.zoom = false;
        v.killedBy = ev.a; v.killedCode = ev.code; v.deathPos = [v.x, v.y, v.z]; v.deathT = this.time;
        if (!ev.zone) this.lastNoise = { x: v.x, z: v.z, t: this.time };
        if (this.br) { v.out = true; v.place = this.aliveCount() + 1; }
        if (v.carrying) this.dropFlag(v);
        if (a) {
          a.kills++; a.streak++; a.reads++;
          a.bestStreak = Math.max(a.bestStreak, a.streak);
          if (ev.ms && (!a.fastest || ev.ms < a.fastest)) a.fastest = ev.ms;
          if (this.teams && this.mode.id === 'tdm') this.teamScore[a.team]++;
        }
        if (v.brain) v.brain.onDeath();
        break;
      }
      case 'peel': {
        const a = P(ev.a), v = P(ev.v);
        if (v) { v.notes = Math.max(1, (v.notes || 2) - 1); v.num = ev.num; v.protect = 1.2; v.peeledBy = ev.a; }
        if (a) { a.reads++; a.hits = (a.hits || 0) + 1; if (ev.ms && (!a.fastest || ev.ms < a.fastest)) a.fastest = ev.ms; }
        break;
      }
      case 'miss': {
        const p = P(ev.id); if (!p) break;
        if (ev.reason !== 'protected' && ev.reason !== 'team' && ev.reason !== 'wait') { p.jam = CFG.jamTime; p.misses++; }
        break;
      }
      case 'gren': {
        const p = P(ev.owner);
        if (p) { if (p.inv[ev.type] > 0 && !this.authority) p.inv[ev.type]--; p.lastThrow = this.time; }
        this.grenades.push({ id: ev.id, type: ev.type, owner: ev.owner, x: ev.x, y: ev.y, z: ev.z, vx: ev.vx, vy: ev.vy, vz: ev.vz, t: 0, fuse: CFG.gadgets[ev.type].fuse, rest: false });
        break;
      }
      case 'det': {
        this.grenades = this.grenades.filter(g => g.id !== ev.id);
        if (ev.type === 'flash') this.applyFlash(ev.x, ev.y, ev.z);
        else if (ev.type === 'smoke') this.smokes.push({ id: ev.id, x: ev.x, y: ev.y + 0.4, z: ev.z, r: 0, maxR: CFG.gadgets.smoke.radius, t: 0, life: CFG.gadgets.smoke.life });
        else if (ev.type === 'distract') this.distracts.push({ id: ev.id, x: ev.x, y: ev.y, z: ev.z, t: 0, life: CFG.gadgets.distract.life, owner: ev.owner, fake: ev.fake, beep: 0 });
        break;
      }
      case 'photo': break;
      case 'pick': {
        const pk = this.pickups[ev.i]; if (pk) { pk.active = false; pk.t = CFG.pickupRespawn; }
        const p = P(ev.id); if (p && ev.type) p.inv[ev.type] = Math.min(CFG.gadgets[ev.type].max, p.inv[ev.type] + 1);
        break;
      }
      case 'flag': {
        const f = this.flags[ev.team]; if (!f) break;
        if (f.carrier) { const c = P(f.carrier); if (c) c.carrying = 0; }
        f.state = ev.st; f.carrier = 0;
        if (ev.st === 'home') { f.x = f.home.x; f.y = f.home.y; f.z = f.home.z; }
        if (ev.st === 'carried') { f.carrier = ev.by; const c = P(ev.by); if (c) c.carrying = ev.team; }
        if (ev.st === 'dropped') { f.x = ev.x; f.y = ev.y; f.z = ev.z; f.dropT = 20; }
        break;
      }
      case 'cap': {
        const p = P(ev.by);
        if (p) { p.caps++; p.carrying = 0; }
        this.teamScore[ev.team]++;
        const f = this.flags[ev.flagTeam];
        if (f) { f.state = 'home'; f.carrier = 0; f.x = f.home.x; f.y = f.home.y; f.z = f.home.z; }
        break;
      }
      case 'phase': {
        this.phase = ev.phase; this.phaseT = ev.t ?? 0;
        if (ev.timeLeft != null) this.timeLeft = ev.timeLeft;
        if (ev.results) this.results = ev.results;
        break;
      }
      case 'join': {
        if (!this.players.has(ev.p.id)) {
          const p = this.addPlayer({ ...ev.p, remote: true });
          Object.assign(p, ev.p.state || {});
        }
        break;
      }
      case 'leave': this.removePlayer(ev.id); if (this.authority && this.br) this.checkWin(); break;
      case 'team': { const p = P(ev.id); if (p) p.team = ev.team; break; }
      case 'chat': break;
    }
    for (const fn of this.listeners) fn(ev);
  }

  // ---------------------------------------------------------------- actions
  // Local or remote request to type a number at someone.
  tryKill(id, code, ms) {
    const s = this.players.get(id);
    if (!s || !s.alive) return;
    if (this.phase !== 'play') { this.emit({ k: 'miss', id, reason: 'wait' }); return; }
    if (s.jam > 0) return;
    let target = null;
    for (const p of this.players.values()) if (p.alive && p.num === code && p.id !== id) { target = p; break; }
    if (!target) {
      const decoy = this.distracts.some(d => d.fake === code);
      this.emit({ k: 'miss', id, code, reason: code === s.num ? 'self' : decoy ? 'decoy' : 'nobody' });
      return;
    }
    if (this.teams && target.team === s.team) { this.emit({ k: 'miss', id, code, reason: 'team' }); return; }
    if (target.protect > 0) { this.emit({ k: 'miss', id, code, reason: 'protected' }); return; }
    // remote shooters get a little slack for network delay
    const slack = s.remote ? { range: (s.zoom ? CFG.binoRange : CFG.killRange) + 3, fov: (s.zoom ? CFG.binoFov : s.fov) * 1.12 } : {};
    if (!this.canSee(s, target, slack)) { this.emit({ k: 'miss', id, code, reason: 'sight' }); return; }
    if (this.br && (target.notes || 1) > 1) {
      // Battle Royale: the top sticky note comes off and a new number is underneath
      this.emit({ k: 'peel', a: id, v: target.id, code, num: this.uniqueNumber(), ms: ms | 0 });
      return;
    }
    this.emit({ k: 'kill', a: id, v: target.id, code, ms: ms | 0, dist: Math.round(Math.hypot(s.x - target.x, s.z - target.z)) });
    this.checkWin();
  }

  throwGadget(id, type, aim) {
    const p = this.players.get(id);
    if (!p || !p.alive || this.phase === 'end') return;
    if (!p.inv[type] || p.inv[type] <= 0) return;
    if (this.time - (p.lastThrow || -9) < 0.6) return;
    p.inv[type]--;
    p.lastThrow = this.time;
    const yaw = aim ? aim.yaw : p.yaw, pitch = aim ? aim.pitch : p.pitch;
    const pp = clamp(pitch + 0.14, -1.2, 1.3);
    const cp = Math.cos(pp);
    const dx = -Math.sin(yaw) * cp, dy = Math.sin(pp), dz = -Math.cos(yaw) * cp;
    const [ex, ey, ez] = this.eye(p);
    const sp = CFG.throwSpeed * (aim?.power ?? 1);
    this.emit({ k: 'gren', id: this.gid++ + id * 100000, type, owner: id,
      x: ex + dx * 0.4 + Math.cos(yaw) * 0.18, y: ey - 0.15 + dy * 0.4, z: ez + dz * 0.4 - Math.sin(yaw) * 0.18,
      vx: dx * sp + p.vx * 0.5, vy: dy * sp + 1.5, vz: dz * sp + p.vz * 0.5 });
  }

  takePhoto(id) {
    const p = this.players.get(id);
    if (!p || !p.alive || p.camCd > 0) return false;
    p.camCd = CFG.cameraCooldown;
    this.emit({ k: 'photo', id });
    return true;
  }

  applyFlash(x, y, z) {
    const R = CFG.gadgets.flash.radius;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const [ex, ey, ez] = this.eye(p);
      const dx = x - ex, dy = y - ey, dz = z - ez;
      const d = Math.hypot(dx, dy, dz);
      if (d > R) continue;
      if (this.world.segmentBlocked(ex, ey, ez, x, y + 0.15, z, false)) continue;
      const [lx, ly, lz] = this.lookDir(p);
      const f = (lx * dx + ly * dy + lz * dz) / (d || 1);
      const af = clamp((f + 0.45) / 1.25, 0.12, 1);
      const df = 1 - Math.pow(d / R, 1.4);
      const s = clamp(af * df * 1.2, 0, 1);
      if (s > p.blind) p.blind = s;
      p.lastFlash = s;
      if (p.brain) p.brain.onFlashed(s);
    }
  }

  dropFlag(p) {
    const t = p.carrying;
    if (!t || !this.flags[t]) return;
    const f = this.flags[t];
    f.state = 'dropped'; f.carrier = 0; f.dropT = 20;
    f.x = p.x; f.z = p.z; f.y = this.world.groundAt(p.x, p.z, 0.2, p.y + 0.5);
    p.carrying = 0;
  }

  // ---------------------------------------------------------------- spawning
  pickSpawn(p) {
    const enemies = [...this.players.values()].filter(o => o.alive && this.isEnemy(p, o));
    const cands = [];
    if (this.teams && p.team && this.map.teamSpawns[p.team]) {
      for (const [x, z] of this.map.teamSpawns[p.team]) cands.push([x + rand(-1.2, 1.2), z + rand(-1.2, 1.2)]);
      // also some points in the team's own half, so spawn camping isn't trivial
      for (let i = 0; i < 6; i++) {
        const [x, z] = this.world.randomNavPoint();
        if ((p.team === 1 && x < -this.world.hw * 0.45) || (p.team === 2 && x > this.world.hw * 0.45)) cands.push([x, z]);
      }
    } else {
      for (let i = 0; i < 16; i++) { const [x, z] = this.world.randomNavPoint(); cands.push([x, z]); }
    }
    let best = cands[0], bestS = -1e9;
    for (const [x, z] of cands) {
      const y = this.world.heightAt(x, z);
      let minD = 60, seen = 0;
      for (const e of enemies) {
        const d = Math.hypot(e.x - x, e.z - z);
        minD = Math.min(minD, d);
        if (d < 40 && !this.world.segmentBlocked(e.x, e.y + 1.6, e.z, x, y + 1.6, z, true)) seen++;
      }
      const s = minD - seen * 18 + Math.random() * 6;
      if (s > bestS) { bestS = s; best = [x, z]; }
    }
    let [x, z] = best;
    const c = { x, y: 0, z, vx: 0, vy: 0, vz: 0, onGround: true, crouch: false };
    c.y = this.world.heightAt(x, z);
    this.world.moveCharacter(c, 0.016); // resolve any overlap
    // face toward the middle of the map
    const yaw = Math.atan2(c.x, c.z) + rand(-0.5, 0.5);
    return { x: c.x, y: c.y, z: c.z, yaw };
  }

  spawn(p) {
    const s = this.pickSpawn(p);
    this.emit({ k: 'spawn', id: p.id, x: +s.x.toFixed(2), y: +s.y.toFixed(2), z: +s.z.toFixed(2), yaw: +s.yaw.toFixed(3), num: this.uniqueNumber(), team: p.team });
  }

  // ---------------------------------------------------------------- per-frame
  // input: { fwd, right, jump, sprint, crouch, zoom }
  applyInput(p, inp, dt) {
    p.crouch = !!inp.crouch;
    p.zoom = !!inp.zoom && p.alive;
    const ck = p.crouch ? 1 : 0;
    p.crouchK += (ck - p.crouchK) * Math.min(1, dt * 12);
    let speed = CFG.walkSpeed;
    if (inp.sprint && !p.crouch && !p.zoom && inp.fwd > 0) speed *= CFG.sprintMul;
    if (p.crouch) speed *= CFG.crouchMul;
    if (p.zoom) speed *= CFG.binoMul;
    if (p.carrying) speed *= 0.93;
    let f = inp.fwd || 0, r = inp.right || 0;
    const L = Math.hypot(f, r);
    if (L > 1) { f /= L; r /= L; }
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    const wx = (-sy * f + cy * r) * speed, wz = (-cy * f - sy * r) * speed;
    const acc = p.onGround ? 14 : 3.5;
    const k = Math.min(1, dt * acc);
    p.vx += (wx - p.vx) * k; p.vz += (wz - p.vz) * k;
    if (inp.jump && p.onGround && !p.crouch) { p.vy = CFG.jumpVel; p.onGround = false; p.jumped = true; }
    this.world.moveCharacter(p, dt);
    p.speed = Math.hypot(p.vx, p.vz);
  }

  update(dt) {
    this.time += dt;
    const A = this.authority;
    // let the clock estimates drift back if the other side's clock ran slow for a while
    if (!A && this.clockOff != null) this.clockOff -= dt * 0.1;
    if (A) for (const p of this.players.values()) if (p.off != null) p.off += dt * 0.1;
    // phases
    if (this.phase === 'countdown') {
      this.phaseT -= dt;
      if (A && this.phaseT <= 0) this.emit({ k: 'phase', phase: 'play', timeLeft: this.timeLimit });
    } else if (this.phase === 'play') {
      this.timeLeft -= dt;
      if (A && this.timeLeft <= 0) { this.timeLeft = 0; this.endMatch(); }
    } else if (this.phase === 'end') {
      this.phaseT += dt;
    }

    for (const p of this.players.values()) {
      if (!p.alive) {
        if (A && !(this.br && (p.out || p.spawned))) {
          p.respawnT -= dt;
          if (p.respawnT <= 0 && this.phase !== 'end') this.spawn(p);
        }
        continue;
      }
      if (p.protect > 0) p.protect -= dt;
      if (p.blind > 0) p.blind = Math.max(0, p.blind - dt / CFG.gadgets.flash.maxBlind);
      if (p.jam > 0) p.jam -= dt;
      if (p.camCd > 0) p.camCd -= dt;

      if (p.brain) {
        const inp = p.brain.update(dt);
        this.applyInput(p, inp, dt);
      } else if (p.id === this.localId) {
        // local human movement is applied by the controller before update()
      } else if (p.remote || !A) {
        // mirrored player: interpolate between buffered network states
        const T = A ? this.time - (1 / NET.stateRate + clamp(p.jit, 0.02, 0.25))
          : nowSec() + this.clockOff - (1 / NET.snapRate + clamp(this.jit, 0.02, 0.25));
        if (this.clockOff != null || A) {
          if (sampleState(p, T)) {
            p.crouchK += ((p.crouch ? 1 : 0) - p.crouchK) * Math.min(1, dt * 12);
            p.speed += (p.netSpeed - p.speed) * Math.min(1, dt * 8);
          }
        }
      }

      if (A && this.phase !== 'end') {
        this.checkPickups(p);
        if (this.mode.id === 'ctf') this.checkFlags(p);
      }
    }

    this.updateZone(dt);
    this.updateGrenades(dt);
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.t += dt;
      const grow = Math.min(1, s.t / 1.3);
      const shrink = s.life - s.t < 1.6 ? Math.max(0, (s.life - s.t) / 1.6) : 1;
      s.r = s.maxR * Math.sqrt(grow) * shrink;
      if (s.t >= s.life) this.smokes.splice(i, 1);
    }
    for (let i = this.distracts.length - 1; i >= 0; i--) {
      const d = this.distracts[i];
      d.t += dt;
      if (d.t >= d.life) this.distracts.splice(i, 1);
    }
    for (const pk of this.pickups) if (!pk.active) { pk.t -= dt; if (pk.t <= 0) pk.active = true; }
    if (this.mode.id === 'ctf') {
      for (const t of [1, 2]) {
        const f = this.flags[t];
        if (f.state === 'carried') {
          const c = this.players.get(f.carrier);
          if (c) { f.x = c.x; f.y = c.y; f.z = c.z; }
        } else if (f.state === 'dropped') {
          f.dropT -= dt;
          if (A && f.dropT <= 0) this.emit({ k: 'flag', team: t, st: 'home', auto: true });
        }
      }
    }
  }

  updateGrenades(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.t += dt;
      if (!g.rest) {
        g.vy -= CFG.grenadeGravity * dt;
        let remaining = dt;
        for (let it = 0; it < 3 && remaining > 0; it++) {
          const sp = Math.hypot(g.vx, g.vy, g.vz);
          if (sp < 1e-4) break;
          const dist = sp * remaining;
          const hit = this.world.raycast(g.x, g.y, g.z, g.vx / sp, g.vy / sp, g.vz / sp, dist + 0.08);
          if (hit && hit.t <= dist + 0.08) {
            const tt = Math.max(0, hit.t - 0.08);
            g.x += g.vx / sp * tt; g.y += g.vy / sp * tt; g.z += g.vz / sp * tt;
            const vn = g.vx * hit.nx + g.vy * hit.ny + g.vz * hit.nz;
            g.vx -= 1.45 * vn * hit.nx; g.vy -= 1.45 * vn * hit.ny; g.vz -= 1.45 * vn * hit.nz;
            g.vx *= 0.72; g.vz *= 0.72; if (hit.ny > 0.5) g.vy *= 0.6;
            remaining -= tt / sp;
            if (Math.abs(vn) > 2.5) g.bounced = (g.bounced || 0) + 1, g.bounceNow = true;
            if (hit.ny > 0.5 && Math.hypot(g.vx, g.vy, g.vz) < 1.2) { g.rest = true; g.vx = g.vy = g.vz = 0; break; }
          } else {
            g.x += g.vx * remaining; g.y += g.vy * remaining; g.z += g.vz * remaining;
            remaining = 0;
          }
        }
        if (g.y < 0.08) { g.y = 0.08; if (g.vy < 0) g.vy = 0; }
      }
      if (this.authority && g.t >= g.fuse) {
        const ev = { k: 'det', id: g.id, type: g.type, owner: g.owner, x: +g.x.toFixed(2), y: +g.y.toFixed(2), z: +g.z.toFixed(2) };
        if (g.type === 'distract') ev.fake = this.uniqueNumber();
        this.emit(ev);
      }
    }
  }

  checkPickups(p) {
    this.pickups.forEach((pk, i) => {
      if (!pk.active) return;
      if (Math.abs(p.x - pk.x) > 1.1 || Math.abs(p.z - pk.z) > 1.1 || Math.abs(p.y + 0.8 - pk.y) > 1.6) return;
      const need = GADGETS.filter(g => p.inv[g] < CFG.gadgets[g].max);
      if (!need.length) return;
      need.sort((a, b) => p.inv[a] - p.inv[b]);
      const type = Math.random() < 0.6 ? need[0] : pick(need);
      this.emit({ k: 'pick', i, id: p.id, type });
    });
  }

  checkFlags(p) {
    for (const t of [1, 2]) {
      const f = this.flags[t];
      if (f.state === 'carried') continue;
      const d = Math.hypot(p.x - f.x, p.z - f.z), dy = Math.abs(p.y - f.y);
      if (d > 1.4 || dy > 2) continue;
      if (p.team !== t && !p.carrying) this.emit({ k: 'flag', team: t, st: 'carried', by: p.id });
      else if (p.team === t && f.state === 'dropped') this.emit({ k: 'flag', team: t, st: 'home', by: p.id, ret: true });
    }
    if (p.carrying) {
      const own = this.flags[p.team];
      if (own && own.state === 'home' && Math.hypot(p.x - own.home.x, p.z - own.home.z) < 2.2 && Math.abs(p.y - own.home.y) < 2) {
        this.emit({ k: 'cap', team: p.team, by: p.id, flagTeam: p.carrying });
        this.checkWin();
      }
    }
  }

  scoreOf(teamOrPlayer) {
    return typeof teamOrPlayer === 'number' ? this.teamScore[teamOrPlayer] : teamOrPlayer.kills;
  }

  leader() {
    let best = null;
    for (const p of this.players.values()) if (!best || p.kills > best.kills || (p.kills === best.kills && p.deaths < best.deaths)) best = p;
    return best;
  }

  checkWin() {
    if (this.phase !== 'play' || this.attract) return;
    if (this.br) {
      const started = [...this.players.values()].filter(p => p.spawned).length;
      if (started >= 2 && this.aliveCount() <= 1) this.endMatch();
      return;
    }
    if (this.teams) {
      if (this.teamScore[1] >= this.scoreLimit || this.teamScore[2] >= this.scoreLimit) this.endMatch();
    } else {
      const l = this.leader();
      if (l && l.kills >= this.scoreLimit) this.endMatch();
    }
  }

  endMatch() {
    if (this.phase === 'end') return;
    let winner;
    if (this.br) {
      // survivors get the top places: last one standing first, then by reads
      const alive = [...this.players.values()].filter(p => p.alive).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
      alive.forEach((p, i) => { p.place = i + 1; });
      const first = [...this.players.values()].find(p => p.place === 1);
      winner = first ? first.id : 0;
    } else if (this.teams) winner = this.teamScore[1] > this.teamScore[2] ? 1 : this.teamScore[2] > this.teamScore[1] ? 2 : 0;
    else { const l = this.leader(); winner = l ? l.id : 0; const tie = [...this.players.values()].filter(p => p.kills === l?.kills).length > 1; if (tie) winner = 0; }
    const results = {
      winner, teams: this.teams, teamScore: [...this.teamScore],
      br: this.br,
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, caps: p.caps, misses: p.misses, best: p.bestStreak, fastest: p.fastest, isBot: p.isBot, place: p.place || 0, out: !!p.out && !p.spawned })),
    };
    this.emit({ k: 'phase', phase: 'end', t: 0, results });
  }

  // ------------------------------------------------------------- networking
  // Full state for a joining client.
  fullState() {
    return {
      opts: { mapId: this.mapId, mode: this.mode.id, digits: this.digits, scoreLimit: this.scoreLimit, timeLimit: this.timeLimit, difficulty: this.difficulty, lives: this.lives },
      phase: this.phase, phaseT: this.phaseT, timeLeft: this.timeLeft, teamScore: this.teamScore, gid: this.gid,
      players: [...this.players.values()].map(p => this.playerInit(p)),
      flags: this.flags, pickups: this.pickups.map(pk => ({ active: pk.active, t: pk.t })),
      smokes: this.smokes, distracts: this.distracts, grenades: this.grenades, zone: this.zone,
    };
  }

  playerInit(p) {
    return { id: p.id, name: p.name, isBot: p.isBot, team: p.team, shirt: p.shirt, skin: p.skin, hat: p.hat,
      state: { x: p.x, y: p.y, z: p.z, yaw: p.yaw, alive: p.alive, num: p.num, kills: p.kills, deaths: p.deaths, caps: p.caps, misses: p.misses, carrying: p.carrying, protect: p.protect, respawnT: p.respawnT, inv: { ...p.inv }, tx: p.x, ty: p.y, tz: p.z, tyaw: p.yaw, hasT: true, streak: p.streak, bestStreak: p.bestStreak, out: !!p.out, spawned: !!p.spawned, place: p.place || 0, notes: p.notes || 1 } };
  }

  loadState(s) {
    this.phase = s.phase; this.phaseT = s.phaseT; this.timeLeft = s.timeLeft; this.teamScore = s.teamScore;
    for (const pi of s.players) {
      const p = this.addPlayer({ ...pi, remote: true });
      p.team = pi.team;
      Object.assign(p, pi.state);
    }
    if (s.flags) for (const t of Object.keys(s.flags)) Object.assign(this.flags[t], s.flags[t]);
    if (s.pickups) s.pickups.forEach((pk, i) => { if (this.pickups[i]) Object.assign(this.pickups[i], pk); });
    for (const sm of s.smokes || []) this.smokes.push({ ...sm });
    for (const d of s.distracts || []) this.distracts.push({ ...d });
    for (const g of s.grenades || []) this.grenades.push({ ...g });
    if (s.zone && this.zone) Object.assign(this.zone, s.zone);
  }

  // Binary snapshot of every player's continuous state (about 3x smaller than JSON).
  // layout: u8 kind=1, u8 phase, u16 count, f64 hostTime, f32 timeLeft, u8 hasZone, u8 zoneState, u16 pad,
  //         f32 x7 zone (x, z, r, nx, nz, nr, t), then per player:
  //         u16 id, u8 flags, u8 blind, f32 x, y, z, yaw, pitch
  snapshot() {
    const n = this.players.size;
    const buf = new ArrayBuffer(48 + n * 24), v = new DataView(buf);
    v.setUint8(0, 1);
    v.setUint8(1, this.phase === 'countdown' ? 0 : this.phase === 'play' ? 1 : 2);
    v.setUint16(2, n, true);
    v.setFloat64(4, this.time, true);
    v.setFloat32(12, this.timeLeft, true);
    const z = this.zone;
    if (z) {
      v.setUint8(16, 1); v.setUint8(17, z.state === 'wait' ? 0 : z.state === 'shrink' ? 1 : 2);
      [z.x, z.z, z.r, z.nx, z.nz, z.nr, Math.max(0, z.t)].forEach((f, i) => v.setFloat32(20 + i * 4, f, true));
    }
    let o = 48;
    for (const p of this.players.values()) {
      const fl = (p.alive ? 1 : 0) | (p.crouch ? 2 : 0) | (p.zoom ? 4 : 0) | (p.onGround ? 8 : 0) | (p.protect > 0 ? 16 : 0);
      v.setUint16(o, p.id, true); v.setUint8(o + 2, fl); v.setUint8(o + 3, Math.round(clamp(p.blind, 0, 1) * 100));
      v.setFloat32(o + 4, p.x, true); v.setFloat32(o + 8, p.y, true); v.setFloat32(o + 12, p.z, true);
      v.setFloat32(o + 16, wrapAngle(p.yaw), true); v.setFloat32(o + 20, p.pitch, true);
      o += 24;
    }
    return buf;
  }

  applySnapshot(buf) {
    const v = new DataView(buf);
    if (v.getUint8(0) !== 1) return;
    const ht = v.getFloat64(4, true);
    // host clock estimate: the earliest-arriving snapshots define the offset, lateness is jitter
    const wall = nowSec();
    const off = ht - wall;
    if (this.clockOff == null || off > this.clockOff) this.clockOff = off;
    this.jit = Math.max((wall + this.clockOff) - ht, (this.jit ?? 0.03) * 0.99);
    this.timeLeft = v.getFloat32(12, true);
    if (v.getUint8(16) && this.zone) {
      const z = this.zone, st = v.getUint8(17);
      z.x = v.getFloat32(20, true); z.z = v.getFloat32(24, true); z.r = v.getFloat32(28, true);
      z.nx = v.getFloat32(32, true); z.nz = v.getFloat32(36, true); z.nr = v.getFloat32(40, true); z.t = v.getFloat32(44, true);
      z.state = st === 0 ? 'wait' : st === 1 ? 'shrink' : 'final';
    }
    const n = v.getUint16(2, true);
    let o = 48;
    for (let i = 0; i < n; i++, o += 24) {
      const p = this.players.get(v.getUint16(o, true));
      if (!p || p.id === this.localId) continue;
      const fl = v.getUint8(o + 2);
      p.blind = v.getUint8(o + 3) / 100;
      pushState(p, ht, v.getFloat32(o + 4, true), v.getFloat32(o + 8, true), v.getFloat32(o + 12, true), v.getFloat32(o + 16, true), v.getFloat32(o + 20, true), fl);
      p.hasT = true;
    }
  }

  // state the client reports about itself (s[8] is the client's clock, for smoothing on the host)
  localStateMsg() {
    const p = this.local;
    return { t: 'st', s: [Math.round(p.x * 100), Math.round(p.y * 100), Math.round(p.z * 100), Math.round(wrapAngle(p.yaw) * 1000), Math.round(p.pitch * 1000), (p.crouch ? 2 : 0) | (p.zoom ? 4 : 0) | (p.onGround ? 8 : 0), Math.round(p.aspect * 100), Math.round(p.fov), Math.round(nowSec() * 1000)] };
  }

  applyRemoteState(id, s) {
    const p = this.players.get(id);
    if (!p || !p.alive) return;
    p.aspect = (s[6] || 170) / 100; p.fov = s[7] || CFG.fov;
    const ct = (s[8] != null ? s[8] : nowSec() * 1000) / 1000;
    const off = this.time - ct;
    if (p.off == null || off < p.off) p.off = off;
    const t = ct + p.off;
    p.jit = Math.max(this.time - t, p.jit * 0.99);
    pushState(p, t, s[0] / 100, s[1] / 100, s[2] / 100, s[3] / 1000, s[4] / 1000, s[5] | 1);
    if (!p.hasT) { sampleState(p, t); p.hasT = true; }
  }
}
