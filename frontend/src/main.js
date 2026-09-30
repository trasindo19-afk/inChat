import './style.css';
import appIcon from './inchat.png';

const LAN_GROUP_ID = '__lan_group__';

const state = {
  identity: null,
  settings: null,
  peers: new Map(),
  selectedPeer: null,
  messages: new Map(),
  pc: null,
  activeCallPeer: null,
  localStream: null,
  cameraTrack: null,
  screenTrack: null,
  audioSender: null,
  videoSender: null,
  group: null,
  pendingFileOffer: null,
  pendingPaste: null,
  groupUnread: 0,
  startedAt: 0
};

const $ = (id) => document.getElementById(id);
const app = () => window.go?.main?.App;

/* =========================================================================
   Web Audio Synthesizer (Zero External Audio Files)
   ========================================================================= */

let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playChime() {
  if (state.settings?.soundNotifications === false) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, now);
    gain1.gain.setValueAtTime(0.12, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.22);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1320, now + 0.09);
    gain2.gain.setValueAtTime(0.14, now + 0.09);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.09);
    osc2.stop(now + 0.35);
  } catch (_) {}
}

function playSentTick() {
  if (state.settings?.soundNotifications === false) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(640, now);
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.04);
    gain.gain.setValueAtTime(0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.04);
  } catch (_) {}
}

let ringInterval = null;
function startRingTone() {
  if (state.settings?.soundNotifications === false || ringInterval) return;
  const playRing = () => {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(480, now + 0.2);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.8);
    } catch (_) {}
  };
  playRing();
  ringInterval = setInterval(playRing, 2500);
}

function stopRingTone() {
  if (ringInterval) {
    clearInterval(ringInterval);
    ringInterval = null;
  }
}

/* =========================================================================
   Utilities & Formatters
   ========================================================================= */

function showToast(message, timeout = 3500) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), timeout);
}

function initials(name = '?') {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

function escapeHtml(value = '') {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function formatTime(date = new Date()) {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const EMOJI_PALETTE = ['🚀', '🍕', '🎯', '⚡', '🛡️', '💎', '🌟', '🍀', '🔥', '🦊', '🎨', '🪐', '🎸', '🌈', '🍦', '🛸', '🦁', '⚓', '🔮', '🏆'];

function fingerprintToEmojis(fingerprint = '') {
  if (!fingerprint) return '🔒 ✨ 🛡️ 🔑';
  let hash = 0;
  for (let i = 0; i < fingerprint.length; i += 1) {
    hash = ((hash << 5) - hash) + fingerprint.charCodeAt(i);
    hash |= 0;
  }
  const abs = Math.abs(hash);
  const e1 = EMOJI_PALETTE[abs % EMOJI_PALETTE.length];
  const e2 = EMOJI_PALETTE[Math.floor(abs / 7) % EMOJI_PALETTE.length];
  const e3 = EMOJI_PALETTE[Math.floor(abs / 31) % EMOJI_PALETTE.length];
  const e4 = EMOJI_PALETTE[Math.floor(abs / 127) % EMOJI_PALETTE.length];
  return `${e1} ${e2} ${e3} ${e4}`;
}

function renderFormattedText(text) {
  if (!text) return '';
  const codeBlocks = [];
  let formatted = text.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push({ lang: lang || 'code', raw: code.trim(), code: escapeHtml(code.trim()) });
    return placeholder;
  });

  formatted = escapeHtml(formatted);
  formatted = formatted.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  formatted = formatted.replace(/_([^_]+)_/g, '<em>$1</em>');
  formatted = formatted.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

  for (let i = 0; i < codeBlocks.length; i += 1) {
    const block = codeBlocks[i];
    const blockHtml = `
      <div class="code-block-wrapper">
        <div class="code-header">
          <span>${escapeHtml(block.lang)}</span>
          <button class="code-copy-btn" data-copy-code="${encodeURIComponent(block.raw)}">Copy</button>
        </div>
        <pre class="code-pre"><code>${block.code}</code></pre>
      </div>`;
    formatted = formatted.replace(`__CODE_BLOCK_${i}__`, blockHtml);
  }

  return formatted;
}

async function callApp(method, ...args) {
  const api = app();
  if (!api?.[method]) throw new Error(`inChat backend is not ready: ${method}`);
  return api[method](...args);
}

/* =========================================================================
   Application Initialization
   ========================================================================= */

async function init() {
  $('app-brand-icon').src = appIcon;
  bindEvents();
  setupDragAndDrop();
  setupPasteHandler();

  try {
    state.identity = await callApp('GetIdentity');
    $('device-name').textContent = state.identity.name;
    $('device-id').textContent = state.identity.id;
    state.settings = await callApp('GetSettings');
    applySettingsToUI();
    await loadMessageHistory();
  } catch (error) {
    $('network-status').textContent = 'Backend unavailable';
    showToast(error.message, 6000);
  }

  window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', () => {
    if (state.settings?.theme === 'system') applyTheme('system');
  });

  if (window.runtime?.EventsOn) {
    window.runtime.EventsOn('peer', (peer) => updatePeer(peer));
    window.runtime.EventsOn('message', (payload) => receiveMessage(payload));
    window.runtime.EventsOn('chat-ack', (payload) => handleChatAck(payload));
    window.runtime.EventsOn('pong', (payload) => handlePong(payload));
    window.runtime.EventsOn('group-message', (payload) => receiveGroupMessage(payload));
    window.runtime.EventsOn('signal', (payload) => handleSignal(payload).catch((error) => showToast(error.message)));
    window.runtime.EventsOn('file', (payload) => receiveFile(payload));
    window.runtime.EventsOn('file-offer', (payload) => handleFileOffer(payload));
    window.runtime.EventsOn('file-progress', (payload) => updateFileProgress(payload));
    window.runtime.EventsOn('file-complete', (payload) => completeFileTransfer(payload));
    window.runtime.EventsOn('file-cancelled', (payload) => cancelFileMessage(payload));
    window.runtime.EventsOn('error', (payload) => showToast(`${payload.component}: ${payload.message}`, 6000));
    window.runtime.EventsOn('status', () => setNetworkStatus(true));
  }

  await refreshPeers();
  setInterval(refreshPeers, 2000);
  refreshFirewallStatus();
}

const peerStatusLine = (peer) => {
  switch (peer.status) {
    case 'online': return 'online';
    case 'connecting': return 'connecting…';
    case 'failed': return `failed · ${peer.lastError || 'unknown error'}`;
    default: return 'discovered';
  }
};

async function refreshFirewallStatus() {
  if (!app()?.CheckFirewall) return;
  try {
    const result = await callApp('CheckFirewall');
    state.firewall = result;
    const banner = $('firewall-banner');
    const needsAttention = result.available && !result.allowed;
    banner.classList.toggle('hidden', !needsAttention);
    if (needsAttention) {
      $('firewall-banner-text').textContent = result.message;
    }
  } catch (_) {
    // Non-fatal
  }
}

