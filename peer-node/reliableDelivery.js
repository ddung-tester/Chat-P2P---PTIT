/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  reliableDelivery.js — Gửi tin đáng tin cậy (ACK + Retry)  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * VẤN ĐỀ CẦN GIẢI QUYẾT:
 *   TCP đảm bảo byte đến đúng thứ tự — nhưng KHÔNG đảm bảo peer đích đang
 *   chạy. Nếu peer B offline khi peer A gửi → tin mất.
 *   Module này thêm tầng ACK + retry ở application level để đảm bảo:
 *   "Tin nhắn được giao đến người nhận, hoặc người gửi được thông báo thất bại"
 *
 * LUỒNG HOẠT ĐỘNG:
 *   sendWithAck(host, port, payload):
 *     attempt(0):
 *       [1] Đặt timer 5s (ACK_TIMEOUT_MS)
 *       [2] Gửi TCP → nếu connect FAIL → clearTimeout → attempt(1)
 *       [3] Nếu nhận ACK (qua messageHandler) → clearTimeout → DONE ✓
 *       [4] Nếu timer hết 5s, chưa nhận ACK → attempt(1)
 *     attempt(1): [lặp lại với retry 1]
 *     attempt(2): [lặp lại với retry 2]
 *     attempt(3): [lặp lại với retry 3]
 *     attempt(4): MAX_RETRY = 3 → onFailed() → [FAILED] ✗
 *
 * BUG DOUBLE-EXECUTION ĐÃ SỬA:
 *   Nếu đặt timer SAU sendTCP(), có thể xảy ra:
 *   - sendTCP() fail ngay lập tức → catch() gọi attempt(1)
 *   - timer cũng bắn → gọi attempt(1) lần nữa
 *   → attempt(1) bị gọi 2 lần = BUG!
 *
 *   Giải pháp: đặt timer TRƯỚC sendTCP(), và clearTimeout() ngay trong
 *   catch() trước khi gọi attempt tiếp theo.
 *
 * INJECT sendTCP:
 *   Nhận sendTCP như tham số thay vì import trực tiếp từ tcpClient.js.
 *   Tránh circular dependency: tcpClient → messageHandler → state
 *                                                              ↑
 *                              reliableDelivery → state ────────┘
 *                              * Điều này làm cho cli.js dễ test độc lập (mock các dependency).
 *
 * STORE-AND-FORWARD INJECTION:
 *   Nhận thêm `storeAndForward` như tàm số tùy chọn.
 *   Nếu được inject: sau khi hết retry → tự động gửi lên Bootstrap để lưu.
 *   Nếu không: chỉ log [FAILED] như cũ.
 */

'use strict';

// Import state để truy cập pendingAcks, ACK_TIMEOUT_MS, MAX_RETRY
const state = require('./state');

// Import log để hiển thị cảnh báo retry và thất bại
const { log } = require('./logger');

// Import event bus để phát sự kiện cho GUI
const bus = require('./eventBus');

// ─── Factory function ──────────────────────────────────────────────────────────
/**
 * Tạo module reliable delivery với sendTCP và storeAndForward được inject.
 *
 * @param {function(string, number, object): Promise<void>} sendTCP
 *   Hàm gửi TCP đã được cấu hình với handleMessage (từ tcpClient.createSendTCP)
 *
 * @param {function(string, object): Promise<boolean>} [storeAndForward]
 *   Hàm lưu tin offline lên Bootstrap (từ bootstrapClient.storeMessage).
 *   Tùy chọn: nếu không inject thì chỉ log [FAILED].
 *
 * @returns {{ sendWithAck: function, onFailed: function }}
 */
