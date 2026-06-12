'use strict';

// ============================================================
// Constants & State
// ============================================================
const PROXIMITY_DISTANCE  = 150;
const MAX_VOLUME_DISTANCE = 50;
const CHECK_INTERVAL_MS   = 500;

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]
};

let localStream    = null;
let isMicActive    = false;
let audioContext   = null;

// userId -> { pc, gainNode, audioEl, analyser, speaking }
const peerConnections  = new Map();
const pendingCandidates = new Map();

// 내 마이크 분석용 (말할 때 파동 표시)
let localAnalyser   = null;
let localSpeaking   = false;
let localSpeakLevel = 0;   // 0~1, game.js에서 읽음

// ============================================================
// Mic UI helper
// ============================================================
function setMicUI(state) {
  const micBtn    = document.getElementById('micBtn');
  const micIcon   = document.getElementById('micIcon');
  const micLabel  = document.getElementById('micLabel');
  const mobMicBtn = document.getElementById('mobMicBtn');

  const cfg = {
    muted:      { cls: 'mic-btn muted',      icon: '🎤',  label: '마이크 꺼짐',     mobIcon: '🎤',  active: false },
    active:     { cls: 'mic-btn active',     icon: '🎙️', label: '마이크 켜짐',     mobIcon: '🎙️', active: true  },
    requesting: { cls: 'mic-btn requesting', icon: '🎤',  label: '권한 요청 중...', mobIcon: '⏳',  active: false },
  }[state] || { cls: 'mic-btn muted', icon: '🎤', label: '마이크 꺼짐', mobIcon: '🎤', active: false };

  if (micBtn)   micBtn.className     = cfg.cls;
  if (micIcon)  micIcon.textContent  = cfg.icon;
  if (micLabel) micLabel.textContent = cfg.label;
  if (mobMicBtn) {
    mobMicBtn.classList.toggle('active', cfg.active);
    const t = mobMicBtn.firstChild;
    if (t && t.nodeType === Node.TEXT_NODE) t.textContent = cfg.mobIcon;
  }
}

function showMicError(msg) {
  console.error('[WebRTC]', msg);
  if (typeof addSystemMessage === 'function') addSystemMessage('🎤 ' + msg);

  let toast = document.getElementById('micErrorToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'micErrorToast';
    toast.style.cssText = [
      'position:fixed','top:70px','left:50%','transform:translateX(-50%)',
      'background:#ef4444','color:#fff','font-size:13px','font-weight:600',
      'padding:12px 18px','border-radius:10px','z-index:9999',
      'max-width:88vw','text-align:center','line-height:1.5',
      'box-shadow:0 4px 20px rgba(0,0,0,0.5)','white-space:pre-line',
      'display:none',
    ].join(';');
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.display = 'block';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.style.display = 'none'; }, 6000);
}

// ============================================================
// AudioContext
// ============================================================
function ensureAudioContext() {
  if (!audioContext) {
    const AC = window.AudioContext || window['webkitAudioContext'];
    audioContext = new AC();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
  return audioContext;
}

// ============================================================
// Local mic analyser (말할 때 파동용)
// ============================================================
function setupLocalAnalyser(stream) {
  try {
    const ac = ensureAudioContext();
    const src = ac.createMediaStreamSource(stream);
    localAnalyser = ac.createAnalyser();
    localAnalyser.fftSize = 256;
    localAnalyser.smoothingTimeConstant = 0.5;
    src.connect(localAnalyser);
    // destination에는 연결 안 함 — 자기 목소리 루프백 방지
  } catch (e) {
    console.warn('[WebRTC] localAnalyser setup failed:', e);
  }
}

// game.js의 gameLoop에서 매 프레임 호출됨
function updateLocalSpeakLevel() {
  if (!localAnalyser) { localSpeakLevel = 0; return; }
  const buf = new Uint8Array(localAnalyser.frequencyBinCount);
  localAnalyser.getByteFrequencyData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i];
  const rms = sum / buf.length / 255;
  localSpeakLevel = rms > 0.04 ? Math.min(1, rms * 4) : 0;
  localSpeaking   = localSpeakLevel > 0;
}

