/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  broadcaster.js — Peer tự động broadcast định kỳ            ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * VAI TRÒ:
 *   Peer đơn giản, không cần CLI, không cần readline.
 *   Chỉ làm 1 việc: join mạng → broadcast message mỗi N giây → thoát khi bị kill.
 *
 *   Dùng bởi churn-sim.js để chứng minh hệ thống hoạt động ổn định
 *   ngay cả khi các peer khác liên tục join/leave (churn).
 *
 * CÁCH CHẠY:
 *   node broadcaster.js [--id peer-broadcaster] [--port 5010]
 *                       [--name Broadcaster] [--interval 10000]
 *                       [--bootstrap http://127.0.0.1:3000]
 */

'use strict';

const net    = require('net');
const axios  = require('axios');
const logger = require('./logger');

// ─── Parse CLI arguments ──────────────────────────────────────────────────────
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]?.replace('--', '');
  if (key) args[key] = process.argv[i + 1];
}

const config = {
  PEER_ID    : args.id        || 'peer-broadcaster',
  PEER_NAME  : args.name      || 'Broadcaster',
  PEER_HOST  : args.host      || '127.0.0.1',
  PEER_PORT  : parseInt(args.port      || '5010', 10),
  BOOTSTRAP  : args.bootstrap || 'http://127.0.0.1:3000',
  INTERVAL_MS: parseInt(args.interval  || '10000', 10),
};

// ─── Tạo ID tin nhắn ─────────────────────────────────────────────────────────
function msgId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ─── Gửi TCP message đến một peer ────────────────────────────────────────────
function sendTCP(host, port, payload) {
  return new Promise((resolve) => {
    const socket = net.connect(port, host, () => {
      socket.write(JSON.stringify(payload) + '\n');
    });
    socket.on('data', () => {}); // Bỏ qua ACK (broadcaster không cần track)
    socket.on('close', resolve);
    socket.on('error', resolve); // Bỏ qua lỗi kết nối
    setTimeout(() => { try { socket.destroy(); } catch (_) {} resolve(); }, 5000);
  });
}

// ─── Lấy danh sách peer online ───────────────────────────────────────────────
async function getPeers() {
  try {
    const res = await axios.get(`${config.BOOTSTRAP}/peers`);
    return res.data.peers || [];
  } catch (_) {
    return [];
  }
}

// ─── Gửi heartbeat định kỳ ───────────────────────────────────────────────────
async function sendHeartbeat() {
  try {
    await axios.post(`${config.BOOTSTRAP}/heartbeat`, { id: config.PEER_ID });
  } catch (_) {}
}

// ─── Thông báo rời mạng ──────────────────────────────────────────────────────
async function leave() {
  try {
    await axios.post(`${config.BOOTSTRAP}/leave`, { id: config.PEER_ID });
  } catch (_) {}
}

// ─── Broadcast message tới tất cả peer đang online ───────────────────────────
let broadcastCount = 0;

async function doBroadcast() {
  broadcastCount++;
  const peers = await getPeers();
  const others = peers.filter(p => p.id !== config.PEER_ID);

  if (others.length === 0) {
    console.log(`\x1b[90m[${config.PEER_NAME}]\x1b[0m \x1b[33mBroadcast #${broadcastCount}: không có peer nào online.\x1b[0m`);
    return;
  }

  const content = `[Broadcast #${broadcastCount}] Hello từ ${config.PEER_NAME}! Mạng P2P hoạt động ổn định. (${new Date().toLocaleTimeString('vi-VN')})`;
  console.log(`\x1b[90m[${config.PEER_NAME}]\x1b[0m \x1b[96m→ Broadcast #${broadcastCount} đến ${others.length} peer: ${others.map(p => p.name).join(', ')}\x1b[0m`);

  // Gửi đến từng peer song song
  await Promise.all(others.map(target => {
    const payload = {
      type: 'BROADCAST',
      id: msgId(),
      from: config.PEER_ID,
      content,
      timestamp: Date.now(),
    };
    return sendTCP(target.host, target.port, payload).then(() => {
      console.log(`\x1b[90m[${config.PEER_NAME}]\x1b[0m   \x1b[32m✓ Sent to ${target.name} (${target.host}:${target.port})\x1b[0m`);
    });
  }));
}

// ─── TCP Server để nhận ACK từ peer khác ─────────────────────────────────────
let tcpServer;

function startTcpServer() {
  tcpServer = net.createServer(socket => {
    let buf = '';
    socket.on('data', chunk => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'BROADCAST') {
            // Gửi ACK lại
            const ack = { type: 'ACK', id: msg.id, from: config.PEER_ID };
            if (socket.writable) socket.write(JSON.stringify(ack) + '\n');
            console.log(`\x1b[90m[${config.PEER_NAME}]\x1b[0m \x1b[36m[RECV] ${msg.type} from ${msg.from}\x1b[0m`);
          }
        } catch (_) {}
      }
    });
    socket.on('error', () => {});
  });

  tcpServer.on('error', err => {
    console.error(`\x1b[31m[ERROR]\x1b[0m TCP server: ${err.message}`);
    process.exit(1);
  });

  return new Promise(resolve => {
    tcpServer.listen(config.PEER_PORT, config.PEER_HOST, resolve);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  await startTcpServer();

  // Đăng ký với Bootstrap
  try {
    await axios.post(`${config.BOOTSTRAP}/register`, {
      id: config.PEER_ID, name: config.PEER_NAME,
      host: config.PEER_HOST, port: config.PEER_PORT,
    });
    console.log(`\x1b[32m[${config.PEER_NAME}]\x1b[0m \x1b[32m[OK] Đã đăng ký với Bootstrap @ ${config.BOOTSTRAP}\x1b[0m`);
    console.log(`\x1b[32m[${config.PEER_NAME}]\x1b[0m Sẽ broadcast mỗi ${config.INTERVAL_MS / 1000}s. Nhấn Ctrl+C để dừng.\n`);
  } catch (e) {
    console.error(`\x1b[31m[ERROR]\x1b[0m Không thể kết nối Bootstrap: ${e.message}`);
    process.exit(1);
  }

  // Broadcast ngay lần đầu sau 2 giây (cho các peer khác kịp khởi động)
  setTimeout(doBroadcast, 2000);

  // Broadcast định kỳ
  const broadcastTimer = setInterval(doBroadcast, config.INTERVAL_MS);

  // Heartbeat mỗi 5 giây
  const heartbeatTimer = setInterval(sendHeartbeat, 5000);

  // Graceful shutdown
  async function shutdown() {
    console.log(`\n\x1b[90m[${config.PEER_NAME}]\x1b[0m Đang rời mạng...`);
    clearInterval(broadcastTimer);
    clearInterval(heartbeatTimer);
    await leave();
    tcpServer.close(() => {
      console.log(`\x1b[90m[${config.PEER_NAME}]\x1b[0m Đã rời mạng.`);
      process.exit(0);
    });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('\x1b[31m[FATAL]\x1b[0m', err.message);
  process.exit(1);
});
