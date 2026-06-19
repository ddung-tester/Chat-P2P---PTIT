# 🎓 Hệ Thống Chat Ngang Hàng P2P (Peer-to-Peer Chat System)

> **Bài Tập Lớn — Môn: Các Hệ Thống Phân Tán**  
> **Chủ đề 3: Phát triển hệ thống chat ngang hàng P2P**  
> Học viện Công nghệ Bưu chính Viễn thông (PTIT) — Khoa Đào tạo Sau Đại học

---

## 📋 Thông Tin Dự Án

| Thông tin | Nội dung |
|---|---|
| **Môn học** | Các Hệ Thống Phân Tán |
| **Chương trình** | Thạc sĩ — Kỳ II |
| **Đơn vị** | Học viện Công nghệ Bưu chính Viễn thông (PTIT) |
| **Chủ đề** | Chủ đề 3 — Peer-to-Peer Chat System |
| **Ngôn ngữ** | JavaScript (Node.js, ES6+) |
| **Kiến trúc** | Hybrid P2P + Bootstrap Tracker |
| **Tài liệu báo cáo** | [`REPORT.md`](./REPORT.md) |

---

## 📝 Giới Thiệu

Dự án xây dựng hệ thống chat ngang hàng trong đó **mỗi peer vừa là client vừa là server**. Tin nhắn chat được truyền **trực tiếp giữa các peer qua TCP Socket**, không đi qua máy chủ trung tâm.

Hệ thống áp dụng mô hình **Hybrid P2P**: Bootstrap Server chỉ hỗ trợ khám phá peer (peer discovery) và theo dõi trạng thái online/offline. Sau khi khám phá, mọi nội dung tin nhắn được truyền **100% trực tiếp** từ peer tới peer.

```
  Peer A ─────── TCP Socket (tin nhắn trực tiếp) ──────► Peer B
     │                                                      │
     └────── HTTP /heartbeat ──► Bootstrap Server ◄─────────┘
                                   (Chỉ là Tracker)
```

> **Nguyên tắc cốt lõi**: Bootstrap Server **KHÔNG BAO GIỜ** chuyển tiếp tin nhắn chat giữa các peer.

---

## ✨ Tính Năng

### Chức năng bắt buộc
| # | Tính năng | Mô tả |
|---|---|---|
| 1 | **Tham gia mạng** | Peer tự động đăng ký với Bootstrap Server khi khởi động |
| 2 | **Chat 1-1 trực tiếp** | Gửi tin nhắn qua TCP Socket trực tiếp giữa hai peer |
| 3 | **Chat nhóm** | Gửi tin nhắn đồng thời tới một nhóm peer được chỉ định |
| 4 | **Peer Discovery** | Khám phá danh sách peer online qua Bootstrap Tracker |
| 5 | **Trạng thái Online/Offline** | Heartbeat 5 giây, tự động timeout 15 giây |
| 6 | **Truyền tin đáng tin cậy** | ACK ở tầng ứng dụng, retry tối đa 3 lần, timeout 5 giây |
| 7 | **Khử trùng lặp** | Deduplication bằng `Set<msgId>` tránh hiển thị tin trùng khi retry |

### Chức năng nâng cao (Bonus)
| # | Tính năng | Mô tả |
|---|---|---|
| 8 | **Broadcast** | Phát tin nhắn tới tất cả peer đang online trong mạng |
| 9 | **Store-and-Forward** | Lưu và chuyển tiếp tin nhắn tự động khi peer đích offline |
| 10 | **Mã hóa AES-256-CBC** | Mã hóa đầu-cuối với khóa chia sẻ trước (Pre-Shared Key) |
| 11 | **Web GUI** | Giao diện Web dark mode glassmorphism, thời gian thực (Socket.IO) |
| 12 | **Churn Simulation** | Script tự động mô phỏng peer liên tục tham gia/rời mạng |
| 13 | **Kiểm thử tự động** | 38 test cases / 9 test suites — `38 passed, 0 failed ✅` |

---

## 🏗️ Kiến Trúc Hệ Thống

