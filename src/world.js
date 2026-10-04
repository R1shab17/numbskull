// World physics: collision boxes, character movement, line-of-sight and the bot
// navigation grid. No rendering in here, so the host simulation stays lean.
import { CFG } from './config.js';

const CELL = 4; // broadphase cell size (m)

export class World {
  constructor(map) {
    this.map = map;
    this.W = map.width; this.D = map.depth;
    this.hw = map.width / 2; this.hd = map.depth / 2;
    this.boxes = [];
    for (const b of map.boxes) this.addBox(b.x - b.w / 2, b.y0, b.z - b.d / 2, b.x + b.w / 2, b.y0 + b.h, b.z + b.d / 2, b);
    for (const t of map.trees || []) this.addBox(t.x - 0.35, 0, t.z - 0.35, t.x + 0.35, 3.4, t.z + 0.35, { kind: 'tree' });
    for (const d of map.decor || []) {
      if (d.type === 'lamp') this.addBox(d.x - 0.15, 0, d.z - 0.15, d.x + 0.15, 4.2, d.z + 0.15, { kind: 'lamp' });
      if (d.type === 'forklift') this.addBox(d.x - 1.3, 0, d.z - 0.8, d.x + 1.3, 1.6, d.z + 0.8, { kind: 'forklift' });
      if (d.type === 'statue') this.addBox(d.x - 0.9, d.y, d.z - 0.9, d.x + 0.9, d.y + 2.6, d.z + 0.9, { kind: 'statue' });
    }
    this.smokes = [];
    this._stamp = 1;
    this._seen = new Int32Array(this.boxes.length);
    this.buildBroadphase();
    this.buildNav();
  }

  addBox(minX, minY, minZ, maxX, maxY, maxZ, src) {
    this.boxes.push({ minX, minY, minZ, maxX, maxY, maxZ, src });
  }

  buildBroadphase() {
    this.gx = Math.ceil((this.W + 8) / CELL);
    this.gz = Math.ceil((this.D + 8) / CELL);
    this.ox = -this.hw - 4; this.oz = -this.hd - 4;
    this.cells = Array.from({ length: this.gx * this.gz }, () => []);
    this.boxes.forEach((b, i) => {
      const x0 = this.cx(b.minX), x1 = this.cx(b.maxX), z0 = this.cz(b.minZ), z1 = this.cz(b.maxZ);
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.cells[x + z * this.gx].push(i);
    });
  }
  cx(x) { return Math.max(0, Math.min(this.gx - 1, Math.floor((x - this.ox) / CELL))); }
  cz(z) { return Math.max(0, Math.min(this.gz - 1, Math.floor((z - this.oz) / CELL))); }

