/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  crypto.js — Mã hóa/Giải mã AES-256-CBC                     ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * MỤC TIÊU:
 *   Mã hóa trường `content` của tin nhắn CHAT/GROUP_CHAT/BROADCAST
 *   trước khi gửi qua TCP, để nội dung không đọc được nếu bị chặn.
 *
 * THUẬT TOÁN: AES-256-CBC
 *   - AES (Advanced Encryption Standard): chuẩn mã hóa được NIST công nhận
 *   - 256-bit key: bảo mật cao nhất trong họ AES (128/192/256-bit)
 *   - CBC (Cipher Block Chaining): mỗi block phụ thuộc block trước → khó phân tích
 *   - IV (Initialization Vector): 16 bytes ngẫu nhiên mỗi lần mã hóa
 *     → Cùng plaintext + khác IV → khác ciphertext → chống replay attack
 *
 * FORMAT MÃ HÓA:
 *   "enc:<iv_hex>:<ciphertext_hex>"
 *   Ví dụ: "enc:a1b2c3...:<32 bytes hex>:d4e5f6..."
 *
 *   Tại sao encode hex thay vì base64?
 *   → Hex dễ đọc hơn khi debug, không có ký tự đặc biệt gây vấn đề JSON
 *
 * PRE-SHARED KEY (PSK):
 *   Tất cả peer phải dùng cùng 1 key khi khởi chạy (--key <secret>).
 *   Key được hash thành 32 bytes (256-bit) bằng SHA-256 để đảm bảo
 *   đúng độ dài bất kể user nhập key ngắn hay dài.
 *
 *   Giới hạn: PSK là đơn giản nhất cho hệ học thuật. Production cần
 *   Diffie-Hellman key exchange để không chia sẻ key plaintext.
 *
 * MODULE: Node.js built-in `crypto` — không cần cài thêm package
 */

'use strict';

const crypto = require('crypto');

// Tiền tố để nhận biết ciphertext trong trường `content`
const ENC_PREFIX = 'enc:';

// ─── Derive key: hash PSK thành 256-bit key ───────────────────────────────────
/**
 * Chuyển bất kỳ chuỗi nào thành 32-byte Buffer (AES-256 key).
 * Dùng SHA-256 để đảm bảo key luôn đúng 32 bytes.
 *
 * @param {string} passphrase  Key người dùng nhập (bất kỳ độ dài nào)
 * @returns {Buffer}           32-byte Buffer dùng làm AES key
 */
function deriveKey(passphrase) {
  return crypto.createHash('sha256').update(passphrase, 'utf8').digest();
}

// ─── Mã hóa ──────────────────────────────────────────────────────────────────
/**
 * Mã hóa plaintext bằng AES-256-CBC với IV ngẫu nhiên.
 *
 * @param {string} plaintext   Nội dung cần mã hóa
 * @param {string} passphrase  Pre-shared key
 * @returns {string}           "enc:<iv_hex>:<ciphertext_hex>"
 */
function encrypt(plaintext, passphrase) {
  const key = deriveKey(passphrase);
  const iv  = crypto.randomBytes(16); // 16 bytes IV (128-bit) — chuẩn AES block size

  const cipher     = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted  = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  // Format: "enc:<iv>:<ciphertext>" — cả hai đều ở dạng hex
  return `${ENC_PREFIX}${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

// ─── Giải mã ─────────────────────────────────────────────────────────────────
/**
 * Giải mã ciphertext từ định dạng "enc:<iv>:<ciphertext>".
 *
 * @param {string} encoded     Chuỗi mã hóa từ encrypt()
 * @param {string} passphrase  Pre-shared key (phải giống bên gửi)
 * @returns {string}           Plaintext nếu thành công, hoặc "[DECRYPTION FAILED]"
 */
function decrypt(encoded, passphrase) {
  try {
    // Tách: "enc:<iv_hex>:<cipher_hex>"
    const withoutPrefix = encoded.slice(ENC_PREFIX.length);
    const colonIdx = withoutPrefix.indexOf(':');
    if (colonIdx === -1) return '[DECRYPTION FAILED — invalid format]';

    const ivHex     = withoutPrefix.slice(0, colonIdx);
    const cipherHex = withoutPrefix.slice(colonIdx + 1);

    const key      = deriveKey(passphrase);
    const iv       = Buffer.from(ivHex, 'hex');
    const cipherBuf= Buffer.from(cipherHex, 'hex');

    const decipher  = crypto.createDecipheriv('aes-256-cbc', key, iv);
    const decrypted = Buffer.concat([
      decipher.update(cipherBuf),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');

  } catch (_) {
    // Sai key hoặc dữ liệu bị hỏng → giải mã thất bại
    return '[DECRYPTION FAILED — wrong key or corrupted data]';
  }
}

// ─── Kiểm tra có phải ciphertext không ───────────────────────────────────────
/**
 * Kiểm tra nhanh xem chuỗi có phải là ciphertext từ encrypt() không.
 *
 * @param {string} content  Trường `content` của tin nhắn
 * @returns {boolean}
 */
function isEncrypted(content) {
  return typeof content === 'string' && content.startsWith(ENC_PREFIX);
}

// Export
module.exports = { encrypt, decrypt, isEncrypted };
