// Bot AI. Bots play by the same rules as people: they can only learn a number by
// looking at someone's forehead for long enough, they type it digit by digit (and
// sometimes fat-finger it), and the kill only counts if the target is in view.
import { CFG } from './config.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

export class BotBrain {
  constructor(game, p, diff) {
    this.g = game; this.p = p; this.d = diff;
    this.jit = rand(0.85, 1.2);          // per-bot personality
    this.aggression = rand(0.3, 1) * (game.br ? 0.45 : 1);
    this.role = null;                    // CTF: 'attack' or 'defend', picked on first use
    this.know = new Map();               // enemy id -> { prog, num, seenT, x, y, z }
    this.reset();
  }

  reset() {
    this.path = null; this.pathI = 0; this.goal = null; this.repathT = 0;
    this.typing = null; this.thinkT = 0; this.percT = Math.random() * 0.1;
    this.state = 'roam'; this.stateT = 0;
    this.target = null; this.visible = [];
    this.lookAt = null; this.zoom = false; this.crouch = false; this.sprint = false;
    this.strafe = 0; this.strafeT = 0;
    this.stuckT = 0; this.lastX = this.p.x; this.lastZ = this.p.z;
    this.distractUntil = 0; this.distractPos = null; this.seenDistract = new Set();
    this.evadeFrom = null; this.panicT = 0; this.jumpReq = false; this.waitT = 0;
    this.idleYaw = 0; this.cooldown = { flash: rand(2, 6), smoke: rand(2, 6), distract: rand(6, 14) };
  }

  onSpawn() {
    this.reset();
    this.know.clear();
  }

  pickRole() {
    let att = 0, def = 0;
    for (const o of this.g.players.values()) if (o.brain && o !== this.p && o.team === this.p.team) { if (o.brain.role === 'attack') att++; else if (o.brain.role === 'defend') def++; }
    this.role = att <= def * 1.5 ? 'attack' : 'defend';
  }

  // in CTF, attackers and flag carriers don't get side-tracked by far-away enemies
  onObjective() {
    if (this.g.mode.id !== 'ctf') return false;
    if (!this.role) this.pickRole();
    if (this.p.carrying) return true;
    const own = this.g.flags[this.p.team];
    if (own.state !== 'home') return true; // everyone goes after our flag
    return this.role === 'attack';
  }
  onDeath() { this.typing = null; this.path = null; }
  onFlashed(s) { if (s > 0.3) { this.panicT = s * 2.2; this.typing = this.typing && s < 0.6 ? this.typing : null; } }