```
Bootstrap/Tracker Server (HTTP :3000)
├── Peer Registry (Map<id, {host, port, lastSeen}>)
└── Offline Message Queue (Store-and-Forward)
        │
        │  HTTP REST API (Discovery Only)
        │  POST /register | GET /peers | POST /heartbeat
        │  POST /leave    | POST /store
        │
   ┌────┴────┐
   ▼         ▼
Peer Node A              Peer Node B
├── TCP Server :5001     ├── TCP Server :5002
├── TCP Client           ├── TCP Client
└── CLI / Web :6001      └── CLI / Web :6002
         │                        │
         └── TCP Direct (CHAT) ───┘
             Tin nhắn KHÔNG qua Bootstrap
```

### Cấu trúc module

```
Chat P2P/
├── bootstrap-server/
│   ├── server.js           # Express HTTP REST API — Tracker
│   └── peerRegistry.js     # Quản lý peer registry + offline queue
│
├── peer-node/
│   ├── peer.js             # Entry point — Orchestrator (DI wiring)
│   ├── tcpServer.js        # TCP Server: nhận tin từ peer khác (NDJSON)
│   ├── tcpClient.js        # TCP Client: gửi tin trực tiếp tới peer
│   ├── messageHandler.js   # Xử lý CHAT / GROUP_CHAT / BROADCAST / ACK / ERROR
│   ├── reliableDelivery.js # ACK + Retry State Machine + Store-and-Forward trigger
│   ├── bootstrapClient.js  # HTTP client: /register, /peers, /heartbeat, /store
│   ├── crypto.js           # AES-256-CBC encrypt/decrypt, SHA-256 key derivation
│   ├── state.js            # Shared state: pendingAcks Map, receivedMsgIds Set
│   ├── eventBus.js         # Singleton EventEmitter — bridge Core ↔ Web GUI
│   ├── logger.js           # Logging với readline prompt restoration
│   ├── cli.js              # CLI interface (readline)
│   ├── webServer.js        # Web GUI server (Express + Socket.IO)
│   └── public/
│       ├── index.html      # HTML structure (PTIT P2P Chat UI)
│       ├── style.css       # Dark mode glassmorphism design
│       └── app.js          # Frontend logic (Socket.IO client)
│
├── churn-sim.js            # Kịch bản mô phỏng peer churn tự động
├── churn-sim.ps1           # PowerShell wrapper cho churn-sim
├── test.js                 # Bộ kiểm thử tự động (38 test cases, 9 suites)
├── REPORT.md               # Báo cáo kỹ thuật chi tiết
└── README.md               # File này
```

---

## 🚀 Hướng Dẫn Cài Đặt & Chạy Demo

### Yêu cầu
- **Node.js** >= 16.x
- **npm** >= 7.x

### Bước 1: Cài đặt

```bash
# Bootstrap Server
cd bootstrap-server
npm install

# Peer Node
cd ../peer-node
npm install
```

### Bước 2: Chạy Demo — Chế độ CLI

Mở **4 cửa sổ terminal riêng biệt**:

```bash
# Terminal 1 — Bootstrap Server (Tracker)
cd bootstrap-server
npm run dev

# Terminal 2 — Peer A (Dũng)
cd peer-node
node peer.js --id peer-a --name Dung --port 5001

# Terminal 3 — Peer B (Hiếu)
cd peer-node
node peer.js --id peer-b --name Hieu --port 5002

# Terminal 4 — Peer C (Việt)
cd peer-node
node peer.js --id peer-c --name Viet --port 5003
```

### Bước 3: Chạy Demo — Chế độ Web GUI

```bash
# Thêm tham số --gui true để bật giao diện Web
cd peer-node
node peer.js --id peer-a --name Dung --port 5001 --gui true  # → http://localhost:6001
node peer.js --id peer-b --name Hieu --port 5002 --gui true  # → http://localhost:6002
node peer.js --id peer-c --name Viet --port 5003 --gui true  # → http://localhost:6003
```

Mở trình duyệt tại:
- Dũng: `http://localhost:6001`
- Hiếu: `http://localhost:6002`
- Việt: `http://localhost:6003`

### Chạy với Mã Hóa Đầu-Cuối (AES-256-CBC)

> 💡 **Ghi chú**: `dung123` chỉ là khóa ví dụ. Bạn có thể thay bằng bất kỳ chuỗi bí mật nào.  
> **Tất cả peer phải dùng cùng một khóa** thì mới giải mã được tin nhắn của nhau.