async function allowFirewall() {
  const button = $('firewall-allow');
  button.disabled = true;
  button.textContent = 'Waiting for approval…';
  try {
    const result = await callApp('AllowFirewall');
    state.firewall = result;
    if (result.allowed) {
      $('firewall-banner').classList.add('hidden');
      showToast('Windows Firewall is now allowing inChat.');
    } else {
      $('firewall-banner-text').textContent = result.message;
      showToast('Firewall access was not granted. The banner stays visible.');
    }
  } catch (error) {
    showToast(error.message, 6000);
  } finally {
    button.disabled = false;
    button.textContent = 'Allow inChat';
  }
}

function bindEvents() {
  $('send-button').addEventListener('click', sendCurrentMessage);
  $('message-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendCurrentMessage();
    }
  });

  $('lan-room-card').addEventListener('click', selectLanGroupRoom);
  $('rename-button').addEventListener('click', renameDevice);
  $('add-peer-button').addEventListener('click', connectManualPeer);
  $('settings-button').addEventListener('click', showSettings);
  $('close-settings').addEventListener('click', () => $('settings-modal').classList.add('hidden'));
  $('choose-avatar').addEventListener('click', chooseAvatar);
  $('choose-folder').addEventListener('click', chooseReceiveFolder);
  $('save-settings').addEventListener('click', saveSettings);
  $('check-update').addEventListener('click', checkForUpdates);
  $('voice-button').addEventListener('click', () => startOutgoingCall(false));
  $('video-button').addEventListener('click', () => startOutgoingCall(true));
  $('group-button').addEventListener('click', startGroupCall);
  $('rdp-button').addEventListener('click', launchRDP);
  $('attach-button').addEventListener('click', pickAndSendFile);
  $('voice-note-button').addEventListener('click', startVoiceRecording);
  $('cancel-voice').addEventListener('click', cancelVoiceRecording);
  $('send-voice').addEventListener('click', sendVoiceRecording);
  $('peer-info-button').addEventListener('click', showPeerInfo);
  $('diagnostics-button').addEventListener('click', showDiagnostics);
  $('close-diagnostics').addEventListener('click', () => $('diagnostics-modal').classList.add('hidden'));
  $('close-peer-info').addEventListener('click', () => $('peer-modal').classList.add('hidden'));
  $('copy-diagnostics').addEventListener('click', () => copyText($('diagnostics-content').textContent));
  $('copy-peer-info').addEventListener('click', () => copyText($('peer-info-text').textContent));
  $('accept-file').addEventListener('click', () => resolveFileOffer(true));
  $('reject-file').addEventListener('click', () => resolveFileOffer(false));
  $('mute-button').addEventListener('click', toggleMute);
  $('camera-button').addEventListener('click', toggleCamera);
  $('screen-button').addEventListener('click', toggleScreenShare);
  $('hangup-button').addEventListener('click', endCall);
  $('firewall-allow').addEventListener('click', allowFirewall);
  $('firewall-open').addEventListener('click', () => callApp('OpenFirewallSettings').catch((error) => showToast(error.message)));
  $('firewall-dismiss').addEventListener('click', () => $('firewall-banner').classList.add('hidden'));

  $('cancel-paste').addEventListener('click', cancelPendingPaste);
  $('confirm-paste').addEventListener('click', sendPendingPaste);
  $('close-image-modal').addEventListener('click', closeImageModal);
  $('image-modal-fullscreen').addEventListener('click', toggleImageFullscreen);
  $('image-modal').addEventListener('click', (e) => {
    if (e.target === $('image-modal')) closeImageModal();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeImageModal();
      $('settings-modal').classList.add('hidden');
      $('diagnostics-modal').classList.add('hidden');
      $('peer-modal').classList.add('hidden');
      cancelPendingPaste();
      cancelVoiceRecording();
    }
  });
}

/* =========================================================================
   Voice Memo Recorder
   ========================================================================= */

let mediaRecorder = null;
let recordedAudioChunks = [];
let voiceTimerInterval = null;
let voiceStartTime = 0;

async function startVoiceRecording() {
  if (!state.selectedPeer) return showToast('Select a peer first');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedAudioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data?.size > 0) recordedAudioChunks.push(e.data);
    };
    mediaRecorder.start();
    voiceStartTime = Date.now();
    $('voice-timer').textContent = '0:00';
    $('voice-recording-bar').classList.remove('hidden');
    $('message-input').classList.add('hidden');
    $('send-button').classList.add('hidden');

    voiceTimerInterval = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - voiceStartTime) / 1000);
      const m = Math.floor(elapsedSec / 60);
      const s = elapsedSec % 60;
      $('voice-timer').textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
    }, 500);
  } catch (err) {
    showToast(`Microphone access failed: ${err.message}`);
  }
}

function cancelVoiceRecording() {
  if (voiceTimerInterval) clearInterval(voiceTimerInterval);
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stream.getTracks().forEach((t) => t.stop());
    mediaRecorder.stop();
  }
  mediaRecorder = null;
  recordedAudioChunks = [];
  $('voice-recording-bar').classList.add('hidden');
  $('message-input').classList.remove('hidden');
  $('send-button').classList.remove('hidden');
}

async function sendVoiceRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
  clearInterval(voiceTimerInterval);

  mediaRecorder.onstop = async () => {
    const audioBlob = new Blob(recordedAudioChunks, { type: 'audio/webm' });
    mediaRecorder.stream.getTracks().forEach((t) => t.stop());
    mediaRecorder = null;

    $('voice-recording-bar').classList.add('hidden');
    $('message-input').classList.remove('hidden');
    $('send-button').classList.remove('hidden');

    if (audioBlob.size < 200) return; // Too short

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      const base64 = dataUrl.split(',')[1];
      const now = new Date();
      const timeStr = `${now.getHours()}${now.getMinutes()}${now.getSeconds()}`;
      const name = `voice-memo-${timeStr}.webm`;

      if (state.selectedPeer === LAN_GROUP_ID) {
        addMessage(LAN_GROUP_ID, {
          kind: 'audio',
          name,
          url: dataUrl,
          size: audioBlob.size,
          mine: true,
          senderName: state.identity?.name,
          time: formatTime()
        });
        await callApp('BroadcastMessage', `[Voice memo sent: ${name}]`);
        return;
      }

      try {
        await callApp('SendFileDirect', state.selectedPeer, name, 'audio/webm', base64);
        addMessage(state.selectedPeer, {
          kind: 'audio',
          name,
          url: dataUrl,
          size: audioBlob.size,
          mine: true,
          time: formatTime()
        });
        playSentTick();
      } catch (err) {
        showToast(`Could not send voice memo: ${err.message}`);
      }
    };
    reader.readAsDataURL(audioBlob);
  };
  mediaRecorder.stop();
}

/* =========================================================================
   Drag and Drop & Screenshot Paste
   ========================================================================= */

function setupDragAndDrop() {
  const overlay = $('drop-overlay');
  const section = $('conversation-section');

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (state.selectedPeer) overlay.classList.remove('hidden');
  });

  window.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null || e.clientX <= 0 || e.clientY <= 0) {
      overlay.classList.add('hidden');
    }
  });

  section.addEventListener('drop', async (e) => {
    e.preventDefault();
    overlay.classList.add('hidden');
    if (!state.selectedPeer) return showToast('Select a peer or the LAN Group Room first');

    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;

    for (const file of files) {
      if (file.type.startsWith('image/')) {
        handleImageFile(file);
      } else {
        await sendDirectOrDataFile(file);
      }
    }
  });
}