  // ------------------------------------------------------------------ perception
  perceive(dt) {
    const g = this.g, p = this.p, d = this.d;
    const now = g.time;
    this.visible.length = 0;
    const vfov = (p.zoom ? CFG.binoFov * 1.5 : d.fov) / 1.6;
    for (const e of g.players.values()) {
      if (!e.alive || !g.isEnemy(p, e)) continue;
      const k = this.know.get(e.id) || { prog: 0, num: null, seenT: -99, x: e.x, y: e.y, z: e.z };
      if (k.num && k.num !== e.num) { k.num = null; k.prog = 0; }
      const vis = g.canSee(p, e, { fov: vfov, aspect: 1.6 });
      if (vis) {
        k.seenT = now; k.x = e.x; k.y = e.y; k.z = e.z;
        const dist = Math.hypot(e.x - p.x, e.y - p.y, e.z - p.z);
        this.visible.push({ e, dist });
        const face = g.facing(e, p);
        const range = p.zoom ? d.readRange * 3.6 : d.readRange;
        if (!k.num && face > 0.3 && dist < range && e.protect <= 0) {
          const rt = d.readTime * this.jit * (0.55 + Math.pow(dist / range, 2) * 1.3) * (1 + e.speed / 9) * (p.zoom ? 1.25 : 1) * (face < 0.6 ? 1.6 : 1);
          k.prog += dt / rt;
          if (k.prog >= 1) { k.num = e.num; k.prog = 1; }
        }
      } else {
        k.prog = Math.max(0, k.prog - dt * 0.4);
        if (k.num && now - k.seenT > 14) k.num = null; // forgot it
        // footsteps: people running nearby give themselves away
        const hd = Math.hypot(e.x - p.x, e.z - p.z);
        if (hd < (g.br ? 14 : 22) && e.speed > 3.2 && !e.crouch && Math.random() < (g.br ? 0.35 : 1)) { k.heardT = now; k.x = e.x + rand(-2, 2); k.y = e.y; k.z = e.z + rand(-2, 2); }
      }
      this.know.set(e.id, k);
    }
    // a pop of confetti carries a long way
    const n = g.lastNoise;
    if (n && now - n.t < 0.25 && n.t !== this.noiseSeen && Math.hypot(n.x - p.x, n.z - p.z) < 48) { this.noiseSeen = n.t; this.investigate = [n.x + rand(-3, 3), n.z + rand(-3, 3)]; this.investT = now; }
    // distractions grab attention
    for (const ds of g.distracts) {
      if (this.seenDistract.has(ds.id)) continue;
      this.seenDistract.add(ds.id);
      const dist = Math.hypot(ds.x - p.x, ds.z - p.z);
      if (dist < CFG.gadgets.distract.radius && ds.owner !== p.id && !(g.teams && g.players.get(ds.owner)?.team === p.team) && Math.random() < d.distractable) {
        this.distractUntil = now + ds.life - ds.t;
        this.distractPos = [ds.x, ds.y + 1.5, ds.z];
        if (this.typing && Math.random() < 0.5) this.typing = null;
      }
    }
    if (now > this.distractUntil) this.distractPos = null;
  }

  // enemies currently looking straight at us with our note facing them
  threats() {
    const g = this.g, p = this.p, out = [];
    for (const { e, dist } of this.visible) {
      if (g.facing(p, e) < 0.15) continue;
      const theyLook = g.facing(e, p);
      const range = e.zoom ? 110 : 32;
      if (theyLook > 0.8 && dist < range) out.push({ e, dist });
    }
    return out;
  }

