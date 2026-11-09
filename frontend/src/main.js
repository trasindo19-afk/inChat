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
  startedAt: 0,
  replyingTo: null,
  pinnedMessages: new Map(),
  searchQuery: '',
  searchMatches: [],
  currentSearchIndex: -1,
  isLocked: false,
  appPin: '',
  privacyShield: false,
  activeReactionMessageId: null,
  outbox: new Map(),
  channels: new Map(),
  peerAvatars: (() => { try { return JSON.parse(window.localStorage.getItem('inchat.peer_avatars') || '{}'); } catch (_) { return {}; } })(),
  dlpEnabled: true
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

  if (state.searchQuery && state.searchQuery.length >= 2) {
    const escapedQ = state.searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedQ})`, 'gi');
    formatted = formatted.replace(regex, '<mark class="search-highlight">$1</mark>');
  }

  return formatted;
}

async function callApp(method, ...args) {
  const api = app();
  if (!api?.[method]) throw new Error(`inChat backend is not ready: ${method}`);
  return api[method](...args);
}


/* =========================================================================
   Enterprise Security & Cryptography (Web Crypto AES-256 GCM & DLP)
   ========================================================================= */

const DANGEROUS_EXT_REGEX = /\.(exe|bat|cmd|ps1|vbs|vbe|js|jse|wsf|wsh|msc|scr|msi|dll|com|hta|cpl|jar|pif)$/i;

function isDangerousFileName(name = '') {
  return DANGEROUS_EXT_REGEX.test(name.trim());
}

async function deriveChannelKey(passphrase, channelName) {
  if (!passphrase) return null;
  const enc = new TextEncoder();
  const passKey = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  const salt = enc.encode(`inchat-chan-salt-${channelName.toLowerCase()}`);
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    passKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function bufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToBuffer(base64) {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

async function encryptChannelMessage(text, key) {
  if (!key) return text;
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(text)
  );
  return `__ENC__:${bufferToBase64(iv)}:${bufferToBase64(ciphertext)}`;
}

async function decryptChannelMessage(payloadText, key) {
  if (!payloadText || !payloadText.startsWith('__ENC__:')) {
    return payloadText;
  }
  if (!key) {
    return '🔒 [Encrypted message - Passphrase required to read]';
  }
  try {
    const parts = payloadText.split(':');
    if (parts.length < 3) return payloadText;
    const iv = base64ToBuffer(parts[1]);
    const ciphertext = base64ToBuffer(parts[2]);
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    const dec = new TextDecoder();
    return dec.decode(decrypted);
  } catch (err) {
    return '🔒 [Decryption failed - Incorrect channel passphrase]';
  }
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
    loadOutbox();
    await loadChannels();
  } catch (error) {
    $('network-status').textContent = 'Backend unavailable';
    showToast(error.message, 6000);
  }

  window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', () => {
    if (state.settings?.theme === 'system') applyTheme('system');
  });

  if (window.runtime?.EventsOn) {
    window.runtime.EventsOn('peer', (peer) => updatePeer(peer));
    window.runtime.EventsOn('peers', (peers) => handlePeersList(peers));
    window.runtime.EventsOn('message', (payload) => receiveMessage(payload));
    window.runtime.EventsOn('chat-ack', (payload) => handleChatAck(payload));
    window.runtime.EventsOn('pong', (payload) => handlePong(payload));
    window.runtime.EventsOn('group-message', (payload) => receiveGroupMessage(payload));
    window.runtime.EventsOn('channel-message', (payload) => receiveChannelMessage(payload));
    window.runtime.EventsOn('avatar', (payload) => handlePeerAvatar(payload));
    window.runtime.EventsOn('channel-invite', (payload) => handleChannelInvite(payload));
    window.runtime.EventsOn('signal', (payload) => handleSignal(payload).catch((error) => showToast(error.message)));
    window.runtime.EventsOn('file', (payload) => receiveFile(payload));
    window.runtime.EventsOn('file-offer', (payload) => handleFileOffer(payload));
    window.runtime.EventsOn('file-progress', (payload) => updateFileProgress(payload));
    window.runtime.EventsOn('file-complete', (payload) => completeFileTransfer(payload));
    window.runtime.EventsOn('file-cancelled', (payload) => cancelFileMessage(payload));
    window.runtime.EventsOn('reaction', (payload) => handleIncomingReaction(payload));
    window.runtime.EventsOn('pin', (payload) => handleIncomingPin(payload));
    window.runtime.EventsOn('error', (payload) => showToast(`${payload.component}: ${payload.message}`, 6000));
    window.runtime.EventsOn('status', () => setNetworkStatus(true));
  }

  initDoodleCanvas();
  loadSecuritySettings();

  await refreshPeers();
  setInterval(refreshPeers, 2000);
  refreshFirewallStatus();

  // First initial launch auto-scan for enterprise VLANs
  const initialVlanScanned = window.localStorage.getItem('inchat.initial_vlan_scanned');
  if (!initialVlanScanned) {
    window.localStorage.setItem('inchat.initial_vlan_scanned', 'true');
    setTimeout(async () => {
      try {
        console.log('[VLAN] Performing first-launch initial VLAN scan...');
        const res = await callApp('ScanAllVLANs', []);
        const peerCount = res?.foundPeers?.length || 0;
        if (peerCount > 0) {
          showToast(`Multi-VLAN auto-scan: found ${peerCount} peer(s) across enterprise VLANs!`);
          await refreshPeers();
        }
      } catch (err) {
        console.warn('[VLAN] Initial scan error:', err);
      }
    }, 1500);
  }
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

  // Permanent event delegation for peer-list to prevent dropped clicks during periodic refresh
  $('peer-list')?.addEventListener('click', (e) => {
    const row = e.target.closest('[data-peer-id]');
    if (row && row.dataset.peerId) {
      selectPeer(row.dataset.peerId);
    }
  });

  // Permanent event delegation for channel-list
  $('channel-list')?.addEventListener('click', (e) => {
    const delBtn = e.target.closest('[data-del-channel]');
    if (delBtn && delBtn.dataset.delChannel) {
      handleDeleteChannel(delBtn.dataset.delChannel, e);
      return;
    }
    const row = e.target.closest('[data-channel-id]');
    if (row && row.dataset.channelId) {
      selectChannel(row.dataset.channelId);
    }
  });

  $('rename-button').addEventListener('click', renameDevice);
  $('add-peer-button').addEventListener('click', openConnectModal);
  $('export-chat-button').addEventListener('click', exportCurrentChat);
  $('room-delete-header-btn').addEventListener('click', (e) => {
    if (state.selectedPeer?.startsWith('__channel_')) {
      handleDeleteChannel(state.selectedPeer, e);
    }
  });
  $('room-members-header-btn')?.addEventListener('click', showMembersModal);
  $('close-members-modal')?.addEventListener('click', () => $('members-modal').classList.add('hidden'));
  $('close-members-btn')?.addEventListener('click', () => $('members-modal').classList.add('hidden'));
  $('members-invite-btn')?.addEventListener('click', () => {
    $('members-modal')?.classList.add('hidden');
    openInviteModal();
  });
  $('add-channel-button').addEventListener('click', openChannelModal);
  $('room-invite-header-btn').addEventListener('click', openInviteModal);
  $('close-invite-modal').addEventListener('click', () => $('invite-modal').classList.add('hidden'));
  $('send-invites').addEventListener('click', sendInvites);
  $('close-channel-modal').addEventListener('click', closeChannelModal);
  $('confirm-join-channel').addEventListener('click', handleConfirmJoinChannel);
  $('close-connect').addEventListener('click', closeConnectModal);
  $('tab-single-ip').addEventListener('click', () => switchConnectTab('single'));
  $('tab-subnet-scan').addEventListener('click', () => switchConnectTab('subnet'));
  $('do-single-connect').addEventListener('click', handleSingleConnect);
  $('do-subnet-scan').addEventListener('click', handleSubnetScan);
  $('dlp-reject').addEventListener('click', handleDlpReject);
  $('dlp-proceed').addEventListener('click', handleDlpProceed);
  $('settings-button').addEventListener('click', showSettings);
  $('close-settings').addEventListener('click', () => $('settings-modal').classList.add('hidden'));
  $('choose-avatar').addEventListener('click', chooseAvatar);
  $('choose-folder').addEventListener('click', chooseReceiveFolder);
  $('save-settings').addEventListener('click', saveSettings);
  $('check-update').addEventListener('click', checkForUpdates);
  $('btn-rescan-vlans')?.addEventListener('click', rescanAllVLANs);
  $('about-button')?.addEventListener('click', showAboutModal);
  $('close-about')?.addEventListener('click', () => $('about-modal').classList.add('hidden'));
  $('close-about-btn')?.addEventListener('click', () => $('about-modal').classList.add('hidden'));
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
  $('accept-call-btn').addEventListener('click', acceptIncomingCall);
  $('decline-call-btn').addEventListener('click', declineIncomingCall);
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

  // Search
  $('search-button').addEventListener('click', toggleSearchBar);
  $('search-close').addEventListener('click', closeSearchBar);
  $('search-input').addEventListener('input', handleSearchInput);
  $('search-prev').addEventListener('click', prevSearchResult);
  $('search-next').addEventListener('click', nextSearchResult);
  $('search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.shiftKey ? prevSearchResult() : nextSearchResult();
    }
  });

  // Replying
  $('cancel-reply').addEventListener('click', cancelReply);

  // Pinned Banner
  $('pinned-banner').addEventListener('click', jumpToPinnedMessage);
  $('unpin-button').addEventListener('click', (e) => {
    e.stopPropagation();
    unpinCurrentMessage();
  });

  // Doodle
  $('doodle-button').addEventListener('click', openDoodleModal);
  $('close-doodle').addEventListener('click', closeDoodleModal);
  $('cancel-doodle').addEventListener('click', closeDoodleModal);
  $('doodle-clear').addEventListener('click', clearDoodleCanvas);
  $('send-doodle').addEventListener('click', sendDoodleSketch);

  // Clipboard
  $('clipboard-button').addEventListener('click', sendFromClipboard);

  // App Lock & PIN
  $('lock-app-button').addEventListener('click', lockApp);
  $('unlock-button').addEventListener('click', unlockApp);
  $('pin-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') unlockApp();
  });

  // Privacy Shield blur/focus
  window.addEventListener('blur', handleWindowBlur);
  window.addEventListener('focus', handleWindowFocus);

  // Close reaction popover on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.reaction-popover') && !e.target.closest('[data-action="react"]')) {
      if (state.activeReactionMessageId) {
        state.activeReactionMessageId = null;
        renderMessages();
      }
    }
  });

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      toggleSearchBar();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      sendFromClipboard();
      return;
    }
    if (e.key === 'Escape') {
      closeImageModal();
      closeSearchBar();
      closeDoodleModal();
      cancelReply();
      $('settings-modal').classList.add('hidden');
      $('about-modal')?.classList.add('hidden');
      $('members-modal')?.classList.add('hidden');
      $('diagnostics-modal').classList.add('hidden');
      $('peer-modal').classList.add('hidden');
      $('connect-modal').classList.add('hidden');
      $('channel-modal').classList.add('hidden');
      $('dlp-modal').classList.add('hidden');
      cancelPendingPaste();
      cancelVoiceRecording();
    }
  });

  // Scroll To Bottom Button & Smooth Auto-Scroll
  $('scroll-bottom-btn')?.addEventListener('click', () => {
    const list = $('message-list');
    if (list) {
      list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
    }
  });
  $('message-list')?.addEventListener('scroll', updateScrollBottomButton);
  window.addEventListener('resize', () => scrollMessagesToBottom(false));
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
  if (state.selectedPeer === LAN_GROUP_ID || state.selectedPeer?.startsWith('__channel_')) {
    return showToast('File transfers are 1-on-1 direct. Select a peer to send files.');
  }

  if (state.dlpEnabled !== false && isDangerousFileName(file.name)) {
    const ok = window.confirm(`[Enterprise DLP Warning]\n\n"${file.name}" is an executable or script binary.\nCorporate security policy flags sending binary files.\n\nDo you want to proceed with sending this file?`);
    if (!ok) return;
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

function clearAllSelections() {
  $('lan-room-card')?.classList.remove('selected');
  document.querySelectorAll('.peer-row').forEach((r) => r.classList.remove('selected'));
  document.querySelectorAll('.channel-row').forEach((r) => r.classList.remove('selected'));
  document.querySelectorAll('.channel-row-wrapper').forEach((r) => r.classList.remove('selected'));
}

function getChannelMembers(ch) {
  if (!ch) return [];
  const membersMap = new Map();
  const myId = state.identity?.id || 'local-me';
  const myName = state.identity?.name || 'You';

  // 1. Local user is always a member
  const isMeCreator = !ch.creator || ch.creator === myId || ch.creator === myName || ch.creatorName === myName;
  membersMap.set(myId, {
    id: myId,
    name: myName,
    isCreator: isMeCreator,
    isOnline: true,
    isMe: true
  });

  // 2. Room creator if not me
  if (ch.creator && ch.creator !== myId) {
    const creatorName = ch.creatorName || 'Room Creator';
    const creatorPeer = state.peers.get(ch.creator);
    membersMap.set(ch.creator, {
      id: ch.creator,
      name: creatorPeer?.name || creatorName,
      isCreator: true,
      isOnline: Boolean(creatorPeer?.connected),
      isMe: false
    });
  }

  // 3. Members registered in channel record
  if (Array.isArray(ch.members)) {
    for (const m of ch.members) {
      if (!m || !m.name) continue;
      const peer = (m.id && state.peers.get(m.id)) || [...state.peers.values()].find((p) => p.name === m.name);
      const id = m.id || peer?.id || m.name;
      const isOnline = Boolean(peer?.connected);
      const isCreator = m.isCreator || id === ch.creator || m.name === ch.creatorName;
      if (!membersMap.has(id)) {
        membersMap.set(id, {
          id,
          name: m.name,
          isCreator,
          isOnline,
          isMe: id === myId || m.name === myName
        });
      }
    }
  }

  // 4. Colleagues who sent messages in this channel
  const chMessages = (state.messages.get ? state.messages.get(ch.id) : state.messages[ch.id]) || [];
  for (const msg of chMessages) {
    if (msg.senderName && msg.senderName !== myName) {
      const peer = [...state.peers.values()].find((p) => p.name === msg.senderName);
      const id = peer?.id || msg.senderName;
      if (!membersMap.has(id)) {
        membersMap.set(id, {
          id,
          name: msg.senderName,
          isCreator: id === ch.creator || msg.senderName === ch.creatorName,
          isOnline: Boolean(peer?.connected),
          isMe: false
        });
      }
    }
  }

  return [...membersMap.values()];
}

function selectLanGroupRoom() {
  state.selectedPeer = LAN_GROUP_ID;
  state.groupUnread = 0;
  $('lan-room-badge')?.classList.add('hidden');
  clearAllSelections();
  $('lan-room-card')?.classList.add('selected');

  updateConversationHeader();
  renderMessages();
  startPingTimer(null);
}

function updateConversationHeader() {
  const isGroup = state.selectedPeer === LAN_GROUP_ID;
  const isChannel = Boolean(state.selectedPeer?.startsWith('__channel_'));
  const channel = isChannel ? state.channels.get(state.selectedPeer) : null;
  const peer = (!isGroup && !isChannel) ? state.peers.get(state.selectedPeer) : null;

  $('conversation-empty').classList.toggle('hidden', Boolean(isGroup || isChannel || peer));
  $('conversation').classList.toggle('hidden', !isGroup && !isChannel && !peer);
  if (!isGroup && !isChannel && !peer) return;

  if (isChannel && channel) {
    updatePinnedBanner();
    cancelReply();
    $('conversation-name').textContent = channel.name;
    const convAvatar = $('conversation-avatar');
    if (convAvatar) convAvatar.classList.add('hidden');

    const myId = state.identity?.id;
    const myName = state.identity?.name;
    const isCreator = !channel.creator || channel.creator === myId || channel.creator === myName || channel.creatorName === myName;
    const members = getChannelMembers(channel);
    const memberCount = members.length;
    const namesSummary = members.map((m) => m.name).slice(0, 3).join(', ') + (memberCount > 3 ? ` +${memberCount - 3}` : '');
    const roomSub = `Department Room · ${memberCount} anggota: ${namesSummary}`;
    $('conversation-state').textContent = channel.passphrase ? `🔒 AES-256 GCM Encrypted · ${roomSub}` : roomSub;
    $('conversation-state').title = `Anggota: ${members.map((m) => m.name + (m.isCreator ? ' (Creator)' : '')).join(', ')}`;
    $('conversation-state').classList.remove('state-failed');
    $('conversation-ping').classList.add('hidden');
    $('voice-button').classList.add('hidden');
    $('video-button').classList.add('hidden');
    $('rdp-button').classList.add('hidden');
    $('group-button').classList.add('hidden');
    $('peer-info-button').classList.add('hidden');

    const membersBtn = $('room-members-header-btn');
    if (membersBtn) {
      membersBtn.classList.remove('hidden');
      $('room-members-count').textContent = memberCount;
      membersBtn.title = `Lihat anggota room (${memberCount})`;
    }

    const headerBtn = $('room-delete-header-btn');
    $('room-invite-header-btn')?.classList.toggle('hidden', !isCreator);
    if (headerBtn) {
      headerBtn.classList.remove('hidden');
      if (isCreator) {
        headerBtn.textContent = '🗑️';
        headerBtn.title = 'Delete Department Room (Creator)';
      } else {
        headerBtn.textContent = '✕';
        headerBtn.title = 'Leave Room';
      }
    }
    return;
  }

  $('room-members-header-btn')?.classList.add('hidden');
  $('room-delete-header-btn')?.classList.add('hidden');
  $('room-invite-header-btn')?.classList.add('hidden');

  updatePinnedBanner();
  cancelReply();

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
  const convAvatar = $('conversation-avatar');
  if (convAvatar) {
    convAvatar.innerHTML = peerAvatarInner(peer);
    convAvatar.classList.remove('hidden');
  }

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

function cachePeerAvatars(peers = []) {
  if (!Array.isArray(peers)) return;
  for (const p of peers) {
    if (p.avatar && p.avatar.startsWith('data:image/')) {
      state.peerAvatars[p.id] = p.avatar;
      if (p.name) state.peerAvatars[p.name.trim().toLowerCase()] = p.avatar;
    }
  }
}

function handlePeersList(peers) {
  if (!Array.isArray(peers)) return;
  cachePeerAvatars(peers);
  state.peers = new Map(peers.map((peer) => [peer.id, peer]));
  renderPeers();
  if (state.selectedPeer && state.peers.has(state.selectedPeer)) {
    updateConversationHeader();
  }
}

async function refreshPeers() {
  try {
    const peers = await callApp('GetPeers');
    cachePeerAvatars(peers);
    state.peers = new Map(peers.map((peer) => [peer.id, peer]));
    renderPeers();
    setNetworkStatus(true);
    for (const p of peers) {
      if (p.connected && state.outbox.has(p.id)) {
        flushOutboxForPeer(p.id);
      }
    }
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
    if (peer.avatar && peer.avatar.startsWith('data:image/')) {
      state.peerAvatars[peer.id] = peer.avatar;
      if (peer.name) state.peerAvatars[peer.name.trim().toLowerCase()] = peer.avatar;
    }
    state.peers.set(peer.id, peer);
    renderPeers();
    showToast(`Connected to ${peer.name || peer.address}`);
  } catch (error) {
    showToast(`Manual connection failed: ${error.message}`);
  }
}

function updatePeer(peer) {
  if (peer.avatar && peer.avatar.startsWith('data:image/')) {
    state.peerAvatars[peer.id] = peer.avatar;
    if (peer.name) state.peerAvatars[peer.name.trim().toLowerCase()] = peer.avatar;
  }
  state.peers.set(peer.id, peer);
  renderPeers();
  if (state.selectedPeer === peer.id || state.selectedPeer === LAN_GROUP_ID || state.selectedPeer?.startsWith('__channel_')) {
    updateConversationHeader();
  }
  if (peer.connected) {
    flushOutboxForPeer(peer.id);
  }
}

let lastRenderedPeersSignature = '';

function renderPeers() {
  const list = $('peer-list');
  const rawPeers = [...state.peers.values()];

  // Self-healing deduplication by peer name:
  // If an online entry exists for a name, suppress any offline/failed ghost duplicates.
  const onlinePeers = rawPeers.filter((p) => p.connected);
  const onlineNames = new Set(onlinePeers.map((p) => (p.name || '').trim().toLowerCase()));

  const deduplicated = [];
  const seenNames = new Set();

  // 1. Online peers take top precedence
  for (const peer of onlinePeers) {
    const key = (peer.name || '').trim().toLowerCase();
    if (key) seenNames.add(key);
    deduplicated.push(peer);
  }

  // 2. Add unconnected peers only if no online peer of the same name exists,
  //    and skip stale certificate mismatch error records
  for (const peer of rawPeers.filter((p) => !p.connected)) {
    const key = (peer.name || '').trim().toLowerCase();
    if (key && (onlineNames.has(key) || seenNames.has(key))) {
      continue; // Skip ghost duplicate!
    }
    if (peer.status === 'failed' && (peer.lastError || '').includes('fingerprint')) {
      continue; // Skip stale certificate mismatch
    }
    if (key) seenNames.add(key);
    deduplicated.push(peer);
  }

  const peers = deduplicated.sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
  $('peer-count').textContent = peers.length;

  const onlineCount = onlinePeers.length;
  $('lan-room-status').textContent = `Local broadcast · ${onlineCount} online`;

  if (!peers.length) {
    lastRenderedPeersSignature = 'empty';
    list.innerHTML = '<div class="empty-state">Looking for peers on your LAN…<br>Make sure both devices are on the same network.</div>';
    return;
  }

  // Content signature excluding selected state
  const contentSignature = peers.map((p) => `${p.id}:${p.name}:${p.connected}:${p.status}:${p.lastError || ''}:${p.avatar ? '1' : '0'}`).join('|');

  if (lastRenderedPeersSignature === contentSignature) {
    // Fast update of selection class only, avoiding DOM rebuilding & lost clicks
    list.querySelectorAll('.peer-row').forEach((btn) => {
      btn.classList.toggle('selected', btn.dataset.peerId === state.selectedPeer);
    });
    return;
  }

  lastRenderedPeersSignature = contentSignature;
  list.innerHTML = peers.map((peer) => `
    <button class="peer-row ${peer.id === state.selectedPeer ? 'selected' : ''}" data-peer-id="${escapeHtml(peer.id)}">
      <span class="peer-avatar">${peerAvatarInner(peer)}<span class="dot ${peer.connected ? 'green' : ''}" style="position:absolute;right:-1px;bottom:1px;border:2px solid #0f172a"></span></span>
      <span class="peer-copy"><strong>${escapeHtml(peer.name || 'Unknown device')}</strong><small class="${peer.status === 'failed' ? 'status-failed' : ''}" title="${escapeHtml(peer.lastError || '')}">${escapeHtml(peerStatusLine(peer))}</small></span>
    </button>`).join('');
}

function peerAvatarInner(peer) {
  const nameKey = (peer?.name || '').trim().toLowerCase();
  const data = peer?.avatar || state.peerAvatars[peer?.id] || (nameKey ? state.peerAvatars[nameKey] : null);
  if (data && data.startsWith('data:image/')) {
    return `<img class="peer-avatar-img" src="${escapeHtml(data)}" alt="" />`;
  }
  return escapeHtml(initials(peer?.name));
}

function handlePeerAvatar(payload) {
  if (!payload?.peer_id || !payload.data) return;
  state.peerAvatars[payload.peer_id] = payload.data;
  if (payload.name) {
    state.peerAvatars[payload.name.trim().toLowerCase()] = payload.data;
  }
  const peer = state.peers.get(payload.peer_id);
  if (peer) {
    peer.avatar = payload.data;
  }
  try {
    window.localStorage.setItem('inchat.peer_avatars', JSON.stringify(state.peerAvatars));
  } catch (_) {}
  renderPeers();
  if (state.selectedPeer === payload.peer_id || (peer && state.selectedPeer === peer.name)) {
    updateConversationHeader();
  }
}

/* ---- Department room invites & members ---- */

function openInviteModal() {
  const ch = state.channels.get(state.selectedPeer);
  if (!ch) return;
  $('invite-room-name').textContent = ch.name;
  const online = [...state.peers.values()].filter((p) => p.connected);
  const list = $('invite-peer-list');
  if (!online.length) {
    list.innerHTML = '<div class="channel-empty">No colleagues online right now.</div>';
  } else {
    list.innerHTML = online.map((p) => `
      <label class="invite-row">
        <input type="checkbox" value="${escapeHtml(p.id)}" />
        <span class="peer-avatar">${peerAvatarInner(p)}</span>
        <span>${escapeHtml(p.name || 'Unknown device')}</span>
      </label>`).join('');
  }
  $('invite-modal').classList.remove('hidden');
}

async function sendInvites() {
  const ch = state.channels.get(state.selectedPeer);
  if (!ch) return;
  const ids = [...$('invite-peer-list').querySelectorAll('input:checked')].map((i) => i.value);
  if (!ids.length) return showToast('Select at least one colleague');
  if (!Array.isArray(ch.members)) ch.members = [];
  let sent = 0;
  for (const id of ids) {
    try {
      await callApp('SendChannelInvite', id, ch.name, ch.passphrase || '');
      sent++;
      const peer = state.peers.get(id);
      const peerName = peer?.name || id;
      if (!ch.members.some((m) => m.id === id || m.name === peerName)) {
        ch.members.push({ id, name: peerName, isCreator: false });
      }
    } catch (_) {}
  }
  saveChannels();
  renderChannels();
  updateConversationHeader();
  $('invite-modal').classList.add('hidden');
  showToast(`Invitation sent to ${sent} colleague${sent === 1 ? '' : 's'}`);
}

async function handleChannelInvite(payload) {
  const name = (payload?.channel || '').trim().replace(/^#+\s*/, '').slice(0, 40);
  if (!name) return;
  const channelId = `__channel_${name.toLowerCase().replace(/[^a-z0-9_-]/g, '_') || name.toLowerCase()}__`;
  if (state.channels.has(channelId)) return;
  const who = payload.from_name || 'A colleague';
  if (!confirm(`${who} invited you to the department room "${name}"${payload.passphrase ? ' (encrypted)' : ''}.\n\nJoin now?`)) return;
  let key = null;
  if (payload.passphrase) {
    try { key = await deriveChannelKey(payload.passphrase, name); } catch (_) {}
  }
  state.channels.set(channelId, {
    id: channelId,
    name,
    passphrase: payload.passphrase || '',
    key,
    unread: 0,
    creator: payload.creator || payload.peer_id || '',
    creatorName: who,
    members: [
      { id: payload.creator || payload.peer_id || '', name: who, isCreator: true }
    ],
    createdAt: Date.now()
  });
  saveChannels();
  renderChannels();
  selectChannel(channelId);
  showToast(`Joined department room "${name}"`);
}

function showMembersModal() {
  const ch = state.channels.get(state.selectedPeer);
  if (!ch) return;
  const titleEl = $('members-room-name');
  if (titleEl) titleEl.textContent = ch.name;
  const members = getChannelMembers(ch);
  const myId = state.identity?.id;
  const myName = state.identity?.name;
  const isCreator = !ch.creator || ch.creator === myId || ch.creator === myName || ch.creatorName === myName;

  const list = $('members-room-list');
  if (list) {
    if (!members.length) {
      list.innerHTML = '<div class="channel-empty">Belum ada anggota.</div>';
    } else {
      list.innerHTML = members.map((m) => {
        const peerObj = (m.id && state.peers.get(m.id)) || [...state.peers.values()].find((p) => p.name === m.name);
        const isOnline = m.isMe || Boolean(peerObj?.connected);
        const avatarHtml = m.isMe
          ? (state.identity?.avatar && state.identity.avatar.startsWith('data:image/')
              ? `<img class="peer-avatar-img" src="${escapeHtml(state.identity.avatar)}" alt="" />`
              : escapeHtml(initials(state.identity?.name || 'You')))
          : peerAvatarInner(peerObj || { name: m.name });

        const roleBadge = m.isCreator
          ? '<span class="room-member-role creator" title="Pembuat Room">👑 Creator</span>'
          : '<span class="room-member-role member">👤 Anggota</span>';

        const statusBadge = isOnline
          ? '<span class="room-member-status online"><span class="dot green"></span> Online</span>'
          : '<span class="room-member-status offline"><span class="dot"></span> Offline</span>';

        return `
          <div class="room-member-item">
            <div class="room-member-info">
              <span class="peer-avatar">${avatarHtml}</span>
              <div>
                <div class="room-member-name">${escapeHtml(m.name)}${m.isMe ? ' <small style="color:var(--text-muted)">(Anda)</small>' : ''}</div>
                <div style="font-size:12px;color:var(--text-muted)">${statusBadge}</div>
              </div>
            </div>
            <div>${roleBadge}</div>
          </div>
        `;
      }).join('');
    }
  }

  const inviteBtn = $('members-invite-btn');
  if (inviteBtn) {
    inviteBtn.style.display = isCreator ? 'inline-flex' : 'none';
  }
  $('members-modal')?.classList.remove('hidden');
}

function selectPeer(peerId) {
  state.selectedPeer = peerId;
  clearAllSelections();
  const safeId = window.CSS?.escape ? CSS.escape(peerId) : peerId.replace(/"/g, '\\"');
  const targetPeerBtn = document.querySelector(`.peer-row[data-peer-id="${safeId}"]`);
  targetPeerBtn?.classList.add('selected');
  renderPeers();
  renderChannels();
  updateConversationHeader();
  renderMessages();
  callApp('ConnectPeer', peerId).catch((error) => showToast(error.message));
  const p = state.peers.get(peerId);
  if (!p?.avatar && !state.peerAvatars[peerId]) {
    callApp('RequestAvatar', peerId).catch(() => {});
  }
}

/* =========================================================================
   Messages & Chat Rendering
   ========================================================================= */

const REACTION_EMOJIS = ['👍', '❤️', '🚀', '😂', '👀', '🎉'];

function renderMessageActions(message) {
  const isPopOpen = state.activeReactionMessageId === message.id;
  const popover = isPopOpen
    ? `<div class="reaction-popover">${REACTION_EMOJIS.map((e) => `<button class="reaction-choice-btn" data-reaction-choice="${e}" data-msg-id="${message.id}">${e}</button>`).join('')}</div>`
    : '';

  return `
    <div class="message-actions">
      <button class="action-mini-btn" title="React" data-action="react" data-msg-id="${escapeHtml(message.id || '')}">😊</button>
      <button class="action-mini-btn" title="Reply" data-action="reply" data-msg-id="${escapeHtml(message.id || '')}">↩</button>
      <button class="action-mini-btn" title="Pin" data-action="pin" data-msg-id="${escapeHtml(message.id || '')}">📌</button>
      ${popover}
    </div>`;
}

function renderQuotedPreview(message) {
  if (!message.replyTo) return '';
  return `
    <div class="quoted-preview">
      <strong>${escapeHtml(message.replyTo.sender || 'Peer')}</strong>
      <span>${escapeHtml(message.replyTo.text || '')}</span>
    </div>`;
}

function renderReactionsHtml(message) {
  if (!message.reactions || Object.keys(message.reactions).length === 0) return '';
  const pills = Object.entries(message.reactions)
    .filter(([_, count]) => count > 0)
    .map(([emoji, count]) => {
      const isMine = message.myReactions?.includes(emoji);
      return `<button class="reaction-pill ${isMine ? 'reacted' : ''}" data-react-pill="${emoji}" data-msg-id="${escapeHtml(message.id || '')}">${emoji} ${count}</button>`;
    })
    .join('');
  return pills ? `<div class="reactions-container">${pills}</div>` : '';
}

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
    if (m.kind === 'call') return renderCallMessage(m);
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

  list.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const msgId = btn.dataset.msgId;
      if (action === 'react') {
        state.activeReactionMessageId = state.activeReactionMessageId === msgId ? null : msgId;
        renderMessages();
      } else if (action === 'reply') {
        startReply(msgId);
      } else if (action === 'pin') {
        const msg = messages.find((x) => x.id === msgId);
        if (msg) pinMessageText(msg.text || (msg.kind === 'image' ? '[Photo]' : msg.name || 'Pinned message'));
      }
    });
  });

  list.querySelectorAll('[data-reaction-choice]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const emoji = btn.dataset.reactionChoice;
      const msgId = btn.dataset.msgId;
      toggleReaction(msgId, emoji);
    });
  });

  list.querySelectorAll('[data-react-pill]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const emoji = btn.dataset.reactPill;
      const msgId = btn.dataset.msgId;
      toggleReaction(msgId, emoji);
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

  // Scroll handling
  scrollMessagesToBottom(true);

  // If any inline images are loading, scroll again on load
  list.querySelectorAll('img').forEach((img) => {
    if (!img.complete) {
      img.addEventListener('load', () => {
        scrollMessagesToBottom(false);
      }, { once: true });
    }
  });
}

function scrollMessagesToBottom(force = true) {
  const list = $('message-list');
  if (!list) return;
  const isNearBottom = (list.scrollHeight - list.scrollTop - list.clientHeight) < 220;
  if (force || isNearBottom) {
    requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
      updateScrollBottomButton();
    });
  }
}

function updateScrollBottomButton() {
  const list = $('message-list');
  const btn = $('scroll-bottom-btn');
  if (!list || !btn) return;
  const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
  if (distance > 180) {
    btn.classList.remove('hidden');
  } else {
    btn.classList.add('hidden');
  }
}

function renderTextMessage(message) {
  const senderTag = message.senderName && !message.mine ? `<span class="message-sender">${escapeHtml(message.senderName)}</span>` : '';
  const statusCheck = message.mine ? (message.status === 'delivered' ? '<span class="delivery-status delivered">✓✓</span>' : (message.status === 'queued' ? '<span class="delivery-status queued" title="Queued in Outbox: Waiting for peer to come online">⏳</span>' : '<span class="delivery-status">✓</span>')) : '';
  const actionsHtml = renderMessageActions(message);
  const reactionsHtml = renderReactionsHtml(message);
  const quotedHtml = renderQuotedPreview(message);
  return `
    <div class="message ${message.mine ? 'mine' : ''}" data-msg-id="${escapeHtml(message.id || '')}">
      ${actionsHtml}
      ${senderTag}
      <div class="message-bubble">
        ${quotedHtml}
        ${renderFormattedText(message.text)}
      </div>
      ${reactionsHtml}
      <small class="message-time">${message.time}${statusCheck}</small>
    </div>`;
}

function renderImageMessage(message) {
  const senderTag = message.senderName && !message.mine ? `<span class="message-sender">${escapeHtml(message.senderName)}</span>` : '';
  const captionHtml = message.caption ? `<div style="margin-top:4px;font-size:13px">${renderFormattedText(message.caption)}</div>` : '';
  const statusCheck = message.mine ? (message.status === 'delivered' ? '<span class="delivery-status delivered">✓✓</span>' : (message.status === 'queued' ? '<span class="delivery-status queued" title="Queued in Outbox: Waiting for peer to come online">⏳</span>' : '<span class="delivery-status">✓</span>')) : '';
  const actionsHtml = renderMessageActions(message);
  const reactionsHtml = renderReactionsHtml(message);
  const quotedHtml = renderQuotedPreview(message);
  return `
    <div class="message ${message.mine ? 'mine' : ''}" data-msg-id="${escapeHtml(message.id || '')}">
      ${actionsHtml}
      ${senderTag}
      <div class="message-bubble" style="padding:6px 8px">
        ${quotedHtml}
        <div class="message-image-card">
          <img src="${message.url}" alt="${escapeHtml(message.name || 'Image')}" data-image-preview="true" />
        </div>
        ${captionHtml}
      </div>
      ${reactionsHtml}
      <small class="message-time">${message.time}${statusCheck}</small>
    </div>`;
}

function renderAudioMessage(message) {
  const audioId = `audio-${message.time.replace(/[^0-9]/g, '')}-${Math.random().toString(16).slice(2, 6)}`;
  const senderTag = message.senderName && !message.mine ? `<span class="message-sender">${escapeHtml(message.senderName)}</span>` : '';
  const statusCheck = message.mine ? (message.status === 'delivered' ? '<span class="delivery-status delivered">✓✓</span>' : (message.status === 'queued' ? '<span class="delivery-status queued" title="Queued in Outbox: Waiting for peer to come online">⏳</span>' : '<span class="delivery-status">✓</span>')) : '';
  const actionsHtml = renderMessageActions(message);
  const reactionsHtml = renderReactionsHtml(message);
  const quotedHtml = renderQuotedPreview(message);
  return `
    <div class="message ${message.mine ? 'mine' : ''}" data-msg-id="${escapeHtml(message.id || '')}">
      ${actionsHtml}
      ${senderTag}
      <div class="message-bubble" style="padding:6px 10px">
        ${quotedHtml}
        <div class="voice-note-bubble">
          <button class="voice-play-btn" data-voice-btn="${audioId}">▶</button>
          <div class="voice-track">
            <div class="voice-progress" data-voice-prog="${audioId}"></div>
          </div>
          <span class="voice-duration" data-voice-dur="${audioId}">Voice memo</span>
          <audio src="${message.url}" data-voice-audio="${audioId}" preload="metadata"></audio>
        </div>
      </div>
      ${reactionsHtml}
      <small class="message-time">${message.time}${statusCheck}</small>
    </div>`;
}

function renderFileMessage(message) {
  const progress = Number.isFinite(message.progress) ? `${message.progress}%` : '';
  const speedText = message.speed ? ` · ${message.speed}` : '';
  const target = message.savedPath
    ? `<span><strong>Saved</strong><br><small>${escapeHtml(message.savedPath)}</small></span>`
    : message.url
      ? `<a href="${message.url}" download="${escapeHtml(message.name)}">${escapeHtml(message.name)}<br><small>${formatBytes(message.size)}</small></a>`
      : `<span>${escapeHtml(message.name || 'File transfer')}<br><small>${message.cancelled ? 'cancelled' : `sending ${progress}${speedText}`}</small></span>${message.transferId && message.sending ? `<button class="cancel-transfer" data-cancel-transfer="${escapeHtml(message.transferId)}">Cancel</button>` : ''}`;
  const senderTag = message.senderName && !message.mine ? `<span class="message-sender">${escapeHtml(message.senderName)}</span>` : '';
  const actionsHtml = renderMessageActions(message);
  const reactionsHtml = renderReactionsHtml(message);
  const quotedHtml = renderQuotedPreview(message);
  return `
    <div class="message ${message.mine ? 'mine' : ''}" data-msg-id="${escapeHtml(message.id || '')}">
      ${actionsHtml}
      ${senderTag}
      <div class="message-bubble file-message">
        ${quotedHtml}
        <div class="file-icon-box">▧</div>
        ${target}
      </div>
      ${reactionsHtml}
      <small class="message-time">${message.time}</small>
    </div>`;
}

function renderCallMessage(message) {
  const icon = message.isVideo ? '📹' : '📞';
  const isMissed = message.callStatus === 'missed' || message.callStatus === 'declined';
  let desc = '';
  if (message.callStatus === 'outgoing') {
    desc = `Panggilan ${message.isVideo ? 'video' : 'suara'} keluar`;
  } else if (message.callStatus === 'incoming') {
    desc = `Panggilan ${message.isVideo ? 'video' : 'suara'} masuk`;
  } else if (message.callStatus === 'missed') {
    desc = `Panggilan ${message.isVideo ? 'video' : 'suara'} tak terjawab`;
  } else if (message.callStatus === 'declined') {
    desc = `Panggilan ${message.isVideo ? 'video' : 'suara'} ditolak`;
  } else if (message.callStatus === 'ended') {
    const dur = message.duration ? ` (${message.duration})` : '';
    desc = `Panggilan ${message.isVideo ? 'video' : 'suara'} selesai${dur}`;
  } else {
    desc = message.text || `Panggilan ${message.isVideo ? 'video' : 'suara'}`;
  }

  return `
    <div class="message call-message ${message.mine ? 'mine' : ''}" data-msg-id="${escapeHtml(message.id || '')}">
      <div class="message-bubble call-bubble ${isMissed ? 'call-missed' : ''}">
        <span class="call-icon ${isMissed ? 'call-icon-missed' : ''}">${icon}</span>
        <div class="call-details">
          <div class="call-text">${escapeHtml(desc)}</div>
          <small class="call-subtext">${message.time}</small>
        </div>
      </div>
    </div>`;
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
  const replyTo = state.replyingTo;
  cancelReply();

  if (state.selectedPeer === LAN_GROUP_ID) {
    try {
      const outgoingText = replyTo ? `[Replying to ${replyTo.sender}: "${replyTo.text.slice(0, 50)}"]\n${text}` : text;
      await callApp('BroadcastMessage', outgoingText);
      addMessage(LAN_GROUP_ID, {
        id: msgId,
        kind: 'text',
        text,
        replyTo,
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

  // Channel messaging
  if (state.selectedPeer.startsWith('__channel_')) {
    const ch = state.channels.get(state.selectedPeer);
    if (!ch) return;
    try {
      const outgoingText = replyTo ? `[Replying to ${replyTo.sender}: "${replyTo.text.slice(0, 50)}"]\n${text}` : text;
      let payloadToSend = outgoingText;
      let isEncrypted = false;
      if (ch.key) {
        payloadToSend = await encryptChannelMessage(outgoingText, ch.key);
        isEncrypted = true;
      }
      await callApp('BroadcastChannelMessage', ch.name, payloadToSend);
      addMessage(state.selectedPeer, {
        id: msgId,
        kind: 'text',
        text,
        replyTo,
        mine: true,
        encrypted: isEncrypted,
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

  // Direct Peer messaging
  const peer = state.peers.get(state.selectedPeer);
  if (!peer?.connected) {
    // Peer is offline -> Queue into Local Outbox
    const queuedItem = { id: msgId, kind: 'text', text, replyTo, mine: true, status: 'queued', time: formatTime() };
    addMessage(state.selectedPeer, queuedItem);
    if (!state.outbox.has(state.selectedPeer)) {
      state.outbox.set(state.selectedPeer, []);
    }
    state.outbox.get(state.selectedPeer).push(queuedItem);
    saveOutbox();
    playSentTick();
    input.value = '';
    showToast('Peer offline: Message queued in Outbox ⏳');
    return;
  }

  try {
    const outgoingText = replyTo ? `[Replying to ${replyTo.sender}: "${replyTo.text.slice(0, 50)}"]\n${text}` : text;
    await callApp('SendMessage', state.selectedPeer, outgoingText);
    addMessage(state.selectedPeer, { id: msgId, kind: 'text', text, replyTo, mine: true, status: 'sent', time: formatTime() });
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

function parseReplyFromText(rawText) {
  if (!rawText) return { replyTo: null, text: '' };
  const match = rawText.match(/^\[Replying to ([^:]+): "([^"]*)"\]\n([\s\S]*)$/);
  if (match) {
    return {
      replyTo: { sender: match[1], text: match[2] },
      text: match[3]
    };
  }
  return { replyTo: null, text: rawText };
}

function receiveMessage(payload) {
  const { replyTo, text } = parseReplyFromText(payload.text);
  addMessage(payload.peer_id, { id: payload.id, kind: 'text', text, replyTo, mine: false, time: formatTime() });
  playChime();
  showToast(`New message from ${state.peers.get(payload.peer_id)?.name || 'peer'}`);
}

function receiveGroupMessage(payload) {
  const { replyTo, text } = parseReplyFromText(payload.text);
  addMessage(LAN_GROUP_ID, {
    id: payload.id,
    kind: 'text',
    text,
    replyTo,
    mine: false,
    senderName: payload.name,
    time: formatTime()
  });
  playChime();
  if (state.selectedPeer !== LAN_GROUP_ID) {
    state.groupUnread += 1;
    $('lan-room-badge').textContent = state.groupUnread;
    $('lan-room-badge').classList.remove('hidden');
    showToast(`LAN Room: ${payload.name}: ${text}`);
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

  if (state.dlpEnabled !== false && isDangerousFileName(payload.name)) {
    $('dlp-modal-text').innerHTML = `Peer <strong>${escapeHtml(peer?.name || 'Unknown')}</strong> is sending an executable/script file:<br><br><span style="font-size:15px;color:#f87171;font-weight:bold;font-family:monospace">${escapeHtml(payload.name)}</span><br><small style="color:#94a3b8">${formatBytes(payload.size)}</small>`;
    $('dlp-modal').classList.remove('hidden');
    return;
  }

  $('file-offer-text').textContent = `${peer?.name || 'A peer'} wants to send ${payload.name} (${formatBytes(payload.size)}).`;
  $('file-offer-modal').classList.remove('hidden');
}

function handleDlpReject() {
  $('dlp-modal').classList.add('hidden');
  resolveFileOffer(false);
  showToast('Blocked potentially dangerous file (Enterprise DLP Policy)');
}

function handleDlpProceed() {
  $('dlp-modal').classList.add('hidden');
  resolveFileOffer(true);
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
  if (!found.message.startTime) found.message.startTime = Date.now();
  found.message.progress = payload.total ? Math.min(100, Math.round((payload.sent / payload.total) * 100)) : 0;
  found.message.sending = true;
  const elapsedSec = Math.max(0.2, (Date.now() - found.message.startTime) / 1000);
  const bytesPerSec = payload.sent / elapsedSec;
  found.message.speed = `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
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

  const autoStartCheck = $('auto-start-boot');
  if (autoStartCheck) {
    try {
      const autoStart = await callApp('GetAutoStart');
      autoStartCheck.checked = Boolean(autoStart);
    } catch (_) {}

    autoStartCheck.onchange = async () => {
      try {
        await callApp('SetAutoStart', autoStartCheck.checked);
        showToast(autoStartCheck.checked ? 'Auto-start aktif saat Windows boot' : 'Auto-start dinonaktifkan');
      } catch (err) {
        showToast('Gagal mengubah pengaturan auto-start: ' + err.message);
      }
    };
  }

  applyAvatar($('local-avatar'), state.settings.avatarData);
  applyAvatar($('settings-avatar-preview'), state.settings.avatarData);

  const privacyShield = window.localStorage.getItem('inchat.privacy_shield') === 'true';
  state.privacyShield = privacyShield;
  $('privacy-shield').checked = privacyShield;

  const dlpEnabled = window.localStorage.getItem('inchat.dlp_guard') !== 'false';
  state.dlpEnabled = dlpEnabled;
  const dlpCheckbox = $('dlp-guard');
  if (dlpCheckbox) dlpCheckbox.checked = dlpEnabled;

  const appPin = window.localStorage.getItem('inchat.app_pin') || '';
  state.appPin = appPin;
  $('settings-pin').value = appPin;

  const vlanInput = $('settings-vlan-subnets');
  if (vlanInput) {
    vlanInput.value = (state.settings.knownSubnets || []).join(', ');
  }
  renderResponsiveVLANs(state.settings.knownSubnets || []);
}

