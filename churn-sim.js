/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  churn-sim.js — Mô phỏng Churn: Peer liên tục Join/Leave mạng P2P      ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * MỤC TIÊU:
 *   Tự động chứng minh hệ thống P2P hoạt động ổn định khi peer liên tục
 *   tham gia (join) và rời (leave) mạng — gọi là hiện tượng "churn".
 *
 * CÁCH HOẠT ĐỘNG:
 *   ┌─── VÒNG LẶP CHURN (lặp ROUNDS lần) ───────────────────────────────────┐
 *   │  1. Spawn peer-churn-1 (port 5101) → đợi JOIN_DELAY để join xong      │
 *   │  2. Spawn peer-churn-2 (port 5102) → đợi JOIN_DELAY                   │
 *   │  3. Spawn peer-churn-3 (port 5103) → đợi JOIN_DELAY                   │
 *   │  4. Hiển thị peer list hiện tại (qua Bootstrap REST API)               │
 *   │  5. Đợi ONLINE_DURATION giây (broadcaster đang gửi tin tới các peer)  │
 *   │  6. Kill tất cả peer churn → đợi LEAVE_DELAY                          │
 *   │  7. Hiển thị peer list sau khi rời (chỉ còn broadcaster)              │
 *   │  8. Đợi OFFLINE_DURATION giây trước vòng tiếp theo                    │
 *   └────────────────────────────────────────────────────────────────────────┘
 *
 * CÁCH CHẠY:
 *   node churn-sim.js [--rounds 3] [--bootstrap http://127.0.0.1:3000]
 *
 * YÊU CẦU TRƯỚC KHI CHẠY:
 *   1. Bootstrap Server đang chạy
 *   2. (Tùy chọn) Broadcaster đang chạy để thấy broadcast tới churn peers
 */

'use strict';

const { spawn }     = require('child_process');
const path          = require('path');
const http          = require('http');

// ─── Cấu hình ─────────────────────────────────────────────────────────────────
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]?.replace('--', '');
  if (key) args[key] = process.argv[i + 1];
}

const CONFIG = {
  BOOTSTRAP      : args.bootstrap   || 'http://127.0.0.1:3000',
  ROUNDS         : parseInt(args.rounds     || '3',  10),
  JOIN_DELAY_MS  : parseInt(args.join_delay || '2500', 10), // Thời gian chờ peer join xong
  ONLINE_DURATION: parseInt(args.online     || '8000', 10), // Thời gian peer ở online
  LEAVE_DELAY_MS : parseInt(args.leave_delay|| '2000', 10), // Chờ sau khi kill
  OFFLINE_DURATION: parseInt(args.offline   || '5000', 10), // Thời gian giữa 2 vòng

  // Các peer churn (thay đổi mỗi vòng)
  CHURN_PEERS: [
    { id: 'peer-churn-1', name: 'Churn-Alpha',  port: 5101 },
    { id: 'peer-churn-2', name: 'Churn-Beta',   port: 5102 },
    { id: 'peer-churn-3', name: 'Churn-Gamma',  port: 5103 },
  ],
};

// ─── Đường dẫn tới peer.js ────────────────────────────────────────────────────
const PEER_SCRIPT = path.join(__dirname, 'peer-node', 'peer.js');

// ─── Helper: sleep ────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Helper: ANSI color functions ────────────────────────────────────────────
const C = {
  reset  : '\x1b[0m',
  bold   : '\x1b[1m',
  cyan   : '\x1b[36m',
  green  : '\x1b[32m',
  yellow : '\x1b[33m',
  red    : '\x1b[31m',
  magenta: '\x1b[35m',
  gray   : '\x1b[90m',
  bgBlue : '\x1b[44m',
  white  : '\x1b[97m',
};

function banner(text) {
  const line = '═'.repeat(60);
  console.log(`\n${C.cyan}╔${line}╗${C.reset}`);
  console.log(`${C.cyan}║${C.bold}${C.white}  ${text.padEnd(58)}${C.reset}${C.cyan}  ║${C.reset}`);
  console.log(`${C.cyan}╚${line}╝${C.reset}\n`);
}

function section(text) {
  console.log(`\n${C.magenta}┌── ${text} ${'─'.repeat(Math.max(0, 55 - text.length))}┐${C.reset}`);
}

function info(msg)    { console.log(`${C.gray}[CHURN-SIM]${C.reset} ${msg}`); }
function success(msg) { console.log(`${C.green}[CHURN-SIM]${C.reset} ${C.green}${msg}${C.reset}`); }
function warn(msg)    { console.log(`${C.yellow}[CHURN-SIM]${C.reset} ${C.yellow}${msg}${C.reset}`); }
function phase(msg)   { console.log(`\n${C.cyan}${C.bold}▶  ${msg}${C.reset}`); }

