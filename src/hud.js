// In-game HUD (plain DOM over the canvas).
import { CFG, GADGETS, GADGET_LABEL, TEAM_NAME, TEAM_COLOR } from './config.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GCOL = { flash: '#e8eef6', smoke: '#8fd58c', distract: '#ff8ad8' };
const GKEY = { flash: 'F', smoke: 'S', distract: 'D' };

// The HUD updates every frame. Only touch the DOM when a value actually changes, so a
// steady frame costs the browser no style recalculation or layout.
const hide = (el, v) => { if (el.hidden !== v) el.hidden = v; };
const PROPS = new Set(['className', 'title', 'textContent', 'innerHTML']);
function put(el, key, v) {
  const c = el._put || (el._put = {});
  if (c[key] === v) return;
  c[key] = v;
  if (PROPS.has(key)) el[key] = v;
  else el.style.setProperty(key, v);
}

export class Hud {
  constructor() {
    this.root = $('hud');
    this.el = {
      flash: $('flash'), blindtext: $('blindtext'), bino: $('bino'), watch: $('watch'), timer: $('timer'), sl: $('score-l'), sr: $('score-r'),
      ctf: $('ctf-hud'), feed: $('feed'), minimap: $('minimap'), crosshair: $('crosshair'), markers: $('markers'), big: $('bigmsg'), center: $('centermsg'),
      mynote: $('mynote'), mynum: $('mynum'), eye: $('eye'), typebar: $('typebar'), slots: $('slots'), jambar: $('jambar').firstElementChild, hint: $('typehint'),
      gadgets: $('gadgets'), photo: $('photo'), photocv: $('photocv'), phototime: $('phototime'), death: $('death'), deathby: $('deathby'), deathcode: $('deathcode'), respawn: $('respawn'),
      chatlog: $('chatlog'), chatform: $('chatform'), chatin: $('chatin'), scoreboard: $('scoreboard'), ctp: $('clicktoplay'), fps: $('fps'),
      zonebar: $('zonebar'), zonewarn: $('zonewarn'), zonesecs: $('zonesecs'),
      specName: $('specName'), specInfo: $('specInfo'), specLbl: $('specLbl'), specView: $('specView'), specFast: $('specFast'), specHint: $('specHint'),
    };
    this.buffer = '';
    this.digits = 4;
    this.photoT = 0;
    this.centerT = 0;
    this.lastTimer = '';
    this.hintShown = 0;
    this.miniBase = null;
  }

  show(v) { this.root.hidden = !v; }

  setup(game) {
    this.game = game;
    this.digits = game.digits;
    this.buffer = '';
    this.renderSlots();
    this.el.feed.innerHTML = '';
    this.el.chatlog.innerHTML = '';
    this.el.ctf.hidden = game.mode.id !== 'ctf';
    this.el.zonebar.hidden = !game.br;
    this.el.zonewarn.hidden = true;
    this.root.classList.remove('spectating');
    this.el.death.hidden = true;
    this.el.photo.hidden = true;
    this.el.scoreboard.hidden = true;
    this.buildMinimap(game);
    this.gadgetSig = '';
  }

  // ---------------------------------------------------------------- typing
  renderSlots(state) {
    let h = '';
    for (let i = 0; i < this.digits; i++) {
      const d = this.buffer[i];
      const rot = ((i * 37) % 7 - 3) * 0.8;
      h += `<div class="slot ${d !== undefined ? 'f' : ''} ${i === this.buffer.length ? 'cur' : ''}" style="--rot:${rot}deg">${d ?? ''}</div>`;
    }
    this.el.slots.innerHTML = h;
    this.el.typebar.classList.remove('miss', 'hit');
    if (state) { void this.el.typebar.offsetWidth; this.el.typebar.classList.add(state); }
  }
  setBuffer(b, state) { this.buffer = b; this.renderSlots(state); }

  flashResult(kind, text) {
    this.el.typebar.classList.remove('miss', 'hit');
    void this.el.typebar.offsetWidth;
    this.el.typebar.classList.add(kind);
    this.el.crosshair.classList.remove('hit', 'miss');
    void this.el.crosshair.offsetWidth;
    this.el.crosshair.classList.add(kind);
    clearTimeout(this._rt);
    this._rt = setTimeout(() => { this.el.crosshair.classList.remove('hit', 'miss'); this.buffer = ''; this.renderSlots(); }, kind === 'hit' ? 380 : 650);
    if (text) this.center(text, kind === 'hit' ? 'good' : 'bad');
  }

