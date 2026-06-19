# P2P Chat System

Hệ thống chat ngang hàng (Peer-to-Peer) — Môn Các Hệ Thống Phân Tán, Thạc sĩ Kỳ II.

## Kiến trúc

```
Peer A ──────── TCP trực tiếp ────────► Peer B
   │                                       │
   └─── HTTP /heartbeat ──► Bootstrap ◄────┘
                              Server
                           (chỉ tracker)
```

- **Bootstrap Server**: Tracker duy nhất, chỉ lưu danh sách peer (host:port). **Không** chuyển tiếp tin nhắn.
- **Peer Node**: Mỗi peer vừa mở TCP server (nhận tin), vừa dùng TCP client (gửi tin trực tiếp).

## Cài đặt

```bash
# Bootstrap Server
cd bootstrap-server
npm install

# Peer Node
cd ../peer-node
npm install
```

## Chạy Demo

```bash
# Terminal 1 — Bootstrap Server
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

### Khởi chạy với Giao diện Web (Web GUI Mode)

Nếu muốn trải nghiệm giao diện Web UI mượt mà thay vì dùng CLI, bạn hãy thêm tham số `--gui true` (hoặc `--gui 1`) khi khởi chạy các peer:
```bash
cd peer-node

# Khởi chạy Peer A với Web GUI (Giao diện Web chạy ở cổng 6001 = 5001 + 1000)
node peer.js --id peer-a --name Dung --port 5001 --gui true

# Khởi chạy Peer B với Web GUI (Giao diện Web chạy ở cổng 6002 = 5002 + 1000)
node peer.js --id peer-b --name Hieu --port 5002 --gui true

# Khởi chạy Peer C với Web GUI (Giao diện Web chạy ở cổng 6003 = 5003 + 1000)
node peer.js --id peer-c --name Viet --port 5003 --gui true
```
Sau đó, mở trình duyệt web và truy cập các URL tương ứng:
- Dũng: `http://localhost:6001`
- Hiếu: `http://localhost:6002`
- Việt: `http://localhost:6003`

---

## Lệnh CLI (trong terminal của mỗi peer)

| Lệnh | Mô tả |
|------|-------|
| `/help` | Danh sách lệnh |
| `/list` | Xem peer đang online |
| `/msg <peer-id> <nội dung>` | Gửi tin trực tiếp |
| `/group <peer-a,peer-b> <nội dung>` | Gửi tin nhóm |
| `/broadcast <nội dung>` | Gửi tới tất cả peer |
| `/status` | Xem thông tin peer hiện tại |
| `/exit` | Rời mạng và tắt peer |

## Kịch bản demo

1. Chạy Bootstrap → Chạy Peer A, B, C
2. Peer A: `/list` → thấy B và C
3. Peer A: `/msg peer-b Hello B` → B nhận, tự động ACK
4. Peer A: `/group peer-b,peer-c Hello group` → group chat
5. Tắt Peer C bằng `Ctrl+C` → đợi 15s
6. Peer A: `/msg peer-c Hi?` → timeout 5s, retry 3 lần, FAILED
7. Khởi động lại Peer C → peer C tự đăng ký lại
8. Peer A: `/broadcast Hello all` → A gửi tới B và C

## Giao thức tin nhắn (TCP — JSON)

```json
{ "type": "CHAT",       "id": "msg-001", "from": "peer-a", "to": "peer-b",           "content": "Hello", "timestamp": 0 }
{ "type": "GROUP_CHAT", "id": "msg-002", "from": "peer-a", "to": ["peer-b","peer-c"], "content": "Hello", "timestamp": 0 }
{ "type": "BROADCAST",  "id": "msg-003", "from": "peer-a",                            "content": "Hello", "timestamp": 0 }
{ "type": "ACK",        "id": "msg-001", "from": "peer-b" }
```

---

## Các Tính Năng Nâng Cao (Bonus)

