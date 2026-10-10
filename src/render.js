// Rendering: three.js renderer, cameras, avatars, flags, pickups, first-person hands.
import * as THREE from 'three';
import { buildScene, makeFlagMesh, waveFlag, makePickupInstances, noteTexture } from './scene.js';
import { Avatar } from './avatar.js';
import { Effects } from './effects.js';
import { CFG, TEAM_COLOR } from './config.js';
import { eyeHeight } from './game.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0), _up = new THREE.Vector3(0, 1, 0), _xAxis = new THREE.Vector3(1, 0, 0);
// camera scratch objects, reused every frame instead of allocating new ones
const _want = new THREE.Vector3(), _look = new THREE.Vector3(), _head = new THREE.Vector3(), _dir = new THREE.Vector3();
const _cm = new THREE.Matrix4(), _cq = new THREE.Quaternion(), _pv = new THREE.Vector3();

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.r.autoClear = false;
    this.camera = new THREE.PerspectiveCamera(CFG.fov, 1, 0.05, 900);
    this.camera.rotation.order = 'YXZ';
    this.vmScene = new THREE.Scene();
    this.vmCam = new THREE.PerspectiveCamera(55, 1, 0.01, 10);
    this.vmScene.add(new THREE.HemisphereLight('#ffffff', '#776688', 2.4));
    const dl = new THREE.DirectionalLight('#ffffff', 1.2); dl.position.set(1, 2, 1); this.vmScene.add(dl);
    this.quality = 2;
    this.scale = 1;
    this.avatars = new Map();
    this.game = null;
    this.bob = 0; this.dip = 0;
    this.fovBase = CFG.fov;
    this.buildViewmodel();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  setQuality(q, scale) {
    this.quality = q;
    this.scale = scale ?? this.scale;
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    const pr = Math.min(devicePixelRatio || 1, this.quality > 1 ? 2 : this.quality > 0 ? 1.5 : 1) * this.scale;
    this.r.setPixelRatio(pr);
    this.r.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.vmCam.aspect = w / h; this.vmCam.updateProjectionMatrix();
    this.aspect = w / h;
  }

  load(game) {
    this.unload();
    this.game = game;
    const { scene } = buildScene(game.map, this.quality);
    this.scene = scene;
    this.r.shadowMap.enabled = this.quality > 0;
    this.r.shadowMap.needsUpdate = true;
    this.effects = new Effects(scene);
    // flags
    this.flagMeshes = {};
    if (game.mode.id === 'ctf') {
      for (const t of [1, 2]) {
        const f = game.flags[t];
        const m = makeFlagMesh(TEAM_COLOR[t]);
        scene.add(m);
        const base = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 0.12, 28), new THREE.MeshLambertMaterial({ color: TEAM_COLOR[t] }));
        base.position.set(f.home.x, f.home.y + 0.06, f.home.z); base.receiveShadow = true;
        const ring = new THREE.Mesh(new THREE.RingGeometry(2.0, 2.25, 40), new THREE.MeshBasicMaterial({ color: TEAM_COLOR[t], transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2; ring.position.set(f.home.x, f.home.y + 0.05, f.home.z);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 30, 8, 1, true), new THREE.MeshBasicMaterial({ color: TEAM_COLOR[t], transparent: true, opacity: 0.22, depthWrite: false }));
        beam.position.y = 15;
        m.add(beam);
        scene.add(base, ring);
        this.flagMeshes[t] = m;
      }
    }
    this.pickups = makePickupInstances(game.pickups.length);
    scene.add(this.pickups.box, this.pickups.ring);
    for (const p of game.players.values()) this.ensureAvatar(p);
    this.attractT = 0;
    this.zoneMesh = null;
    if (game.br) this.buildZone(scene);
    // Compile every shader this match can need now, while it's loading, rather than
    // mid-fight the first time an effect shows up. Nothing here is drawn.
    this.effects.warmUp();
    this.r.compile(scene, this.camera);
    this.r.compile(this.vmScene, this.vmCam);
  }

  // Battle Royale storm wall: a tall striped cylinder plus a ring showing where it will close to
  buildZone(scene) {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: { t: { value: 0 }, col: { value: new THREE.Color('#ff4f8b') } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float t; uniform vec3 col; varying vec2 vUv;
        void main(){
          float stripe = step(0.5, fract(vUv.x * 160.0 + vUv.y * 6.0 - t * 0.6));
          float fade = pow(1.0 - vUv.y, 1.6);
          float a = (0.16 + 0.22 * stripe) * fade + 0.1 * smoothstep(0.03, 0.0, vUv.y);
          gl_FragColor = vec4(col, a);
        }`,
    });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 36, 96, 1, true), mat);
    wall.position.y = 18; wall.renderOrder = 3;
    const g = new THREE.Group();
    g.add(wall);
    const next = new THREE.Mesh(new THREE.RingGeometry(0.992, 1, 128), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
    next.rotation.x = -Math.PI / 2;
    scene.add(g, next);
    this.zoneMesh = { g, wall, next, mat };
  }

  unload() {
    if (!this.scene) return;
    for (const a of this.avatars.values()) a.dispose();
    this.avatars.clear();
    this.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { m.map?.dispose(); m.dispose(); }); }
    });
    this.scene = null;
    this.game = null;
  }

  ensureAvatar(p) {
    let a = this.avatars.get(p.id);
    if (!a) {
      a = new Avatar({ shirt: p.shirt, skin: p.skin, hat: p.hat, team: p.team, name: p.name });
      a.setNumber(p.num);
      this.scene.add(a.root);
      this.avatars.set(p.id, a);
    }
    return a;
  }

  removeAvatar(id) {
    const a = this.avatars.get(id);
    if (a) { this.scene.remove(a.root); a.dispose(); this.avatars.delete(id); }
  }

  redrawNotes() { for (const a of this.avatars.values()) a.redrawNote(); }

  // ---------------------------------------------------------------- viewmodel
  buildViewmodel() {
    const g = new THREE.Group();
    const skin = new THREE.MeshToonMaterial({ color: '#f5c6a5' });
    const sleeve = new THREE.MeshToonMaterial({ color: '#4dabf7' });
    this.vmSkin = skin; this.vmSleeve = sleeve;
    // a small hand in the lower corner, forearm reaching back out of view
    const mkArm = (x) => {
      const a = new THREE.Group();
      const dir = new THREE.Vector3(Math.sign(x) * 0.19, -0.75, 0.63).normalize();
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.24, 4, 10), sleeve);
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      arm.position.copy(dir).multiplyScalar(0.14);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.033, 12, 10), skin);
      a.add(arm, hand);
      a.position.set(x, -0.27, -0.75);
      a.userData.base = a.position.clone();
      return a;
    };
    this.vmL = mkArm(-0.24); this.vmR = mkArm(0.3);
    this.vmItem = new THREE.Group();
    this.vmItem.position.set(-0.006, 0.036, -0.012);
    this.vmR.add(this.vmItem);
    g.add(this.vmL, this.vmR);
    this.vm = g;
    this.vmScene.add(g);
    this.vmItems = {};
    const eff = new Effects(new THREE.Scene());
    for (const t of ['flash', 'smoke', 'distract']) { const m = eff.grenadeMesh(t); m.scale.setScalar(0.42); m.rotation.z = -0.3; this.vmItems[t] = m; this.vmItem.add(m); }
    const cam = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.064, 0.048), new THREE.MeshToonMaterial({ color: '#2c2a36' }));
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.023, 0.03, 14), new THREE.MeshToonMaterial({ color: '#111' }));
    lens.rotation.x = Math.PI / 2; lens.position.z = -0.035;
    const flash = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.014, 0.008), new THREE.MeshBasicMaterial({ color: '#fff7c2' }));
    flash.position.set(0.033, 0.02, -0.025);
    cam.add(body, lens, flash);
    cam.position.set(-0.2, -0.2, -0.72);
    this.vmCamera = cam; cam.visible = false;
    g.add(cam);
    this.vmThrow = 0; this.vmPhoto = 0;
  }

  setViewmodelColors(shirt, skin) { this.vmSleeve.color.set(shirt); this.vmSkin.color.set(skin); }

  // ---------------------------------------------------------------- per frame
  sync(dt, time, view) {
    const g = this.game;
    if (!g) return;
    const local = g.local;
    for (const p of g.players.values()) {
      const a = this.ensureAvatar(p);
      if (a.team !== p.team) a.setTeam(p.team);
      a.setNumber(p.num);
      a.setNotes(p.notes || 1);
      const isMe = p.id === g.localId && view.mode === 'fp';
      a.setVisible(p.alive && !isMe);
      if (!p.alive) continue;
      const spec = view.mode === 'spec-god' || view.mode === 'spec-follow';
      const camD = this.camera.position.distanceTo(a.root.position);
      if (spec && !(view.mode === 'spec-follow' && view.spec && view.spec.target === p.id)) {
        a.setSpecTag(`${p.name} · ${p.num}`, p.team ? TEAM_COLOR[p.team] : '#ffe45c');
        a.setSpecScale(Math.max(0.9, camD * 0.062));
      } else a.setSpecTag(null);
      a.setSpecRing(view.mode === 'spec-god', Math.max(1, camD * 0.03), p.team ? TEAM_COLOR[p.team] : '#ffe45c');
      a.update(dt, { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, crouch: p.crouchK, speed: p.speed, onGround: p.onGround, zoom: p.zoom, protect: p.protect }, time);
      a.setCarrying(p.carrying ? TEAM_COLOR[p.carrying] : null);
      a.tag.visible = !!(g.teams && local && p.team === local.team && p.id !== g.localId);
    }
    for (const [id] of this.avatars) if (!g.players.has(id)) this.removeAvatar(id);

    // flags
    for (const t in this.flagMeshes) {
      const f = g.flags[t], m = this.flagMeshes[t];
      m.visible = f.state !== 'carried';
      m.position.set(f.x, f.y, f.z);
      waveFlag(m, time + +t);
    }
    // pickups (instanced): bob and spin, hidden ones collapse to nothing
    {
      const B = this.pickups.box, Rg = this.pickups.ring, m = _m, q = _q, v = _v, sc = _s;
      g.pickups.forEach((pk, i) => {
        if (!pk.active) { B.setMatrixAt(i, _zero); Rg.setMatrixAt(i, _zero); return; }
        const y = pk.y + Math.sin(time * 2.4 + i) * 0.12;
        q.setFromAxisAngle(_up, time * 1.5 + i);
        m.compose(v.set(pk.x, y, pk.z), q, sc.set(1, 1, 1));
        B.setMatrixAt(i, m);
        q.setFromAxisAngle(_xAxis, Math.PI / 2);
        m.compose(v.set(pk.x, y - 0.45, pk.z), q, sc);
        Rg.setMatrixAt(i, m);
      });
      B.instanceMatrix.needsUpdate = true; Rg.instanceMatrix.needsUpdate = true;
    }
    if (this.zoneMesh && g.zone) {
      const Z = g.zone, M = this.zoneMesh;
      M.g.position.set(Z.x, 0, Z.z);
      const r = Math.max(0.05, Z.r);
      M.g.scale.set(r, 1, r);
      M.mat.uniforms.t.value = time;
      M.g.visible = g.phase !== 'countdown' || true;
      M.next.visible = Z.state !== 'final' && Z.nr < Z.r - 0.5;
      M.next.position.set(Z.nx, 0.06, Z.nz);
      const nr = Math.max(0.05, Z.nr);
      M.next.scale.set(nr, nr, 1);
    }
    this.effects.syncGrenades(g.grenades);
    this.effects.syncSmokes(g.smokes, dt);
    this.effects.syncDistracts(g.distracts, time);
    this.effects.update(dt);

    // camera
    const cam = this.camera;
    if (view.mode === 'fp' && local && local.alive) {
      const sp = Math.hypot(local.vx, local.vz);
      if (local.onGround && sp > 0.5) this.bob += dt * sp * 1.7;
      if (local.landed > 4) this.dip = Math.min(0.18, local.landed * 0.015);
      this.dip *= Math.pow(0.001, dt);
      const bobY = Math.sin(this.bob * 2) * 0.035 * Math.min(1, sp / 6) * (local.zoom ? 0.2 : 1);
      cam.position.set(local.x, local.y + eyeHeight(local) + bobY - this.dip, local.z);
      cam.rotation.set(local.pitch, local.yaw, 0);
      const target = local.zoom ? CFG.binoFov : this.fovBase;
      const nf = cam.fov + (target - cam.fov) * Math.min(1, dt * 14);
      if (Math.abs(nf - cam.fov) > 0.01) { cam.fov = nf; cam.updateProjectionMatrix(); }
      local.fov = this.fovBase; local.aspect = this.aspect;
    } else if (view.mode === 'death' && local) {
      const dp = local.deathPos || [local.x, local.y, local.z];
      const killer = g.players.get(local.killedBy);
      let tx = dp[0], ty = dp[1] + 1.4, tz = dp[2];
      if (killer && killer.alive) { tx = killer.x; ty = killer.y + 1.7; tz = killer.z; }
      const k = Math.min(1, dt * 3);
      cam.position.lerp(_want.set(dp[0], dp[1] + 3.2, dp[2]), k);
      _cm.lookAt(cam.position, _look.set(tx, ty, tz), _up);
      cam.quaternion.slerp(_cq.setFromRotationMatrix(_cm), k);
      const target = killer && Math.hypot(killer.x - dp[0], killer.z - dp[2]) > 15 ? 30 : 60;
      cam.fov += (target - cam.fov) * k; cam.updateProjectionMatrix();
    } else if (view.mode === 'spec-follow' && view.spec && g.players.get(view.spec.target)) {
      // over-the-shoulder chase cam on the player being spectated
      const t = g.players.get(view.spec.target);
      const yaw = t.yaw + (view.spec.orbit || 0);
      const head = _head.set(t.x, t.y + eyeHeight(t) + 0.15, t.z);
      const dist = 4.2, up = 1.25 + (view.spec.tilt || 0);
      const want = _want.set(t.x + Math.sin(yaw) * dist, head.y + up, t.z + Math.cos(yaw) * dist);
      const dir = _dir.copy(want).sub(head); const L = dir.length(); dir.normalize();
      const hit = g.world.raycast(head.x, head.y, head.z, dir.x, dir.y, dir.z, L);
      if (hit) want.copy(head).addScaledVector(dir, Math.max(0.6, hit.t - 0.6));
      const k = Math.min(1, dt * 8);
      if (this._lastSpecTarget !== t.id) { cam.position.copy(want); this._lastSpecTarget = t.id; }
      else cam.position.lerp(want, k);
      _cm.lookAt(cam.position, _look.set(t.x - Math.sin(yaw) * 6, head.y - 0.2, t.z - Math.cos(yaw) * 6), _up);
      cam.quaternion.setFromRotationMatrix(_cm);
      if (Math.abs(cam.fov - 70) > 0.01) { cam.fov = 70; cam.updateProjectionMatrix(); }
    } else if (view.mode === 'spec-god' && view.spec) {
      // god view: looking down on the whole arena
      const S = view.spec;
      const back = S.h * 0.42;
      const k = Math.min(1, dt * 7);
      cam.position.lerp(_want.set(S.x + Math.sin(S.yaw) * back, S.h, S.z + Math.cos(S.yaw) * back), k);
      _cm.lookAt(cam.position, _look.set(S.x, 0, S.z), _up);
      cam.quaternion.slerp(_cq.setFromRotationMatrix(_cm), k);
      if (Math.abs(cam.fov - 55) > 0.01) { cam.fov = 55; cam.updateProjectionMatrix(); }
      this._lastSpecTarget = null;
    } else {
      // attract / spectate: slow orbit
      this.attractT += dt;
      const R = Math.max(g.map.width, g.map.depth) * 0.42, a = this.attractT * 0.05 + 0.6;
      cam.position.set(Math.cos(a) * R, 17 + Math.sin(this.attractT * 0.1) * 3, Math.sin(a) * R * 0.85);
      _cm.lookAt(cam.position, _look.set(0, 1.5, 0), _up);
      cam.quaternion.setFromRotationMatrix(_cm);
      if (Math.abs(cam.fov - 55) > 0.01) { cam.fov = 55; cam.updateProjectionMatrix(); }
    }

    // viewmodel
    const showVm = view.mode === 'fp' && local && local.alive && !local.zoom;
    this.vm.visible = !!showVm;
    if (showVm) {
      const sp = Math.hypot(local.vx, local.vz);
      const sway = Math.sin(this.bob) * 0.012 * Math.min(1, sp / 6);
      this.vm.position.set(sway, Math.abs(Math.cos(this.bob)) * 0.012 * Math.min(1, sp / 6) - this.dip * 0.3 - local.crouchK * 0.02, 0);
      for (const k in this.vmItems) this.vmItems[k].visible = k === view.gadget && local.inv[k] > 0;
      const b = this.vmR.userData.base;
      if (this.vmThrow > 0) {
        this.vmThrow -= dt;
        const t = 1 - this.vmThrow / 0.4;
        const s = Math.sin(t * Math.PI);
        this.vmR.position.set(b.x - s * 0.08, b.y + s * 0.16, b.z - s * 0.1);
        this.vmR.rotation.x = -s * 0.9;
        this.vmItem.visible = t > 0.85;
      } else { this.vmR.position.copy(b); this.vmR.rotation.x = 0; this.vmItem.visible = true; }
      this.vmCamera.visible = this.vmPhoto > 0;
      this.vmL.visible = this.vmPhoto > 0;
      this.vmL.position.set(-0.2, -0.27, -0.75);
      if (this.vmPhoto > 0) this.vmPhoto -= dt;
    }
  }

  render(photo) {
    if (!this.scene) return;
    this.r.clear();
    this.r.render(this.scene, this.camera);
    if (photo) photo(this.canvas);
    if (this.vm.visible) { this.r.clearDepth(); this.r.render(this.vmScene, this.vmCam); }
  }

  // project a world point to screen pixels (for HUD markers); returns null if behind
  project(x, y, z) {
    this.camera.updateMatrixWorld();
    const v = _pv.set(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, behind: false };
  }
}
