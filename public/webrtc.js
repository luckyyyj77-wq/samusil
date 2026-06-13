'use strict';

// ============================================================
// Constants & State
// ============================================================
const PROXIMITY_DISTANCE  = 250; // 연결 범위 확대 (150 -> 250)
const MAX_VOLUME_DISTANCE = 60;
const CHECK_INTERVAL_MS   = 500;

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ]
};

let localStream    = null;
let isMicActive    = false;
let audioContext   = null;

// Perfect Negotiation State
const makingOffer = new Map(); // targetId -> boolean
const ignoreOffer = new Map(); // targetId -> boolean

// userId -> { pc, audioEl, analyser, speaking, speakLevel }
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
    try {
      const AC = window.AudioContext || window['webkitAudioContext'];
      if (AC) {
        audioContext = new AC();
        console.log('[WebRTC] AudioContext created');
      }
    } catch (e) {
      console.error('[WebRTC] AudioContext creation failed', e);
    }
  }
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
  return audioContext;
}

// 사용자의 첫 인터랙션(입장 버튼 등)에서 호출하여 오디오 잠금 해제
function unlockAudio() {
  const ac = ensureAudioContext();
  if (ac && ac.state === 'suspended') {
    ac.resume().then(() => console.log('[WebRTC] AudioContext resumed by user gesture'));
  }
}

// ============================================================
// Local mic analyser (말할 때 파동용)
// ============================================================
function setupLocalAnalyser(stream) {
  try {
    const ac = ensureAudioContext();
    if (!ac) return;
    const src = ac.createMediaStreamSource(stream);
    localAnalyser = ac.createAnalyser();
    localAnalyser.fftSize = 256;
    localAnalyser.smoothingTimeConstant = 0.5;
    src.connect(localAnalyser);
  } catch (e) {
    console.warn('[WebRTC] localAnalyser setup failed:', e);
  }
}

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
  unlockAudio();

  if (isMicActive) {
    stopMic();
    socketMuteToggle(true);
    if (myId && players.has(myId)) players.get(myId).muted = true;
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showMicError('이 브라우저는 마이크를 지원하지 않거나 HTTPS 연결이 필요합니다.');
    return;
  }

  setMicUI('requesting');

  const constraints = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false };
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    setMicUI('muted');
    showMicError('마이크를 시작할 수 없습니다. 권한 설정을 확인해 주세요.');
    return;
  }

  localStream = stream;
  setupLocalAnalyser(stream);
  isMicActive = true;
  setMicUI('active');
  socketMuteToggle(false);
  if (myId && players.has(myId)) players.get(myId).muted = false;

  peerConnections.forEach((_, id) => addLocalTracksToPeer(id));
}

function stopMic() {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  isMicActive = false;
  localAnalyser = null;
  localSpeakLevel = 0;
  setMicUI('muted');
  
  peerConnections.forEach(peer => {
    const sender = peer.senders?.get('audio');
    if (sender) sender.replaceTrack(null).catch(() => {});
  });
}

// ============================================================
// Peer Connection (Perfect Negotiation)
// ============================================================
function addLocalTracksToPeer(targetId) {
  if (!localStream) return;
  const peer = peerConnections.get(targetId);
  if (!peer) return;
  
  localStream.getTracks().forEach(track => {
    const existing = peer.senders?.get(track.kind);
    if (existing) {
      existing.replaceTrack(track).catch(e => console.warn('[WebRTC] replaceTrack failed:', e));
    } else {
      const sender = peer.pc.addTrack(track, localStream);
      if (!peer.senders) peer.senders = new Map();
      peer.senders.set(track.kind, sender);
    }
  });
}