function renderResponsiveVLANs(subnets = []) {
  const container = $('vlan-responsive-list');
  if (!container) return;
  if (!subnets || subnets.length === 0) {
    container.innerHTML = '<span class="vlan-tag empty">Belum ada VLAN. Klik "Scan Ulang All VLANs" untuk memindai.</span>';
    return;
  }
  container.innerHTML = subnets.map((s) => `<span class="vlan-tag active" title="Responsive VLAN Subnet">🟢 ${escapeHtml(s)}</span>`).join('');
}

async function rescanAllVLANs() {
  const btn = $('btn-rescan-vlans');
  const indicator = $('vlan-scan-indicator');
  const statusText = $('vlan-scan-status-text');
  if (btn) btn.disabled = true;
  if (indicator) indicator.classList.remove('hidden');
  if (statusText) statusText.textContent = 'Memindai candidate VLANs & subnets jaringan…';

  try {
    const rawInput = $('settings-vlan-subnets')?.value || '';
    const userSubnets = rawInput.split(',').map((s) => s.trim()).filter(Boolean);
    const result = await callApp('ScanAllVLANs', userSubnets);

    state.settings = await callApp('GetSettings');
    applySettingsToUI();

    const count = result?.foundPeers?.length || 0;
    const vlanCount = result?.responsiveSubnets?.length || 0;
    showToast(`Scan VLAN Selesai: ${count} peer ditemukan di ${vlanCount} VLAN aktif!`, 5000);
  } catch (err) {
    showToast(`Scan VLAN gagal: ${err.message || err}`, 5000);
  } finally {
    if (btn) btn.disabled = false;
    if (indicator) indicator.classList.add('hidden');
  }
}