// ============================================================
// Mic Toggle
// ============================================================
async function toggleMic() {
  if (isMicActive) {
    stopMic();
    isMicActive    = false;
    localAnalyser  = null;
    localSpeakLevel = 0;
    setMicUI('muted');
    socketMuteToggle(true);
    if (myId && players.has(myId)) players.get(myId).muted = true;
    return;
  }

  // 사전 점검
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const isInsecure = location.protocol === 'http:'
      && location.hostname !== 'localhost'
      && location.hostname !== '127.0.0.1';
    showMicError(isInsecure
      ? 'HTTPS 접속이 필요합니다.\nhttps://' + location.hostname + ':3443 으로 접속하세요.'
      : '이 브라우저는 마이크를 지원하지 않습니다.');
    return;
  }

  setMicUI('requesting');

  // AudioContext 먼저 생성 (user gesture 타이밍)
  try { ensureAudioContext(); } catch (e) { /* 무시 */ }

  // 3단계 fallback
  const tryList = [
    { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false },
    { audio: { echoCancellation: true }, video: false },
    { audio: true, video: false },
  ];

  let stream = null, lastErr = null;
  for (const c of tryList) {
    try   { stream = await navigator.mediaDevices.getUserMedia(c); break; }
    catch (e) {
      lastErr = e;
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') break;
    }
  }

  if (!stream) {
    setMicUI('muted');
    const e = lastErr || new Error('unknown');
    const msgs = {
      NotAllowedError:       '마이크 권한이 거부되었습니다.\n주소창 자물쇠(🔒) → 마이크 → 허용 후 새로고침하세요.',
      PermissionDeniedError: '마이크 권한이 거부되었습니다.\n주소창 자물쇠(🔒) → 마이크 → 허용 후 새로고침하세요.',
      NotFoundError:         '마이크 장치를 찾을 수 없습니다.',
      DevicesNotFoundError:  '마이크 장치를 찾을 수 없습니다.',
      NotReadableError:      '마이크가 다른 앱에서 사용 중입니다.',
      TrackStartError:       '마이크가 다른 앱에서 사용 중입니다.',
    };
    showMicError(msgs[e.name] || `마이크 오류: ${e.name} - ${e.message}`);
    return;
  }

  localStream = stream;
  setupLocalAnalyser(stream);

  isMicActive = true;
  setMicUI('active');
  socketMuteToggle(false);
  if (myId && players.has(myId)) players.get(myId).muted = false;

  // 이미 연결된 peer에 트랙 추가
  peerConnections.forEach((_, id) => addLocalTracksToPeer(id));
}

function stopMic() {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  isMicActive = false; // 상태 업데이트
  peerConnections.forEach(peer => {
    peer.pc.getSenders().forEach(s => { if (s.track) s.track.enabled = false; });
  });
}

// ============================================================
// Peer Connection
// ============================================================
function addLocalTracksToPeer(targetId) {
  if (!localStream) return;
  const peer = peerConnections.get(targetId);
  if (!peer) return;
  const existing = new Set(peer.pc.getSenders().map(s => s.track && s.track.id));
  localStream.getTracks().forEach(track => {
    if (!existing.has(track.id)) {
      peer.pc.addTrack(track, localStream);
    }
  });
}

async function createPeerConnection(targetId, isInitiator) {
  if (peerConnections.has(targetId)) return peerConnections.get(targetId);

  console.log(`[WebRTC] create PC → ${targetId} initiator=${isInitiator}`);
  const pc = new RTCPeerConnection(ICE_SERVERS);

  const peer = { pc, gainNode: null, audioEl: null, analyser: null, speaking: false, speakLevel: 0 };
  peerConnections.set(targetId, peer);
  pendingCandidates.set(targetId, []);

  // Negotiation Needed: 트랙이 추가되거나 ICE 갱신이 필요할 때 호출됨
  pc.onnegotiationneeded = async () => {
    try {
      // 주도자이거나, 비주도자라도 이미 연결이 안정된 상태에서 트랙이 추가된 경우 Offer 생성
      // (완벽한 협상 패턴의 단순화 버전)
      if (isInitiator || pc.signalingState === 'stable') {
        console.log(`[WebRTC] negotiationneeded → ${targetId}, state=${pc.signalingState}`);
        const offer = await pc.createOffer({ offerToReceiveAudio: true });
        if (pc.signalingState !== 'stable' && !isInitiator) return; 
        await pc.setLocalDescription(offer);
        socketWebRTCSignal(targetId, { type: 'offer', sdp: pc.localDescription });
      }
    } catch (e) {
      console.error('[WebRTC] negotiation error:', e);
    }
  };

  if (localStream) addLocalTracksToPeer(targetId);

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socketWebRTCSignal(targetId, { type: 'ice-candidate', candidate });
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`[WebRTC] ICE ${targetId}:`, pc.iceConnectionState);
    if (pc.iceConnectionState === 'failed') pc.restartIce();
    if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'closed') {
      removePeerConnection(targetId);
    }
  };

  pc.ontrack = ({ streams }) => {
    console.log('[WebRTC] ontrack from', targetId);
    const stream = streams[0];
    if (!stream) return;

    // ── <audio> 엘리먼트: 소리 재생 담당 ──────────────────────
    let audio = peer.audioEl;
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      audio.setAttribute('playsinline', '');
      audio.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
      document.body.appendChild(audio);
      peer.audioEl = audio;
    }
    audio.srcObject = stream;
    audio.muted     = false;
    audio.volume    = 1.0;
    audio.play().catch(err => {
      console.warn('[WebRTC] autoplay blocked, will retry on next user gesture:', err.message);
      // 자동재생 차단 시 다음 클릭/터치에서 재시도
      const resume = () => { audio.play().catch(() => {}); document.removeEventListener('click', resume); document.removeEventListener('touchend', resume); };
      document.addEventListener('click',    resume, { once: true });
      document.addEventListener('touchend', resume, { once: true });
    });

    // ── AnalyserNode: 파동 시각화 전용 (소리 출력 없음) ────────
    try {
      const ac  = ensureAudioContext();
      const src = ac.createMediaStreamSource(stream);
      peer.analyser = ac.createAnalyser();
      peer.analyser.fftSize = 256;
      peer.analyser.smoothingTimeConstant = 0.5;
      src.connect(peer.analyser);
      // destination에는 연결 안 함 — <audio>가 출력 담당
    } catch (e) {
      console.warn('[WebRTC] analyser setup failed:', e);
    }
  };

  return peer;
}

