// Builds the three.js scene for a map: merged box geometry, ground, sky, lights,
// scenery outside the walls, decorations, flags and pickups.
import * as THREE from 'three';

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function canvasTex(size, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function noise(g, s, amount, rnd, cell = 2) {
  for (let y = 0; y < s; y += cell) for (let x = 0; x < s; x += cell) {
    const v = (rnd() - 0.5) * amount;
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    g.fillRect(x, y, cell, cell);
  }
}

export function makeTextures() {
  const rnd = seeded(7);
  const T = {};
  T.block = canvasTex(128, (g, s) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
    noise(g, s, 0.05, rnd, 4);
    g.strokeStyle = 'rgba(40,20,60,0.16)'; g.lineWidth = 4; g.strokeRect(2, 2, s - 4, s - 4);
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2; g.strokeRect(7, 7, s - 14, s - 14);
  });
  T.crate = canvasTex(128, (g, s) => {
    g.fillStyle = '#f2e3d0'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#e7d2b8' : '#efdcc4'; g.fillRect(0, i * 32, s, 32); g.fillStyle = 'rgba(80,40,10,0.25)'; g.fillRect(0, i * 32, s, 2); }
    noise(g, s, 0.06, rnd, 2);
    g.strokeStyle = 'rgba(90,45,15,0.55)'; g.lineWidth = 10; g.strokeRect(5, 5, s - 10, s - 10);
    g.beginPath(); g.moveTo(10, 10); g.lineTo(s - 10, s - 10); g.lineWidth = 9; g.stroke();
  });
  T.hedge = canvasTex(128, (g, s) => {
    g.fillStyle = '#d9d9d9'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 260; i++) {
      const x = rnd() * s, y = rnd() * s, r = 3 + rnd() * 7;
      g.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,30,0'},${0.12 + rnd() * 0.2})`;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  });
  T.cardboard = canvasTex(128, (g, s) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
    noise(g, s, 0.07, rnd, 2);
    g.fillStyle = 'rgba(255,240,200,0.55)'; g.fillRect(s / 2 - 12, 0, 24, s);
    g.strokeStyle = 'rgba(70,40,10,0.25)'; g.lineWidth = 3; g.strokeRect(1, 1, s - 2, s - 2);
    g.fillStyle = 'rgba(40,20,0,0.35)'; g.font = 'bold 16px sans-serif'; g.fillText('↑↑', 12, 30);
  });
  T.shelf = canvasTex(128, (g, s) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
    g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(0, s * 0.42, s, s * 0.5);
    const cols = ['#e6b98a', '#d9a066', '#f0cfa0', '#c98f55'];
    for (let i = 0; i < 4; i++) { g.fillStyle = cols[(i * 3) % 4]; g.fillRect(6 + i * 30, s * 0.5, 24, s * 0.4); }
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(0, 0, s, 6); g.fillRect(0, s * 0.42, s, 5);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, 6, s); g.fillRect(s - 6, 0, 6, s);
  });
  T.grass = canvasTex(256, (g, s) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
    noise(g, s, 0.08, rnd, 4);
    for (let i = 0; i < 500; i++) {
      const x = rnd() * s, y = rnd() * s;
      g.strokeStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,40,0'},${0.15 + rnd() * 0.15})`;
      g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 4, y - 4 - rnd() * 5); g.stroke();
    }
  });
  T.concrete = canvasTex(256, (g, s) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
    noise(g, s, 0.06, rnd, 3);
    g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * s / 4, 0); g.lineTo(i * s / 4, s); g.stroke(); g.beginPath(); g.moveTo(0, i * s / 4); g.lineTo(s, i * s / 4); g.stroke(); }
  });
  return T;
}