function showAboutModal() {
  $('about-brand-icon').src = appIcon;
  $('about-modal').classList.remove('hidden');
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

    const vlanInput = $('settings-vlan-subnets');
    if (vlanInput) {
      const subnets = vlanInput.value.split(',').map((s) => s.trim()).filter(Boolean);
      try { await callApp('SetKnownSubnets', subnets); } catch (_) {}
    }

    state.privacyShield = $('privacy-shield').checked;
    window.localStorage.setItem('inchat.privacy_shield', state.privacyShield ? 'true' : 'false');

    const dlpCheckbox = $('dlp-guard');
    if (dlpCheckbox) {
      state.dlpEnabled = dlpCheckbox.checked;
      window.localStorage.setItem('inchat.dlp_guard', state.dlpEnabled ? 'true' : 'false');
    }

    state.appPin = $('settings-pin').value.trim();
    window.localStorage.setItem('inchat.app_pin', state.appPin);

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

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ],
  iceCandidatePoolSize: 0
};

const pendingIceCandidatesByPeer = new Map();
let incomingCallInfo = null;
let incomingCallTimeout = null;
let callTimerInterval = null;

async function acquireMediaStream(withVideo) {
  let stream = null;
  let hasVideo = false;

  if (withVideo) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: { width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 } }
      });
      hasVideo = true;
    } catch (e1) {
      console.warn('High-res video stream failed, trying basic video...', e1);
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        hasVideo = true;
      } catch (e2) {
        console.warn('Webcam not available or permission denied, falling back to audio only...', e2);
        showToast('Kamera tidak terdeteksi atau izin ditolak. Beralih ke panggilan audio.');
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } catch (e3) {
          throw new Error('Mikrofon tidak dapat diakses: ' + e3.message);
        }
      }
    }
  } else {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false
      });
    } catch (e) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (e2) {
        throw new Error('Mikrofon tidak dapat diakses: ' + e2.message);
      }
    }
  }

  return { stream, hasVideo };
}