### 1. Mã hóa đầu-cuối AES-256-CBC (End-to-End Encryption)
Mã hóa toàn bộ nội dung tin nhắn chat giữa các peer bằng thuật toán AES-256-CBC với khóa chia sẻ trước (PSK):

#### Chạy chế độ CLI với mã hóa:
```bash
# Khởi chạy các peer trong Terminal riêng biệt với cùng một khóa bí mật
node peer.js --id peer-a --name Dung --port 5001 --key dung123
node peer.js --id peer-b --name Hieu --port 5002 --key dung123
node peer.js --id peer-c --name Viet --port 5003 --key dung123
```
- Khi nhận được tin nhắn đã mã hóa đúng khóa, CLI sẽ hiển thị nhãn `[ENC]✅`.
- Nếu sai khóa bí mật hoặc không truyền khóa, tin nhắn sẽ hiển thị lỗi giải mã `[DECRYPTION FAILED]`.

#### Chạy chế độ Web GUI với mã hóa:
```bash
# Khởi chạy các peer với giao diện Web và cùng khóa bí mật
node peer.js --id peer-a --name Dung --port 5001 --gui true --key dung123
node peer.js --id peer-b --name Hieu --port 5002 --gui true --key dung123
node peer.js --id peer-c --name Viet --port 5003 --gui true --key dung123
```
- Trên giao diện Web GUI, bạn sẽ thấy biểu tượng ổ khóa màu xanh lá cây `🔒 AES-256` hiển thị ở dưới ô nhập tin nhắn và trạng thái mã hóa trong bảng "Thông tin kết nối" hiển thị `🔒 AES-256-CBC`.
- Tất cả tin nhắn gửi đi qua Web GUI cũng sẽ tự động được mã hóa và giải mã trong suốt (transparently).

### 2. Lưu và Chuyển Tiếp Tin Nhắn (Store-and-Forward)
Khi một peer đích ngoại tuyến (offline), tin nhắn TCP gửi đến peer đó sau 3 lần thử lại thất bại sẽ tự động được gửi và lưu tạm thời trên Bootstrap Server:
- Khi peer nhận đăng ký trực tuyến trở lại (`POST /register`), Bootstrap Server tự động chuyển giao các tin nhắn đang chờ.
- Trên CLI peer nhận sẽ hiển thị nhãn đặc biệt: `[OFFLINE MSG from peer-a] <nội dung> (stored Xs ago)`.

### 3. Mô phỏng Churn tự động (Churn Simulation)
Một kịch bản tự động hóa quá trình các peer liên tục vào/ra mạng (churn) để kiểm thử tính tự phục hồi và khả năng chịu lỗi của hệ thống:
```bash
# Chạy mô phỏng churn tự động (3 vòng mặc định)
node churn-sim.js
```

---

## Cơ chế Kiểm Thử Tự Động (Automated Testing)

Dự án đi kèm bộ kiểm thử tự động toàn diện kiểm thử tất cả các tính năng core và nâng cao (gồm **38 test cases** chia làm **9 suites**):
```bash
# 1. Khởi động Bootstrap Server (Ví dụ trên cổng 3001 để tránh xung đột)
$env:PORT=3001; node bootstrap-server/server.js

# 2. Chạy bộ kiểm thử tự động nhắm vào Bootstrap Server cổng 3001
$env:BOOTSTRAP_PORT=3001; node test.js
```
Kết quả kiểm thử mong đợi: `38 passed, 0 failed ✅`.

---

## Báo Cáo Chi Tiết Dự Án

Xem chi tiết kiến trúc phần mềm, quy trình khám phá peer (sequence diagrams), định dạng giao thức và kịch bản thử nghiệm tại file: [REPORT.md](file:///d:/Th%E1%BA%A1c%20s%C4%A9%20-%20K%E1%BB%B3%20II/C%C3%A1c%20h%E1%BB%87%20th%E1%BB%91ng%20ph%C3%A2n%20t%C3%A1n/Chat%20P2P/REPORT.md).
