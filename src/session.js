// Online sessions. The host runs the real Game and relays it; clients mirror it.
import { HostNet, ClientNet, onlineSupported } from './net.js';
import { Game, NET } from './game.js';
import { MAX_PLAYERS, NET_VERSION, PUBLIC } from './config.js';
import { PUBLIC_PREFIX } from './net.js';
import { MAPS } from './maps.js';
import { builtInMaps } from './packs.js';

// Spectators don't take a player slot, but a room can't hold unlimited connections.
export const MAX_WATCHERS = 12;
const lobbyView = (p) => ({ id: p.id, name: p.name, shirt: p.shirt, host: p.host, watch: !!p.watch });

export const publicId = (slot) => PUBLIC_PREFIX + slot;

const SNAP_RATE = 1 / NET.snapRate;
const STATE_RATE = 1 / NET.stateRate;

export class HostSession {
  // opts.public: a Quick play room that runs back-to-back Battle Royale rounds
  constructor(app, opts = {}) {
    this.app = app;
    this.public = !!opts.public;
    this.slot = opts.slot || 0;
    this.onTaken = opts.onTaken;
    this.type = 'host';
    this.net = null;
    this.code = null;
    this.lobby = [];        // [{ id, name, shirt, skin, hat, conn, host }]
    this.byConn = new Map();
    this.snapT = 0;
    this.nextId = 2;
    this.inGame = false;
  }

  open() {
    const app = this.app;
    if (!onlineSupported()) { app.ui.go('message', { title: 'Online rooms unavailable here', text: "This page can't open peer-to-peer connections, which online rooms need. Open Numbskull from its own page (for example a GitHub Pages link) to host or join. Bots work everywhere." }); return; }
    if (!this.public) app.ui.go('message', { title: 'Opening your room…', text: 'Getting a room code from the matchmaking server.', busy: true });
    this.lobby = [{ id: 1, ...this.profileInfo(app.profile), host: true, watch: false }];
    this.net = new HostNet({
      onReady: (code) => {
        this.code = code;
        if (this.public) { this.code = null; this.startMatch(); app.ui.toast('You opened a public room. Others who press Play online will land here.', 4500); }
        else this.showLobby();
      },
      onTaken: () => { this.net = null; this.onTaken?.(); },
      onError: (msg) => { app.ui.go('message', { title: "Couldn't open a room", text: msg }); this.close(true); },
      onConnect: () => {},
      onData: (conn, msg) => this.onData(conn, msg),
      onClose: (conn) => this.onLeave(conn),
    });
    if (this.public) this.net.start('PUB', publicId(this.slot));
    else this.net.start();
  }

  profileInfo(p) { return { name: (p.name || 'Player').slice(0, 16), shirt: p.shirt, skin: p.skin, hat: p.hat }; }

  showLobby() {
    this.inGame = false;
    this.app.ui.go('lobby', { host: true, code: this.code, you: 1, players: this.lobby.map(lobbyView), settings: this.app.match });
    this.broadcastLobby();
  }

  broadcastLobby() {
    if (!this.net) return;
    const msg = { t: 'lobby', code: this.code, players: this.lobby.map(lobbyView), settings: this.app.match };
    this.net.broadcast(msg);
    if (this.app.ui.cur === 'lobby' && !this.inGame) this.app.ui.go('lobby', { host: true, code: this.code, you: 1, players: msg.players, settings: this.app.match });
  }

  // the host switches between playing and watching (lobby toggle)
  setWatch(on) {
    const me = this.lobby.find(p => p.host);
    if (!me) return;
    if (!on && this.playerCount() >= MAX_PLAYERS) { this.app.ui.toast('The room is full of players.'); return; }
    me.watch = !!on;
    this.broadcastLobby();
  }

  playerCount() { return this.lobby.filter(p => !p.watch).length; }
  watcherCount() { return this.lobby.filter(p => p.watch).length; }

  // tell everyone in the match who is watching
  syncWatchers() {
    const game = this.app.game;
    if (!game || !this.inGame) return;
    game.emit({ k: 'watch', list: this.lobby.filter(p => p.watch).map(p => ({ id: p.id, name: p.name })) });
  }

