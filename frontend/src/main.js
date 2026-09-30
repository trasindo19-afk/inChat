import './style.css';
import appIcon from './inchat.png';

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
  startedAt: 0
};

const $ = (id) => document.getElementById(id);
const app = () => window.go?.main?.App;

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

async function callApp(method, ...args) {
  const api = app();
  if (!api?.[method]) throw new Error(`inChat backend is not ready: ${method}`);
  return api[method](...args);
}

async function init() {
  $('app-brand-icon').src = appIcon;
  bindEvents();
  try {
    state.identity = await callApp('GetIdentity');
    $('device-name').textContent = state.identity.name;
    $('device-id').textContent = state.identity.id;
    state.settings = await callApp('GetSettings');
    applySettingsToUI();
    loadMessageHistory();
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
    // The banner is best-effort; never let it break startup.
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
  if (state.selectedPeer === peer.id) updateConversationHeader();
}

function renderPeers() {
  const list = $('peer-list');
  const peers = [...state.peers.values()].sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
  $('peer-count').textContent = peers.length;
  if (!peers.length) {
    list.innerHTML = '<div class="empty-state">Looking for peers…<br>Make sure both devices are on the same LAN.</div>';
    return;
  }
  list.innerHTML = peers.map((peer) => `
    <button class="peer-row ${peer.id === state.selectedPeer ? 'selected' : ''}" data-peer-id="${escapeHtml(peer.id)}">
      <span class="peer-avatar">${escapeHtml(initials(peer.name))}<span class="dot ${peer.connected ? 'green' : ''}" style="position:absolute;right:-1px;bottom:1px;border:2px solid #101827"></span></span>
      <span class="peer-copy"><strong>${escapeHtml(peer.name || 'Unknown device')}</strong><small class="${peer.status === 'failed' ? 'status-failed' : ''}" title="${escapeHtml(peer.lastError || '')}">${escapeHtml(peerStatusLine(peer))}</small></span>
    </button>`).join('');
  list.querySelectorAll('[data-peer-id]').forEach((button) => {
    button.addEventListener('click', () => selectPeer(button.dataset.peerId));
  });
}

function selectPeer(peerId) {
  state.selectedPeer = peerId;
  renderPeers();
  updateConversationHeader();
  renderMessages();
  callApp('ConnectPeer', peerId).catch((error) => showToast(error.message));
}

function updateConversationHeader() {
  const peer = state.peers.get(state.selectedPeer);
  $('conversation-empty').classList.toggle('hidden', Boolean(peer));
  $('conversation').classList.toggle('hidden', !peer);
  if (!peer) return;
  $('conversation-name').textContent = peer.name || 'Unknown device';
  const stateLine = peerStatusLine(peer);
  $('conversation-state').textContent = peer.connected ? 'online · direct connection' : stateLine;
  $('conversation-state').classList.toggle('state-failed', peer.status === 'failed');
  $('conversation-state').title = peer.lastError || '';
}

function renderMessages() {
  const list = $('message-list');
  const messages = state.messages.get(state.selectedPeer) || [];
  if (!messages.length) {
    list.innerHTML = '<div class="empty-state">This conversation is private and direct.<br>Say hello to start.</div>';
    return;
  }
  list.innerHTML = messages.map((message) => message.kind === 'file' ? renderFileMessage(message) : renderTextMessage(message)).join('');
  list.querySelectorAll('[data-cancel-transfer]').forEach((button) => button.addEventListener('click', () => cancelFileTransfer(button.dataset.cancelTransfer)));
  list.scrollTop = list.scrollHeight;
}

function renderTextMessage(message) {
  return `<div class="message ${message.mine ? 'mine' : ''}"><div class="message-bubble">${escapeHtml(message.text)}</div><small class="message-time">${message.time}</small></div>`;
}

function renderFileMessage(message) {
  const progress = Number.isFinite(message.progress) ? `${message.progress}%` : '';
  const target = message.savedPath
    ? `<span><strong>Saved</strong><br><small>${escapeHtml(message.savedPath)}</small></span>`
    : message.url
      ? `<a href="${message.url}" download="${escapeHtml(message.name)}">${escapeHtml(message.name)}<br><small>${formatBytes(message.size)}</small></a>`
      : `<span>${escapeHtml(message.name || 'File transfer')}<br><small>${message.cancelled ? 'cancelled' : `sending ${progress}`}</small></span>${message.transferId && message.sending ? `<button class="cancel-transfer" data-cancel-transfer="${escapeHtml(message.transferId)}">Cancel</button>` : ''}`;
  return `<div class="message ${message.mine ? 'mine' : ''}"><div class="message-bubble file-message"><span>▧</span>${target}</div><small class="message-time">${message.time}</small></div>`;
}

async function sendCurrentMessage() {
  const input = $('message-input');
  const text = input.value.trim();
  if (!text || !state.selectedPeer) return;
  try {
    await callApp('SendMessage', state.selectedPeer, text);
    addMessage(state.selectedPeer, { kind: 'text', text, mine: true, time: formatTime() });
    input.value = '';
  } catch (error) {
    showToast(error.message);
  }
}

function loadMessageHistory() {
  try {
    const raw = window.localStorage.getItem('inchat.messages.v1');
    if (!raw) return;
    const saved = JSON.parse(raw);
    for (const [peerId, messages] of Object.entries(saved || {})) {
      if (Array.isArray(messages)) state.messages.set(peerId, messages.filter((message) => message.kind !== 'file' || message.savedPath).slice(-200));
    }
  } catch (_) {
    state.messages = new Map();
  }
}

function saveMessageHistory() {
  const value = {};
  for (const [peerId, messages] of state.messages) {
    value[peerId] = messages.filter((message) => message.kind !== 'file' || message.savedPath).slice(-200);
  }
  try { window.localStorage.setItem('inchat.messages.v1', JSON.stringify(value)); } catch (_) {}
}

function addMessage(peerId, message) {
  if (!state.messages.has(peerId)) state.messages.set(peerId, []);
  state.messages.get(peerId).push(message);
  saveMessageHistory();
  if (state.selectedPeer === peerId) renderMessages();
}

function receiveMessage(payload) {
  addMessage(payload.peer_id, { kind: 'text', text: payload.text, mine: false, time: formatTime() });
  showToast(`New message from ${state.peers.get(payload.peer_id)?.name || 'peer'}`);
}

function receiveFile(payload) {
  try {
    if (payload.saved_path) {
      addMessage(payload.peer_id, { kind: 'file', name: payload.name, size: payload.size, savedPath: payload.saved_path, mine: false, time: formatTime() });
      showToast(`Saved ${payload.name}`);
      return;
    }
    if (payload.size > 25 * 1024 * 1024) throw new Error('file exceeds the 25 MB MVP limit');
    const binary = atob(payload.data || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: payload.mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    addMessage(payload.peer_id, { kind: 'file', name: payload.name, size: payload.size, url, mine: false, time: formatTime() });
    showToast(`Received ${payload.name}`);
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
  if (!state.selectedPeer) return showToast('Select a peer first');
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

function applySettingsToUI() {
  if (!state.settings) return;
  $('settings-display-name').value = state.settings.displayName || '';
  $('settings-receive-folder').value = state.settings.receiveFolder || '';
  $('settings-update-feed').value = state.settings.updateFeedUrl || '';
  $('settings-theme').value = state.settings.theme || 'dark';
  applyTheme(state.settings.theme || 'dark');
  $('auto-accept-files').checked = Boolean(state.settings.autoAcceptFiles);
  applyAvatar($('local-avatar'), state.settings.avatarData);
  applyAvatar($('settings-avatar-preview'), state.settings.avatarData);
}

async function showSettings() {
  try {
    state.settings = await callApp('GetSettings');
    applySettingsToUI();
    $('settings-modal').classList.remove('hidden');
  } catch (error) {
    showToast(error.message);
  }
}

async function chooseAvatar() {
  try {
    state.settings = await callApp('ChooseAvatar');
    applySettingsToUI();
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
    const updateFeed = $('settings-update-feed').value.trim();
    const theme = $('settings-theme').value;
    await callApp('SetDisplayName', displayName);
    await callApp('SetAutoAcceptFiles', autoAccept);
    await callApp('SetUpdateFeedURL', updateFeed);
    await callApp('SetTheme', theme);
    state.identity.name = displayName;
    state.settings = await callApp('GetSettings');
    applySettingsToUI();
    $('settings-modal').classList.add('hidden');
    showToast('Settings saved');
  } catch (error) {
    showToast(error.message);
  }
}

async function launchRDP() {
  if (!state.selectedPeer) return showToast('Select a peer first');
  const peer = state.peers.get(state.selectedPeer);
  if (!peer) return;
  try {
    await callApp('LaunchRDP', state.selectedPeer);
    showToast(`Opening Windows RDP to ${peer.name || peer.address}`);
  } catch (error) {
    showToast(`RDP could not start: ${error.message}`);
  }
}

async function startGroupCall() {
  if (!state.selectedPeer) return showToast('Select a peer first');
  if (state.pc || state.group) return showToast('Another call is already active');
  const host = state.peers.get(state.selectedPeer);
  if (!host?.connected) return showToast('The host peer is still connecting');
  const others = [...state.peers.values()]
    .filter((peer) => peer.connected && peer.id !== state.selectedPeer)
    .slice(0, 3);
  if (!others.length) return showToast('At least two connected peers are needed for a group call');
  const participants = [state.identity?.id, state.selectedPeer, ...others.map((peer) => peer.id)].filter(Boolean);
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
  if (!window.confirm(`Accept group call from ${state.peers.get(payload.peer_id)?.name || 'peer'}?`)) return;
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
  if (!state.selectedPeer) return showToast('Select a peer first');
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
    const accept = window.confirm(`Accept ${peer.name || 'peer'} incoming call?`);
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
  $('peer-info-text').textContent = `Compare this safety code with ${peer.name || 'the other device'} before trusting the connection:\n\n${peer.fingerprint || 'Not available yet'}`;
  $('peer-modal').classList.remove('hidden');
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); showToast('Copied'); } catch (_) { showToast('Could not copy text'); }
}

init();
