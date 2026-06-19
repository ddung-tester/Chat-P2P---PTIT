/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  webServer.js — Web GUI Server (Express + Socket.IO)         ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * VAI TRÒ:
 *   Tạo HTTP server phục vụ giao diện web (HTML/CSS/JS) cho peer node.
 *   Là "cầu nối" giữa browser và hệ thống P2P bên dưới.
 *
 * KIẾN TRÚC:
 *   Browser (Socket.IO client)
 *       ↕ WebSocket (real-time, bidirectional)
 *   webServer.js (Express + Socket.IO)
 *       ↕ eventBus.js (EventEmitter)
 *   Core modules (messageHandler, reliableDelivery, bootstrapClient)
 *
 * CÁCH HOẠT ĐỘNG:
 *   1. Express serve static files từ thư mục public/
 *   2. Socket.IO lắng nghe events từ eventBus → forward tới browser
 *   3. Browser gửi lệnh (send-msg, get-peers...) → Socket.IO nhận → gọi core modules
 *
 * PORT:
 *   PEER_PORT + 1000 (ví dụ: peer 5001 → web 6001)
 *   Tránh xung đột với TCP port của peer
 */

'use strict';

const path    = require('path');
const http    = require('http');
const express = require('express');
const { Server: SocketIOServer } = require('socket.io');

// Import event bus để lắng nghe events từ core modules
const bus = require('./eventBus');

// Import crypto để mã hóa nội dung trước khi gửi
const { encrypt } = require('./crypto');

// Import logger utility để tạo message ID
const { msgId, timestamp } = require('./logger');

// Import state để đọc pending ACKs count
const state = require('./state');

/**
 * Khởi động web server cho GUI.
 *
 * @param {object} config       Cấu hình peer (PEER_ID, PEER_NAME, PEER_PORT, ...)
 * @param {object} deps         Dependencies được inject từ peer.js
 *   @param {function} deps.getPeers      — Lấy danh sách peer online từ Bootstrap
 *   @param {function} deps.sendWithAck   — Gửi tin nhắn có ACK + retry
 *   @param {function} deps.leavePeer     — Thông báo rời mạng
 *   @param {object}   deps.server        — TCP server (để close khi exit)
 *   @param {function} deps.getHeartbeatTimer — Getter cho heartbeat interval
 */
