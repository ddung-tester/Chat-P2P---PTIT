/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  messageHandler.js — Xử lý tin nhắn nhận được qua TCP       ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * VAI TRÒ:
 *   Là "bộ não" xử lý logic khi nhận message từ peer khác.
 *   Được dùng ở 2 chỗ:
 *     1. tcpServer.js: khi peer KHÁC gửi tin đến (nhận CHAT, GROUP, BROADCAST)
 *     2. tcpClient.js: khi nhận response từ peer đích (nhận ACK)
 *
 * CÁC LOẠI MESSAGE:
 *   CHAT        → tin nhắn 1-1 (peer A → peer B)
 *   GROUP_CHAT  → tin nhắn nhóm (peer A → peer B, C, ...)
 *   BROADCAST   → tin nhắn tất cả (peer A → mọi peer đang online)
 *   ACK         → xác nhận đã nhận (peer B → peer A)
 *   ERROR       → báo lỗi (ít dùng)
 *
 * DEDUPLICATION (CHỐNG TIN TRÙNG):
 *   Khi peer A retry (gửi lại vì không nhận được ACK), peer B có thể nhận
 *   cùng một tin nhắn 2-3 lần. Module này kiểm tra receivedMsgIds để:
 *   - Nếu đã nhận: bỏ qua (không hiển thị lại) nhưng vẫn gửi ACK
 *   - Nếu chưa nhận: hiển thị + thêm vào Set + gửi ACK
 *
 * ANSI COLOR CODES:
 *   \x1b[36m = Cyan (màu xanh lam nhạt) → dùng cho CHAT
 *   \x1b[35m = Magenta (màu tím) → dùng cho GROUP_CHAT
 *   \x1b[33m = Yellow (màu vàng) → dùng cho BROADCAST
 *   \x1b[32m = Green (màu xanh lá) → dùng cho ACK thành công
 *   \x1b[31m = Red (màu đỏ) → dùng cho ERROR
 *   \x1b[90m = Dark gray → dùng cho thông tin phụ (timestamp)
 *   \x1b[0m  = Reset → về màu mặc định
 */

'use strict';

// Import state (singleton) để đọc/ghi receivedMsgIds và pendingAcks
const state = require('./state');

// Import logger để hiển thị tin nhắn ra terminal đúng cách (giữ readline prompt)
const { log, timestamp } = require('./logger');

// Import crypto để giải mã nội dung tin nhắn
const { decrypt, isEncrypted } = require('./crypto');

// Import event bus để phát sự kiện cho GUI (nếu đang chạy)
const bus = require('./eventBus');

// ─── Factory function tạo message handler ────────────────────────────────────
/**
 * Tạo hàm handleMessage với peerId đã được bind.
 * Dùng factory function để inject peerId thay vì biến global.
 *
 * @param {string} peerId       ID của peer đang chạy (dùng để gửi ACK với đúng "from")
 * @param {string|null} encKey  Pre-shared key để giải mã (null = không giải mã)
 * @returns {function(object, import('net').Socket): void}
 */
function createHandler(peerId, encKey = null) {

  // Hàm giải mã content: giải mã nếu là ciphertext, trả nguyên nếu không
  function decryptContent(content) {
    if (!isEncrypted(content)) return { text: content, wasEncrypted: false };
    const text = encKey ? decrypt(content, encKey) : '[ENCRYPTED — không có key để giải mã]';
    return { text, wasEncrypted: true };
  }

  /**
   * Xử lý một JSON message nhận được qua TCP.
   * Được gọi từ cả tcpServer.js (inbound) và tcpClient.js (response/ACK).
   *
   * @param {object} msg    Message đã parse từ JSON (có field: type, id, from, ...)
   * @param {import('net').Socket} socket  Socket TCP hiện tại (để gửi ACK ngược lại)
   */
  return function handleMessage(msg, socket) {

    // ── BƯỚC 1: Deduplication check ──────────────────────────────────────────
    // Chỉ áp dụng cho tin nhắn thực (CHAT/GROUP_CHAT/BROADCAST), không áp dụng cho ACK/ERROR
    // Vì ACK không cần dedup: nhận ACK 2 lần chỉ clear timer 1 lần (idempotent)
    if (msg.type !== 'ACK' && msg.type !== 'ERROR') {
      if (state.receivedMsgIds.has(msg.id)) {
        // Đã nhận tin này rồi (đây là bản retry từ sender)
        // → KHÔNG hiển thị lại (tránh spam)
        // → VẪN gửi ACK (sender cần biết đã nhận để stop retry)
        if (socket && socket.writable) {
          // socket.writable: kiểm tra socket còn mở không trước khi write
          // Tránh lỗi "write after end" nếu socket đã đóng
          const ack = { type: 'ACK', id: msg.id, from: peerId };
          socket.write(JSON.stringify(ack) + '\n');
        }
        return; // Dừng xử lý — không hiển thị tin trùng
      }

      // Tin nhắn MỚI — thêm vào Set để dedup các lần retry sau
      state.receivedMsgIds.add(msg.id);

      // Giới hạn kích thước Set để tránh memory leak
      // Khi vượt ngưỡng 1000 → xóa entry cũ nhất (FIFO ordering của Set)
      if (state.receivedMsgIds.size > state.MAX_RECEIVED_IDS) {
        const oldest = state.receivedMsgIds.values().next().value; // Entry đầu tiên
        state.receivedMsgIds.delete(oldest);
      }
    }

    // ── BƯỚC 2: Xử lý theo loại message ─────────────────────────────────────
    switch (msg.type) {

      // ── CHAT: Tin nhắn trực tiếp 1-1 ────────────────────────────────────
      case 'CHAT': {
        const { text, wasEncrypted } = decryptContent(msg.content);
        const encMark = wasEncrypted ? ' \x1b[32m[ENC]✅\x1b[0m' : '';
        log(`\x1b[36m[MSG from ${msg.from}]\x1b[0m${encMark} ${text}  \x1b[90m(${timestamp()})\x1b[0m`);

        // Phát sự kiện cho GUI
        bus.emit('chat-received', { from: msg.from, text, wasEncrypted, timestamp: timestamp(), id: msg.id, type: 'CHAT' });

        // Gửi ACK ngay lập tức qua cùng socket đang mở
        // ACK format: { type: 'ACK', id: msgId, from: peerId_của_tôi }
        const ack = { type: 'ACK', id: msg.id, from: peerId };
        if (socket && socket.writable) socket.write(JSON.stringify(ack) + '\n');
        break;
      }

      // ── GROUP_CHAT: Tin nhắn nhóm ─────────────────────────────────────
      case 'GROUP_CHAT': {
        const { text, wasEncrypted } = decryptContent(msg.content);
        const encMark = wasEncrypted ? ' \x1b[32m[ENC]✅\x1b[0m' : '';
        log(`\x1b[35m[GROUP from ${msg.from}]\x1b[0m${encMark} ${text}  \x1b[90m(${timestamp()})\x1b[0m`);

        // Phát sự kiện cho GUI
        bus.emit('group-received', { from: msg.from, to: msg.to, text, wasEncrypted, timestamp: timestamp(), id: msg.id, type: 'GROUP_CHAT' });

        const ack = { type: 'ACK', id: msg.id, from: peerId };
        if (socket && socket.writable) socket.write(JSON.stringify(ack) + '\n');
        break;
      }

      // ── BROADCAST: Tin nhắn toàn mạng ──────────────────────────────────
      case 'BROADCAST': {
        const { text, wasEncrypted } = decryptContent(msg.content);
        const encMark = wasEncrypted ? ' \x1b[32m[ENC]✅\x1b[0m' : '';
        log(`\x1b[96m[BROADCAST from ${msg.from}]\x1b[0m${encMark} ${text}  \x1b[90m(${timestamp()})\x1b[0m`);

        // Phát sự kiện cho GUI
        bus.emit('broadcast-received', { from: msg.from, text, wasEncrypted, timestamp: timestamp(), id: msg.id, type: 'BROADCAST' });

        const ack = { type: 'ACK', id: msg.id, from: peerId };
        if (socket && socket.writable) socket.write(JSON.stringify(ack) + '\n');
        break;
      }

      // ── ACK: Xác nhận tin nhắn đã được nhận ──────────────────────────────
      case 'ACK': {
        // Kiểm tra xem ACK này có khớp với tin nhắn đang chờ không
        if (state.pendingAcks.has(msg.id)) {
          // Tìm thấy → tin nhắn đã được peer đích nhận thành công
          const entry = state.pendingAcks.get(msg.id);

          clearTimeout(entry.timer); // Hủy timer retry (không cần retry nữa)
          state.pendingAcks.delete(msg.id); // Xóa khỏi danh sách chờ

          // Thông báo thành công với màu xanh lá
          log(`\x1b[32m[ACK]\x1b[0m Message ${msg.id} delivered ✓ (acked by ${msg.from})`);

          // Phát sự kiện cho GUI
          bus.emit('ack-received', { id: msg.id, from: msg.from });
        }
        // Nếu không tìm thấy trong pendingAcks: ACK đến trễ (sau khi đã timeout)
        // → bỏ qua bình thường
        break;
      }

      // ── ERROR: Thông báo lỗi từ peer đích ───────────────────────────────
      case 'ERROR': {
        // Hiển thị lỗi với màu đỏ
        log(`\x1b[31m[ERROR]\x1b[0m ${msg.reason} (msg: ${msg.id})`);
        break;
      }

      // Bỏ qua các message type không nhận dạng được
      default:
        break;
    }
  };
}

// Export factory function
module.exports = { createHandler };
