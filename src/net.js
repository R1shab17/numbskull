// Peer-to-peer online rooms using WebRTC data channels (PeerJS for signalling).
// The host's browser runs the match; everyone else connects to it with a room code.
import { Peer } from 'peerjs';

const PREFIX = 'numbskull-room-v3-';
export const PUBLIC_PREFIX = 'numbskull-pub-v3-';

// Messages travel raw: binary snapshots as ArrayBuffers, everything else as JSON text.
// JSON is encoded once per broadcast instead of once per player.
const encode = (msg) => (msg instanceof ArrayBuffer ? msg : JSON.stringify(msg));
const decode = (d) => { if (typeof d !== 'string') return d; try { return JSON.parse(d); } catch { return null; } };
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

// How browsers find a route to each other. Most pairs connect directly (STUN tells each
// browser its public address). When a network blocks that, traffic goes through a relay
// (TURN). In private rooms, Numbskull's own relay (a Metered account) is tried first once its
// login is filled in: it also answers on ports 80 and 443, which strict office and school
// networks usually leave open. Its monthly allowance is small, so public rooms don't use it.
// Browsers need the login to use it, so anyone can read it from the page. Two
// free public relays back it up: PeerJS's own, and Metered's Open Relay Project, whose shared
// secret is published for public use and turned into short-lived credentials below. A page
// can add its own relay first with window.NUMBSKULL_ICE = [{ urls, username, credential }, ...].
const RELAY_HOST = 'global.relay.metered.ca';
const RELAY_LOGIN = { username: '7d4bb7f6fd51134a0b4d1f39', credential: 'G8NjUmVU1s5RvNlM' };
const RELAY = RELAY_LOGIN.username ? [{ urls: [`turn:${RELAY_HOST}:80`, `turn:${RELAY_HOST}:80?transport=tcp`, `turn:${RELAY_HOST}:443`, `turns:${RELAY_HOST}:443?transport=tcp`], ...RELAY_LOGIN }] : [];
const PEERJS_TURN = { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' };
const STUN = { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] };
let openRelay = null;
async function makeOpenRelay() {
  const host = 'staticauth.openrelay.metered.ca';
  const username = `${Math.floor(Date.now() / 1000) + 24 * 3600}:numbskull`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('openrelayprojectsecret'), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(username)));
  const credential = btoa(String.fromCharCode(...sig));
  return { urls: [`turn:${host}:80`, `turn:${host}:443?transport=tcp`, `turns:${host}:443?transport=tcp`], username, credential };
}
try { if (globalThis.crypto && crypto.subtle) makeOpenRelay().then((r) => { openRelay = r; }, () => {}); } catch { /* no WebCrypto: PeerJS's relay only */ }

// own: include Numbskull's own relay (private rooms only)
function iceServers(own) {
  let extra = [];
  try { if (Array.isArray(window.NUMBSKULL_ICE)) extra = window.NUMBSKULL_ICE.filter(x => x && x.urls); } catch { /* ignore */ }
  return [...extra, STUN, ...(own ? RELAY : []), PEERJS_TURN, ...(openRelay ? [openRelay] : [])];
}

// Optional self-hosted signalling server: ?signal=https://your-peer-server.example/path
function peerOptions(own) {
  const o = { debug: 0, config: { iceServers: iceServers(own), sdpSemantics: 'unified-plan' } };
  let sig = null;
  try { sig = new URLSearchParams(location.search).get('signal'); } catch { /* no query string */ }
  sig = sig || window.NUMBSKULL_SIGNAL;
  if (sig) {
    try {
      const u = new URL(sig.includes('://') ? sig : 'https://' + sig);
      o.host = u.hostname; o.secure = u.protocol === 'https:';
      o.port = +u.port || (o.secure ? 443 : 80);
      o.path = u.pathname || '/';
    } catch { /* ignore a malformed value */ }
  }
  return o;
}

export function makeRoomCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  return s;
}