```bash
# Ví dụ chạy với khóa bí mật "dung123"
# (thay "dung123" bằng khóa tùy chọn — miễn là tất cả peer dùng chung một khóa)
node peer.js --id peer-a --name Dung --port 5001 --key dung123
node peer.js --id peer-b --name Hieu --port 5002 --key dung123
node peer.js --id peer-c --name Viet --port 5003 --key dung123

# Kết hợp Web GUI + Mã hóa
node peer.js --id peer-a --name Dung --port 5001 --gui true --key dung123
node peer.js --id peer-b --name Hieu --port 5002 --gui true --key dung123
node peer.js --id peer-c --name Viet --port 5003 --gui true --key dung123
```

---

## 🖥️ Lệnh CLI

Sau khi khởi chạy peer, gõ các lệnh sau trong terminal:

| Lệnh | Mô tả |
|------|-------|
| `/help` | Danh sách tất cả lệnh |
| `/list` | Xem danh sách peer đang online |
| `/msg <peer-id> <nội dung>` | Gửi tin nhắn 1-1 trực tiếp |
| `/group <peer-a,peer-b> <nội dung>` | Gửi tin nhắn nhóm |
| `/broadcast <nội dung>` | Phát tin tới tất cả peer online |
| `/status` | Xem thông tin peer hiện tại |
| `/exit` | Rời mạng và tắt peer |

---

## 🎬 Kịch Bản Demo Chính Thức

| Bước | Hành động | Điều được kiểm chứng |
|------|-----------|----------------------|
| 1 | Chạy Bootstrap Server | Tracker hoạt động, hỗ trợ discovery |
| 2 | Chạy Peer A, B, C ở 3 terminal | Nhiều peer độc lập cùng hoạt động |
| 3 | `peer-a> /list` | Peer discovery — thấy B và C |
| 4 | `peer-a> /msg peer-b Hello!` | Chat P2P trực tiếp qua TCP |
| 5 | Peer B nhận và gửi ACK | Truyền tin đáng tin cậy (ACK) |
| 6 | `peer-a> /group peer-b,peer-c Hello group` | Chat nhóm |
| 7 | `peer-a> /broadcast Hello all!` | Broadcast toàn mạng |
| 8 | Tắt Peer C (Ctrl+C) | Mô phỏng peer mất kết nối |
| 9 | `peer-a> /msg peer-c Are you there?` | Retry × 3 → FAILED → Store-and-Forward |
| 10 | Khởi động lại Peer C | Nhận offline message tự động |

---

## 📨 Giao Thức Tin Nhắn (TCP + JSON)

Tất cả gói tin TCP sử dụng định dạng **Newline-Delimited JSON (NDJSON)**: mỗi JSON kết thúc bằng `\n` để phân cách ranh giới trong TCP stream.

```json
// Tin nhắn 1-1
{ "type": "CHAT",       "id": "msg-001", "from": "peer-a", "to": "peer-b",           "content": "Hello!", "timestamp": 1700000000000 }

// Tin nhắn nhóm
{ "type": "GROUP_CHAT", "id": "msg-002", "from": "peer-a", "to": ["peer-b","peer-c"], "content": "Xin chào!", "timestamp": 1700000000001 }

// Phát tin toàn mạng
{ "type": "BROADCAST",  "id": "msg-003", "from": "peer-a",                             "content": "Hello all!", "timestamp": 1700000000002 }

// Xác nhận nhận (ACK)
{ "type": "ACK",        "id": "msg-001", "from": "peer-b" }
```

> Khi bật mã hóa (`--key`), trường `content` có định dạng `enc:<iv_hex>:<ciphertext_hex>`.

---

## 🔁 Cơ Chế Truyền Tin Đáng Tin Cậy (ACK + Retry)

```
sendWithAck(payload)
  → Đặt timer 5 giây (TRƯỚC khi gửi — tránh double execution bug)
  → Lưu vào pendingAcks Map
  → Mở TCP → Gửi JSON message → Giữ socket chờ ACK
      ├── Nhận ACK → clearTimeout → DELIVERED ✓
      ├── Timeout 5s → Retry (tối đa 3 lần)
      └── Hết retry → FAILED ✗ → Kích hoạt Store-and-Forward
```

| Tham số | Giá trị |
|---------|---------|
| ACK Timeout | 5 giây |
| Max Retry | 3 lần (4 lần gửi tổng cộng) |
| Thời gian tối đa | ~20 giây |
| Deduplication | Set (O(1) lookup, FIFO giới hạn 1000 entries) |

---

## 📨 Store-and-Forward (Lưu và Chuyển Tiếp)

