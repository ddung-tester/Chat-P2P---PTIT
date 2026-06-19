/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  bootstrapClient.js — Giao tiếp HTTP với Bootstrap Server   ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * VAI TRÒ:
 *   Gộp tất cả HTTP calls tới Bootstrap Server vào một module.
 *   Peer dùng module này để:
 *     1. Đăng ký khi khởi động (register)
 *     2. Lấy danh sách peer online (getPeers) — trước khi chat
 *     3. Duy trì trạng thái online (heartbeat) — mỗi 5 giây
 *     4. Thông báo offline khi tắt (leavePeer)
 *
 * TẠI SAO DÙNG AXIOS THAY VÌ FETCH?
 *   - axios có sẵn trong Node.js (không cần flag --experimental)
 *   - axios tự động throw error khi status code >= 400 (fetch không làm vậy)
 *   - axios parse JSON response tự động
 *   - axios có interceptors, timeout config dễ dàng hơn
 *
 * QUAN HỆ VỚI TIN NHẮN CHAT:
 *   Module này CHỈ dùng cho peer discovery (biết ai đang online ở đâu).
 *   Tin nhắn chat KHÔNG đi qua Bootstrap Server (ngoại trừ store-and-forward).
 *   Luồng: getPeers() → lấy host:port của peer đích → tcpClient.js gửi trực tiếp
 *
 * STORE-AND-FORWARD:
 *   Khi peer đích offline sau 3 retry → gọi storeMessage() → POST /store
 *   Bootstrap lưu lại → khi peer đích online → /register trả về pendingMessages
 *
 * INJECT PATTERN:
 *   Nhận config (BOOTSTRAP, PEER_ID...) như tham số thay vì hardcode.
 *   Giúp dễ test và tái sử dụng với config khác nhau.
 */

'use strict';

// axios: HTTP client phổ biến cho Node.js, hỗ trợ Promise/async-await
const axios = require('axios');

// logger: dùng log() để hiển thị trạng thái kết nối
const { log } = require('./logger');

// Import event bus để phát sự kiện cho GUI
const bus = require('./eventBus');

// ─── Factory function tạo bootstrap client ───────────────────────────────────
/**
 * Tạo client HTTP để giao tiếp với Bootstrap Server.
 *
 * @param {object} config
 *   @param {string} config.BOOTSTRAP   URL bootstrap server
 *   @param {string} config.PEER_ID     ID của peer này
 *   @param {string} config.PEER_NAME   Tên hiển thị
 *   @param {string} config.PEER_HOST   IP peer này đang lắng nghe TCP
 *   @param {number} config.PEER_PORT   Port TCP peer này
 *
 * @returns {{ registerPeer, getPeers, sendHeartbeat, leavePeer, storeMessage }}
 */
