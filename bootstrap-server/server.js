/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  server.js — Bootstrap Server (Máy chủ khởi tạo mạng P2P)  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * VAI TRÒ: Đây là máy chủ trung tâm DUY NHẤT trong hệ thống.
 *   - Lưu danh sách địa chỉ (host:port) của các peer đang online.
 *   - KHÔNG bao giờ chuyển tiếp tin nhắn chat.
 *   - Tin nhắn chat đi TRỰC TIẾP giữa các peer qua TCP.
 *
 * TẠI SAO CẦN BOOTSTRAP?
 *   Trong mạng P2P thuần túy, khi một peer mới tham gia, nó không biết
 *   ai đang online. Bootstrap Server giải quyết vấn đề "khám phá peer"
 *   (Peer Discovery) — tương tự như danh bạ điện thoại.
 *
 * CÁCH HOẠT ĐỘNG:
 *   1. Peer A khởi động → gọi POST /register → Bootstrap lưu địa chỉ A
 *   2. Peer B khởi động → gọi POST /register → Bootstrap lưu địa chỉ B
 *   3. Peer A muốn chat với B → gọi GET /peers → nhận địa chỉ B
 *   4. Peer A kết nối TRỰC TIẾP tới B qua TCP (không qua Bootstrap nữa)
 *   5. Mỗi 5 giây, peer gọi POST /heartbeat để báo "tôi vẫn còn sống"
 *   6. Peer tắt → gọi POST /leave HOẶC không heartbeat → tự động bị xóa
 *
 * CÁCH CHẠY:
 *   cd bootstrap-server
 *   npm install
 *   node server.js
 */

'use strict'; // Bật chế độ strict — ngăn các lỗi ngầm (undeclared variables, etc.)

// ─── Import thư viện ──────────────────────────────────────────────────────────

// express: framework web phổ biến nhất cho Node.js, giúp tạo REST API dễ dàng
const express  = require('express');

// peerRegistry: module tự viết, quản lý Map danh sách peer (file peerRegistry.js)
const registry = require('./peerRegistry');

// ─── Khởi tạo Express app ─────────────────────────────────────────────────────

const app  = express(); // Tạo instance của Express application

// Đọc PORT từ biến môi trường (nếu có), nếu không thì dùng 3000
// process.env.PORT cho phép deploy lên cloud (Heroku, Railway...) dễ dàng
const PORT = process.env.PORT || 3000;

// ─── Middleware toàn cục ──────────────────────────────────────────────────────

// express.json() giúp Express tự động parse body của request dạng JSON
// Nếu không có dòng này, req.body sẽ là undefined
app.use(express.json());

// Middleware logging: in ra mỗi request đến để dễ debug
// next() phải được gọi để chuyển sang middleware/route handler tiếp theo
app.use((req, res, next) => {
  const time = new Date().toISOString(); // Thời gian hiện tại theo chuẩn ISO 8601
  console.log(`[${time}] ${req.method} ${req.path}`, req.body || '');
  next(); // Tiếp tục xử lý — nếu không gọi next(), request sẽ bị "treo"
});

// ─── Route: POST /register ────────────────────────────────────────────────────
// Peer gọi khi vừa khởi động để thông báo "tôi đang online tại địa chỉ này"
// Request body: { id: string, name: string, host: string, port: number }
app.post('/register', (req, res) => {
  // Destructuring assignment: lấy các field từ request body
  const { id, name, host, port } = req.body;

  // Validation: kiểm tra đủ 4 trường bắt buộc
  // Toán tử ! biến đổi: undefined/null/0/"" → true (falsy → not provided)
  if (!id || !name || !host || !port) {
    // HTTP 400 Bad Request: client gửi dữ liệu thiếu/sai
    return res.status(400).json({ error: 'Missing required fields: id, name, host, port' });
  }

  // Lưu peer vào registry (Map trong bộ nhớ)
  registry.register(id, name, host, port);
  console.log(`  ✅ Peer registered: ${id} (${name}) @ ${host}:${port}`);
  console.log(`  📋 Total peers: ${registry.count()}`);

  // Kiểm tra xem có tin nhắn offline nào đang chờ không
  // popMessages() lấy và xóa khỏi queue — mỗi tin chỉ gửi 1 lần
  const pending = registry.popMessages(id);
  if (pending.length > 0) {
    console.log(`  📦 Delivering ${pending.length} offline message(s) to ${id}`);
  }

  // HTTP 200 OK + JSON response (có kèm pendingMessages nếu có)
  res.json({
    ok: true,
    message: `Peer ${id} registered successfully`,
    pendingMessages: pending, // Mảng rỗng nếu không có tin offline
  });
});

