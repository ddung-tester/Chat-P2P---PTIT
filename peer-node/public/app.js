/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  app.js — Frontend GUI cho P2P Chat (Socket.IO Client)      ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * CHỨC NĂNG:
 *   1. Kết nối Socket.IO tới webServer.js
 *   2. Render danh sách peer online (poll mỗi 5s)
 *   3. Hiển thị tin nhắn theo conversation
 *   4. Gửi tin nhắn (1-1, nhóm, broadcast)
 *   5. Hiển thị ACK status, toast notifications
 */

'use strict';

// ─── Kết nối Socket.IO ─────────────────────────────────────────────
const socket = io();

// ─── State ──────────────────────────────────────────────────────────
let config = {};                      // Peer config từ server
let currentChannel = 'broadcast';     // Channel đang xem ('broadcast' hoặc peerId)
let conversations = {};               // { peerId/broadcast: [messages] }
let peers = [];                       // Danh sách peer online
let unreadCounts = {};                // { peerId/broadcast: count }
let sentMessages = {};                // { msgId: { channel, text, timestamp, status } }

// ─── Avatar Colors ──────────────────────────────────────────────────
const AVATAR_COLORS = 6;
function getAvatarColor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return Math.abs(hash) % AVATAR_COLORS;
}

function getInitials(name) {
  return name.charAt(0).toUpperCase();
}

// ─── DOM Elements ───────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  app:            $('#app'),
  selfName:       $('#self-name'),
  selfId:         $('#self-id'),
  selfAvatar:     $('#self-avatar'),
  connectionDot:  $('#connection-dot'),
  peerCount:      $('#peer-count'),
  peerList:       $('#peer-list'),
  peerListEmpty:  $('#peer-list-empty'),
  channelBroadcast: $('#channel-broadcast'),
  badgeBroadcast: $('#badge-broadcast'),
  chatName:       $('#chat-name'),
  chatStatus:     $('#chat-status'),
  chatAvatar:     $('#chat-avatar'),
  chatMessages:   $('#chat-messages'),
  welcomeMsg:     $('#welcome-msg'),
  chatInput:      $('#chat-input'),
  sendBtn:        $('#send-btn'),
  encBadge:       $('#enc-badge'),
  infoPeerId:     $('#info-peer-id'),
  infoPeerName:   $('#info-peer-name'),
  infoTcp:        $('#info-tcp'),
  infoBootstrap:  $('#info-bootstrap'),
  infoEncryption: $('#info-encryption'),
  statusPendingAcks: $('#status-pending-acks'),
  statusPeersOnline: $('#status-peers-online'),
  archSelfLabel:  $('#arch-self-label'),
  btnToggleInfo:  $('#btn-toggle-info'),
  btnCloseInfo:   $('#btn-close-info'),
  btnLeave:       $('#btn-leave'),
  toastContainer: $('#toast-container'),
};

// ─── Socket.IO Events ───────────────────────────────────────────────

// Nhận config peer khi kết nối
socket.on('peer-config', (cfg) => {
  config = cfg;
  dom.selfName.textContent = cfg.peerName;
  dom.selfId.textContent = cfg.peerId;
  dom.selfAvatar.textContent = getInitials(cfg.peerName);
  
  // Sửa tên thẻ trong Chrome để dễ phân biệt
  document.title = `PTIT P2P Chat - ${cfg.peerName} (${cfg.peerId})`;

  // Khôi phục lịch sử chat từ localStorage dựa trên peerId
  const storedHistory = localStorage.getItem(`p2p_chat_history_${cfg.peerId}`);
  if (storedHistory) {
    try {
      conversations = JSON.parse(storedHistory);
    } catch (e) {
      conversations = {};
    }
  }

  // Connection status
  const dot = dom.connectionDot.querySelector('.status-dot');
  dot.className = 'status-dot online';
  dom.connectionDot.title = 'Đang kết nối';

  // Info panel
  dom.infoPeerId.textContent = cfg.peerId;
  dom.infoPeerName.textContent = cfg.peerName;
  dom.infoTcp.textContent = `${cfg.peerHost}:${cfg.peerPort}`;
  dom.infoBootstrap.textContent = cfg.bootstrap;
  dom.infoEncryption.textContent = cfg.encrypted ? '🔒 AES-256-CBC' : '🔓 Không mã hóa';
  dom.archSelfLabel.textContent = cfg.peerName;

  // Encryption badge
  if (cfg.encrypted) {
    dom.encBadge.classList.remove('hidden');
  }

  // Fetch peers ngay lập tức
  fetchPeers();
  
  // Render lại tin nhắn cũ sau khi khôi phục lịch sử
  renderMessages();
});