async function createPeerConnection(targetId, isInitiator) {
  if (peerConnections.has(targetId)) return peerConnections.get(targetId);

  console.log(`[WebRTC] create PC → ${targetId} initiator=${isInitiator}`);
  const pc = new RTCPeerConnection(ICE_SERVERS);

  const peer = { pc, audioEl: null, analyser: null, speaking: false, speakLevel: 0, polite: !isInitiator };
  peerConnections.set(targetId, peer);
  pendingCandidates.set(targetId, []);
  makingOffer.set(targetId, false);
  ignoreOffer.set(targetId, false);

  const polite = peer.polite;

  pc.onnegotiationneeded = async () => {
    try {
      makingOffer.set(targetId, true);
      await pc.setLocalDescription();
      socketWebRTCSignal(targetId, { type: 'offer', sdp: pc.localDescription });
    } catch (err) {
      console.error(`[WebRTC] negotiationneeded error with ${targetId}:`, err);
    } finally {
      makingOffer.set(targetId, false);
    }
  };

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socketWebRTCSignal(targetId, { type: 'ice-candidate', candidate });
  };

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed') pc.restartIce();
    if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'closed') {
      removePeerConnection(targetId);
    }
  };

  pc.ontrack = ({ streams }) => {
    console.log('[WebRTC] ontrack from', targetId);
    const stream = streams[0];
    if (!stream) return;

    let audio = peer.audioEl;
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      audio.setAttribute('playsinline', '');
      audio.style.display = 'none';
      document.body.appendChild(audio);
      peer.audioEl = audio;
    }
    audio.srcObject = stream;
    audio.play().catch(err => {
      console.warn('[WebRTC] autoplay blocked, waiting for gesture');
      const resume = () => { audio.play().catch(() => {}); document.removeEventListener('click', resume); };
      document.addEventListener('click', resume, { once: true });
    });

    try {
      const ac  = ensureAudioContext();
      if (ac) {
        const src = ac.createMediaStreamSource(stream);
        peer.analyser = ac.createAnalyser();
        peer.analyser.fftSize = 256;
        src.connect(peer.analyser);
      }
    } catch (e) { console.warn('[WebRTC] peer analyser setup failed'); }
  };

  if (localStream) addLocalTracksToPeer(targetId);

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
  makingOffer.delete(targetId);
  ignoreOffer.delete(targetId);
}

async function handleWebRTCSignal(fromId, signal) {
  let peer = peerConnections.get(fromId);
  if (!peer && signal.type === 'offer') {
    peer = await createPeerConnection(fromId, false);
  }
  if (!peer) return;

  const pc = peer.pc;
  const polite = peer.polite;

  try {
    if (signal.type === 'offer') {
      const offerCollision = makingOffer.get(fromId) || pc.signalingState !== 'stable';
      if (offerCollision && !polite) {
        console.log(`[WebRTC] Glare: Ignoring offer from ${fromId}`);
        return;
      }

      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      await _flushPendingCandidates(fromId, pc);
      await pc.setLocalDescription();
      socketWebRTCSignal(fromId, { type: 'answer', sdp: pc.localDescription });

    } else if (signal.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      await _flushPendingCandidates(fromId, pc);

    } else if (signal.type === 'ice-candidate') {
      if (pc.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } else {
        pendingCandidates.get(fromId)?.push(signal.candidate);
      }
    }
  } catch (err) {
    console.error(`[WebRTC] signal error from ${fromId}:`, err);
  }
}

async function _flushPendingCandidates(id, pc) {
  const pending = pendingCandidates.get(id);
  if (!pending || pending.length === 0) return;
  for (const c of pending) {
    try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {}
  }
  pending.length = 0;
}

// ============================================================
// Proximity & Update Loops
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

function checkProximity() {
  if (!myId) return;
  const me = players.get(myId);
  if (!me) return;

  const nearbyIds = new Set();
  players.forEach((player, id) => {
    if (id === myId) return;
    const dist = Math.sqrt((player.x - me.x) ** 2 + (player.y - me.y) ** 2);
    if (dist <= PROXIMITY_DISTANCE) nearbyIds.add(id);
  });

  nearbyIds.forEach(id => {
    if (!peerConnections.has(id)) createPeerConnection(id, myId < id);
  });

  peerConnections.forEach((_, id) => {
    if (!nearbyIds.has(id)) removePeerConnection(id);
  });

  nearbyIds.forEach(id => {
    const peer = peerConnections.get(id);
    if (!peer || !peer.audioEl) return;
    const player = players.get(id);
    if (!player) return;
    const dist = Math.sqrt((player.x - me.x) ** 2 + (player.y - me.y) ** 2);
    peer.audioEl.volume = calcVolume(dist);
  });

  const el = document.getElementById('nearbyInfo');
  if (el) el.textContent = nearbyIds.size === 0 ? '근처 사용자 없음' : `근처: ${nearbyIds.size}명`;
}

