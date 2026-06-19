/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  state.js — Trạng thái chia sẻ giữa các module             ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * TẠI SAO CẦN MODULE RIÊNG?
 *   Nhiều module cần truy cập cùng dữ liệu:
 *   - reliableDelivery.js: thêm/xóa pendingAcks
 *   - messageHandler.js: đọc pendingAcks khi nhận ACK, ghi receivedMsgIds
 *   Nếu mỗi file tự khai báo → chúng có bản sao riêng → mất đồng bộ.
 *
 * NODE.JS MODULE CACHE (SINGLETON PATTERN):
 *   Khi file A và file B cùng require('./state'),
 *   Node.js chỉ THỰC THI state.js MỘT LẦN duy nhất.
 *   Lần require tiếp theo → trả về kết quả đã cache (cùng object).
 *   Kết quả: mọi module đều CHIA SẺ CÙNG Map và Set này.
 *   Đây gọi là Singleton Pattern — đảm bảo chỉ có 1 instance.
 *
 * TẠI SAO KHÔNG DÙNG GLOBAL?
 *   global.pendingAcks = new Map() có thể gây xung đột tên với thư viện
 *   khác. Module cache an toàn hơn và kiểm soát được scope.
 */

'use strict';

// ─── Trạng thái ACK đang chờ ─────────────────────────────────────────────────
// Map<msgId: string, { timer, retryCount, payload, targetHost, targetPort }>
//
// Khi sendWithAck() gửi tin nhắn:
//   1. Thêm entry vào Map với key = msgId
//   2. Đặt timer để retry/fail nếu không nhận được ACK
//
// Khi nhận ACK (trong messageHandler.js):
//   1. clearTimeout(entry.timer) → hủy timer retry
//   2. pendingAcks.delete(msgId) → xóa khỏi Map
//
// Nếu entry vẫn còn trong Map sau ACK_TIMEOUT_MS → timer bắn → retry
const pendingAcks = new Map();

// ─── Tập ID tin nhắn đã nhận ─────────────────────────────────────────────────
// Set<msgId: string>
//
// VẤẤN ĐỀ DEDUPLICATION:
//   Khi peer B không gửi ACK kịp (mạng chậm), peer A sẽ retry và gửi
//   cùng tin nhắn với cùng msgId lần thứ 2, thứ 3...
//   Nếu peer B không dedup → tin nhắn "Hello!" hiển thị 3 lần → khó chịu.
//
// GIẢI PHÁP:
//   Mỗi khi nhận tin, kiểm tra msgId trong Set:
//   - Chưa có → thêm vào Set, hiển thị tin, gửi ACK
//   - Đã có   → KHÔNG hiển thị lại, nhưng vẫn gửi ACK (sender cần biết đã nhận)
//
// Set thay vì Array vì:
//   - Set.has() = O(1), Array.includes() = O(n)
//   - Tốc độ lookup nhanh hơn nhiều
const receivedMsgIds = new Set();

// ─── Hằng số cấu hình ────────────────────────────────────────────────────────

// Thời gian chờ ACK tối đa: 5 giây
// Nếu sau 5s không nhận được ACK → retry hoặc fail
// Giá trị này cân bằng giữa: quá nhỏ (retry nhiều) và quá lớn (chờ lâu)
const ACK_TIMEOUT_MS = 5000;

// Số lần retry tối đa trước khi báo FAILED
// Sau 3 lần retry (4 lần gửi tổng cộng) vẫn không được → báo thất bại
const MAX_RETRY = 3;

// Giới hạn số lượng msgId lưu trong Set để tránh memory leak
// Sau 1000 entries → xóa entry cũ nhất (FIFO)
// Tại sao 1000? Đủ lớn để không miss dedup, đủ nhỏ để không tốn RAM
const MAX_RECEIVED_IDS = 1000;

// Export để các module khác sử dụng
// Vì Map và Set là objects (reference types), khi module khác import và thay đổi
// → thay đổi được phản ánh trên cùng object (không cần export lại)
module.exports = { pendingAcks, receivedMsgIds, ACK_TIMEOUT_MS, MAX_RETRY, MAX_RECEIVED_IDS };