function removePeerConnection(targetId) {
  const peer = peerConnections.get(targetId);
  if (!peer) return;
  try { peer.pc.close(); } catch (_) {}
  if (peer.audioEl) {
    peer.audioEl.srcObject = null;
    peer.audioEl.remove();
  }
  peerConnections.delete(targetId);
  pendingCandidates.delete(targetId);
  console.log('[WebRTC] removed PC:', targetId);
}

// ============================================================
// Signal Handler
// ============================================================
async function handleWebRTCSignal(fromId, signal) {
  if (signal.type === 'offer') {
    let peer = peerConnections.get(fromId);
    if (!peer) peer = await createPeerConnection(fromId, false);

    try {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      const pending = pendingCandidates.get(fromId) || [];
      for (const c of pending) {
        try { await peer.pc.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {}
      }
      pendingCandidates.set(fromId, []);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      socketWebRTCSignal(fromId, { type: 'answer', sdp: peer.pc.localDescription });
    } catch (e) { console.error('[WebRTC] handle offer err:', e); }

  } else if (signal.type === 'answer') {
    const peer = peerConnections.get(fromId);
    if (!peer) return;
    try {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      const pending = pendingCandidates.get(fromId) || [];
      for (const c of pending) {
        try { await peer.pc.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {}
      }
      pendingCandidates.set(fromId, []);
    } catch (e) { console.error('[WebRTC] handle answer err:', e); }

  } else if (signal.type === 'ice-candidate') {
    const peer = peerConnections.get(fromId);
    if (peer && peer.pc.remoteDescription) {
      try { await peer.pc.addIceCandidate(new RTCIceCandidate(signal.candidate)); } catch (_) {}
    } else {
      if (!pendingCandidates.has(fromId)) pendingCandidates.set(fromId, []);
      pendingCandidates.get(fromId).push(signal.candidate);
    }
  }
}

// ============================================================
// Peer speak level (game.js에서 아바타에 파동 그릴 때 사용)
// ============================================================
function updatePeerSpeakLevels() {
  peerConnections.forEach(peer => {
    if (!peer.analyser) { peer.speakLevel = 0; return; }
    const buf = new Uint8Array(peer.analyser.frequencyBinCount);
    peer.analyser.getByteFrequencyData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i];
    const rms = sum / buf.length / 255;
    peer.speakLevel = rms > 0.04 ? Math.min(1, rms * 4) : 0;
    peer.speaking   = peer.speakLevel > 0;
  });
}

function getSpeakLevel(userId) {
  if (userId === myId) return localSpeakLevel;
  const peer = peerConnections.get(userId);
  return peer ? peer.speakLevel : 0;
}

// ============================================================
// Proximity Check
// ============================================================
function checkProximity() {
  if (!myId) return;
  const me = players.get(myId);
  if (!me) return;

  const nearbyIds = new Set();
  players.forEach((player, id) => {
    if (id === myId) return;
    if (getDistance(me.x, me.y, player.x, player.y) <= PROXIMITY_DISTANCE) nearbyIds.add(id);
  });

  // 새로 가까워진 유저와 연결
  nearbyIds.forEach(id => {
    if (!peerConnections.has(id)) {
      createPeerConnection(id, myId < id);
    }
  });

  // 멀어진 유저 연결 해제
  peerConnections.forEach((_, id) => {
    if (!nearbyIds.has(id)) removePeerConnection(id);
  });

  // 거리 기반 볼륨 (audioEl.volume 직접 조절)
  nearbyIds.forEach(id => {
    const peer = peerConnections.get(id);
    if (!peer || !peer.audioEl) return;
    const player = players.get(id);
    if (!player) return;
    const vol = calcVolume(getDistance(me.x, me.y, player.x, player.y));
    peer.audioEl.volume = vol;
  });

  updateNearbyUI(nearbyIds);
}

function calcVolume(dist) {
  if (dist <= MAX_VOLUME_DISTANCE) return 1.0;
  if (dist >= PROXIMITY_DISTANCE) return 0.0;
  return 1.0 - (dist - MAX_VOLUME_DISTANCE) / (PROXIMITY_DISTANCE - MAX_VOLUME_DISTANCE);
}

function getDistance(x1, y1, x2, y2) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

function updateNearbyUI(nearbyIds) {
  const el = document.getElementById('nearbyInfo');
  if (!el) return;
  if (nearbyIds.size === 0) {
    el.textContent = '근처 사용자 없음';
    el.className = 'nearby-info';
  } else {
    const names = [];
    nearbyIds.forEach(id => { const p = players.get(id); if (p) names.push(p.name); });
    el.textContent = `근처: ${names.join(', ')}`;
    el.className = 'nearby-info has-nearby';
  }
}

// ============================================================
// Screen Share (Presentation)
// ============================================================
let screenStream = null;
let screenPeers  = new Map(); // targetId -> RTCPeerConnection
let screenVideoEl = null;     // 진행자 자신의 프리뷰 <video>
let receivedScreenVideo = null; // 시청자용 <video>

// 진행자: 화면 공유 시작
async function startScreenShare() {
  if (screenStream) return;

  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 15, width: { ideal: 1280 } },
      audio: false,
    });
  } catch (e) {
    console.warn('[Screen] getDisplayMedia failed:', e.message);
    if (typeof addSystemMessage === 'function') addSystemMessage('🖥️ 화면 공유를 취소했습니다.');
    return;
  }

  // 공유 중단 시 자동 종료
  screenStream.getVideoTracks()[0].onended = () => stopScreenShare();

  // 진행자 패널 미리보기 업데이트
  _updateScreenShareUI(true);

  // 방 안에 있는 유저에게 연결 시작
  _connectScreenToRoomPlayers();
}