Khi peer đích offline và retry thất bại:

```
Peer A → TCP ECONNREFUSED
Peer A → Retry 1/3 → 2/3 → 3/3 → FAILED
Peer A → POST /store {to: "peer-c", from: "peer-a", payload}
Bootstrap → offlineQueue["peer-c"].push(message)

Peer C khởi động lại:
→ POST /register
→ Bootstrap trả về pendingMessages
→ Peer C hiển thị: [OFFLINE MSG from peer-a] (stored Xs ago)
```

| Giới hạn | Giá trị |
|---------|---------|
| Max tin nhắn/peer | 50 tin |
| TTL tin nhắn | 1 giờ (3600 giây) |

---

## 🔒 Mã Hóa Đầu-Cuối AES-256-CBC

- **Thuật toán**: AES-256-CBC (chuẩn NIST)
- **Khóa**: SHA-256(passphrase) → 32-byte key
- **IV**: 16 bytes ngẫu nhiên mỗi lần mã hóa (chống replay attack)
- **Định dạng**: `enc:<iv_hex>:<ciphertext_hex>`
- **Thư viện**: Module `crypto` built-in của Node.js (không cài thêm)

| Tình huống | Kết quả hiển thị |
|-----------|-----------------|
| Đúng khóa | ✅ Hiển thị plaintext + badge `[ENC]✅` |
| Sai khóa | ❌ `[DECRYPTION FAILED — wrong key]` |
| Không có khóa | 🔑 `[ENCRYPTED — không có key để giải mã]` |

---

## 🧪 Kiểm Thử Tự Động

```powershell
# 1. Khởi động Bootstrap Server trên cổng riêng
$env:PORT=3001; node bootstrap-server/server.js

# 2. Chạy bộ kiểm thử tự động
$env:BOOTSTRAP_PORT=3001; node test.js
```

**Kết quả mong đợi**: `38 passed, 0 failed ✅`

| Suite | Nội dung | Tests |
|-------|----------|-------|
| Suite 1 | Bootstrap REST API | 8 |
| Suite 2 | TCP CHAT → ACK | 2 |
| Suite 3 | GROUP_CHAT → ACK | 4 |
| Suite 4 | BROADCAST → ACK | 2 |
| Suite 5 | ACK timeout | 1 |
| Suite 6 | Message Deduplication | 2 |
| Suite 7 | Peer Churn Simulation | 5 |
| Suite 8 | Store-and-Forward | 6 |
| Suite 9 | AES-256-CBC Encryption | 8 |
| **Tổng** | | **38** |

---

## 🌪️ Mô Phỏng Churn Tự Động

```bash
# Chạy 3 vòng mô phỏng peer tham gia/rời mạng liên tục
node churn-sim.js --rounds 3

# Hoặc dùng PowerShell wrapper
.\churn-sim.ps1 -Rounds 3
```

Script tự động tạo/tắt 3 peer (`Churn-Alpha`, `Churn-Beta`, `Churn-Gamma`) để kiểm thử tính tự phục hồi của hệ thống khi peer bất ngờ ngắt kết nối.

---

## 📊 Kết Quả Đánh Giá

| Tiêu chí | Kết quả |
|---------|---------|
| Tính P2P | ✅ Tin nhắn đi trực tiếp TCP — không qua Bootstrap |
| Peer Discovery | ✅ Heartbeat 5s, auto-timeout 15s, graceful leave |
| Độ tin cậy | ✅ ACK + Retry 3 lần, deduplication O(1) |
| Bảo mật | ✅ AES-256-CBC E2E, IV ngẫu nhiên, SHA-256 key |
| Fault Tolerance | ✅ Store-and-Forward (50 tin, TTL 1h), Churn Simulation |
| Kiểm thử | ✅ 38/38 test cases passed |
| Giao diện | ✅ CLI (readline) + Web GUI (Socket.IO dark mode) |

---

## 📚 Tài Liệu

- **Báo cáo kỹ thuật chi tiết**: [`REPORT.md`](./REPORT.md) — Kiến trúc, giao thức, thuật toán, kịch bản kiểm thử
- **Node.js Documentation** — `net` module, `crypto` module
- **Express.js Documentation** — REST API server
- **Socket.IO Documentation** — Realtime Web GUI communication

---

*Bài tập lớn — Học viện Công nghệ Bưu chính Viễn thông (PTIT) 🎓*
