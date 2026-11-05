const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const fs = require('fs');

// 예상치 못한 예외로 서버 전체가 죽는 것을 방지 (한 클라이언트의 잘못된 입력이 전체 접속자에게 영향 주지 않도록)
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});

const app = express();

// SSL 인증서가 있으면 HTTPS, 없으면 HTTP
const SSL_KEY  = path.join(__dirname, 'ssl', 'key.pem');
const SSL_CERT = path.join(__dirname, 'ssl', 'cert.pem');
const hasSSL   = fs.existsSync(SSL_KEY) && fs.existsSync(SSL_CERT);

const server = hasSSL
  ? https.createServer({ key: fs.readFileSync(SSL_KEY), cert: fs.readFileSync(SSL_CERT) }, app)
  : http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT      = process.env.PORT || 3005;
const HTTPS_PORT = process.env.PORT || 3005;

// 로컬 IP 목록
function getLocalIPs() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const iface of Object.values(ifaces)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) ips.push(addr.address);
    }
  }
  return ips;
}

// CSP header — unsafe-eval required by Socket.io client
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; media-src 'self' blob: mediastream:; img-src 'self' data: blob:; worker-src 'self' blob:"
  );
  next();
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Players store: id -> { id, name, x, y, color, muted }
const players = new Map();

// Chat history (last 50 messages)
const chatHistory = [];
const MAX_CHAT_HISTORY = 50;

const AVATAR_OPTIONS = {
  face: ['smile', 'sad', 'angry', 'surprised', 'cool', 'wink'],
  outfit: ['none', 'suit', 'casual', 'hoodie', 'dress', 'chef'],
  hat: ['none', 'cap', 'crown', 'santa', 'party', 'witch'],
};
const DEFAULT_AVATAR = { face: 'smile', outfit: 'none', hat: 'none', skinTone: '#FFDAB9' };

// 허용된 값만 남긴 새 객체를 반환한다. 잘못된 필드는 base 값을 유지한다.
// 아바타는 다른 클라이언트의 렌더링에 그대로 쓰이므로 검증 없이 저장하면 안 된다.
function sanitizeAvatar(input, base = DEFAULT_AVATAR) {
  const source = (input && typeof input === 'object') ? input : {};
  const avatar = { ...base };
  for (const [field, allowed] of Object.entries(AVATAR_OPTIONS)) {
    if (allowed.includes(source[field])) avatar[field] = source[field];
  }
  if (typeof source.skinTone === 'string' && /^#[0-9a-fA-F]{6}$/.test(source.skinTone)) {
    avatar.skinTone = source.skinTone;
  }
  return avatar;
}

// Presentation state
const presentation = {
  active: false,
  presenterId: null,
  chatLocked: false,
};

// 진행자 스팟. public/game.js의 PRES_ROOM(spotX, spotY)과 클라이언트 판정 반경(spotR + 10)과 같은 값이어야 한다
const PRES_SPOT = { x: 990, y: 178, r: 32 };

function isOnPresSpot(player) {
  const dx = player.x - PRES_SPOT.x;
  const dy = player.y - PRES_SPOT.y;
  return dx * dx + dy * dy <= PRES_SPOT.r * PRES_SPOT.r;
}

function presentationSnapshot() {
  const presenter = players.get(presentation.presenterId);
  return {
    active: presentation.active,
    presenterId: presentation.presenterId,
    presenterName: presenter ? presenter.name : '',
    chatLocked: presentation.chatLocked,
  };
}

function sendSystemMessage(socket, message) {
  socket.emit('chat-message', {
    id: 'system',
    name: '시스템',
    color: '#ff4444',
    message,
    timestamp: Date.now()
  });
}