function setupPasteHandler() {
  window.addEventListener('paste', (event) => {
    if (!state.selectedPeer) return;
    const items = event.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.indexOf('image') !== -1) {
        const file = item.getAsFile();
        if (file) {
          event.preventDefault();
          handleImageFile(file);
          break;
        }
      }
    }
  });
}

function handleImageFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    const now = new Date();
    const timestamp = `${now.getHours()}${now.getMinutes()}${now.getSeconds()}`;
    const name = file.name && file.name !== 'image.png' ? file.name : `screenshot-${timestamp}.png`;
    state.pendingPaste = {
      file,
      dataUrl,
      name,
      size: file.size,
      mime: file.type || 'image/png'
    };
    $('paste-preview-img').src = dataUrl;
    $('paste-filename').textContent = name;
    $('paste-filesize').textContent = formatBytes(file.size);
    $('paste-preview').classList.remove('hidden');
    $('message-input').focus();
  };
  reader.readAsDataURL(file);
}

function cancelPendingPaste() {
  state.pendingPaste = null;
  $('paste-preview').classList.add('hidden');
}

async function sendPendingPaste() {
  const item = state.pendingPaste;
  if (!item || !state.selectedPeer) return;
  cancelPendingPaste();

  const caption = $('message-input').value.trim();
  $('message-input').value = '';

  const base64Data = item.dataUrl.split(',')[1];
  if (!base64Data) return;

  if (state.selectedPeer === LAN_GROUP_ID) {
    addMessage(LAN_GROUP_ID, {
      kind: 'image',
      name: item.name,
      size: item.size,
      url: item.dataUrl,
      caption,
      mine: true,
      senderName: state.identity?.name,
      time: formatTime()
    });
    playSentTick();
    await callApp('BroadcastMessage', caption ? `[Shared photo: ${item.name}] ${caption}` : `[Shared photo: ${item.name}]`);
    return;
  }

  try {
    await callApp('SendFileDirect', state.selectedPeer, item.name, item.mime, base64Data);
    addMessage(state.selectedPeer, {
      kind: 'image',
      name: item.name,
      size: item.size,
      url: item.dataUrl,
      caption,
      mine: true,
      time: formatTime()
    });
    playSentTick();
    if (caption) {
      await callApp('SendMessage', state.selectedPeer, caption);
      addMessage(state.selectedPeer, { kind: 'text', text: caption, mine: true, status: 'sent', time: formatTime() });
    }
  } catch (error) {
    showToast(`Could not send photo: ${error.message}`);
  }
}

async function sendDirectOrDataFile(file) {
  if (state.selectedPeer === LAN_GROUP_ID) {
    return showToast('File transfers are 1-on-1 direct. Select a peer to send files.');
  }

  if (file.size <= 15 * 1024 * 1024) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      const base64 = dataUrl.split(',')[1];
      try {
        await callApp('SendFileDirect', state.selectedPeer, file.name, file.type || 'application/octet-stream', base64);
        addMessage(state.selectedPeer, {
          kind: 'file',
          name: file.name,
          size: file.size,
          url: dataUrl,
          mine: true,
          time: formatTime()
        });
        playSentTick();
        showToast(`Sent ${file.name}`);
      } catch (err) {
        showToast(err.message);
      }
    };
    reader.readAsDataURL(file);
  } else {
    showToast(`Large file (${formatBytes(file.size)}): use Attach button or direct LAN file selector`);
  }
}

/* =========================================================================
   LAN Group Room, Peer Navigation & Ping
   ========================================================================= */

let pingInterval = null;

function selectLanGroupRoom() {
  state.selectedPeer = LAN_GROUP_ID;
  state.groupUnread = 0;
  $('lan-room-badge').classList.add('hidden');
  $('lan-room-card').classList.add('selected');
  document.querySelectorAll('.peer-row').forEach((r) => r.classList.remove('selected'));

  updateConversationHeader();
  renderMessages();
  startPingTimer(null);
}

function updateConversationHeader() {
  const isGroup = state.selectedPeer === LAN_GROUP_ID;
  const peer = isGroup ? null : state.peers.get(state.selectedPeer);

  $('conversation-empty').classList.toggle('hidden', Boolean(isGroup || peer));
  $('conversation').classList.toggle('hidden', !isGroup && !peer);
  if (!isGroup && !peer) return;

  if (isGroup) {
    const onlineCount = [...state.peers.values()].filter((p) => p.connected).length;
    $('conversation-name').textContent = 'LAN Group Room';
    $('conversation-state').textContent = `${onlineCount} peer(s) online · Broadcast mesh`;
    $('conversation-state').classList.remove('state-failed');
    $('conversation-ping').classList.add('hidden');
    $('voice-button').classList.add('hidden');
    $('video-button').classList.add('hidden');
    $('rdp-button').classList.add('hidden');
    $('group-button').classList.remove('hidden');
    $('peer-info-button').classList.add('hidden');
    return;
  }

  $('voice-button').classList.remove('hidden');
  $('video-button').classList.remove('hidden');
  $('rdp-button').classList.remove('hidden');
  $('group-button').classList.remove('hidden');
  $('peer-info-button').classList.remove('hidden');

  $('conversation-name').textContent = peer.name || 'Unknown device';
  const stateLine = peerStatusLine(peer);
  $('conversation-state').textContent = peer.connected ? 'online · direct connection' : stateLine;
  $('conversation-state').classList.toggle('state-failed', peer.status === 'failed');
  $('conversation-state').title = peer.lastError || '';

  if (peer.connected) {
    startPingTimer(peer.id);
  } else {
    $('conversation-ping').classList.add('hidden');
  }
}

function startPingTimer(peerId) {
  if (pingInterval) clearInterval(pingInterval);
  if (!peerId || peerId === LAN_GROUP_ID) {
    $('conversation-ping').classList.add('hidden');
    return;
  }
  const sendPing = () => {
    if (state.selectedPeer !== peerId) return;
    callApp('PingPeer', peerId, Date.now()).catch(() => {});
  };
  sendPing();
  pingInterval = setInterval(sendPing, 4000);
}

function handlePong(payload) {
  if (state.selectedPeer === payload.peer_id && payload.data?.ts) {
    const rtt = Math.max(1, Date.now() - payload.data.ts);
    const badge = $('conversation-ping');
    badge.textContent = `⚡ ${rtt} ms`;
    badge.classList.remove('hidden');
  }
}

async function refreshPeers() {
  try {
    const peers = await callApp('GetPeers');
    state.peers = new Map(peers.map((peer) => [peer.id, peer]));
    renderPeers();
    setNetworkStatus(true);
  } catch (error) {
    setNetworkStatus(false);
  }
}

function setNetworkStatus(online) {
  const element = $('network-status');
  element.textContent = online ? 'LAN online' : 'Searching…';
  element.classList.toggle('online', online);
}