function calcVolume(dist) {
  if (dist <= MAX_VOLUME_DISTANCE) return 1.0;
  if (dist >= PROXIMITY_DISTANCE) return 0.0;
  return 1.0 - (dist - MAX_VOLUME_DISTANCE) / (PROXIMITY_DISTANCE - MAX_VOLUME_DISTANCE);
}

// ============================================================
// Screen Share (Presentation)
// ============================================================
let screenStream = null;
const screenPeers = new Map(); // targetId -> pc
const _screenPendingCandidates = new Map();

async function startScreenShare() {
  if (screenStream) return;
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    screenStream = stream;

    const preview = document.getElementById('presScreenPreview');
    const standby = document.getElementById('presStandbyMsg');
    if (preview) {
      preview.srcObject = stream;
      preview.play();
      preview.classList.remove('hidden');
    }
    if (standby) standby.classList.add('hidden');

    stream.getVideoTracks()[0].onended = () => stopScreenShare();

    // 서버에 화면 공유 시작 알림
    if (typeof socketPresScreenStart === 'function') socketPresScreenStart();
  } catch (err) {
    console.error('[WebRTC] startScreenShare failed:', err);
    showMicError('화면 공유를 시작할 수 없습니다.');
  }
}

function stopScreenShare() {
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }
  const preview = document.getElementById('presScreenPreview');
  const standby = document.getElementById('presStandbyMsg');
  if (preview) {
    preview.srcObject = null;
    preview.classList.add('hidden');
  }
  if (standby) standby.classList.remove('hidden');

  screenPeers.forEach(pc => pc.close());
  screenPeers.clear();
  _screenPendingCandidates.clear();
}

async function _createScreenPeer(targetId, isInitiator) {
  if (screenPeers.has(targetId)) return screenPeers.get(targetId);

  const pc = new RTCPeerConnection(ICE_SERVERS);
  screenPeers.set(targetId, pc);

  if (screenStream) {
    screenStream.getTracks().forEach(track => pc.addTrack(track, screenStream));
  }

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socketScreenSignal(targetId, { type: 'ice-candidate', candidate });
  };

  if (isInitiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketScreenSignal(targetId, { type: 'offer', sdp: pc.localDescription });
  }

  return pc;
}

async function handleScreenSignal(fromId, signal) {
  if (signal.type === 'offer') {
    // 시청자 입장: offer 수신
    const pc = new RTCPeerConnection(ICE_SERVERS);
    screenPeers.set(fromId, pc);

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socketScreenSignal(fromId, { type: 'ice-candidate', candidate });
    };

    pc.ontrack = ({ streams }) => {
      const stream = streams[0];
      const video  = document.getElementById('presViewerVideo');
      const standby = document.getElementById('viewerStandbyMsg');
      if (video) {
        video.srcObject = stream;
        video.play().catch(() => {
          const resume = () => { video.play(); document.removeEventListener('click', resume); };
          document.addEventListener('click', resume);
        });
        video.classList.remove('hidden');
      }
      if (standby) standby.classList.add('hidden');
    };

    await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    const pending = _screenPendingCandidates.get(fromId) || [];
    for (const c of pending) await pc.addIceCandidate(new RTCIceCandidate(c));
    _screenPendingCandidates.delete(fromId);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socketScreenSignal(fromId, { type: 'answer', sdp: pc.localDescription });

  } else if (signal.type === 'answer') {
    const pc = screenPeers.get(fromId);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      const pending = _screenPendingCandidates.get(fromId) || [];
      for (const c of pending) await pc.addIceCandidate(new RTCIceCandidate(c));
      _screenPendingCandidates.delete(fromId);
    }
  } else if (signal.type === 'ice-candidate') {
    const pc = screenPeers.get(fromId);
    if (pc && pc.remoteDescription) {
      await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
    } else {
      if (!_screenPendingCandidates.has(fromId)) _screenPendingCandidates.set(fromId, []);
      _screenPendingCandidates.get(fromId).push(signal.candidate);
    }
  }
}

// ============================================================
// Cleanup & Update Loops
// ============================================================
setInterval(() => {
  checkProximity();
  updateLocalSpeakLevel();
  updatePeerSpeakLevels();
}, CHECK_INTERVAL_MS);

function cleanupWebRTC() {
  stopMic();
  stopScreenShare();
  peerConnections.forEach((_, id) => removePeerConnection(id));
}
window.addEventListener('beforeunload', cleanupWebRTC);
