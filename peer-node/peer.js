/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  peer.js — Entry Point của Peer Node (Điểm nối mạng P2P)   ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * ĐÂY LÀ FILE TRUNG TÂM của toàn bộ peer node.
 * Nhiệm vụ DUY NHẤT: kết nối (wire) tất cả module lại với nhau.
 *
 * KIẾN TRÚC TỔNG QUAN:
 *
 *   [Bootstrap Server] ←── HTTP ──→ [bootstrapClient.js]
 *                                            │
 *                   [peer.js: Entry Point]   │ getPeers/register/heartbeat
 *                      │                    │
 *            ┌─────────┴──────────┐         │
 *            ▼                    ▼         │
 *   [tcpServer.js]         [tcpClient.js]   │
 *   Nhận tin từ peer        Gửi tin tới peer
 *            │                    │
 *            └────── onMessage / onResponse ──→ [messageHandler.js]
 *                                                      │
 *                                              [state.js] (pendingAcks, receivedMsgIds)
 *            [cli.js] ──── sendWithAck ──→ [reliableDelivery.js]
 *                                                    │
 *                                             [tcpClient.js]
 *
 * DEPENDENCY INJECTION (DI):
 *   Thứ tự khởi tạo quan trọng để tránh circular dependency:
 *
 *   Step 1: handleMessage = createHandler(peerId)
 *     → messageHandler cần peerId để gửi ACK với đúng "from"
 *
 *   Step 2: sendTCP = createSendTCP(handleMessage)
 *     → tcpClient cần handleMessage để xử lý response (ACK nhận được)
 *     → Nếu import messageHandler trực tiếp → circular dep
 *     → Giải pháp: inject qua tham số
 *
 *   Step 3: { sendWithAck } = createReliableDelivery(sendTCP)
 *     → reliableDelivery cần sendTCP để thực sự gửi tin
 *
 *   Step 4: bootstrap = createBootstrapClient(config)
 *     → Chỉ cần config — không phụ thuộc module khác
 *
 *   Step 5: tcpServer = createTcpServer(handleMessage)
 *     → tcpServer cần handleMessage để xử lý tin đến
 *
 *   Step 6: createCLI(config, { getPeers, sendWithAck, ... })
 *     → CLI cần getPeers và sendWithAck để thực thi lệnh người dùng
 *
 *   Step 7: logger.setRl(rl)
 *     → PHẢI gọi SAU createCLI để logger biết cách prompt lại
 *
 * CÁCH CHẠY:
 *   node peer.js --id peer-a --name Alice --port 5001
 *   node peer.js --id peer-b --name Bob   --port 5002
 *   node peer.js --id peer-c --name Carol --port 5003 --bootstrap http://127.0.0.1:3000
 */

'use strict';

// ─── Import tất cả module ──────────────────────────────────────────────────────
const logger                    = require('./logger');           // log(), setRl(), msgId()
const { createTcpServer }       = require('./tcpServer');        // Factory: TCP server nhận tin
const { createSendTCP }         = require('./tcpClient');        // Factory: TCP client gửi tin
const { createHandler }         = require('./messageHandler');   // Factory: xử lý message
const { createReliableDelivery } = require('./reliableDelivery'); // Factory: ACK + retry
const { createBootstrapClient } = require('./bootstrapClient'); // Factory: HTTP client bootstrap
const { createCLI }             = require('./cli');              // Factory: CLI readline

// ─── Parse CLI arguments ──────────────────────────────────────────────────────
/**
 * Hàm parse các argument dòng lệnh kiểu --key value.
 * Ví dụ: "node peer.js --id peer-a --name Alice --port 5001"
 * → { id: 'peer-a', name: 'Alice', port: '5001' }
 *
 * Sử dụng vòng lặp đơn giản thay vì thư viện như yargs/commander
 * để không cần thêm dependency. Phù hợp với argument format đơn giản.
 *
 * @returns {object}  { id, name, port, host, bootstrap }
 */
