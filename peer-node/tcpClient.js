/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  tcpClient.js — Gửi tin nhắn tới peer khác qua TCP          ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * VAI TRÒ:
 *   Đây là phần CLIENT của peer — chủ động kết nối tới peer đích và gửi tin.
 *
 * ĐẶC ĐIỂM QUAN TRỌNG — HALF-DUPLEX TRÊN CÙNG SOCKET:
 *   Khác với HTTP request/response thông thường, ở đây:
 *     1. Peer A mở kết nối TCP tới Peer B
 *     2. Peer A GỬI JSON message (CHAT/GROUP_CHAT/BROADCAST)
 *     3. Peer A KHÔNG đóng socket ngay
 *     4. Peer B nhận tin → xử lý → GỬI ACK ngược lại trên CÙNG socket đó
 *     5. Peer A nhận ACK → gọi onResponse() → xóa khỏi pendingAcks
 *     6. Peer B đóng socket sau khi gửi ACK
 *     7. Peer A nhận event 'end' → resolve Promise
 *
 *   Nếu Peer A đóng socket ngay sau khi gửi (socket.end()):
 *   → Peer B nhận tin nhưng không còn socket để gửi ACK về
 *   → Peer A không nhận được ACK → retry mãi mãi → BUG!
 *
 * GIẢI QUYẾT CIRCULAR DEPENDENCY:
 *   tcpClient.js cần gọi handleMessage khi nhận ACK.
 *   messageHandler.js cần sendTCP để gửi tin.
 *   Nếu A import B và B import A → vòng lặp import → lỗi hoặc undefined.
 *
 *   Giải pháp: Injection Pattern
 *   createSendTCP(onResponse) nhận handleMessage như là tham số
 *   → không cần import messageHandler.js trực tiếp
 *   → peer.js (entry point) làm cầu nối: tạo handler → truyền vào sendTCP
 */

'use strict';

// net module của Node.js — dùng để tạo TCP client socket
const net = require('net');

// ─── Factory function tạo sendTCP ────────────────────────────────────────────
/**
 * Tạo hàm sendTCP với onResponse callback được inject.
 *
 * @param {function(object, import('net').Socket): void} onResponse
 *   Callback xử lý response từ peer đích (thường là ACK message).
 *   Được inject từ peer.js = handleMessage từ messageHandler.js.
 *
 * @returns {function(string, number, object): Promise<void>}
 *   Hàm sendTCP đã được cấu hình với onResponse.
 */
function createSendTCP(onResponse) {

  /**
   * Kết nối TCP tới host:port, gửi payload JSON, và lắng nghe response.
   *
   * @param {string} host    Địa chỉ IP của peer đích (ví dụ: "127.0.0.1")
   * @param {number} port    Cổng TCP của peer đích (ví dụ: 5002)
   * @param {object} payload JSON object cần gửi (CHAT, GROUP_CHAT, BROADCAST)
   *
   * @returns {Promise<void>}
   *   - Resolve: khi kết nối đóng bình thường hoặc timeout (không phân biệt ACK hay không)
   *   - Reject: khi KHÔNG thể kết nối (ECONNREFUSED, ENOTFOUND...)
   *             → reliableDelivery.js sẽ bắt lỗi này để retry
   */
  return function sendTCP(host, port, payload) {
    return new Promise((resolve, reject) => {

      // Tạo kết nối TCP tới host:port
      // Callback của net.connect() được gọi khi kết nối THÀNH CÔNG
      // Nếu kết nối thất bại → emit event 'error' → bắt ở socket.on('error')
      const socket = net.connect({ host, port }, () => {
        // Kết nối thành công → gửi payload dưới dạng JSON + newline delimiter
        // JSON.stringify() chuyển object thành string
        // '\n' là delimiter để peer đích biết đây là end of message
        socket.write(JSON.stringify(payload) + '\n');

        // QUAN TRỌNG: KHÔNG gọi socket.end() ở đây!
        // Phải giữ socket mở để nhận ACK từ peer đích
        // socket.end() sẽ được peer đích gọi sau khi nó gửi ACK
      });

      // Buffer ghép dữ liệu response (giống tcpServer.js)
      let ackBuffer = '';

      // Lắng nghe dữ liệu gửi ngược về từ peer đích (response/ACK)
      socket.on('data', (data) => {
        ackBuffer += data.toString();

        // Parse từng dòng JSON hoàn chỉnh
        const lines = ackBuffer.split('\n');
        ackBuffer = lines.pop(); // Giữ lại phần chưa đủ

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            // Gọi onResponse với message đã parse (thường là ACK)
            // onResponse = messageHandler.handleMessage (được inject từ peer.js)
            onResponse(JSON.parse(line), socket);
          } catch (e) { /* bỏ qua JSON lỗi */ }
        }
      });

      // Event 'end': peer đích đã đóng kết nối (sau khi gửi ACK)
      // Đây là kết thúc bình thường của luồng giao tiếp
      socket.on('end', () => {
        socket.destroy(); // Giải phóng tài nguyên socket
        resolve();        // Promise thành công — đã nhận end từ peer
      });

      // Event 'error': không thể kết nối (peer offline, port sai...)
      // ECONNREFUSED: không có gì lắng nghe trên host:port đó
      socket.on('error', (err) => {
        socket.destroy(); // Dọn dẹp
        reject(err);      // Báo lỗi cho reliableDelivery.js xử lý (retry/fail)
      });

      // Timeout toàn bộ connection: 10 giây
      // Đủ thời gian peer đích xử lý và gửi ACK
      // Nếu ACK đã đến qua event 'data' + onResponse() → vẫn resolve bình thường
      // Timeout chỉ là safety net khi peer đích không đóng socket
      socket.setTimeout(10000, () => {
        socket.destroy();
        // Resolve (không reject) vì ACK có thể đã được xử lý qua onResponse()
        // Tránh reject làm trigger retry không cần thiết
        resolve();
      });
    });
  };
}

// Export factory function
module.exports = { createSendTCP };