function startWebServer(config, deps) {
  const { PEER_ID, PEER_NAME, PEER_HOST, PEER_PORT, BOOTSTRAP, ENCRYPTION_KEY } = config;
  const { getPeers, sendWithAck, leavePeer, server: tcpServer, getHeartbeatTimer } = deps;

  // Helper: mã hóa content nếu có key
  const maybeEncrypt = (text) => ENCRYPTION_KEY ? encrypt(text, ENCRYPTION_KEY) : text;

  // ─── Express app ──────────────────────────────────────────────────────
  const app = express();
  const httpServer = http.createServer(app);

  // Serve static files từ thư mục public/
  app.use(express.static(path.join(__dirname, 'public')));

  // ─── Socket.IO ────────────────────────────────────────────────────────
  const io = new SocketIOServer(httpServer, {
    cors: { origin: '*' }, // Cho phép mọi origin (development)
  });

  // ─── Chuyển tiếp events từ core → browser ─────────────────────────────
  const coreEvents = [
    'chat-received',
    'group-received',
    'broadcast-received',
    'ack-received',
    'send-failed',
    'offline-msg',
    'stored-forward',
  ];

  for (const eventName of coreEvents) {
    bus.on(eventName, (data) => {
      io.emit(eventName, data);
    });
  }

  // ─── Xử lý kết nối từ browser ────────────────────────────────────────
  io.on('connection', (socket) => {
    console.log(`[WebGUI] Browser connected: ${socket.id}`);

    // Gửi config peer cho browser khi kết nối
    socket.emit('peer-config', {
      peerId: PEER_ID,
      peerName: PEER_NAME,
      peerHost: PEER_HOST,
      peerPort: PEER_PORT,
      bootstrap: BOOTSTRAP,
      encrypted: !!ENCRYPTION_KEY,
    });

    // ── get-peers: Lấy danh sách peer online ──────────────────────────
    socket.on('get-peers', async (callback) => {
      try {
        const peers = await getPeers();
        if (typeof callback === 'function') callback({ ok: true, peers });
      } catch (e) {
        if (typeof callback === 'function') callback({ ok: false, error: e.message });
      }
    });

    // ── get-status: Lấy trạng thái peer ──────────────────────────────
    socket.on('get-status', (callback) => {
      if (typeof callback === 'function') {
        callback({
          peerId: PEER_ID,
          peerName: PEER_NAME,
          host: PEER_HOST,
          port: PEER_PORT,
          bootstrap: BOOTSTRAP,
          encrypted: !!ENCRYPTION_KEY,
          pendingAcks: state.pendingAcks.size,
        });
      }
    });

    // ── send-msg: Gửi tin nhắn 1-1 ────────────────────────────────────
    socket.on('send-msg', async (data, callback) => {
      const { targetId, content } = data;
      if (!targetId || !content) {
        if (typeof callback === 'function') callback({ ok: false, error: 'Missing targetId or content' });
        return;
      }

      try {
        const peers = await getPeers();
        const target = peers.find((p) => p.id === targetId);
        if (!target) {
          if (typeof callback === 'function') callback({ ok: false, error: `Peer "${targetId}" không tìm thấy hoặc offline.` });
          return;
        }

        const id = msgId();
        const payload = {
          type: 'CHAT',
          id,
          from: PEER_ID,
          to: targetId,
          content: maybeEncrypt(content),
          timestamp: Date.now(),
        };

        sendWithAck(target.host, target.port, payload);
        if (typeof callback === 'function') callback({ ok: true, msgId: id, timestamp: timestamp() });
      } catch (e) {
        if (typeof callback === 'function') callback({ ok: false, error: e.message });
      }
    });

    // ── send-group: Gửi tin nhắn nhóm ─────────────────────────────────
    socket.on('send-group', async (data, callback) => {
      const { targetIds, content } = data;
      if (!targetIds || !targetIds.length || !content) {
        if (typeof callback === 'function') callback({ ok: false, error: 'Missing targetIds or content' });
        return;
      }

      try {
        const peers = await getPeers();
        const peerMap = Object.fromEntries(peers.map((p) => [p.id, p]));
        const sentIds = [];

        for (const targetId of targetIds) {
          const target = peerMap[targetId];
          if (!target) continue;

          const id = msgId();
          const payload = {
            type: 'GROUP_CHAT',
            id,
            from: PEER_ID,
            to: targetIds,
            content: maybeEncrypt(content),
            timestamp: Date.now(),
          };

          sendWithAck(target.host, target.port, payload);
          sentIds.push(id);
        }

        if (typeof callback === 'function') callback({ ok: true, msgIds: sentIds, timestamp: timestamp() });
      } catch (e) {
        if (typeof callback === 'function') callback({ ok: false, error: e.message });
      }
    });

    // ── send-broadcast: Gửi broadcast ─────────────────────────────────
    socket.on('send-broadcast', async (data, callback) => {
      const { content } = data;
      if (!content) {
        if (typeof callback === 'function') callback({ ok: false, error: 'Missing content' });
        return;
      }

      try {
        const peers = await getPeers();
        const others = peers.filter((p) => p.id !== PEER_ID);
        const sentIds = [];

        for (const target of others) {
          const id = msgId();
          const payload = {
            type: 'BROADCAST',
            id,
            from: PEER_ID,
            content: maybeEncrypt(content),
            timestamp: Date.now(),
          };

          sendWithAck(target.host, target.port, payload);
          sentIds.push(id);
        }

        if (typeof callback === 'function') callback({ ok: true, msgIds: sentIds, count: others.length, timestamp: timestamp() });
      } catch (e) {
        if (typeof callback === 'function') callback({ ok: false, error: e.message });
      }
    });

    // ── leave: Rời mạng ─────────────────────────────────────────────
    socket.on('leave', async (callback) => {
      clearInterval(getHeartbeatTimer());
      await leavePeer();
      tcpServer.close(() => {
        if (typeof callback === 'function') callback({ ok: true });
        process.exit(0);
      });
    });

    socket.on('disconnect', () => {
      console.log(`[WebGUI] Browser disconnected: ${socket.id}`);
    });
  });

  // ─── Khởi động HTTP server ──────────────────────────────────────────────
  const WEB_PORT = PEER_PORT + 1000;
  httpServer.listen(WEB_PORT, () => {
    console.log('╔══════════════════════════════════════════╗');
    console.log(`║  🌐 Web GUI: http://localhost:${WEB_PORT}       ║`);
    console.log('║  Mở trình duyệt để sử dụng giao diện    ║');
    console.log('╚══════════════════════════════════════════╝');
  });

  return { httpServer, io };
}

module.exports = { startWebServer };