  // ------------------------------------------------------------------ decisions
  think() {
    const g = this.g, p = this.p, d = this.d, now = g.time;
    this.stateT -= 0.25;
    // 1) a number we know and can see: type it
    if (!this.typing && p.jam <= 0 && g.phase === 'play' && this.panicT <= 0) {
      let best = null;
      for (const { e, dist } of this.visible) {
        const k = this.know.get(e.id);
        if (k && k.num === e.num && (!best || dist < best.dist)) best = { e, dist };
      }
      if (best) {
        const code = this.maybeTypo(best.e.num);
        this.typing = { id: best.e.id, code, i: 0, t: d.reaction * rand(0.7, 1.3), start: now, wait: 0 };
        this.target = best.e;
        this.zoom = this.zoom && best.dist > 30;
        return;
      }
    }
    if (this.typing) return;

    // 1b) Battle Royale: get inside the zone before anything else
    if (g.br && g.zone && g.phase === 'play') {
      const Z = g.zone;
      const useNext = Z.state === 'shrink' || (Z.state === 'wait' && Z.t < 14) || Z.state === 'final';
      const safe = g.inZone(p.x, p.z, 1.5, useNext) && g.inZone(p.x, p.z, 1, false);
      if (!safe) {
        if (this.state !== 'zone' || !this.goal || !g.inZone(this.goal[0], this.goal[1], 1.5, useNext)) { this.goal = this.zonePoint(useNext); this.path = null; }
        this.state = 'zone'; this.stateT = 2; this.sprint = true; this.zoom = false; this.crouch = false;
        return;
      }
      if (this.state === 'zone') { this.state = 'roam'; this.goal = null; }
    }

    // 2) being read? either win the race or get out of there
    const th = this.threats();
    if (th.length && this.state !== 'evade' && now > (this.evadeCd || 0)) {
      const t = th.sort((a, b) => a.dist - b.dist)[0];
      const k = this.know.get(t.e.id);
      const racing = k && (k.num || k.prog > 0.4);
      this.evadeCd = now + rand(1, 1.8);
      if (!racing && Math.random() < d.evade * (g.br ? 0.9 : 0.55)) {
        this.evadeFrom = t.e;
        if (this.tryGadget('flash', t.e, t.dist)) return;
        if (Math.random() < 0.5) this.tryGadget('smoke', t.e, Math.min(6, t.dist * 0.4));
        this.state = 'evade'; this.stateT = rand(1.2, 2.2);
        this.goal = this.coverFrom(t.e); this.path = null;
        this.crouch = Math.random() < 0.5;
        this.zoom = false;
        return;
      }
    }
    if (this.state === 'evade' && this.stateT > 0) return;

    // 3) an enemy in sight whose number we don't know: study them
    const busy = this.onObjective();
    const near = this.visible.length ? this.visible.reduce((m, v) => Math.min(m, v.dist), 99) : 99;
    if (this.visible.length && (!busy || near < (p.carrying ? 9 : 15))) {
      const v = this.visible.sort((a, b) => a.dist - b.dist)[0];
      this.target = v.e;
      const range = this.d.readRange;
      // only their back is showing: run round to their front
      if (g.facing(v.e, p) < 0.15 && v.dist < 32 && !p.zoom) {
        const fx = v.e.x - Math.sin(v.e.yaw) * rand(6, 10), fz = v.e.z - Math.cos(v.e.yaw) * rand(6, 10);
        if (this.state !== 'flank' || this.stateT <= 0) { this.goal = [fx + rand(-2, 2), fz + rand(-2, 2)]; this.path = null; this.stateT = 1.4; }
        this.state = 'flank'; this.zoom = false; this.sprint = v.dist > 12;
        return;
      }
      if (v.dist > range * 0.9 && v.dist < CFG.binoRange * 0.8 && Math.random() < d.bino) {
        this.state = 'scope'; this.stateT = rand(1.5, 3.5); this.zoom = true; this.path = null;
        return;
      }
      this.zoom = false;
      this.state = 'study'; this.stateT = rand(0.8, 1.6);
      // close in to reading range, but not too close (in Battle Royale, often hold position instead)
      if (v.dist > range * 0.7 && !(g.br && Math.random() < 0.55)) { this.goal = [v.e.x, v.e.z]; this.path = null; }
      else { this.goal = null; this.path = null; }
      this.strafe = Math.random() < 0.5 ? -1 : 1;
      if (Math.random() < d.gadget * 0.15) this.tryGadget('flash', v.e, v.dist);
      return;
    }
    this.zoom = false;
    this.crouch = false;

    // 4) known number, enemy just out of sight (or heard nearby): chase the spot
    if (!busy) for (const [id, k] of this.know) {
      const e = g.players.get(id);
      if (e && e.alive && ((k.num === e.num && now - k.seenT < 4) || now - (k.heardT || -99) < 1.5)) {
        this.state = 'chase'; this.stateT = 2;
        this.goal = [k.x, k.z]; if (this.repathT <= 0) this.path = null;
        this.lookAt = [k.x, k.y + 1.6, k.z];
        return;
      }
    }
    if (this.investigate && now - this.investT < 6 && Math.random() < this.aggression && g.mode.id !== 'ctf') {
      this.state = 'chase'; this.stateT = 3; this.goal = this.investigate; this.investigate = null; this.path = null;
      this.lookAt = [this.goal[0], p.y + 1.6, this.goal[1]];
      return;
    }

    // 5) objectives / roaming
    if (this.state !== 'roam' || !this.goal || this.stateT <= 0 || this.reached()) {
      this.state = 'roam';
      this.goal = this.pickGoal();
      this.stateT = busy ? rand(1.5, 3) : rand(6, 14);
      this.path = null;
      this.sprint = busy || (!g.br && Math.random() < 0.5);
      if (g.br) this.crouch = Math.random() < 0.25;
      if (Math.random() < d.gadget * 0.08) this.tryGadget('distract', null, rand(10, 20));
    }
  }

