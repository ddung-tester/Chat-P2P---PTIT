/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  logger.js — Module log và tiện ích chung                   ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * TẠI SAO CẦN MODULE RIÊNG?
 *   Nếu để hàm log() trong peer.js, các module khác (messageHandler.js,
 *   cli.js...) sẽ phải import từ peer.js → circular dependency (vòng lặp
 *   import A→B→A). Module logger.js độc lập giải quyết vấn đề này.
 *
 * VẤN ĐỀ READLINE + LOG:
 *   Khi dùng readline (cho CLI), terminal hiển thị prompt "[Alice]> "
 *   trên dòng cuối. Nếu có tin nhắn đến lúc user đang gõ, cần:
 *     1. Xóa dòng prompt hiện tại
 *     2. In tin nhắn mới
 *     3. Hiện lại prompt
 *   Hàm log() làm đúng việc này nhờ setRl().
 *
 * THIẾT KẾ SINGLETON:
 *   _rl là biến module-level. Module Node.js được cache sau lần require() đầu.
 *   Nên dù 10 file khác nhau require('./logger'), chúng đều dùng chung
 *   biến _rl này — đảm bảo setRl() chỉ cần gọi 1 lần từ peer.js.
 */

'use strict';

// Biến lưu trữ readline interface (được gán sau khi CLI khởi tạo)
// Đặt tên có tiền tố _ để chỉ đây là "private variable" (quy ước)
// Giá trị ban đầu là null — chưa có readline nào
let _rl = null;

// ─── Hàm: Gắn readline interface vào logger ──────────────────────────────────
/**
 * Gọi hàm này SAU KHI tạo readline interface (trong peer.js).
 * Thứ tự QUAN TRỌNG: phải tạo rl trước → gọi setRl(rl) sau.
 * Nếu setRl không được gọi, log() vẫn hoạt động nhưng không tự prompt lại.
 *
 * @param {import('readline').Interface} rl  Readline interface từ cli.js
 */
function setRl(rl) {
  _rl = rl; // Lưu reference để log() dùng sau
}

// ─── Hàm: In message ra terminal ─────────────────────────────────────────────
/**
 * In message và tự động xử lý readline prompt.
 *
 * CÁC ESCAPE CODE:
 *   \r = Carriage Return: di chuyển cursor về đầu dòng (không xuống dòng mới)
 *   \x1b[K = Erase from cursor to end of line (ANSI escape code)
 *   Kết hợp \r\x1b[K → xóa toàn bộ dòng hiện tại
 *
 * Tại sao cần xóa dòng? Khi user đang gõ "/msg peer-b Hello", prompt
 * đang hiển thị "[Alice]> /msg peer-b Hello" trên dòng cuối.
 * Nếu in message mới luôn → bị chồng lên dòng đó → khó đọc.
 *
 * @param {string} msg  Message cần in ra
 */
function log(msg) {
  process.stdout.write('\r\x1b[K'); // Xóa dòng prompt hiện tại
  console.log(msg);                  // In message mới
  if (_rl) _rl.prompt(true);        // Hiện lại prompt (true = giữ input đã gõ)
}

// ─── Hàm: Lấy timestamp hiện tại ─────────────────────────────────────────────
/**
 * Trả về timestamp dạng "YYYY-MM-DD HH:MM:SS" (giờ UTC).
 *
 * CÁCH HOẠT ĐỘNG:
 *   new Date().toISOString() → "2024-01-15T14:30:00.000Z"
 *   .replace('T', ' ')       → "2024-01-15 14:30:00.000Z"
 *   .slice(0, 19)            → "2024-01-15 14:30:00"
 *
 * @returns {string}  Ví dụ: "2024-01-15 14:30:00"
 */
function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// ─── Hàm: Tạo Message ID ngẫu nhiên ─────────────────────────────────────────
/**
 * Tạo ID duy nhất cho mỗi tin nhắn, dùng để:
 *   1. Track ACK: gửi tin → lưu vào pendingAcks với key = msgId
 *   2. Deduplication: kiểm tra xem đã nhận tin này chưa
 *
 * FORMAT: "msg-{timestamp}-{random4chars}"
 * Ví dụ: "msg-1700000000000-a3b4"
 *
 * TẠI SAO KHÔNG DÙNG UUID?
 *   Không cần import thêm thư viện. Xác suất trùng:
 *   timestamp (ms) + 4 ký tự base36 = đủ ngẫu nhiên trong context nhỏ này.
 *
 * Math.random() → số thực [0,1)
 * .toString(36)  → chuyển sang base36 (0-9, a-z)
 * .slice(2, 6)   → lấy 4 ký tự (bỏ "0." ở đầu)
 *
 * @returns {string}  Ví dụ: "msg-1700000000000-a3b4"
 */
function msgId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// Export tất cả hàm
module.exports = { setRl, log, timestamp, msgId };