export function onlineSupported() {
  return typeof RTCPeerConnection !== 'undefined' && typeof WebSocket !== 'undefined';
}

const errText = (e) => {
  const t = e && e.type;
  if (t === 'peer-unavailable') return "No room with that code. Check the letters with your host.";
  if (t === 'p2p') return "Found the room, but couldn't open a connection to the host's browser, even through a relay. Some office, school and mobile networks block this. Try again, or one of you try a different network such as a phone hotspot.";
  if (t === 'noanswer') return "Found the room, but the host's browser didn't answer. Ask the host to keep the game open and check their internet, then try again.";
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return "Couldn't reach the matchmaking server. It may be busy, so try again in a minute. If Numbskull is embedded inside another page, open it from its own page instead, because embedded previews often block online rooms.";
  if (t === 'browser-incompatible') return "This browser doesn't support WebRTC, which online rooms need.";
  return (e && e.message) || 'Connection problem.';
};

// Notes which kinds of route each side found while connecting ('host' = same network,
// 'srflx' = public address, 'relay' = through a relay), so a failure can say whose network
// is in the way. A side that reached a relay proves the relays are up.
function watchRoutes(pc) {
  const r = { mine: new Set(), theirs: new Set(), relayErrors: [] };
  if (!pc) return r;
  const kind = (c) => (/ typ (\w+)/.exec((c && c.candidate) || '') || [])[1];
  pc.addEventListener('icecandidate', (e) => { const k = kind(e.candidate); if (k) r.mine.add(k); });
  pc.addEventListener('icecandidateerror', (e) => { if (/^turns?:/.test(e.url || '')) r.relayErrors.push(`${e.url} ${e.errorCode} ${e.errorText || ''}`.trim()); });
  // the host's routes arrive through the matchmaking server and PeerJS hands each to addIceCandidate
  const add = pc.addIceCandidate;
  pc.addIceCandidate = function (c, ...rest) { const k = kind(c); if (k) r.theirs.add(k); return add.call(this, c, ...rest); };
  return r;
}

function p2pText(r) {
  const meRelay = r.mine.has('relay'), hostRelay = r.theirs.has('relay'), hostKnown = r.theirs.size > 0;
  if (!meRelay && hostRelay) return "Found the room, but your browser couldn't connect to the host's directly, and your network wouldn't let it reach a relay server either. Office, school and some mobile networks block this. Switch to a different network, such as a phone hotspot, and try again.";
  if (meRelay && hostKnown && !hostRelay) return "Found the room, but your browser couldn't connect to the host's directly, and the host's network wouldn't let their browser reach a relay server either. Ask the host to switch to a different network, such as a phone hotspot, or have someone else host.";
  if (!meRelay && hostKnown) return "Found the room, but your browser and the host's couldn't connect directly, and neither could reach a relay server to go through instead. Both networks may block this (common on office and school Wi-Fi), or the free relays may be down. One of you try a different network, such as a phone hotspot, or try again later.";
  return errText({ type: 'p2p' });
}

// Problems with the matchmaking (signalling) server. It's only needed to introduce
// browsers to each other, so once a room is open these never end a match.
const SIGNAL = new Set(['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected']);
const OPEN_WAIT = 7000;   // how long to wait for the matchmaking server before trying a fresh connection
const OPEN_TRIES = 3;

export class HostNet {
  constructor(h) { this.h = h; this.conns = new Map(); this.peer = null; this.code = null; this.tries = 0; this.attempt = 0; this.ready = false; this.closed = false; }