// Build one merged mesh per texture kind, with world-scaled UVs and vertex colours.
function buildBoxes(map, T, quality) {
  const groups = {};
  const rnd = seeded(42);
  const col = new THREE.Color();
  for (const b of map.boxes) {
    const kind = b.kind || 'block';
    const g = groups[kind] || (groups[kind] = { pos: [], nor: [], uv: [], col: [], idx: [] });
    col.set(b.color);
    const tint = 1 + (rnd() - 0.5) * 0.06;
    const r = col.r * tint, gg = col.g * tint, bb = col.b * tint;
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, y0 = b.y0, y1 = b.y0 + b.h, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
    const shelfS = kind === 'shelf' ? 1.2 : 1;
    const faces = [
      // [normal], 4 corners (counter-clockwise from outside), uv axes
      [[1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], (p) => [-p[2], p[1]]],
      [[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], (p) => [p[2], p[1]]],
      [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], (p) => [p[0], p[1]]],
      [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], (p) => [-p[0], p[1]]],
      [[0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], (p) => [p[0], -p[2]]],
    ];
    const normalize = kind === 'crate' || kind === 'cardboard';
    for (const [n, corners, uvf] of faces) {
      const base = g.pos.length / 3;
      const shade = n[1] > 0 ? 1.0 : (n[0] !== 0 ? 0.93 : 0.87);
      const uvs = corners.map(uvf);
      if (normalize) {
        const us = uvs.map(q => q[0]), vs = uvs.map(q => q[1]);
        const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
        for (const q of uvs) { q[0] = (q[0] - u0) / (u1 - u0 || 1); q[1] = (q[1] - v0) / (v1 - v0 || 1); }
      }
      corners.forEach((p, k) => {
        g.pos.push(p[0], p[1], p[2]); g.nor.push(n[0], n[1], n[2]);
        g.uv.push(uvs[k][0], uvs[k][1] / shelfS);
        g.col.push(r * shade, gg * shade, bb * shade);
      });
      g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const meshes = [];
  for (const kind in groups) {
    const g = groups[kind];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(g.col, 3));
    geo.setIndex(g.idx);
    const mat = new THREE.MeshLambertMaterial({ map: T[kind] || T.block, vertexColors: true });
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = quality > 0; m.receiveShadow = quality > 0;
    meshes.push(m);
  }
  return meshes;
}

function skyDome(top, horizon, night) {
  const geo = new THREE.SphereGeometry(450, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(top) }, hor: { value: new THREE.Color(horizon) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 hor; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6+0.05,0.0,1.0); gl_FragColor = vec4(mix(hor, top, pow(h,0.8)),1.0); }',
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -10;
  return m;
}

function makeTree(rnd) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 2.2, 7), new THREE.MeshLambertMaterial({ color: '#8a5a3b' }));
  trunk.position.y = 1.1; trunk.castShadow = true; g.add(trunk);
  const greens = ['#5fbf4f', '#4fae5a', '#79c95b', '#3f9e58'];
  const n = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < n; i++) {
    const r = 1.5 - i * 0.35 + rnd() * 0.2;
    const f = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), new THREE.MeshLambertMaterial({ color: greens[Math.floor(rnd() * greens.length)], flatShading: true }));
    f.position.set((rnd() - 0.5) * 0.5, 2.5 + i * 1.05, (rnd() - 0.5) * 0.5);
    f.rotation.set(rnd() * 3, rnd() * 3, 0);
    f.castShadow = true;
    g.add(f);
  }
  return g;
}

export function noteTexture(text, opts = {}) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  drawNote(c.getContext('2d'), text, opts);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.userData.canvas = c;
  return t;
}

export function drawNote(g, text, opts = {}) {
  const w = g.canvas.width, h = g.canvas.height;
  g.clearRect(0, 0, w, h);
  g.fillStyle = opts.paper || '#ffe45c';
  g.fillRect(0, 0, w, h);
  // paper shading + tape
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, 'rgba(255,255,255,0.25)'); grd.addColorStop(1, 'rgba(0,0,0,0.10)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.save(); g.translate(w / 2, 6); g.rotate(-0.04); g.fillRect(-46, -10, 92, 22); g.restore();
  g.fillStyle = opts.ink || '#17141f';
  const len = String(text).length;
  const size = len <= 3 ? 118 : len === 4 ? 104 : len === 5 ? 86 : 70;
  g.font = `${size}px "Permanent Marker", "Marker Felt", "Comic Sans MS", cursive`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(text), w / 2, h / 2 + 10);
}

function signTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#120b24'; g.fillRect(0, 0, 512, 160);
  g.font = 'bold 96px "Dela Gothic One", Impact, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = color; g.shadowBlur = 28; g.fillStyle = color;
  g.fillText(text, 256, 86); g.fillText(text, 256, 86);
  g.shadowBlur = 0; g.fillStyle = '#ffffff'; g.globalAlpha = 0.65; g.fillText(text, 256, 86);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeStatue() {
  const g = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: '#cfc6b8' });
  const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.75, 0.5, 4, 10), stone);
  shoulders.rotation.z = Math.PI / 2; shoulders.position.y = 0.55; shoulders.scale.set(1, 1.3, 0.8);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.95, 20, 14), stone);
  head.position.y = 1.6;
  const note = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.7), new THREE.MeshBasicMaterial({ map: noteTexture('???') }));
  note.position.set(0, 1.95, 0.9); note.rotation.x = -0.28;
  const note2 = note.clone(); note2.position.z = -0.9; note2.rotation.set(0.28, Math.PI, 0);
  for (const m of [shoulders, head]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
  g.add(note, note2);
  return g;
}

function makeForklift() {
  const g = new THREE.Group();
  const y = new THREE.MeshLambertMaterial({ color: '#ffc21a' });
  const d = new THREE.MeshLambertMaterial({ color: '#2c2f3a' });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 1.4), y); body.position.set(-0.2, 0.75, 0);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 1.3), y); cab.position.set(-0.5, 1.6, 0); cab.scale.set(1, 1, 1);
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.2, 1.0), d); mast.position.set(0.8, 1.2, 0);
  const fork1 = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.15), d); fork1.position.set(1.35, 0.2, 0.3);
  const fork2 = fork1.clone(); fork2.position.z = -0.3;
  g.add(body, cab, mast, fork1, fork2);
  for (const [x, z] of [[-0.8, 0.72], [0.4, 0.72], [-0.8, -0.72], [0.4, -0.72]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.25, 12), d);
    w.rotation.x = Math.PI / 2; w.position.set(x, 0.33, z); g.add(w);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function makeLamp(night) {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 4, 8), new THREE.MeshLambertMaterial({ color: '#3d3a4f' }));
  post.position.y = 2; post.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), new THREE.MeshBasicMaterial({ color: night ? '#fff1a8' : '#fffbe8' }));
  head.position.y = 4.1;
  g.add(post, head);
  return g;
}

