// The cute little characters with a sticky note on their forehead.
import * as THREE from 'three';
import { noteTexture, drawNote, makeFlagMesh } from './scene.js';
import { TEAM_COLOR } from './config.js';

const toon = (() => {
  const c = document.createElement('canvas'); c.width = 4; c.height = 1;
  const g = c.getContext('2d');
  ['#6f6f6f', '#a8a8a8', '#e0e0e0', '#ffffff'].forEach((col, i) => { g.fillStyle = col; g.fillRect(i, 0, 1, 1); });
  const t = new THREE.CanvasTexture(c);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false;
  return t;
})();

const GEO = {
  torso: new THREE.CapsuleGeometry(0.3, 0.32, 4, 12),
  head: new THREE.SphereGeometry(0.36, 22, 16),
  eye: new THREE.SphereGeometry(0.055, 10, 8),
  glint: new THREE.SphereGeometry(0.018, 6, 4),
  arm: new THREE.CapsuleGeometry(0.085, 0.32, 3, 8),
  hand: new THREE.SphereGeometry(0.095, 10, 8),
  leg: new THREE.CapsuleGeometry(0.105, 0.3, 3, 8),
  shoe: new THREE.SphereGeometry(0.12, 10, 8),
  note: new THREE.PlaneGeometry(0.5, 0.31),
  mouth: new THREE.TorusGeometry(0.055, 0.014, 6, 12, Math.PI),
  cheek: new THREE.CircleGeometry(0.045, 12),
  bubble: new THREE.SphereGeometry(1.05, 20, 14),
};
const MAT = {
  black: new THREE.MeshBasicMaterial({ color: '#16121e' }),
  white: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
  cheek: new THREE.MeshBasicMaterial({ color: '#ff8fa3', transparent: true, opacity: 0.6 }),
  shoe: new THREE.MeshToonMaterial({ color: '#2d2a3a', gradientMap: toon }),
  bino: new THREE.MeshToonMaterial({ color: '#2b2b33', gradientMap: toon }),
};
const mat = (color) => new THREE.MeshToonMaterial({ color, gradientMap: toon });

function hatMesh(type) {
  const g = new THREE.Group();
  const m = (c) => mat(c);
  if (type === 'cap') {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.37, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), m('#e8483f'));
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 14, 1, false, 0, Math.PI), m('#e8483f'));
    brim.position.set(0, 0.0, -0.3); brim.rotation.y = Math.PI / 2;
    dome.position.y = 0.06;
    g.add(dome, brim); g.position.y = 0.12; g.rotation.y = Math.PI; // brim backwards so the note stays visible
  } else if (type === 'beanie') {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.38, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), m('#3f7be8'));
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.05, 6, 20), m('#2f5fc0'));
    band.rotation.x = Math.PI / 2; band.position.y = 0.02;
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), m('#ffffff'));
    pom.position.y = 0.4;
    g.add(dome, band, pom); g.position.y = 0.16;
  } else if (type === 'party') {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.45, 14), m('#ff6bcb'));
    cone.position.y = 0.22;
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), m('#ffe45c')); pom.position.y = 0.46;
    g.add(cone, pom); g.position.set(0.06, 0.28, 0.08); g.rotation.z = -0.25;
  } else if (type === 'tophat') {
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.38, 16), m('#26232f'));
    top.position.y = 0.19;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.03, 18), m('#26232f'));
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.07, 16), m('#c2324a')); band.position.y = 0.06;
    g.add(top, brim, band); g.position.y = 0.31; g.rotation.z = 0.12;
  } else if (type === 'propeller') {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.33, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), m('#ffd43b'));
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.14, 6), m('#333'));
    stick.position.y = 0.38;
    const prop = new THREE.Group();
    for (const [c, r] of [['#ff5c5c', 0], ['#4dabf7', Math.PI]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.01, 0.06), m(c)); b.position.x = 0.14; const p = new THREE.Group(); p.rotation.y = r; p.add(b); prop.add(p); }
    prop.position.y = 0.45;
    g.add(dome, stick, prop); g.position.y = 0.16;
    g.userData.spin = prop;
  } else if (type === 'crown') {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.16, 10, 1, true), m('#ffcf33'));
    ring.material.side = THREE.DoubleSide;
    g.add(ring);
    for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 4), m('#ffcf33')); const a = i / 5 * Math.PI * 2; s.position.set(Math.cos(a) * 0.22, 0.13, Math.sin(a) * 0.22); g.add(s); }
    g.position.y = 0.36;
  } else if (type === 'bucket') {
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.33, 0.24, 16), m('#8ccf6c'));
    top.position.y = 0.12;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.03, 18), m('#8ccf6c'));
    g.add(top, brim); g.position.y = 0.24;
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function nameSprite(name, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = '600 30px "Atkinson Hyperlegible", system-ui, sans-serif';
  const w = Math.min(250, g.measureText(name).width + 28);
  g.fillStyle = 'rgba(20,16,32,0.72)';
  g.beginPath(); g.roundRect((256 - w) / 2, 8, w, 46, 12); g.fill();
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(name, 128, 32);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(1.6, 0.4, 1); s.renderOrder = 5;
  return s;
}

