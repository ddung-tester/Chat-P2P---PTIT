/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  eventBus.js — Event Bus trung tâm cho GUI                   ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * VAI TRÒ:
 *   Singleton EventEmitter dùng làm cầu nối giữa các module core
 *   (messageHandler, reliableDelivery, bootstrapClient) và webServer (GUI).
 *
 *   Core modules EMIT events → webServer LISTEN → forward tới browser via Socket.IO.
 *
 * TẠI SAO CẦN MODULE RIÊNG?
 *   Nếu webServer import trực tiếp messageHandler để lắng nghe sự kiện
 *   → circular dependency (webServer → messageHandler → ... → webServer).
 *   EventBus độc lập giải quyết vấn đề này — giống cách state.js hoạt động.
 *
 * SINGLETON PATTERN:
 *   Node.js cache module sau lần require() đầu tiên.
 *   Mọi file require('./eventBus') đều nhận CÙNG MỘT EventEmitter instance.
 *
 * EVENTS PHÁT RA:
 *   'chat-received'      — Tin nhắn 1-1 nhận được từ peer khác
 *   'group-received'     — Tin nhắn nhóm nhận được
 *   'broadcast-received' — Broadcast nhận được
 *   'ack-received'       — ACK xác nhận tin đã gửi thành công
 *   'send-failed'        — Tin nhắn gửi thất bại sau MAX_RETRY
 *   'offline-msg'        — Tin nhắn offline nhận được khi đăng ký lại
 *   'stored-forward'     — Tin nhắn đã được lưu lên Bootstrap cho peer offline
 *   'log'                — Mọi log output (để hiển thị trên GUI console)
 */

'use strict';

const EventEmitter = require('events');

// Tạo một instance duy nhất — singleton qua module cache
const bus = new EventEmitter();

// Tăng giới hạn listener mặc định (10) vì nhiều module cùng lắng nghe
bus.setMaxListeners(30);

module.exports = bus;