function createReliableDelivery(sendTCP, storeAndForward = null) {

  /**
   * Đánh dấu message thất bại và thông báo cho user.
   * Gọi khi đã hết số lần retry mà không nhận được ACK.
   *
   * @param {string} id  Message ID cần báo thất bại
   */
  function onFailed(id) {
    if (state.pendingAcks.has(id)) {
      const entry = state.pendingAcks.get(id);
      clearTimeout(entry.timer); // Dọn dẹp timer còn sót
      state.pendingAcks.delete(id); // Xóa khỏi danh sách chờ

      // Thông báo màu đỏ: tin nhắn không đến được người nhận
      log(`\x1b[31m[FAILED] Message ${id} could not be delivered after ${state.MAX_RETRY} retries. ✗\x1b[0m`);

      // Phát sự kiện cho GUI
      bus.emit('send-failed', { id, payload: entry.payload });

      // Nếu có store-and-forward → tự động lưu lên Bootstrap
      if (storeAndForward && entry.payload && entry.payload.to) {
        log(`\x1b[35m[STORE-FORWARD]\x1b[0m Peer ${entry.payload.to} offline — đang lưu lên Bootstrap...`);
        // Gọi bất đồng bộ — không cần await (fire-and-forget)
        storeAndForward(entry.payload.to, entry.payload).then(() => {
          bus.emit('stored-forward', { id, to: entry.payload.to, payload: entry.payload });
        }).catch(() => {});
      }
    }
  }

  /**
   * Gửi tin nhắn với đảm bảo ACK + timeout + retry.
   * Payload PHẢI có trường `id` (message ID) để track ACK.
   *
   * @param {string} host    IP peer đích
   * @param {number} port    Port TCP peer đích
   * @param {object} payload Message object (có chứa `id` field)
   */
  function sendWithAck(host, port, payload) {
    const id = payload.id; // Message ID dùng để match với ACK

    /**
     * Hàm đệ quy thực hiện một lần gửi.
     * @param {number} retryCount  Số lần đã retry (0 = lần đầu gửi)
     */
    function attempt(retryCount) {

      // ── BƯỚC 1: Đặt timer TRƯỚC khi gửi ────────────────────────────────
      // Lý do: nếu đặt SAU → sendTCP có thể fail ngay lập tức → catch() chạy
      // → nhưng timer chưa set → không clearTimeout được → timer bắn muộn → BUG
      const timer = setTimeout(() => {
        // Timer hết hạn: chưa nhận được ACK sau ACK_TIMEOUT_MS
        if (!state.pendingAcks.has(id)) return; // ACK đã đến rồi (race condition)

        if (retryCount < state.MAX_RETRY) {
          // Còn retry → thử lại
          log(`\x1b[33m[RETRY ${retryCount + 1}/${state.MAX_RETRY}] msg ${id} → retrying...\x1b[0m`);
          attempt(retryCount + 1); // Đệ quy với retryCount tăng 1
        } else {
          // Hết retry → thất bại
          onFailed(id);
        }
      }, state.ACK_TIMEOUT_MS); // Timer = 5 giây

      // ── BƯỚC 2: Lưu thông tin vào pendingAcks ──────────────────────────
      // Thông tin này dùng khi messageHandler nhận ACK → lookup bằng msgId → clearTimeout
      state.pendingAcks.set(id, {
        timer,       // setTimeout handle (để clearTimeout khi nhận ACK)
        retryCount,  // Số lần retry hiện tại (để debug)
        payload,     // Payload gốc (có thể dùng để resend)
        targetHost: host,
        targetPort: port,
      });

      // ── BƯỚC 3: Gửi TCP ─────────────────────────────────────────────────
      // sendTCP trả về Promise:
      //   - Resolve: kết nối đóng bình thường (ACK đã đến hoặc timeout 10s)
      //   - Reject: không kết nối được (ECONNREFUSED = peer offline)
      sendTCP(host, port, payload).catch((err) => {
        // Kiểm tra: nếu ACK đã đến trong lúc đang connect → không xử lý nữa
        if (!state.pendingAcks.has(id)) return;

        // ── QUAN TRỌNG: Clear timer TRƯỚC khi gọi attempt() tiếp theo ──
        // Nếu không clear → timer cũ vẫn chạy → attempt() bị gọi 2 lần (double execution BUG)
        clearTimeout(timer);

        // Thông báo connect thất bại
        log(`\x1b[33m[WARN] Cannot connect to ${host}:${port} — ${err.message}\x1b[0m`);

        if (retryCount < state.MAX_RETRY) {
          // Retry ngay (không chờ timeout vì connect đã fail rõ ràng)
          log(`\x1b[33m[RETRY ${retryCount + 1}/${state.MAX_RETRY}] msg ${id} → retrying...\x1b[0m`);
          attempt(retryCount + 1);
        } else {
          onFailed(id);
        }
      });
      // Lưu ý: không .then() ở đây → resolve của sendTCP không làm gì thêm
      // Việc xóa pendingAcks khi ACK đến do messageHandler.js xử lý riêng
    }

    // Bắt đầu lần gửi đầu tiên (retry 0)
    attempt(0);
  }

  // Trả về object chứa 2 hàm public
  return { sendWithAck, onFailed };
}

// Export factory function
module.exports = { createReliableDelivery };
