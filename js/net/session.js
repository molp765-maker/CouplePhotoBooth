// Peer-to-peer link between two browsers using PeerJS (global `Peer`).
// A session carries both people's video and a small message channel: send({type, ...}) / on(type, fn).
const PREFIX = 'photobooth-';
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => Array.from({ length: 5 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');

function createSession(role, peer) {
  const handlers = {};
  let conn = null;
  return {
    role, peer, remoteStream: null, connected: false,
    attach(c) {
      conn = c;
      c.on('data', m => handlers[m && m.type] && handlers[m.type](m));
      c.on('close', () => handlers.closed && handlers.closed());
    },
    send(msg) { if (conn && conn.open) conn.send(msg); },
    on(type, fn) { handlers[type] = fn; },
    close() { peer.destroy(); },
  };
}

function readyWhenBoth(s, onReady) {
  let done = false;
  return () => { if (!done && s.connected && s.remoteStream) { done = true; onReady(s); } };
}

export function hostRoom(localStream, { onCode, onReady, onError }) {
  const code = makeCode();
  const peer = new Peer(PREFIX + code);
  const s = createSession('host', peer);
  const check = readyWhenBoth(s, onReady);
  peer.on('open', () => onCode(code));
  peer.on('error', e => {
    if (e.type === 'unavailable-id') { peer.destroy(); hostRoom(localStream, { onCode, onReady, onError }); }
    else onError(e);
  });
  peer.on('connection', conn => {
    s.attach(conn);
    conn.on('open', () => { s.connected = true; check(); });
  });
  peer.on('call', call => {
    call.answer(localStream);
    call.on('stream', r => { s.remoteStream = r; check(); });
  });
}

export function joinRoom(code, localStream, { onReady, onError }) {
  const id = PREFIX + code.trim().toUpperCase();
  const peer = new Peer();
  const s = createSession('guest', peer);
  const check = readyWhenBoth(s, onReady);
  peer.on('error', onError);
  peer.on('open', () => {
    const conn = peer.connect(id, { reliable: true });
    s.attach(conn);
    conn.on('open', () => { s.connected = true; check(); });
    const call = peer.call(id, localStream);
    call.on('stream', r => { s.remoteStream = r; check(); });
  });
}

// Booth for one person: same shape as a real session, but nothing is sent anywhere.
export function soloSession() {
  return { role: 'solo', remoteStream: null, connected: true, send() {}, on() {}, close() {} };
}
