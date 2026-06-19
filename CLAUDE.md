# P2P Chat System — Project Context for AI

> **Đọc file này trước khi làm bất kỳ thứ gì.** File này tổng hợp toàn bộ ngữ cảnh dự án để AI không cần hỏi lại từ đầu và tránh lạc đề.

---

## 1. Tổng quan đề tài

**Chủ đề 3: Hệ thống chat ngang hàng P2P (Peer-to-Peer Chat System)**  
Môn: Các hệ thống phân tán — Thạc sĩ Kỳ II

Xây dựng hệ thống chat P2P trong đó mỗi peer **vừa là client vừa là server**. Tin nhắn được truyền **trực tiếp giữa các peer qua TCP socket**, không qua server trung tâm.

---

## 2. Kiến trúc đã chốt

### Công nghệ
- **Runtime**: Node.js
- **Giao thức**: TCP Socket (`net` module của Node.js)
- **Bootstrap Server**: Express.js (chỉ hỗ trợ peer discovery, KHÔNG chuyển tiếp tin nhắn)
- **Giao diện**: CLI (terminal) — React/UI là phần mở rộng, chỉ làm sau khi P2P core ổn

### Cấu trúc thư mục
```
Chat P2P/
├── bootstrap-server/       # Express server - peer registry/tracker
│   ├── package.json
│   └── server.js
├── peer-node/              # Mỗi peer chạy file này với tham số khác nhau
│   ├── package.json
│   └── peer.js
├── CLAUDE.md               # File này
└── README.md               # Hướng dẫn chạy (sinh cuối cùng)
```

### Nguyên tắc kiến trúc QUAN TRỌNG (không được vi phạm)
1. **Tin nhắn chat KHÔNG đi qua Bootstrap Server** — Bootstrap chỉ là tracker
2. **Peer A gửi trực tiếp Peer B bằng TCP socket** (`net.connect`)
3. **Mỗi peer mở TCP server** để nhận tin (`net.createServer`)
4. **Không dùng Socket.IO server trung tâm** để relay message
5. **Không biến thành web chat client-server**

---

## 3. Vai trò từng thành phần

### Bootstrap Server (`bootstrap-server/server.js`)
Chỉ có 4 REST API:
| Endpoint | Method | Chức năng |
|---|---|---|
| `/register` | POST | Peer đăng ký khi join mạng |
| `/peers` | GET | Lấy danh sách peer online |
| `/heartbeat` | POST | Peer báo hiệu còn sống (mỗi 5 giây) |
| `/leave` | POST | Peer thông báo rời mạng |

Lưu trữ bằng `Map<peerId, {name, host, port, lastSeen}>`. Peer bị đánh offline nếu `lastSeen` quá 15 giây.

### Peer Node (`peer-node/peer.js`)
Khởi động bằng: `node peer.js --id peer-a --name A --port 5001`

Mỗi peer:
- Mở TCP server trên port được chỉ định → nhận tin nhắn đến
- Dùng TCP client (`net.connect`) → gửi tin nhắn tới peer khác
- Gọi `/register` khi start
- Gọi `/heartbeat` mỗi 5 giây (setInterval)
- Gọi `/leave` + đóng TCP server khi `/exit`

---

## 4. Giao thức tin nhắn (JSON qua TCP)

Tất cả message gửi qua TCP là JSON, kết thúc bằng `\n`:

```json
// CHAT — tin nhắn trực tiếp
{ "type": "CHAT", "id": "msg-001", "from": "peer-a", "to": "peer-b", "content": "Hello B", "timestamp": 1700000000000 }

// GROUP_CHAT — tin nhắn nhóm (gửi lặp tới từng peer trong nhóm)
{ "type": "GROUP_CHAT", "id": "msg-002", "from": "peer-a", "to": ["peer-b", "peer-c"], "content": "Hello group", "timestamp": 1700000000000 }

// BROADCAST — gửi tới tất cả peer online
{ "type": "BROADCAST", "id": "msg-003", "from": "peer-a", "content": "Hello all", "timestamp": 1700000000000 }

// ACK — xác nhận nhận tin
{ "type": "ACK", "id": "msg-001", "from": "peer-b" }

// ERROR — lỗi
{ "type": "ERROR", "id": "msg-001", "reason": "unknown_peer" }
```