  zonePoint(next) {
    const g = this.g, Z = g.zone;
    const cx = next ? Z.nx : Z.x, cz = next ? Z.nz : Z.z, r = next ? Z.nr : Z.r;
    for (let k = 0; k < 40; k++) {
      const [x, z] = g.world.randomNavPoint();
      if (Math.hypot(x - cx, z - cz) < r * 0.7) return [x, z];
    }
    return [cx, cz];
  }

  maybeTypo(num) {
    if (Math.random() >= this.d.mistake) return num;
    const a = num.split('');
    const i = Math.floor(Math.random() * a.length);
    a[i] = String((+a[i] + 1 + Math.floor(Math.random() * 8)) % 10);
    return a.join('');
  }

  reached() {
    if (!this.goal) return true;
    return Math.hypot(this.goal[0] - this.p.x, this.goal[1] - this.p.z) < 1.5;
  }

  pickGoal() {
    const g = this.g, p = this.p;
    if (g.mode.id === 'ctf') {
      if (!this.role) this.pickRole();
      const own = g.flags[p.team], enemy = g.flags[3 - p.team];
      if (p.carrying) return [own.home.x, own.home.z];
      if (own.state === 'dropped') return [own.x, own.z];
      if (own.state === 'carried') { const c = g.players.get(own.carrier); if (c) return [c.x, c.z]; }
      if (this.role === 'attack' || enemy.state === 'dropped') return [enemy.x + rand(-1, 1), enemy.z + rand(-1, 1)];
      // defend: loiter near our flag
      for (let k = 0; k < 8; k++) {
        const [x, z] = g.world.randomNavPoint();
        if (Math.hypot(x - own.home.x, z - own.home.z) < 16) return [x, z];
      }
      return [own.home.x + rand(-6, 6), own.home.z + rand(-6, 6)];
    }
    if (g.br && g.zone) {
      const Z = g.zone;
      const useNext = Z.state !== 'wait' || Z.t < 20;
      if (Math.random() < 0.7) return this.zonePoint(useNext);
    }
    // head toward pickups when low on gadgets
    const low = p.inv.flash + p.inv.smoke + p.inv.distract <= 1;
    if (low && Math.random() < 0.6) {
      const act = g.pickups.filter(pk => pk.active);
      if (act.length) { const pk = act[Math.floor(Math.random() * act.length)]; return [pk.x, pk.z]; }
    }
    // toward the last place we saw someone, or anywhere
    let recent = null;
    for (const k of this.know.values()) if (g.time - k.seenT < 12 && (!recent || k.seenT > recent.seenT)) recent = k;
    if (recent && Math.random() < this.aggression) return [recent.x + rand(-4, 4), recent.z + rand(-4, 4)];
    const [x, z] = g.world.randomNavPoint();
    return [x, z];
  }

  coverFrom(e) {
    const g = this.g, p = this.p;
    let best = null, bestS = -1e9;
    for (let k = 0; k < 14; k++) {
      const a = Math.random() * Math.PI * 2, r = rand(3, 10);
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      const i = g.world.navIndex(x, z);
      if (i < 0 || g.world.navWall[i] || !g.world.navReach[i]) continue;
      const y = g.world.navH[i];
      const hidden = g.world.segmentBlocked(e.x, e.y + 1.6, e.z, x, y + 1.5, z, true);
      const away = Math.hypot(x - e.x, z - e.z) - Math.hypot(p.x - e.x, p.z - e.z);
      const s = (hidden ? 20 : 0) + away - r * 0.6;
      if (s > bestS) { bestS = s; best = [x, z]; }
    }
    return best || [p.x + (p.x - e.x), p.z + (p.z - e.z)];
  }