function sanitizeCandidateForPeer(peerId, candidateObj) {
  if (!candidateObj || !candidateObj.candidate) return candidateObj;
  const peer = state.peers.get(peerId);
  const knownIp = peer?.address || (peer?.addresses && peer.addresses[0]);
  if (knownIp && typeof candidateObj.candidate === 'string' && candidateObj.candidate.includes('.local')) {
    const parts = candidateObj.candidate.split(' ');
    if (parts.length >= 5 && parts[4].endsWith('.local')) {
      parts[4] = knownIp;
      return {
        ...candidateObj,
        candidate: parts.join(' ')
      };
    }
  }
  return candidateObj;
}

async function addOrQueueIceCandidate(peerId, candidate) {
  if (!candidate) return;
  const targetPeer = peerId || state.activeCallPeer;
  if (!targetPeer) return;

  const sanitized = sanitizeCandidateForPeer(targetPeer, candidate);

  if (state.pc && state.pc.remoteDescription && state.activeCallPeer === targetPeer) {
    try {
      await state.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('Failed to add candidate, trying sanitized LAN candidate:', err);
      if (sanitized && sanitized.candidate !== candidate.candidate) {
        try {
          await state.pc.addIceCandidate(new RTCIceCandidate(sanitized));
        } catch (_) {}
      }
    }
    return;
  }

  if (!pendingIceCandidatesByPeer.has(targetPeer)) {
    pendingIceCandidatesByPeer.set(targetPeer, []);
  }
  pendingIceCandidatesByPeer.get(targetPeer).push(candidate);
  if (sanitized && sanitized.candidate !== candidate.candidate) {
    pendingIceCandidatesByPeer.get(targetPeer).push(sanitized);
  }
}