---

## 5. CLI Commands (trong peer terminal)

| Lệnh | Mô tả |
|---|---|
| `/help` | Hiện danh sách lệnh |
| `/list` | Lấy danh sách peer online từ Bootstrap |
| `/msg <peer-id> <nội dung>` | Gửi tin trực tiếp tới một peer |
| `/group <peer-a,peer-b> <nội dung>` | Gửi tin tới nhiều peer |
| `/broadcast <nội dung>` | Gửi tin tới tất cả peer online |
| `/status` | Hiện thông tin peer hiện tại |
| `/exit` | Rời mạng và tắt peer |

---

## 6. Cơ chế Reliable Delivery

```
Peer A gửi CHAT msg-001 → Peer B
Peer A chờ ACK (timeout 5 giây)
  - Nhận ACK → DELIVERED ✓
  - Timeout → RETRY (tối đa 3 lần)
  - Hết retry → FAILED ✗ (thông báo ra terminal)
```

Dùng `Map<msgId, {timer, retryCount}>` để track pending ACKs.

---

## 7. Luồng Peer Discovery

```
Peer khởi động
  → POST /register { id, name, host, port }
  → Bootstrap lưu vào Map + timestamp

Peer muốn chat
  → GET /peers → nhận [{id, name, host, port}]
  → Tìm peer đích trong danh sách
  → Mở TCP connection trực tiếp tới host:port của peer đích

Heartbeat (mỗi 5s)
  → POST /heartbeat { id }
  → Bootstrap cập nhật lastSeen

Peer offline
  → /leave hoặc lastSeen quá 15s → đánh offline
```

---

## 8. Thứ tự cài đặt (theo giai đoạn)

| Giai đoạn | Mục tiêu | File |
|---|---|---|
| 1 | Bootstrap Server với 4 API | `bootstrap-server/server.js` |
| 2 | TCP server nhận tin | `peer-node/peer.js` (phần server) |
| 3 | TCP client gửi tin | `peer-node/peer.js` (phần client) |
| 4 | Parse tham số, đăng ký Bootstrap | `peer-node/peer.js` (phần init) |
| 5 | CLI: /list, /msg, /exit | `peer-node/peer.js` (phần CLI) |
| 6 | ACK + timeout + retry (3 lần) | `peer-node/peer.js` (reliable) |
| 7 | Heartbeat + online/offline | `peer-node/peer.js` + bootstrap |
| 8 | Group chat (/group) | `peer-node/peer.js` |
| 9 | Broadcast (/broadcast) | `peer-node/peer.js` |
| 10 | Test lỗi, churn simulation | manual test |
| 11 | README + báo cáo | README.md & REPORT.md |

---

## 9. Lệnh chạy demo

```bash
# Terminal 1 — Bootstrap Server
cd bootstrap-server
npm install
npm run dev

# Terminal 2 — Peer A (Dũng)
cd peer-node
npm install
node peer.js --id peer-a --name Dung --port 5001

# Terminal 3 — Peer B (Hiếu)
node peer.js --id peer-b --name Hieu --port 5002

# Terminal 4 — Peer C (Việt)
node peer.js --id peer-c --name Viet --port 5003
```

---

## 10. Kịch bản demo chính thức