io.on('connection', (socket) => {
  console.log(`[${new Date().toISOString()}] Client connected: ${socket.id}`);

  // Handle join event
  socket.on('join', (data) => {
    if (!data || typeof data !== 'object') return;
    const { name, color, avatar } = data;

    // x는 500~679: 로비 소파(x=700부터)와 아바타 반지름만큼 떨어뜨려 스폰 시 끼이지 않게 한다
    const spawnX = 500 + Math.floor(Math.random() * 180);
    const spawnY = 600 + Math.floor(Math.random() * 100 - 50);

    const safeName = (typeof name === 'string' ? name : '').trim().slice(0, 20) || 'Unknown';
    const safeColor = (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) ? color : '#4fc3f7';

    const player = {
      id: socket.id,
      name: safeName,
      x: spawnX,
      y: spawnY,
      color: safeColor,
      muted: false,
      avatar: sanitizeAvatar(avatar),
    };

    players.set(socket.id, player);

    // Send current state to joining user
    socket.emit('init', {
      myId: socket.id,
      players: Array.from(players.values()),
      chatHistory: chatHistory,
      presentation: presentationSnapshot()
    });

    // Broadcast new user to others
    socket.broadcast.emit('user-joined', player);

    console.log(`[${new Date().toISOString()}] User joined: ${name} (${socket.id}) at (${spawnX}, ${spawnY})`);
  });

  // Handle move event
  socket.on('move', (data) => {
    const player = players.get(socket.id);
    if (!player || !data || typeof data !== 'object') return;

    const { x, y } = data;

    // Basic bounds validation
    if (typeof x !== 'number' || typeof y !== 'number') return;
    if (x < 0 || x >= 1200 || y < 0 || y >= 800) return;

    player.x = Math.round(x);
    player.y = Math.round(y);

    socket.broadcast.emit('user-moved', {
      id: socket.id,
      x: player.x,
      y: player.y
    });
  });

  // Handle chat event
  socket.on('chat', (data) => {
    const player = players.get(socket.id);
    if (!player || !data || typeof data !== 'object') return;

    const { message } = data;
    if (!message || typeof message !== 'string') return;

    const trimmed = message.trim().slice(0, 300); // limit message length
    if (!trimmed) return;

    // 채팅 잠금 중 진행자 외 차단
    if (presentation.chatLocked && socket.id !== presentation.presenterId) return;

    const chatMsg = {
      id: socket.id,
      name: player.name,
      color: player.color,
      message: trimmed,
      timestamp: Date.now()
    };

    // Store in history
    chatHistory.push(chatMsg);
    if (chatHistory.length > MAX_CHAT_HISTORY) {
      chatHistory.shift();
    }

    // Broadcast to all including sender
    io.emit('chat-message', chatMsg);

    console.log(`[Chat] ${player.name}: ${trimmed}`);
  });

  // Handle avatar update
  socket.on('avatar-update', (data) => {
    const player = players.get(socket.id);
    if (!player || !data || typeof data !== 'object' || !data.avatar || typeof data.avatar !== 'object') return;
    player.avatar = sanitizeAvatar(data.avatar, player.avatar);
    socket.broadcast.emit('avatar-updated', { id: socket.id, avatar: player.avatar });
  });

  // Handle mute toggle
  socket.on('mute-toggle', (data) => {
    const player = players.get(socket.id);
    if (!player || !data || typeof data !== 'object') return;

    player.muted = !!data.muted;

    socket.broadcast.emit('user-muted', {
      id: socket.id,
      muted: player.muted
    });
  });

  // ── Presentation events ──────────────────────────────────────

  // 진행자가 프레젠테이션 시작
  socket.on('presentation-start', () => {
    console.log(`[Presentation] start request from ${socket.id}, active=${presentation.active}, presenter=${presentation.presenterId}`);
    
    const player = players.get(socket.id);
    if (!player) { console.log('[Presentation] player not found'); return; }

    if (presentation.active) {
      if (presentation.presenterId !== socket.id) {
        sendSystemMessage(socket, '이미 다른 사용자가 발표 중입니다.');
      }
      return;
    }

    if (!isOnPresSpot(player)) {
      sendSystemMessage(socket, '발표는 시청각실 앞 진행자 스팟에서만 시작할 수 있습니다.');
      return;
    }

    presentation.active = true;
    presentation.presenterId = socket.id;
    presentation.chatLocked = false;

    io.emit('presentation-started', {
      presenterId: socket.id,
      presenterName: player.name,
    });
    console.log(`[Presentation] Started by ${player.name} (${socket.id})`);
  });

  // 진행자가 프레젠테이션 종료
  socket.on('presentation-end', () => {
    if (presentation.presenterId !== socket.id) return;

    presentation.active = false;
    presentation.presenterId = null;
    presentation.chatLocked = false;

    io.emit('presentation-ended', { by: socket.id });
    console.log(`[Presentation] Ended by ${socket.id}`);
  });

  // 진행자가 참여자 강제 음소거
  socket.on('presenter-mute-user', (data) => {
    if (presentation.presenterId !== socket.id || !data || typeof data !== 'object') return;
    const { targetId, muted } = data;
    const target = players.get(targetId);
    if (!target) return;

    target.muted = !!muted;
    io.to(targetId).emit('force-muted', { muted: target.muted });
    socket.broadcast.emit('user-muted', { id: targetId, muted: target.muted });
  });

  // 진행자가 채팅 잠금
  socket.on('presenter-chat-lock', (data) => {
    if (presentation.presenterId !== socket.id || !data || typeof data !== 'object') return;
    presentation.chatLocked = !!data.locked;
    io.emit('chat-locked', { locked: presentation.chatLocked });
  });

  // 진행자가 화면 공유 시작 알림
  socket.on('presenter-screen-start', () => {
    if (presentation.presenterId !== socket.id) return;
    socket.broadcast.emit('screen-share-started');
  });

  // 진행자가 화면 공유 중지 알림
  socket.on('presenter-screen-stop', () => {
    if (presentation.presenterId !== socket.id) return;
    socket.broadcast.emit('screen-share-stopped');
  });

  // 화면공유 WebRTC 시그널 (진행자↔참여자 릴레이). 진행자가 낀 시그널만 전달한다
  socket.on('screen-signal', (data) => {
    if (!data || typeof data !== 'object') return;
    const { to, signal } = data;
    if (!to || !signal) return;
    if (!presentation.presenterId) return;
    if (socket.id !== presentation.presenterId && to !== presentation.presenterId) return;
    const targetSocket = io.sockets.sockets.get(to);
    if (targetSocket) {
      targetSocket.emit('screen-signal', { from: socket.id, signal });
    }
  });

  // 참여자가 진행자에게 화면공유 요청
  socket.on('request-screen', () => {
    if (!presentation.active || !presentation.presenterId) return;
    const presenterSocket = io.sockets.sockets.get(presentation.presenterId);
    if (presenterSocket) {
      presenterSocket.emit('viewer-wants-screen', { viewerId: socket.id });
    }
  });

  // 참여자가 시청을 그만둠 (방 퇴장, 나가기 버튼)
  socket.on('release-screen', () => {
    if (!presentation.active || !presentation.presenterId) return;
    const presenterSocket = io.sockets.sockets.get(presentation.presenterId);
    if (presenterSocket) {
      presenterSocket.emit('viewer-released-screen', { viewerId: socket.id });
    }
  });

  // Handle WebRTC signaling (peer-to-peer forwarding)
  socket.on('webrtc-signal', (data) => {
    if (!data || typeof data !== 'object') return;
    const { to, signal } = data;
    if (!to || !signal) return;

    const targetSocket = io.sockets.sockets.get(to);
    if (targetSocket) {
      targetSocket.emit('webrtc-signal', {
        from: socket.id,
        signal: signal
      });
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    const player = players.get(socket.id);
    if (player) {
      console.log(`[${new Date().toISOString()}] User disconnected: ${player.name} (${socket.id})`);
      players.delete(socket.id);
      socket.broadcast.emit('user-left', { id: socket.id });

      // 진행자가 끊어지면 프레젠테이션 종료
      if (presentation.presenterId === socket.id) {
        presentation.active = false;
        presentation.presenterId = null;
        presentation.chatLocked = false;
        socket.broadcast.emit('presentation-ended', { by: socket.id });
        console.log(`[Presentation] Auto-ended (presenter disconnected)`);
      }
    }
  });
});

const activePort = process.env.PORT || (hasSSL ? HTTPS_PORT : PORT);
const proto      = hasSSL ? 'https' : 'http';

server.listen(activePort, '0.0.0.0', () => {
  const ips = getLocalIPs();
  console.log(`\n========================================`);
  console.log(`  온라인 사무실 서버 실행 중`);
  console.log(`  로컬:    ${proto}://localhost:${activePort}`);
  ips.forEach(ip => console.log(`  모바일:  ${proto}://${ip}:${activePort}`));
  if (!hasSSL) {
    console.log(`\n  ⚠️  모바일 마이크 사용 시 HTTPS 필요`);
    console.log(`  → ssl/ 폴더에 key.pem, cert.pem 생성 후 재시작`);
    console.log(`  → 또는 아래 명령으로 자체서명 인증서 생성:`);
    console.log(`     node gen-cert.js`);
  }
  console.log(`========================================\n`);
});
