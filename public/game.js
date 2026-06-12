/**
 * game.js
 * Canvas 렌더링, 입력 처리, UI 로직 - 핵심 게임 파일
 */

'use strict';

// ============================================================
// Canvas & Context
// ============================================================
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const CANVAS_W = 1200;
const CANVAS_H = 800;

// ============================================================
// Avatar Config (local, updated before join & in-game)
// ============================================================
let myAvatarConfig = { face: 'smile', outfit: 'none', hat: 'none', skinTone: '#FFDAB9' };

// ============================================================
// Mobile Detection & Camera
// ============================================================
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth <= 768;
const camera = { x: 0, y: 0 };
let VIEW_W = canvas.width;
let VIEW_H = canvas.height;

// ============================================================
// Game State
// ============================================================
let myPlayer = null;  // reference to my player in players Map
let selectedColor = '#4fc3f7';
let animFrame = null;

// Input state
const keys = {};
let targetX = null;
let targetY = null;
let isMovingToTarget = false;

// Animation
let animTick = 0;  // for bobbing/wave effects

// Zones
const ZONES = {
  OFFICE: { name: '개인사무실', icon: '🖥️', x: 0, y: 0, w: 480, h: 380 },
  MEETING: { name: '회의실', icon: '📋', x: 480, y: 0, w: 720, h: 380 },
  BREAK: { name: '탕비실', icon: '☕', x: 0, y: 380, w: 300, h: 420 },
  LOBBY: { name: '로비/복도', icon: '🚶', x: 300, y: 380, w: 900, h: 420 },
};

// ============================================================
// 시청각실 (Presentation Room) — 회의실 우측 구역
// ============================================================
const PRES_ROOM = {
  x: 820, y: 8, w: 364, h: 364,   // 회의실 내 우측 영역
  screenX: 856, screenY: 20, screenW: 290, screenH: 140,  // 스크린
  spotX: 990, spotY: 178, spotR: 22,  // 진행자 스팟: 스크린 바로 앞
};

// 프레젠테이션 상태 (서버 동기화)
const presState = {
  active: false,
  presenterId: null,
  presenterName: '',
  chatLocked: false,
};

// 레이아웃 버전 (가구 배치 등 대규모 변경 시 올림)
const LAYOUT_VERSION = '1.2';

// ============================================================
// Office Map Definition
// ============================================================

// Walls: { x, y, w, h } - collision boxes
const walls = [
  // Outer walls (thin boundary boxes to keep players inside)
  { x: 0, y: 0, w: CANVAS_W, h: 8 },          // top
  { x: 0, y: CANVAS_H - 8, w: CANVAS_W, h: 8 }, // bottom
  { x: 0, y: 0, w: 8, h: CANVAS_H },            // left
  { x: CANVAS_W - 8, y: 0, w: 8, h: CANVAS_H }, // right

  // Internal wall: office/meeting divider (vertical, with door gap)
  { x: 472, y: 0, w: 16, h: 160 },
  { x: 472, y: 220, w: 16, h: 160 },   // door gap at y=160~220

  // Internal wall: top zone / bottom zone (horizontal, with doors)
  { x: 0, y: 372, w: 240, h: 16 },
  { x: 300, y: 372, w: 180, h: 16 },   // door gap at x=240~300
  { x: 530, y: 372, w: 670, h: 16 },   // door gap at x=480~530 (meeting room exit)

  // Break room right wall (with door gap for lobby access)
  { x: 292, y: 388, w: 16, h: 120 },
  { x: 292, y: 580, w: 16, h: 220 },  // door gap at y=508~580

  // 시청각실 칸막이 (회의실 내 좌측 구분선, 문 gap 포함)
  { x: 828, y: 8,   w: 12, h: 130 },
  { x: 828, y: 198, w: 12, h: 174 },  // door gap y=138~198
];

// Furniture hit boxes for collision
const furniture = [
  // ---- Personal Office Zone ----
  // Desks (each 70x40)
  { x: 30, y: 30, w: 70, h: 40, type: 'desk' },
  { x: 140, y: 30, w: 70, h: 40, type: 'desk' },
  { x: 250, y: 30, w: 70, h: 40, type: 'desk' },
  { x: 30, y: 160, w: 70, h: 40, type: 'desk' },
  { x: 140, y: 160, w: 70, h: 40, type: 'desk' },
  { x: 250, y: 160, w: 70, h: 40, type: 'desk' },

  // Filing cabinet row
  { x: 360, y: 30, w: 30, h: 80, type: 'cabinet' },
  { x: 400, y: 30, w: 30, h: 80, type: 'cabinet' },

  // Partition walls (thin)
  { x: 112, y: 20, w: 8, h: 110, type: 'partition' },
  { x: 222, y: 20, w: 8, h: 110, type: 'partition' },
  { x: 112, y: 150, w: 8, h: 110, type: 'partition' },
  { x: 222, y: 150, w: 8, h: 110, type: 'partition' },

  // Bookshelf
  { x: 360, y: 130, w: 90, h: 20, type: 'shelf' },
  { x: 250, y: 230, w: 90, h: 20, type: 'shelf' }, // Moved from y:180 to clear the door
  { x: 360, y: 230, w: 90, h: 20, type: 'shelf' },

  // ---- Meeting Room Zone ----
  // (탁자 제거됨)

  // Whiteboard
  { x: 490, y: 30, w: 120, h: 70, type: 'whiteboard' },

  // 시청각실 스크린 (큰 프레젠테이션용)
  { x: 856, y: 20, w: 290, h: 140, type: 'pres-screen' },

  // 시청각실 관람 의자 (스크린 정면)
  { x: 870, y: 200, w: 50, h: 30, type: 'audience-chair' },
  { x: 940, y: 200, w: 50, h: 30, type: 'audience-chair' },
  { x: 1010, y: 200, w: 50, h: 30, type: 'audience-chair' },
  { x: 1080, y: 200, w: 50, h: 30, type: 'audience-chair' },
  { x: 870, y: 250, w: 50, h: 30, type: 'audience-chair' },
  { x: 940, y: 250, w: 50, h: 30, type: 'audience-chair' },
  { x: 1010, y: 250, w: 50, h: 30, type: 'audience-chair' },
  { x: 1080, y: 250, w: 50, h: 30, type: 'audience-chair' },
  { x: 870, y: 300, w: 50, h: 30, type: 'audience-chair' },
  { x: 940, y: 300, w: 50, h: 30, type: 'audience-chair' },
  { x: 1010, y: 300, w: 50, h: 30, type: 'audience-chair' },
  { x: 1080, y: 300, w: 50, h: 30, type: 'audience-chair' },

  // ---- Break Room Zone ----
  // Sofa (L-shape)
  { x: 20, y: 420, w: 100, h: 50, type: 'sofa' },
  { x: 20, y: 470, w: 50, h: 60, type: 'sofa' },

  // Coffee machine
  { x: 150, y: 415, w: 50, h: 40, type: 'coffee' },

  // Counter / kitchen counter
  { x: 20, y: 580, w: 230, h: 30, type: 'counter' },

  // Round table
  { x: 90, y: 490, w: 60, h: 60, type: 'round-table' },

  // Refrigerator
  { x: 230, y: 415, w: 40, h: 60, type: 'fridge' },

  // ---- Lobby Plants ----
  { x: 310, y: 400, w: 30, h: 30, type: 'plant' },
  { x: 310, y: 730, w: 30, h: 30, type: 'plant' },
  { x: 1150, y: 400, w: 30, h: 30, type: 'plant' },
  { x: 1150, y: 730, w: 30, h: 30, type: 'plant' },

  // Lobby reception desk
  { x: 580, y: 430, w: 160, h: 50, type: 'reception' }, // Moved from x:500 to x:580 to clear the meeting room door (x:480~530)

  // Lobby sofas
  { x: 700, y: 600, w: 120, h: 50, type: 'sofa' },
  { x: 900, y: 600, w: 120, h: 50, type: 'sofa' },

  // Lobby coffee table
  { x: 760, y: 680, w: 80, h: 40, type: 'round-table' },
];

// ============================================================
// Map Rendering
// ============================================================
function drawMap() {
  // Background - entire office floor
  ctx.fillStyle = '#1e2640';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Zone floors
  drawZoneFloor(ZONES.OFFICE, '#1a2538', '#243050');
  drawZoneFloor(ZONES.MEETING, '#1f2b3a', '#2a3855');
  drawZoneFloor(ZONES.BREAK, '#1a2a2a', '#213535');
  drawZoneFloor(ZONES.LOBBY, '#1c2230', '#22293d');

  // 시청각실 바닥 (회의실 위에 덮어 그림)
  drawPresRoomFloor();

  // Zone labels
  drawZoneLabel(ZONES.OFFICE);
  drawZoneLabel(ZONES.MEETING);
  drawZoneLabel(ZONES.BREAK);
  drawZoneLabel(ZONES.LOBBY);

  // Draw walls
  drawWalls();

  // Draw furniture
  drawFurniture();

  // 진행자 스팟 (가구 위에)
  drawPresenterSpot();
}

function drawPresRoomFloor() {
  const r = PRES_ROOM;
  ctx.save();
  // 어두운 상영관 느낌
  const grad = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
  grad.addColorStop(0, '#0d1520');
  grad.addColorStop(1, '#141f30');
  ctx.fillStyle = grad;
  ctx.fillRect(r.x, r.y, r.w, r.h);

  // 타일 패턴 (어두운)
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let tx = r.x; tx < r.x + r.w; tx += 40) {
    ctx.beginPath(); ctx.moveTo(tx, r.y); ctx.lineTo(tx, r.y + r.h); ctx.stroke();
  }
  for (let ty = r.y; ty < r.y + r.h; ty += 40) {
    ctx.beginPath(); ctx.moveTo(r.x, ty); ctx.lineTo(r.x + r.w, ty); ctx.stroke();
  }

  // 레이블
  ctx.fillStyle = 'rgba(79,195,247,0.55)';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('🎬 시청각실', r.x + 8, r.y + r.h - 12);
  ctx.restore();
}