// 방 안 플레이어 여부 확인
function _isInPresRoom(player) {
  if (!player || typeof PRES_ROOM === 'undefined') return false;
  return (
    player.x >= PRES_ROOM.x && player.x <= PRES_ROOM.x + PRES_ROOM.w &&
    player.y >= PRES_ROOM.y && player.y <= PRES_ROOM.y + PRES_ROOM.h
  );
}

// 진행자: 방 안 유저에게 화면 공유 연결 (신규 입장자 포함)
function _connectScreenToRoomPlayers() {
  if (!screenStream) return;
  players.forEach((player, id) => {
    if (id === myId) return;
    if (_isInPresRoom(player) && !screenPeers.has(id)) {
      _createScreenPeer(id, true);
    }
  });
}

// 진행자: 화면 공유 종료
function stopScreenShare() {
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }
  screenPeers.forEach((pc, id) => { try { pc.close(); } catch (_) {} });
  screenPeers.clear();
  if (screenVideoEl) { screenVideoEl.srcObject = null; }
  _updateScreenShareUI(false);
}

function _updateScreenShareUI(active) {
  // 툴바 버튼 상태
  const btn = document.getElementById('presShareScreenBtn');
  if (btn) {
    btn.classList.toggle('active', active);
    const label = btn.querySelector('span:last-child');
    if (label) label.textContent = active ? '공유 중지' : '화면 공유';
  }

  // 진행자 뷰: 스테이지 메인 video
  const video    = document.getElementById('presScreenPreview');
  const standby  = document.getElementById('presStandbyMsg');
  if (video) {
    if (active && screenStream) {
      video.srcObject = screenStream;
      video.play().catch(() => {});
      video.classList.remove('hidden');
    } else {
      video.srcObject = null;
      video.classList.add('hidden');
    }
  }
  if (standby) standby.classList.toggle('hidden', active);
}