// Tin nhắn 1-1 nhận được
socket.on('chat-received', (data) => {
  const msg = {
    id: data.id,
    type: 'CHAT',
    from: data.from,
    text: data.text,
    wasEncrypted: data.wasEncrypted,
    timestamp: data.timestamp,
    direction: 'received',
  };

  if (currentChannel !== data.from) {
    incrementUnread(data.from);
    showToast('info', `Tin nhắn từ ${getPeerName(data.from)}`, data.text);
  }

  addToConversation(data.from, msg);
});

// Tin nhắn nhóm nhận được
socket.on('group-received', (data) => {
  const msg = {
    id: data.id,
    type: 'GROUP_CHAT',
    from: data.from,
    to: data.to,
    text: data.text,
    wasEncrypted: data.wasEncrypted,
    timestamp: data.timestamp,
    direction: 'received',
  };

  if (currentChannel !== data.from) {
    incrementUnread(data.from);
    showToast('info', `Nhóm từ ${getPeerName(data.from)}`, data.text);
  }

  // Thêm vào conversation của người gửi
  addToConversation(data.from, msg);
});

// Broadcast nhận được
socket.on('broadcast-received', (data) => {
  const msg = {
    id: data.id,
    type: 'BROADCAST',
    from: data.from,
    text: data.text,
    wasEncrypted: data.wasEncrypted,
    timestamp: data.timestamp,
    direction: 'received',
  };

  if (currentChannel !== 'broadcast') {
    incrementUnread('broadcast');
    showToast('info', `📣 Broadcast từ ${getPeerName(data.from)}`, data.text);
  }

  addToConversation('broadcast', msg);
});

// ACK nhận được
socket.on('ack-received', (data) => {
  if (sentMessages[data.id]) {
    sentMessages[data.id].status = 'delivered';
    updateMessageStatus(data.id, 'delivered');
  }
  updateStatus();
});

// Gửi thất bại
socket.on('send-failed', (data) => {
  if (sentMessages[data.id]) {
    sentMessages[data.id].status = 'failed';
    updateMessageStatus(data.id, 'failed');
    showToast('error', 'Gửi thất bại', `Tin nhắn tới ${getPeerName(data.payload?.to)} không gửi được`);
  }
  updateStatus();
});