async function connectManualPeer() {
  const address = window.prompt('Peer LAN IP address (example: 192.168.1.50)');
  if (!address?.trim()) return;
  try {
    const peer = await callApp('ManualConnect', address.trim());
    state.peers.set(peer.id, peer);
    renderPeers();
    showToast(`Connected to ${peer.name || peer.address}`);
  } catch (error) {
    showToast(`Manual connection failed: ${error.message}`);
  }
}

function updatePeer(peer) {
  state.peers.set(peer.id, peer);
  renderPeers();
  if (state.selectedPeer === peer.id || state.selectedPeer === LAN_GROUP_ID) {
    updateConversationHeader();
  }
}

function renderPeers() {
  const list = $('peer-list');
  const peers = [...state.peers.values()].sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
  $('peer-count').textContent = peers.length;

  const onlineCount = peers.filter((p) => p.connected).length;
  $('lan-room-status').textContent = `Local broadcast · ${onlineCount} online`;

  if (!peers.length) {
    list.innerHTML = '<div class="empty-state">Looking for peers on your LAN…<br>Make sure both devices are on the same network.</div>';
    return;
  }
  list.innerHTML = peers.map((peer) => `
    <button class="peer-row ${peer.id === state.selectedPeer ? 'selected' : ''}" data-peer-id="${escapeHtml(peer.id)}">
      <span class="peer-avatar">${escapeHtml(initials(peer.name))}<span class="dot ${peer.connected ? 'green' : ''}" style="position:absolute;right:-1px;bottom:1px;border:2px solid #0f172a"></span></span>
      <span class="peer-copy"><strong>${escapeHtml(peer.name || 'Unknown device')}</strong><small class="${peer.status === 'failed' ? 'status-failed' : ''}" title="${escapeHtml(peer.lastError || '')}">${escapeHtml(peerStatusLine(peer))}</small></span>
    </button>`).join('');

  list.querySelectorAll('[data-peer-id]').forEach((button) => {
    button.addEventListener('click', () => selectPeer(button.dataset.peerId));
  });
}

function selectPeer(peerId) {
  state.selectedPeer = peerId;
  $('lan-room-card').classList.remove('selected');
  renderPeers();
  updateConversationHeader();
  renderMessages();
  callApp('ConnectPeer', peerId).catch((error) => showToast(error.message));
}

/* =========================================================================
   Messages & Chat Rendering
   ========================================================================= */

function renderMessages() {
  const list = $('message-list');
  const messages = state.messages.get(state.selectedPeer) || [];
  if (!messages.length) {
    const isGroup = state.selectedPeer === LAN_GROUP_ID;
    list.innerHTML = `<div class="empty-state">${isGroup ? 'Welcome to the LAN Group Room.<br>Broadcast messages to everyone on your local network.' : 'This conversation is private and direct.<br>Say hello to start.'}</div>`;
    return;
  }
  list.innerHTML = messages.map((m) => {
    if (m.kind === 'file') return renderFileMessage(m);
    if (m.kind === 'image') return renderImageMessage(m);
    if (m.kind === 'audio') return renderAudioMessage(m);
    return renderTextMessage(m);
  }).join('');

  list.querySelectorAll('[data-cancel-transfer]').forEach((button) => {
    button.addEventListener('click', () => cancelFileTransfer(button.dataset.cancelTransfer));
  });

  list.querySelectorAll('[data-image-preview]').forEach((img) => {
    img.addEventListener('click', () => openImageModal(img.src, img.alt));
  });

  list.querySelectorAll('[data-copy-code]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const code = decodeURIComponent(btn.dataset.copyCode || '');
      copyText(code);
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    });
  });

  list.querySelectorAll('[data-voice-audio]').forEach((audio) => {
    const id = audio.dataset.voiceAudio;
    const btn = list.querySelector(`[data-voice-btn="${id}"]`);
    const progress = list.querySelector(`[data-voice-prog="${id}"]`);
    const durLabel = list.querySelector(`[data-voice-dur="${id}"]`);

    audio.onloadedmetadata = () => {
      const dur = Math.round(audio.duration || 0);
      if (durLabel) durLabel.textContent = `0:${dur < 10 ? '0' : ''}${dur}`;
    };

    audio.ontimeupdate = () => {
      if (audio.duration && progress) {
        const pct = (audio.currentTime / audio.duration) * 100;
        progress.style.width = `${pct}%`;
      }
    };

    audio.onended = () => {
      if (btn) btn.textContent = '▶';
      if (progress) progress.style.width = '0%';
    };

    if (btn) {
      btn.onclick = () => {
        if (audio.paused) {
          document.querySelectorAll('audio').forEach((a) => { if (a !== audio) a.pause(); });
          audio.play().catch(() => {});
          btn.textContent = '⏸';
        } else {
          audio.pause();
          btn.textContent = '▶';
        }
      };
    }
  });

  list.scrollTop = list.scrollHeight;
}

function renderTextMessage(message) {
  const senderTag = message.senderName && !message.mine ? `<span class="message-sender">${escapeHtml(message.senderName)}</span>` : '';
  const statusCheck = message.mine ? (message.status === 'delivered' ? '<span class="delivery-status delivered">✓✓</span>' : '<span class="delivery-status">✓</span>') : '';
  return `<div class="message ${message.mine ? 'mine' : ''}">${senderTag}<div class="message-bubble">${renderFormattedText(message.text)}</div><small class="message-time">${message.time}${statusCheck}</small></div>`;
}

function renderImageMessage(message) {
  const senderTag = message.senderName && !message.mine ? `<span class="message-sender">${escapeHtml(message.senderName)}</span>` : '';
  const captionHtml = message.caption ? `<div style="margin-top:4px;font-size:13px">${renderFormattedText(message.caption)}</div>` : '';
  const statusCheck = message.mine ? (message.status === 'delivered' ? '<span class="delivery-status delivered">✓✓</span>' : '<span class="delivery-status">✓</span>') : '';
  return `
    <div class="message ${message.mine ? 'mine' : ''}">
      ${senderTag}
      <div class="message-bubble" style="padding:6px 8px">
        <div class="message-image-card">
          <img src="${message.url}" alt="${escapeHtml(message.name || 'Image')}" data-image-preview="true" />
        </div>
        ${captionHtml}
      </div>
      <small class="message-time">${message.time}${statusCheck}</small>
    </div>`;
}

function renderAudioMessage(message) {
  const audioId = `audio-${message.time.replace(/[^0-9]/g, '')}-${Math.random().toString(16).slice(2, 6)}`;
  const senderTag = message.senderName && !message.mine ? `<span class="message-sender">${escapeHtml(message.senderName)}</span>` : '';
  const statusCheck = message.mine ? (message.status === 'delivered' ? '<span class="delivery-status delivered">✓✓</span>' : '<span class="delivery-status">✓</span>') : '';
  return `
    <div class="message ${message.mine ? 'mine' : ''}">
      ${senderTag}
      <div class="message-bubble" style="padding:6px 10px">
        <div class="voice-note-bubble">
          <button class="voice-play-btn" data-voice-btn="${audioId}">▶</button>
          <div class="voice-track">
            <div class="voice-progress" data-voice-prog="${audioId}"></div>
          </div>
          <span class="voice-duration" data-voice-dur="${audioId}">Voice memo</span>
          <audio src="${message.url}" data-voice-audio="${audioId}" preload="metadata"></audio>
        </div>
      </div>
      <small class="message-time">${message.time}${statusCheck}</small>
    </div>`;
}