  center(text, cls = '', dur = 1.4) {
    const c = this.el.center;
    c.textContent = text; c.className = 'show ' + cls;
    this.centerT = dur;
  }

  big(text) {
    const b = this.el.big;
    b.textContent = text;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  }

  // ---------------------------------------------------------------- feed
  feed(html, mine) {
    const d = document.createElement('div');
    d.className = 'fe' + (mine ? ' me' : '');
    d.innerHTML = html;
    this.el.feed.prepend(d);
    while (this.el.feed.children.length > 6) this.el.feed.lastChild.remove();
    setTimeout(() => d.remove(), 7000);
  }
  name(p) { return p ? `<span class="nm ${p.team ? 't' + p.team : ''}">${esc(p.name)}</span>` : '<span class="nm">?</span>'; }
  killFeed(a, v, code, mine) {
    this.feed(`${this.name(a)}<span class="code">${esc(code)}</span>${this.name(v)}`, mine);
  }

  chat(name, msg, team) {
    const d = document.createElement('div');
    d.innerHTML = name ? `<b style="color:${team ? TEAM_COLOR[team] : '#ffe45c'}">${esc(name)}:</b> ${esc(msg)}` : `<i>${esc(msg)}</i>`;
    this.el.chatlog.append(d);
    while (this.el.chatlog.children.length > 6) this.el.chatlog.firstChild.remove();
    setTimeout(() => d.classList.add('old'), 9000);
    setTimeout(() => d.remove(), 10500);
  }

  // ---------------------------------------------------------------- photo
  showPhoto(src) {
    const cv = this.el.photocv;
    const w = 640, h = Math.round(640 * src.height / src.width);
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(src, 0, 0, w, h);
    this.el.photo.hidden = false;
    this.el.photo.style.animation = 'none'; void this.el.photo.offsetWidth; this.el.photo.style.animation = '';
    this.photoT = CFG.photoTime;
  }

  // ---------------------------------------------------------------- minimap
  buildMinimap(game) {
    const W = game.map.width, D = game.map.depth;
    const cv = document.createElement('canvas');
    const S = 3;
    cv.width = W * S; cv.height = D * S;
    const g = cv.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(0, 0, cv.width, cv.height);
    const boxes = [...game.map.boxes].sort((a, b) => (a.y0 + a.h) - (b.y0 + b.h));
    for (const b of boxes) {
      const top = b.y0 + b.h;
      const l = Math.min(0.85, 0.18 + top * 0.12);
      g.fillStyle = `rgba(255,255,255,${l})`;
      g.fillRect((b.x - b.w / 2 + W / 2) * S, (b.z - b.d / 2 + D / 2) * S, b.w * S, b.d * S);
    }
    this.miniBase = cv;
    this.miniScale = Math.min(this.el.minimap.width / W, this.el.minimap.height / D);
  }