export class Avatar {
  constructor({ shirt, skin, hat, team, name }) {
    this.root = new THREE.Group();
    this.shirt = shirt; this.skinColor = skin; this.team = team || 0; this.name = name;
    const shirtCol = this.team ? TEAM_COLOR[this.team] : shirt;
    this.mShirt = mat(shirtCol);
    this.mSkin = mat(skin);
    this.mPants = mat(this.team === 1 ? '#a82838' : this.team === 2 ? '#24459a' : '#3b3f58');

    this.legs = new THREE.Group(); this.legs.position.y = 0.62;
    this.legL = this.limb(GEO.leg, this.mPants, -0.14, -0.27, true);
    this.legR = this.limb(GEO.leg, this.mPants, 0.14, -0.27, true);
    this.legs.add(this.legL, this.legR);

    this.upper = new THREE.Group();
    const torso = new THREE.Mesh(GEO.torso, this.mShirt);
    torso.position.y = 0.98; torso.castShadow = true;
    this.torso = torso;
    this.armL = this.limb(GEO.arm, this.mShirt, -0.38, -0.2, false); this.armL.position.y = 1.18;
    this.armR = this.limb(GEO.arm, this.mShirt, 0.38, -0.2, false); this.armR.position.y = 1.18;
    this.upper.add(torso, this.armL, this.armR);

    // head: pivots at the neck so pitch tilts the forehead note
    this.neck = new THREE.Group(); this.neck.position.y = 1.38;
    const head = new THREE.Mesh(GEO.head, this.mSkin);
    head.position.y = 0.32; head.castShadow = true;
    this.head = head;
    this.neck.add(head);
    this.noteTex = noteTexture('----');
    this.note = new THREE.Mesh(GEO.note, new THREE.MeshBasicMaterial({ map: this.noteTex }));
    this.note.position.set(0, 0.43, -0.37);
    this.note.rotation.set(0.3, Math.PI, 0);
    this.neck.add(this.note);
    // extra notes stacked underneath (Battle Royale lives); their edges peek out
    this.under = [];
    for (const [rz, col] of [[0.16, '#ff9ecb'], [-0.13, '#7ef0c8']]) {
      const u = new THREE.Mesh(GEO.note, new THREE.MeshBasicMaterial({ color: col }));
      u.position.set(0, 0.43, -0.356);
      u.rotation.set(0.3, Math.PI, rz);
      u.visible = false;
      this.neck.add(u);
      this.under.push(u);
    }
    this.notes = 1;
    for (const x of [-0.12, 0.12]) {
      const e = new THREE.Mesh(GEO.eye, MAT.black); e.position.set(x, 0.21, -0.318); this.neck.add(e);
      const gl = new THREE.Mesh(GEO.glint, MAT.white); gl.position.set(x + 0.02, 0.235, -0.365); this.neck.add(gl);
      const ch = new THREE.Mesh(GEO.cheek, MAT.cheek); ch.position.set(x * 1.6, 0.15, -0.262); ch.rotation.y = Math.PI + (x > 0 ? -0.6 : 0.6); this.neck.add(ch);
    }
    const mouth = new THREE.Mesh(GEO.mouth, MAT.black);
    mouth.position.set(0, 0.11, -0.297); mouth.rotation.set(0.35, Math.PI, Math.PI);
    this.neck.add(mouth);
    this.hat = hatMesh(hat);
    this.hat.position.y += 0.32;
    this.neck.add(this.hat);
    this.upper.add(this.neck);

    // held binoculars
    this.bino = new THREE.Group();
    for (const x of [-0.07, 0.07]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.16, 10), MAT.bino); t.rotation.x = Math.PI / 2; t.position.x = x; this.bino.add(t); }
    this.bino.position.set(0, 0.26, -0.45); this.bino.visible = false;
    this.neck.add(this.bino);

    this.body = new THREE.Group();
    this.body.add(this.legs, this.upper);
    this.root.add(this.body);

    // team name tag (only shown to teammates)
    this.tag = nameSprite(name, this.team ? TEAM_COLOR[this.team] : '#ffffff');
    this.tag.position.y = 2.55; this.tag.visible = false;
    this.root.add(this.tag);

    // spawn-protection bubble
    this.bubble = new THREE.Mesh(GEO.bubble, new THREE.MeshBasicMaterial({ color: '#bff3ff', transparent: true, opacity: 0.18, depthWrite: false }));
    this.bubble.position.y = 1.0; this.bubble.scale.set(0.75, 1.1, 0.75); this.bubble.visible = false;
    this.root.add(this.bubble);

    this.flag = null;
    this.phase = Math.random() * 6;
    this.number = '';
    this.throwT = 0;
    this.deathT = 0;
    this.visible = true;
  }

  limb(geo, material, x, y, isLeg) {
    const pivot = new THREE.Group();
    pivot.position.x = x;
    const m = new THREE.Mesh(geo, material);
    m.position.y = y; m.castShadow = true;
    pivot.add(m);
    const end = new THREE.Mesh(isLeg ? GEO.shoe : GEO.hand, isLeg ? MAT.shoe : this.mSkin);
    end.position.set(0, y * 2 + (isLeg ? 0.03 : 0.02), isLeg ? -0.05 : 0);
    if (isLeg) end.scale.set(1, 0.7, 1.4);
    end.castShadow = true;
    pivot.add(end);
    return pivot;
  }

  setNumber(num) {
    if (num === this.number) return;
    this.number = num;
    drawNote(this.noteTex.userData.canvas.getContext('2d'), num || '');
    this.noteTex.needsUpdate = true;
  }
  redrawNote() { const n = this.number; this.number = null; this.setNumber(n); }

  setNotes(n) {
    if (n === this.notes) return;
    this.notes = n;
    this.under.forEach((u, i) => { u.visible = i < n - 1; });
  }

  // spectators see everyone's name and number floating above their head
  setSpecTag(text, color) {
    if (!text) { if (this.specTag) this.specTag.visible = false; return; }
    if (!this.specTag) {
      const c = document.createElement('canvas'); c.width = 320; c.height = 72;
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      this.specTag = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
      this.specTag.renderOrder = 6;
      this.specTag.position.y = 2.75;
      this.root.add(this.specTag);
    }
    this.specTag.visible = true;
    const key = text + color;
    if (this._specKey === key) return;
    this._specKey = key;
    const c = this.specTag.material.map.image, g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.font = '700 30px "Atkinson Hyperlegible", system-ui, sans-serif';
    const w = Math.min(c.width - 4, g.measureText(text).width + 30);
    g.fillStyle = 'rgba(20,16,32,0.8)';
    g.beginPath(); g.roundRect((c.width - w) / 2, 8, w, 54, 14); g.fill();
    g.fillStyle = color || '#ffe45c'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, c.width / 2, 36);
    this.specTag.material.map.needsUpdate = true;
  }

  setSpecScale(s) { if (this.specTag) this.specTag.scale.set(2.2 * s, 0.5 * s, 1); }

  // a bright ring on the ground so players are easy to spot from the god view
  setSpecRing(on, scale, color) {
    if (!on) { if (this.ring) this.ring.visible = false; return; }
    if (!this.ring) {
      this.ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.8, 28), new THREE.MeshBasicMaterial({ color: color || '#ffe45c', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
      this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.06; this.ring.renderOrder = 4;
      this.root.add(this.ring);
    }
    this.ring.visible = true;
    this.ring.scale.setScalar(scale);
  }

  setTeam(team) {
    this.team = team;
    this.mShirt.color.set(team ? TEAM_COLOR[team] : this.shirt);
    this.mPants.color.set(team === 1 ? '#a82838' : team === 2 ? '#24459a' : '#3b3f58');
    const old = this.tag; this.root.remove(old);
    this.tag = nameSprite(this.name, team ? TEAM_COLOR[team] : '#ffffff');
    this.tag.position.y = 2.55; this.tag.visible = old.visible;
    this.root.add(this.tag);
  }

  setCarrying(teamColor) {
    if (teamColor && !this.flag) {
      this.flag = makeFlagMesh(teamColor);
      this.flag.scale.setScalar(0.7);
      this.flag.position.set(0.15, 0.3, 0.32);
      this.flag.rotation.z = -0.15;
      this.upper.add(this.flag);
    } else if (!teamColor && this.flag) {
      this.upper.remove(this.flag); this.flag = null;
    }
  }

  playThrow() { this.throwT = 0.35; }

  // s: { x,y,z, yaw, pitch, crouch(0..1), speed, onGround, zoom, protect }
  update(dt, s, time) {
    const r = this.root;
    r.position.set(s.x, s.y, s.z);
    r.rotation.y = s.yaw;
    const k = Math.min(1, s.speed / 6);
    this.phase += dt * (3 + s.speed * 1.6);
    const sw = Math.sin(this.phase) * 0.75 * k;
    const crouch = s.crouch;
    this.legs.scale.y = 1 - 0.5 * crouch;
    this.upper.position.y = -0.56 * crouch + Math.abs(Math.cos(this.phase)) * 0.05 * k;
    if (!s.onGround) {
      this.legL.rotation.x = -0.6; this.legR.rotation.x = 0.3;
      this.armL.rotation.z = -0.9; this.armR.rotation.z = 0.9;
    } else {
      this.legL.rotation.x = sw; this.legR.rotation.x = -sw;
      this.armL.rotation.z = -0.12; this.armR.rotation.z = 0.12;
    }
    this.armL.rotation.x = -sw * 0.8;
    this.armR.rotation.x = sw * 0.8;
    if (s.zoom) {
      this.armL.rotation.set(-2.3, 0, 0.35); this.armR.rotation.set(-2.3, 0, -0.35);
    }
    if (this.throwT > 0) {
      this.throwT -= dt;
      const t = 1 - this.throwT / 0.35;
      this.armR.rotation.x = -2.8 + t * 3.6;
    }
    this.bino.visible = !!s.zoom;
    this.neck.rotation.x = Math.max(-0.7, Math.min(0.7, s.pitch)) * 0.85;
    this.upper.rotation.x = Math.max(-0.2, Math.min(0.2, s.pitch * 0.2));
    if (this.hat.userData.spin) this.hat.userData.spin.rotation.y += dt * (6 + s.speed * 3);
    this.bubble.visible = s.protect > 0;
    if (s.protect > 0) this.bubble.material.opacity = 0.12 + Math.sin(time * 10) * 0.06;
    if (this.flag) this.flag.rotation.y = Math.sin(time * 5) * 0.2;
  }

  setVisible(v) { this.root.visible = v; this.visible = v; }

  foreheadWorld(out) {
    return this.note.getWorldPosition(out);
  }

  dispose() {
    this.root.traverse(o => {
      if (o.isMesh || o.isSprite) {
        if (o.material && o.material !== MAT.black && o.material !== MAT.white && o.material !== MAT.cheek && o.material !== MAT.shoe && o.material !== MAT.bino) {
          if (o.material.map && o.material.map !== this.noteTex) o.material.map.dispose();
          o.material.dispose?.();
        }
      }
    });
    this.noteTex.dispose();
  }
}

export { hatMesh };