  // fullId: claim an exact peer id (public rooms) instead of a random room code
  start(code = makeRoomCode(), fullId = null) {
    this.code = code; this.fullId = fullId;
    this.attempt++;
    let peer;
    try { peer = this.peer = new Peer(fullId || PREFIX + code, peerOptions(!fullId)); }
    catch (e) { this.h.onError?.(errText(e)); return; }
    // the matchmaking server is sometimes slow to answer: start again rather than hang
    const slow = setTimeout(() => { if (this.peer === peer && !this.ready) this.retryOpen(peer); }, OPEN_WAIT);
    peer.on('open', () => {
      if (this.peer !== peer) return;
      clearTimeout(slow);
      this.reconnects = 0;
      if (!this.ready) { this.ready = true; this.h.onReady?.(this.code); }
      else this.h.onSignal?.(true);
    });
    peer.on('error', (e) => {
      if (this.peer !== peer || this.closed) return;
      if (e.type === 'peer-unavailable') return;
      if (e.type === 'unavailable-id') {
        if (this.ready) { this.reconnectSoon(); return; } // our old registration hasn't expired yet
        clearTimeout(slow);
        peer.destroy();
        if (this.fullId) { this.h.onTaken?.(); return; }
        if (this.tries++ < 4) { this.start(); return; }
      }
      if (SIGNAL.has(e.type)) {
        // the room keeps running for everyone already in; reconnect so new players can find it
        if (this.ready) { this.h.onSignal?.(false); this.reconnectSoon(); return; }
        clearTimeout(slow);
        this.retryOpen(peer);
        return;
      }
      if (!this.ready) { clearTimeout(slow); this.h.onError?.(errText(e)); }
    });
    peer.on('disconnected', () => { if (this.peer === peer && this.ready && !this.closed) { this.h.onSignal?.(false); this.reconnectSoon(); } });
    peer.on('connection', (conn) => {
      conn.on('open', () => { this.conns.set(conn.peer, conn); this.h.onConnect?.(conn); });
      conn.on('data', (d) => this.h.onData?.(conn, decode(d)));
      // a player's failed first try can close after their retry got in: don't drop the retry
      const drop = () => { if (this.conns.get(conn.peer) === conn) this.conns.delete(conn.peer); this.h.onClose?.(conn); };
      conn.on('close', drop);
      conn.on('error', drop);
    });
  }

  retryOpen(peer) {
    try { peer.destroy(); } catch { /* already gone */ }
    if (this.closed) return;
    if (this.attempt >= OPEN_TRIES) { this.h.onError?.(errText({ type: 'network' })); return; }
    this.h.onRetry?.(this.attempt + 1);
    setTimeout(() => { if (!this.closed) this.start(this.fullId ? this.code : makeRoomCode(), this.fullId); }, this.attempt === 1 ? 1000 : 3000);
  }

  reconnectSoon() {
    if (this.reconnectT || this.closed) return;
    this.reconnectT = setTimeout(() => {
      this.reconnectT = null;
      const p = this.peer;
      if (!p || p.destroyed || this.closed || !p.disconnected) return;
      this.reconnects = (this.reconnects || 0) + 1;
      try { p.reconnect(); } catch { /* try again below */ }
      // keep trying (backing off) until the server takes us back
      if (this.reconnects < 60) setTimeout(() => { if (this.peer === p && p.disconnected) this.reconnectSoon(); }, Math.min(15000, 1500 * this.reconnects));
    }, 1000);
  }

  send(conn, msg) { this.sendRaw(conn, encode(msg)); }
  sendRaw(conn, data) { try { if (conn.open) conn.send(data); } catch { /* dropped */ } }
  broadcast(msg, except) { const data = encode(msg); for (const c of this.conns.values()) if (c !== except) this.sendRaw(c, data); }
  kick(conn) { try { conn.close(); } catch { /* ignore */ } }
  close() { this.closed = true; clearTimeout(this.reconnectT); try { for (const c of this.conns.values()) c.close(); this.peer?.destroy(); } catch { /* ignore */ } this.conns.clear(); }
}

export class ClientNet {
  constructor(h) { this.h = h; this.peer = null; this.conn = null; this.attempt = 0; this.connected = false; this.closed = false; }