function createBootstrapClient({ BOOTSTRAP, PEER_ID, PEER_NAME, PEER_HOST, PEER_PORT }) {

  // ── registerPeer: Đăng ký khi khởi động ─────────────────────────────────
  /**
   * Gửi POST /register để thông báo với Bootstrap: "Tôi đang online tại đây".
   * Nếu Bootstrap không chạy → process.exit(1) vì không có peer discovery.
   *
   * Gọi 1 LẦN khi peer khởi động xong (sau khi TCP server sẵn sàng).
   * Tại sao phải TCP server sẵn sàng trước? Vì sau khi register, các peer khác
   * có thể kết nối TCP ngay lập tức — cần server đã listen.
   */
  async function registerPeer() {
    try {
      const res = await axios.post(`${BOOTSTRAP}/register`, {
        id: PEER_ID,
        name: PEER_NAME,
        host: PEER_HOST,
        port: PEER_PORT,
      });

      log(`\x1b[32m[OK]\x1b[0m Registered with bootstrap @ ${BOOTSTRAP}`);

      // Kiểm tra pending messages (tin nhắn gửi khi mình offline)
      const pending = res.data.pendingMessages || [];
      if (pending.length > 0) {
        log(`\x1b[35m[STORE-FORWARD]\x1b[0m \x1b[1m${pending.length} tin nhắn đang chờ bạn!\x1b[0m`);
        for (const item of pending) {
          const ago = Math.round((Date.now() - item.storedAt) / 1000);
          const p   = item.payload;
          const typeLabel = p.type === 'CHAT' ? '\x1b[36m[OFFLINE MSG]\x1b[0m' :
                            p.type === 'GROUP_CHAT' ? '\x1b[35m[OFFLINE GROUP]\x1b[0m' :
                            '\x1b[96m[OFFLINE BROADCAST]\x1b[0m';
          log(`${typeLabel} from \x1b[1m${p.from}\x1b[0m: ${p.content}  \x1b[90m(stored ${ago}s ago)\x1b[0m`);

          // Phát sự kiện cho GUI
          bus.emit('offline-msg', { from: p.from, content: p.content, type: p.type, storedAt: item.storedAt, id: p.id });
        }
      }

    } catch (e) {
      log(`\x1b[31m[ERROR]\x1b[0m Cannot reach bootstrap server: ${e.message}`);
      process.exit(1);
    }
  }

  // ── getPeers: Lấy danh sách peer online ──────────────────────────────────
  /**
   * Gửi GET /peers và trả về mảng peer đang online.
   * Được gọi khi user gõ /list, /msg, /group, /broadcast.
   *
   * Không có error handling ở đây — để caller tự xử lý (trong cli.js)
   * vì mỗi command có cách hiển thị lỗi khác nhau.
   *
   * @returns {Promise<Array<{id, name, host, port}>>}
   *   Mảng peer đang online (trừ chính mình — Bootstrap trả về tất cả,
   *   cli.js sẽ filter bỏ bản thân khi cần)
   */
  async function getPeers() {
    const res = await axios.get(`${BOOTSTRAP}/peers`);
    // res.data là object JavaScript đã được axios parse từ JSON response
    // res.data.peers là mảng peers, || [] phòng trường hợp null/undefined
    return res.data.peers || [];
  }

  // ── sendHeartbeat: Duy trì trạng thái online ─────────────────────────────
  /**
   * Gửi POST /heartbeat để Bootstrap biết peer còn sống.
   * Được gọi mỗi 5 giây qua setInterval trong peer.js.
   *
   * Không throw error nếu thất bại — chỉ log warning.
   * Lý do: mạng có thể tạm thời không ổn định. Nếu miss 1-2 heartbeat
   * mà throw error → peer tự tắt = quá nghiêm khắc.
   * Bootstrap chờ 15s mới timeout peer — đủ cho 3 lần miss heartbeat.
   */
  async function sendHeartbeat() {
    try {
      await axios.post(`${BOOTSTRAP}/heartbeat`, { id: PEER_ID });
      // Không log success để tránh spam terminal mỗi 5 giây
    } catch (e) {
      if (e.response && e.response.status === 404) {
        log(`\x1b[33m[WARN]\x1b[0m Heartbeat returned 404 (not found). Re-registering peer...`);
        await registerPeer().catch(err => {
          log(`\x1b[31m[ERROR]\x1b[0m Re-registration failed: ${err.message}`);
        });
      } else {
        // Chỉ log warning (màu vàng) — không crash
        log(`\x1b[33m[WARN]\x1b[0m Heartbeat failed: ${e.message}`);
      }
    }
  }

  // ── leavePeer: Thông báo rời mạng ────────────────────────────────────────
  /**
   * Gửi POST /leave khi peer tắt có chủ ý (/exit hoặc Ctrl+C).
   * Giúp Bootstrap cập nhật danh sách ngay lập tức (không cần đợi timeout 15s).
   *
   * Bỏ qua lỗi hoàn toàn (catch rỗng) vì:
   * - Peer đang tắt → không cần xử lý lỗi nữa
   * - Worst case: Bootstrap tự cleanup sau 15s
   */
  async function leavePeer() {
    try {
      await axios.post(`${BOOTSTRAP}/leave`, { id: PEER_ID });
    } catch (_) {
      // Bỏ qua — peer đang tắt
    }
  }

  // ── storeMessage: Lưu tin nhắn cho peer offline ────────────────────────
  /**
   * Gửi POST /store để Bootstrap lưu tin nhắn cho peer offline.
   * Được gọi từ reliableDelivery.js sau khi hết retry mà vẫn không connect được.
   *
   * @param {string} toId    Peer ID người nhận
   * @param {object} payload Payload tin nhắn gốc
   * @returns {Promise<boolean>} true nếu lưu thành công
   */
  async function storeMessage(toId, payload) {
    try {
      await axios.post(`${BOOTSTRAP}/store`, {
        to: toId,
        from: PEER_ID,
        payload,
      });
      log(`\x1b[35m[STORED]\x1b[0m ✉ Message queued for \x1b[1m${toId}\x1b[0m (will deliver when online)`);
      return true;
    } catch (e) {
      // Lưu thất bại (Bootstrap offline hoặc peer đang online)
      if (e.response && e.response.status === 409) {
        // 409: peer thực ra đang online — không cần store
        log(`\x1b[33m[WARN]\x1b[0m ${toId} is online now — store skipped`);
      } else {
        log(`\x1b[31m[ERROR]\x1b[0m Store-forward failed: ${e.message}`);
      }
      return false;
    }
  }

  // Trả về object với 5 hàm public
  return { registerPeer, getPeers, sendHeartbeat, leavePeer, storeMessage };
}

// Export factory function
module.exports = { createBootstrapClient };