  tryGadget(type, target, dist) {
    const g = this.g, p = this.p, d = this.d;
    if (p.inv[type] <= 0 || this.cooldown[type] > 0) return false;
    if (Math.random() > d.gadget) return false;
    let yaw = p.yaw;
    if (target) yaw = Math.atan2(-(target.x - p.x), -(target.z - p.z));
    else if (type === 'distract') yaw += rand(-1.2, 1.2) + Math.PI * (Math.random() < 0.5 ? 1 : 0);
    if (type === 'smoke' && target) dist = clamp(dist, 3, 8);
    if (type === 'flash' && (dist < 6 || dist > 26)) return false;
    const v = CFG.throwSpeed, G = CFG.grenadeGravity;
    const th = 0.5 * Math.asin(clamp(dist * G / (v * v), 0, 1));
    g.throwGadget(p.id, type, { yaw: yaw + rand(-0.06, 0.06), pitch: th - 0.14 });
    this.cooldown[type] = rand(6, 12);
    if (type === 'flash') { this.avertT = 1.4; this.avertYaw = yaw + Math.PI; }
    return true;
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const g = this.g, p = this.p, d = this.d, now = g.time;
    for (const k in this.cooldown) this.cooldown[k] -= dt;
    if (this.panicT > 0) this.panicT -= dt;
    if (this.avertT > 0) this.avertT -= dt;
    this.repathT -= dt;
    this.percT -= dt;
    if (this.percT <= 0) { this.perceive(0.1); this.percT = 0.1; }
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.think(); this.thinkT = 0.25 + Math.random() * 0.1; }

    // typing
    if (this.typing) {
      const T = this.typing, tgt = g.players.get(T.id);
      if (!tgt || !tgt.alive || p.jam > 0) this.typing = null;
      else {
        T.t -= dt;
        if (T.t <= 0) {
          if (T.i < T.code.length - 1) { T.i++; T.t = (d.msPerDigit / 1000) * rand(0.7, 1.3) * this.jit; }
          else {
            // good players hold the last digit until the target is actually in view
            const vis = this.visible.some(v => v.e.id === T.id);
            if (!vis && T.wait < (d.reaction < 0.4 ? 1.6 : 0.4)) { T.wait += dt; }
            else { g.tryKill(p.id, T.code, (now - T.start) * 1000); this.typing = null; this.thinkT = 0.15; }
          }
        }
        if (this.typing) this.target = tgt;
      }
    }

    // where to look
    let lx = null, ly = null, lz = null;
    if (this.avertT > 0) {
      lx = p.x - Math.sin(this.avertYaw) * 10; ly = p.y + 1.6; lz = p.z - Math.cos(this.avertYaw) * 10;
    } else if (this.typing && this.target) {
      const [hx, hy, hz] = g.forehead(this.target); lx = hx; ly = hy; lz = hz;
    } else if (this.distractPos) {
      [lx, ly, lz] = this.distractPos;
    } else if (this.state === 'evade' && this.evadeFrom) {
      // turn the note away from whoever is reading us
      const e = this.evadeFrom;
      lx = p.x + (p.x - e.x); ly = p.y + 1.6; lz = p.z + (p.z - e.z);
    } else if ((this.state === 'study' || this.state === 'scope' || this.state === 'flank') && this.target && this.target.alive) {
      const [hx, hy, hz] = g.forehead(this.target); lx = hx; ly = hy; lz = hz;
    } else if (this.lookAt && this.state === 'chase') {
      [lx, ly, lz] = this.lookAt;
    }