// ─── Route: GET /peers ────────────────────────────────────────────────────────
// Peer gọi để lấy danh sách tất cả peer đang online
// Không cần body — chỉ là GET request đơn thuần
// Response: { peers: [{ id, name, host, port, lastSeen }, ...] }
app.get('/peers', (req, res) => {
  // getOnlinePeers() lọc ra những peer có lastSeen ≤ 15 giây
  // Đồng thời xóa luôn các peer đã timeout khỏi Map
  const onlinePeers = registry.getOnlinePeers();
  res.json({ peers: onlinePeers });
});

// ─── Route: POST /heartbeat ───────────────────────────────────────────────────
// Peer gọi mỗi 5 giây để báo hiệu "tôi vẫn đang online"
// Nếu không heartbeat trong 15 giây → bị coi là offline và tự động xóa
// Request body: { id: string }
app.post('/heartbeat', (req, res) => {
  const { id } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Missing required field: id' });
  }

  // heartbeat() trả về false nếu peer chưa đăng ký
  const ok = registry.heartbeat(id);
  if (!ok) {
    // HTTP 404 Not Found: peer gửi heartbeat nhưng chưa register
    return res.status(404).json({ error: `Peer ${id} not found. Please /register first.` });
  }

  res.json({ ok: true });
});

// ─── Route: POST /store ──────────────────────────────────────────────────
// Store-and-Forward: Lưu tin nhắn cho peer hiện đang offline.
// Peer gửi gọi endpoint này khi tin nhắn thất bại (FAILED sau 3 retry).
// Khi peer nhận đăng ký lại (POST /register), tin sẽ được trả về trong response.
// Request body: { to: string, from: string, payload: object }
app.post('/store', (req, res) => {
  const { to, from, payload } = req.body;

  if (!to || !from || !payload) {
    return res.status(400).json({ error: 'Missing required fields: to, from, payload' });
  }

  // Kiểm tra peer nhận có đang online không
  // Nếu đang online: không cần lưu offline — peer nên gửi TCP trực tiếp
  const onlinePeers = registry.getOnlinePeers();
  const isOnline = onlinePeers.some(p => p.id === to);
  if (isOnline) {
    return res.status(409).json({
      error: `Peer ${to} is currently online. Send directly via TCP instead.`,
      hint: 'Use TCP direct connection for online peers',
    });
  }

  const queueSize = registry.storeMessage(to, from, payload);
  console.log(`  📥 [Store-Forward] Message stored for offline peer ${to} (queue: ${queueSize})`);

  res.json({
    ok: true,
    message: `Message queued for ${to}. Will be delivered when peer comes online.`,
    queueSize,
  });
});

// ─── Route: POST /leave ───────────────────────────────────────────────────────
// Peer gọi khi tắt có chủ ý (graceful shutdown: /exit hoặc Ctrl+C)
// Giúp danh sách online được cập nhật ngay lập tức
// Khác với timeout: timeout phải chờ đến 15 giây mới tự xóa
// Request body: { id: string }
app.post('/leave', (req, res) => {
  const { id } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Missing required field: id' });
  }

  // Xóa peer khỏi registry ngay lập tức
  registry.leave(id);
  console.log(`  👋 Peer ${id} left the network`);
  console.log(`  📋 Total peers: ${registry.count()}`);

  res.json({ ok: true, message: `Peer ${id} removed` });
});

// ─── Route: GET / — Health Check ─────────────────────────────────────────────
// Dùng để kiểm tra server đang chạy hay không (monitoring, test)
// Không có logic nghiệp vụ — chỉ trả về thông tin tổng quan
app.get('/', (req, res) => {
  const queueStats = registry.getQueueStats();
  res.json({
    service          : 'P2P Chat Bootstrap Server',
    status           : 'running',
    peers_online     : registry.getOnlinePeers().length,
    offline_queue    : queueStats,          // Thống kê store-and-forward queue
    endpoints        : ['/register', '/peers', '/heartbeat', '/leave', '/store'],
  });
});

// ─── Khởi động server ─────────────────────────────────────────────────────────

// Gọi startPeriodicCleanup() một lần duy nhất khi server bắt đầu
// Tạo setInterval chạy mỗi 10s để dọn dẹp peer timeout
// (Khác với getOnlinePeers() chỉ cleanup khi có request đến)
registry.startPeriodicCleanup();

// Bắt đầu lắng nghe kết nối trên PORT đã cấu hình
// Callback được gọi khi server đã sẵn sàng nhận request
app.listen(PORT, () => {
  // Banner thông tin khi khởi động thành công
  console.log('╔══════════════════════════════════════════╗');
  console.log('║     P2P Chat — Bootstrap Server          ║');
  console.log(`║     Listening on port ${PORT}               ║`);
  console.log('║     Role: Peer Discovery / Tracker ONLY  ║');
  console.log('║     Messages go DIRECTLY peer-to-peer    ║');
  console.log('╚══════════════════════════════════════════╝');
});
