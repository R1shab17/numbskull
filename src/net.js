// Peer-to-peer online rooms using WebRTC data channels (PeerJS for signalling).
// The host's browser runs the match; everyone else connects to it with a room code.
import { Peer } from 'peerjs';

const PREFIX = 'numbskull-room-v1-';
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

// Optional self-hosted signalling server: ?signal=https://your-peer-server.example/path
function peerOptions() {
  const o = { debug: 0 };
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
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return "Couldn't reach the matchmaking server. Check your connection. If Numbskull is embedded inside another page, open it from its own page instead, because embedded previews often block online rooms.";
  if (t === 'browser-incompatible') return "This browser doesn't support WebRTC, which online rooms need.";
  return (e && e.message) || 'Connection problem.';
};

export class HostNet {
  constructor(h) { this.h = h; this.conns = new Map(); this.peer = null; this.code = null; this.tries = 0; }

  start(code = makeRoomCode()) {
    this.code = code;
    let opened = false;
    try { this.peer = new Peer(PREFIX + code, peerOptions()); }
    catch (e) { this.h.onError?.(errText(e)); return; }
    const timeout = setTimeout(() => { if (!opened) { this.h.onError?.(errText({ type: 'network' })); this.close(); } }, 12000);
    this.peer.on('open', () => { opened = true; clearTimeout(timeout); this.h.onReady?.(code); });
    this.peer.on('error', (e) => {
      if (e.type === 'unavailable-id' && this.tries++ < 4) { clearTimeout(timeout); this.peer.destroy(); this.start(); return; }
      if (e.type === 'peer-unavailable') return;
      clearTimeout(timeout);
      this.h.onError?.(errText(e));
    });
    this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch { /* ignore */ } });
    this.peer.on('connection', (conn) => {
      conn.on('open', () => { this.conns.set(conn.peer, conn); this.h.onConnect?.(conn); });
      conn.on('data', (d) => this.h.onData?.(conn, d));
      conn.on('close', () => { this.conns.delete(conn.peer); this.h.onClose?.(conn); });
      conn.on('error', () => { this.conns.delete(conn.peer); this.h.onClose?.(conn); });
    });
  }

  send(conn, msg) { try { if (conn.open) conn.send(msg); } catch { /* dropped */ } }
  broadcast(msg, except) { for (const c of this.conns.values()) if (c !== except) this.send(c, msg); }
  kick(conn) { try { conn.close(); } catch { /* ignore */ } }
  close() { try { for (const c of this.conns.values()) c.close(); this.peer?.destroy(); } catch { /* ignore */ } this.conns.clear(); }
}

export class ClientNet {
  constructor(h) { this.h = h; this.peer = null; this.conn = null; }

  start(code) {
    let opened = false;
    try { this.peer = new Peer(peerOptions()); }
    catch (e) { this.h.onError?.(errText(e)); return; }
    const timeout = setTimeout(() => { if (!opened) { this.h.onError?.(errText({ type: 'network' })); this.close(); } }, 15000);
    this.peer.on('open', () => {
      this.conn = this.peer.connect(PREFIX + code.toUpperCase(), { reliable: true, serialization: 'json' });
      this.conn.on('open', () => { opened = true; clearTimeout(timeout); this.h.onOpen?.(); });
      this.conn.on('data', (d) => this.h.onData?.(d));
      this.conn.on('close', () => this.h.onClose?.());
      this.conn.on('error', () => this.h.onClose?.());
    });
    this.peer.on('error', (e) => { clearTimeout(timeout); this.h.onError?.(errText(e)); });
  }

  send(msg) { try { if (this.conn && this.conn.open) this.conn.send(msg); } catch { /* dropped */ } }
  close() { try { this.conn?.close(); this.peer?.destroy(); } catch { /* ignore */ } }
}