async function flushPendingIceCandidates(peerId) {
  const targetPeer = peerId || state.activeCallPeer;
  if (!state.pc || !state.pc.remoteDescription || !targetPeer) return;
  const list = pendingIceCandidatesByPeer.get(targetPeer) || [];
  pendingIceCandidatesByPeer.delete(targetPeer);
  for (const c of list) {
    try {
      await state.pc.addIceCandidate(new RTCIceCandidate(c));
    } catch (err) {
      console.warn('Failed to flush candidate:', err);
    }
  }
}

function appendCallMessage(peerId, { callStatus, isVideo, duration, mine = false, text }) {
  const msg = {
    id: 'call-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    kind: 'call',
    callStatus,
    isVideo: Boolean(isVideo),
    duration: duration || null,
    mine,
    text: text || '',
    time: formatTime()
  };
  addMessage(peerId, msg);
}

function startCallTimer() {
  stopCallTimer();
  updateCallTimerDisplay();
  callTimerInterval = setInterval(updateCallTimerDisplay, 1000);
}

function stopCallTimer() {
  if (callTimerInterval) {
    clearInterval(callTimerInterval);
    callTimerInterval = null;
  }
}

function updateCallTimerDisplay() {
  if (!state.callConnectedAt) return;
  const sec = Math.floor((Date.now() - state.callConnectedAt) / 1000);
  const mins = Math.floor(sec / 60);
  const remSec = sec % 60;
  const timeStr = `${mins.toString().padStart(2, '0')}:${remSec.toString().padStart(2, '0')}`;
  const el = $('call-status');
  if (el) el.textContent = timeStr;
}

function showIncomingCallModal(peer, offer, withVideo) {
  incomingCallInfo = { peerId: peer.id, offer, withVideo, peer };

  const avatarEl = $('incoming-call-avatar');
  if (peer.avatar) {
    avatarEl.innerHTML = `<img src="${peer.avatar}" alt="${escapeHtml(peer.name)}" class="peer-avatar-img">`;
  } else {
    avatarEl.textContent = initials(peer.name || 'P');
  }

  $('incoming-call-caller').textContent = peer.name || 'Rekan LAN';
  $('incoming-call-type').textContent = withVideo ? '📹 Panggilan Video Masuk…' : '📞 Panggilan Suara Masuk…';
  $('incoming-call-modal').classList.remove('hidden');

  startRingTone();

  if (incomingCallTimeout) clearTimeout(incomingCallTimeout);
  incomingCallTimeout = setTimeout(() => {
    if (incomingCallInfo) {
      stopRingTone();
      $('incoming-call-modal').classList.add('hidden');
      const missedPeerId = incomingCallInfo.peerId;
      const missedVideo = incomingCallInfo.withVideo;
      incomingCallInfo = null;
      callApp('SendSignal', missedPeerId, 'hangup', JSON.stringify({ reason: 'timeout' })).catch(() => {});
      appendCallMessage(missedPeerId, {
        callStatus: 'missed',
        isVideo: missedVideo,
        mine: false
      });
    }
  }, 45000);
}

async function acceptIncomingCall() {
  if (!incomingCallInfo) return;
  stopRingTone();
  if (incomingCallTimeout) {
    clearTimeout(incomingCallTimeout);
    incomingCallTimeout = null;
  }
  $('incoming-call-modal').classList.add('hidden');
  const info = incomingCallInfo;
  incomingCallInfo = null;

  try {
    const { stream, hasVideo } = await acquireMediaStream(info.withVideo);
    await ensureCall(info.peerId, hasVideo, stream);
    await state.pc.setRemoteDescription(new RTCSessionDescription(info.offer));
    await flushPendingIceCandidates(info.peerId);
    const answer = await state.pc.createAnswer();
    await state.pc.setLocalDescription(answer);
    await callApp('SendSignal', info.peerId, 'answer', JSON.stringify(answer));
    openCallPanel(info.peer, hasVideo);
  } catch (error) {
    await endCall();
    showToast(`Panggilan gagal tersambung: ${error.message}`);
  }
}

async function declineIncomingCall() {
  if (!incomingCallInfo) return;
  stopRingTone();
  if (incomingCallTimeout) {
    clearTimeout(incomingCallTimeout);
    incomingCallTimeout = null;
  }
  $('incoming-call-modal').classList.add('hidden');
  const info = incomingCallInfo;
  incomingCallInfo = null;

  callApp('SendSignal', info.peerId, 'hangup', JSON.stringify({ reason: 'declined' })).catch(() => {});
  appendCallMessage(info.peerId, {
    callStatus: 'declined',
    isVideo: info.withVideo,
    mine: true
  });
}

async function startGroupCall() {
  if (state.pc || state.group) return showToast('Panggilan lain sedang berlangsung');
  const connectedPeers = [...state.peers.values()].filter((peer) => peer.connected);
  if (connectedPeers.length < 1) return showToast('Diperlukan setidaknya satu rekan yang terhubung untuk panggilan grup');

  const participants = [state.identity?.id, ...connectedPeers.map((peer) => peer.id)].slice(0, 5);
  const names = participants
    .filter((id) => id !== state.identity?.id)
    .map((id) => state.peers.get(id)?.name || 'Unknown device')
    .join(', ');
  if (!window.confirm(`Mulai panggilan grup dengan ${names}?`)) return;

  try {
    const { stream } = await acquireMediaStream(true);
    state.localStream = stream;
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
    showToast(`Panggilan grup gagal: ${error.message}`);
  }
}

