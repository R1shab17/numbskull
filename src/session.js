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

// Forehead numbers are need-to-know, so nobody can read them out of their browser. Events that
// carry one go out with it blanked, except to its owner and to spectators, and revealNumbers()
// hands each player the numbers they could actually read (Game.mayRead).
const numOwner = (e) => (e.k === 'spawn' || e.k === 'miss' ? e.id : e.k === 'peel' ? e.v : e.k === 'join' ? e.p?.id : null);
function hideNum(e) {
  if (e.k === 'spawn' || e.k === 'peel') return { ...e, num: '' };
  if (e.k === 'join') return { ...e, p: { ...e.p, state: { ...e.p.state, num: '' } } };
  if (e.k === 'miss') { const { code, ...rest } = e; return rest; } // a wrong guess can still be someone's number
  return e;
}

// A random id for this browser tab, kept across reloads of the tab. If our connection drops
// and we join again, the host recognises us and gives us back our place.
let TAB_ID = null;
function tabId() {
  if (TAB_ID) return TAB_ID;
  try { TAB_ID = sessionStorage.getItem('numbskull.tab'); } catch { /* storage blocked */ }
  if (!TAB_ID) {
    TAB_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { sessionStorage.setItem('numbskull.tab', TAB_ID); } catch { /* storage blocked */ }
  }
  return TAB_ID;
}

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
      onRetry: (n) => { if (!this.public && app.ui.cur === 'message') app.ui.go('message', { title: 'Opening your room…', text: `The matchmaking server is slow to answer. Trying again (${n} of 3)…`, busy: true }); },
      // the matchmaking server dropped out: the match carries on, only new joins wait
      onSignal: (online) => {
        if (online) { clearTimeout(this.signalT); this.signalT = null; if (this.signalDown) app.ui.toast('Back online: new players can join again.'); this.signalDown = false; return; }
        if (this.signalT || this.signalDown) return;
        // short blips are fixed before anyone notices; only mention longer ones
        this.signalT = setTimeout(() => { this.signalT = null; this.signalDown = true; app.ui.toast("The matchmaking server dropped out. Everyone here keeps playing; new players can join once it's back.", 5000); }, 4000);
      },
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
    for (const lp of this.lobby) if (lp.conn) this.sendStart(lp);
  }

  // spectators (and players knocked out of a Battle Royale) see everyone's number
  seesAll(lp) {
    const p = this.app.game?.players.get(lp.id);
    return !!lp.watch || !p || !!p.out;
  }

  sendStart(lp) {
    const state = this.app.game.fullState();
    lp.known = new Map(); // numbers this player's browser has been sent
    if (this.seesAll(lp)) { for (const pi of state.players) if (pi.state.num) lp.known.set(pi.id, pi.state.num); }
    else state.players = state.players.map(pi => (pi.id === lp.id ? pi : { ...pi, state: { ...pi.state, num: '' } }));
    this.net.send(lp.conn, { t: 'start', state, you: lp.id, watch: !!lp.watch });
  }

  sendEvents(evs) {
    if (!evs.some(e => numOwner(e) != null)) { this.net.broadcast({ t: 'ev', e: evs }); return; }
    const hidden = evs.map(hideNum);
    for (const lp of this.lobby) {
      if (!lp.conn) continue;
      const known = lp.known || (lp.known = new Map());
      const all = this.seesAll(lp);
      for (const e of evs) {
        const id = numOwner(e);
        if (id == null || e.k === 'miss') continue;
        if (all || id === lp.id) known.set(id, e.k === 'join' ? e.p.state?.num : e.num); else known.delete(id);
      }
      this.net.send(lp.conn, { t: 'ev', e: all ? evs : evs.map((e, i) => (numOwner(e) === lp.id ? e : hidden[i])) });
    }
  }

  // hand each remote player the numbers they could read right now (their own and teammates' always)
  revealNumbers() {
    const game = this.app.game;
    for (const lp of this.lobby) {
      if (!lp.conn) continue;
      const known = lp.known || (lp.known = new Map());
      const me = game.players.get(lp.id), all = this.seesAll(lp);
      let n = null;
      for (const t of game.players.values()) {
        if (!t.alive || !t.num || known.get(t.id) === t.num) continue;
        if (!all && t.id !== lp.id && !(game.teams && me && t.team === me.team) && !(me && game.mayRead(me, t))) continue;
        known.set(t.id, t.num);
        (n || (n = [])).push([t.id, t.num]);
      }
      if (n) this.net.send(lp.conn, { t: 'nums', n });
    }
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
      // the same browser tab coming back after its connection dropped: give it its old place
      // (same name, same score) instead of adding a second copy of that player
      const cid = typeof msg.cid === 'string' ? msg.cid.slice(0, 40) : null;
      const old = cid && this.lobby.find(p => p.cid === cid && p.conn && p.conn !== conn);
      if (old) {
        this.byConn.delete(old.conn);
        old.conn._gone = true;
        this.net.kick(old.conn);
        old.conn = conn;
        this.byConn.set(conn, old.id);
        if (this.inGame && game) {
          if (!old.watch && !game.players.has(old.id)) { const p = game.addPlayer({ id: old.id, ...this.profileInfo(old), remote: true }); game.emit({ k: 'join', p: game.playerInit(p) }); }
          this.sendStart(old);
        } else this.broadcastLobby();
        return;
      }
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
      const lp = { id, ...info, conn, watch, cid };
      this.lobby.push(lp);
      this.byConn.set(conn, id);
      if (this.inGame && game && watch) {
        // watch the running match
        this.sendStart(lp);
        this.syncWatchers();
      } else if (this.inGame && game) {
        // drop into the running match, replacing a bot if we're full
        if (game.players.size >= MAX_PLAYERS) {
          const bot = [...game.players.values()].find(p => p.isBot);
          if (bot) game.emit({ k: 'leave', id: bot.id });
        }
        const p = game.addPlayer({ id, ...info, remote: true });
        game.emit({ k: 'join', p: game.playerInit(p) });
        this.sendStart(lp);
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
      this.sendEvents(game.outEvents);
      game.outEvents = [];
    }
    this.snapT -= dt;
    if (this.snapT <= 0) { this.snapT = SNAP_RATE; this.net.broadcast(game.snapshot()); this.revealNumbers(); }
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
    this.connect();
  }

  connect() {
    const app = this.app;
    this.net?.close();
    const net = this.net = new ClientNet({
      onOpen: () => { this.rejoining = false; net.send({ t: 'hello', ver: NET_VERSION, cid: tabId(), watch: this.watch, profile: { name: app.profile.name, shirt: app.profile.shirt, skin: app.profile.skin, hat: app.profile.hat } }); },
      onData: (m) => { if (this.net === net) this.onData(m); },
      onRetry: (n) => { if (!this.public && !this.inGame && app.ui.cur === 'join') app.ui.joinStatus(`The matchmaking server is slow to answer. Trying again (${n} of 3)…`); },
      onError: (msg, kind) => {
        if (this.closed || this.net !== net) return;
        if (this.rejoining) { this.rejoining = false; this.lost(kind === 'peer-unavailable' ? 'The host closed the room or lost their connection.' : 'The connection to the host dropped and reconnecting failed.'); this.close(); return; }
        if (this.public && !this.inGame) {
          this.closed = true; net.close();
          const fatal = ['network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible', 'ssl-unavailable'];
          this.onFail?.(kind === 'peer-unavailable' ? 'unavailable' : fatal.includes(kind) ? 'error' : 'timeout', msg);
          return;
        }
        if (this.inGame) this.lost(msg); else app.ui.joinError(msg);
        this.close();
      },
      onClose: () => {
        if (this.closed || this.net !== net) return;
        // a private room: try to get back in (the host keeps our place for a few seconds)
        if (!this.public && (this.rejoins || 0) < 2) { this.rejoin(); return; }
        this.lost('The host closed the room or the connection dropped.');
      },
    });
    if (this.public) net.start(null, publicId(this.slot), 12000);
    else net.start(this.code);
  }

  rejoin() {
    this.rejoins = (this.rejoins || 0) + 1;
    this.rejoining = true;
    this.seen = performance.now();
    this.app.ui.toast('Connection to the host dropped. Reconnecting…', 4000);
    this.connect();
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
        this.rejoins = 0;
        if (!this.inGame) app.ui.go('lobby', { host: false, code: this.code, you: this.id, players: m.players, settings: m.settings });
        break;
      case 'tolobby':
        this.inGame = false;
        app.endMatchView();
        app.ui.go('lobby', { host: false, code: this.code, you: this.id, players: this.lobbyData?.players || [], settings: this.lobbyData?.settings || app.match });
        break;
      case 'start': {
        this.id = m.you;
        this.rejoins = 0;
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
      // numbers we can now read (see HostSession.revealNumbers)
      case 'nums': if (app.game && this.inGame && Array.isArray(m.n)) for (const [id, num] of m.n) { const p = app.game.players.get(id); if (p) p.num = String(num); } break;
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
    if (this.seen && now - this.seen > 10000 && !this.closed && !this.rejoining) {
      if (!this.public && (this.rejoins || 0) < 2) { this.rejoin(); return; }
      this.lost('Lost contact with the host.'); this.close(); return;
    }
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
