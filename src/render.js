// Rendering: three.js renderer, cameras, avatars, flags, pickups, first-person hands.
import * as THREE from 'three';
import { buildScene, makeFlagMesh, waveFlag, makePickupMesh, noteTexture } from './scene.js';
import { Avatar } from './avatar.js';
import { Effects } from './effects.js';
import { CFG, TEAM_COLOR } from './config.js';
import { eyeHeight } from './game.js';

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
    this.pickupMeshes = game.pickups.map(pk => { const m = makePickupMesh(); m.position.set(pk.x, pk.y, pk.z); scene.add(m); return m; });
    for (const p of game.players.values()) this.ensureAvatar(p);
    this.attractT = 0;
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
      const isMe = p.id === g.localId && view.mode === 'fp';
      a.setVisible(p.alive && !isMe);
      if (!p.alive) continue;
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
    // pickups
    g.pickups.forEach((pk, i) => {
      const m = this.pickupMeshes[i];
      m.visible = pk.active;
      m.position.y = pk.y + Math.sin(time * 2.4 + i) * 0.12;
      m.userData.box.rotation.y = time * 1.5 + i;
    });
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
      const want = new THREE.Vector3(dp[0], dp[1] + 3.2, dp[2]);
      cam.position.lerp(want, k);
      const look = new THREE.Vector3(tx, ty, tz);
      const m = new THREE.Matrix4().lookAt(cam.position, look, new THREE.Vector3(0, 1, 0));
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      cam.quaternion.slerp(q, k);
      const target = killer && Math.hypot(killer.x - dp[0], killer.z - dp[2]) > 15 ? 30 : 60;
      cam.fov += (target - cam.fov) * k; cam.updateProjectionMatrix();
    } else {
      // attract / spectate: slow orbit
      this.attractT += dt;
      const R = Math.max(g.map.width, g.map.depth) * 0.42, a = this.attractT * 0.05 + 0.6;
      cam.position.set(Math.cos(a) * R, 17 + Math.sin(this.attractT * 0.1) * 3, Math.sin(a) * R * 0.85);
      const m = new THREE.Matrix4().lookAt(cam.position, new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(0, 1, 0));
      cam.quaternion.setFromRotationMatrix(m);
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
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, behind: false };
  }
}