  // a watcher becomes a player in the running match
  jumpIn(lp) {
    const game = this.app.game;
    if (!game || !this.inGame || !lp.watch) return false;
    const humans = [...game.players.values()].filter(p => !p.isBot).length;
    if (humans >= MAX_PLAYERS) return false;
    if (game.players.size >= MAX_PLAYERS) {
      const bot = [...game.players.values()].find(p => p.isBot);
      if (bot) game.emit({ k: 'leave', id: bot.id });
    }
    lp.watch = false;
    const p = game.addPlayer({ id: lp.id, ...this.profileInfo(lp), remote: !lp.host });
    game.emit({ k: 'join', p: game.playerInit(p) });
    game.emit({ k: 'jumped', id: lp.id }); // after the join, so the client already has the player
    this.syncWatchers();
    return true;
  }

  jumpInRequest() { this.hostJumpIn(); }
  hostJumpIn() {
    const me = this.lobby.find(p => p.host);
    if (!me || !this.jumpIn(me)) { this.app.ui.toast('No room to jump in right now.'); return; }
    this.app.becomePlayer(me.id);
  }

  settingsChanged() { this.app.saveMatch(); this.showLobby(); }

  startMatch() {
    const app = this.app;
    const maps = builtInMaps();
    const M = this.public ? { ...PUBLIC.match, mapId: maps[Math.floor(Math.random() * maps.length)].id, bots: Math.max(0, PUBLIC.fill - this.lobby.length) } : app.match;
    const game = new Game({ mapId: M.mapId, mode: M.mode, digits: M.digits, scoreLimit: M.scoreLimit, timeLimit: M.timeLimit, difficulty: M.difficulty, lives: M.lives, authority: true });
    const players = this.lobby.filter(lp => !lp.watch);
    for (const lp of players) {
      const p = game.addPlayer({ id: lp.id, ...this.profileInfo(lp), remote: !lp.host });
      if (lp.host) game.localId = p.id;
    }
    game.watchers = this.lobby.filter(lp => lp.watch).map(lp => ({ id: lp.id, name: lp.name }));
    app.watching = !!this.lobby.find(lp => lp.host && lp.watch);
    game.addBots(Math.max(0, Math.min(M.bots, MAX_PLAYERS - players.length)));
    this.nextRoundAt = null;
    game.on((ev) => { if (ev.k === 'phase' && ev.phase === 'end' && this.public) this.nextRoundAt = performance.now() + (PUBLIC.intermission + 2.6) * 1000; });
    game.balanceTeams();
    this.inGame = true;
    app.beginMatch(game);
    const state = game.fullState();
    for (const lp of this.lobby) if (lp.conn) this.net.send(lp.conn, { t: 'start', state, you: lp.id, watch: !!lp.watch });
  }

  restart() { this.startMatch(); }

  backToLobby() {
    this.app.endMatchView();
    this.net.broadcast({ t: 'tolobby' });
    this.showLobby();
  }

