/**
 * socket-client.js
 * Socket.io 클라이언트 - 서버와의 실시간 통신 관리
 */

'use strict';

// ============================================================
// Global state (shared with game.js and webrtc.js)
// ============================================================
const players = new Map();    // id -> { id, name, x, y, color, muted }
let myId = null;
let socket = null;

// Callbacks to be set by game.js
const socketCallbacks = {
  onInit: null,
  onUserJoined: null,
  onUserMoved: null,
  onUserLeft: null,
  onChatMessage: null,
  onUserMuted: null,
  onDisconnect: null,
  onConnect: null,
};

// ============================================================
// Initialize Socket.io connection
// ============================================================
function initSocket() {
  if (socket) return;
  socket = io({
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });

  // Connection established
  socket.on('connect', () => {
    console.log('[Socket] Connected:', socket.id);
    updateConnectionStatus(true);
    if (socketCallbacks.onConnect) socketCallbacks.onConnect();
  });

  // Server sends full initial state after join
  socket.on('init', (data) => {
    console.log('[Socket] Received init:', data);
    myId = data.myId;

    // Populate players map
    players.clear();
    data.players.forEach(p => {
      players.set(p.id, { ...p });
    });

    if (socketCallbacks.onInit) socketCallbacks.onInit(data);
  });

  // New user joined
  socket.on('user-joined', (player) => {
    console.log('[Socket] User joined:', player.name);
    players.set(player.id, { ...player });
    if (socketCallbacks.onUserJoined) socketCallbacks.onUserJoined(player);
  });

  // User moved
  socket.on('user-moved', (data) => {
    const player = players.get(data.id);
    if (player) {
      player.x = data.x;
      player.y = data.y;
    }
    if (socketCallbacks.onUserMoved) socketCallbacks.onUserMoved(data);
  });

  // User left
  socket.on('user-left', (data) => {
    const leaving = players.get(data.id);
    const name = leaving ? leaving.name : null;
    console.log('[Socket] User left:', data.id, name);
    players.delete(data.id);
    if (socketCallbacks.onUserLeft) socketCallbacks.onUserLeft({ ...data, name });
  });

  // Chat message received
  socket.on('chat-message', (data) => {
    if (socketCallbacks.onChatMessage) socketCallbacks.onChatMessage(data);
  });

  // User mute status changed
  socket.on('user-muted', (data) => {
    const player = players.get(data.id);
    if (player) {
      player.muted = data.muted;
    }
    if (socketCallbacks.onUserMuted) socketCallbacks.onUserMuted(data);
  });

  // Avatar customization update
  socket.on('avatar-updated', (data) => {
    const player = players.get(data.id);
    if (player) player.avatar = data.avatar;
  });

  // WebRTC signaling forwarded from server
  socket.on('webrtc-signal', (data) => {
    if (typeof handleWebRTCSignal === 'function') {
      handleWebRTCSignal(data.from, data.signal);
    }
  });

  // Disconnect
  socket.on('disconnect', (reason) => {
    console.log('[Socket] Disconnected:', reason);
    updateConnectionStatus(false);
    if (socketCallbacks.onDisconnect) socketCallbacks.onDisconnect(reason);
  });

  // Reconnect
  socket.on('reconnect', () => {
    console.log('[Socket] Reconnected');
    updateConnectionStatus(true);
  });

  socket.on('connect_error', (err) => {
    console.error('[Socket] Connection error:', err.message);
    updateConnectionStatus(false);
  });
}

// ============================================================
// Emit helpers
// ============================================================
function socketJoin(name, color, avatar) {
  if (!socket) return;
  socket.emit('join', { name, color, avatar });
}

function socketAvatarUpdate(avatar) {
  if (!socket) return;
  socket.emit('avatar-update', { avatar });
}

let lastMoveTime = 0;
const MOVE_THROTTLE_MS = 50;

function socketMove(x, y) {
  if (!socket) return;
  const now = Date.now();
  if (now - lastMoveTime < MOVE_THROTTLE_MS) return;
  lastMoveTime = now;
  socket.emit('move', { x, y });
}

function socketChat(message) {
  if (!socket) return;
  socket.emit('chat', { message });
}

function socketMuteToggle(muted) {
  if (!socket) return;
  socket.emit('mute-toggle', { muted });
}

function socketWebRTCSignal(toId, signal) {
  if (!socket) return;
  socket.emit('webrtc-signal', { to: toId, signal });
}

function socketPresStart()                    { if (!socket) return; socket.emit('presentation-start'); }
function socketPresEnd()                      { if (!socket) return; socket.emit('presentation-end'); }
function socketPresMuteUser(targetId, muted)  { if (!socket) return; socket.emit('presenter-mute-user', { targetId, muted }); }
function socketPresChatLock(locked)           { if (!socket) return; socket.emit('presenter-chat-lock', { locked }); }
function socketPresScreenStart()             { if (!socket) return; socket.emit('presenter-screen-start'); }
function socketScreenSignal(toId, signal)     { if (!socket) return; socket.emit('screen-signal', { to: toId, signal }); }
function socketRequestScreen()               { if (!socket) return; socket.emit('request-screen'); }

// ============================================================
// UI helpers
// ============================================================
function updateConnectionStatus(connected) {
  const el = document.getElementById('connectionStatus');
  if (!el) return;
  if (connected) {
    el.textContent = '● 연결됨';
    el.className = 'status-badge connected';
  } else {
    el.textContent = '● 연결 끊김';
    el.className = 'status-badge disconnected';
  }
}