function renderFileMessage(message) {
  const progress = Number.isFinite(message.progress) ? `${message.progress}%` : '';
  const target = message.savedPath
    ? `<span><strong>Saved</strong><br><small>${escapeHtml(message.savedPath)}</small></span>`
    : message.url
      ? `<a href="${message.url}" download="${escapeHtml(message.name)}">${escapeHtml(message.name)}<br><small>${formatBytes(message.size)}</small></a>`
      : `<span>${escapeHtml(message.name || 'File transfer')}<br><small>${message.cancelled ? 'cancelled' : `sending ${progress}`}</small></span>${message.transferId && message.sending ? `<button class="cancel-transfer" data-cancel-transfer="${escapeHtml(message.transferId)}">Cancel</button>` : ''}`;
  return `<div class="message ${message.mine ? 'mine' : ''}"><div class="message-bubble file-message"><div class="file-icon-box">▧</div>${target}</div><small class="message-time">${message.time}</small></div>`;
}

function openImageModal(src, title) {
  const img = $('image-modal-img');
  img.src = src;
  $('image-modal-title').textContent = title || 'Image preview';
  $('image-modal-download').href = src;
  $('image-modal-download').download = title || 'image.png';
  $('image-modal-meta').textContent = 'Loading dimensions…';
  img.onload = () => {
    $('image-modal-meta').textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
  };
  $('image-modal').classList.remove('hidden');
}

function closeImageModal() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
  $('image-modal').classList.add('hidden');
}