  onData(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    conn._seen = performance.now();
    const app = this.app, game = app.game;
    const pid = this.byConn.get(conn);
    if (msg.t === 'hello') {
      if (msg.ver !== NET_VERSION) { this.net.send(conn, { t: 'reject', reason: 'Your copy of Numbskull is a different version from the host. Refresh both pages and try again.' }); setTimeout(() => this.net.kick(conn), 300); return; }
      const watch = !!msg.watch && !this.public;
      const count = watch ? this.watcherCount() : this.inGame && game ? [...game.players.values()].filter(p => !p.isBot).length : this.playerCount();
      if (count >= (watch ? MAX_WATCHERS : MAX_PLAYERS)) { this.net.send(conn, { t: 'reject', reason: watch ? 'That room already has as many spectators as it can take.' : 'That room is full.', full: true }); setTimeout(() => this.net.kick(conn), 300); return; }
      // ids must not collide with bots already in a running match
      const id = Math.max(this.nextId, game ? game.nextId : 0);
      this.nextId = id + 1;
      const info = this.profileInfo(msg.profile || {});
      // keep names unique
      const names = new Set(this.lobby.map(p => p.name));
      if (game) for (const p of game.players.values()) names.add(p.name);
      let nm = info.name, k = 2; while (names.has(nm)) nm = `${info.name.slice(0, 13)} ${k++}`;
      info.name = nm;
      this.lobby.push({ id, ...info, conn, watch });
      this.byConn.set(conn, id);
      if (this.inGame && game && watch) {
        // watch the running match
        this.net.send(conn, { t: 'start', state: game.fullState(), you: id, watch: true });
        this.syncWatchers();
      } else if (this.inGame && game) {
        // drop into the running match, replacing a bot if we're full
        if (game.players.size >= MAX_PLAYERS) {
          const bot = [...game.players.values()].find(p => p.isBot);
          if (bot) game.emit({ k: 'leave', id: bot.id });
        }
        const p = game.addPlayer({ id, ...info, remote: true });
        game.emit({ k: 'join', p: game.playerInit(p) });
        this.net.send(conn, { t: 'start', state: game.fullState(), you: id });
      } else this.broadcastLobby();
      return;
    }
    if (!pid) return;
    switch (msg.t) {
      case 'st': if (game && this.inGame) game.applyRemoteState(pid, msg.s); break;
      case 'type': if (game && this.inGame && typeof msg.code === 'string' && msg.code.length <= 6) game.tryKill(pid, msg.code, +msg.ms || 0); break;
      case 'throw': if (game && this.inGame && ['flash', 'smoke', 'distract'].includes(msg.g)) game.throwGadget(pid, msg.g, { yaw: +msg.yaw || 0, pitch: +msg.pitch || 0 }); break;
      case 'photo': if (game && this.inGame) { const p = game.players.get(pid); if (p) { p.camCd = 0; game.takePhoto(pid); } } break;
      case 'chat': {
        const text = String(msg.msg || '').slice(0, 120).trim();
        if (text && game && this.inGame) this.emitChat(pid, text);
        break;
      }
      case 'ping': this.net.send(conn, { t: 'pong', c: msg.c }); break;
      case 'watch': {
        // lobby toggle between playing and watching
        const lp = this.lobby.find(p => p.id === pid);
        if (!lp || this.inGame) break;
        if (msg.on && !lp.watch && this.watcherCount() >= MAX_WATCHERS) break;
        if (!msg.on && lp.watch && this.playerCount() >= MAX_PLAYERS) break;
        lp.watch = !!msg.on;
        this.broadcastLobby();
        break;
      }
      case 'jumpin': {
        const lp = this.lobby.find(p => p.id === pid);
        if (!lp || !this.jumpIn(lp)) this.net.send(conn, { t: 'nojump' });
        break;
      }
      case 'bye': this.net.kick(conn); this.onLeave(conn); break;
    }
  }

  // drop anyone we haven't heard from in a while (closed tab, lost wifi)
  reap() {
    const now = performance.now();
    for (const lp of [...this.lobby]) {
      if (!lp.conn) continue;
      const seen = lp.conn._seen || now;
      if (!lp.conn._seen) lp.conn._seen = now;
      if (now - seen > 12000) { this.net.kick(lp.conn); this.onLeave(lp.conn); }
    }
  }

  onLeave(conn) {
    if (conn._gone) return;
    conn._gone = true;
    const id = this.byConn.get(conn);
    if (!id) return;
    this.byConn.delete(conn);
    const was = this.lobby.find(p => p.id === id);
    this.lobby = this.lobby.filter(p => p.id !== id);
    const game = this.app.game;
    if (was && was.watch && this.inGame) { this.syncWatchers(); this.broadcastLobby(); return; }
    if (this.inGame && game && game.players.has(id)) {
      game.emit({ k: 'leave', id, left: true });
      // keep the match lively: top back up with a bot
      if (game.players.size < Math.min(MAX_PLAYERS, this.lobby.length + this.app.match.bots)) { game.addBots(1); game.balanceTeams(); const b = [...game.players.values()].pop(); game.emit({ k: 'join', p: game.playerInit(b) }); }
    } else this.broadcastLobby();
  }