// Tin nhắn offline
socket.on('offline-msg', (data) => {
  const msg = {
    id: data.id || `offline-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    type: data.type || 'CHAT',
    from: data.from,
    text: data.content,
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    direction: 'received',
    offline: true,
    storedAt: data.storedAt,
  };

  addToConversation(data.from, msg);
  showToast('warning', 'Tin nhắn offline', `Nhận được tin từ ${getPeerName(data.from)} (lưu trước đó)`);
});

// Store-and-forward
socket.on('stored-forward', (data) => {
  showToast('info', 'Đã lưu tạm', `Tin nhắn cho ${getPeerName(data.to)} đã được lưu trên Bootstrap`);
});

// Kết nối / Mất kết nối
socket.on('connect', () => {
  const dot = dom.connectionDot.querySelector('.status-dot');
  dot.className = 'status-dot online';
});

socket.on('disconnect', () => {
  const dot = dom.connectionDot.querySelector('.status-dot');
  dot.className = 'status-dot offline';
  dom.connectionDot.title = 'Mất kết nối';
});

// ─── Fetch Peers ────────────────────────────────────────────────────
function fetchPeers() {
  socket.emit('get-peers', (res) => {
    if (res.ok) {
      peers = res.peers.filter(p => p.id !== config.peerId);
      renderPeerList();
      dom.statusPeersOnline.textContent = peers.length;
    }
  });
}

// Poll peers mỗi 5 giây
setInterval(fetchPeers, 5000);

// ─── Render Peer List ───────────────────────────────────────────────
function renderPeerList() {
  dom.peerCount.textContent = peers.length;

  if (peers.length === 0) {
    dom.peerListEmpty.classList.remove('hidden');
    // Remove peer items only
    dom.peerList.querySelectorAll('.peer-item').forEach(el => el.remove());
    return;
  }

  dom.peerListEmpty.classList.add('hidden');

  // Sắp xếp các peer dựa trên thời gian của tin nhắn mới nhất
  const sortedPeers = [...peers].sort((a, b) => {
    const lastMsgA = conversations[a.id] && conversations[a.id].length > 0
      ? conversations[a.id][conversations[a.id].length - 1]
      : null;
    const lastMsgB = conversations[b.id] && conversations[b.id].length > 0
      ? conversations[b.id][conversations[b.id].length - 1]
      : null;

    if (lastMsgA && lastMsgB) {
      return new Date(lastMsgB.timestamp) - new Date(lastMsgA.timestamp);
    } else if (lastMsgA) {
      return -1; // peer A có tin nhắn, đưa lên đầu
    } else if (lastMsgB) {
      return 1;  // peer B có tin nhắn, đưa lên đầu
    } else {
      return a.name.localeCompare(b.name); // Sắp xếp theo bảng chữ cái nếu chưa có tin nhắn
    }
  });

  // Xóa toàn bộ peer cũ để vẽ lại đúng thứ tự đã sắp xếp
  dom.peerList.querySelectorAll('.peer-item').forEach(el => el.remove());

  // Thêm lại các peer theo thứ tự mới
  for (const peer of sortedPeers) {
    const el = createPeerItem(peer);
    dom.peerList.appendChild(el);
  }

  // Cập nhật active state
  dom.peerList.querySelectorAll('.peer-item').forEach(el => {
    el.classList.toggle('active', el.dataset.peerId === currentChannel);
  });
}

function createPeerItem(peer) {
  const el = document.createElement('div');
  el.className = 'peer-item';
  
  const unread = unreadCounts[peer.id] || 0;
  if (unread > 0) {
    el.classList.add('has-unread');
  }
  
  el.dataset.peerId = peer.id;
  el.id = `peer-${peer.id}`;

  const colorIdx = getAvatarColor(peer.id);

  // Lấy tin nhắn cuối cùng để hiển thị preview
  const peerMsgs = conversations[peer.id] || [];
  const lastMsg = peerMsgs.length > 0 ? peerMsgs[peerMsgs.length - 1] : null;
  
  let infoSubtext = peer.id;
  let infoClass = 'peer-item-id';
  if (lastMsg) {
    const prefix = lastMsg.direction === 'sent' ? 'Bạn: ' : '';
    infoSubtext = prefix + lastMsg.text;
    infoClass = 'peer-item-last-msg';
  }

  el.innerHTML = `
    <div class="peer-item-avatar avatar-color-${colorIdx}">
      ${getInitials(peer.name)}
      <div class="online-indicator"></div>
    </div>
    <div class="peer-item-info">
      <span class="peer-item-name">${escapeHtml(peer.name)}</span>
      <span class="${infoClass}">${escapeHtml(infoSubtext)}</span>
    </div>
    <span class="unread-badge ${unread > 0 ? '' : 'hidden'}" id="badge-${peer.id}">${unread}</span>
  `;

  el.addEventListener('click', () => switchChannel(peer.id));
  return el;
}

// ─── Switch Channel ─────────────────────────────────────────────────
function switchChannel(channelId) {
  currentChannel = channelId;

  // Reset unread
  unreadCounts[channelId] = 0;

  // Update active states
  dom.channelBroadcast.classList.toggle('active', channelId === 'broadcast');
  
  // Vẽ lại danh sách peer để cập nhật trạng thái hoạt động và unread
  renderPeerList();

  // Update header
  if (channelId === 'broadcast') {
    dom.chatName.textContent = 'Broadcast';
    dom.chatStatus.textContent = 'Gửi tin nhắn tới tất cả peer';
    dom.chatAvatar.innerHTML = '<span>📣</span>';
    dom.chatAvatar.className = 'chat-header-avatar';
  } else {
    const peer = peers.find(p => p.id === channelId);
    const name = peer ? peer.name : channelId;
    dom.chatName.textContent = name;
    dom.chatStatus.textContent = `${channelId} • Online`;
    const colorIdx = getAvatarColor(channelId);
    dom.chatAvatar.innerHTML = `<span>${getInitials(name)}</span>`;
    dom.chatAvatar.className = `chat-header-avatar avatar-color-${colorIdx}`;
  }

  // Render messages
  renderMessages();

  // Focus input
  dom.chatInput.focus();
}

// ─── Render Messages ────────────────────────────────────────────────
function renderMessages() {
  const msgs = conversations[currentChannel] || [];

  dom.chatMessages.innerHTML = '';

  if (msgs.length === 0) {
    dom.chatMessages.appendChild(createWelcome());
    return;
  }

  for (const msg of msgs) {
    dom.chatMessages.appendChild(createMessageEl(msg));
  }

  scrollToBottom();
}

function createWelcome() {
  const el = document.createElement('div');
  el.className = 'welcome-message';
  if (currentChannel === 'broadcast') {
    el.innerHTML = `
      <div class="welcome-icon">📣</div>
      <h2>Broadcast Channel</h2>
      <p>Tin nhắn gửi đây sẽ được phát tới tất cả peer đang online.</p>
    `;
  } else {
    const name = getPeerName(currentChannel);
    el.innerHTML = `
      <div class="welcome-icon">💬</div>
      <h2>Chat với ${escapeHtml(name)}</h2>
      <p>Tin nhắn được gửi trực tiếp qua TCP (peer-to-peer).<br>Không đi qua server trung gian.</p>
    `;
  }
  return el;
}

function createMessageEl(msg) {
  const el = document.createElement('div');

  if (msg.system) {
    el.className = 'system-message';
    el.innerHTML = `<span class="system-message-text">${escapeHtml(msg.text)}</span>`;
    return el;
  }

  el.className = `message ${msg.direction}`;
  el.id = `msg-${msg.id}`;

  const senderName = msg.direction === 'sent' ? config.peerName : getPeerName(msg.from);
  const statusIcon = msg.direction === 'sent' ? getStatusIcon(msg.status || 'pending') : '';
  const encBadge = msg.wasEncrypted ? '<span class="msg-enc-badge">🔒 ENC</span>' : '';

  let typeBadge = '';
  if (msg.type === 'GROUP_CHAT') typeBadge = '<span class="msg-type-badge group">GROUP</span>';
  else if (msg.type === 'BROADCAST') typeBadge = '<span class="msg-type-badge broadcast">BROADCAST</span>';
  if (msg.offline) typeBadge = '<span class="msg-type-badge offline">OFFLINE</span>';

  el.innerHTML = `
    <div class="msg-bubble">
      ${typeBadge}
      <div class="msg-sender">${escapeHtml(senderName)}</div>
      <div class="msg-text">${escapeHtml(msg.text)}</div>
      <div class="msg-meta">
        ${encBadge}
        <span class="msg-time">${msg.timestamp}</span>
        ${statusIcon}
      </div>
    </div>
  `;

  return el;
}

function getStatusIcon(status) {
  switch (status) {
    case 'pending':   return '<span class="msg-status pending" title="Đang gửi...">◌</span>';
    case 'delivered': return '<span class="msg-status delivered" title="Đã gửi ✓">✓</span>';
    case 'failed':    return '<span class="msg-status failed" title="Thất bại ✗">✗</span>';
    default:          return '';
  }
}

function updateMessageStatus(msgId, status) {
  const el = $(`#msg-${msgId}`);
  if (!el) return;

  const statusEl = el.querySelector('.msg-status');
  if (!statusEl) return;

  statusEl.className = `msg-status ${status}`;
  switch (status) {
    case 'delivered':
      statusEl.textContent = '✓';
      statusEl.title = 'Đã gửi ✓';
      break;
    case 'failed':
      statusEl.textContent = '✗';
      statusEl.title = 'Thất bại ✗';
      break;
  }
}

// ─── Send Message ───────────────────────────────────────────────────
function sendMessage() {
  const text = dom.chatInput.value.trim();
  if (!text) return;

  dom.chatInput.value = '';

  if (currentChannel === 'broadcast') {
    sendBroadcast(text);
  } else {
    sendDirect(currentChannel, text);
  }
}

function sendDirect(targetId, text) {
  socket.emit('send-msg', { targetId, content: text }, (res) => {
    if (res.ok) {
      const msg = {
        id: res.msgId,
        type: 'CHAT',
        from: config.peerId,
        text,
        timestamp: res.timestamp,
        direction: 'sent',
        status: 'pending',
        wasEncrypted: config.encrypted,
      };

      sentMessages[res.msgId] = { channel: targetId, text, status: 'pending' };
      addToConversation(targetId, msg);
    } else {
      showToast('error', 'Lỗi gửi tin', res.error);
    }
  });
}

function sendBroadcast(text) {
  socket.emit('send-broadcast', { content: text }, (res) => {
    if (res.ok) {
      const timestamp = res.timestamp;
      for (const msgId of res.msgIds) {
        sentMessages[msgId] = { channel: 'broadcast', text, status: 'pending' };
      }

      const msg = {
        id: res.msgIds[0] || `bcast-${Date.now()}`,
        type: 'BROADCAST',
        from: config.peerId,
        text,
        timestamp,
        direction: 'sent',
        status: 'pending',
        wasEncrypted: config.encrypted,
        _broadcastIds: res.msgIds,
      };

      addToConversation('broadcast', msg);

      if (res.count === 0) {
        showToast('warning', 'Broadcast', 'Không có peer nào khác online.');
      }
    } else {
      showToast('error', 'Lỗi broadcast', res.error);
    }
  });
}

// ─── Conversation Management ────────────────────────────────────────
function addToConversation(channelId, msg) {
  if (!conversations[channelId]) conversations[channelId] = [];
  conversations[channelId].push(msg);

  // Giới hạn 500 tin nhắn mỗi conversation
  if (conversations[channelId].length > 500) {
    conversations[channelId] = conversations[channelId].slice(-400);
  }

  // Lưu lịch sử chat vào localStorage của trình duyệt
  if (config.peerId) {
    localStorage.setItem(`p2p_chat_history_${config.peerId}`, JSON.stringify(conversations));
  }

  // Nếu đang xem channel này → render tin nhắn mới
  if (currentChannel === channelId) {
    dom.chatMessages.querySelector('.welcome-message')?.remove();
    dom.chatMessages.appendChild(createMessageEl(msg));
    scrollToBottom();
  }

  // Cập nhật lại danh sách peer (để đưa peer lên đầu và hiển thị preview tin nhắn mới)
  if (channelId !== 'broadcast') {
    renderPeerList();
  }
}

function incrementUnread(channelId) {
  unreadCounts[channelId] = (unreadCounts[channelId] || 0) + 1;
  const badge = $(`#badge-${channelId}`);
  if (badge) {
    badge.textContent = unreadCounts[channelId];
    badge.classList.remove('hidden');
  }
}

// ─── Utilities ──────────────────────────────────────────────────────
function getPeerName(peerId) {
  const peer = peers.find(p => p.id === peerId);
  return peer ? peer.name : peerId;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  });
}