    // movement goal
    let mx = 0, mz = 0;
    if (this.panicT > 0) {
      mx = Math.sin(now * 3 + p.id) ; mz = Math.cos(now * 2.3 + p.id);
    } else if (this.state === 'scope') {
      // stand still-ish while looking through binoculars
    } else if (this.goal && !(this.typing && Math.random() < 0.02)) {
      if (!this.path || this.repathT <= 0) {
        this.path = g.world.findPath(p.x, p.z, this.goal[0], this.goal[1]);
        this.pathI = 0; this.repathT = 1.5 + Math.random();
        if (!this.path) { this.goal = null; this.stateT = 0; }
      }
      if (this.path) {
        // skip ahead along the path when we can walk straight there
        for (let k = Math.min(this.path.length - 1, this.pathI + 5); k > this.pathI; k--) {
          if (g.world.walkable(p.x, p.z, this.path[k][0], this.path[k][1])) { this.pathI = k; break; }
        }
        const wp = this.path[this.pathI];
        if (wp) {
          const dx = wp[0] - p.x, dz = wp[1] - p.z, dist = Math.hypot(dx, dz);
          if (dist < 0.6 && this.pathI < this.path.length - 1) this.pathI++;
          else if (dist < 0.6) { this.path = null; this.goal = this.state === 'roam' ? null : this.goal; }
          if (dist > 0.01) { mx = dx / dist; mz = dz / dist; }
          if (wp[2] - p.y > 0.55 && dist < 1.6 && p.onGround) this.jumpReq = true;
        }
      }
    }
    // close-range dance while typing / studying
    if ((this.typing || this.state === 'study') && this.target) {
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafe = Math.random() < 0.3 ? 0 : (Math.random() < 0.5 ? -1 : 1); this.strafeT = rand(0.5, 1.4); }
      const tx = this.target.x - p.x, tz = this.target.z - p.z, L = Math.hypot(tx, tz) || 1;
      const sx = -tz / L * this.strafe, sz = tx / L * this.strafe;
      const want = this.d.readRange * 0.55;
      const radial = L > want * 1.4 ? 0.7 : L < want * 0.5 ? -0.6 : 0;
      if (!this.goal || this.typing) { mx = sx * 0.7 + tx / L * radial; mz = sz * 0.7 + tz / L * radial; }
    }

    // look: default is where we walk, with a little idle scan
    if (lx === null) {
      if (mx || mz) { lx = p.x + mx * 10; lz = p.z + mz * 10; ly = p.y + 1.6; }
      else { this.idleYaw += dt * 0.7; lx = p.x - Math.sin(p.yaw + Math.sin(this.idleYaw) * 0.6) * 10; lz = p.z - Math.cos(p.yaw + Math.sin(this.idleYaw) * 0.6) * 10; ly = p.y + 1.6; }
    }
    const ex = p.x, ey = p.y + 1.6, ez = p.z;
    const wantYaw = Math.atan2(-(lx - ex), -(lz - ez));
    const wantPitch = Math.atan2(ly - ey, Math.hypot(lx - ex, lz - ez));
    const turn = d.turn * (this.typing ? 1.2 : 1) * dt;
    p.yaw += clamp(angDiff(p.yaw, wantYaw), -turn, turn);
    p.pitch += clamp(wantPitch - p.pitch, -turn, turn);
    p.pitch = clamp(p.pitch, -1.2, 1.2);

    // stuck detection
    const moved = Math.hypot(p.x - this.lastX, p.z - this.lastZ);
    if ((mx || mz) && moved < 0.5 * dt) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt);
    this.lastX = p.x; this.lastZ = p.z;
    if (this.stuckT > 0.8) { this.jumpReq = true; this.path = null; this.repathT = 0; if (this.stuckT > 2.2) { this.goal = g.world.randomNavPoint(); this.stuckT = 0; } }

    // convert world move direction into input relative to our facing
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    const fwd = mx * -sy + mz * -cy, right = mx * cy + mz * -sy;
    const jump = this.jumpReq; this.jumpReq = false;
    const slow = this.typing ? 0.55 : 1;
    return {
      fwd: fwd * slow, right: right * slow, jump,
      sprint: this.sprint && !this.typing && this.state !== 'study',
      crouch: (this.crouch && this.state === 'evade') || (this.state === 'scope' && this.crouch),
      zoom: this.zoom && this.state === 'scope' || (this.zoom && this.typing),
    };
  }
}
