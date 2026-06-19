/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  tcpServer.js — Máy chủ TCP nhận tin từ các peer khác       ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * VAI TRÒ:
 *   Mỗi peer vừa là CLIENT (gửi tin đến peer khác) vừa là SERVER (nhận tin
 *   từ peer khác). File này tạo phần SERVER — lắng nghe kết nối TCP đến.
 *
 * TCP VÀ JSON FRAMING:
 *   TCP là giao thức stream — dữ liệu đến thành từng chunk, không có ranh giới
 *   giữa các "message". Ví dụ:
 *     - Peer A gửi: '{"type":"CHAT",...}\n'
 *     - Peer B nhận event 'data' có thể nhận: '{"type":"CHA' (chunk 1)
 *                                              'T",...}\n' (chunk 2)
 *
 *   Giải pháp: dùng '\n' làm message delimiter (phân cách).
 *   Mọi message kết thúc bằng '\n'. Server ghép chunk cho đến khi gặp '\n'
 *   thì mới parse JSON. Đây là pattern "newline-delimited JSON" (NDJSON).
 *
 * TẠI SAO DÙNG FACTORY FUNCTION?
 *   createTcpServer(onMessage) nhận callback thay vì hardcode logic xử lý.
 *   Ưu điểm:
 *     1. Module này không biết gì về business logic (CHAT, ACK, ...)
 *     2. Dễ test: truyền mock callback vào để kiểm tra
 *     3. Tái sử dụng: nếu cần server khác với logic xử lý khác
 */

'use strict';

// net là module built-in của Node.js cho TCP/Unix socket
// Không cần cài qua npm — có sẵn trong Node.js
const net = require('net');

// ─── Factory function tạo TCP Server ─────────────────────────────────────────
/**
 * Tạo và trả về một TCP server.
 * Server sẽ lắng nghe kết nối đến, parse JSON message, và gọi onMessage.
 *
 * @param {function(object, import('net').Socket): void} onMessage
 *   Callback được gọi với mỗi JSON message hoàn chỉnh nhận được.
 *   Tham số 1: msg — object JavaScript đã parse từ JSON
 *   Tham số 2: socket — kết nối TCP với peer gửi (dùng để gửi ACK ngược lại)
 *
 * @returns {import('net').Server}
 *   TCP server (chưa listen — phải gọi server.listen(port) sau)
 */
function createTcpServer(onMessage) {

  // net.createServer() tạo server, callback được gọi MỖI KHI có peer kết nối
  // Mỗi kết nối mới → 1 socket object riêng
  const server = net.createServer((socket) => {
    // Buffer để ghép các chunk dữ liệu nhận được
    // Mỗi kết nối có buffer riêng (khai báo trong callback → scope riêng)
    let buffer = '';

    // Event 'data': được emit mỗi khi có dữ liệu đến trên socket này
    // data: Buffer object (dạng binary) → cần .toString() để thành string
    socket.on('data', (data) => {
      buffer += data.toString(); // Ghép chunk mới vào buffer

      // Tách buffer thành các dòng dựa trên ký tự '\n'
      // Ví dụ: buffer = '{"type":"CHAT"}\n{"type":"ACK"}\n{"partial'
      // → lines = ['{"type":"CHAT"}', '{"type":"ACK"}', '{"partial']
      const lines = buffer.split('\n');

      // Dòng CUỐI CÙNG có thể chưa đầy đủ (không kết thúc bằng \n)
      // Lưu lại vào buffer để ghép với chunk tiếp theo
      // lines.pop() xóa và trả về phần tử cuối
      buffer = lines.pop();

      // Xử lý từng dòng hoàn chỉnh
      for (const line of lines) {
        if (!line.trim()) continue; // Bỏ qua dòng trống

        try {
          // JSON.parse() chuyển string JSON thành JavaScript object
          // Nếu JSON sai format → throw SyntaxError → bắt bởi catch bên dưới
          onMessage(JSON.parse(line), socket);
        } catch (e) {
          // Bỏ qua message JSON không hợp lệ — không crash server
          // Trong production nên log lỗi này để debug
        }
      }
    });

    // Event 'error': được emit khi có lỗi socket (connection reset, timeout...)
    // Cần có handler để tránh unhandled error event làm crash process
    // () => {} = empty function = bỏ qua lỗi (graceful handling)
    socket.on('error', () => {});
  });

  // Trả về server object để peer.js có thể gọi server.listen(port, host)
  return server;
}

// Export factory function
module.exports = { createTcpServer };