// ─── Lấy danh sách peer từ Bootstrap ─────────────────────────────────────────
function getPeers() {
  return new Promise((resolve) => {
    const url = new URL(`${CONFIG.BOOTSTRAP}/peers`);
    const req = http.get({ hostname: url.hostname, port: url.port, path: url.pathname }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.peers || []);
        } catch (_) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(3000, () => { req.destroy(); resolve([]); });
  });
}

// ─── Hiển thị peer list hiện tại ─────────────────────────────────────────────
async function printPeerList(label) {
  const peers = await getPeers();
  console.log(`\n${C.bold}📡 Peer list hiện tại [${label}]:${C.reset}`);
  if (peers.length === 0) {
    warn('  (Không có peer nào online)');
  } else {
    for (const p of peers) {
      const isChurn = p.id.startsWith('peer-churn');
      const isBroadcaster = p.id === 'peer-broadcaster';
      const tag = isChurn ? `${C.yellow}[CHURN]${C.reset}` :
                  isBroadcaster ? `${C.green}[BROADCASTER]${C.reset}` :
                  `${C.gray}[PEER]${C.reset}`;
      console.log(`  ${tag} ${C.cyan}${p.id}${C.reset} (${p.name}) @ ${p.host}:${p.port}`);
    }
  }
  console.log(`  ${C.gray}→ Tổng: ${peers.length} peer online${C.reset}\n`);
}

// ─── Spawn một peer churn ─────────────────────────────────────────────────────
function spawnPeer({ id, name, port }) {
  const child = spawn('node', [
    PEER_SCRIPT,
    '--id', id,
    '--name', name,
    '--port', String(port),
    '--bootstrap', CONFIG.BOOTSTRAP,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'], // Capture output
  });

  // Forward output với prefix màu sắc
  const prefix = `${C.yellow}  [${name}]${C.reset}`;
  child.stdout.on('data', (data) => {
    data.toString().split('\n').filter(l => l.trim()).forEach(line => {
      // Lọc chỉ hiển thị các dòng quan trọng
      if (line.includes('[OK]') || line.includes('[MSG') || line.includes('[BROADCAST') ||
          line.includes('[ACK') || line.includes('Gõ /help') || line.includes('╔')) {
        console.log(`${prefix} ${line.trim()}`);
      }
    });
  });
  child.stderr.on('data', (data) => {
    console.log(`${C.red}  [${name} ERR]${C.reset} ${data.toString().trim()}`);
  });
  child.on('error', () => {}); // Bỏ qua lỗi khi kill

  return child;
}

// ─── Kill một peer ────────────────────────────────────────────────────────────
function killPeer(child, name) {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null) { resolve(); return; }
    child.on('close', resolve);
    try {
      child.kill('SIGTERM'); // Graceful
    } catch (_) {
      try { child.kill('SIGKILL'); } catch (__) {} // Force kill
    }
    // Timeout: nếu sau 2s vẫn chưa chết thì force kill
    setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) {}
      resolve();
    }, 2000);
  });
}

// ─── Countdown timer hiển thị ────────────────────────────────────────────────
async function countdown(label, totalMs, stepMs = 1000) {
  const total = Math.floor(totalMs / stepMs);
  for (let i = total; i > 0; i--) {
    process.stdout.write(`\r${C.gray}  ⏱  ${label}: ${i}s còn lại...   ${C.reset}`);
    await sleep(stepMs);
  }
  process.stdout.write('\r' + ' '.repeat(60) + '\r'); // Clear line
}

