/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  cli.js — Giao diện dòng lệnh (Command Line Interface)      ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * VAI TRÒ:
 *   Toàn bộ logic "user gõ lệnh → hệ thống xử lý" nằm ở đây.
 *   Đây là lớp giao tiếp giữa người dùng và các module phía dưới.
 *
 * READLINE MODULE:
 *   readline là module built-in của Node.js cho phép đọc dữ liệu từ terminal
 *   theo từng dòng (khi user nhấn Enter). Nó quản lý:
 *   - Hiển thị prompt (ví dụ: "[Alice]> ")
 *   - Đọc input người dùng
 *   - Xử lý phím Ctrl+C (SIGINT)
 *
 * CÁC LỆNH HỖ TRỢ:
 *   /help                        — Hiển thị danh sách lệnh
 *   /list                        — Liệt kê peer online
 *   /msg <peer-id> <nội dung>    — Nhắn tin 1-1
 *   /group <id1,id2> <nội dung>  — Nhắn tin nhóm
 *   /broadcast <nội dung>        — Gửi tất cả
 *   /status                      — Xem thông tin của mình
 *   /exit                        — Thoát
 *
 * INJECT PATTERN:
 *   Nhận getPeers, sendWithAck, leavePeer, server như tham số.
 *   cli.js không import trực tiếp từ bootstrapClient hay reliableDelivery.
 *   Điều này làm cho cli.js dễ test độc lập (mock các dependency).
 */

'use strict';

// readline: module built-in Node.js để đọc input từ terminal theo dòng
const readline = require('readline');

// Import logger để hiển thị output đúng cách (giữ prompt khi log)
const { log, msgId } = require('./logger');

// Import crypto module để mã hóa nội dung tin nhắn
const { encrypt, isEncrypted } = require('./crypto');

// Import state để hiển thị số ACK đang chờ trong /status
const state = require('./state');

// ─── Factory function tạo CLI ─────────────────────────────────────────────────
/**
 * Tạo readline interface và gắn tất cả command handlers.
 *
 * @param {object} config       Cấu hình peer (ID, name, port, ...)
 *   @param {string} config.PEER_ID
 *   @param {string} config.PEER_NAME
 *   @param {string} config.PEER_HOST
 *   @param {number} config.PEER_PORT
 *   @param {string} config.BOOTSTRAP
 *
 * @param {object} deps         Các dependency được inject
 *   @param {function(): Promise<Array>} deps.getPeers          Lấy danh sách peer online
 *   @param {function(string, number, object): void} deps.sendWithAck  Gửi tin có ACK
 *   @param {function(): Promise<void>} deps.leavePeer          Thông báo rời mạng
 *   @param {import('net').Server} deps.server                  TCP server (để close khi exit)
 *   @param {function(): NodeJS.Timeout} deps.getHeartbeatTimer Getter cho heartbeat interval
 *
 * @returns {import('readline').Interface}  readline instance để peer.js gắn vào logger
 */
