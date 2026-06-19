/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  peerRegistry.js — Quản lý danh sách peer online             ║
 * ║                    + Offline Message Queue (Store-Forward)   ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * MODULE NÀY LÀM GÌ?
 *   Tách toàn bộ logic "lưu trữ và quản lý peer" ra khỏi server.js.
 *   server.js chỉ lo HTTP (nhận request, trả response).
 *   peerRegistry.js lo business logic (ai online, ai offline).
 *
 * CẤU TRÚC DỮ LIỆU:
 *   Dùng Map (không phải Object) vì:
 *     - Map cho phép bất kỳ kiểu key nào (string peerId ở đây)
 *     - Duyệt qua Map theo thứ tự chèn vào (predictable)
 *     - Có sẵn .delete(), .has(), .size để dùng trực tiếp
 *
 *   Map<peerId: string, { name, host, port, lastSeen }>
 *     ↑ key               ↑ value object
 *
 * PEER TIMEOUT:
 *   lastSeen: timestamp lần cuối peer gửi heartbeat
 *   Nếu now() - lastSeen > 15000ms → peer bị coi là offline
 *
 * KHÔNG CÓ DATABASE:
 *   Dữ liệu chỉ lưu trong RAM (biến `peers`).
 *   Khi server restart → danh sách bị xóa → mọi peer phải register lại.
 *   Đây là thiết kế đúng cho Peer Discovery — không cần lưu lâu dài.
 */

'use strict';

// Thời gian tối đa không heartbeat mà vẫn được coi là online: 15 giây
// Peer gửi heartbeat mỗi 5s → timeout = 3 lần miss heartbeat
const PEER_TIMEOUT_MS = 15000;

// Giới hạn số tin nhắn lưu cho mỗi peer offline
const MAX_OFFLINE_MSGS = 50;

// Thời gian tối đa giữ tin nhắn offline: 1 giờ
const MSG_TTL_MS = 60 * 60 * 1000;

// ─── Cơ sở dữ liệu trong bộ nhớ ───────────────────────────────────────────────
// Map là singleton: module Node.js được cache → mọi file require() cùng Map này
const peers = new Map();

// Offline message queue: lưu tin nhắn cho peer đang offline
// Map<peerId: string, Array<{ payload, storedAt, fromId }>>
const offlineQueue = new Map();

// ─── Hàm: Đăng ký peer mới ───────────────────────────────────────────────────
/**
 * Lưu thông tin peer vào Map. Nếu peerId đã tồn tại → ghi đè (update).
 * Điều này cho phép peer "rejoin" mà không cần xóa trước.
 *
 * @param {string} id    Mã định danh duy nhất (ví dụ: "peer-alice")
 * @param {string} name  Tên hiển thị (ví dụ: "Alice")
 * @param {string} host  Địa chỉ IP/hostname (ví dụ: "127.0.0.1")
 * @param {number} port  Cổng TCP peer đang lắng nghe (ví dụ: 5001)
 */
function register(id, name, host, port) {
  // Date.now() trả về Unix timestamp tính bằng milliseconds
  // Dùng để tính thời gian kể từ lần heartbeat cuối
  peers.set(id, { name, host, port: Number(port), lastSeen: Date.now() });
  // Number(port) để đảm bảo port là số nguyên, không phải string
}

// ─── Hàm: Lấy danh sách peer online ─────────────────────────────────────────
/**
 * Trả về mảng các peer còn trong thời hạn (lastSeen ≤ PEER_TIMEOUT_MS).
 * Đồng thời XÓA các peer đã hết hạn khỏi Map (cleanup kết hợp với đọc).
 *
 * Pattern này gọi là "lazy cleanup": không chạy cleanup riêng,
 * mà dọn dẹp ngay khi có người hỏi danh sách.
 *
 * @returns {Array<{id, name, host, port, lastSeen}>}
 */
function getOnlinePeers() {
  const now = Date.now(); // Lấy thời gian hiện tại một lần để nhất quán
  const online = [];      // Mảng kết quả sẽ trả về

  // Duyệt qua toàn bộ Map
  // for...of với Map trả về [key, value] pairs
  for (const [id, info] of peers.entries()) {
    if (now - info.lastSeen <= PEER_TIMEOUT_MS) {
      // Peer vẫn trong hạn → thêm vào kết quả
      // Spread operator: { id, name: "Alice", host: "127.0.0.1", port: 5001, lastSeen: ... }
      online.push({ id, ...info });
    } else {
      // Peer đã quá hạn → xóa khỏi Map và ghi log
      peers.delete(id);
      console.log(`  ⏰ Peer ${id} timed out and removed`);
    }
  }

  return online;
}

// ─── Hàm: Cập nhật heartbeat ─────────────────────────────────────────────────
/**
 * Cập nhật lastSeen của peer về thời điểm hiện tại.
 * Như "chạm vào" peer để nó không bị timeout.
 *
 * @param {string} id  Peer ID cần heartbeat
 * @returns {boolean}  true nếu thành công, false nếu peer không tồn tại
 */