function parseArgs() {
  // process.argv: mảng string chứa command line arguments
  // Ví dụ: ['node', 'peer.js', '--id', 'peer-a', '--name', 'Alice', '--port', '5001']
  // .slice(2): bỏ 2 phần tử đầu ('node' và 'peer.js')
  const args = process.argv.slice(2);
  const result = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      // args[i] = '--id', args[i+1] = 'peer-a'
      result[args[i].slice(2)] = args[i + 1]; // { id: 'peer-a' }
      i++; // Nhảy qua value (đã đọc rồi)
    }
  }
  return result;
}

const args = parseArgs();

// ─── Cấu hình peer ────────────────────────────────────────────────────────────
// Mỗi giá trị ưu tiên: argument > default
// Ví dụ: PEER_ID = args.id || 'peer-123456789' (fallback nếu không truyền --id)
const config = {
  PEER_ID        : args.id         || `peer-${Date.now()}`,  // ID duy nhất trong mạng
  PEER_NAME      : args.name       || (args.id || `peer-${Date.now()}`), // Tên hiển thị
  PEER_PORT      : Number(args.port) || 5001,  // Port TCP lắng nghe
  PEER_HOST      : args.host       || '127.0.0.1', // IP bind
  BOOTSTRAP      : args.bootstrap  || 'http://127.0.0.1:3000', // URL bootstrap server
  ENCRYPTION_KEY : args.key        || null, // Pre-shared key cho AES-256 (null = không mã hóa)
};

// ─── Khởi tạo các module theo thứ tự DI ─────────────────────────────────────────

// Step 1: Tạo message handler với peerId và encryption key của peer này
// Truyền ENCRYPTION_KEY để handler có thể giải mã tin nhắn nhận được
const handleMessage = createHandler(config.PEER_ID, config.ENCRYPTION_KEY);

// Step 2: Tạo sendTCP với handleMessage làm onResponse
// Khi peer đích gửi ACK → sendTCP nhận trên socket → gọi handleMessage(ACK)
const sendTCP = createSendTCP(handleMessage);

// Step 3: Tạo bootstrap HTTP client với config đầy đủ
// Cần tạo TRƯỚC reliableDelivery để có thể inject bootstrap.storeMessage vào dưới
const bootstrap = createBootstrapClient(config);

// Step 4: Tạo reliable delivery với sendTCP và storeAndForward đã inject
// storeAndForward = bootstrap.storeMessage: khi FAILED sau 3 retry → tự động lưu lên Bootstrap
// → peer nhận sẽ được nhận lúc online trở lại (qua /register response)
const { sendWithAck } = createReliableDelivery(sendTCP, bootstrap.storeMessage);

// Step 5: Tạo TCP server với handleMessage làm onMessage
// Khi peer khác kết nối và gửi CHAT/GROUP/BROADCAST → gọi handleMessage(msg, socket)
const tcpServer = createTcpServer(handleMessage);

// ─── Biến lưu heartbeat timer ──────────────────────────────────────────────────
// Cần lưu để có thể clearInterval() khi user gõ /exit hoặc Ctrl+C
let heartbeatTimer;

// ─── Hàm main khởi động peer ─────────────────────────────────────────────────
/**
 * Async main function — thực hiện tuần tự các bước khởi động.
 * Dùng async/await để các bước phụ thuộc nhau thực thi đúng thứ tự.
 */
