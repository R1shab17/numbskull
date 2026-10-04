// Visual effects: confetti, smoke clouds, flash bursts, distract beacons, grenades.
import * as THREE from 'three';
import { noteTexture } from './scene.js';

function softTex(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, inner); grd.addColorStop(0.55, inner.replace(/[\d.]+\)$/, '0.55)')); grd.addColorStop(1, outer);
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const CONFETTI_MAX = 900;
const CONFETTI_COLORS = ['#ff5c7a', '#ffd43b', '#4dabf7', '#69db7c', '#b197fc', '#ff922b', '#ffffff'];

export class Effects {
  constructor(scene) {
    this.scene = scene;
    // confetti pool
    const geo = new THREE.PlaneGeometry(0.09, 0.14);
    this.confMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), CONFETTI_MAX);
    this.confMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.confMesh.frustumCulled = false;
    this.conf = [];
    for (let i = 0; i < CONFETTI_MAX; i++) {
      this.conf.push({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3() });
      this.confMesh.setColorAt(i, new THREE.Color('#ffffff'));
    }
    this.confNext = 0;
    scene.add(this.confMesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(1, 1, 1); this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < CONFETTI_MAX; i++) this.confMesh.setMatrixAt(i, this._zero);

    this.smokeTex = softTex('rgba(235,238,245,1)');
    this.glowTex = softTex('rgba(255,255,255,1)');
    this.rings = [];
    this.smokes = new Map();
    this.grenades = new Map();
    this.distracts = new Map();
    this.bursts = [];
    this.pickups = [];
  }

  confetti(x, y, z, n = 70, colors = CONFETTI_COLORS, speed = 5) {
    const col = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const i = this.confNext; this.confNext = (this.confNext + 1) % CONFETTI_MAX;
      const c = this.conf[i];
      c.life = 1.6 + Math.random() * 1.2;
      c.p.set(x + (Math.random() - 0.5) * 0.3, y + (Math.random() - 0.5) * 0.3, z + (Math.random() - 0.5) * 0.3);
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2 + 0.2;
      const sp = speed * (0.4 + Math.random() * 0.8);
      c.v.set(Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 2, Math.sin(a) * Math.cos(e) * sp);
      c.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      c.w.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16);
      this.confMesh.setColorAt(i, col.set(colors[Math.floor(Math.random() * colors.length)]));
    }
    this.confMesh.instanceColor.needsUpdate = true;
  }

  ring(x, y, z, color = '#ffffff', size = 2.5, life = 0.45) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.8, 32), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    m.position.set(x, y, z);
    m.rotation.x = -Math.PI / 2;
    this.scene.add(m);
    this.rings.push({ m, t: 0, life, size });
  }

  poof(x, y, z, color) {
    this.confetti(x, y, z, 80);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: color || '#ffffff', transparent: true, depthWrite: false }));
    s.position.set(x, y, z); s.scale.setScalar(0.5);
    this.scene.add(s);
    this.bursts.push({ s, t: 0, life: 0.45, from: 0.5, to: 3.2 });
  }

  flashBurst(x, y, z) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: '#ffffff', transparent: true, depthWrite: false, depthTest: false, fog: false }));
    s.position.set(x, y, z); s.scale.setScalar(1);
    this.scene.add(s);
    this.bursts.push({ s, t: 0, life: 0.6, from: 2, to: 16 });
    this.ring(x, 0.05, z, '#ffffff', 10, 0.5);
  }

  pickupFx(x, y, z) {
    this.confetti(x, y, z, 24, ['#7ef0c8', '#ffffff', '#ffe45c'], 3);
    this.ring(x, y - 0.4, z, '#7ef0c8', 3, 0.4);
  }

  grenadeMesh(type) {
    const g = new THREE.Group();
    if (type === 'flash') {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.2, 10), new THREE.MeshLambertMaterial({ color: '#dfe6ee' }));
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 8), new THREE.MeshBasicMaterial({ color: '#ffd84d' })); c.position.y = 0.12;
      g.add(b, c);
    } else if (type === 'smoke') {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.22, 10), new THREE.MeshLambertMaterial({ color: '#7cc47a' }));
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 8), new THREE.MeshLambertMaterial({ color: '#333' })); c.position.y = 0.13;
      g.add(b, c);
    } else {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), new THREE.MeshLambertMaterial({ color: '#ff6bcb' }));
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.18, 4), new THREE.MeshBasicMaterial({ color: '#222' })); ant.position.y = 0.15;
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), new THREE.MeshBasicMaterial({ color: '#ffe45c' })); tip.position.y = 0.25;
      g.add(b, ant, tip);
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  // keep visuals in sync with the simulation lists
  syncGrenades(list) {
    const alive = new Set();
    for (const gr of list) {
      alive.add(gr.id);
      let m = this.grenades.get(gr.id);
      if (!m) { m = this.grenadeMesh(gr.type); this.scene.add(m); this.grenades.set(gr.id, m); }
      m.position.set(gr.x, gr.y, gr.z);
      m.rotation.x += 0.2; m.rotation.z += 0.13;
    }
    for (const [id, m] of this.grenades) if (!alive.has(id)) { this.scene.remove(m); this.grenades.delete(id); }
  }

  syncSmokes(list, dt) {
    const alive = new Set();
    for (const s of list) {
      alive.add(s.id);
      let v = this.smokes.get(s.id);
      if (!v) {
        v = { g: new THREE.Group(), puffs: [] };
        const n = 34;
        for (let i = 0; i < n; i++) {
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, color: new THREE.Color().setHSL(0.6, 0.08, 0.82 + Math.random() * 0.12), transparent: true, depthWrite: false, opacity: 0 }));
          const dir = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.3) * 0.7, Math.random() - 0.5).normalize().multiplyScalar(Math.pow(Math.random(), 0.6));
          sp.userData = { dir, size: 2.6 + Math.random() * 2.4, spin: (Math.random() - 0.5) * 0.4 };
          v.g.add(sp); v.puffs.push(sp);
        }
        v.g.position.set(s.x, s.y, s.z);
        this.scene.add(v.g);
        this.smokes.set(s.id, v);
      }
      const k = s.r / s.maxR;
      const fade = s.life - s.t < 2 ? Math.max(0, (s.life - s.t) / 2) : 1;
      for (const p of v.puffs) {
        const d = p.userData;
        p.position.copy(d.dir).multiplyScalar(s.maxR * 0.85 * k);
        p.position.y += 0.4 * k;
        const sz = d.size * (0.35 + 0.65 * k);
        p.scale.set(sz, sz, 1);
        p.material.opacity = 0.92 * fade * Math.min(1, k * 2);
        p.material.rotation += d.spin * dt;
      }
    }
    for (const [id, v] of this.smokes) if (!alive.has(id)) { this.scene.remove(v.g); v.puffs.forEach(p => p.material.dispose()); this.smokes.delete(id); }
  }

  syncDistracts(list, time) {
    const alive = new Set();
    for (const d of list) {
      alive.add(d.id);
      let v = this.distracts.get(d.id);
      if (!v) {
        const g = new THREE.Group();
        // two single-sided planes back to back, so the fake number reads correctly from both sides
        const holo = new THREE.Group();
        const hm = new THREE.MeshBasicMaterial({ map: noteTexture(d.fake || '????', { paper: '#ff7ad9' }), transparent: true, opacity: 0.88, depthWrite: false });
        const front = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), hm);
        const back = front.clone(); back.rotation.y = Math.PI;
        holo.add(front, back);
        holo.position.y = 2.2;
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.4, 2.0, 12, 1, true), new THREE.MeshBasicMaterial({ color: '#ff7ad9', transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
        beam.position.y = 1.0;
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: '#ff7ad9', transparent: true, depthWrite: false }));
        glow.scale.setScalar(2.2); glow.position.y = 0.2;
        g.add(holo, beam, glow);
        g.position.set(d.x, d.y, d.z);
        this.scene.add(g);
        v = { g, holo, glow };
        this.distracts.set(d.id, v);
      }
      v.holo.rotation.y = time * 2.4;
      v.holo.position.y = 2.2 + Math.sin(time * 4) * 0.15;
      const pulse = 0.5 + 0.5 * Math.sin(time * 14);
      v.glow.scale.setScalar(1.6 + pulse * 1.6);
      v.glow.material.opacity = 0.5 + pulse * 0.5;
    }
    for (const [id, v] of this.distracts) if (!alive.has(id)) { this.ring(v.g.position.x, v.g.position.y + 0.1, v.g.position.z, '#ff7ad9', 4, 0.4); this.scene.remove(v.g); this.distracts.delete(id); }
  }

  update(dt) {
    const m = this._m, q = this._q;
    let any = false;
    for (let i = 0; i < CONFETTI_MAX; i++) {
      const c = this.conf[i];
      if (c.life <= 0) continue;
      any = true;
      c.life -= dt;
      if (c.life <= 0) { this.confMesh.setMatrixAt(i, this._zero); continue; }
      c.v.y -= 9 * dt;
      c.v.multiplyScalar(1 - 1.6 * dt);
      c.p.addScaledVector(c.v, dt);
      if (c.p.y < 0.02) { c.p.y = 0.02; c.v.set(0, 0, 0); c.w.multiplyScalar(0.9); }
      c.r.x += c.w.x * dt; c.r.y += c.w.y * dt; c.r.z += c.w.z * dt;
      q.setFromEuler(c.r);
      const s = Math.min(1, c.life * 2);
      this._s.set(s, s, s);
      m.compose(c.p, q, this._s);
      this.confMesh.setMatrixAt(i, m);
    }
    if (any || this._wasAny) this.confMesh.instanceMatrix.needsUpdate = true;
    this._wasAny = any;

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / r.life;
      r.m.scale.setScalar(1 + k * r.size);
      r.m.material.opacity = 1 - k;
      if (k >= 1) { this.scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); this.rings.splice(i, 1); }
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.t += dt;
      const k = b.t / b.life;
      b.s.scale.setScalar(b.from + (b.to - b.from) * Math.sqrt(k));
      b.s.material.opacity = 1 - k;
      if (k >= 1) { this.scene.remove(b.s); b.s.material.dispose(); this.bursts.splice(i, 1); }
    }
  }

  clear() {
    for (const [, m] of this.grenades) this.scene.remove(m);
    for (const [, v] of this.smokes) this.scene.remove(v.g);
    for (const [, v] of this.distracts) this.scene.remove(v.g);
    this.grenades.clear(); this.smokes.clear(); this.distracts.clear();
  }
}