// scenery outside the arena: hills and houses, warehouses, or a lit skyline
function makeOutskirts(map, quality) {
  const g = new THREE.Group();
  const rnd = seeded(map.id.length * 97 + 3);
  const hw = map.width / 2, hd = map.depth / 2;
  const n = quality > 1 ? 70 : 40;
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const dist = 1.15 + rnd() * 1.4;
    const x = Math.cos(a) * hw * dist + Math.sign(Math.cos(a)) * 8, z = Math.sin(a) * hd * dist + Math.sign(Math.sin(a)) * 8;
    if (Math.abs(x) < hw + 6 && Math.abs(z) < hd + 6) continue;
    let mesh;
    if (map.id === 'plaza') {
      if (rnd() < 0.55) {
        mesh = makeTree(rnd); mesh.scale.setScalar(1.2 + rnd() * 1.4);
      } else {
        const h = 4 + rnd() * 9, w = 5 + rnd() * 7;
        const cols = ['#ffd1dc', '#ffe3b3', '#c9f2df', '#d6ccff', '#bfe3ff'];
        mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * (0.7 + rnd() * 0.5)), new THREE.MeshLambertMaterial({ color: cols[Math.floor(rnd() * cols.length)] }));
        mesh.position.y = h / 2;
        const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.78, 2.5, 4), new THREE.MeshLambertMaterial({ color: '#e0707e', flatShading: true }));
        roof.position.y = h / 2 + 1.25; roof.rotation.y = Math.PI / 4;
        mesh.add(roof);
      }
    } else if (map.id === 'depot') {
      const h = 6 + rnd() * 10, w = 10 + rnd() * 14;
      mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.6), new THREE.MeshLambertMaterial({ color: ['#8f9bb3', '#a7a2b8', '#c28f6e', '#7d8aa3'][Math.floor(rnd() * 4)] }));
      mesh.position.y = h / 2;
    } else {
      const h = 14 + rnd() * 40, w = 7 + rnd() * 9;
      const c = document.createElement('canvas'); c.width = 64; c.height = 128;
      const cg = c.getContext('2d'); cg.fillStyle = '#1d1638'; cg.fillRect(0, 0, 64, 128);
      for (let yy = 4; yy < 128; yy += 10) for (let xx = 4; xx < 64; xx += 10) if (rnd() < 0.45) { cg.fillStyle = ['#ffd27a', '#ff9ad5', '#7af2ff', '#fff4c2'][Math.floor(rnd() * 4)]; cg.fillRect(xx, yy, 5, 6); }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(Math.round(w / 6), Math.round(h / 12));
      mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), new THREE.MeshBasicMaterial({ map: t, fog: true }));
      mesh.position.y = h / 2;
    }
    mesh.position.x = x; mesh.position.z = z;
    g.add(mesh);
  }
  return g;
}

export function makeFlagMesh(teamColor) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 8), new THREE.MeshLambertMaterial({ color: '#f5f1e8' }));
  pole.position.y = 1.3; pole.castShadow = true;
  const clothGeo = new THREE.PlaneGeometry(1.2, 0.8, 10, 4);
  clothGeo.translate(0.6, 0, 0);
  const cloth = new THREE.Mesh(clothGeo, new THREE.MeshLambertMaterial({ color: teamColor, side: THREE.DoubleSide }));
  cloth.position.y = 2.15; cloth.castShadow = true;
  cloth.userData.base = clothGeo.attributes.position.array.slice();
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshLambertMaterial({ color: '#ffd84d' }));
  knob.position.y = 2.65;
  g.add(pole, cloth, knob);
  g.userData.cloth = cloth;
  return g;
}

export function waveFlag(flag, t) {
  const cloth = flag.userData.cloth;
  const pos = cloth.geometry.attributes.position;
  const base = cloth.userData.base;
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3];
    pos.array[i * 3 + 2] = Math.sin(x * 4 - t * 6) * 0.12 * x;
    pos.array[i * 3 + 1] = base[i * 3 + 1] - x * 0.05;
  }
  pos.needsUpdate = true;
  cloth.geometry.computeVertexNormals();
}

export function makePickupMesh() {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), new THREE.MeshLambertMaterial({ map: noteTexture('+1', { paper: '#7ef0c8' }) }));
  box.castShadow = true;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.04, 6, 24), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = -0.45;
  g.add(box, ring);
  g.userData.box = box;
  return g;
}