function drawPresenterSpot() {
  const { spotX, spotY, spotR } = PRES_ROOM;
  ctx.save();

  const isPresActive = presState.active;
  const pulse = Math.sin(animTick * 0.07) * 0.5 + 0.5;

  if (isPresActive) {
    // 활성: 빨간 링 (발표 중)
    ctx.strokeStyle = `rgba(239,83,80,${0.6 + pulse * 0.4})`;
    ctx.lineWidth = 3;
  } else {
    // 대기: 노란 점선 링
    ctx.strokeStyle = `rgba(255,193,7,${0.5 + pulse * 0.3})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
  }
  ctx.beginPath();
  ctx.arc(spotX, spotY, spotR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // 아이콘
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = 0.7 + pulse * 0.3;
  ctx.fillText(isPresActive ? '🎙️' : '🎤', spotX, spotY);
  ctx.globalAlpha = 1;

  // 라벨
  ctx.fillStyle = isPresActive ? 'rgba(239,83,80,0.9)' : 'rgba(255,193,7,0.8)';
  ctx.font = 'bold 9px sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('진행자', spotX, spotY + spotR + 3);

  ctx.restore();
}

function drawZoneFloor(zone, colorA, colorB) {
  // Checkerboard tile pattern
  const tileSize = 40;
  ctx.save();
  ctx.beginPath();
  ctx.rect(zone.x, zone.y, zone.w, zone.h);
  ctx.clip();

  for (let tx = zone.x; tx < zone.x + zone.w; tx += tileSize) {
    for (let ty = zone.y; ty < zone.y + zone.h; ty += tileSize) {
      const colIdx = Math.floor((tx - zone.x) / tileSize);
      const rowIdx = Math.floor((ty - zone.y) / tileSize);
      ctx.fillStyle = (colIdx + rowIdx) % 2 === 0 ? colorA : colorB;
      ctx.fillRect(tx, ty, tileSize, tileSize);
    }
  }
  ctx.restore();
}

function drawZoneLabel(zone) {
  ctx.save();
  ctx.font = 'bold 12px Segoe UI, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.textAlign = 'left';
  const label = `${zone.icon} ${zone.name}`;
  ctx.fillText(label, zone.x + 12, zone.y + 22);
  ctx.restore();
}

function drawWalls() {
  walls.forEach(wall => {
    // Wall fill
    ctx.fillStyle = '#2c3e6e';
    ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
    // Wall highlight (top edge)
    ctx.fillStyle = '#3a5090';
    ctx.fillRect(wall.x, wall.y, wall.w, 2);
    // Wall shadow (bottom edge)
    ctx.fillStyle = '#1a2445';
    ctx.fillRect(wall.x, wall.y + wall.h - 2, wall.w, 2);
  });
}

function drawFurniture() {
  furniture.forEach(f => {
    switch (f.type) {
      case 'desk': drawDesk(f); break;
      case 'cabinet': drawCabinet(f); break;
      case 'partition': drawPartition(f); break;
      case 'shelf': drawShelf(f); break;
      case 'conference-table': drawConferenceTable(f); break;
      case 'whiteboard': drawWhiteboard(f); break;
      case 'tv': drawTV(f); break;
      case 'pres-screen': drawPresScreen(f); break;
      case 'audience-chair': drawAudienceChair(f); break;
      case 'sofa': drawSofa(f); break;
      case 'coffee': drawCoffeeMachine(f); break;
      case 'counter': drawCounter(f); break;
      case 'round-table': drawRoundTable(f); break;
      case 'fridge': drawFridge(f); break;
      case 'plant': drawPlant(f); break;
      case 'reception': drawReception(f); break;
    }
  });

  // Draw office chairs (near desks)
  drawOfficeChairs();
}

function drawDesk(f) {
  ctx.save();
  // Desk surface
  const grad = ctx.createLinearGradient(f.x, f.y, f.x, f.y + f.h);
  grad.addColorStop(0, '#a07835');
  grad.addColorStop(1, '#7a5a22');
  ctx.fillStyle = grad;
  roundRect(ctx, f.x, f.y, f.w, f.h, 3);
  ctx.fill();

  // Desk border
  ctx.strokeStyle = '#5a3f10';
  ctx.lineWidth = 1.5;
  roundRect(ctx, f.x, f.y, f.w, f.h, 3);
  ctx.stroke();

  // Monitor on top of desk
  const monX = f.x + f.w / 2 - 12;
  const monY = f.y + 4;

  // Monitor stand
  ctx.fillStyle = '#333';
  ctx.fillRect(monX + 10, monY + 20, 4, 8);
  ctx.fillRect(monX + 5, monY + 26, 14, 3);

  // Monitor screen
  ctx.fillStyle = '#1a2540';
  roundRect(ctx, monX, monY, 24, 20, 2);
  ctx.fill();
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1;
  roundRect(ctx, monX, monY, 24, 20, 2);
  ctx.stroke();

  // Screen glow
  ctx.fillStyle = 'rgba(79, 195, 247, 0.3)';
  roundRect(ctx, monX + 2, monY + 2, 20, 16, 1);
  ctx.fill();

  // Keyboard
  ctx.fillStyle = '#555';
  roundRect(ctx, f.x + f.w / 2 - 14, f.y + f.h - 10, 28, 7, 1);
  ctx.fill();

  ctx.restore();
}

function drawOfficeChairs() {
  // Place chairs in front of each desk
  const deskFurniture = furniture.filter(f => f.type === 'desk');
  deskFurniture.forEach(desk => {
    const cx = desk.x + desk.w / 2;
    const cy = desk.y + desk.h + 16;
    drawChair(cx, cy);
  });
}

function drawChair(cx, cy) {
  ctx.save();
  // Seat
  ctx.fillStyle = '#2a3a5c';
  ctx.beginPath();
  ctx.ellipse(cx, cy, 13, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1a2540';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Backrest
  ctx.fillStyle = '#1e2e4e';
  ctx.beginPath();
  ctx.ellipse(cx, cy - 14, 10, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Chair leg shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 4, 10, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCabinet(f) {
  ctx.save();
  ctx.fillStyle = '#8a9abf';
  roundRect(ctx, f.x, f.y, f.w, f.h, 2);
  ctx.fill();
  ctx.strokeStyle = '#6a7a9f';
  ctx.lineWidth = 1;
  roundRect(ctx, f.x, f.y, f.w, f.h, 2);
  ctx.stroke();
  // Drawer handles
  const drawers = 3;
  const dh = f.h / drawers;
  for (let i = 0; i < drawers; i++) {
    ctx.fillStyle = '#c0c8d8';
    ctx.fillRect(f.x + f.w / 2 - 6, f.y + i * dh + dh / 2 - 3, 12, 5);
    // Drawer line
    ctx.strokeStyle = '#5a6a8f';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(f.x + 2, f.y + i * dh);
    ctx.lineTo(f.x + f.w - 2, f.y + i * dh);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPartition(f) {
  ctx.save();
  ctx.fillStyle = '#3a4f7a';
  ctx.fillRect(f.x, f.y, f.w, f.h);
  ctx.strokeStyle = '#2a3c60';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(f.x, f.y, f.w, f.h);
  ctx.restore();
}

function drawShelf(f) {
  ctx.save();
  const grad = ctx.createLinearGradient(f.x, f.y, f.x, f.y + f.h);
  grad.addColorStop(0, '#8a6020');
  grad.addColorStop(1, '#6a4a10');
  ctx.fillStyle = grad;
  ctx.fillRect(f.x, f.y, f.w, f.h);
  ctx.strokeStyle = '#4a3008';
  ctx.lineWidth = 1;
  ctx.strokeRect(f.x, f.y, f.w, f.h);
  // Books
  const bookColors = ['#c0392b', '#2980b9', '#27ae60', '#8e44ad', '#e67e22'];
  const bookW = 10;
  let bx = f.x + 4;
  let bi = 0;
  while (bx + bookW < f.x + f.w - 4) {
    ctx.fillStyle = bookColors[bi % bookColors.length];
    ctx.fillRect(bx, f.y + 2, bookW - 1, f.h - 4);
    bx += bookW;
    bi++;
  }
  ctx.restore();
}

function drawConferenceTable(f) {
  ctx.save();
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  roundRect(ctx, f.x + 4, f.y + 4, f.w, f.h, 6);
  ctx.fill();

  // Table surface
  const grad = ctx.createLinearGradient(f.x, f.y, f.x, f.y + f.h);
  grad.addColorStop(0, '#6b4c1a');
  grad.addColorStop(0.5, '#8b6420');
  grad.addColorStop(1, '#5a3e12');
  ctx.fillStyle = grad;
  roundRect(ctx, f.x, f.y, f.w, f.h, 6);
  ctx.fill();

  // Reflection highlight
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  roundRect(ctx, f.x + 10, f.y + 6, f.w - 20, f.h / 3, 4);
  ctx.fill();

  // Border
  ctx.strokeStyle = '#3a2808';
  ctx.lineWidth = 2;
  roundRect(ctx, f.x, f.y, f.w, f.h, 6);
  ctx.stroke();

  // Meeting room chairs around the table
  const chairPositions = [
    // Top row
    { x: f.x + 50, y: f.y - 22 },
    { x: f.x + 110, y: f.y - 22 },
    { x: f.x + 170, y: f.y - 22 },
    { x: f.x + 230, y: f.y - 22 },
    // Bottom row
    { x: f.x + 50, y: f.y + f.h + 10 },
    { x: f.x + 110, y: f.y + f.h + 10 },
    { x: f.x + 170, y: f.y + f.h + 10 },
    { x: f.x + 230, y: f.y + f.h + 10 },
    // Left & right
    { x: f.x - 22, y: f.y + f.h / 2 - 10 },
    { x: f.x + f.w + 10, y: f.y + f.h / 2 - 10 },
  ];
  chairPositions.forEach(cp => drawChair(cp.x, cp.y));
  ctx.restore();
}

function drawWhiteboard(f) {
  ctx.save();
  // Frame
  ctx.fillStyle = '#7a8090';
  roundRect(ctx, f.x - 3, f.y - 3, f.w + 6, f.h + 6, 3);
  ctx.fill();

  // Board surface
  ctx.fillStyle = '#e8eef5';
  roundRect(ctx, f.x, f.y, f.w, f.h, 2);
  ctx.fill();

  // Some lines on the board
  ctx.strokeStyle = '#a0aacc';
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(f.x + 10, f.y + 15); ctx.lineTo(f.x + 60, f.y + 15); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(f.x + 10, f.y + 25); ctx.lineTo(f.x + 90, f.y + 25); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(f.x + 10, f.y + 35); ctx.lineTo(f.x + 75, f.y + 35); ctx.stroke();
  // Chart
  ctx.strokeStyle = '#4fc3f7';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(f.x + 10, f.y + 58);
  ctx.lineTo(f.x + 30, f.y + 45);
  ctx.lineTo(f.x + 50, f.y + 52);
  ctx.lineTo(f.x + 70, f.y + 40);
  ctx.lineTo(f.x + 90, f.y + 48);
  ctx.stroke();
  ctx.restore();
}

function drawTV(f) {
  ctx.save();
  // TV bezel
  ctx.fillStyle = '#1a1a1a';
  roundRect(ctx, f.x, f.y, f.w, f.h, 4);
  ctx.fill();
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  roundRect(ctx, f.x, f.y, f.w, f.h, 4);
  ctx.stroke();

  // Screen
  const sw = f.w - 8;
  const sh = f.h - 8;
  const sx = f.x + 4;
  const sy = f.y + 4;
  ctx.fillStyle = '#050a1a';
  ctx.fillRect(sx, sy, sw, sh);

  // Screen content (presentation slide)
  ctx.fillStyle = 'rgba(79, 195, 247, 0.2)';
  ctx.fillRect(sx + 4, sy + 4, sw - 8, sh - 8);

  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('MEETING', sx + sw / 2, sy + sh / 2);
  ctx.restore();
}

function drawPresScreen(f) {
  ctx.save();
  // 외곽 프레임
  ctx.fillStyle = '#111';
  roundRect(ctx, f.x - 4, f.y - 4, f.w + 8, f.h + 8, 6);
  ctx.fill();

  if (presState.active && typeof getScreenShareFrame === 'function') {
    // 화면공유 스트림 렌더링
    const frame = getScreenShareFrame();
    if (frame) {
      ctx.drawImage(frame, f.x, f.y, f.w, f.h);
    } else {
      drawScreenStandby(f);
    }
  } else if (presState.active) {
    // 진행 중이지만 아직 스트림 없음
    ctx.fillStyle = '#0a0f1a';
    ctx.fillRect(f.x, f.y, f.w, f.h);
    ctx.fillStyle = 'rgba(239,83,80,0.8)';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('● 발표 준비 중...', f.x + f.w / 2, f.y + f.h / 2);
  } else {
    drawScreenStandby(f);
  }

  // 스크린 테두리 글로우
  ctx.strokeStyle = presState.active ? 'rgba(239,83,80,0.7)' : 'rgba(79,195,247,0.3)';
  ctx.lineWidth = 2;
  ctx.strokeRect(f.x, f.y, f.w, f.h);
  ctx.restore();
}

function drawScreenStandby(f) {
  ctx.fillStyle = '#050a1a';
  ctx.fillRect(f.x, f.y, f.w, f.h);
  // 대기 아이콘
  ctx.fillStyle = 'rgba(79,195,247,0.15)';
  ctx.fillRect(f.x + 4, f.y + 4, f.w - 8, f.h - 8);
  ctx.fillStyle = 'rgba(79,195,247,0.5)';
  ctx.font = '22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🎬', f.x + f.w / 2, f.y + f.h / 2 - 10);
  ctx.font = 'bold 10px sans-serif';
  ctx.fillText('시청각실', f.x + f.w / 2, f.y + f.h / 2 + 14);
}

function drawAudienceChair(f) {
  ctx.save();
  const grad = ctx.createLinearGradient(f.x, f.y, f.x, f.y + f.h);
  grad.addColorStop(0, '#1e3a5f');
  grad.addColorStop(1, '#152b47');
  ctx.fillStyle = grad;
  roundRect(ctx, f.x, f.y, f.w, f.h, 4);
  ctx.fill();
  ctx.strokeStyle = '#0f2035';
  ctx.lineWidth = 1;
  roundRect(ctx, f.x, f.y, f.w, f.h, 4);
  ctx.stroke();
  // 쿠션 라인
  ctx.strokeStyle = 'rgba(79,195,247,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(f.x + f.w / 2, f.y + 3);
  ctx.lineTo(f.x + f.w / 2, f.y + f.h - 3);
  ctx.stroke();
  ctx.restore();
}

function drawSofa(f) {
  ctx.save();
  // Sofa body
  const grad = ctx.createLinearGradient(f.x, f.y, f.x, f.y + f.h);
  grad.addColorStop(0, '#3a4d90');
  grad.addColorStop(1, '#2a3a70');
  ctx.fillStyle = grad;
  roundRect(ctx, f.x, f.y, f.w, f.h, 8);
  ctx.fill();
  ctx.strokeStyle = '#1a2550';
  ctx.lineWidth = 1.5;
  roundRect(ctx, f.x, f.y, f.w, f.h, 8);
  ctx.stroke();

  // Cushion lines
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  if (f.w > f.h) {
    // Horizontal sofa - vertical cushion dividers
    const sections = Math.floor(f.w / 45);
    for (let i = 1; i < sections; i++) {
      const lx = f.x + i * (f.w / sections);
      ctx.beginPath();
      ctx.moveTo(lx, f.y + 5);
      ctx.lineTo(lx, f.y + f.h - 5);
      ctx.stroke();
    }
    // Armrests
    ctx.fillStyle = '#2a3d80';
    roundRect(ctx, f.x, f.y, 12, f.h, 6);
    ctx.fill();
    roundRect(ctx, f.x + f.w - 12, f.y, 12, f.h, 6);
    ctx.fill();
  } else {
    // Vertical sofa - armrests top/bottom
    ctx.fillStyle = '#2a3d80';
    roundRect(ctx, f.x, f.y, f.w, 12, 6);
    ctx.fill();
    roundRect(ctx, f.x, f.y + f.h - 12, f.w, 12, 6);
    ctx.fill();
  }
  ctx.restore();
}

function drawCoffeeMachine(f) {
  ctx.save();
  // Body
  const grad = ctx.createLinearGradient(f.x, f.y, f.x + f.w, f.y);
  grad.addColorStop(0, '#9a9a9a');
  grad.addColorStop(0.5, '#c8c8c8');
  grad.addColorStop(1, '#888');
  ctx.fillStyle = grad;
  roundRect(ctx, f.x, f.y, f.w, f.h, 4);
  ctx.fill();
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 1;
  roundRect(ctx, f.x, f.y, f.w, f.h, 4);
  ctx.stroke();

  // Display panel
  ctx.fillStyle = '#1a3a1a';
  roundRect(ctx, f.x + 6, f.y + 4, f.w - 12, 12, 2);
  ctx.fill();
  ctx.fillStyle = '#00ff88';
  ctx.font = '6px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('☕ READY', f.x + f.w / 2, f.y + 13);

  // Buttons
  const btnColors = ['#e74c3c', '#f39c12', '#2ecc71'];
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = btnColors[i];
    ctx.beginPath();
    ctx.arc(f.x + 10 + i * 14, f.y + f.h - 10, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Coffee drip
  ctx.fillStyle = '#3c2510';
  roundRect(ctx, f.x + f.w / 2 - 8, f.y + f.h - 5, 16, 8, 2);
  ctx.fill();
  ctx.restore();
}

function drawCounter(f) {
  ctx.save();
  // Counter top
  const grad = ctx.createLinearGradient(f.x, f.y, f.x, f.y + f.h);
  grad.addColorStop(0, '#8a9ab0');
  grad.addColorStop(1, '#6a7a90');
  ctx.fillStyle = grad;
  ctx.fillRect(f.x, f.y, f.w, f.h);
  ctx.strokeStyle = '#4a5a70';
  ctx.lineWidth = 1;
  ctx.strokeRect(f.x, f.y, f.w, f.h);
  // Sink
  ctx.fillStyle = '#c0d0e0';
  roundRect(ctx, f.x + f.w - 50, f.y + 4, 40, f.h - 8, 3);
  ctx.fill();
  ctx.fillStyle = '#8090a0';
  ctx.beginPath();
  ctx.arc(f.x + f.w - 30, f.y + f.h / 2, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawRoundTable(f) {
  ctx.save();
  const cx = f.x + f.w / 2;
  const cy = f.y + f.h / 2;
  const r = Math.min(f.w, f.h) / 2;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(cx + 3, cy + 3, r, r * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Table
  const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
  grad.addColorStop(0, '#a07835');
  grad.addColorStop(1, '#6a4e20');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#4a3010';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Top reflection
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.2, cy - r * 0.2, r * 0.4, r * 0.2, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFridge(f) {
  ctx.save();
  // Body
  const grad = ctx.createLinearGradient(f.x, f.y, f.x + f.w, f.y);
  grad.addColorStop(0, '#d0d8e0');
  grad.addColorStop(0.5, '#f0f4f8');
  grad.addColorStop(1, '#b0b8c0');
  ctx.fillStyle = grad;
  roundRect(ctx, f.x, f.y, f.w, f.h, 4);
  ctx.fill();
  ctx.strokeStyle = '#a0a8b0';
  ctx.lineWidth = 1;
  roundRect(ctx, f.x, f.y, f.w, f.h, 4);
  ctx.stroke();

  // Door line
  ctx.strokeStyle = '#909aa0';
  ctx.lineWidth = 0.5;
  const divY = f.y + f.h * 0.4;
  ctx.beginPath();
  ctx.moveTo(f.x + 2, divY);
  ctx.lineTo(f.x + f.w - 2, divY);
  ctx.stroke();

  // Handles
  ctx.fillStyle = '#888';
  ctx.fillRect(f.x + f.w - 8, f.y + 8, 4, 14);
  ctx.fillRect(f.x + f.w - 8, divY + 4, 4, 10);
  ctx.restore();
}

function drawPlant(f) {
  ctx.save();
  const cx = f.x + f.w / 2;
  const cy = f.y + f.h / 2;

  // Pot
  ctx.fillStyle = '#8b4513';
  ctx.beginPath();
  ctx.moveTo(cx - 8, cy + 8);
  ctx.lineTo(cx + 8, cy + 8);
  ctx.lineTo(cx + 6, cy + 16);
  ctx.lineTo(cx - 6, cy + 16);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#a0522d';
  ctx.fillRect(cx - 9, cy + 6, 18, 4);

  // Leaves
  const leafColors = ['#2d7a2d', '#3a9a3a', '#22622a', '#4ab04a'];
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const lx = cx + Math.cos(angle) * 9;
    const ly = cy - 4 + Math.sin(angle) * 9;
    ctx.fillStyle = leafColors[i % leafColors.length];
    ctx.beginPath();
    ctx.ellipse(lx, ly, 7, 5, angle, 0, Math.PI * 2);
    ctx.fill();
  }
  // Center leaf
  ctx.fillStyle = '#3ab03a';
  ctx.beginPath();
  ctx.ellipse(cx, cy - 6, 6, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawReception(f) {
  ctx.save();
  // Curved reception desk
  const grad = ctx.createLinearGradient(f.x, f.y, f.x, f.y + f.h);
  grad.addColorStop(0, '#6a8ab0');
  grad.addColorStop(1, '#4a6a90');
  ctx.fillStyle = grad;
  roundRect(ctx, f.x, f.y, f.w, f.h, 6);
  ctx.fill();
  ctx.strokeStyle = '#3a5a80';
  ctx.lineWidth = 1.5;
  roundRect(ctx, f.x, f.y, f.w, f.h, 6);
  ctx.stroke();

  // Panel on desk
  ctx.fillStyle = '#1a2a40';
  roundRect(ctx, f.x + 10, f.y + 8, 40, 25, 3);
  ctx.fill();
  ctx.fillStyle = '#4fc3f7';
  ctx.font = '6px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('INFO', f.x + 30, f.y + 22);

  // "RECEPTION" label
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('RECEPTION', f.x + f.w / 2, f.y + f.h - 8);
  ctx.restore();
}

// ============================================================
// Avatar Rendering
// ============================================================
const AVATAR_RADIUS = 18;
const PROXIMITY_VIS_DIST = 150;

function drawAvatars() {
  // Draw all remote players first, then local player on top
  const me = myId ? players.get(myId) : null;

  players.forEach((player, id) => {
    if (id === myId) return;
    const isNearby = me ? getDistancePts(me, player) <= PROXIMITY_VIS_DIST : false;
    drawAvatar(player, false, isNearby);
  });

  if (me) {
    drawAvatar(me, true, false);
  }
}

function getDistancePts(a, b) {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

function drawAvatar(player, isMe, isNearby) {
  const { x, y, color, name, muted } = player;

  // 말하기 레벨 (0~1)
  const speakLevel = (typeof getSpeakLevel === 'function') ? getSpeakLevel(player.id) : 0;
  const isSpeaking = speakLevel > 0 && !muted;

  ctx.save();

  // ── 음성 파동 (말할 때) ──────────────────────────────────────
  if (isSpeaking) {
    const waves = 3;
    for (let i = 0; i < waves; i++) {
      const phase   = (animTick * 0.06) - i * 0.6;
      const expand  = (Math.sin(phase) * 0.5 + 0.5);          // 0~1 펄스
      const waveR   = AVATAR_RADIUS + 8 + i * 10 + expand * 8 * speakLevel;
      const alpha   = (1 - i / waves) * 0.55 * speakLevel * (0.6 + 0.4 * expand);
      ctx.beginPath();
      ctx.arc(x, y, waveR, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(100,220,120,${alpha})`;
      ctx.lineWidth   = 2.5 - i * 0.6;
      ctx.stroke();
    }
  }

  // ── 근접 glow ──────────────────────────────────────────────
  if (isNearby && !isSpeaking) {
    ctx.shadowColor = color;
    ctx.shadowBlur  = 20;
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(animTick * 0.08);
    ctx.beginPath();
    ctx.arc(x, y, AVATAR_RADIUS + 8, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.shadowBlur  = 0;
  }

  // ── 내 아바타 점선 링 ──────────────────────────────────────
  if (isMe) {
    ctx.strokeStyle   = '#ffffff';
    ctx.lineWidth     = 3;
    ctx.setLineDash([4, 3]);
    ctx.lineDashOffset = -animTick * 0.3;
    ctx.beginPath();
    ctx.arc(x, y, AVATAR_RADIUS + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── 그림자 ────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(x, y + AVATAR_RADIUS - 2, AVATAR_RADIUS - 4, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── 아바타 몸통 ───────────────────────────────────────────
  ctx.shadowColor = isSpeaking ? '#64dc78' : color;
  ctx.shadowBlur  = isSpeaking ? 18 : (isMe ? 12 : 6);
  const bodyGrad  = ctx.createRadialGradient(x - 5, y - 5, 2, x, y, AVATAR_RADIUS);
  bodyGrad.addColorStop(0, lightenColor(color, 40));
  bodyGrad.addColorStop(1, color);
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.arc(x, y, AVATAR_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur  = 0;
  ctx.strokeStyle = isSpeaking ? 'rgba(100,220,120,0.9)' : 'rgba(255,255,255,0.85)';
  ctx.lineWidth   = isSpeaking ? 2.5 : 2;
  ctx.beginPath();
  ctx.arc(x, y, AVATAR_RADIUS, 0, Math.PI * 2);
  ctx.stroke();

  // ── 옷 (몸통 위, 얼굴 아래) ──────────────────────────────
  const av = player.avatar || {};
  drawOutfit(ctx, x, y, av.outfit, color, AVATAR_RADIUS);

  // ── 얼굴 ─────────────────────────────────────────────────
  drawAvatarFace(x, y, color, av.face, av.skinTone);

  // ── 모자 (얼굴 위) ────────────────────────────────────────
  drawHat(ctx, x, y, av.hat, AVATAR_RADIUS);

  // ── 우측 상단 아이콘 ──────────────────────────────────────
  const iconX = x + 13, iconY = y - 14;
  if (muted) {
    // 빨간 음소거 배지
    ctx.fillStyle = '#ef5350';
    ctx.beginPath();
    ctx.arc(iconX, iconY, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(iconX - 3, iconY - 3); ctx.lineTo(iconX + 3, iconY + 3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(iconX + 3, iconY - 3); ctx.lineTo(iconX - 3, iconY + 3); ctx.stroke();
  } else if (!muted) {
    // 마이크 이모지 (활성 시 항상 표시)
    ctx.font      = '11px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (isSpeaking) {
      // 말하는 중: 초록 배지 + 마이크
      ctx.fillStyle = 'rgba(30,200,80,0.92)';
      ctx.beginPath();
      ctx.arc(iconX, iconY, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText('🎙', iconX, iconY);
    } else {
      // 마이크 켜짐 (조용): 반투명 배지
      ctx.fillStyle = 'rgba(30,60,100,0.75)';
      ctx.beginPath();
      ctx.arc(iconX, iconY, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('🎤', iconX, iconY);
    }
    ctx.textBaseline = 'alphabetic';
  }

  // ── 이름표 ────────────────────────────────────────────────
  drawNameTag(x, y, name, isMe, color);

  ctx.restore();
}

function drawAvatarFace(x, y, color, face, skinTone) { drawAvatarFace2(ctx, x, y, color, face, skinTone); }
function drawAvatarFace2(c, x, y, color, face, skinTone) {
  c.save();
  const skin = skinTone || '#FFDAB9';
  const f    = face    || 'smile';

  // 피부 원 (몸통 위에 살짝 밝게)
  const skinGrad = c.createRadialGradient(x - 3, y - 4, 1, x, y - 1, 10);
  skinGrad.addColorStop(0, lightenColor(skin, 30));
  skinGrad.addColorStop(1, skin);
  c.fillStyle = skinGrad;
  c.beginPath();
  c.arc(x, y, 11, 0, Math.PI * 2);
  c.fill();

  // 눈
  const eyeColor = 'rgba(30,20,10,0.9)';
  if (f === 'cool') {
    // 선글라스
    c.fillStyle = '#1a1a2e';
    roundRect(c, x - 10, y - 6, 8, 5, 2); c.fill();
    roundRect(c, x + 2,  y - 6, 8, 5, 2); c.fill();
    c.strokeStyle = '#555'; c.lineWidth = 1;
    roundRect(c, x - 10, y - 6, 8, 5, 2); c.stroke();
    roundRect(c, x + 2,  y - 6, 8, 5, 2); c.stroke();
    c.beginPath(); c.moveTo(x - 2, y - 4); c.lineTo(x + 2, y - 4); c.stroke();
  } else if (f === 'wink') {
    // 한쪽 윙크
    c.fillStyle = eyeColor;
    c.beginPath(); c.ellipse(x - 5, y - 4, 2.5, 3, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = eyeColor; c.lineWidth = 2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x + 2, y - 4); c.lineTo(x + 8, y - 4); c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.8)';
    c.beginPath(); c.arc(x - 4, y - 5.5, 1, 0, Math.PI * 2); c.fill();
  } else if (f === 'surprised') {
    // 동그란 눈 크게
    c.fillStyle = eyeColor;
    c.beginPath(); c.ellipse(x - 5, y - 4, 3.5, 4, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(x + 5, y - 4, 3.5, 4, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.beginPath(); c.arc(x - 3.5, y - 5.5, 1.4, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(x + 6.5, y - 5.5, 1.4, 0, Math.PI * 2); c.fill();
  } else {
    // 기본 눈
    c.fillStyle = eyeColor;
    c.beginPath(); c.ellipse(x - 5, y - 4, 2.5, 3, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(x + 5, y - 4, 2.5, 3, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.8)';
    c.beginPath(); c.arc(x - 4, y - 5.5, 1, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(x + 6, y - 5.5, 1, 0, Math.PI * 2); c.fill();
  }

  // 눈썹 (화남)
  if (f === 'angry') {
    c.strokeStyle = eyeColor; c.lineWidth = 1.8; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x - 8, y - 8); c.lineTo(x - 2, y - 6); c.stroke();
    c.beginPath(); c.moveTo(x + 8, y - 8); c.lineTo(x + 2, y - 6); c.stroke();
  }

  // 입
  c.strokeStyle = 'rgba(30,20,10,0.85)';
  c.lineWidth   = 1.8;
  c.lineCap     = 'round';
  if (f === 'smile' || f === 'cool' || f === 'wink') {
    c.beginPath(); c.arc(x, y + 3, 5, 0.35, Math.PI - 0.35); c.stroke();
  } else if (f === 'sad') {
    c.beginPath(); c.arc(x, y + 10, 5, Math.PI + 0.35, -0.35); c.stroke();
  } else if (f === 'angry') {
    c.beginPath(); c.arc(x, y + 9, 4, Math.PI + 0.5, -0.5); c.stroke();
  } else if (f === 'surprised') {
    c.beginPath(); c.ellipse(x, y + 5, 3, 4, 0, 0, Math.PI * 2); c.stroke();
  } else {
    c.beginPath(); c.moveTo(x - 4, y + 5); c.lineTo(x + 4, y + 5); c.stroke();
  }

  // 볼터치 (smile/wink)
  if (f === 'smile' || f === 'wink') {
    c.fillStyle = 'rgba(255,150,150,0.28)';
    c.beginPath(); c.ellipse(x - 8, y + 2, 3.5, 2, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(x + 8, y + 2, 3.5, 2, 0, 0, Math.PI * 2); c.fill();
  }

  c.restore();
}

// 옷 그리기
function drawOutfit(ctx, x, y, outfit, color, R) {
  if (!outfit || outfit === 'none') return;
  ctx.save();
  const by = y + R - 4; // 몸통 하단
  switch (outfit) {
    case 'suit': {
      // 검정 재킷
      ctx.fillStyle = '#1a1a2e';
      ctx.beginPath();
      ctx.ellipse(x, by, R * 0.85, R * 0.5, 0, 0, Math.PI);
      ctx.fill();
      // 흰 셔츠
      ctx.fillStyle = '#eee';
      ctx.beginPath();
      ctx.ellipse(x, by, R * 0.3, R * 0.45, 0, 0, Math.PI);
      ctx.fill();
      // 넥타이
      ctx.fillStyle = '#c0392b';
      ctx.beginPath();
      ctx.moveTo(x - 2, by - R * 0.3);
      ctx.lineTo(x + 2, by - R * 0.3);
      ctx.lineTo(x + 3, by + 2);
      ctx.lineTo(x, by + 5);
      ctx.lineTo(x - 3, by + 2);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'casual': {
      ctx.fillStyle = '#3498db';
      ctx.beginPath();
      ctx.ellipse(x, by, R * 0.85, R * 0.5, 0, 0, Math.PI);
      ctx.fill();
      // 칼라
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x - 4, by - R * 0.35); ctx.lineTo(x, by - R * 0.1); ctx.lineTo(x + 4, by - R * 0.35); ctx.stroke();
      break;
    }
    case 'hoodie': {
      ctx.fillStyle = '#7f8c8d';
      ctx.beginPath();
      ctx.ellipse(x, by, R * 0.85, R * 0.5, 0, 0, Math.PI);
      ctx.fill();
      // 후드 끈
      ctx.strokeStyle = '#555'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x - 4, by - R * 0.4); ctx.lineTo(x - 2, by); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 4, by - R * 0.4); ctx.lineTo(x + 2, by); ctx.stroke();
      break;
    }
    case 'dress': {
      ctx.fillStyle = '#e91e8c';
      ctx.beginPath();
      ctx.moveTo(x - R * 0.5, by - R * 0.4);
      ctx.quadraticCurveTo(x - R, by + R * 0.2, x - R * 0.9, by + R * 0.5);
      ctx.lineTo(x + R * 0.9, by + R * 0.5);
      ctx.quadraticCurveTo(x + R, by + R * 0.2, x + R * 0.5, by - R * 0.4);
      ctx.closePath();
      ctx.fill();
      // 리본
      ctx.fillStyle = '#c2185b';
      ctx.beginPath(); ctx.arc(x, by - R * 0.4, 3, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'chef': {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(x, by, R * 0.85, R * 0.5, 0, 0, Math.PI);
      ctx.fill();
      ctx.strokeStyle = '#ccc'; ctx.lineWidth = 1;
      ctx.strokeRect(x - R * 0.85, by - R * 0.5, R * 1.7, R * 0.5);
      // 단추
      ctx.fillStyle = '#888';
      [-3, 0, 3].forEach(dy => { ctx.beginPath(); ctx.arc(x + 5, by + dy, 1.5, 0, Math.PI * 2); ctx.fill(); });
      break;
    }
  }
  ctx.restore();
}

// 모자 그리기
function drawHat(ctx, x, y, hat, R) {
  if (!hat || hat === 'none') return;
  ctx.save();
  const ty = y - R + 1;
  switch (hat) {
    case 'cap': {
      ctx.fillStyle = '#2c3e50';
      ctx.beginPath();
      ctx.ellipse(x, ty, R * 0.85, R * 0.5, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#34495e';
      ctx.beginPath();
      ctx.ellipse(x + 4, ty, R * 0.8, 4, -0.2, 0, Math.PI);
      ctx.fill();
      break;
    }
    case 'crown': {
      ctx.fillStyle = '#f1c40f';
      ctx.beginPath();
      ctx.moveTo(x - R * 0.7, ty);
      ctx.lineTo(x - R * 0.7, ty - 10);
      ctx.lineTo(x - R * 0.3, ty - 5);
      ctx.lineTo(x,            ty - 12);
      ctx.lineTo(x + R * 0.3, ty - 5);
      ctx.lineTo(x + R * 0.7, ty - 10);
      ctx.lineTo(x + R * 0.7, ty);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#e74c3c';
      [x - R * 0.5, x, x + R * 0.5].forEach(cx => {
        ctx.beginPath(); ctx.arc(cx, ty - 2, 2.5, 0, Math.PI * 2); ctx.fill();
      });
      break;
    }
    case 'santa': {
      ctx.fillStyle = '#c0392b';
      ctx.beginPath();
      ctx.moveTo(x - R * 0.7, ty);
      ctx.quadraticCurveTo(x - R * 0.2, ty - 18, x + R * 0.5, ty - 22);
      ctx.quadraticCurveTo(x + R * 0.8, ty - 10, x + R * 0.7, ty);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ecf0f1';
      ctx.beginPath(); ctx.ellipse(x, ty, R * 0.75, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + R * 0.45, ty - 21, 4, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'party': {
      ctx.fillStyle = '#9b59b6';
      ctx.beginPath();
      ctx.moveTo(x - R * 0.6, ty);
      ctx.lineTo(x, ty - 20);
      ctx.lineTo(x + R * 0.6, ty);
      ctx.closePath();
      ctx.fill();
      // 줄무늬
      ctx.strokeStyle = '#f1c40f'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        const p = (i + 1) / 4;
        const bx = x - R * 0.6 + p * R * 1.2, ex = x + p * (0 - R * 0.6);
        ctx.beginPath(); ctx.moveTo(bx, ty); ctx.lineTo(x, ty - 20); ctx.stroke();
      }
      ctx.fillStyle = '#f1c40f';
      ctx.beginPath(); ctx.arc(x, ty - 21, 3.5, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'witch': {
      ctx.fillStyle = '#2c3e50';
      ctx.beginPath();
      ctx.ellipse(x, ty, R * 0.9, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - R * 0.7, ty);
      ctx.lineTo(x - R * 0.2, ty - 8);
      ctx.lineTo(x + R * 0.2, ty - 8);
      ctx.lineTo(x, ty - 22);
      ctx.lineTo(x - R * 0.2, ty - 8);
      ctx.lineTo(x + R * 0.7, ty);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#8e44ad'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(x, ty, R * 0.9, 4, 0, 0, Math.PI * 2); ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

function drawNameTag(x, y, name, isMe, color) {
  ctx.save();
  const displayName = isMe ? `${name} (나)` : name;
  ctx.font = 'bold 11px Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  const textW = ctx.measureText(displayName).width;
  const tagW = textW + 14;
  const tagH = 18;
  const tagX = x - tagW / 2;
  const tagY = y - AVATAR_RADIUS - tagH - 6;

  // Tag background
  ctx.fillStyle = 'rgba(10, 14, 26, 0.85)';
  roundRect(ctx, tagX, tagY, tagW, tagH, 4);
  ctx.fill();

  // Tag border
  ctx.strokeStyle = isMe ? color : 'rgba(255,255,255,0.25)';
  ctx.lineWidth = isMe ? 1.5 : 0.5;
  roundRect(ctx, tagX, tagY, tagW, tagH, 4);
  ctx.stroke();

  // Name text
  ctx.fillStyle = isMe ? color : '#e8eaf6';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 3;
  ctx.fillText(displayName, x, tagY + 13);

  ctx.restore();
}

// ============================================================
// Movement Target Indicator
// ============================================================
function drawMoveTarget() {
  if (!isMovingToTarget || targetX === null) return;
  ctx.save();
  const t = animTick * 0.05;
  const alpha = 0.6 + 0.4 * Math.sin(t * 3);
  const radius = 8 + 4 * Math.sin(t * 2);

  ctx.strokeStyle = `rgba(79, 195, 247, ${alpha})`;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 2]);
  ctx.beginPath();
  ctx.arc(targetX, targetY, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Cross hair
  ctx.strokeStyle = `rgba(79, 195, 247, ${alpha * 0.8})`;
  ctx.lineWidth = 1.5;
  const cSize = 5;
  ctx.beginPath();
  ctx.moveTo(targetX - cSize, targetY); ctx.lineTo(targetX + cSize, targetY);
  ctx.moveTo(targetX, targetY - cSize); ctx.lineTo(targetX, targetY + cSize);
  ctx.stroke();
  ctx.restore();
}

// ============================================================
// Proximity Indicator Lines
// ============================================================
function drawProximityLines() {
  if (!myId) return;
  const me = players.get(myId);
  if (!me) return;

  players.forEach((player, id) => {
    if (id === myId) return;
    const dist = getDistancePts(me, player);
    if (dist <= PROXIMITY_VIS_DIST) {
      const alpha = 1 - (dist / PROXIMITY_VIS_DIST);
      ctx.save();
      ctx.strokeStyle = `rgba(79, 195, 247, ${alpha * 0.4})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(me.x, me.y);
      ctx.lineTo(player.x, player.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  });
}

// ============================================================
// Collision Detection
// ============================================================
function isColliding(newX, newY) {
  const r = AVATAR_RADIUS - 2;

  // Check walls
  for (const wall of walls) {
    if (circleRectCollide(newX, newY, r, wall.x, wall.y, wall.w, wall.h)) {
      return true;
    }
  }

  // Check furniture (관람 의자는 충돌 없음 — 아바타가 앉는 표현)
  for (const f of furniture) {
    if (f.type === 'audience-chair' || f.type === 'pres-screen') continue;
    if (circleRectCollide(newX, newY, r, f.x, f.y, f.w, f.h)) {
      return true;
    }
  }

  return false;
}

function circleRectCollide(cx, cy, cr, rx, ry, rw, rh) {
  const nearestX = Math.max(rx, Math.min(cx, rx + rw));
  const nearestY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  return (dx * dx + dy * dy) < (cr * cr);
}

// ============================================================
// Zone Detection
// ============================================================
function getZone(x, y) {
  for (const [key, zone] of Object.entries(ZONES)) {
    if (x >= zone.x && x < zone.x + zone.w && y >= zone.y && y < zone.y + zone.h) {
      return zone;
    }
  }
  return { name: '?', icon: '?' };
}

// ============================================================
// Player Movement
// ============================================================
const SPEED = 3;
let lastEmitX = null;
let lastEmitY = null;

function updatePlayerMovement() {
  if (!myPlayer) return;

  // ── 발표 중 이동 고정 ───────────────────────────────────
  if (presState.active && presState.presenterId === myId) {
    isMovingToTarget = false;
    targetX = null;
    targetY = null;
    return;
  }

  let moved = false;
  let dx = 0;
  let dy = 0;

  // Keyboard input
  if (keys['w'] || keys['arrowup'])    dy -= SPEED;
  if (keys['s'] || keys['arrowdown'])  dy += SPEED;
  if (keys['a'] || keys['arrowleft'])  dx -= SPEED;
  if (keys['d'] || keys['arrowright']) dx += SPEED;

  // Normalize diagonal movement
  if (dx !== 0 && dy !== 0) {
    const len = Math.sqrt(dx * dx + dy * dy);
    dx = (dx / len) * SPEED;
    dy = (dy / len) * SPEED;
  }

  if (dx !== 0 || dy !== 0) {
    // Keyboard takes priority - cancel click target
    isMovingToTarget = false;
    targetX = null;
    targetY = null;

    const newX = myPlayer.x + dx;
    const newY = myPlayer.y + dy;
    if (!isColliding(newX, myPlayer.y)) myPlayer.x = Math.round(newX);
    if (!isColliding(myPlayer.x, newY)) myPlayer.y = Math.round(newY);
    moved = true;
  } else if (isMovingToTarget && targetX !== null) {
    // Click-to-move
    const tdx = targetX - myPlayer.x;
    const tdy = targetY - myPlayer.y;
    const dist = Math.sqrt(tdx * tdx + tdy * tdy);

    if (dist <= SPEED) {
      myPlayer.x = targetX;
      myPlayer.y = targetY;
      isMovingToTarget = false;
      targetX = null;
      targetY = null;
    } else {
      const nx = (tdx / dist) * SPEED;
      const ny = (tdy / dist) * SPEED;
      const newX = myPlayer.x + nx;
      const newY = myPlayer.y + ny;
      if (!isColliding(newX, myPlayer.y)) myPlayer.x = Math.round(newX);
      if (!isColliding(myPlayer.x, newY)) myPlayer.y = Math.round(newY);
    }
    moved = true;
  }

  if (moved && (myPlayer.x !== lastEmitX || myPlayer.y !== lastEmitY)) {
    socketMove(myPlayer.x, myPlayer.y);
    lastEmitX = myPlayer.x;
    lastEmitY = myPlayer.y;
    updateZoneUI();
  }
}

// ============================================================
// Camera Update
// ============================================================
function updateCamera() {
  if (!isMobile || !myPlayer) return;
  const maxX = Math.max(0, CANVAS_W - VIEW_W);
  const maxY = Math.max(0, CANVAS_H - VIEW_H);
  camera.x = Math.max(0, Math.min(maxX, myPlayer.x - VIEW_W / 2));
  camera.y = Math.max(0, Math.min(maxY, myPlayer.y - VIEW_H / 2));
}

// ============================================================
// Game Loop
// ============================================================
function gameLoop() {
  animTick++;

  try {
    updatePlayerMovement();
    updateCamera();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    if (isMobile) ctx.translate(-camera.x, -camera.y);

    drawMap();
    drawProximityLines();
    drawMoveTarget();
    drawAvatars();

    ctx.restore();

    drawOwnerOverlay();
    checkPresenterSpot();
  } catch (e) {
    console.error('[gameLoop]', e);
  }

  animFrame = requestAnimationFrame(gameLoop);
}

// ============================================================
// UI Updates
// ============================================================
function buildPlayerListItems(players, myId, getZone) {
  const items = [];
  let count = 0;

  players.forEach((player, id) => {
    count++;
    const isMe = id === myId;
    const zone = getZone(player.x, player.y);

    const item = document.createElement('div');
    item.className = `player-item${isMe ? ' is-me' : ''}`;

    const dot = document.createElement('div');
    dot.className = 'player-avatar-dot';
    dot.style.background = player.color;
    dot.textContent = player.name.charAt(0).toUpperCase();

    const onlineDot = document.createElement('div');
    onlineDot.className = 'online-dot';
    dot.appendChild(onlineDot);

    const info = document.createElement('div');
    info.className = 'player-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'player-name-tag';
    nameEl.textContent = isMe ? `${player.name} (나)` : player.name;

    const zoneEl = document.createElement('div');
    zoneEl.className = 'player-zone-tag';
    zoneEl.textContent = `${zone.icon} ${zone.name}`;

    info.appendChild(nameEl);
    info.appendChild(zoneEl);
    item.appendChild(dot);
    item.appendChild(info);

    if (player.muted) {
      const mutedEl = document.createElement('span');
      mutedEl.className = 'muted-icon';
      mutedEl.textContent = '🔇';
      item.appendChild(mutedEl);
    }

    items.push(item);
  });

  return { items, count };
}

function updatePlayerListUI() {
  const listEl  = document.getElementById('playerList');
  const countEl = document.getElementById('playerCount');
  const listMobileEl  = document.getElementById('playerListMobile');
  const countMobileEl = document.getElementById('playerCountMobile');

  const { items, count } = buildPlayerListItems(players, myId, getZone);

  if (listEl) {
    listEl.innerHTML = '';
    items.forEach(item => listEl.appendChild(item.cloneNode(true)));
    if (countEl) countEl.textContent = count;
  }

  if (listMobileEl) {
    listMobileEl.innerHTML = '';
    items.forEach(item => listMobileEl.appendChild(item.cloneNode(true)));
    if (countMobileEl) countMobileEl.textContent = count;
  }
}

function updateZoneUI() {
  if (!myPlayer) return;
  const zone = getZone(myPlayer.x, myPlayer.y);
  const el = document.getElementById('myZoneInfo');
  if (el) el.textContent = `${zone.icon} ${zone.name}`;
}

function buildChatMessage(data) {
  const isSystem = data.system === true;
  const msg = document.createElement('div');
  msg.className = `chat-message${isSystem ? ' system' : ''}`;

  if (!isSystem) {
    const header = document.createElement('div');
    header.className = 'chat-message-header';

    const nameEl = document.createElement('span');
    nameEl.className = 'chat-name';
    nameEl.style.color = data.color || '#4fc3f7';
    nameEl.textContent = data.name;

    const timeEl = document.createElement('span');
    timeEl.className = 'chat-time';
    const d = new Date(data.timestamp || Date.now());
    timeEl.textContent = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

    header.appendChild(nameEl);
    header.appendChild(timeEl);
    msg.appendChild(header);
  }

  const textEl = document.createElement('div');
  textEl.className = 'chat-text';
  textEl.textContent = data.message;
  msg.appendChild(textEl);

  return msg;
}

function appendToChat(containerEl, msgNode, maxItems) {
  containerEl.appendChild(msgNode);
  containerEl.scrollTop = containerEl.scrollHeight;
  while (containerEl.children.length > maxItems) {
    containerEl.removeChild(containerEl.firstChild);
  }
}

function addChatMessage(data) {
  const targets = [
    document.getElementById('chatMessages'),
    document.getElementById('chatMessagesMobile'),
    document.getElementById('presChatMessages'),   // 진행자 뷰 채팅
    document.getElementById('viewerChatMessages'), // 시청자 뷰 채팅
  ];
  targets.forEach(el => {
    if (el) appendToChat(el, buildPresChat(data), 100);
  });
}

// 프레젠테이션 패널용 메시지 (기존 buildChatMessage와 공존)
function buildPresChat(data) {
  const isSystem = data.system === true;
  if (isSystem) {
    const el = document.createElement('div');
    el.className = 'chat-message system';
    const t = document.createElement('div');
    t.className = 'chat-text';
    t.textContent = data.message;
    el.appendChild(t);
    return el;
  }
  const el = document.createElement('div');
  el.className = 'chat-message pres-chat-msg';
  const author = document.createElement('div');
  author.className = 'chat-message-header pres-chat-msg-author';
  author.style.color = data.color || '#4fc3f7';
  const d = new Date(data.timestamp || Date.now());
  const time = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  author.textContent = `${data.name}  ${time}`;
  const text = document.createElement('div');
  text.className = 'chat-text pres-chat-msg-text';
  text.textContent = data.message;
  el.appendChild(author);
  el.appendChild(text);
  return el;
}

function addSystemMessage(message) {
  addChatMessage({ system: true, message });
}

// ============================================================
// Input Handling
// ============================================================
document.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  keys[key] = true;

  // Prevent arrow keys from scrolling
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
    e.preventDefault();
  }
});

document.addEventListener('keyup', (e) => {
  keys[e.key.toLowerCase()] = false;
});

// Canvas click - move to point (disabled in owner mode)
canvas.addEventListener('click', (e) => {
  if (!myPlayer) return;
  if (ownerMode.active) return;  // owner mode handles its own clicks

  const rect = canvas.getBoundingClientRect();
  const scaleX = isMobile ? 1 : CANVAS_W / rect.width;
  const scaleY = isMobile ? 1 : CANVAS_H / rect.height;
  const clickX = Math.round((e.clientX - rect.left) * scaleX) + (isMobile ? camera.x : 0);
  const clickY = Math.round((e.clientY - rect.top)  * scaleY) + (isMobile ? camera.y : 0);

  if (!isColliding(clickX, clickY)) {
    targetX = clickX;
    targetY = clickY;
    isMovingToTarget = true;
  }
});

// ============================================================
// Chat Input
// ============================================================
function setupChatInput() {
  const chatInput = document.getElementById('chatInput');
  const sendBtn = document.getElementById('chatSendBtn');

  function sendChat() {
    if (!chatInput || !chatInput.value.trim()) return;
    socketChat(chatInput.value.trim());
    chatInput.value = '';
    chatInput.focus();
  }

  if (sendBtn) sendBtn.addEventListener('click', sendChat);
  if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChat();
      }
    });
    // Prevent game keys while typing in chat
    chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
    });
  }
}

// ============================================================
// Login / Join Flow
// ============================================================
function setupLoginScreen() {
  // Color picker
  const colorOptions = document.querySelectorAll('.color-option');
  colorOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      colorOptions.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      selectedColor = opt.dataset.color;
    });
  });

  // Join button
  const joinBtn = document.getElementById('joinBtn');
  const nameInput = document.getElementById('playerName');
  const errorEl = document.getElementById('loginError');

  function doJoin() {
    const name = nameInput.value.trim();
    if (!name) {
      errorEl.textContent = '이름을 입력해주세요.';
      nameInput.focus();
      return;
    }
    if (name.length < 1 || name.length > 20) {
      errorEl.textContent = '이름은 1~20자여야 합니다.';
      return;
    }
    errorEl.textContent = '';
    
    // WebRTC 오디오 잠금 해제 (User Gesture)
    if (typeof unlockAudio === 'function') unlockAudio();

    enterGame(name, selectedColor);
  }

  joinBtn.addEventListener('click', doJoin);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doJoin();
  });
  nameInput.focus();
}

function enterGame(name, color) {
  // Show game screen
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('gameScreen').classList.remove('hidden');

  // Init socket if not already
  initSocket();

  // Setup socket callbacks
  socketCallbacks.onInit = (data) => {
    myPlayer = players.get(myId);
    if (myPlayer) {
      myPlayer.muted = true; // start muted
    }

    // Load chat history
    if (data.chatHistory) {
      data.chatHistory.forEach(msg => addChatMessage(msg));
    }

    updatePlayerListUI();
    updateZoneUI();
    addSystemMessage('사무실에 입장했습니다. 환영합니다!');

    // Mobile canvas resize
    if (isMobile) {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
      VIEW_W = canvas.width;
      VIEW_H = canvas.height;
    }

    // Start game loop
    if (animFrame) cancelAnimationFrame(animFrame);
    gameLoop();
  };

  socketCallbacks.onUserJoined = (player) => {
    updatePlayerListUI();
    addSystemMessage(`${player.name} 님이 입장했습니다.`);
  };

  socketCallbacks.onUserMoved = () => {
    updatePlayerListUI();
  };

  socketCallbacks.onUserLeft = (data) => {
    if (typeof removePeerConnection === 'function') removePeerConnection(data.id);
    updatePlayerListUI();
    addSystemMessage(`${data.name || '사용자'} 님이 퇴장했습니다.`);
  };

  socketCallbacks.onChatMessage = (data) => {
    addChatMessage(data);
  };

  socketCallbacks.onUserMuted = () => {
    updatePlayerListUI();
  };

  socket.on('presentation-started', (data) => {
    presState.active = true;
    presState.presenterId = data.presenterId;
    presState.presenterName = data.presenterName;
    addSystemMessage(`🎬 ${data.presenterName}님이 프레젠테이션을 시작했습니다.`);
    
    _wasInPresRoom = false; // 상태 초기화하여 checkPresenterSpot이 재평가하게 함

    if (data.presenterId === myId) {
      updatePresenterPanel(true);
    }
  });

  socket.on('presentation-ended', () => {
    const wasPresenter = presState.presenterId === myId;
    presState.active = false;
    presState.presenterId = null;
    presState.presenterName = '';
    presState.chatLocked = false;
    _wasInPresRoom = false; // 상태 초기화
    addSystemMessage('🎬 프레젠테이션이 종료되었습니다.');
    showPresViewerOverlay(false);
    if (wasPresenter) updatePresenterPanel(false);
    if (typeof stopScreenShare === 'function') stopScreenShare();
    updateChatLockUI(false);
  });

  socket.on('force-muted', (data) => {
    if (typeof isMicActive !== 'undefined' && isMicActive && data.muted) {
      if (typeof stopMic === 'function') stopMic();
      if (typeof setMicUI === 'function') setMicUI('muted');
      if (myId && players.has(myId)) players.get(myId).muted = true;
      addSystemMessage('🔇 진행자가 마이크를 음소거했습니다.');
    }
  });

  socket.on('chat-locked', (data) => {
    presState.chatLocked = data.locked;
    updateChatLockUI(data.locked);
  });

  socket.on('screen-share-started', () => {
    // 시청각실 안에 있는 사람만 화면공유 요청
    if (_isMyPlayerInPresRoom() && presState.presenterId !== myId) {
      if (typeof socketRequestScreen === 'function') socketRequestScreen();
    }
  });

  socket.on('screen-signal', (data) => {
    if (typeof handleScreenSignal === 'function') handleScreenSignal(data.from, data.signal);
  });

  // 진행자: 참여자가 화면공유 요청
  socket.on('viewer-wants-screen', (data) => {
    if (typeof screenStream !== 'undefined' && screenStream) {
      if (typeof _createScreenPeer === 'function') _createScreenPeer(data.viewerId, true);
    }
  });

  socketCallbacks.onDisconnect = () => {
    addSystemMessage('서버와의 연결이 끊어졌습니다. 재연결 중...');
  };

  socketCallbacks.onConnect = () => {
    if (myPlayer) {
      addSystemMessage('서버에 재연결되었습니다. 다시 입장합니다...');
      socketJoin(name, color, myAvatarConfig);
    }
  };

  // Emit join — 이미 연결됐으면 즉시, 아니면 connect 후
  if (socket && socket.connected) {
    socketJoin(name, color, myAvatarConfig);
  } else {
    // onConnect 콜백이 이미 설정되어 있을 수 있으므로 (위의 재접속 로직), 
    // 여기서는 초기 입장 시에만 실행되도록 래핑하거나 기존 기능을 보존합니다.
    const originalOnConnect = socketCallbacks.onConnect;
    socketCallbacks.onConnect = () => {
      if (originalOnConnect) originalOnConnect();
      // 초기 입장은 myPlayer가 없을 때 실행됨
      if (!myPlayer) {
        socketJoin(name, color, myAvatarConfig);
      }
    };
  }
}

// ============================================================
// Presentation — 진행자 스팟 감지 & 방 입장/퇴장 감지
// ============================================================
let _wasOnSpot = false;
let _wasInPresRoom = false;

function _isMyPlayerInPresRoom() {
  if (!myPlayer) return false;
  return (
    myPlayer.x >= PRES_ROOM.x && myPlayer.x <= PRES_ROOM.x + PRES_ROOM.w &&
    myPlayer.y >= PRES_ROOM.y && myPlayer.y <= PRES_ROOM.y + PRES_ROOM.h
  );
}

function checkPresenterSpot() {
  if (!myId || !myPlayer) return;

  // 진행자 스팟 힌트
  const { spotX, spotY, spotR } = PRES_ROOM;
  const dx = myPlayer.x - spotX;
  const dy = myPlayer.y - spotY;
  const onSpot = (dx * dx + dy * dy) <= (spotR + 10) * (spotR + 10);
  if (onSpot !== _wasOnSpot) {
    _wasOnSpot = onSpot;
    const hint = document.getElementById('presSpotHint');
    if (hint) hint.classList.toggle('hidden', !onSpot || presState.active);
  }

  // 방 입장/퇴장 — 시청자 뷰 자동 열기/닫기 (진행자 본인 제외)
  if (!presState.active || presState.presenterId === myId) return;
  const inRoom = _isMyPlayerInPresRoom();
  if (inRoom === _wasInPresRoom) return;
  _wasInPresRoom = inRoom;
  if (inRoom) {
    showPresViewerOverlay(true);
    socketRequestScreen();
  } else {
    showPresViewerOverlay(false);
  }
}

// ── 진행자 전체화면 열기/닫기 ────────────────────────────────
function updatePresenterPanel(show) {
  console.log('[Pres] updatePresenterPanel', show);
  const view = document.getElementById('presenterView');
  console.log('[Pres] presenterView element=', view);
  if (!view) return;
  view.classList.toggle('hidden', !show);
  if (show) {
    refreshPresenterAudienceList();
    _presTimerStart();
  } else {
    _presTimerStop();
  }
}

// ── 참여자 목록 (진행자 패널) ────────────────────────────────
function refreshPresenterAudienceList() {
  const list    = document.getElementById('presAudienceList');
  const countEl = document.getElementById('presPartCount');
  if (!list) return;
  list.innerHTML = '';
  let count = 0;
  players.forEach((p, id) => {
    if (id === myId) return;
    count++;
    const row = document.createElement('div');
    row.className = 'pres-audience-row';
    row.dataset.id = id;
    const isMuted = p.muted;
    row.innerHTML = `
      <span class="pres-aud-dot" style="background:${p.color}"></span>
      <span class="pres-aud-name">${p.name}</span>
      <span class="pres-aud-badge">${getZone(p.x, p.y).icon || ''}</span>
      <button class="pres-mute-btn${isMuted ? ' muted' : ''}" data-id="${id}" data-muted="${isMuted ? '1' : '0'}"
        title="${isMuted ? '음소거 해제' : '음소거'}">
        ${isMuted ? '🔇' : '🎤'}
      </button>`;
    list.appendChild(row);
  });
  if (countEl) countEl.textContent = `${count}명 참여`;

  list.querySelectorAll('.pres-mute-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.id;
      const nowMuted = btn.dataset.muted === '1';
      socketPresMuteUser(targetId, !nowMuted);
      btn.dataset.muted = nowMuted ? '0' : '1';
      btn.textContent   = nowMuted ? '🎤' : '🔇';
      btn.classList.toggle('muted', !nowMuted);
    });
  });
}

// ── 시청자 전체화면 열기/닫기 ────────────────────────────────
function showPresViewerOverlay(show) {
  const overlay = document.getElementById('presViewerOverlay');
  if (!overlay) return;
  overlay.classList.toggle('hidden', !show);
  if (show) {
    const nameEl = document.getElementById('presViewerName');
    if (nameEl) nameEl.textContent = presState.presenterName || '진행자';
    _presTimerStart();
    _syncViewerChat();
  } else {
    _presTimerStop();
  }
}

// 기존 채팅 메시지를 시청자 채팅 패널에 동기화
function _syncViewerChat() {
  const vChat = document.getElementById('viewerChatMessages');
  const pChat = document.getElementById('presChatMessages');
  if (!vChat || !pChat) return;
  vChat.innerHTML = pChat.innerHTML;
  vChat.scrollTop = vChat.scrollHeight;
}

// ── 채팅 잠금 UI ─────────────────────────────────────────────
function updateChatLockUI(locked) {
  const amPresenter = presState.presenterId === myId;

  // 메인 채팅
  const mainInput   = document.getElementById('chatInput');
  const mainSend    = document.getElementById('chatSendBtn');
  if (mainInput) mainInput.disabled = locked && !amPresenter;
  if (mainSend)  mainSend.disabled  = locked && !amPresenter;

  // 진행자 채팅 (진행자는 항상 가능)
  const presInput  = document.getElementById('presChatInput');
  const presSend   = document.getElementById('presChatSend');
  if (presInput) presInput.disabled = false;
  if (presSend)  presSend.disabled  = false;

  // 시청자 채팅
  const viewInput  = document.getElementById('viewerChatInput');
  const viewSend   = document.getElementById('viewerChatSend');
  if (viewInput) viewInput.disabled = locked;
  if (viewSend)  viewSend.disabled  = locked;

  // 잠금 배지
  const badge = document.getElementById('chatLockBadge');
  if (badge) badge.classList.toggle('hidden', !locked);

  // 채팅 잠금 버튼 상태
  const lockBtn = document.getElementById('presChatLockBtn');
  if (lockBtn) {
    lockBtn.classList.toggle('active', locked);
    lockBtn.querySelector('span:last-child').textContent = locked ? '채팅 잠금 해제' : '채팅 잠금';
  }
}

// ── 발표 타이머 ───────────────────────────────────────────────
let _presTimerInterval = null;
let _presTimerSec = 0;

function _presTimerStart() {
  _presTimerStop();
  _presTimerSec = 0;
  _presTimerInterval = setInterval(() => {
    _presTimerSec++;
    const m = String(Math.floor(_presTimerSec / 60)).padStart(2, '0');
    const s = String(_presTimerSec % 60).padStart(2, '0');
    const txt = `${m}:${s}`;
    const t1 = document.getElementById('presTimerDisplay');
    const t2 = document.getElementById('presTimerViewer');
    if (t1) t1.textContent = txt;
    if (t2) t2.textContent = txt;
  }, 1000);
}
function _presTimerStop() {
  if (_presTimerInterval) { clearInterval(_presTimerInterval); _presTimerInterval = null; }
  _presTimerSec = 0;
}

// ============================================================
// Help Modal
// ============================================================
function setupHelpModal() {
  const helpBtn = document.getElementById('helpBtn');
  const helpModal = document.getElementById('helpModal');
  const closeHelp = document.getElementById('closeHelp');

  helpBtn.addEventListener('click', () => {
    helpModal.classList.remove('hidden');
  });
  closeHelp.addEventListener('click', () => {
    helpModal.classList.add('hidden');
  });
  helpModal.addEventListener('click', (e) => {
    if (e.target === helpModal) helpModal.classList.add('hidden');
  });
}

// ============================================================
// Mic Button
// ============================================================
function setupMicButton() {
  const micBtn = document.getElementById('micBtn');
  micBtn.addEventListener('click', () => {
    toggleMic();
  });
}

// ============================================================
// Utility Functions
// ============================================================
function roundRect(ctx, x, y, w, h, r) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function lightenColor(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0xff) + amount);
  const b = Math.min(255, (num & 0xff) + amount);
  return `rgb(${r},${g},${b})`;
}

// Update player list periodically (for zone updates)
setInterval(() => {
  if (myId) updatePlayerListUI();
}, 1000);

// ============================================================
// Owner Mode
// ============================================================

const ownerMode = {
  active: false,
  selectedIdx: null,       // index into furniture[]
  dragState: null,         // { type:'move'|'resize', startX, startY, origX, origY, origW, origH, handle }
  ghostItem: null,         // { type, w, h, x, y } — item being placed from palette
  ghostType: null,
  ghostW: 0,
  ghostH: 0,
};

// Default layout snapshot for reset
const DEFAULT_FURNITURE = JSON.parse(JSON.stringify(furniture));
const DEFAULT_WALLS_INNER = JSON.parse(JSON.stringify(walls.slice(4))); // skip outer walls

// ---- Zone resize ----
function applyZoneResize(officeW, splitH) {
  ZONES.OFFICE.w  = officeW;
  ZONES.MEETING.x = officeW;
  ZONES.MEETING.w = CANVAS_W - officeW;
  ZONES.OFFICE.h  = splitH;
  ZONES.MEETING.h = splitH;
  ZONES.BREAK.h   = CANVAS_H - splitH;
  ZONES.BREAK.y   = splitH;
  ZONES.LOBBY.x   = ZONES.BREAK.w;
  ZONES.LOBBY.y   = splitH;
  ZONES.LOBBY.w   = CANVAS_W - ZONES.BREAK.w;
  ZONES.LOBBY.h   = CANVAS_H - splitH;

  // Rebuild internal walls based on new zone sizes
  rebuildInternalWalls(officeW, splitH);
}

function rebuildInternalWalls(officeW, splitH) {
  // Remove old internal walls (keep outer 4)
  walls.splice(4, walls.length - 4);

  const doorSize = 60;
  const wallT    = 16;
  const vMid     = splitH / 2;
  const hMid     = officeW / 2;

  // Vertical divider (office | meeting) with door at midpoint
  walls.push({ x: officeW - wallT/2, y: 0,               w: wallT, h: vMid - doorSize/2 });
  walls.push({ x: officeW - wallT/2, y: vMid + doorSize/2, w: wallT, h: splitH - vMid - doorSize/2 });

  // Horizontal divider (top | bottom) with doors
  walls.push({ x: 0,       y: splitH - wallT/2, w: hMid - doorSize/2,                   h: wallT });
  walls.push({ x: hMid + doorSize/2, y: splitH - wallT/2, w: officeW - hMid - doorSize/2, h: wallT });
  walls.push({ x: officeW + doorSize, y: splitH - wallT/2, w: CANVAS_W - officeW - doorSize, h: wallT });

  // Break room right wall
  walls.push({ x: ZONES.BREAK.w - wallT/2, y: splitH + wallT/2, w: wallT, h: CANVAS_H - splitH - wallT });
}

// ---- Hit test: which furniture index is at (x, y)? ----
function furnitureAt(x, y) {
  for (let i = furniture.length - 1; i >= 0; i--) {
    const f = furniture[i];
    if (x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h) return i;
  }
  return -1;
}

// ---- Resize handle hit test ----
const HANDLE_SIZE = 10;
function resizeHandleAt(f, x, y) {
  // bottom-right corner handle
  if (Math.abs(x - (f.x + f.w)) < HANDLE_SIZE && Math.abs(y - (f.y + f.h)) < HANDLE_SIZE) return 'br';
  // right edge
  if (Math.abs(x - (f.x + f.w)) < HANDLE_SIZE && y > f.y + HANDLE_SIZE && y < f.y + f.h - HANDLE_SIZE) return 'r';
  // bottom edge
  if (Math.abs(y - (f.y + f.h)) < HANDLE_SIZE && x > f.x + HANDLE_SIZE && x < f.x + f.w - HANDLE_SIZE) return 'b';
  return null;
}

// ---- Draw owner mode overlays ----
function drawOwnerOverlay() {
  if (!ownerMode.active) return;

  // Semi-transparent tint
  ctx.save();
  ctx.fillStyle = 'rgba(245,158,11,0.04)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.restore();

  // Highlight all furniture with dashed outlines
  ctx.save();
  furniture.forEach((f, i) => {
    const isSelected = i === ownerMode.selectedIdx;
    ctx.strokeStyle = isSelected ? '#f59e0b' : 'rgba(245,158,11,0.35)';
    ctx.lineWidth   = isSelected ? 2 : 1;
    ctx.setLineDash(isSelected ? [] : [4, 3]);
    ctx.strokeRect(f.x - 1, f.y - 1, f.w + 2, f.h + 2);

    // Draw resize handles on selected
    if (isSelected) {
      ctx.setLineDash([]);
      ctx.fillStyle = '#f59e0b';
      // br
      ctx.fillRect(f.x + f.w - HANDLE_SIZE/2, f.y + f.h - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
      // r mid
      ctx.fillRect(f.x + f.w - HANDLE_SIZE/2, f.y + f.h/2 - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
      // b mid
      ctx.fillRect(f.x + f.w/2 - HANDLE_SIZE/2, f.y + f.h - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
    }
  });
  ctx.setLineDash([]);
  ctx.restore();

  // Draw ghost item following mouse
  if (ownerMode.ghostItem) {
    const g = ownerMode.ghostItem;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(g.x, g.y, g.w, g.h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 2]);
    ctx.strokeRect(g.x, g.y, g.w, g.h);
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Owner mode badge on canvas
  ctx.save();
  ctx.fillStyle = 'rgba(245,158,11,0.9)';
  roundRect(ctx, 8, 8, 120, 22, 5);
  ctx.fill();
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 12px Segoe UI, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('🏠 건물주 모드', 16, 23);
  ctx.restore();
}

// ---- Update selected furniture info panel ----
function updateOwnerSelectionUI() {
  const infoEl = document.getElementById('selectedFurnitureInfo');
  const delBtn  = document.getElementById('deleteFurnitureBtn');
  const dupBtn  = document.getElementById('duplicateFurnitureBtn');
  if (!infoEl) return;

  if (ownerMode.selectedIdx !== null) {
    const f = furniture[ownerMode.selectedIdx];
    infoEl.className = 'selected-info has-selection';
    infoEl.textContent = `${f.type}  |  x:${Math.round(f.x)} y:${Math.round(f.y)}  |  ${Math.round(f.w)}×${Math.round(f.h)}`;
    delBtn.disabled = false;
    dupBtn.disabled = false;
  } else {
    infoEl.className = 'selected-info';
    infoEl.textContent = '가구를 클릭하세요';
    delBtn.disabled = true;
    dupBtn.disabled = true;
  }
}

// ---- Canvas mouse events for owner mode ----
function ownerModeMouseDown(e) {
  if (!ownerMode.active) return;

  const rect   = canvas.getBoundingClientRect();
  const scaleX = isMobile ? 1 : CANVAS_W / rect.width;
  const scaleY = isMobile ? 1 : CANVAS_H / rect.height;
  const mx = (e.clientX - rect.left) * scaleX + (isMobile ? camera.x : 0);
  const my = (e.clientY - rect.top)  * scaleY + (isMobile ? camera.y : 0);

  // Right-click: delete hovered furniture
  if (e.button === 2) {
    e.preventDefault();
    const idx = furnitureAt(mx, my);
    if (idx >= 0) {
      furniture.splice(idx, 1);
      ownerMode.selectedIdx = null;
      updateOwnerSelectionUI();
    }
    return;
  }

  if (e.button !== 0) return;

  // If we have a ghost (placing new item), place it
  if (ownerMode.ghostItem) {
    const g = ownerMode.ghostItem;
    furniture.push({ x: Math.round(g.x), y: Math.round(g.y), w: g.w, h: g.h, type: g.type });
    ownerMode.ghostItem = null;
    ownerMode.selectedIdx = furniture.length - 1;
    updateOwnerSelectionUI();
    canvas.style.cursor = 'crosshair';
    return;
  }

  // Check if clicking on resize handle of selected item
  if (ownerMode.selectedIdx !== null) {
    const f      = furniture[ownerMode.selectedIdx];
    const handle = resizeHandleAt(f, mx, my);
    if (handle) {
      ownerMode.dragState = {
        type: 'resize', handle,
        startX: mx, startY: my,
        origX: f.x, origY: f.y, origW: f.w, origH: f.h,
      };
      return;
    }
  }

  // Check if clicking on any furniture to drag
  const idx = furnitureAt(mx, my);
  if (idx >= 0) {
    ownerMode.selectedIdx = idx;
    const f = furniture[idx];
    ownerMode.dragState = {
      type: 'move',
      startX: mx, startY: my,
      origX: f.x, origY: f.y, origW: f.w, origH: f.h,
      offX: mx - f.x, offY: my - f.y,
    };
    updateOwnerSelectionUI();
    canvas.style.cursor = 'grabbing';
  } else {
    ownerMode.selectedIdx = null;
    updateOwnerSelectionUI();
  }
}

function ownerModeMouseMove(e) {
  if (!ownerMode.active) return;

  const rect   = canvas.getBoundingClientRect();
  const scaleX = isMobile ? 1 : CANVAS_W / rect.width;
  const scaleY = isMobile ? 1 : CANVAS_H / rect.height;
  const mx = (e.clientX - rect.left) * scaleX + (isMobile ? camera.x : 0);
  const my = (e.clientY - rect.top)  * scaleY + (isMobile ? camera.y : 0);

  // Update ghost position
  if (ownerMode.ghostItem) {
    ownerMode.ghostItem.x = mx - ownerMode.ghostItem.w / 2;
    ownerMode.ghostItem.y = my - ownerMode.ghostItem.h / 2;
    return;
  }

  if (!ownerMode.dragState) {
    // Cursor hint
    if (ownerMode.selectedIdx !== null) {
      const f = furniture[ownerMode.selectedIdx];
      if (resizeHandleAt(f, mx, my)) {
        canvas.style.cursor = 'nwse-resize';
      } else if (furnitureAt(mx, my) === ownerMode.selectedIdx) {
        canvas.style.cursor = 'grab';
      } else {
        canvas.style.cursor = 'crosshair';
      }
    }
    return;
  }

  const ds = ownerMode.dragState;

  if (ds.type === 'move') {
    const f = furniture[ownerMode.selectedIdx];
    f.x = Math.max(8, Math.min(CANVAS_W - f.w - 8, mx - ds.offX));
    f.y = Math.max(8, Math.min(CANVAS_H - f.h - 8, my - ds.offY));
    updateOwnerSelectionUI();
  } else if (ds.type === 'resize') {
    const f  = furniture[ownerMode.selectedIdx];
    const dx = mx - ds.startX;
    const dy = my - ds.startY;
    const MIN = 16;
    if (ds.handle === 'br' || ds.handle === 'r') {
      f.w = Math.max(MIN, ds.origW + dx);
    }
    if (ds.handle === 'br' || ds.handle === 'b') {
      f.h = Math.max(MIN, ds.origH + dy);
    }
    updateOwnerSelectionUI();
  }
}

function ownerModeMouseUp(e) {
  if (!ownerMode.active) return;
  ownerMode.dragState = null;
  if (!ownerMode.ghostItem) canvas.style.cursor = 'crosshair';
}

// ---- Save / Load layout to localStorage ----
function saveLayout() {
  const data = {
    version: LAYOUT_VERSION,
    furniture: furniture.map(f => ({ ...f })),
    zones: {
      officeW: ZONES.OFFICE.w,
      splitH:  ZONES.OFFICE.h,
      breakW:  ZONES.BREAK.w,
    },
  };
  localStorage.setItem('officeLayout', JSON.stringify(data));
  showOwnerToast('💾 레이아웃이 저장되었습니다');
}

function loadLayout() {
  const raw = localStorage.getItem('officeLayout');
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    // 버전 체크: 버전이 다르거나 없으면 구버전 데이터로 간주하고 로드 안함 (새 기본값 사용)
    if (data.version !== LAYOUT_VERSION) {
      console.log(`[Layout] Version mismatch (local: ${data.version}, current: ${LAYOUT_VERSION}). Skipping load.`);
      localStorage.removeItem('officeLayout'); // 구버전 삭제
      return;
    }
    furniture.splice(0, furniture.length, ...data.furniture);
    if (data.zones) applyZoneResize(data.zones.officeW, data.zones.splitH);
  } catch (err) {
    console.warn('Layout load failed:', err);
  }
}

function resetLayout() {
  furniture.splice(0, furniture.length, ...JSON.parse(JSON.stringify(DEFAULT_FURNITURE)));
  walls.splice(4, walls.length - 4, ...JSON.parse(JSON.stringify(DEFAULT_WALLS_INNER)));
  // Reset zones
  ZONES.OFFICE.w  = 480; ZONES.OFFICE.h  = 380;
  ZONES.MEETING.x = 480; ZONES.MEETING.w = 720; ZONES.MEETING.h = 380;
  ZONES.BREAK.y   = 380; ZONES.BREAK.h   = 420;
  ZONES.LOBBY.x   = 300; ZONES.LOBBY.y   = 380; ZONES.LOBBY.w  = 900; ZONES.LOBBY.h  = 420;
  // Reset sliders
  const owSlider = document.getElementById('officeW');
  const zhSlider = document.getElementById('zoneH');
  if (owSlider) { owSlider.value = 480; document.getElementById('officeWVal').textContent = 480; }
  if (zhSlider) { zhSlider.value = 380; document.getElementById('zoneHVal').textContent = 380; }
  showOwnerToast('↩ 기본 레이아웃으로 복원되었습니다');
}

// ---- Toast notification ----
function showOwnerToast(msg) {
  let toast = document.getElementById('ownerToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'ownerToast';
    toast.style.cssText = `
      position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
      background:#f59e0b; color:#1a1a1a; font-weight:700; font-size:13px;
      padding:8px 20px; border-radius:20px; z-index:9999;
      box-shadow:0 4px 16px rgba(0,0,0,0.4); transition:opacity 0.3s;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toast._tid);
  toast._tid = setTimeout(() => { toast.style.opacity = '0'; }, 2200);
}

// ---- Setup owner mode UI ----
function setupOwnerMode() {
  const btn        = document.getElementById('ownerModeBtn');
  const panel      = document.getElementById('ownerPanel');
  const closeBtn   = document.getElementById('ownerPanelClose');
  const delBtn     = document.getElementById('deleteFurnitureBtn');
  const dupBtn     = document.getElementById('duplicateFurnitureBtn');
  const saveBtn    = document.getElementById('saveLayoutBtn');
  const resetBtn   = document.getElementById('resetLayoutBtn');
  const officeWSlider = document.getElementById('officeW');
  const zoneHSlider   = document.getElementById('zoneH');

  // Toggle owner mode
  btn.addEventListener('click', () => {
    ownerMode.active = !ownerMode.active;
    if (ownerMode.active) {
      panel.classList.remove('hidden');
      btn.classList.add('active');
      btn.textContent = '🏠 건물주 ON';
      canvas.classList.add('owner-mode');
      canvas.style.cursor = 'crosshair';
      ownerMode.selectedIdx = null;
      ownerMode.ghostItem   = null;
      ownerMode.dragState   = null;
      updateOwnerSelectionUI();
    } else {
      exitOwnerMode();
    }
  });

  function exitOwnerMode() {
    ownerMode.active      = false;
    ownerMode.selectedIdx = null;
    ownerMode.ghostItem   = null;
    ownerMode.dragState   = null;
    panel.classList.add('hidden');
    btn.classList.remove('active');
    btn.textContent = '🏠 건물주';
    canvas.classList.remove('owner-mode');
    canvas.style.cursor = '';
  }

  closeBtn.addEventListener('click', exitOwnerMode);

  // Canvas mouse events
  canvas.addEventListener('mousedown',  ownerModeMouseDown);
  canvas.addEventListener('mousemove',  ownerModeMouseMove);
  canvas.addEventListener('mouseup',    ownerModeMouseUp);
  canvas.addEventListener('mouseleave', ownerModeMouseUp);
  canvas.addEventListener('contextmenu', (e) => { if (ownerMode.active) e.preventDefault(); });

  // Furniture palette drag-to-place
  document.querySelectorAll('.palette-item').forEach(item => {
    item.addEventListener('click', () => {
      if (!ownerMode.active) return;
      const type = item.dataset.type;
      const w    = parseInt(item.dataset.w);
      const h    = parseInt(item.dataset.h);
      ownerMode.ghostItem = { type, w, h, x: CANVAS_W/2 - w/2, y: CANVAS_H/2 - h/2 };
      canvas.focus();
      showOwnerToast(`${item.textContent} 클릭하여 배치`);
    });
    // ESC to cancel ghost
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && ownerMode.ghostItem) {
        ownerMode.ghostItem = null;
        canvas.style.cursor = 'crosshair';
      }
    });
  });

  // Delete selected
  delBtn.addEventListener('click', () => {
    if (ownerMode.selectedIdx === null) return;
    furniture.splice(ownerMode.selectedIdx, 1);
    ownerMode.selectedIdx = null;
    updateOwnerSelectionUI();
  });

  // Duplicate selected
  dupBtn.addEventListener('click', () => {
    if (ownerMode.selectedIdx === null) return;
    const f = furniture[ownerMode.selectedIdx];
    furniture.push({ ...f, x: f.x + 20, y: f.y + 20 });
    ownerMode.selectedIdx = furniture.length - 1;
    updateOwnerSelectionUI();
  });

  // Zone resize sliders
  officeWSlider.addEventListener('input', () => {
    const v = parseInt(officeWSlider.value);
    document.getElementById('officeWVal').textContent = v;
    applyZoneResize(v, parseInt(zoneHSlider.value));
  });
  zoneHSlider.addEventListener('input', () => {
    const v = parseInt(zoneHSlider.value);
    document.getElementById('zoneHVal').textContent = v;
    applyZoneResize(parseInt(officeWSlider.value), v);
  });

  // Save / Reset
  saveBtn.addEventListener('click',  saveLayout);
  resetBtn.addEventListener('click', () => {
    if (confirm('기본 레이아웃으로 되돌리겠습니까?')) resetLayout();
  });

  // Auto-load saved layout
  loadLayout();
}

// ============================================================
// Mobile UI
// ============================================================
function toggleDrawer(id) {
  const drawer  = document.getElementById(id);
  const overlay = document.getElementById('mobileDrawerOverlay');
  if (!drawer || !overlay) return;
  const isOpen = drawer.classList.contains('open');
  closeAllDrawers();
  if (!isOpen) {
    // visibility+transform 방식: hidden 제거 후 즉시 open 추가
    drawer.classList.remove('hidden');
    requestAnimationFrame(() => drawer.classList.add('open'));
    overlay.classList.remove('hidden');
    overlay.style.visibility = 'visible';
  }
}

function closeAllDrawers() {
  ['mobileChatDrawer', 'mobileParticipantsDrawer'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
  });
  const overlay = document.getElementById('mobileDrawerOverlay');
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.style.visibility = '';
  }
}

function setupMobileUI() {
  if (!isMobile) return;

  const mobChatBtn   = document.getElementById('mobChatBtn');
  const mobPeopleBtn = document.getElementById('mobPeopleBtn');
  const mobMicBtn    = document.getElementById('mobMicBtn');
  const mobOwnerBtn  = document.getElementById('mobOwnerBtn');
  const overlay      = document.getElementById('mobileDrawerOverlay');

  if (mobChatBtn)   mobChatBtn.addEventListener('click',   () => toggleDrawer('mobileChatDrawer'));
  if (mobPeopleBtn) mobPeopleBtn.addEventListener('click', () => toggleDrawer('mobileParticipantsDrawer'));
  if (mobMicBtn) {
    // touchend 로 등록해야 iOS Safari에서 user gesture로 인정됨
    mobMicBtn.addEventListener('touchend', (e) => {
      e.preventDefault();
      toggleMic();
    }, { passive: false });
    // 데스크탑 폴백
    mobMicBtn.addEventListener('click', () => toggleMic());
  }
  if (mobOwnerBtn)  mobOwnerBtn.addEventListener('click',  () => {
    const ownerBtn = document.getElementById('ownerModeBtn');
    if (ownerBtn) ownerBtn.click();
  });
  if (overlay) overlay.addEventListener('click', closeAllDrawers);

  // Mobile chat input
  const mobileInput   = document.getElementById('chatInputMobile');
  const mobileSendBtn = document.getElementById('chatSendBtnMobile');

  function sendMobileChat() {
    if (!mobileInput || !mobileInput.value.trim()) return;
    if (typeof socketChat === 'function') socketChat(mobileInput.value.trim());
    mobileInput.value = '';
  }

  if (mobileSendBtn) mobileSendBtn.addEventListener('click', sendMobileChat);
  if (mobileInput) {
    mobileInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); sendMobileChat(); }
    });
    mobileInput.addEventListener('keydown', e => e.stopPropagation());
  }

  // Virtual joystick
  const dirMap = { up: 'w', down: 's', left: 'a', right: 'd' };
  document.querySelectorAll('.joy-btn').forEach(btn => {
    const dir = dirMap[btn.dataset.dir];
    if (!dir) return;
    btn.addEventListener('touchstart', e => { e.preventDefault(); keys[dir] = true; }, { passive: false });
    btn.addEventListener('touchend',   e => { e.preventDefault(); keys[dir] = false; }, { passive: false });
    btn.addEventListener('mousedown',  () => keys[dir] = true);
    btn.addEventListener('mouseup',    () => keys[dir] = false);
    btn.addEventListener('mouseleave', () => keys[dir] = false);
  });
}

// ============================================================
// Initialization
// ============================================================
// ============================================================
// Avatar Customizer (login + in-game modal)
// ============================================================
function drawAvatarPreviewTo(canvasEl, color, avatar) {
  const c   = canvasEl;
  const pc  = c.getContext('2d');
  const cx  = c.width / 2, cy = c.height / 2, R = Math.min(cx, cy) - 8;

  pc.clearRect(0, 0, c.width, c.height);

  // 배경
  pc.fillStyle = '#1a2a44';
  pc.beginPath(); pc.arc(cx, cy, R + 6, 0, Math.PI * 2); pc.fill();

  // 몸통
  const bg = pc.createRadialGradient(cx - 4, cy - 4, 2, cx, cy, R);
  bg.addColorStop(0, lightenColor(color, 40));
  bg.addColorStop(1, color);
  pc.fillStyle = bg;
  pc.beginPath(); pc.arc(cx, cy, R, 0, Math.PI * 2); pc.fill();
  pc.strokeStyle = 'rgba(255,255,255,0.8)'; pc.lineWidth = 2;
  pc.beginPath(); pc.arc(cx, cy, R, 0, Math.PI * 2); pc.stroke();

  drawOutfitOn(pc, cx, cy, avatar.outfit, color, R);
  drawFaceOn(pc, cx, cy, color, avatar.face, avatar.skinTone, R);
  drawHatOn(pc, cx, cy, avatar.hat, R);
}

// 미리보기 전용 래퍼 (game ctx 대신 전달받은 pc 사용)
function drawOutfitOn(pc, x, y, outfit, color, R) { drawOutfit(pc, x, y, outfit, color, R); }
function drawFaceOn(pc, x, y, color, face, skin)  { drawAvatarFace2(pc, x, y, color, face, skin); }
function drawHatOn(pc, x, y, hat, R)              { drawHat(pc, x, y, hat, R); }

function setupAvatarCustomizer() {
  // ── 공통 헬퍼 ──
  function bindOptionRow(container, onChange) {
    container.querySelectorAll('.av-opt').forEach(el => {
      el.addEventListener('click', () => {
        container.querySelectorAll('.av-opt').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');
        onChange(el.dataset.val);
      });
    });
  }
  function bindSkinPicker(container, onChange) {
    container.querySelectorAll('.skin-option').forEach(el => {
      el.addEventListener('click', () => {
        container.querySelectorAll('.skin-option').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');
        onChange(el.dataset.skin);
      });
    });
  }

  // ── 인게임 모달 ──
  const modal        = document.getElementById('avatarModal');
  const openBtn      = document.getElementById('avatarCustomBtn');
  const closeBtn     = document.getElementById('closeAvatarModal');
  const applyBtn     = document.getElementById('applyAvatarBtn');
  const modalPreview = document.getElementById('avatarModalPreview');

  function getMyColor() {
    const me = myId ? players.get(myId) : null;
    return me ? me.color : selectedColor;
  }

  function syncModalPickers(av) {
    document.querySelectorAll('#modalSkinPicker .skin-option').forEach(el => {
      el.classList.toggle('selected', el.dataset.skin === av.skinTone);
    });
    document.querySelectorAll('#modalFacePicker .av-opt').forEach(el => {
      el.classList.toggle('selected', el.dataset.val === av.face);
    });
    document.querySelectorAll('#modalOutfitPicker .av-opt').forEach(el => {
      el.classList.toggle('selected', el.dataset.val === av.outfit);
    });
    document.querySelectorAll('#modalHatPicker .av-opt').forEach(el => {
      el.classList.toggle('selected', el.dataset.val === av.hat);
    });
  }

  let modalDraft = {};

  function refreshModalPreview() {
    if (!modalPreview) return;
    drawAvatarPreviewTo(modalPreview, getMyColor(), modalDraft);
  }

  // 모달 열기 (버튼 또는 우클릭에서 호출)
  window.openAvatarModal = function() {
    if (!modal) return;
    const me = myId ? players.get(myId) : null;
    modalDraft = { ...(me ? (me.avatar || myAvatarConfig) : myAvatarConfig) };
    syncModalPickers(modalDraft);
    modal.classList.remove('hidden');
    refreshModalPreview();
  };

  if (openBtn) openBtn.addEventListener('click', window.openAvatarModal);
  if (closeBtn) closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });

  // 모달 내 피커
  const mSkin = document.getElementById('modalSkinPicker');
  if (mSkin) bindSkinPicker(mSkin, v => { modalDraft.skinTone = v; refreshModalPreview(); });

  const mFace = document.getElementById('modalFacePicker');
  if (mFace) bindOptionRow(mFace, v => { modalDraft.face = v; refreshModalPreview(); });

  const mOutfit = document.getElementById('modalOutfitPicker');
  if (mOutfit) bindOptionRow(mOutfit, v => { modalDraft.outfit = v; refreshModalPreview(); });

  const mHat = document.getElementById('modalHatPicker');
  if (mHat) bindOptionRow(mHat, v => { modalDraft.hat = v; refreshModalPreview(); });

  // 적용
  if (applyBtn) applyBtn.addEventListener('click', () => {
    myAvatarConfig = { ...modalDraft };
    const me = myId ? players.get(myId) : null;
    if (me) me.avatar = { ...myAvatarConfig };
    if (typeof socketAvatarUpdate === 'function') socketAvatarUpdate(myAvatarConfig);
    modal.classList.add('hidden');
    showOwnerToast('👤 아바타가 변경되었습니다');
  });

  // ── 캔버스 우클릭 → 내 아바타 위이면 모달 열기 ──
  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (!myId) return;
    const me = players.get(myId);
    if (!me) return;

    // 캔버스 내 실제 좌표 (카메라 오프셋 적용)
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const wx = (e.clientX - rect.left) * scaleX + camera.x;
    const wy = (e.clientY - rect.top)  * scaleY + camera.y;

    const dx = wx - me.x, dy = wy - me.y;
    if (dx * dx + dy * dy <= (AVATAR_RADIUS + 16) * (AVATAR_RADIUS + 16)) {
      window.openAvatarModal();
    }
  });
}

// ============================================================
// Initialization
// ============================================================
function setupPresentation() {
  // 모바일은 CSS로 UI 숨김 처리, JS 이벤트는 등록해둠

  function tryStartPresentation() {
    if (presState.active) {
      if (presState.presenterId === myId) {
        updatePresenterPanel(true);
      } else {
        // 이미 다른 사람이 발표 중인 경우
        if (_isMyPlayerInPresRoom()) {
          showPresViewerOverlay(true);
          if (typeof socketRequestScreen === 'function') socketRequestScreen();
        } else {
          showMicError('이미 다른 사용자가 발표 중입니다.');
        }
      }
      return;
    }

    // 스팟 체크
    if (!_wasOnSpot) {
      showMicError('발표는 시청각실 앞 진행자 스팟에서만 시작할 수 있습니다.');
      return;
    }

    // 즉시 진행자 뷰 열고 서버에 알림
    presState.active = true;
    presState.presenterId = myId;
    presState.presenterName = myPlayer?.name || '';
    updatePresenterPanel(true);
    socketPresStart();
  }

  // ── 하단 바 🎬 발표 버튼 ─────────────────────────────────
  document.getElementById('presQuickBtn')?.addEventListener('click', tryStartPresentation);

  // ── 스팟 힌트: 시작 버튼 ─────────────────────────────────
  document.getElementById('presStartBtn')?.addEventListener('click', tryStartPresentation);

  // ── 진행자 뷰: 발표 종료 ───────────────────────────────────
  document.getElementById('presEndBtn')?.addEventListener('click', () => {
    if (typeof socketPresEnd === 'function') socketPresEnd();
    if (typeof stopScreenShare === 'function') stopScreenShare();
    
    presState.active = false;
    presState.presenterId = null;
    presState.chatLocked = false;
    _wasInPresRoom = false;

    document.getElementById('presenterView')?.classList.add('hidden');
    if (typeof _presTimerStop === 'function') _presTimerStop();
  });

  // ── 진행자 뷰: 화면 공유 토글 ────────────────────────────
  document.getElementById('presShareScreenBtn')?.addEventListener('click', () => {
    if (typeof screenStream !== 'undefined' && screenStream) {
      if (typeof stopScreenShare === 'function') stopScreenShare();
    } else {
      if (typeof startScreenShare === 'function') startScreenShare();
    }
  });

  // ── 진행자 뷰: 마이크 토글 ───────────────────────────────
  document.getElementById('presMicBtn')?.addEventListener('click', () => {
    if (typeof toggleMic === 'function') toggleMic();
  });

  // ── 진행자 뷰: 채팅 잠금 ─────────────────────────────────
  document.getElementById('presChatLockBtn')?.addEventListener('click', () => {
    presState.chatLocked = !presState.chatLocked;
    socketPresChatLock(presState.chatLocked);
    updateChatLockUI(presState.chatLocked);
  });

  // ── 진행자 뷰: 전체 음소거 ───────────────────────────────
  document.getElementById('presMuteAllBtn')?.addEventListener('click', () => {
    players.forEach((p, id) => {
      if (id === myId) return;
      socketPresMuteUser(id, true);
    });
    refreshPresenterAudienceList();
    showOwnerToast('🔇 모든 참여자를 음소거했습니다');
  });

  // ── 진행자 뷰: 사이드 패널 토글 ──────────────────────────
  const sidePanel = document.getElementById('presSidePanel');
  document.getElementById('presSidePanelBtn')?.addEventListener('click', () => {
    if (!sidePanel) return;
    const collapsed = sidePanel.classList.toggle('collapsed');
    document.getElementById('presSidePanelBtn')?.classList.toggle('active', !collapsed);
  });

  // ── 진행자 뷰: 탭 전환 ───────────────────────────────────
  document.querySelectorAll('#presenterView .pres-side-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#presenterView .pres-side-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      document.getElementById('presTabParticipants')?.classList.toggle('hidden', target !== 'participants');
      document.getElementById('presTabChat')?.classList.toggle('hidden', target !== 'chat');
    });
  });

  // ── 진행자 뷰: 채팅 전송 ─────────────────────────────────
  function sendPresChat() {
    const input = document.getElementById('presChatInput');
    if (!input) return;
    const msg = input.value.trim();
    if (!msg) return;
    socketChat(msg);
    input.value = '';
  }
  document.getElementById('presChatSend')?.addEventListener('click', sendPresChat);
  document.getElementById('presChatInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendPresChat();
  });

  // ── 시청자 뷰: 채팅 패널 토글 ────────────────────────────
  const viewerChatPanel = document.getElementById('viewerChatPanel');
  document.getElementById('viewerChatPanelBtn')?.addEventListener('click', () => {
    if (!viewerChatPanel) return;
    const hidden = viewerChatPanel.classList.toggle('hidden');
    document.getElementById('viewerChatPanelBtn')?.classList.toggle('active', !hidden);
  });

  // ── 시청자 뷰: 나가기 ───────────────────────────────────
  document.getElementById('presExitViewBtn')?.addEventListener('click', () => {
    document.getElementById('presViewerOverlay')?.classList.add('hidden');
    _wasInPresRoom = false;
    if (typeof _presTimerStop === 'function') _presTimerStop();
  });

  // ── 시청자 뷰: 채팅 전송 ─────────────────────────────────
  function sendViewerChat() {
    const input = document.getElementById('viewerChatInput');
    if (!input || input.disabled) return;
    const msg = input.value.trim();
    if (!msg) return;
    socketChat(msg);
    input.value = '';
  }
  document.getElementById('viewerChatSend')?.addEventListener('click', sendViewerChat);
  document.getElementById('viewerChatInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendViewerChat();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  setupLoginScreen();
  setupChatInput();
  setupHelpModal();
  setupMicButton();
  setupOwnerMode();
  setupAvatarCustomizer();
  setupPresentation();
  if (isMobile) setupMobileUI();
});