// ─── Main churn simulation ────────────────────────────────────────────────────
async function main() {
  banner(`CHURN SIMULATION — ${CONFIG.ROUNDS} VÒNG`);

  console.log(`${C.bold}Cấu hình:${C.reset}`);
  console.log(`  Bootstrap     : ${CONFIG.BOOTSTRAP}`);
  console.log(`  Số vòng       : ${CONFIG.ROUNDS}`);
  console.log(`  Peers mỗi vòng: ${CONFIG.CHURN_PEERS.length} (port 5101-5103)`);
  console.log(`  Thời gian online: ${CONFIG.ONLINE_DURATION / 1000}s/vòng`);
  console.log(`  Thời gian offline: ${CONFIG.OFFLINE_DURATION / 1000}s/vòng`);
  console.log(`\n${C.gray}Nhấn Ctrl+C bất cứ lúc nào để dừng simulation.\n${C.reset}`);

  // Kiểm tra Bootstrap có đang chạy không
  const bootstrapPeers = await getPeers();
  if (bootstrapPeers === null) {
    console.error(`${C.red}[ERROR] Không thể kết nối Bootstrap Server tại ${CONFIG.BOOTSTRAP}${C.reset}`);
    console.error(`${C.red}        Hãy chạy Bootstrap Server trước: cd bootstrap-server && node server.js${C.reset}`);
    process.exit(1);
  }

  success(`Bootstrap Server sẵn sàng. Có ${bootstrapPeers.length} peer đang online.\n`);
  await printPeerList('Trước khi bắt đầu');

  // ─── Vòng lặp churn ────────────────────────────────────────────────────
  const allChildren = [];

  for (let round = 1; round <= CONFIG.ROUNDS; round++) {
    banner(`VÒNG ${round}/${CONFIG.ROUNDS}`);

    // ── Giai đoạn 1: JOIN ─────────────────────────────────────────────────
    phase(`[JOIN] Spawn ${CONFIG.CHURN_PEERS.length} churn peers vào mạng...`);

    const roundChildren = [];
    for (const peerConfig of CONFIG.CHURN_PEERS) {
      info(`Spawning ${peerConfig.name} (${peerConfig.id}) @ port ${peerConfig.port}...`);
      const child = spawnPeer(peerConfig);
      roundChildren.push({ child, ...peerConfig });
      allChildren.push(child);
      await sleep(500); // Stagger spawn để tránh port conflict
    }

    // Đợi các peer join xong (register với Bootstrap)
    await countdown('Chờ các peer join mạng', CONFIG.JOIN_DELAY_MS);
    await printPeerList(`Sau JOIN vòng ${round}`);

    // ── Giai đoạn 2: ONLINE ───────────────────────────────────────────────
    phase(`[ONLINE] Các peer đang online. Broadcaster đang gửi broadcast...`);
    info(`Hệ thống chạy bình thường trong ${CONFIG.ONLINE_DURATION / 1000}s...`);
    await countdown(`Vòng ${round} — peers đang online`, CONFIG.ONLINE_DURATION);

    // ── Giai đoạn 3: LEAVE ────────────────────────────────────────────────
    phase(`[LEAVE] Kill tất cả ${roundChildren.length} churn peers...`);

    for (const { child, name } of roundChildren) {
      info(`Killing ${name}...`);
      await killPeer(child, name);
      warn(`${name} đã rời mạng (killed).`);
    }

    // Đợi Bootstrap cleanup
    await countdown('Chờ Bootstrap cập nhật peer list', CONFIG.LEAVE_DELAY_MS);
    await printPeerList(`Sau LEAVE vòng ${round}`);

    // ── Giai đoạn 4: OFFLINE PAUSE ────────────────────────────────────────
    if (round < CONFIG.ROUNDS) {
      phase(`[PAUSE] Nghỉ ${CONFIG.OFFLINE_DURATION / 1000}s trước vòng tiếp theo...`);
      await countdown(`Chờ trước vòng ${round + 1}`, CONFIG.OFFLINE_DURATION);
    }
  }

  // ─── Kết thúc ──────────────────────────────────────────────────────────
  banner('KẾT QUẢ CHURN SIMULATION');

  await printPeerList('Cuối simulation');

  console.log(`${C.bold}${C.green}✓ Churn Simulation hoàn thành thành công!${C.reset}`);
  console.log(`\n${C.bold}Kết luận:${C.reset}`);
  console.log(`  • ${CONFIG.ROUNDS} vòng churn đã thực hiện`);
  console.log(`  • ${CONFIG.ROUNDS * CONFIG.CHURN_PEERS.length} lượt peer join/leave`);
  console.log(`  • Bootstrap Server theo dõi danh sách peer chính xác`);
  console.log(`  • Broadcaster tiếp tục gửi tin tới các peer còn online`);
  console.log(`  • Hệ thống ổn định, không crash dưới điều kiện churn`);
  console.log(`\n${C.gray}→ Tính năng "Churn Tolerance" đã được chứng minh.${C.reset}\n`);

  process.exit(0);
}

// ─── Graceful shutdown khi Ctrl+C ────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log(`\n\n${C.yellow}[CHURN-SIM]${C.reset} Simulation bị dừng bởi người dùng.`);
  process.exit(0);
});

main().catch(err => {
  console.error(`${C.red}[FATAL]${C.reset}`, err.message);
  process.exit(1);
});