  // Collect boxes overlapping an XZ rectangle into `out` (deduplicated).
  query(minX, minZ, maxX, maxZ, out) {
    out.length = 0;
    const st = ++this._stamp;
    const x0 = this.cx(minX), x1 = this.cx(maxX), z0 = this.cz(minZ), z1 = this.cz(maxZ);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const c = this.cells[x + z * this.gx];
      for (let k = 0; k < c.length; k++) {
        const i = c[k];
        if (this._seen[i] === st) continue;
        this._seen[i] = st;
        out.push(this.boxes[i]);
      }
    }
    return out;
  }

  // Highest surface at a point (0 = ground).
  heightAt(x, z) {
    let h = 0;
    const list = this.query(x, z, x, z, this._tmpA || (this._tmpA = []));
    for (const b of list) if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && b.maxY > h) h = b.maxY;
    return h;
  }

  // Highest surface under a circle whose top is at or below maxY.
  groundAt(x, z, r, maxY) {
    let g = 0;
    const list = this.query(x - r, z - r, x + r, z + r, this._tmpB || (this._tmpB = []));
    for (const b of list) {
      if (b.maxY > maxY + 1e-4 || b.maxY <= g) continue;
      const qx = x < b.minX ? b.minX : x > b.maxX ? b.maxX : x;
      const qz = z < b.minZ ? b.minZ : z > b.maxZ ? b.maxZ : z;
      const dx = x - qx, dz = z - qz;
      if (dx * dx + dz * dz < r * r) g = b.maxY;
    }
    return g;
  }

  // Character controller: c = { x,y,z, vx,vy,vz, onGround, crouch }
  moveCharacter(c, dt) {
    const r = CFG.radius, step = CFG.stepHeight;
    const h = c.crouch ? CFG.crouchHeight : CFG.standHeight;
    const dist = Math.hypot(c.vx, c.vz) * dt;
    const n = Math.max(1, Math.ceil(dist / 0.25));
    const sdt = dt / n;
    const list = this._tmpC || (this._tmpC = []);
    for (let s = 0; s < n; s++) {
      c.x += c.vx * sdt; c.z += c.vz * sdt;
      for (let iter = 0; iter < 2; iter++) {
        this.query(c.x - r - 0.1, c.z - r - 0.1, c.x + r + 0.1, c.z + r + 0.1, list);
        for (const b of list) {
          if (b.maxY <= c.y + step || b.minY >= c.y + h) continue;
          const qx = c.x < b.minX ? b.minX : c.x > b.maxX ? b.maxX : c.x;
          const qz = c.z < b.minZ ? b.minZ : c.z > b.maxZ ? b.maxZ : c.z;
          let dx = c.x - qx, dz = c.z - qz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          if (d2 > 1e-10) {
            const d = Math.sqrt(d2), push = r - d;
            c.x += dx / d * push; c.z += dz / d * push;
            // kill velocity into the wall
            const nx = dx / d, nz = dz / d, vn = c.vx * nx + c.vz * nz;
            if (vn < 0) { c.vx -= vn * nx; c.vz -= vn * nz; }
          } else {
            // centre inside the box: push out along the shallowest axis
            const pl = c.x - b.minX, pr = b.maxX - c.x, pb = c.z - b.minZ, pf = b.maxZ - c.z;
            const m = Math.min(pl, pr, pb, pf);
            if (m === pl) c.x = b.minX - r; else if (m === pr) c.x = b.maxX + r;
            else if (m === pb) c.z = b.minZ - r; else c.z = b.maxZ + r;
          }
        }
      }
    }
    // keep inside the arena
    c.x = Math.max(-this.hw + r, Math.min(this.hw - r, c.x));
    c.z = Math.max(-this.hd + r, Math.min(this.hd - r, c.z));

    // vertical
    const wasGround = c.onGround;
    c.vy -= CFG.gravity * dt;
    if (c.vy < -40) c.vy = -40;
    const ny = c.y + c.vy * dt;
    const ground = this.groundAt(c.x, c.z, r * 0.92, c.y + step);
    c.landed = 0;
    if (c.vy <= 0) {
      if (ny <= ground) {
        if (!wasGround) c.landed = -c.vy;
        c.y = ground; c.vy = 0; c.onGround = true;
      } else if (wasGround && c.y - ground <= step + 0.05) {
        c.y = ground; c.vy = 0; c.onGround = true;
      } else { c.y = ny; c.onGround = false; }
    } else {
      c.y = Math.max(ny, ground);
      c.onGround = false;
    }
    if (c.y < -10) { c.y = 5; c.vy = 0; }
  }

  // Is the straight segment a -> b blocked by geometry (or smoke)?
  segmentBlocked(ax, ay, az, bx, by, bz, withSmoke = true) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const list = this.query(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), this._tmpD || (this._tmpD = []));
    const ex = Math.abs(dx) < 1e-9, ey = Math.abs(dy) < 1e-9, ez = Math.abs(dz) < 1e-9;
    for (const b of list) {
      let tmin = 0.001, tmax = 0.999, t1, t2;
      if (ex) { if (ax <= b.minX || ax >= b.maxX) continue; }
      else { t1 = (b.minX - ax) / dx; t2 = (b.maxX - ax) / dx; if (t1 > t2) { const q = t1; t1 = t2; t2 = q; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) continue; }
      if (ey) { if (ay <= b.minY || ay >= b.maxY) continue; }
      else { t1 = (b.minY - ay) / dy; t2 = (b.maxY - ay) / dy; if (t1 > t2) { const q = t1; t1 = t2; t2 = q; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) continue; }
      if (ez) { if (az <= b.minZ || az >= b.maxZ) continue; }
      else { t1 = (b.minZ - az) / dz; t2 = (b.maxZ - az) / dz; if (t1 > t2) { const q = t1; t1 = t2; t2 = q; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) continue; }
      return true;
    }
    if (withSmoke && this.smokes.length) return this.smokeBlocks(ax, ay, az, bx, by, bz);
    return false;
  }

  smokeBlocks(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const L2 = dx * dx + dy * dy + dz * dz || 1e-6;
    for (const s of this.smokes) {
      const r = s.r;
      if (r <= 0.3) continue;
      let t = ((s.x - ax) * dx + (s.y - ay) * dy + (s.z - az) * dz) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t - s.x, py = ay + dy * t - s.y, pz = az + dz * t - s.z;
      if (px * px + py * py * 1.6 + pz * pz < r * r * 0.82) return true;
    }
    return false;
  }

  // Ray cast for projectiles. Returns { t, nx, ny, nz } of the first hit within maxT, or null.
  raycast(ax, ay, az, dx, dy, dz, maxT) {
    const bx = ax + dx * maxT, bz = az + dz * maxT;
    const list = this.query(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), this._tmpE || (this._tmpE = []));
    let best = null;
    const test = (minX, minY, minZ, maxX, maxY, maxZ) => {
      let tmin = -Infinity, tmax = Infinity, n = 0;
      const axes = [[ax, dx, minX, maxX, 0], [ay, dy, minY, maxY, 1], [az, dz, minZ, maxZ, 2]];
      for (const [o, d, lo, hi, k] of axes) {
        if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return; continue; }
        let t1 = (lo - o) / d, t2 = (hi - o) / d, sgn = -1;
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; sgn = 1; }
        if (t1 > tmin) { tmin = t1; n = (k + 1) * sgn; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return;
      }
      if (tmin >= 0 && tmin <= maxT && (!best || tmin < best.t)) {
        const k = Math.abs(n) - 1, s = Math.sign(n);
        best = { t: tmin, nx: k === 0 ? s : 0, ny: k === 1 ? s : 0, nz: k === 2 ? s : 0 };
      }
    };
    for (const b of list) test(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ);
    // ground plane
    if (dy < 0) { const t = -ay / dy; if (t >= 0 && t <= maxT && (!best || t < best.t)) best = { t, nx: 0, ny: 1, nz: 0 }; }
    return best;
  }

  // ------------------------------------------------------------------ navigation
  buildNav() {
    const nx = this.nx = Math.round(this.W), nz = this.nz = Math.round(this.D);
    const N = nx * nz;
    const h = this.navH = new Float32Array(N);
    const wall = this.navWall = new Uint8Array(N);
    const list = [];
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const x0 = -this.hw + ix + 0.05, z0 = -this.hd + iz + 0.05, x1 = x0 + 0.9, z1 = z0 + 0.9;
      this.query(x0, z0, x1, z1, list);
      let top = 0;
      for (const b of list) if (b.maxX > x0 && b.minX < x1 && b.maxZ > z0 && b.minZ < z1 && b.maxY > top) top = b.maxY;
      h[ix + iz * nx] = top;
    }
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const i = ix + iz * nx;
      if (ix === 0 || iz === 0 || ix === nx - 1 || iz === nz - 1) { wall[i] = 1; continue; }
      const hi = h[i];
      if (h[i - 1] > hi + 0.6 || h[i + 1] > hi + 0.6 || h[i - nx] > hi + 0.6 || h[i + nx] > hi + 0.6) wall[i] = 1;
    }
    // reachable region: flood from the flags / centre
    const reach = this.navReach = new Uint8Array(N);
    const q = [];
    const seeds = [[0, 0]];
    for (const k of [1, 2]) if (this.map.flags[k]) seeds.push(this.map.flags[k]);
    for (const [sx, sz] of seeds) {
      const i = this.navIndex(sx, sz);
      if (i >= 0 && !reach[i]) { reach[i] = 1; q.push(i); }
    }
    while (q.length) {
      const i = q.pop();
      this.forNeighbors(i, (j) => { if (!reach[j]) { reach[j] = 1; q.push(j); } });
    }
    this.navCells = [];
    for (let i = 0; i < N; i++) if (reach[i] && !wall[i]) this.navCells.push(i);
    // A* scratch
    this._g = new Float32Array(N); this._f = new Float32Array(N);
    this._par = new Int32Array(N); this._open = new Int32Array(N); this._closed = new Int32Array(N);
    this._astamp = 0;
    this._heap = new Int32Array(N + 1);
  }

  navIndex(x, z) {
    const ix = Math.floor(x + this.hw), iz = Math.floor(z + this.hd);
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return -1;
    return ix + iz * this.nx;
  }
  navCenter(i) { return [-this.hw + (i % this.nx) + 0.5, -this.hd + Math.floor(i / this.nx) + 0.5]; }

  edgeCost(i, j) {
    const dh = this.navH[j] - this.navH[i];
    if (dh > 1.15) return -1;           // too high to jump
    if (dh < -4.6) return -1;           // too far to drop (we allow it, but bots avoid)
    let c = 1;
    if (dh > 0.6) c = 3.5;              // needs a jump
    else if (dh < -0.6) c = 1.4;
    if (this.navWall[j]) c += 1.6;
    return c;
  }

  forNeighbors(i, fn) {
    const nx = this.nx, ix = i % nx, iz = (i - ix) / nx;
    const ok = [false, false, false, false];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let k = 0; k < 4; k++) {
      const jx = ix + dirs[k][0], jz = iz + dirs[k][1];
      if (jx < 0 || jz < 0 || jx >= nx || jz >= this.nz) continue;
      const j = jx + jz * nx;
      const c = this.edgeCost(i, j);
      if (c > 0) { ok[k] = true; fn(j, c); }
    }
    const diag = [[1, 1, 0, 2], [1, -1, 0, 3], [-1, 1, 1, 2], [-1, -1, 1, 3]];
    for (const [dx, dz, a, b] of diag) {
      if (!ok[a] || !ok[b]) continue;
      const j = (ix + dx) + (iz + dz) * nx;
      const dh = this.navH[j] - this.navH[i];
      if (Math.abs(dh) > 0.6) continue;
      const c = this.edgeCost(i, j);
      if (c > 0) fn(j, c * 1.414);
    }
  }

  // A* from world pos to world pos. Returns array of [x, z] waypoints (cell centres) or null.
  findPath(sx, sz, tx, tz, maxIter = 6000) {
    let s = this.navIndex(sx, sz), t = this.navIndex(tx, tz);
    if (s < 0 || t < 0) return null;
    if (this.navWall[t] || !this.navReach[t]) t = this.nearestFree(t);
    if (t < 0) return null;
    const st = ++this._astamp;
    const g = this._g, f = this._f, par = this._par, open = this._open, closed = this._closed, heap = this._heap;
    let hn = 0;
    const nx = this.nx;
    const tX = t % nx, tZ = (t - tX) / nx;
    const H = (i) => { const x = i % nx, z = (i - x) / nx, dx = Math.abs(x - tX), dz = Math.abs(z - tZ); return dx + dz - 0.586 * Math.min(dx, dz); };
    const push = (i) => { let k = ++hn; heap[k] = i; while (k > 1 && f[heap[k >> 1]] > f[heap[k]]) { const p = k >> 1, tmp = heap[p]; heap[p] = heap[k]; heap[k] = tmp; k = p; } };
    const pop = () => { const top = heap[1]; heap[1] = heap[hn--]; let k = 1; for (;;) { const l = k * 2, r = l + 1; let m = k; if (l <= hn && f[heap[l]] < f[heap[m]]) m = l; if (r <= hn && f[heap[r]] < f[heap[m]]) m = r; if (m === k) break; const tmp = heap[m]; heap[m] = heap[k]; heap[k] = tmp; k = m; } return top; };
    g[s] = 0; f[s] = H(s); par[s] = -1; open[s] = st; push(s);
    let iter = 0, found = false;
    while (hn > 0 && iter++ < maxIter) {
      const i = pop();
      if (closed[i] === st) continue;
      closed[i] = st;
      if (i === t) { found = true; break; }
      const gi = g[i];
      this.forNeighbors(i, (j, c) => {
        if (closed[j] === st) return;
        const ng = gi + c;
        if (open[j] !== st || ng < g[j]) {
          open[j] = st; g[j] = ng; f[j] = ng + H(j) * 1.05; par[j] = i; push(j);
        }
      });
    }
    if (!found) return null;
    const path = [];
    for (let i = t; i !== -1; i = par[i]) { const [x, z] = this.navCenter(i); path.push([x, z, this.navH[i]]); }
    path.reverse();
    return path;
  }

  nearestFree(i) {
    if (i < 0) return -1;
    const nx = this.nx, ix = i % nx, iz = (i - ix) / nx;
    for (let r = 1; r < 8; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = ix + dx, z = iz + dz;
        if (x < 0 || z < 0 || x >= nx || z >= this.nz) continue;
        const j = x + z * nx;
        if (this.navReach[j] && !this.navWall[j]) return j;
      }
    }
    return -1;
  }

  // Can a character walk straight from a to b without jumping? (path smoothing)
  walkable(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    const n = Math.ceil(L / 0.45);
    let prev = this.navIndex(ax, az);
    if (prev < 0) return false;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      // test the centre line and both shoulders of the character
      const px = ax + dx * t, pz = az + dz * t;
      const i = this.navIndex(px, pz);
      if (i < 0 || this.navWall[i]) return false;
      const dh = this.navH[i] - this.navH[prev];
      if (dh > 0.55 || dh < -0.6) return false;
      prev = i;
    }
    return true;
  }

  randomNavPoint(rng = Math.random) {
    const i = this.navCells[Math.floor(rng() * this.navCells.length)];
    const [x, z] = this.navCenter(i);
    return [x, z, this.navH[i]];
  }
}