  drawMinimap(game, local) {
    const cv = this.el.minimap, g = cv.getContext('2d');
    const W = game.map.width, D = game.map.depth;
    const s = this.miniScale;
    const ox = (cv.width - W * s) / 2, oy = (cv.height - D * s) / 2;
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(this.miniBase, ox, oy, W * s, D * s);
    const P = (x, z) => [ox + (x + W / 2) * s, oy + (z + D / 2) * s];
    for (const pk of game.pickups) if (pk.active) { const [x, y] = P(pk.x, pk.z); g.fillStyle = '#7ef0c8'; g.fillRect(x - 2, y - 2, 4, 4); }
    for (const sm of game.smokes) { const [x, y] = P(sm.x, sm.z); g.fillStyle = 'rgba(220,225,235,0.55)'; g.beginPath(); g.arc(x, y, sm.r * s, 0, 7); g.fill(); }
    for (const d of game.distracts) { const [x, y] = P(d.x, d.z); g.strokeStyle = '#ff8ad8'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 3 + (game.time * 8 % 6), 0, 7); g.stroke(); }
    if (game.zone) {
      const Z = game.zone;
      const [zx, zy] = P(Z.x, Z.z);
      g.save();
      g.beginPath(); g.rect(0, 0, cv.width, cv.height); g.arc(zx, zy, Math.max(0, Z.r * s), 0, Math.PI * 2, true);
      g.fillStyle = 'rgba(255,79,139,0.28)'; g.fill('evenodd');
      g.strokeStyle = '#ff4f8b'; g.lineWidth = 2; g.beginPath(); g.arc(zx, zy, Math.max(0, Z.r * s), 0, Math.PI * 2); g.stroke();
      if (Z.state !== 'final' && Z.nr < Z.r - 0.5) {
        const [nx, ny] = P(Z.nx, Z.nz);
        g.setLineDash([3, 3]); g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.beginPath(); g.arc(nx, ny, Math.max(0, Z.nr * s), 0, Math.PI * 2); g.stroke();
      }
      g.restore();
    }
    if (game.mode.id === 'ctf') for (const t of [1, 2]) {
      const f = game.flags[t]; const [x, y] = P(f.x, f.z);
      g.fillStyle = TEAM_COLOR[t]; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x, y + 5); g.lineTo(x, y - 7); g.lineTo(x + 7, y - 4); g.lineTo(x, y - 1); g.closePath(); g.fill(); g.stroke();
    }
    if (local && (game.teams || (!local.alive && game.br))) {
      for (const p of game.players.values()) {
        if (!p.alive || p.id === local.id || (game.teams && p.team !== local.team && local.alive)) continue;
        const [x, y] = P(p.x, p.z);
        g.fillStyle = p.team ? TEAM_COLOR[p.team] : '#ffe45c'; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill();
      }
    }
    if (local && local.alive) {
      const [x, y] = P(local.x, local.z);
      g.save(); g.translate(x, y); g.rotate(-local.yaw);
      g.fillStyle = '#ffe45c'; g.strokeStyle = '#17141f'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(0, 2.5); g.lineTo(-5, 5); g.closePath(); g.fill(); g.stroke();
      g.restore();
    }
  }

  // ---------------------------------------------------------------- per frame
  update(dt, game, local, view) {
    const E = this.el;
    // timer
    let tt;
    if (game.phase === 'countdown') tt = 'GET READY';
    else { const t = Math.max(0, Math.ceil(game.timeLeft)); tt = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }
    if (tt !== this.lastTimer) { E.timer.textContent = tt; E.timer.classList.toggle('low', game.phase === 'play' && game.timeLeft < 30); this.lastTimer = tt; }
    // scores
    let sl, sr;
    if (game.br) {
      const alive = game.aliveCount();
      sl = `<small>Alive</small>${alive}`;
      sr = `${local ? local.kills : 0}<small>Out</small>`;
      put(E.sl, 'className', 'scorechip'); put(E.sr, 'className', 'scorechip alt'); put(E.sr, 'background', '#fff');
      put(E.sl, 'title', 'Players still in'); put(E.sr, 'title', 'Players you knocked out');
    } else if (game.teams) {
      const lim = game.scoreLimit;
      sl = `<small>Red</small>${game.teamScore[1]}`; sr = `${game.teamScore[2]}<small>Blue</small>`;
      put(E.sl, 'className', 'scorechip red' + (game.teamScore[1] > game.teamScore[2] ? ' lead' : ''));
      put(E.sr, 'className', 'scorechip blue' + (game.teamScore[2] > game.teamScore[1] ? ' lead' : ''));
      put(E.sl, 'title', `First to ${lim}`); put(E.sr, 'title', `First to ${lim}`);
    } else {
      const l = game.leader();
      const me = local;
      sl = `<small>You</small>${me ? me.kills : 0}`;
      const other = l && me && l.id === me.id ? [...game.players.values()].filter(p => p.id !== me.id).sort((a, b) => b.kills - a.kills)[0] : l;
      sr = `${other ? other.kills : 0}<small>${other ? esc(other.name) : '—'}</small>`;
      put(E.sl, 'className', 'scorechip' + (me && l && me.id === l.id ? ' lead' : ''));
      put(E.sr, 'className', 'scorechip alt');
      put(E.sr, 'background', '#fff');
      put(E.sl, 'title', `First to ${game.scoreLimit} reads`); put(E.sr, 'title', `First to ${game.scoreLimit} reads`);
    }
    if (sl !== this._sl) { E.sl.innerHTML = sl; this._sl = sl; }
    if (sr !== this._sr) { E.sr.innerHTML = sr; this._sr = sr; }

    // ctf status
    if (game.mode.id === 'ctf') {
      const st = (t) => { const f = game.flags[t]; if (f.state === 'home') return 'at base'; if (f.state === 'dropped') return `dropped ${Math.ceil(f.dropT)}s`; const c = game.players.get(f.carrier); return c ? `taken by ${esc(c.name)}` : 'taken'; };
      const h = `<span style="border-color:${TEAM_COLOR[1]}">Red flag ${st(1)}</span><span style="border-color:${TEAM_COLOR[2]}">Blue flag ${st(2)}</span>`;
      if (h !== this._ctf) { E.ctf.innerHTML = h; this._ctf = h; }
    }

    // Battle Royale zone status
    if (game.br && game.zone) {
      const Z = game.zone;
      const secs = Math.ceil(Z.t);
      let zt;
      if (game.phase === 'countdown') zt = 'Zone starts shrinking soon';
      else if (Z.state === 'wait') zt = `Zone shrinks in ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      else if (Z.state === 'shrink') zt = 'Zone is shrinking';
      else zt = 'Final zone';
      if (zt !== this._zt) { E.zonebar.textContent = zt; this._zt = zt; }
      E.zonebar.classList.toggle('closing', Z.state === 'shrink');
      const out = local && local.alive && (local.outT || 0) > 0.05 && game.phase === 'play';
      hide(E.zonewarn, !out);
      if (out) put(E.zonesecs, 'textContent', String(Math.max(0, Math.ceil(4 - local.outT))));
    }

    if (!local) return;
    // my number
    const num = local.alive ? local.num : '····';
    if (num !== this._num) { E.mynum.textContent = num; this._num = num; }
    E.mynote.classList.toggle('safe', local.protect > 0);
    const nl = game.br && local.alive ? `On your head · ${local.notes || 1} ${local.notes > 1 ? 'notes' : 'note'} left` : 'On your head';
    if (nl !== this._nl) { E.mynote.querySelector('.lbl').textContent = nl; this._nl = nl; E.mynote.classList.toggle('stack', game.br && (local.notes || 1) > 1); }

    // flash / blind
    const blind = local.alive ? Math.min(1, local.blind * 1.7) : 0;
    put(E.flash, 'opacity', blind.toFixed(3));
    hide(E.blindtext, !(local.blind > CFG.blindKillThreshold));

    // binoculars
    hide(E.bino, !(local.alive && local.zoom && view.mode === 'fp'));
    put(E.crosshair, 'opacity', local.alive && view.mode === 'fp' ? '1' : '0');

    // jam
    E.typebar.classList.toggle('jam', local.jam > 0);
    if (local.jam > 0) put(E.jambar, 'transform', `scaleX(${Math.max(0, local.jam / CFG.jamTime)})`);
    put(E.typebar, 'opacity', local.alive ? '1' : '0.3');
    if (this.hintShown < 25) { this.hintShown += dt; hide(E.hint, false); } else hide(E.hint, true);

    // gadgets
    const sig = GADGETS.map(g => local.inv[g]).join() + view.gadget + Math.ceil(local.camCd * 4) + (local.alive ? 1 : 0);
    if (sig !== this.gadgetSig) {
      this.gadgetSig = sig;
      let h = '';
      for (const g of GADGETS) {
        h += `<div class="gd ${g === view.gadget ? 'sel' : ''} ${local.inv[g] ? '' : 'empty'}"><span class="ic" style="background:${GCOL[g]}">${GKEY[g]}</span><span class="gl">${GADGET_LABEL[g]}</span><span class="ct">${local.inv[g]}</span></div>`;
      }
      const cd = Math.max(0, local.camCd);
      h += `<div class="gd aux ${cd > 0 ? 'empty' : ''}"><span class="k">F</span>Camera ${cd > 0 ? `<span class="cd"><i style="width:${(1 - cd / CFG.cameraCooldown) * 100}%"></i></span>` : '<span class="ct">✓</span>'}</div>`;
      h += `<div class="gd aux"><span class="k">RMB</span>Binoculars</div>`;
      E.gadgets.innerHTML = h;
    }

    // photo
    if (this.photoT > 0) {
      this.photoT -= dt;
      put(E.phototime, 'textContent', String(Math.max(0, Math.ceil(this.photoT))));
      if (this.photoT <= 0) E.photo.hidden = true;
    }
    if (this.centerT > 0) { this.centerT -= dt; if (this.centerT <= 0) E.center.className = ''; }

    // death screen
    if (!local.alive && local.killedBy != null && game.phase !== 'end') {
      hide(E.death, false);
      const k = game.players.get(local.killedBy);
      const by = k ? esc(k.name) : 'someone';
      let html = local.killedCode === 'ZONE' ? 'Caught by the zone' : `Read by ${by}`;
      if (game.br && local.place) html += `<br><span class="place-chip">#${local.place} of ${[...game.players.values()].filter(p => p.spawned).length}</span>`;
      if (this._death !== html + local.killedCode) {
        E.deathby.innerHTML = html;
        E.deathcode.textContent = local.killedCode || '';
        this._death = html + local.killedCode;
      }
      put(E.respawn, 'innerHTML', game.br ? 'Spectating in a moment…' : local.respawnT > 0 || !game.authority ? `Back in <b>${Math.max(1, Math.ceil(local.respawnT))}</b>` : 'Respawning…');
    } else { hide(E.death, true); this._death = ''; }

    this.drawMinimap(game, local);
  }

  spectator(game, view, info) {
    const E = this.el;
    const on = !!info;
    this.root.classList.toggle('spectating', on);
    if (!on) return;
    const t = info.target;
    const god = view.mode === 'spec-god';
    put(E.specLbl, 'textContent', info.late ? 'Next round soon · spectating' : god ? 'God view' : 'Spectating');
    const name = god ? `${game.aliveCount()} left` : t ? t.name : 'nobody';
    if (E.specName.textContent !== name) E.specName.textContent = name;
    const inf = god ? 'Click a player to follow them' : t ? `${t.num} · ${t.kills} out · ${'■'.repeat(t.notes || 1)} ${t.notes > 1 ? 'notes' : 'note'}` : '';
    if (E.specInfo.textContent !== inf) E.specInfo.textContent = inf;
    put(E.specView, 'textContent', god ? 'Follow player' : 'God view');
    E.specView.classList.toggle('on', god);
    hide(E.specFast, !info.canFast);
    put(E.specFast, 'textContent', info.fast ? 'Normal speed' : 'Fast-forward');
    E.specFast.classList.toggle('on', !!info.fast);
    put(E.specHint, 'textContent', god ? 'WASD or drag to pan · wheel to zoom · Q/E to rotate · V to follow' : '← → switch player · V god view · drag to look around');
  }

  setWatched(on, wx, wy) {
    const E = this.el;
    put(E.watch, 'opacity', on ? '1' : '0');
    if (on) { put(E.watch, '--wx', wx + '%'); put(E.watch, '--wy', wy + '%'); }
    hide(E.eye, !on);
    E.mynote.classList.toggle('watched', on);
  }

  markers(list) {
    // list: [{x,y,label,color}]
    let h = '';
    for (const m of list) h += `<div class="mk" style="left:${m.x}px;top:${m.y}px"><span>${esc(m.label)}</span><i style="background:${m.color}"></i></div>`;
    if (h !== this._mk) { this.el.markers.innerHTML = h; this._mk = h; }
  }

  scoreboard(game, show) {
    const E = this.el.scoreboard;
    hide(E, !show);
    this.root.classList.toggle('sb', !!show);
    if (!show) return;
    const me = game.localId;
    const row = (p) => `<tr class="${p.id === me ? 'me' : ''} ${p.alive ? '' : 'dead'}"><td>${esc(p.name)}${p.isBot ? ' <small style="opacity:.5">bot</small>' : ''}</td><td class="n">${p.kills}</td><td class="n">${p.deaths}</td>${game.mode.id === 'ctf' ? `<td class="n">${p.caps}</td>` : ''}<td class="n">${p.misses}</td><td class="n">${p.fastest ? (p.fastest / 1000).toFixed(2) + 's' : '–'}</td></tr>`;
    const head = `<tr><th>Name</th><th class="n">Reads</th><th class="n">Deaths</th>${game.mode.id === 'ctf' ? '<th class="n">Caps</th>' : ''}<th class="n">Misses</th><th class="n">Fastest</th></tr>`;
    const sorted = [...game.players.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    let h = `<h3><span>${game.mode.name} · ${game.map.name}</span><span>${game.teams ? '' : 'First to ' + game.scoreLimit}</span></h3>`;
    if (game.teams) {
      for (const t of [1, 2]) {
        h += `<div class="team${t}"><h3><span>${TEAM_NAME[t]}</span><span>${game.teamScore[t]}</span></h3><table>${head}${sorted.filter(p => p.team === t).map(row).join('')}</table></div>`;
      }
    } else h += `<table>${head}${sorted.map(row).join('')}</table>`;
    if (h !== this._sb) { E.innerHTML = h; this._sb = h; }
  }
}

export { esc };