  // Out-of-play people (knocked out in Battle Royale, or watching) only talk to each other
  // while a Battle Royale round is running, so nobody can call out positions.
  emitChat(id, text) {
    const g = this.app.game;
    if (!g) return;
    const p = g.players.get(id);
    const lp = this.lobby.find(x => x.id === id);
    const watch = !p;
    g.emit({ k: 'chat', id, name: p ? undefined : lp?.name, watch, msg: text.slice(0, 120), dead: !!(g.br && g.phase === 'play' && (watch || !p.alive)) });
  }
  sendChat(text) { const g = this.app.game; if (g) this.emitChat(g.localId || 1, text); }

  tick(dt) {
    const game = this.app.game;
    // if this tab itself froze for a while (loading a map on a slow machine), messages are
    // still queued: don't mistake that for everyone else going quiet
    const now = performance.now();
    if (this.lastTick && now - this.lastTick > 2500) for (const lp of this.lobby) if (lp.conn) lp.conn._seen = now;
    this.lastTick = now;
    this.reapT = (this.reapT || 0) - dt;
    if (this.reapT <= 0) { this.reapT = 1; this.reap(); }
    if (this.public && this.nextRoundAt && performance.now() > this.nextRoundAt && this.net) {
      this.nextRoundAt = null;
      // alone in an overflow room: move to the lowest room so players end up together
      if (this.slot > 1 && this.lobby.length <= 1) { this.app.quickPlay(1, 0, 'Moving you to a busier room…'); return; }
      this.startMatch();
      return;
    }
    if (!game || !this.net || !this.inGame) return;
    if (game.outEvents.length) {
      this.net.broadcast({ t: 'ev', e: game.outEvents });
      game.outEvents = [];
    }
    this.snapT -= dt;
    if (this.snapT <= 0) { this.snapT = SNAP_RATE; this.net.broadcast(game.snapshot()); }
  }

  // actions from the local player
  requestKill(code, ms) { this.app.game.tryKill(this.app.game.localId, code, ms); }
  requestThrow(type) { this.app.game.throwGadget(this.app.game.localId, type); }
  requestPhoto() { return this.app.game.takePhoto(this.app.game.localId); }

  close(silent) {
    try { this.net?.broadcast({ t: 'closed' }); } catch { /* ignore */ }
    setTimeout(() => this.net?.close(), 150);
    this.inGame = false;
  }
}

export class ClientSession {
  // opts.public + opts.onFail(kind): Quick play; kind is 'unavailable' | 'full' | 'timeout' | 'error' | 'lost'
  constructor(app, opts = {}) {
    this.app = app; this.type = 'client'; this.net = null; this.code = null; this.id = null;
    this.stateT = 0; this.pingT = 0; this.ping = 0; this.inGame = false; this.closed = false;
    this.public = !!opts.public; this.slot = opts.slot || 0; this.onFail = opts.onFail;
    this.watch = !!opts.watch;
  }

  join(code) {
    const app = this.app;
    this.code = code ? code.toUpperCase() : null;
    if (!onlineSupported()) { if (this.public) this.onFail?.('error', "Online play can't run on this page."); else app.ui.joinError("Online rooms can't run on this page. Open Numbskull from its own page to join."); return; }
    this.net = new ClientNet({
      onOpen: () => this.net.send({ t: 'hello', ver: NET_VERSION, watch: this.watch, profile: { name: app.profile.name, shirt: app.profile.shirt, skin: app.profile.skin, hat: app.profile.hat } }),
      onData: (m) => this.onData(m),
      onError: (msg, kind) => {
        if (this.closed) return;
        if (this.public && !this.inGame) {
          this.closed = true; this.net.close();
          const fatal = ['network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible', 'ssl-unavailable'];
          this.onFail?.(kind === 'peer-unavailable' ? 'unavailable' : fatal.includes(kind) ? 'error' : 'timeout', msg);
          return;
        }
        if (this.inGame) this.lost(msg); else app.ui.joinError(msg);
        this.close();
      },
      onClose: () => { if (!this.closed) this.lost('The host closed the room or the connection dropped.'); },
    });
    if (this.public) this.net.start(null, publicId(this.slot), 12000);
    else this.net.start(this.code);
  }