function createCLI(config, deps) {
  const { PEER_ID, PEER_NAME, PEER_HOST, PEER_PORT, BOOTSTRAP, ENCRYPTION_KEY } = config;
  const { getPeers, sendWithAck, leavePeer, server, getHeartbeatTimer } = deps;

  // Hàm helper: mã hóa content nếu có key, giữ nguyên nếu không
  const maybeEncrypt = (text) => ENCRYPTION_KEY ? encrypt(text, ENCRYPTION_KEY) : text;
  // Làm rõ trong log: nếu mã hóa thì thêm [ENC]
  const encTag = ENCRYPTION_KEY ? ' \x1b[32m[ENC]\x1b[0m' : '';

  // Tạo readline interface:
  // - input: process.stdin (bàn phím)
  // - output: process.stdout (terminal)
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // Đặt prompt string — hiển thị ở đầu mỗi dòng input
  // \x1b[90m = dark gray, \x1b[0m = reset color
  rl.setPrompt(`\x1b[90m[${PEER_NAME}]>\x1b[0m `);

  // ── Hàm xử lý một lệnh ──────────────────────────────────────────────────
  /**
   * Parse và thực thi lệnh người dùng gõ.
   * Được gọi mỗi khi người dùng nhấn Enter.
   * async vì nhiều lệnh cần await getPeers() từ Bootstrap.
   *
   * @param {string} line  Toàn bộ dòng text người dùng vừa nhập
   */
  async function handleCommand(line) {
    const trimmed = line.trim(); // Xóa whitespace đầu/cuối
    if (!trimmed) return;        // Bỏ qua dòng trống (chỉ nhấn Enter)

    // ── /help — Hiển thị danh sách lệnh ────────────────────────────────
    if (trimmed === '/help') {
      log(`
\x1b[1mAvailable commands:\x1b[0m
  /list                         — Xem danh sách peer online
  /msg <peer-id> <message>      — Nhắn tin trực tiếp 1-1
  /group <id1,id2,...> <msg>    — Nhắn tin nhóm
  /broadcast <message>          — Gửi đến TẤT CẢ peer online
  /status                       — Xem thông tin peer của bạn
  /exit                         — Rời mạng và thoát
${ENCRYPTION_KEY ? '\n  \x1b[32m[ENC]\x1b[0m Tin nhắn của bạn được mã hóa AES-256 trước khi gửi.' : '  [!] Không mã hóa. Dùng --key để bật AES-256.'}
`);
      return;
    }

    // ── /list — Hiển thị danh sách peer đang online ──────────────────────
    if (trimmed === '/list') {
      try {
        const peers = await getPeers(); // Gọi GET /peers tới Bootstrap

        if (peers.length === 0) {
          log('\x1b[33mKhông có peer nào online.\x1b[0m');
        } else {
          log('\x1b[1mPeer đang online:\x1b[0m');
          for (const p of peers) {
            // Đánh dấu "(you)" cho chính mình để dễ nhận ra
            const self = p.id === PEER_ID ? ' \x1b[90m(you)\x1b[0m' : '';
            log(`  • \x1b[36m${p.id}\x1b[0m (${p.name}) @ ${p.host}:${p.port}${self}`);
          }
        }
      } catch (e) {
        log(`\x1b[31m[ERROR]\x1b[0m Không thể lấy danh sách peer: ${e.message}`);
      }
      return;
    }

    // ── /status — Xem thông tin peer hiện tại ────────────────────────────
    if (trimmed === '/status') {
      log(`\x1b[1mThông tin của bạn:\x1b[0m
  ID      : ${PEER_ID}
  Tên     : ${PEER_NAME}
  Lắng nghe: ${PEER_HOST}:${PEER_PORT}
  Bootstrap: ${BOOTSTRAP}
  ACK đang chờ: ${state.pendingAcks.size}`);
      return;
    }

    // ── /exit — Thoát gracefully ─────────────────────────────────────────
    if (trimmed === '/exit') {
      log('Đang rời mạng...');

      // 1. Dừng heartbeat interval (không gửi heartbeat nữa)
      clearInterval(getHeartbeatTimer());

      // 2. Thông báo Bootstrap: peer này offline
      await leavePeer();

      // 3. Đóng TCP server và thoát
      // server.close() dừng nhận kết nối mới, callback được gọi khi xong
      server.close(() => {
        log('Tạm biệt!');
        process.exit(0); // Exit code 0 = thành công (không lỗi)
      });
      return;
    }

    // ── /msg <peer-id> <nội dung> — Gửi tin 1-1 ──────────────────────────
    if (trimmed.startsWith('/msg ')) {
      // Tách lệnh: "/msg peer-b Hello Bob!" → ["peer-b", "Hello", "Bob!"]
      const parts = trimmed.slice(5).split(' ');
      const targetId = parts[0];            // peer-id (bắt buộc)
      const content  = parts.slice(1).join(' '); // Phần còn lại là nội dung

      if (!targetId || !content) {
        log('Cách dùng: /msg <peer-id> <nội dung>');
        return;
      }

      try {
        const peers = await getPeers();

        // Tìm peer theo ID trong danh sách online
        const target = peers.find((p) => p.id === targetId);
        if (!target) {
          log(`\x1b[31m[ERROR]\x1b[0m Peer "${targetId}" không tìm thấy hoặc offline.`);
          return;
        }

        // Tạo CHAT message với ID duy nhất
        const payload = {
          type: 'CHAT',
          id: msgId(),           // "msg-1700000000000-a3b4" — dùng để track ACK
          from: PEER_ID,
          to: targetId,
          content: maybeEncrypt(content), // Mã hóa nếu có key
          timestamp: Date.now(),
        };

        log(`\x1b[90m→ Đang gửi tới ${target.name} (${target.host}:${target.port})...${encTag}\x1b[0m`);
        // sendWithAck không block — nó set timer ngầm và return ngay
        // ACK sẽ đến sau và được xử lý bởi messageHandler
        sendWithAck(target.host, target.port, payload);

      } catch (e) { log(`\x1b[31m[ERROR]\x1b[0m ${e.message}`); }
      return;
    }

    // ── /group <id1,id2> <nội dung> — Gửi tin nhóm ───────────────────────
    if (trimmed.startsWith('/group ')) {
      const parts = trimmed.slice(7).split(' ');
      // "peer-b,peer-c" → ["peer-b", "peer-c"]
      const targetIds = parts[0].split(',').map((s) => s.trim()).filter(Boolean);
      const content   = parts.slice(1).join(' ');

      if (!targetIds.length || !content) {
        log('Cách dùng: /group <peer-a,peer-b> <nội dung>');
        return;
      }

      try {
        const peers = await getPeers();
        // Tạo Map để lookup O(1) thay vì find() O(n) mỗi lần
        const peerMap = Object.fromEntries(peers.map((p) => [p.id, p]));

        // Gửi tới từng peer trong nhóm RIÊNG LẼ (mỗi kết nối TCP riêng)
        for (const targetId of targetIds) {
          const target = peerMap[targetId];
          if (!target) {
            log(`\x1b[33m[SKIP]\x1b[0m Peer "${targetId}" không tìm thấy hoặc offline.`);
            continue; // Bỏ qua peer này, tiếp tục peer tiếp theo
          }

          // Mỗi tin nhắn group có msgId RIÊNg để ACK track độc lập
          const payload = {
            type: 'GROUP_CHAT',
            id: msgId(),
            from: PEER_ID,
            to: targetIds, // Danh sách tất cả người nhận
            content: maybeEncrypt(content), // Mã hóa nếu có key
            timestamp: Date.now(),
          };

          log(`\x1b[90m→ Group msg tới ${target.name} (${target.host}:${target.port})...${encTag}\x1b[0m`);
          sendWithAck(target.host, target.port, payload);
        }
      } catch (e) { log(`\x1b[31m[ERROR]\x1b[0m ${e.message}`); }
      return;
    }

    // ── /broadcast <nội dung> — Gửi tất cả ──────────────────────────────
    if (trimmed.startsWith('/broadcast ')) {
      const content = trimmed.slice(11).trim();
      if (!content) { log('Cách dùng: /broadcast <nội dung>'); return; }

      try {
        const peers = await getPeers();
        // Lọc bỏ chính mình — không tự gửi cho mình
        const others = peers.filter((p) => p.id !== PEER_ID);

        if (others.length === 0) {
          log('\x1b[33mKhông có peer nào khác online để broadcast.\x1b[0m');
          return;
        }

        // Gửi tới mỗi peer online (trừ mình)
        for (const target of others) {
          const payload = {
            type: 'BROADCAST',
            id: msgId(), // Mỗi lần gửi có msgId riêng để track ACK
            from: PEER_ID,
            content: maybeEncrypt(content), // Mã hóa nếu có key
            timestamp: Date.now(),
          };

          log(`\x1b[90m→ Broadcast tới ${target.name} (${target.host}:${target.port})...${encTag}\x1b[0m`);
          sendWithAck(target.host, target.port, payload);
        }
      } catch (e) { log(`\x1b[31m[ERROR]\x1b[0m ${e.message}`); }
      return;
    }

    // Lệnh không nhận dạng được
    log(`\x1b[33mLệnh không hợp lệ. Gõ /help để xem danh sách lệnh.\x1b[0m`);
  }

  // ── Gắn event handler cho readline ──────────────────────────────────────
  // Event 'line': được emit mỗi khi user nhấn Enter
  rl.on('line', async (line) => {
    await handleCommand(line); // Xử lý lệnh
    rl.prompt();               // Hiện lại prompt sau khi xử lý xong
  });

  // Trả về readline interface để peer.js gọi:
  // 1. logger.setRl(rl) — để log() prompt lại sau khi in
  // 2. rl.prompt()       — để bắt đầu hiển thị prompt
  return rl;
}

// Export factory function
module.exports = { createCLI };