function updateStatus() {
  socket.emit('get-status', (data) => {
    if (data) {
      dom.statusPendingAcks.textContent = data.pendingAcks;
    }
  });
}

// Poll status mỗi 3 giây
setInterval(updateStatus, 3000);

// ─── Toast Notifications ────────────────────────────────────────────
function showToast(type, title, message) {
  const icons = { success: '✅', error: '❌', info: '💬', warning: '⚠️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
    <div class="toast-body">
      <div class="toast-title">${escapeHtml(title)}</div>
      <div class="toast-message">${escapeHtml(message || '')}</div>
    </div>
  `;

  dom.toastContainer.appendChild(toast);

  // Tự đóng sau 4 giây
  setTimeout(() => {
    toast.classList.add('toast-out');
    toast.addEventListener('animationend', () => toast.remove());
  }, 4000);
}

// ─── Event Listeners ────────────────────────────────────────────────

// Gửi tin nhắn
dom.sendBtn.addEventListener('click', sendMessage);

dom.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Broadcast channel click
dom.channelBroadcast.addEventListener('click', () => switchChannel('broadcast'));

// Toggle info panel
dom.btnToggleInfo.addEventListener('click', () => {
  dom.app.classList.toggle('info-hidden');
});

dom.btnCloseInfo.addEventListener('click', () => {
  dom.app.classList.add('info-hidden');
});

// Leave
dom.btnLeave.addEventListener('click', () => {
  if (confirm('Bạn có chắc muốn rời mạng P2P?')) {
    socket.emit('leave', () => {
      document.body.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px;color:#8899b4;font-family:Inter,sans-serif;">
          <div style="font-size:48px;">👋</div>
          <h2 style="color:#e8edf5;">Đã rời mạng</h2>
          <p>Peer đã ngắt kết nối khỏi mạng P2P.</p>
        </div>
      `;
    });
  }
});

// ─── Initial State ──────────────────────────────────────────────────
switchChannel('broadcast');