| Bước | Hành động | Điểm chứng minh |
|---|---|---|
| 1 | Chạy Bootstrap Server | Có tracker hỗ trợ discovery |
| 2 | Chạy Peer A, B, C ở 3 terminal | Nhiều peer độc lập |
| 3 | Peer A gõ `/list` | Peer discovery + online list |
| 4 | Peer A gõ `/msg peer-b Hello B` | Direct P2P chat qua TCP |
| 5 | Peer B nhận tin và gửi ACK | Truyền tin đáng tin cậy |
| 6 | Peer A gõ `/group peer-b,peer-c Hello group` | Group chat |
| 7 | Tắt Peer C đột ngột (Ctrl+C) | Mô phỏng lỗi/mất kết nối |
| 8 | Peer A gửi tin tới Peer C | Timeout, retry, FAILED |
| 9 | Chạy lại Peer C | Peer join lại + đăng ký lại |
| 10 | Peer A gõ `/broadcast Hello all` | Broadcast toàn mạng |

---

## 11. Tiêu chí hoàn thành

| Tiêu chí | Đạt khi |
|---|---|
| Đúng P2P | Tin nhắn chính đi trực tiếp Peer A → Peer B qua TCP socket |
| Đúng phân tán | Có nhiều peer process độc lập, giao tiếp qua mạng |
| Đúng discovery | Bootstrap chỉ hỗ trợ tìm peer và trạng thái online/offline |
| Đúng kỹ thuật | Mỗi peer vừa nhận vừa gửi, xử lý nhiều connection đồng thời |
| Đúng reliability | Có ACK, timeout 5s, retry tối đa 3 lần hoặc failed status |
| Đúng sản phẩm | Có source code, README, báo cáo, kịch bản thử nghiệm |

---

## 12. Lỗi cần tránh (quan trọng)

- ❌ Để Bootstrap Server chuyển tiếp tin nhắn chat
- ❌ Biến bài thành web chat client-server thông thường
- ❌ Dùng MySQL/DB làm nơi gửi/nhận tin giữa hai peer
- ❌ Nói "P2P thuần" nhưng message vẫn đi qua server
- ❌ Ưu tiên làm React/UI trước khi P2P TCP core chạy ổn
- ❌ Làm UI đẹp nhưng thiếu ACK, timeout, peer discovery

---

## 13. Nội dung báo cáo phải có

1. **Kiến trúc hệ thống**: Bootstrap/Tracker Server, Peer Node, sơ đồ peer discovery
2. **Giao thức trao đổi thông điệp**: các message type, cấu trúc JSON, luồng gửi/nhận/ACK
3. **Cơ chế peer discovery**: register → /peers → TCP direct → heartbeat → leave/timeout
4. **Xử lý lỗi và thử nghiệm**: peer mất kết nối, không phản hồi ACK, retry/failed, churn simulation

---

## 14. Hướng dẫn dùng AI (Vibe Coding có kiểm soát)

- Mỗi prompt chỉ yêu cầu **một module nhỏ** (theo thứ tự giai đoạn ở mục 8)
- Sau mỗi module **phải chạy thử ngay** trước khi tiếp tục
- Luôn nhắc rõ trong prompt: **"Bootstrap không chuyển tiếp tin nhắn"**
- Luôn nhắc rõ trong prompt: **"Peer dùng TCP socket (net module) gửi trực tiếp"**
- Ưu tiên code **đơn giản, chạy được local**, dễ demo, dễ giải thích

### Template prompt chuẩn khi yêu cầu AI viết code:
```
Hãy viết [tên module] cho hệ thống P2P Chat Node.js.
Yêu cầu bắt buộc:
- Tin nhắn chat KHÔNG đi qua Bootstrap Server.
- Bootstrap chỉ dùng để register, get peers, heartbeat, leave.
- Peer dùng TCP socket bằng module `net` để gửi trực tiếp tới peer khác.
- Mỗi peer vừa mở TCP server để nhận tin, vừa dùng TCP client để gửi tin.
- Code đơn giản, chạy local bằng nhiều terminal.
Context: [dán nội dung CLAUDE.md hoặc phần liên quan]
```
