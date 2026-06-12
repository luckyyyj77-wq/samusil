const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const fs = require('fs');

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

// Presentation state
const presentation = {
  active: false,
  presenterId: null,
  chatLocked: false,
};

io.on('connection', (socket) => {
  console.log(`[${new Date().toISOString()}] Client connected: ${socket.id}`);

  // Handle join event
  socket.on('join', (data) => {
    const { name, color, avatar } = data;

    const spawnX = 600 + Math.floor(Math.random() * 200 - 100);
    const spawnY = 600 + Math.floor(Math.random() * 100 - 50);

    const player = {
      id: socket.id,
      name: name || 'Unknown',
      x: spawnX,
      y: spawnY,
      color: color || '#4fc3f7',
      muted: false,
      avatar: avatar || { face: 'smile', outfit: 'none', hat: 'none', skinTone: '#FFDAB9' },
    };

    players.set(socket.id, player);

    // Send current state to joining user
    socket.emit('init', {
      myId: socket.id,
      players: Array.from(players.values()),
      chatHistory: chatHistory
    });

    // Broadcast new user to others
    socket.broadcast.emit('user-joined', player);

    console.log(`[${new Date().toISOString()}] User joined: ${name} (${socket.id}) at (${spawnX}, ${spawnY})`);
  });

  // Handle move event
  socket.on('move', (data) => {
    const player = players.get(socket.id);
    if (!player) return;

    const { x, y } = data;

    // Basic bounds validation
    if (typeof x !== 'number' || typeof y !== 'number') return;
    if (x < 0 || x > 1200 || y < 0 || y > 800) return;

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
    if (!player) return;

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
    if (!player || !data.avatar) return;
    const { face, outfit, hat, skinTone } = data.avatar;
    const allowed = { face: ['smile','sad','angry','surprised','cool','wink'], outfit: ['none','suit','casual','hoodie','dress','chef'], hat: ['none','cap','crown','santa','party','witch'], skinTone: true };
    if (allowed.face.includes(face))   player.avatar.face    = face;
    if (allowed.outfit.includes(outfit)) player.avatar.outfit = outfit;
    if (allowed.hat.includes(hat))     player.avatar.hat     = hat;
    if (typeof skinTone === 'string' && /^#[0-9a-fA-F]{6}$/.test(skinTone)) player.avatar.skinTone = skinTone;
    socket.broadcast.emit('avatar-updated', { id: socket.id, avatar: player.avatar });
  });

  // Handle mute toggle
  socket.on('mute-toggle', (data) => {
    const player = players.get(socket.id);
    if (!player) return;

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
    
    // 이미 누군가 발표 중이면 차단 (본인인 경우는 재진입 허용)
    if (presentation.active && presentation.presenterId !== socket.id) {
      socket.emit('chat-message', {
        id: 'system',
        name: '시스템',
        color: '#ff4444',
        message: '이미 다른 사용자가 발표 중입니다.',
        timestamp: Date.now()
      });
      return;
    }

    const player = players.get(socket.id);
    if (!player) { console.log('[Presentation] player not found'); return; }

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
    if (presentation.presenterId !== socket.id) return;
    const { targetId, muted } = data;
    const target = players.get(targetId);
    if (!target) return;

    target.muted = !!muted;
    io.to(targetId).emit('force-muted', { muted: target.muted });
    socket.broadcast.emit('user-muted', { id: targetId, muted: target.muted });
  });

  // 진행자가 채팅 잠금
  socket.on('presenter-chat-lock', (data) => {
    if (presentation.presenterId !== socket.id) return;
    presentation.chatLocked = !!data.locked;
    io.emit('chat-locked', { locked: presentation.chatLocked });
  });

  // 진행자가 화면 공유 시작 알림
  socket.on('presenter-screen-start', () => {
    if (presentation.presenterId !== socket.id) return;
    socket.broadcast.emit('screen-share-started');
  });

  // 화면공유 WebRTC 시그널 (진행자↔참여자 릴레이)
  socket.on('screen-signal', (data) => {
    const { to, signal } = data;
    if (!to || !signal) return;
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

  // Handle WebRTC signaling (peer-to-peer forwarding)
  socket.on('webrtc-signal', (data) => {
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