// 진행자: 개별 시청자에게 PeerConnection 생성
async function _createScreenPeer(targetId, isInitiator) {
  if (screenPeers.has(targetId)) return;

  const pc = new RTCPeerConnection(ICE_SERVERS);
  screenPeers.set(targetId, pc);

  if (screenStream) {
    screenStream.getTracks().forEach(t => pc.addTrack(t, screenStream));
  }

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socketScreenSignal(targetId, { type: 'ice-candidate', candidate });
  };
  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
      screenPeers.delete(targetId);
    }
  };

  if (isInitiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketScreenSignal(targetId, { type: 'offer', sdp: pc.localDescription });
  }
  return pc;
}

// 시청자: 화면 수신 시작
function startReceivingScreen(presenterId) {
  // 진행자가 offer를 보내올 때까지 대기 (handleScreenSignal이 처리)
  console.log('[Screen] waiting for screen from', presenterId);
}

// 시그널 처리 (진행자 ↔ 시청자 공통)
const _screenPendingCandidates = new Map();

async function handleScreenSignal(fromId, signal) {
  if (signal.type === 'offer') {
    // 시청자: offer 수신
    const pc = new RTCPeerConnection(ICE_SERVERS);
    screenPeers.set(fromId, pc);

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socketScreenSignal(fromId, { type: 'ice-candidate', candidate });
    };
    pc.ontrack = ({ streams }) => {
      const stream = streams[0];
      if (!stream) return;

      // 숨김 버퍼 video (canvas 렌더링용)
      if (!receivedScreenVideo) {
        receivedScreenVideo = document.createElement('video');
        receivedScreenVideo.autoplay    = true;
        receivedScreenVideo.playsInline = true;
        receivedScreenVideo.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
        document.body.appendChild(receivedScreenVideo);
      }
      receivedScreenVideo.srcObject = stream;
      receivedScreenVideo.play().catch(() => {});

      // 시청자 뷰 메인 video + standby 전환
      const overlayVideo = document.getElementById('presViewerVideo');
      const standby      = document.getElementById('viewerStandbyMsg');
      if (overlayVideo) {
        overlayVideo.srcObject = stream;
        overlayVideo.play().catch(err => {
          const resume = () => { overlayVideo.play().catch(() => {}); };
          document.addEventListener('click', resume, { once: true });
        });
        overlayVideo.classList.remove('hidden');
      }
      if (standby) standby.classList.add('hidden');
    };

    await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    const pending = _screenPendingCandidates.get(fromId) || [];
    for (const c of pending) { try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {} }
    _screenPendingCandidates.delete(fromId);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socketScreenSignal(fromId, { type: 'answer', sdp: pc.localDescription });

  } else if (signal.type === 'answer') {
    // 진행자: answer 수신
    const pc = screenPeers.get(fromId);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    const pending = _screenPendingCandidates.get(fromId) || [];
    for (const c of pending) { try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {} }
    _screenPendingCandidates.delete(fromId);

  } else if (signal.type === 'ice-candidate') {
    const pc = screenPeers.get(fromId);
    if (pc && pc.remoteDescription) {
      try { await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)); } catch (_) {}
    } else {
      if (!_screenPendingCandidates.has(fromId)) _screenPendingCandidates.set(fromId, []);
      _screenPendingCandidates.get(fromId).push(signal.candidate);
    }
  }
}

// canvas 렌더링에서 현재 프레임 꺼내기
function getScreenShareFrame() {
  // 시청자: 받은 스트림 비디오
  if (receivedScreenVideo && receivedScreenVideo.srcObject && !receivedScreenVideo.paused) {
    return receivedScreenVideo;
  }
  // 진행자 자신: 공유 중인 스트림 프리뷰
  const v = document.getElementById('presScreenPreview');
  if (v && v.srcObject && !v.paused) return v;
  return null;
}

// ============================================================
// Cleanup
// ============================================================
function cleanupWebRTC() {
  stopMic();
  peerConnections.forEach((_, id) => removePeerConnection(id));
  if (audioContext && audioContext.state !== 'closed') audioContext.close().catch(() => {});
}

setInterval(() => {
  checkProximity();
  updateLocalSpeakLevel();
  updatePeerSpeakLevels();
}, CHECK_INTERVAL_MS);

window.addEventListener('beforeunload', cleanupWebRTC);