function toggleImageFullscreen() {
  const stage = document.querySelector('.image-modal-stage');
  if (!document.fullscreenElement) {
    stage?.requestFullscreen?.().catch(() => {
      $('image-modal-img')?.requestFullscreen?.().catch(() => {});
    });
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

async function sendCurrentMessage() {
  if (state.pendingPaste) {
    return sendPendingPaste();
  }

  const input = $('message-input');
  const text = input.value.trim();
  if (!text || !state.selectedPeer) return;

  const msgId = `m-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  if (state.selectedPeer === LAN_GROUP_ID) {
    try {
      await callApp('BroadcastMessage', text);
      addMessage(LAN_GROUP_ID, {
        id: msgId,
        kind: 'text',
        text,
        mine: true,
        senderName: state.identity?.name,
        time: formatTime()
      });
      playSentTick();
      input.value = '';
    } catch (error) {
      showToast(error.message);
    }
    return;
  }

  try {
    await callApp('SendMessage', state.selectedPeer, text);
    addMessage(state.selectedPeer, { id: msgId, kind: 'text', text, mine: true, status: 'sent', time: formatTime() });
    playSentTick();
    input.value = '';
  } catch (error) {
    showToast(error.message);
  }
}

function handleChatAck(payload) {
  const messages = state.messages.get(payload.peer_id);
  if (messages) {
    const msg = messages.find((m) => m.id === payload.id);
    if (msg) {
      msg.status = 'delivered';
      saveMessageHistory();
      if (state.selectedPeer === payload.peer_id) renderMessages();
    }
  }
}

/* =========================================================================
   Chat History Persistence (Disk + LocalStorage)
   ========================================================================= */

async function loadMessageHistory() {
  try {
    let saved = null;
    if (app()?.LoadChatHistory) {
      const diskJson = await callApp('LoadChatHistory');
      if (diskJson) saved = JSON.parse(diskJson);
    }
    if (!saved) {
      const raw = window.localStorage.getItem('inchat.messages.v1');
      if (raw) saved = JSON.parse(raw);
    }
    if (saved) {
      for (const [peerId, messages] of Object.entries(saved)) {
        if (Array.isArray(messages)) {
          state.messages.set(peerId, messages.slice(-300));
        }
      }
    }
  } catch (_) {
    state.messages = new Map();
  }
}

function saveMessageHistory() {
  const value = {};
  for (const [peerId, messages] of state.messages) {
    value[peerId] = messages.slice(-300);
  }
  const jsonStr = JSON.stringify(value);
  try { window.localStorage.setItem('inchat.messages.v1', jsonStr); } catch (_) {}
  if (app()?.SaveChatHistory) {
    callApp('SaveChatHistory', jsonStr).catch(() => {});
  }
}

function addMessage(peerId, message) {
  if (!state.messages.has(peerId)) state.messages.set(peerId, []);
  state.messages.get(peerId).push(message);
  saveMessageHistory();
  if (state.selectedPeer === peerId) renderMessages();
}

function receiveMessage(payload) {
  addMessage(payload.peer_id, { id: payload.id, kind: 'text', text: payload.text, mine: false, time: formatTime() });
  playChime();
  showToast(`New message from ${state.peers.get(payload.peer_id)?.name || 'peer'}`);
}

function receiveGroupMessage(payload) {
  addMessage(LAN_GROUP_ID, {
    id: payload.id,
    kind: 'text',
    text: payload.text,
    mine: false,
    senderName: payload.name,
    time: formatTime()
  });
  playChime();
  if (state.selectedPeer !== LAN_GROUP_ID) {
    state.groupUnread += 1;
    $('lan-room-badge').textContent = state.groupUnread;
    $('lan-room-badge').classList.remove('hidden');
    showToast(`LAN Room: ${payload.name}: ${payload.text}`);
  }
}

function receiveFile(payload) {
  try {
    const isImage = (payload.mime && payload.mime.startsWith('image/')) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(payload.name);
    const isAudio = payload.mime?.startsWith('audio/') || /\.(webm|ogg|mp3|wav)$/i.test(payload.name);
    let url = '';
    if (payload.data) {
      const binary = atob(payload.data || '');
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const mime = payload.mime || (isAudio ? 'audio/webm' : isImage ? 'image/png' : 'application/octet-stream');
      const blob = new Blob([bytes], { type: mime });
      url = URL.createObjectURL(blob);
    }

    if (isAudio && url) {
      addMessage(payload.peer_id, {
        kind: 'audio',
        name: payload.name,
        size: payload.size,
        url,
        mine: false,
        time: formatTime()
      });
      playChime();
      showToast(`Received voice memo`);
      return;
    }

    if (isImage && url) {
      addMessage(payload.peer_id, {
        kind: 'image',
        name: payload.name,
        size: payload.size,
        url,
        savedPath: payload.saved_path || '',
        mine: false,
        time: formatTime()
      });
      playChime();
      showToast(payload.saved_path ? `Saved photo ${payload.name}` : `Received photo ${payload.name}`);
      return;
    }

    if (payload.saved_path) {
      addMessage(payload.peer_id, {
        kind: 'file',
        name: payload.name,
        size: payload.size,
        savedPath: payload.saved_path,
        mine: false,
        time: formatTime()
      });
      playChime();
      showToast(`Saved ${payload.name}`);
      return;
    }

    if (url) {
      addMessage(payload.peer_id, {
        kind: 'file',
        name: payload.name,
        size: payload.size,
        url,
        mine: false,
        time: formatTime()
      });
      playChime();
      showToast(`Received ${payload.name}`);
    }
  } catch (error) {
    showToast(`Could not receive file: ${error.message}`);
  }
}

async function handleFileOffer(payload) {
  const peer = state.peers.get(payload.peer_id);
  state.pendingFileOffer = payload;
  $('file-offer-text').textContent = `${peer?.name || 'A peer'} wants to send ${payload.name} (${formatBytes(payload.size)}).`;
  $('file-offer-modal').classList.remove('hidden');
}

async function resolveFileOffer(accept) {
  const offer = state.pendingFileOffer;
  if (!offer) return;
  state.pendingFileOffer = null;
  $('file-offer-modal').classList.add('hidden');
  try {
    await callApp('AcceptFileTransfer', offer.transfer_id, accept);
  } catch (error) {
    showToast(error.message);
  }
}

function findFileMessage(transferId) {
  for (const [peerId, messages] of state.messages) {
    const message = messages.find((item) => item.transferId === transferId);
    if (message) return { peerId, message };
  }
  return null;
}

function updateFileProgress(payload) {
  const found = findFileMessage(payload.transfer_id);
  if (!found) return;
  found.message.progress = payload.total ? Math.min(100, Math.round((payload.sent / payload.total) * 100)) : 0;
  found.message.sending = true;
  if (found.peerId === state.selectedPeer) renderMessages();
}

function completeFileTransfer(payload) {
  const found = findFileMessage(payload.transfer_id);
  if (found) {
    found.message.sending = false;
    found.message.progress = 100;
    found.message.savedPath = payload.saved_path || '';
    found.message.name = payload.name || found.message.name;
    saveMessageHistory();
    if (found.peerId === state.selectedPeer) renderMessages();
  } else if (payload.saved_path) {
    addMessage(payload.peer_id, { kind: 'file', name: payload.name, size: payload.size, savedPath: payload.saved_path, mine: false, time: formatTime() });
  }
  playChime();
  showToast(payload.saved_path ? `Saved ${payload.name}` : `Sent ${payload.name}`);
}

function cancelFileMessage(payload) {
  const found = findFileMessage(payload.transfer_id);
  if (!found) return;
  found.message.sending = false;
  found.message.cancelled = true;
  if (found.peerId === state.selectedPeer) renderMessages();
}

async function cancelFileTransfer(transferId) {
  try {
    await callApp('CancelFileTransfer', transferId);
  } catch (error) {
    showToast(error.message);
  }
}

async function pickAndSendFile() {
  if (!state.selectedPeer || state.selectedPeer === LAN_GROUP_ID) {
    return showToast('Select a direct peer to send files');
  }
  try {
    const transfer = await callApp('PickAndSendFile', state.selectedPeer);
    if (transfer?.transfer_id) addMessage(state.selectedPeer, { kind: 'file', transferId: transfer.transfer_id, name: transfer.name, size: transfer.size, mine: true, progress: 0, sending: true, time: formatTime() });
  } catch (error) {
    if (error) showToast(error.message);
  }
}

async function renameDevice() {
  const name = window.prompt('Display name', state.identity?.name || 'My device');
  if (!name?.trim()) return;
  try {
    await callApp('SetDisplayName', name.trim());
    state.identity.name = name.trim();
    if (state.settings) state.settings.displayName = name.trim();
    $('device-name').textContent = state.identity.name;
    showToast('Display name updated');
  } catch (error) {
    showToast(error.message);
  }
}

function applyAvatar(element, dataUrl) {
  const image = element.querySelector('img');
  const fallback = element.querySelector('span');
  if (dataUrl && image) {
    image.src = dataUrl;
    image.hidden = false;
    if (fallback) fallback.hidden = true;
  } else {
    if (image) {
      image.removeAttribute('src');
      image.hidden = true;
    }
    if (fallback) {
      fallback.hidden = false;
      fallback.textContent = 'I';
    }
  }
}

function applyTheme(theme) {
  const systemLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;
  const light = theme === 'light' || (theme === 'system' && systemLight);
  document.body.classList.toggle('theme-light', light);
  document.body.dataset.theme = light ? 'light' : 'dark';
}

async function applySettingsToUI() {
  if (!state.settings) return;
  $('settings-display-name').value = state.settings.displayName || '';
  $('settings-receive-folder').value = state.settings.receiveFolder || '';
  $('settings-update-feed').value = state.settings.updateFeedUrl || '';
  $('settings-theme').value = state.settings.theme || 'dark';
  applyTheme(state.settings.theme || 'dark');
  $('auto-accept-files').checked = Boolean(state.settings.autoAcceptFiles);
  $('sound-notifications').checked = state.settings.soundNotifications !== false;

  try {
    const autoStart = await callApp('GetAutoStart');
    $('auto-start-boot').checked = Boolean(autoStart);
  } catch (_) {}

  applyAvatar($('local-avatar'), state.settings.avatarData);
  applyAvatar($('settings-avatar-preview'), state.settings.avatarData);
}

async function showSettings() {
  try {
    state.settings = await callApp('GetSettings');
    await applySettingsToUI();
    $('settings-modal').classList.remove('hidden');
  } catch (error) {
    showToast(error.message);
  }
}

async function chooseAvatar() {
  try {
    state.settings = await callApp('ChooseAvatar');
    await applySettingsToUI();
    showToast('Profile photo updated');
  } catch (error) {
    if (error) showToast(error.message);
  }
}

async function chooseReceiveFolder() {
  try {
    const folder = await callApp('ChooseReceiveFolder');
    if (folder) {
      state.settings.receiveFolder = folder;
      $('settings-receive-folder').value = folder;
      showToast('Receive folder updated');
    }
  } catch (error) {
    if (error) showToast(error.message);
  }
}

async function checkForUpdates() {
  $('update-status').textContent = 'Checking…';
  try {
    const info = await callApp('CheckForUpdates');
    $('update-status').textContent = info.message || (info.available ? `Update ${info.latestVersion} available` : 'Up to date');
    if (info.available && info.downloadUrl && window.confirm(`inChat ${info.latestVersion} is available. Download and install now?`)) {
      $('update-status').textContent = 'Downloading…';
      const path = await callApp('DownloadUpdate', info.downloadUrl);
      await callApp('ApplyUpdate', path);
    }
  } catch (error) {
    $('update-status').textContent = error.message;
  }
}

async function saveSettings() {
  try {
    const displayName = $('settings-display-name').value.trim();
    const autoAccept = $('auto-accept-files').checked;
    const soundEnabled = $('sound-notifications').checked;
    const autoStart = $('auto-start-boot').checked;
    const updateFeed = $('settings-update-feed').value.trim();
    const theme = $('settings-theme').value;

    await callApp('SetDisplayName', displayName);
    await callApp('SetAutoAcceptFiles', autoAccept);
    await callApp('SetUpdateFeedURL', updateFeed);
    await callApp('SetTheme', theme);

    try { await callApp('SetAutoStart', autoStart); } catch (_) {}

    state.identity.name = displayName;
    state.settings = await callApp('GetSettings');
    state.settings.soundNotifications = soundEnabled;
    await applySettingsToUI();
    $('settings-modal').classList.add('hidden');
    showToast('Settings saved');
  } catch (error) {
    showToast(error.message);
  }
}

async function launchRDP() {
  if (!state.selectedPeer || state.selectedPeer === LAN_GROUP_ID) return showToast('Select a direct peer first');
  const peer = state.peers.get(state.selectedPeer);
  if (!peer) return;
  try {
    await callApp('LaunchRDP', state.selectedPeer);
    showToast(`Opening Windows RDP to ${peer.name || peer.address}`);
  } catch (error) {
    showToast(`RDP could not start: ${error.message}`);
  }
}

/* =========================================================================
   Calls & WebRTC Signaling
   ========================================================================= */

async function startGroupCall() {
  if (state.pc || state.group) return showToast('Another call is already active');
  const connectedPeers = [...state.peers.values()].filter((peer) => peer.connected);
  if (connectedPeers.length < 1) return showToast('At least one connected peer is needed for a call');

  const participants = [state.identity?.id, ...connectedPeers.map((peer) => peer.id)].slice(0, 5);
  const names = participants
    .filter((id) => id !== state.identity?.id)
    .map((id) => state.peers.get(id)?.name || 'Unknown device')
    .join(', ');
  if (!window.confirm(`Start group call with ${names}?`)) return;

  try {
    state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
    state.cameraTrack = state.localStream.getVideoTracks()[0] || null;
    $('local-video').srcObject = state.localStream;
    state.group = { id: `g-${Date.now()}-${Math.random().toString(16).slice(2)}`, host: state.identity?.id, participants, pcs: new Map() };
    openGroupCallPanel();
    for (const participant of participants) {
      if (participant === state.identity?.id) continue;
      await createGroupPeerConnection(participant);
    }
    const invite = JSON.stringify({ call_id: state.group.id, host: state.identity?.id, participants });
    for (const participant of participants) {
      if (participant !== state.identity?.id) await callApp('SendSignal', participant, 'group-invite', invite);
    }
    await createGroupOffers();
  } catch (error) {
    await endCall();
    showToast(`Group call failed: ${error.message}`);
  }
}

async function createGroupPeerConnection(peerId) {
  const group = state.group;
  if (!group || group.pcs.has(peerId)) return group?.pcs.get(peerId);
  const pc = new RTCPeerConnection({ iceServers: [] });
  group.pcs.set(peerId, pc);
  pc.onicecandidate = async (event) => {
    if (state.group?.id !== group.id || !event.candidate) return;
    await callApp('SendSignal', peerId, 'group-candidate', JSON.stringify({ call_id: group.id, candidate: event.candidate.toJSON() }));
  };
  pc.ontrack = (event) => {
    if (state.group?.id !== group.id) return;
    attachGroupRemote(peerId, event.streams[0]);
  };
  pc.onconnectionstatechange = () => {
    if (state.group?.id === group.id) $('call-status').textContent = `${peerId.slice(0, 6)}: ${pc.connectionState}`;
  };
  state.localStream?.getTracks().forEach((track) => pc.addTrack(track, state.localStream));
  return pc;
}

async function createGroupOffers() {
  const group = state.group;
  if (!group) return;
  for (const peerId of group.participants) {
    if (peerId === state.identity.id) continue;
    if (state.identity.id.localeCompare(peerId) > 0) continue;
    const pc = group.pcs.get(peerId);
    if (!pc) continue;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await callApp('SendSignal', peerId, 'group-offer', JSON.stringify({ call_id: group.id, sdp: pc.localDescription }));
  }
}

function openGroupCallPanel() {
  document.querySelector('.video-stage').classList.add('group-mode');
  $('call-panel').classList.remove('hidden');
  $('call-title').textContent = `Group call · ${state.group.participants.length} people`;
  $('call-status').textContent = 'connecting…';
  $('camera-button').classList.remove('hidden');
  $('screen-button').classList.add('hidden');
  $('mute-button').classList.remove('active');
  $('mute-button').textContent = 'Mic';
  $('call-placeholder').classList.remove('hidden');
  $('call-placeholder').textContent = 'Group call';
}

function attachGroupRemote(peerId, stream) {
  const stage = document.querySelector('.video-stage');
  let video = document.getElementById(`group-remote-${peerId}`);
  if (!video) {
    video = document.createElement('video');
    video.id = `group-remote-${peerId}`;
    video.className = 'group-remote-video';
    video.autoplay = true;
    video.playsInline = true;
    stage.appendChild(video);
  }
  video.srcObject = stream;
  $('call-placeholder').classList.add('hidden');
}

async function acceptGroupInvite(payload) {
  const data = JSON.parse(payload.data);
  if (state.pc || state.group) return;
  const participants = [...new Set(data.participants || [])];
  if (!participants.includes(payload.peer_id) || !participants.includes(state.identity.id)) return showToast('Invalid group call invitation');

  startRingTone();
  const accept = window.confirm(`Accept group call from ${state.peers.get(payload.peer_id)?.name || 'peer'}?`);
  stopRingTone();
  if (!accept) return;

  try {
    state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
    state.cameraTrack = state.localStream.getVideoTracks()[0] || null;
    $('local-video').srcObject = state.localStream;
    state.group = { id: data.call_id, host: payload.peer_id, participants, pcs: new Map() };
    openGroupCallPanel();
    for (const participant of participants) {
      if (participant !== state.identity.id) await createGroupPeerConnection(participant);
    }
    await createGroupOffers();
  } catch (error) {
    await endCall();
    showToast(`Could not join group call: ${error.message}`);
  }
}

async function handleGroupSignal(payload) {
  if (payload.kind === 'group-invite') return acceptGroupInvite(payload);
  if (!state.group) return;
  const data = JSON.parse(payload.data);
  if (data.call_id !== state.group.id) return;
  if (payload.kind === 'group-offer') {
    const pc = await createGroupPeerConnection(payload.peer_id);
    if (!pc) return;
    await pc.setRemoteDescription(data.sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await callApp('SendSignal', payload.peer_id, 'group-answer', JSON.stringify({ call_id: state.group.id, sdp: pc.localDescription }));
  } else if (payload.kind === 'group-answer') {
    const pc = state.group.pcs.get(payload.peer_id);
    if (pc) await pc.setRemoteDescription(data.sdp);
  } else if (payload.kind === 'group-candidate') {
    const pc = state.group.pcs.get(payload.peer_id);
    if (pc) await pc.addIceCandidate(data.candidate);
  } else if (payload.kind === 'group-hangup') {
    await endCall();
  }
}

async function startOutgoingCall(withVideo) {
  if (!state.selectedPeer || state.selectedPeer === LAN_GROUP_ID) return showToast('Select a direct peer first');
  const peer = state.peers.get(state.selectedPeer);
  if (!peer?.connected) return showToast('Peer is still connecting');
  try {
    await ensureCall(peer.id, withVideo);
    const offer = await state.pc.createOffer();
    await state.pc.setLocalDescription(offer);
    await callApp('SendSignal', peer.id, 'offer', JSON.stringify(offer));
    openCallPanel(peer, withVideo);
  } catch (error) {
    await endCall();
    showToast(`Call failed: ${error.message}`);
  }
}

async function ensureCall(peerId, withVideo) {
  await endCall(false);
  state.activeCallPeer = peerId;
  state.startedAt = Date.now();
  const pc = new RTCPeerConnection({ iceServers: [] });
  state.pc = pc;
  pc.onicecandidate = async (event) => {
    if (state.pc !== pc) return;
    if (event.candidate) await callApp('SendSignal', peerId, 'candidate', JSON.stringify(event.candidate.toJSON()));
  };
  pc.ontrack = (event) => {
    if (state.pc !== pc) return;
    $('remote-video').srcObject = event.streams[0];
    $('call-placeholder').classList.add('hidden');
  };
  pc.onconnectionstatechange = () => {
    if (state.pc === pc) $('call-status').textContent = pc.connectionState;
  };
  if (withVideo) {
    state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
  } else {
    state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  }
  state.localStream.getTracks().forEach((track) => {
    const sender = pc.addTrack(track, state.localStream);
    if (track.kind === 'video') state.videoSender = sender;
  });
  state.cameraTrack = state.localStream.getVideoTracks()[0] || null;
  $('local-video').srcObject = state.localStream;
}

async function handleSignal(payload) {
  const peer = state.peers.get(payload.peer_id);
  if (!peer) return;
  if (payload.kind.startsWith('group-')) return handleGroupSignal(payload);
  if (state.activeCallPeer && state.activeCallPeer !== payload.peer_id) return;
  if (payload.kind === 'offer') {
    startRingTone();
    const accept = window.confirm(`Accept ${peer.name || 'peer'} incoming call?`);
    stopRingTone();
    if (!accept) {
      callApp('SendSignal', payload.peer_id, 'hangup', JSON.stringify({ reason: 'declined' })).catch(() => {});
      return;
    }
    const offer = JSON.parse(payload.data);
    const withVideo = Boolean(offer.sdp?.includes('m=video'));
    await ensureCall(payload.peer_id, withVideo);
    await state.pc.setRemoteDescription(offer);
    const answer = await state.pc.createAnswer();
    await state.pc.setLocalDescription(answer);
    await callApp('SendSignal', payload.peer_id, 'answer', JSON.stringify(answer));
    openCallPanel(peer, withVideo);
  } else if (payload.kind === 'answer' && state.pc) {
    await state.pc.setRemoteDescription(JSON.parse(payload.data));
  } else if (payload.kind === 'candidate' && state.pc) {
    await state.pc.addIceCandidate(JSON.parse(payload.data));
  } else if (payload.kind === 'hangup') {
    stopRingTone();
    await endCall();
    showToast(`${peer.name || 'Peer'} ended the call`);
  }
}

function openCallPanel(peer, withVideo) {
  document.querySelector('.video-stage').classList.remove('group-mode');
  $('call-panel').classList.remove('hidden');
  $('call-title').textContent = peer.name || 'Peer';
  $('call-status').textContent = 'connecting…';
  $('camera-button').classList.toggle('hidden', !withVideo);
  $('screen-button').classList.remove('hidden');
  $('screen-button').disabled = !withVideo;
  $('screen-button').title = withVideo ? 'Share screen' : 'Screen sharing requires a video call';
}

async function toggleMute() {
  if (!state.localStream) return;
  const enabled = state.localStream.getAudioTracks().some((track) => !track.enabled);
  state.localStream.getAudioTracks().forEach((track) => { track.enabled = enabled; });
  $('mute-button').classList.toggle('active', !enabled);
  $('mute-button').textContent = enabled ? 'Mic' : 'Muted';
}

async function toggleCamera() {
  if (!state.cameraTrack) return;
  if (state.group) {
    state.cameraTrack.enabled = !state.cameraTrack.enabled;
    $('camera-button').classList.toggle('active', !state.cameraTrack.enabled);
    return;
  }
  if (!state.pc) return;
  const enabled = state.cameraTrack.enabled;
  state.cameraTrack.enabled = !enabled;
  $('camera-button').classList.toggle('active', !enabled);
}

async function toggleScreenShare() {
  if (!state.pc || !state.activeCallPeer) return;
  if (state.screenTrack) {
    state.screenTrack.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    state.screenTrack = stream.getVideoTracks()[0];
    if (state.videoSender) {
      await state.videoSender.replaceTrack(state.screenTrack);
    } else {
      state.videoSender = state.pc.addTrack(state.screenTrack, stream);
    }
    state.screenTrack.onended = async () => {
      if (state.cameraTrack && state.videoSender) await state.videoSender.replaceTrack(state.cameraTrack);
      state.screenTrack = null;
      $('screen-button').classList.remove('active');
      $('screen-button').textContent = 'Share';
    };
    $('screen-button').classList.add('active');
    $('screen-button').textContent = 'Stop';
  } catch (error) {
    showToast(`Screen sharing was not started: ${error.message}`);
  }
}

async function endCall(closePanel = true) {
  stopRingTone();
  if (state.group) {
    const group = state.group;
    for (const peerId of group.participants) {
      if (peerId === state.identity?.id) continue;
      callApp('SendSignal', peerId, 'group-hangup', JSON.stringify({ call_id: group.id })).catch(() => {});
    }
    for (const pc of group.pcs.values()) pc.close();
    document.querySelectorAll('.group-remote-video').forEach((video) => video.remove());
    state.group = null;
  }
  if (state.pc) {
    if (state.activeCallPeer) {
      callApp('SendSignal', state.activeCallPeer, 'hangup', JSON.stringify({ reason: 'ended' })).catch(() => {});
    }
    state.pc.getSenders().forEach((sender) => { try { sender.track?.stop(); } catch (_) {} });
    state.pc.close();
  }
  state.screenTrack?.stop();
  state.pc = null;
  state.activeCallPeer = null;
  state.localStream?.getTracks().forEach((track) => track.stop());
  state.localStream = null;
  state.cameraTrack = null;
  state.screenTrack = null;
  state.videoSender = null;
  state.audioSender = null;
  $('remote-video').srcObject = null;
  $('local-video').srcObject = null;
  document.querySelector('.video-stage').classList.remove('group-mode');
  $('call-placeholder').textContent = 'Voice call';
  if (closePanel) $('call-panel').classList.add('hidden');
}

async function showDiagnostics() {
  try {
    const diagnostics = await callApp('GetDiagnostics');
    try { diagnostics.firewall = await callApp('CheckFirewall'); } catch (_) { /* non-fatal */ }
    $('diagnostics-content').textContent = JSON.stringify(diagnostics, null, 2);
    $('diagnostics-modal').classList.remove('hidden');
  } catch (error) {
    showToast(error.message);
  }
}

function showPeerInfo() {
  const peer = state.peers.get(state.selectedPeer);
  if (!peer) return;
  $('peer-emoji-display').textContent = fingerprintToEmojis(peer.fingerprint);
  $('peer-info-text').textContent = `Visual emoji code & SHA-256 fingerprint for ${peer.name || 'peer'}:\n\n${peer.fingerprint || 'Not available yet'}`;
  $('peer-modal').classList.remove('hidden');
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); showToast('Copied'); } catch (_) { showToast('Could not copy text'); }
}

init();