async function main() {

  // ── Bước 1: Khởi động TCP server ──────────────────────────────────────
  // Bọc trong Promise để async/await (server.listen dùng callback, không phải Promise)
  // reject được gọi nếu port đã bị chiếm (EADDRINUSE)
  await new Promise((resolve, reject) => {
    tcpServer.listen(config.PEER_PORT, config.PEER_HOST, resolve);
    tcpServer.on('error', reject);
  });

  const W = 44; // Độ rộng nội dung bên trong hộp (không tính ║ hai bên)
  const pad = (s) => s + ' '.repeat(Math.max(0, W - s.replace(/\x1b\[[\d;]*m/g, '').length)) + '║';
  const encStatus = config.ENCRYPTION_KEY
    ? `\x1b[32mAES-256 ON\x1b[0m (key: ${'*'.repeat(config.ENCRYPTION_KEY.length)})`
    : `\x1b[90mKhông mã hóa (plaintext)\x1b[0m`;
  console.log('╔' + '═'.repeat(W) + '╗');
  console.log(pad(`║  Peer: \x1b[36m${config.PEER_NAME}\x1b[0m (${config.PEER_ID})`));
  console.log(pad(`║  TCP  : ${config.PEER_HOST}:${config.PEER_PORT}`));
  console.log(pad(`║  Boot : ${config.BOOTSTRAP}`));
  console.log(pad(`║  Mã hóa: ${encStatus}`));
  console.log('╚' + '═'.repeat(W) + '╝');
  console.log('Gõ \x1b[1m/help\x1b[0m để xem danh sách lệnh.\n');

  // ── Bước 2: Đăng ký với Bootstrap Server ─────────────────────────────
  // Phải đợi TCP server listen TRƯỚC khi register
  // Vì ngay sau register, peer khác có thể kết nối TCP tới
  await bootstrap.registerPeer();

  // ── Bước 3: Bắt đầu gửi heartbeat định kỳ ───────────────────────────
  // setInterval: gọi sendHeartbeat mỗi 5000ms (5 giây)
  // Heartbeat giữ peer trong danh sách online của Bootstrap
  // Bootstrap timeout peer sau 15s → 5s heartbeat = 3x safety margin
  heartbeatTimer = setInterval(bootstrap.sendHeartbeat, 5000);

  // ── Bước 4: Khởi động giao diện (CLI hoặc Web GUI) ─────────────────
  // Nếu có flag --gui → khởi động Web GUI (Express + Socket.IO)
  // Nếu không → khởi động CLI readline như trước
  const guiMode = args.gui === 'true' || args.gui === '1';

  const coreDeps = {
    getPeers        : bootstrap.getPeers,
    sendWithAck,
    leavePeer       : bootstrap.leavePeer,
    server          : tcpServer,
    getHeartbeatTimer: () => heartbeatTimer,
  };

  if (guiMode) {
    // ── Web GUI Mode ──────────────────────────────────────────────────
    const { startWebServer } = require('./webServer');
    startWebServer(config, coreDeps);
    // Không cần setRl() — GUI không dùng readline
  } else {
    // ── CLI Mode (mặc định) ───────────────────────────────────────────
    const rl = createCLI(config, coreDeps);

    // Bước 5: Gắn readline vào logger
    // PHẢI gọi SAU createCLI vì rl chưa tồn tại trước đó
    // Sau setRl: mỗi lần log() sẽ prompt lại — terminal không bị "mất" prompt
    logger.setRl(rl);

    // Bắt đầu hiển thị prompt (user có thể gõ lệnh ngay)
    rl.prompt();
  }

  // ── Bước 6: Xử lý Ctrl+C (SIGINT) ────────────────────────────────────
  // SIGINT: tín hiệu từ OS khi user nhấn Ctrl+C
  // Nếu không handle → Node.js thoát ngay mà không cleanup
  // Hệ quả: Bootstrap không biết peer đã offline → phải chờ 15s timeout
  process.on('SIGINT', async () => {
    logger.log('\nCtrl+C nhận được. Đang rời mạng...');

    clearInterval(heartbeatTimer);  // Dừng heartbeat
    await bootstrap.leavePeer();    // Thông báo Bootstrap: offline

    // Đóng TCP server, chờ callback xong thì exit
    tcpServer.close(() => {
      logger.log('Tạm biệt!');
      process.exit(0);
    });
  });
}

// ─── Chạy main ────────────────────────────────────────────────────────────────
// .catch() bắt lỗi không mong muốn (ví dụ: port đã bị chiếm)
// Hiển thị lỗi rõ ràng thay vì crash silent
main().catch((err) => {
  console.error('[FATAL]', err.message);
  process.exit(1); // Exit code 1 = lỗi
});