function heartbeat(id) {
  if (!peers.has(id)) return false; // Peer chưa register → báo lỗi

  // peers.get(id) trả về object reference → sửa trực tiếp trên Map
  // Không cần peers.set() lại vì JavaScript object là pass-by-reference
  peers.get(id).lastSeen = Date.now();
  return true;
}

// ─── Hàm: Peer rời mạng ──────────────────────────────────────────────────────
/**
 * Xóa peer khỏi Map khi peer thông báo rời mạng (graceful shutdown).
 * Nhanh hơn timeout vì xóa ngay lập tức.
 *
 * @param {string} id  Peer ID cần xóa
 * @returns {boolean}  true nếu đã xóa được (peer tồn tại), false nếu không tìm thấy
 */
function leave(id) {
  return peers.delete(id); // Map.delete() trả về boolean
}

// ─── Hàm: Đếm số peer hiện tại ───────────────────────────────────────────────
/**
 * Đếm tất cả entry trong Map (bao gồm cả peer có thể đã timeout chưa cleanup).
 * Dùng để log thông tin nhanh, không cần độ chính xác tuyệt đối.
 *
 * @returns {number}
 */
function count() {
  return peers.size; // Map.size là property, không phải method (không có dấu ())
}

// ─── Hàm: Lưu tin nhắn cho peer offline (Store-and-Forward) ───────────────
/**
 * Lưu payload vào hàng đợi cho peer offline.
 * Khi peer đó online trở lại, tin nhắn sẽ được gựi về qua /register response.
 *
 * @param {string} toId    ID peer nhận (hiện offline)
 * @param {string} fromId  ID peer gửi
 * @param {object} payload Nội dung tin nhắn gốc (CHAT/GROUP_CHAT/BROADCAST object)
 * @returns {number} Số tin nhắn hiện đang trong queue của peer này
 */
function storeMessage(toId, fromId, payload) {
  if (!offlineQueue.has(toId)) {
    offlineQueue.set(toId, []);
  }

  const queue = offlineQueue.get(toId);

  // Giới hạn số tin nhắn lưu trữ — xóa tin cũ nhất nếu vượt giới hạn
  if (queue.length >= MAX_OFFLINE_MSGS) {
    queue.shift(); // Xóa phần tử đầu tiên (cũ nhất)
  }

  queue.push({
    payload,
    fromId,
    storedAt: Date.now(),
  });

  return queue.length;
}

// ─── Hàm: Lấy và xóa queue của peer ────────────────────────────────────────
/**
 * Lấy tất cả tin nhắn offline của peer và XÓA khỏi queue.
 * Được gọi khi peer đăng ký trở lại (POST /register).
 *
 * @param {string} peerId  ID peer vừa online
 * @returns {Array<{ payload, fromId, storedAt }>}  Mảng tin nhắn (rỗng nếu không có)
 */
function popMessages(peerId) {
  if (!offlineQueue.has(peerId)) return [];

  const messages = offlineQueue.get(peerId);
  offlineQueue.delete(peerId); // Xóa queue sau khi đã lấy ra
  return messages;
}

// ─── Hàm: Thống kê queue ───────────────────────────────────────────────────
/**
 * Trả về thông kê về offline queue (để hiển thị trong health check).
 * @returns {{ totalPeers: number, totalMessages: number }}
 */
function getQueueStats() {
  let total = 0;
  for (const queue of offlineQueue.values()) total += queue.length;
  return { totalPeers: offlineQueue.size, totalMessages: total };
}

// ─── Hàm: Khởi động dọn dẹp định kỳ ───────────────────────────────────────────
/**
 * Tạo setInterval chạy mỗi 10 giây để tự động xóa peer timeout.
 * Ngoài ra: dịn tin nhắn offline quá hạn (TTL = 1 giờ).
 *
 * CảNH BÁO: Chỉ gọi hàm này MỘT LẦN khi server khởi động.
 */
function startPeriodicCleanup() {
  setInterval(() => {
    const now = Date.now();

    // Dịn peer timeout
    for (const [id, info] of peers.entries()) {
      if (now - info.lastSeen > PEER_TIMEOUT_MS) {
        peers.delete(id);
        console.log(`  ⏰ [Cleanup] Peer ${id} timed out and removed`);
      }
    }

    // Dịn tin nhắn offline quá TTL (1 giờ)
    for (const [peerId, queue] of offlineQueue.entries()) {
      const before = queue.length;
      // Lọc giữ lại những tin chưa hết hạn
      const fresh = queue.filter(m => now - m.storedAt <= MSG_TTL_MS);
      if (fresh.length < before) {
        if (fresh.length === 0) {
          offlineQueue.delete(peerId);
        } else {
          offlineQueue.set(peerId, fresh);
        }
        console.log(`  ⏰ [Cleanup] Expired ${before - fresh.length} offline msg(s) for ${peerId}`);
      }
    }
  }, 10000);
}

// ─── Export ───────────────────────────────────────────────────────────────────────────
module.exports = {
  register, getOnlinePeers, heartbeat, leave, count, startPeriodicCleanup,
  storeMessage, popMessages, getQueueStats,
  PEER_TIMEOUT_MS,
};