  lost(text) {
    if (this.closed) return;
    this.closed = true;
    if (this.public) { this.net?.close(); this.onFail?.('lost', text); return; }
    this.app.abandonMatch();
    this.app.ui.go('message', { title: 'Disconnected', text });
  }

  onData(m) {
    if (!m || typeof m !== 'object') return;
    this.seen = performance.now();
    const app = this.app;
    if (m instanceof ArrayBuffer) { if (app.game && this.inGame) app.game.applySnapshot(m); return; }
    switch (m.t) {
      case 'reject':
        this.closed = true; this.net.close();
        if (this.public) this.onFail?.(m.full ? 'full' : 'error', m.reason);
        else app.ui.joinError(m.reason);
        break;
      case 'closed': this.lost('The host closed the room.'); break;
      case 'lobby':
        this.lobbyData = m;
        if (!this.inGame) app.ui.go('lobby', { host: false, code: this.code, you: this.id, players: m.players, settings: m.settings });
        break;
      case 'tolobby':
        this.inGame = false;
        app.endMatchView();
        app.ui.go('lobby', { host: false, code: this.code, you: this.id, players: this.lobbyData?.players || [], settings: this.lobbyData?.settings || app.match });
        break;
      case 'start': {
        this.id = m.you;
        const s = m.state;
        if (!MAPS[s.opts.mapId]) {
          // the host picked a map that only exists on another copy of the game
          this.lost("This room is playing a map your copy of Numbskull doesn't have. Open the game from the same site as your host and join again.");
          this.close();
          break;
        }
        const game = new Game({ ...s.opts, authority: false });
        game.loadState(s);
        game.localId = m.watch ? null : m.you;
        const me = game.players.get(m.you);
        if (me && !m.watch) me.remote = false;
        this.inGame = true;
        app.watching = !!m.watch;
        app.beginMatch(game);
        break;
      }
      case 'nojump': app.ui.toast('No room to jump in right now.'); break;
      case 'ev':
        if (app.game && this.inGame) for (const e of m.e) {
          app.game.applyEvent(e);
          // the host let us jump in from watching
          if (e.k === 'jumped' && e.id === this.id && app.watching) app.becomePlayer(e.id);
        }
        break;

      case 'pong': this.ping = Math.round(performance.now() - m.c); break;
    }
  }

  tick(dt) {
    const now = performance.now();
    if (this.lastTick && now - this.lastTick > 2500 && this.seen) this.seen = now; // we were frozen, not the host
    this.lastTick = now;
    if (this.seen && now - this.seen > 10000 && !this.closed) { this.lost('Lost contact with the host.'); this.close(); return; }
    this.pingT -= dt;
    if (this.pingT <= 0 && this.net) { this.pingT = 2; this.net.send({ t: 'ping', c: performance.now() }); }
    const game = this.app.game;
    if (!game || !this.inGame) return;
    this.stateT -= dt;
    if (this.stateT <= 0 && game.local && game.local.alive) { this.stateT = STATE_RATE; this.net.send(game.localStateMsg()); }
  }

  requestKill(code, ms) { this.net.send({ t: 'type', code, ms }); }
  requestThrow(type) {
    const p = this.app.game.local;
    if (!p || p.inv[type] <= 0) return;
    this.net.send({ t: 'throw', g: type, yaw: p.yaw, pitch: p.pitch });
  }
  requestPhoto() {
    const p = this.app.game.local;
    if (!p || !p.alive || p.camCd > 0) return false;
    p.camCd = 7;
    this.net.send({ t: 'photo' });
    return true;
  }
  sendChat(text) { this.net.send({ t: 'chat', msg: text.slice(0, 120) }); }
  setWatch(on) { this.net.send({ t: 'watch', on: !!on }); }
  jumpInRequest() { this.net.send({ t: 'jumpin' }); }

  close() {
    if (!this.closed) this.net?.send({ t: 'bye' });
    this.closed = true; this.inGame = false;
    setTimeout(() => this.net?.close(), 100);
  }
}