  // timeoutMs: how long to wait for the connection to the host once the room is found
  start(code, fullId = null, timeoutMs = 15000) {
    this.code = code; this.fullId = fullId; this.timeoutMs = timeoutMs;
    this.attempt++;
    let peer;
    try { peer = this.peer = new Peer(peerOptions(!fullId)); }
    catch (e) { this.h.onError?.(errText(e)); return; }
    const slow = setTimeout(() => { if (this.peer === peer && !peer.open) this.retryOpen(peer); }, OPEN_WAIT);
    peer.on('open', () => {
      if (this.peer !== peer || this.conn) return;
      clearTimeout(slow);
      this.dial(peer, 1);
    });
    peer.on('error', (e) => {
      if (this.peer !== peer || this.closed) return;
      // once we're talking to the host, the matchmaking server doesn't matter any more
      if (this.connected) return;
      clearTimeout(slow);
      if (SIGNAL.has(e.type)) { this.retryOpen(peer); return; }
      this.fail(errText(e), e.type);
    });
  }

  dial(peer, n) {
    const conn = this.conn = peer.connect(this.fullId || PREFIX + this.code.toUpperCase(), { reliable: true, serialization: 'raw' });
    // has the host's browser answered? (if so, any failure is the route between us, not the host)
    let answered = false;
    conn.on('iceStateChanged', (st) => { if (st !== 'new') answered = true; });
    const routes = watchRoutes(conn.peerConnection);
    const giveUp = () => {
      if (this.conn !== conn || this.connected || this.closed) return;
      clearTimeout(wait);
      answered = answered || !!(conn.peerConnection && conn.peerConnection.remoteDescription);
      try { conn.close(); } catch { /* ignore */ }
      // the room exists but the link never opened: try once more, then explain
      if (n < 2 && !this.fullId && !peer.destroyed) { this.dial(peer, n + 1); return; } // quick play moves on instead
      if (answered) console.warn(`Numbskull: no route to the host. Your routes: ${[...routes.mine].join(', ') || 'none'}. Host's routes: ${[...routes.theirs].join(', ') || 'none'}. Relay errors: ${routes.relayErrors.join('; ') || 'none'}.`);
      this.fail(answered ? p2pText(routes) : errText({ type: 'noanswer' }), 'timeout');
    };
    const wait = setTimeout(giveUp, n === 1 ? this.timeoutMs : Math.max(8000, this.timeoutMs * 0.6));
    conn.on('open', () => {
      if (this.conn !== conn) return;
      clearTimeout(wait);
      this.connected = true;
      this.h.onOpen?.();
    });
    conn.on('data', (d) => { if (this.conn === conn) this.h.onData?.(decode(d)); });
    conn.on('close', () => { if (this.conn === conn && this.connected) this.h.onClose?.(); });
    conn.on('error', (e) => {
      if (this.conn !== conn) return;
      if (this.connected) { this.h.onClose?.(); return; }
      // every route, relays included, has been tried: no point waiting out the timer
      if (e && e.type === 'negotiation-failed') { answered = true; giveUp(); }
    });
  }

  retryOpen(peer) {
    try { peer.destroy(); } catch { /* already gone */ }
    if (this.closed) return;
    if (this.attempt >= OPEN_TRIES) { this.fail(errText({ type: 'network' }), 'network'); return; }
    this.h.onRetry?.(this.attempt + 1);
    setTimeout(() => { if (!this.closed) { this.conn = null; this.start(this.code, this.fullId, this.timeoutMs); } }, this.attempt === 1 ? 1000 : 3000);
  }

  fail(msg, kind) {
    if (this.closed) return;
    this.h.onError?.(msg, kind);
    this.close();
  }

  send(msg) { try { if (this.conn && this.conn.open) this.conn.send(encode(msg)); } catch { /* dropped */ } }
  close() { this.closed = true; try { this.conn?.close(); this.peer?.destroy(); } catch { /* ignore */ } }
}