async function createGroupPeerConnection(peerId) {
  const group = state.group;
  if (!group || group.pcs.has(peerId)) return group?.pcs.get(peerId);
  const pc = new RTCPeerConnection(RTC_CONFIG);
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
  document.querySelector('.workspace')?.classList.add('has-call-panel');
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
  if (!participants.includes(payload.peer_id) || !participants.includes(state.identity.id)) return showToast('Undangan panggilan grup tidak valid');

  startRingTone();
  const accept = window.confirm(`Terima panggilan grup dari ${state.peers.get(payload.peer_id)?.name || 'rekan'}?`);
  stopRingTone();
  if (!accept) return;

  try {
    const { stream } = await acquireMediaStream(true);
    state.localStream = stream;
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
    showToast(`Tidak dapat bergabung ke panggilan grup: ${error.message}`);
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
  if (!state.selectedPeer || state.selectedPeer === LAN_GROUP_ID) return showToast('Pilih rekan chat terlebih dahulu');
  const peer = state.peers.get(state.selectedPeer);
  if (!peer?.connected) return showToast('Rekan belum terhubung atau sedang offline');
  try {
    const { stream, hasVideo } = await acquireMediaStream(withVideo);
    await ensureCall(peer.id, hasVideo, stream);
    const offer = await state.pc.createOffer();
    await state.pc.setLocalDescription(offer);
    await callApp('SendSignal', peer.id, 'offer', JSON.stringify(offer));
    openCallPanel(peer, hasVideo);
    appendCallMessage(peer.id, {
      callStatus: 'outgoing',
      isVideo: hasVideo,
      mine: true
    });
  } catch (error) {
    await endCall();
    showToast(`Panggilan gagal: ${error.message}`);
  }
}

async function ensureCall(peerId, withVideo, stream) {
  await endCall(false);
  state.activeCallPeer = peerId;
  state.startedAt = Date.now();
  state.callWithVideo = withVideo;
  state.callConnectedAt = null;

  const pc = new RTCPeerConnection(RTC_CONFIG);
  state.pc = pc;

  pc.onicecandidate = async (event) => {
    if (state.pc !== pc) return;
    if (event.candidate) {
      await callApp('SendSignal', peerId, 'candidate', JSON.stringify(event.candidate.toJSON())).catch(() => {});
    }
  };

  pc.ontrack = (event) => {
    if (state.pc !== pc) return;
    const remoteEl = $('remote-video');
    if (remoteEl) {
      remoteEl.srcObject = event.streams[0];
      remoteEl.play().catch((e) => console.warn('remote-video play error:', e));
    }
    if (state.callWithVideo) {
      $('call-placeholder').classList.add('hidden');
    } else {
      $('call-placeholder').classList.remove('hidden');
      $('call-placeholder').textContent = `📞 Terhubung · ${state.peers.get(peerId)?.name || 'Panggilan Suara'}`;
    }
  };

  pc.onconnectionstatechange = () => {
    if (state.pc !== pc) return;
    const s = pc.connectionState;
    if (s === 'connected') {
      state.callConnectedAt = Date.now();
      startCallTimer();
      showToast(`Panggilan tersambung (${state.callWithVideo ? 'Video' : 'Suara'})`);
    } else if (s === 'disconnected' || s === 'failed' || s === 'closed') {
      stopCallTimer();
      $('call-status').textContent = s;
      if (s === 'failed') {
        showToast('Koneksi panggilan terputus/gagal');
        endCall();
      }
    } else {
      $('call-status').textContent = s + '…';
    }
  };

  state.localStream = stream;
  state.localStream.getTracks().forEach((track) => {
    const sender = pc.addTrack(track, state.localStream);
    if (track.kind === 'video') state.videoSender = sender;
    if (track.kind === 'audio') state.audioSender = sender;
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
    const offer = JSON.parse(payload.data);
    const withVideo = Boolean(offer.sdp?.includes('m=video'));
    appendCallMessage(payload.peer_id, {
      callStatus: 'incoming',
      isVideo: withVideo,
      mine: false
    });
    showIncomingCallModal(peer, offer, withVideo);
  } else if (payload.kind === 'answer' && state.pc) {
    const answer = JSON.parse(payload.data);
    await state.pc.setRemoteDescription(new RTCSessionDescription(answer));
    await flushPendingIceCandidates(payload.peer_id);
  } else if (payload.kind === 'candidate') {
    const candidate = JSON.parse(payload.data);
    await addOrQueueIceCandidate(payload.peer_id, candidate);
  } else if (payload.kind === 'hangup') {
    stopRingTone();
    if (incomingCallTimeout) {
      clearTimeout(incomingCallTimeout);
      incomingCallTimeout = null;
    }
    if (incomingCallInfo && incomingCallInfo.peerId === payload.peer_id) {
      $('incoming-call-modal').classList.add('hidden');
      const missedVideo = incomingCallInfo.withVideo;
      incomingCallInfo = null;
      appendCallMessage(payload.peer_id, {
        callStatus: 'missed',
        isVideo: missedVideo,
        mine: false
      });
    }
    await endCall();
    showToast(`${peer.name || 'Rekan'} mengakhiri panggilan`);
  }
}

function openCallPanel(peer, withVideo) {
  document.querySelector('.workspace')?.classList.add('has-call-panel');
  document.querySelector('.video-stage').classList.remove('group-mode');
  $('call-panel').classList.remove('hidden');
  $('call-title').textContent = peer.name || 'Rekan';
  $('call-status').textContent = 'menghubungkan…';
  $('camera-button').classList.toggle('hidden', !withVideo);
  $('screen-button').classList.remove('hidden');
  $('screen-button').disabled = !withVideo;
  $('screen-button').title = withVideo ? 'Bagikan layar' : 'Berbagi layar memerlukan panggilan video';
  if (!withVideo) {
    $('call-placeholder').classList.remove('hidden');
    $('call-placeholder').textContent = `📞 Panggilan Suara · ${peer.name || 'Rekan'}`;
  } else {
    $('call-placeholder').classList.remove('hidden');
    $('call-placeholder').textContent = `📹 Menghubungkan Kamera · ${peer.name || 'Rekan'}`;
  }
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
    showToast(`Berbagi layar gagal: ${error.message}`);
  }
}

async function endCall(closePanel = true) {
  stopRingTone();
  stopCallTimer();
  if (incomingCallTimeout) {
    clearTimeout(incomingCallTimeout);
    incomingCallTimeout = null;
  }
  $('incoming-call-modal')?.classList.add('hidden');
  incomingCallInfo = null;

  const currentPeerId = state.activeCallPeer;
  const connectedAt = state.callConnectedAt;
  const isVideo = state.callWithVideo;

  if (currentPeerId && connectedAt) {
    const sec = Math.floor((Date.now() - connectedAt) / 1000);
    const mins = Math.floor(sec / 60);
    const remSec = sec % 60;
    const durStr = `${mins.toString().padStart(2, '0')}:${remSec.toString().padStart(2, '0')}`;
    appendCallMessage(currentPeerId, {
      callStatus: 'ended',
      duration: durStr,
      isVideo,
      mine: true
    });
  }

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
  state.callConnectedAt = null;
  state.callWithVideo = false;
  if (currentPeerId) {
    pendingIceCandidatesByPeer.delete(currentPeerId);
  }
  state.localStream?.getTracks().forEach((track) => track.stop());
  state.localStream = null;
  state.cameraTrack = null;
  state.screenTrack = null;
  state.videoSender = null;
  state.audioSender = null;
  $('remote-video').srcObject = null;
  $('local-video').srcObject = null;
  document.querySelector('.video-stage').classList.remove('group-mode');
  $('call-placeholder').textContent = 'Panggilan Suara';
  document.querySelector('.workspace')?.classList.remove('has-call-panel');
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


/* =========================================================================
   In-Chat Search (Ctrl + F)
   ========================================================================= */

function toggleSearchBar() {
  const bar = $('search-bar');
  if (bar.classList.contains('hidden')) {
    bar.classList.remove('hidden');
    $('search-input').focus();
    handleSearchInput();
  } else {
    closeSearchBar();
  }
}

function closeSearchBar() {
  $('search-bar').classList.add('hidden');
  $('search-input').value = '';
  state.searchQuery = '';
  state.searchMatches = [];
  state.currentSearchIndex = -1;
  $('search-count').textContent = '0/0';
  renderMessages();
}

function handleSearchInput() {
  const q = $('search-input').value.trim();
  state.searchQuery = q.toLowerCase();
  renderMessages();
  if (!q || q.length < 2) {
    state.searchMatches = [];
    state.currentSearchIndex = -1;
    $('search-count').textContent = '0/0';
    return;
  }
  const marks = Array.from(document.querySelectorAll('.search-highlight'));
  state.searchMatches = marks;
  if (marks.length > 0) {
    state.currentSearchIndex = 0;
    updateSearchHighlight();
  } else {
    state.currentSearchIndex = -1;
    $('search-count').textContent = '0/0';
  }
}

function updateSearchHighlight() {
  const count = state.searchMatches.length;
  if (count === 0) {
    $('search-count').textContent = '0/0';
    return;
  }
  state.searchMatches.forEach((m, idx) => {
    m.classList.toggle('active', idx === state.currentSearchIndex);
  });
  $('search-count').textContent = `${state.currentSearchIndex + 1}/${count}`;
  state.searchMatches[state.currentSearchIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function nextSearchResult() {
  if (!state.searchMatches.length) return;
  state.currentSearchIndex = (state.currentSearchIndex + 1) % state.searchMatches.length;
  updateSearchHighlight();
}

function prevSearchResult() {
  if (!state.searchMatches.length) return;
  state.currentSearchIndex = (state.currentSearchIndex - 1 + state.searchMatches.length) % state.searchMatches.length;
  updateSearchHighlight();
}

/* =========================================================================
   Pinned Messages
   ========================================================================= */

function pinMessageText(text) {
  if (!state.selectedPeer || !text) return;
  state.pinnedMessages.set(state.selectedPeer, text);
  updatePinnedBanner();
  if (state.selectedPeer !== LAN_GROUP_ID) {
    callApp('SendPin', state.selectedPeer, text).catch(() => {});
  }
  showToast('Message pinned to top');
}

function unpinCurrentMessage() {
  if (!state.selectedPeer) return;
  state.pinnedMessages.delete(state.selectedPeer);
  updatePinnedBanner();
  if (state.selectedPeer !== LAN_GROUP_ID) {
    callApp('SendPin', state.selectedPeer, '').catch(() => {});
  }
  showToast('Message unpinned');
}

function updatePinnedBanner() {
  const banner = $('pinned-banner');
  const text = state.pinnedMessages.get(state.selectedPeer);
  if (text) {
    $('pinned-text').textContent = text;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

function jumpToPinnedMessage() {
  const text = state.pinnedMessages.get(state.selectedPeer);
  if (!text) return;
  const list = $('message-list');
  const bubbles = list.querySelectorAll('.message-bubble');
  for (const bubble of bubbles) {
    if (bubble.textContent.includes(text)) {
      bubble.scrollIntoView({ behavior: 'smooth', block: 'center' });
      bubble.style.transition = 'outline 0.2s ease';
      bubble.style.outline = '2px solid #3b82f6';
      setTimeout(() => { bubble.style.outline = 'none'; }, 1500);
      break;
    }
  }
}

function handleIncomingPin(payload) {
  if (payload.text) {
    state.pinnedMessages.set(payload.peer_id, payload.text);
  } else {
    state.pinnedMessages.delete(payload.peer_id);
  }
  if (state.selectedPeer === payload.peer_id) {
    updatePinnedBanner();
  }
}

/* =========================================================================
   Emoji Reactions
   ========================================================================= */

function toggleReaction(msgId, emoji) {
  if (!state.selectedPeer) return;
  const messages = state.messages.get(state.selectedPeer) || [];
  const msg = messages.find((m) => m.id === msgId);
  if (!msg) return;

  if (!msg.reactions) msg.reactions = {};
  if (!msg.myReactions) msg.myReactions = [];

  const already = msg.myReactions.includes(emoji);
  if (already) {
    msg.myReactions = msg.myReactions.filter((e) => e !== emoji);
    msg.reactions[emoji] = Math.max(0, (msg.reactions[emoji] || 1) - 1);
    if (msg.reactions[emoji] === 0) delete msg.reactions[emoji];
  } else {
    msg.myReactions.push(emoji);
    msg.reactions[emoji] = (msg.reactions[emoji] || 0) + 1;
  }

  state.activeReactionMessageId = null;
  saveMessageHistory();
  renderMessages();

  if (state.selectedPeer !== LAN_GROUP_ID) {
    callApp('SendReaction', state.selectedPeer, msgId, emoji).catch(() => {});
  }
}

function handleIncomingReaction(payload) {
  const messages = state.messages.get(payload.peer_id);
  if (!messages) return;
  const msg = messages.find((m) => m.id === payload.message_id);
  if (!msg) return;

  if (!msg.reactions) msg.reactions = {};
  msg.reactions[payload.emoji] = (msg.reactions[payload.emoji] || 0) + 1;
  saveMessageHistory();
  if (state.selectedPeer === payload.peer_id) renderMessages();
}

/* =========================================================================
   Replying & Quoting
   ========================================================================= */

function startReply(msgId) {
  if (!state.selectedPeer) return;
  const messages = state.messages.get(state.selectedPeer) || [];
  const msg = messages.find((m) => m.id === msgId);
  if (!msg) return;

  const sender = msg.mine ? 'You' : (msg.senderName || state.peers.get(state.selectedPeer)?.name || 'Peer');
  const text = msg.text || (msg.kind === 'image' ? '[Photo]' : msg.kind === 'audio' ? '[Voice memo]' : `[File: ${msg.name}]`);

  state.replyingTo = { id: msgId, sender, text };
  $('replying-to').textContent = `Replying to ${sender}`;
  $('replying-snippet').textContent = text;
  $('replying-banner').classList.remove('hidden');
  $('message-input').focus();
}

function cancelReply() {
  state.replyingTo = null;
  $('replying-banner').classList.add('hidden');
}

/* =========================================================================
   Mini Doodle & Quick Sketch Pad
   ========================================================================= */

let doodleCtx = null;
let isDoodling = false;
let currentDoodleColor = '#ef4444';
let lastDoodleX = 0;
let lastDoodleY = 0;

function initDoodleCanvas() {
  const canvas = $('doodle-canvas');
  if (!canvas) return;
  doodleCtx = canvas.getContext('2d');
  canvas.width = 440;
  canvas.height = 260;
  clearDoodleCanvas();

  const getPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if (e.touches && e.touches[0]) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  const startDraw = (e) => {
    e.preventDefault();
    isDoodling = true;
    const pos = getPos(e);
    lastDoodleX = pos.x;
    lastDoodleY = pos.y;
    doodleCtx.beginPath();
    doodleCtx.arc(pos.x, pos.y, 2, 0, Math.PI * 2);
    doodleCtx.fillStyle = currentDoodleColor;
    doodleCtx.fill();
  };

  const draw = (e) => {
    if (!isDoodling) return;
    e.preventDefault();
    const pos = getPos(e);
    doodleCtx.beginPath();
    doodleCtx.moveTo(lastDoodleX, lastDoodleY);
    doodleCtx.lineTo(pos.x, pos.y);
    doodleCtx.strokeStyle = currentDoodleColor;
    doodleCtx.lineWidth = 3.5;
    doodleCtx.lineCap = 'round';
    doodleCtx.lineJoin = 'round';
    doodleCtx.stroke();
    lastDoodleX = pos.x;
    lastDoodleY = pos.y;
  };

  const stopDraw = () => { isDoodling = false; };

  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', stopDraw);
  canvas.addEventListener('mouseleave', stopDraw);

  canvas.addEventListener('touchstart', startDraw, { passive: false });
  canvas.addEventListener('touchmove', draw, { passive: false });
  canvas.addEventListener('touchend', stopDraw);

  document.querySelectorAll('.color-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.color-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentDoodleColor = btn.dataset.color || '#ef4444';
    });
  });
}

function openDoodleModal() {
  if (!state.selectedPeer) return showToast('Select a peer or the LAN Group Room first');
  clearDoodleCanvas();
  $('doodle-modal').classList.remove('hidden');
}

function closeDoodleModal() {
  $('doodle-modal').classList.add('hidden');
}

function clearDoodleCanvas() {
  const canvas = $('doodle-canvas');
  if (doodleCtx && canvas) {
    doodleCtx.fillStyle = '#070b13';
    doodleCtx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

async function sendDoodleSketch() {
  const canvas = $('doodle-canvas');
  if (!canvas || !state.selectedPeer) return;

  const dataUrl = canvas.toDataURL('image/png');
  const base64 = dataUrl.split(',')[1];
  const name = `sketch-${Date.now()}.png`;
  closeDoodleModal();

  if (state.selectedPeer === LAN_GROUP_ID) {
    addMessage(LAN_GROUP_ID, {
      id: `m-${Date.now()}`,
      kind: 'image',
      name,
      url: dataUrl,
      size: Math.round(base64.length * 0.75),
      mine: true,
      senderName: state.identity?.name,
      time: formatTime()
    });
    playSentTick();
    await callApp('BroadcastMessage', `[Shared quick sketch: ${name}]`);
    return;
  }

  try {
    await callApp('SendFileDirect', state.selectedPeer, name, 'image/png', base64);
    addMessage(state.selectedPeer, {
      id: `m-${Date.now()}`,
      kind: 'image',
      name,
      url: dataUrl,
      size: Math.round(base64.length * 0.75),
      mine: true,
      time: formatTime()
    });
    playSentTick();
    showToast('Sent quick sketch');
  } catch (err) {
    showToast(`Could not send sketch: ${err.message}`);
  }
}

/* =========================================================================
   One-Click Send Clipboard
   ========================================================================= */

async function sendFromClipboard() {
  if (!state.selectedPeer) return showToast('Select a peer first');
  try {
    const text = await navigator.clipboard.readText();
    if (!text?.trim()) return showToast('Clipboard has no text');
    const input = $('message-input');
    if (input.value) {
      input.value += (input.value.endsWith(' ') ? '' : ' ') + text;
    } else {
      input.value = text;
    }
    input.focus();
    showToast('Clipboard content pasted');
  } catch (err) {
    showToast(`Clipboard error: ${err.message}`);
  }
}

/* =========================================================================
   Privacy Shield & App Lock PIN
   ========================================================================= */

function loadSecuritySettings() {
  state.privacyShield = window.localStorage.getItem('inchat.privacy_shield') === 'true';
  state.appPin = window.localStorage.getItem('inchat.app_pin') || '';
  const pinInput = $('settings-pin');
  if (pinInput) pinInput.value = state.appPin;
  const shieldCheckbox = $('privacy-shield');
  if (shieldCheckbox) shieldCheckbox.checked = state.privacyShield;
}

function lockApp() {
  if (!state.appPin) {
    showToast('Please configure a 4-digit PIN in Settings first');
    showSettings();
    return;
  }
  state.isLocked = true;
  document.body.classList.add('app-locked');
  $('pin-input').value = '';
  $('lock-modal').classList.remove('hidden');
  setTimeout(() => $('pin-input').focus(), 60);
}

function unlockApp() {
  const entered = $('pin-input').value.trim();
  if (entered === state.appPin) {
    state.isLocked = false;
    document.body.classList.remove('app-locked');
    $('lock-modal').classList.add('hidden');
    $('pin-input').value = '';
    showToast('inChat unlocked');
  } else {
    showToast('Incorrect PIN');
    $('pin-input').value = '';
    $('pin-input').focus();
  }
}

function handleWindowBlur() {
  if (state.privacyShield && !state.isLocked) {
    document.body.classList.add('privacy-shield-active');
  }
}

function handleWindowFocus() {
  document.body.classList.remove('privacy-shield-active');
}

init();


/* =========================================================================
   Top 1: Local Outbox Queue Implementation
   ========================================================================= */

function saveOutbox() {
  const obj = {};
  for (const [peerId, list] of state.outbox) {
    if (list.length > 0) obj[peerId] = list;
  }
  try {
    window.localStorage.setItem('inchat.outbox.v1', JSON.stringify(obj));
  } catch (_) {}
}

function loadOutbox() {
  try {
    const raw = window.localStorage.getItem('inchat.outbox.v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      for (const [peerId, list] of Object.entries(parsed)) {
        if (Array.isArray(list) && list.length > 0) {
          state.outbox.set(peerId, list);
        }
      }
    }
  } catch (_) {}
}

async function flushOutboxForPeer(peerId) {
  const queue = state.outbox.get(peerId);
  if (!queue || queue.length === 0) return;
  const peer = state.peers.get(peerId);
  if (!peer?.connected) return;

  const remaining = [];
  let flushedCount = 0;

  for (const item of queue) {
    try {
      const outgoingText = item.replyTo ? `[Replying to ${item.replyTo.sender}: "${item.replyTo.text.slice(0, 50)}"]\n${item.text}` : item.text;
      await callApp('SendMessage', peerId, outgoingText);
      item.status = 'sent';
      flushedCount++;
      const peerMsgs = state.messages.get(peerId);
      const found = peerMsgs?.find((m) => m.id === item.id);
      if (found) found.status = 'sent';
    } catch (err) {
      remaining.push(item);
    }
  }

  if (remaining.length > 0) {
    state.outbox.set(peerId, remaining);
  } else {
    state.outbox.delete(peerId);
  }
  saveOutbox();
  saveMessageHistory();
  if (state.selectedPeer === peerId) {
    renderMessages();
  }
  if (flushedCount > 0) {
    showToast(`Outbox: Delivered ${flushedCount} pending message(s) to ${peer.name}`);
  }
}

/* =========================================================================
   Top 2: Department Channels / Private LAN Rooms Implementation
   ========================================================================= */

function renderChannels() {
  const container = $('channel-list');
  if (!container) return;
  if (state.channels.size === 0) {
    container.innerHTML = '<div class="channel-empty">No department rooms. Click ＋ Room to join.</div>';
    return;
  }
  const html = [];
  const myId = state.identity?.id;
  const myName = state.identity?.name;

  for (const [id, ch] of state.channels) {
    const isSelected = state.selectedPeer === id;
    const badge = ch.unread > 0 ? `<span class="channel-badge">${ch.unread}</span>` : '';
    const lockIcon = ch.passphrase ? '<span class="channel-lock" title="AES-256 GCM Encrypted">🔒</span>' : '';
    const memberCount = getChannelMembers(ch).length;
    
    // Creator check: if creator matches local ID/name or if not recorded (legacy local room)
    const isCreator = !ch.creator || ch.creator === myId || ch.creator === myName || ch.creatorName === myName;
    const actionBtn = isCreator
      ? `<button class="channel-action-btn channel-delete-btn" data-del-channel="${escapeHtml(id)}" title="Delete Department Room (Creator)">🗑️</button>`
      : `<button class="channel-action-btn channel-leave-btn" data-del-channel="${escapeHtml(id)}" title="Leave Room">✕</button>`;

    html.push(`
      <div class="channel-row-wrapper ${isSelected ? 'selected' : ''}">
        <button class="channel-row ${isSelected ? 'selected' : ''}" data-channel-id="${escapeHtml(id)}">
          <span class="channel-icon" title="Department Room">🏢</span>
          <span class="channel-name" title="${escapeHtml(ch.name)}${ch.creatorName ? ' (Created by ' + escapeHtml(ch.creatorName) + ')' : ''}">${escapeHtml(ch.name)} <span class="channel-count-badge">(${memberCount})</span></span>
          ${lockIcon}
          ${badge}
        </button>
        ${actionBtn}
      </div>
    `);
  }
  container.innerHTML = html.join('');
}

async function handleDeleteChannel(channelId, e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const ch = state.channels.get(channelId);
  if (!ch) return;

  const myId = state.identity?.id;
  const myName = state.identity?.name;
  const isCreator = !ch.creator || ch.creator === myId || ch.creator === myName || ch.creatorName === myName;
  const actionLabel = isCreator ? 'delete' : 'leave';

  if (!confirm(`Are you sure you want to ${actionLabel} department room "${ch.name}"?`)) return;

  // If creator, broadcast room deletion notice to peers
  if (isCreator && window.go && window.go.main && window.go.main.App) {
    try {
      await callApp('BroadcastChannelMessage', ch.name, `__ROOM_DELETED__:${ch.name}`);
    } catch (_) {}
  }

  state.channels.delete(channelId);
  if (state.messages && state.messages[channelId]) {
    delete state.messages[channelId];
  }
  saveChannels();

  if (state.selectedPeer === channelId) {
    state.selectedPeer = null;
    $('lan-room-card')?.classList.add('selected');
    updateConversationHeader();
    renderMessages();
  }
  renderChannels();
  showToast(`Room "${ch.name}" ${isCreator ? 'deleted' : 'left'}`);
}

function selectChannel(channelId) {
  state.selectedPeer = channelId;
  const channel = state.channels.get(channelId);
  if (channel) {
    channel.unread = 0;
  }
  clearAllSelections();
  const safeId = window.CSS?.escape ? CSS.escape(channelId) : channelId.replace(/"/g, '\\"');
  const wrapper = document.querySelector(`[data-channel-id="${safeId}"]`)?.closest('.channel-row-wrapper');
  wrapper?.classList.add('selected');
  const btn = document.querySelector(`[data-channel-id="${safeId}"]`);
  btn?.classList.add('selected');
  renderChannels();
  updateConversationHeader();
  renderMessages();
  startPingTimer(null);
}

function openChannelModal() {
  $('channel-name-input').value = '';
  $('channel-pass-input').value = '';
  $('channel-modal').classList.remove('hidden');
  setTimeout(() => $('channel-name-input').focus(), 60);
}

function closeChannelModal() {
  $('channel-modal').classList.add('hidden');
}

async function handleConfirmJoinChannel() {
  const rawInput = $('channel-name-input').value.trim();
  if (!rawInput) {
    return showToast('Please enter a room name');
  }
  // Strip leading '#' if entered, sanitize control characters, collapse whitespace, preserve natural casing & symbols
  const cleanName = rawInput.replace(/^#+\s*/, '').replace(/[\x00-\x1F\x7F]/g, '').replace(/\s+/g, ' ').slice(0, 40);
  if (!cleanName) {
    return showToast('Please enter a valid room name');
  }

  // Normalized channel ID for internal routing
  const normalizedSlug = cleanName.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const channelId = `__channel_${normalizedSlug || cleanName.toLowerCase()}__`;

  const pass = $('channel-pass-input').value;
  let key = null;
  if (pass) {
    try {
      key = await deriveChannelKey(pass, cleanName);
    } catch (e) {
      return showToast('Failed to derive encryption key: ' + e.message);
    }
  }

  const chObj = {
    id: channelId,
    name: cleanName,
    passphrase: pass || '',
    key,
    unread: 0,
    creator: state.identity?.id || state.identity?.name || '',
    creatorName: state.identity?.name || 'Local User',
    members: [
      { id: state.identity?.id || 'local-me', name: state.identity?.name || 'Local User', isCreator: true }
    ],
    createdAt: Date.now()
  };
  state.channels.set(channelId, chObj);
  saveChannels();
  renderChannels();
  closeChannelModal();
  selectChannel(channelId);
  showToast(`Joined department room "${cleanName}"${pass ? ' (AES-256 GCM Encrypted)' : ''}`);
}

function saveChannels() {
  const list = [];
  for (const [_, ch] of state.channels) {
    list.push({
      id: ch.id,
      name: ch.name,
      passphrase: ch.passphrase,
      creator: ch.creator || '',
      creatorName: ch.creatorName || '',
      members: Array.isArray(ch.members) ? ch.members : [],
      createdAt: ch.createdAt || Date.now()
    });
  }
  const jsonStr = JSON.stringify(list);
  try {
    window.localStorage.setItem('inchat.channels.v2', jsonStr);
  } catch (_) {}
  // Persist directly to %APPDATA%\inChat\channels.json so rooms are NEVER lost across updates
  callApp('SaveChannels', jsonStr).catch(() => {});
}

async function loadChannels() {
  let raw = null;
  // 1. Try Go backend persistent storage first (%APPDATA%\inChat\channels.json)
  try {
    const backendData = await callApp('LoadChannels');
    if (backendData && backendData.trim().length > 2) {
      raw = backendData;
    }
  } catch (_) {}

  // 2. Fallback to localStorage keys (v2, v1, or legacy inchat.channels)
  if (!raw) {
    try {
      raw = window.localStorage.getItem('inchat.channels.v2') ||
            window.localStorage.getItem('inchat.channels.v1') ||
            window.localStorage.getItem('inchat.channels');
    } catch (_) {}
  }

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (!item || !item.name) continue;
          const cleanName = (item.name || '').replace(/^#+\s*/, '');
          let key = null;
          if (item.passphrase) {
            try {
              key = await deriveChannelKey(item.passphrase, cleanName);
            } catch (_) {}
          }
          state.channels.set(item.id, {
            id: item.id,
            name: cleanName,
            passphrase: item.passphrase || '',
            key,
            unread: 0,
            creator: item.creator || '',
            creatorName: item.creatorName || '',
            members: Array.isArray(item.members) ? item.members : [],
            createdAt: item.createdAt || Date.now()
          });
        }
      }
    } catch (_) {}
  }

  // 3. Self-healing fallback: scan state.messages or chat history for any department channels!
  // If the user had conversations in __channel_xxx__, restore the room automatically!
  for (const [convId] of state.messages) {
    if (typeof convId === 'string' && convId.startsWith('__channel_') && !state.channels.has(convId)) {
      const rawName = convId.replace(/^__channel_/, '').replace(/__$/, '');
      const prettyName = rawName.replace(/_/g, ' ');
      state.channels.set(convId, {
        id: convId,
        name: prettyName,
        passphrase: '',
        key: null,
        unread: 0,
        creator: '',
        creatorName: '',
        members: [],
        createdAt: Date.now()
      });
    }
  }

  saveChannels();
  renderChannels();
}

async function receiveChannelMessage(payload) {
  const rawChannelName = (payload.channel || '').trim().replace(/^#+\s*/, '');
  if (!rawChannelName) return;

  const normalizedSlug = rawChannelName.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const channelId = `__channel_${normalizedSlug || rawChannelName.toLowerCase()}__`;

  // Check for room deletion broadcast
  if (payload.text && payload.text.startsWith('__ROOM_DELETED__:')) {
    const deletedName = payload.text.replace('__ROOM_DELETED__:', '').trim();
    showToast(`Department room "${deletedName || rawChannelName}" was closed by creator.`);
    if (state.channels.has(channelId)) {
      state.channels.delete(channelId);
      saveChannels();
      if (state.selectedPeer === channelId) {
        state.selectedPeer = null;
        $('lan-room-card')?.classList.add('selected');
        updateConversationHeader();
        renderMessages();
      }
      renderChannels();
    }
    return;
  }

  if (!state.channels.has(channelId)) {
    state.channels.set(channelId, {
      id: channelId,
      name: rawChannelName,
      passphrase: '',
      key: null,
      unread: 0,
      creator: payload.peer_id || payload.sender || '',
      creatorName: payload.name || '',
      members: payload.name ? [{ id: payload.peer_id || payload.sender || '', name: payload.name, isCreator: true }] : [],
      createdAt: Date.now()
    });
    saveChannels();
    renderChannels();
  }

  const ch = state.channels.get(channelId);
  if (ch && payload.name) {
    if (!Array.isArray(ch.members)) ch.members = [];
    const senderName = payload.name;
    const senderId = payload.peer_id || payload.sender || '';
    if (!ch.members.some((m) => (senderId && m.id === senderId) || m.name === senderName)) {
      ch.members.push({
        id: senderId,
        name: senderName,
        isCreator: senderId === ch.creator || senderName === ch.creatorName
      });
      saveChannels();
      renderChannels();
      if (state.selectedPeer === channelId) {
        updateConversationHeader();
      }
    }
  }

  let decryptedText = payload.text;
  let isEncrypted = false;
  if (payload.text && payload.text.startsWith('__ENC__:')) {
    isEncrypted = true;
    decryptedText = await decryptChannelMessage(payload.text, ch?.key);
  }

  const { replyTo, text } = parseReplyFromText(decryptedText);
  const isMine = payload.peer_id === state.identity?.id;

  addMessage(channelId, {
    id: payload.id || `ch-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    kind: 'text',
    text,
    replyTo,
    mine: isMine,
    senderName: payload.name || 'Anonymous',
    encrypted: isEncrypted,
    time: formatTime(new Date(payload.timestamp ? payload.timestamp * 1000 : Date.now()))
  });

  if (!isMine) {
    playChime();
    if (state.selectedPeer !== channelId) {
      if (ch) ch.unread = (ch.unread || 0) + 1;
      renderChannels();
      showToast(`[${rawChannelName}] ${payload.name}: ${text.slice(0, 45)}`);
    }
  }
}

/* =========================================================================
   Top 3: Export Chat to HTML / Text (Corporate Audit Archive)
   ========================================================================= */

async function exportCurrentChat() {
  if (!state.selectedPeer) {
    return showToast('Select a conversation or room to export');
  }

  const isGroup = state.selectedPeer === LAN_GROUP_ID;
  const isChannel = Boolean(state.selectedPeer?.startsWith('__channel_'));
  let convoTitle = 'Conversation';
  let participants = [];

  if (isGroup) {
    convoTitle = 'LAN Group Room';
    participants = [`Local device: ${state.identity?.name} (${state.identity?.id})`, 'All LAN group peers (Broadcast Mesh)'];
  } else if (isChannel) {
    const ch = state.channels.get(state.selectedPeer);
    convoTitle = ch?.name || 'Department Room';
    participants = [`Local device: ${state.identity?.name} (${state.identity?.id})`, `Department Room: ${ch?.name || 'Department Room'}`];
  } else {
    const peer = state.peers.get(state.selectedPeer);
    convoTitle = peer?.name || state.selectedPeer;
    participants = [
      `${state.identity?.name} (${state.identity?.id})`,
      `${peer?.name || 'Peer'} (${peer?.id || state.selectedPeer}) - Fingerprint: ${peer?.fingerprint || 'N/A'}`
    ];
  }

  const msgs = state.messages.get(state.selectedPeer) || [];
  if (msgs.length === 0) {
    return showToast('No messages in this conversation to export');
  }

  const rawData = JSON.stringify(msgs);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawData));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const sha256Hash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  const nowIso = new Date().toISOString();
  const exportTimeStr = new Date().toLocaleString();

  const messagesHtml = msgs.map((m) => {
    const sender = m.mine ? (state.identity?.name || 'Me') : (m.senderName || convoTitle);
    const replySnippet = m.replyTo ? `<div style="font-size:11px;color:#64748b;margin-bottom:4px;border-left:2px solid #cbd5e1;padding-left:6px">Replying to ${escapeHtml(m.replyTo.sender)}: "${escapeHtml(m.replyTo.text.slice(0, 60))}"</div>` : '';
    let body = escapeHtml(m.text || '');
    if (m.kind === 'file') body = `[Attached File: ${escapeHtml(m.name || 'file')} (${formatBytes(m.size || 0)})]`;
    if (m.kind === 'image') body = `[Embedded Image${m.caption ? `: ${escapeHtml(m.caption)}` : ''}]`;
    if (m.kind === 'audio') body = '[Voice Memo Note]';
    const statusText = m.mine ? ` [${m.status || 'sent'}]` : '';

    return `
      <div style="margin-bottom:12px;padding:10px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <strong style="color:#0f172a;font-size:13px">${escapeHtml(sender)}${statusText}</strong>
          <span style="color:#64748b;font-size:11px">${m.time}</span>
        </div>
        ${replySnippet}
        <div style="color:#334155;font-size:13px;white-space:pre-wrap;word-break:break-word">${body}</div>
      </div>
    `;
  }).join('');

  const htmlDoc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>inChat Corporate Audit Archive - ${escapeHtml(convoTitle)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 32px; background: #ffffff; color: #0f172a; line-height: 1.5; }
    .header { border-bottom: 2px solid #0f172a; padding-bottom: 16px; margin-bottom: 24px; }
    .title { font-size: 24px; font-weight: 700; margin: 0 0 6px 0; }
    .meta-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 12px; }
    .meta-table td { padding: 4px 8px; border: 1px solid #e2e8f0; }
    .meta-table td.label { font-weight: 600; width: 180px; background: #f1f5f9; color: #475569; }
    .hash-badge { font-family: monospace; font-size: 11px; background: #e0f2fe; color: #0369a1; padding: 2px 6px; border-radius: 4px; word-break: break-all; }
    .messages-container { margin-top: 24px; }
    .footer { margin-top: 36px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #64748b; text-align: center; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <div class="header">
    <h1 class="title">inChat Corporate Audit Transcript</h1>
    <div>Room / Conversation: <strong>${escapeHtml(convoTitle)}</strong></div>
    <table class="meta-table">
      <tr><td class="label">Export Timestamp</td><td>${escapeHtml(exportTimeStr)} (${escapeHtml(nowIso)})</td></tr>
      <tr><td class="label">Participants</td><td>${participants.map((p) => escapeHtml(p)).join('<br>')}</td></tr>
      <tr><td class="label">Message Count</td><td>${msgs.length} messages</td></tr>
      <tr><td class="label">Cryptographic Digest</td><td><span class="hash-badge">SHA-256: ${sha256Hash}</span></td></tr>
      <tr><td class="label">Application Version</td><td>inChat Enterprise v0.1.0 (Zero-Cloud P2P Mesh)</td></tr>
    </table>
  </div>
  <div class="messages-container">
    ${messagesHtml}
  </div>
  <div class="footer">
    Generated by inChat Enterprise P2P LAN Mesh. This record is immutable and cryptographically indexed.
  </div>
</body>
</html>`;

  const safeName = convoTitle.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `inchat-audit-${safeName}-${new Date().toISOString().slice(0, 10)}.html`;

  try {
    const savedPath = await callApp('ExportChatHTML', filename, htmlDoc);
    if (savedPath) {
      showToast(`Audit log exported: ${savedPath}`, 5000);
    }
  } catch (err) {
    showToast(`Export failed: ${err.message}`);
  }
}

/* =========================================================================
   Top 4: Subnet Range Scanner Implementation
   ========================================================================= */

function openConnectModal() {
  switchConnectTab('single');
  $('connect-ip-input').value = '';
  $('scan-status').textContent = '';
  $('connect-modal').classList.remove('hidden');
  setTimeout(() => $('connect-ip-input').focus(), 60);
}

function closeConnectModal() {
  $('connect-modal').classList.add('hidden');
}

function switchConnectTab(tab) {
  if (tab === 'single') {
    $('tab-single-ip').classList.add('active');
    $('tab-subnet-scan').classList.remove('active');
    $('panel-single-ip').classList.remove('hidden');
    $('panel-subnet-scan').classList.add('hidden');
    setTimeout(() => $('connect-ip-input').focus(), 50);
  } else {
    $('tab-subnet-scan').classList.add('active');
    $('tab-single-ip').classList.remove('active');
    $('panel-subnet-scan').classList.remove('hidden');
    $('panel-single-ip').classList.add('hidden');
    setTimeout(() => $('connect-subnet-input').focus(), 50);
  }
}

async function handleSingleConnect() {
  const ip = $('connect-ip-input').value.trim();
  if (!ip) return showToast('Please enter a LAN IP address');
  try {
    const peer = await callApp('ManualConnect', ip);
    state.peers.set(peer.id, peer);
    renderPeers();
    closeConnectModal();
    showToast(`Connected to ${peer.name || peer.address}`);
  } catch (err) {
    showToast(`Connection failed: ${err.message}`);
  }
}

async function handleSubnetScan() {
  const target = $('connect-subnet-input').value.trim();
  if (!target) return showToast('Please enter a subnet (e.g. 192.168.1.0/24 or 192.168.1)');
  const btn = $('do-subnet-scan');
  const statusEl = $('scan-status');
  btn.disabled = true;
  btn.textContent = 'Scanning 254 hosts…';
  statusEl.innerHTML = '<span style="color:#38bdf8">⏳ Concurrently probing port 42426 across subnet…</span>';

  try {
    const found = await callApp('ScanSubnet', target);
    if (!found || found.length === 0) {
      statusEl.innerHTML = '<span style="color:#94a3b8">Scan complete. No active inChat instances found.</span>';
    } else {
      statusEl.innerHTML = `<span style="color:#22c55e;font-weight:600">✓ Discovered ${found.length} peer(s)!</span>`;
      for (const p of found) {
        state.peers.set(p.id, p);
      }
      renderPeers();
      showToast(`Subnet scan found ${found.length} active peer(s)!`);
      setTimeout(() => {
        closeConnectModal();
      }, 1600);
    }
  } catch (err) {
    statusEl.innerHTML = `<span style="color:#ef4444">Scan failed: ${escapeHtml(err.message)}</span>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Start Subnet Scan';
  }
}