export function buildScene(map, quality = 2) {
  const scene = new THREE.Scene();
  const T = makeTextures();
  scene.background = new THREE.Color(map.fog);
  scene.fog = new THREE.Fog(map.fog, map.night ? 40 : 70, map.night ? 190 : 260);
  scene.add(skyDome(map.sky[0], map.sky[1], map.night));

  // lights
  const hemi = new THREE.HemisphereLight(map.hemi[0], map.hemi[1], map.hemi[2]);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(map.sun.color, map.sun.intensity);
  const sd = new THREE.Vector3(...map.sun.dir).normalize();
  sun.position.copy(sd.clone().multiplyScalar(90));
  sun.target.position.set(0, 0, 0);
  if (quality > 0) {
    sun.castShadow = true;
    const ms = quality > 1 ? 2048 : 1024;
    sun.shadow.mapSize.set(ms, ms);
    const ext = Math.max(map.width, map.depth) * 0.62;
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 10, far: 220 });
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
  }
  scene.add(sun, sun.target);

  // ground
  const groundTex = map.id === 'plaza' ? T.grass : T.concrete;
  groundTex.repeat.set(map.width * 2.2 / 6, map.depth * 2.2 / 6);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(map.width * 2.2, map.depth * 2.2), new THREE.MeshLambertMaterial({ color: map.ground, map: groundTex }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = quality > 0;
  scene.add(ground);
  const far = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshLambertMaterial({ color: map.ground }));
  far.rotation.x = -Math.PI / 2; far.position.y = -0.05;
  scene.add(far);

  // paths / floor markings
  for (const [x, z, w, d] of map.paths || []) {
    const neon = map.pathStyle === 'neon';
    const mat = neon ? new THREE.MeshBasicMaterial({ color: map.path, transparent: true, opacity: 0.85 })
      : new THREE.MeshLambertMaterial({ color: map.path, map: map.pathStyle === 'path' ? T.concrete : null });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    p.rotation.x = -Math.PI / 2; p.position.set(x + w / 2, 0.012, z + d / 2);
    p.receiveShadow = !neon && quality > 0;
    scene.add(p);
  }

  for (const m of buildBoxes(map, T, quality)) scene.add(m);

  // neon edge glow on the night map
  if (map.night) {
    const pts = [];
    for (const b of map.boxes) {
      if (b.h < 0.9 || b.w > 60 || b.d > 60) continue;
      const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2, y = b.y0 + b.h + 0.01;
      pts.push(x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0);
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#ff9ad5', transparent: true, opacity: 0.55 })));
    // stars
    const sp = [];
    const r = seeded(11);
    for (let i = 0; i < 400; i++) { const a = r() * Math.PI * 2, e = 0.15 + r() * 1.2; sp.push(Math.cos(a) * Math.cos(e) * 400, Math.sin(e) * 400, Math.sin(a) * Math.cos(e) * 400); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 1.4, sizeAttenuation: false, fog: false })));
  } else {
    // clouds
    const r = seeded(5);
    const cm = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true, emissive: '#ffffff', emissiveIntensity: 0.35 });
    for (let i = 0; i < 14; i++) {
      const c = new THREE.Group();
      for (let k = 0; k < 4; k++) { const s = new THREE.Mesh(new THREE.IcosahedronGeometry(6 + r() * 6, 0), cm); s.position.set(k * 7 - 10, r() * 3, r() * 5); s.scale.y = 0.6; c.add(s); }
      const a = r() * Math.PI * 2, d = 150 + r() * 160;
      c.position.set(Math.cos(a) * d, 60 + r() * 50, Math.sin(a) * d);
      scene.add(c);
    }
  }

  // trees
  const tr = seeded(99);
  for (const t of map.trees || []) { const m = makeTree(tr); m.position.set(t.x, 0, t.z); m.rotation.y = tr() * 6; scene.add(m); }
  // decor
  for (const d of map.decor || []) {
    let m = null;
    if (d.type === 'statue') { m = makeStatue(); m.position.set(d.x, d.y, d.z); }
    if (d.type === 'forklift') { m = makeForklift(); m.position.set(d.x, 0, d.z); m.rotation.y = d.rot || 0; }
    if (d.type === 'lamp') { m = makeLamp(map.night); m.position.set(d.x, 0, d.z); }
    if (d.type === 'sign') {
      m = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.3), new THREE.MeshBasicMaterial({ map: signTexture(d.text, d.color) }));
      m.position.set(d.x, d.y, d.z); m.rotation.y = d.rot || 0;
    }
    if (m) scene.add(m);
  }
  scene.add(makeOutskirts(map, quality));

  return { scene, sun, hemi };
}
