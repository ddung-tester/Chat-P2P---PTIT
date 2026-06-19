# BÁO CÁO BÀI TẬP LỚN
# HỆ THỐNG CHAT NGANG HÀNG PHÂN TÁN (P2P CHAT SYSTEM)

---

| Thông tin | Nội dung |
|---|---|
| **Môn học** | Các Hệ Thống Phân Tán |
| **Chương trình** | Thạc sĩ — Kỳ II |
| **Đơn vị** | Học viện Công nghệ Bưu chính Viễn thông (PTIT) |
| **Công nghệ** | Node.js, TCP Socket, Express.js, Socket.IO |
| **Ngôn ngữ** | JavaScript (ES6+, 'use strict') |
| **Kiến trúc** | Hybrid P2P + Bootstrap Tracker |

---

## MỤC LỤC

1. [Giới thiệu và mục tiêu dự án](#1-giới-thiệu-và-mục-tiêu-dự-án)
2. [Kiến trúc hệ thống](#2-kiến-trúc-hệ-thống)
3. [Cơ chế khám phá peer và quản lý trạng thái](#3-cơ-chế-khám-phá-peer-và-quản-lý-trạng-thái)
4. [Giao thức trao đổi thông điệp (TCP + JSON)](#4-giao-thức-trao-đổi-thông-điệp-tcp--json)
5. [Cơ chế truyền tin đáng tin cậy (Reliable Delivery)](#5-cơ-chế-truyền-tin-đáng-tin-cậy-reliable-delivery)
6. [Mã hóa đầu-cuối AES-256-CBC](#6-mã-hóa-đầu-cuối-aes-256-cbc)
7. [Lưu và chuyển tiếp tin nhắn (Store-and-Forward)](#7-lưu-và-chuyển-tiếp-tin-nhắn-store-and-forward)
8. [Cấu trúc module và thiết kế phần mềm](#8-cấu-trúc-module-và-thiết-kế-phần-mềm)
9. [Giao diện người dùng](#9-giao-diện-người-dùng)
10. [Kết quả kiểm thử](#10-kết-quả-kiểm-thử)
11. [Kết luận và hướng phát triển](#11-kết-luận-và-hướng-phát-triển)

---

## 1. GIỚI THIỆU VÀ MỤC TIÊU DỰ ÁN

### 1.1. Tổng quan

Dự án xây dựng một **Hệ thống Chat Ngang Hàng (Peer-to-Peer Chat)** hoàn chỉnh trên môi trường Node.js. Hệ thống hiện thực đầy đủ các khái niệm cốt lõi của hệ thống phân tán: giao tiếp trực tiếp ngang hàng, khám phá mạng, truyền tin đáng tin cậy, mã hóa và khả năng chịu lỗi.

**Mục tiêu cốt lõi**: Các peer giao tiếp, gửi nhận tin nhắn trực tiếp với nhau qua **TCP Socket** mà **không đi qua bất kỳ máy chủ trung gian nào**. Đây là đặc tính bản chất của kiến trúc P2P thuần túy.

### 1.2. Các tính năng chính

| # | Tính năng | Mô tả |
|---|---|---|
| 1 | **P2P Direct Messaging** | Tin nhắn 1-1 qua TCP socket trực tiếp giữa hai peer |
| 2 | **Group Chat** | Gửi tin nhắn đồng thời tới một nhóm peer được chỉ định |
| 3 | **Broadcast** | Phát tin nhắn tới tất cả peer đang online trong mạng |
| 4 | **Peer Discovery** | Bootstrap server đóng vai trò tracker khám phá mạng |
| 5 | **ACK + Retry** | Cơ chế xác nhận nhận và gửi lại đảm bảo độ tin cậy |
| 6 | **Deduplication** | Khử trùng lặp tin nhắn khi có retry |
| 7 | **AES-256-CBC E2E** | Mã hóa đầu-cuối với khóa chia sẻ trước (Pre-Shared Key) |
| 8 | **Store-and-Forward** | Lưu và chuyển tiếp tin nhắn khi peer đích offline |
| 9 | **Churn Simulation** | Mô phỏng peer liên tục tham gia/rời mạng để kiểm thử |
| 10 | **Web GUI** | Giao diện web dark mode glassmorphism, thời gian thực |
| 11 | **Automated Tests** | Bộ kiểm thử tự động 38 test case, 9 test suite |

### 1.3. Quy trình phát triển hệ thống

Hệ thống được phát triển theo mô hình **Phát triển Tăng trưởng và Lặp (Incremental and Iterative Development)** với 6 giai đoạn rõ ràng:

```mermaid
gantt
    title Quy trình Phát triển Hệ thống Chat P2P
    dateFormat  YYYY-MM-DD
    section Nghiên cứu & Thiết kế
    Phân tích yêu cầu & Kiến trúc P2P :a1, 2026-06-01, 3d
    Thiết kế giao thức JSON/NDJSON & REST API :a2, after a1, 2d
    section Hiện thực Core Modules
    Bootstrap Server & Peer Discovery :b1, after a2, 4d
    Truyền tin TCP Socket Direct P2P :b2, after b1, 3d
    section Nâng cao & Tin cậy
    Reliability (ACK + Retry State Machine) :c1, after b2, 4d
    Mã hóa AES-256-CBC & Store-and-Forward :c2, after c1, 4d
    section Giao diện & Trải nghiệm
    Phát triển CLI & Web GUI Glassmorphism :d1, after c2, 5d
    section Kiểm thử & Hoàn thiện
    Viết bộ kiểm thử tự động (38 test cases) :e1, after d1, 3d
    Kiểm thử tải, Churn Simulation & Viết báo cáo :e2, after e1, 2d
```

1. **Giai đoạn 1: Phân tích & Thiết kế Kiến trúc (Phát triển lý thuyết)**
   - Xác định mô hình mạng: Lựa chọn mô hình Hybrid P2P nhằm giải quyết bài toán tìm kiếm peer (cold start) trong khi vẫn đảm bảo giao tiếp tin nhắn trực tiếp không qua trung gian.
   - Thiết kế giao thức giao tiếp TCP sử dụng **Newline-Delimited JSON (NDJSON)** để giải quyết vấn đề ranh giới dữ liệu (framing/chunking) của TCP socket.
   - Đặc tả hệ thống các API của Bootstrap Server đóng vai trò Tracker.

2. **Giai đoạn 2: Hiện thực kết nối P2P cơ bản (Core P2P)**
   - Xây dựng **Bootstrap Server** với Express.js để lưu giữ danh bạ peer online và xử lý heartbeat (5 giây/lần).
   - Phát triển module `tcpServer.js` và `tcpClient.js` thô nhằm mở socket TCP kết nối trực tiếp, gửi và nhận dữ liệu JSON thô giữa hai peer.

3. **Giai đoạn 3: Tối ưu hoá Độ tin cậy & Chống mất mát dữ liệu (Reliable Delivery)**
   - Phát triển module `reliableDelivery.js` hiện thực máy trạng thái (State Machine) quản lý việc gửi tin.
   - Xử lý cơ chế ACK (xác nhận) mức ứng dụng, tự động Retry tối đa 3 lần sau mỗi 5 giây nếu không nhận được ACK.
   - Hiện thực bộ khử trùng lặp dữ liệu `receivedMsgIds` sử dụng cấu trúc dữ liệu `Set` có cơ chế dọn dẹp FIFO để tránh memory leak.

4. **Giai đoạn 4: Tích hợp Bảo mật & Khả năng chịu lỗi (Security & Fault Tolerance)**
   - Viết module `crypto.js` sử dụng thư viện `crypto` built-in của Node.js để mã hóa đầu-cuối AES-256-CBC, sử dụng khóa chia sẻ trước (PSK) được băm bằng SHA-256, đính kèm IV (Initialization Vector) ngẫu nhiên vào gói tin.
   - Xây dựng tính năng **Store-and-Forward** trên cả Peer Node và Bootstrap Server, cho phép tạm lưu tin nhắn vào hàng đợi RAM của server khi peer nhận offline, tự động chuyển tiếp ngay khi peer nhận online trở lại.

5. **Giai đoạn 5: Phát triển Giao diện & Trải nghiệm Người dùng (CLI & GUI)**
   - Tối ưu CLI với cơ chế phục hồi prompt gõ tin nhắn (`logger.js`) khi có tin nhắn mới đẩy vào console.
   - Phát triển **Web GUI** dùng kiến trúc decoupled thông qua `eventBus.js`, thiết kế giao diện Glassmorphism thời gian thực sử dụng HTML/CSS thuần kết hợp Socket.IO.

6. **Giai đoạn 6: Kiểm thử tự động & Đánh giá (Testing & Quality Assurance)**
   - Viết bộ kịch bản kiểm thử tự động toàn diện trong `test.js` gồm 9 test suites và 38 test cases để bao phủ toàn bộ các chức năng.
   - Chạy kịch bản mô phỏng Churn (`churn-sim.js`) mô phỏng việc tham gia/rời mạng liên tục của các peer nhằm đánh giá độ bền bỉ của hệ thống.

---


## 2. KIẾN TRÚC HỆ THỐNG

### 2.1. Mô hình Hybrid P2P

Hệ thống áp dụng mô hình **Hybrid P2P (Mạng ngang hàng lai)**, kết hợp:
- **Bootstrap Server** đóng vai trò **Tracker / Peer Directory** (chỉ để khám phá mạng)
- **Peer Node** giao tiếp **trực tiếp** với nhau qua **TCP**

Mô hình này giải quyết bài toán "cold start" của P2P thuần: một peer mới tham gia không biết ai đang online, Bootstrap Server cung cấp danh sách. Sau khi khám phá, tin nhắn đi **hoàn toàn trực tiếp** giữa các peer — Bootstrap không tham gia.

### 2.2. Sơ đồ kiến trúc tổng quan

```mermaid
graph TD
    subgraph Bootstrap["Bootstrap Server — HTTP :3000 (Tracker Only)"]
        Registry[Peer Registry Map]
        StoreQueue[Offline Message Queue]
    end

    subgraph PeerA["Peer Node A — Dũng — TCP :5001"]
        TcpSrvA[TCP Server]
        TcpCliA[TCP Client]
        GUIA[CLI / Web GUI :6001]
    end

    subgraph PeerB["Peer Node B — Hiếu — TCP :5002"]
        TcpSrvB[TCP Server]
        TcpCliB[TCP Client]
        GUIB[CLI / Web GUI :6002]
    end

    subgraph PeerC["Peer Node C — Việt — TCP :5003"]
        TcpSrvC[TCP Server]
        TcpCliC[TCP Client]
        GUIC[CLI / Web GUI :6003]
    end

    %% HTTP Discovery
    TcpSrvA -->|POST /register| Registry
    TcpSrvB -->|POST /register| Registry
    TcpSrvA -.->|Heartbeat 5s| Registry
    TcpSrvB -.->|Heartbeat 5s| Registry
    TcpCliA -->|GET /peers| Registry

    %% TCP Direct P2P (KHÔNG qua Bootstrap)
    TcpCliA ==>|CHAT JSON trực tiếp| TcpSrvB
    TcpSrvB ==>|ACK JSON| TcpCliA

    %% Store and Forward
    TcpCliA -.->|TCP FAILED → POST /store| StoreQueue
    Registry -.->|Deliver on /register| TcpSrvC
```

### 2.3. Nguyên tắc thiết kế then chốt

> **"Bootstrap Server KHÔNG BAO GIỜ trung chuyển tin nhắn chat giữa các peer"**

Tin nhắn giữa các peer đi **hoàn toàn trực tiếp** qua TCP socket. Bootstrap Server chỉ là **danh bạ điện thoại** — biết ai đang online ở đâu, nhưng không tham gia vào cuộc trò chuyện. Đây là điểm then chốt đảm bảo tính chất P2P của hệ thống.

---

## 3. CƠ CHẾ KHÁM PHÁ PEER VÀ QUẢN LÝ TRẠNG THÁI

### 3.1. Quy trình đăng ký, kết nối và heartbeat

```mermaid
sequenceDiagram
    autonumber
    actor Dung as Peer A (Dũng)
    participant Bootstrap as Bootstrap Server (Tracker)
    actor Hieu as Peer B (Hiếu)

    Note over Dung, Hieu: 1. ĐĂNG KÝ VÀ KHÁM PHÁ (DISCOVERY)
    Dung->>Bootstrap: POST /register { id: 'peer-a', host: '127.0.0.1', port: 5001 }
    Bootstrap-->>Dung: 200 OK + pendingMessages: []
    Hieu->>Bootstrap: POST /register { id: 'peer-b', host: '127.0.0.1', port: 5002 }
    Bootstrap-->>Hieu: 200 OK + pendingMessages: []

    Dung->>Bootstrap: GET /peers
    Bootstrap-->>Dung: [{ id: 'peer-b', host: '127.0.0.1', port: 5002 }]

    Note over Dung, Hieu: 2. GIAO TIẾP TCP NGANG HÀNG TRỰC TIẾP
    Dung->>Hieu: Mở kết nối TCP → 127.0.0.1:5002
    Dung->>Hieu: Gửi JSON CHAT message
    Hieu-->>Dung: Trả ACK xác nhận trên cùng socket TCP
    Note over Dung, Hieu: Đóng kết nối TCP (short-lived socket)

    Note over Dung, Hieu: 3. HEARTBEAT ĐỊNH KỲ
    loop Mỗi 5 giây
        Dung->>Bootstrap: POST /heartbeat { id: 'peer-a' }
        Hieu->>Bootstrap: POST /heartbeat { id: 'peer-b' }
    end

    Note over Hieu: Hiếu tắt đột ngột (Ctrl+C)
    Note over Bootstrap: Sau 15 giây không nhận heartbeat từ Hiếu
    Bootstrap->>Bootstrap: Tự động xóa Hiếu khỏi danh sách
```

### 3.2. REST API của Bootstrap Server

| Method | Endpoint | Mô tả | Request Body | Response |
|--------|----------|-------|-------------|----------|
| `POST` | `/register` | Đăng ký peer vào mạng | `{id, name, host, port}` | `{ok, pendingMessages:[]}` |
| `GET` | `/peers` | Lấy danh sách peer online | — | `{peers:[{id,name,host,port}]}` |
| `POST` | `/heartbeat` | Cập nhật trạng thái online | `{id}` | `{ok}` hoặc `404` |
| `POST` | `/leave` | Thông báo rời mạng gracefully | `{id}` | `{ok}` |
| `POST` | `/store` | Lưu tin nhắn cho peer offline | `{to, from, payload}` | `{ok, queueSize}` hoặc `409` |
| `GET` | `/` | Health check tổng quan | — | `{status, peers_online, ...}` |

### 3.3. Cơ chế Timeout và Cleanup

- **Heartbeat interval**: Mỗi 5 giây
- **Peer timeout**: 15 giây (3× safety margin so với 5s heartbeat)
- **Periodic cleanup**: Mỗi 10 giây server tự dọn dẹp
- **Lazy cleanup**: Dọn dẹp thêm mỗi khi `GET /peers` được gọi
- **Graceful leave**: Peer gọi `POST /leave` khi tắt có chủ ý → cập nhật ngay lập tức, không chờ 15s

---

## 4. GIAO THỨC TRAO ĐỔI THÔNG ĐIỆP (TCP + JSON)

### 4.1. Thiết kế giao thức

Tất cả gói tin trao đổi trực tiếp giữa các peer qua TCP được chuẩn hóa theo định dạng **Newline-Delimited JSON (NDJSON)**:

```
<JSON string>\n
```

**Lý do cần delimiter**: TCP là giao thức stream, không có ranh giới gói tin. Dữ liệu đến theo từng chunk ngẫu nhiên. Ví dụ peer A gửi `{"type":"CHAT",...}\n`, peer B có thể nhận được `{"type":"CHA` (chunk 1) và `T",...}\n` (chunk 2). Buffer + ký tự `\n` là delimiter để ghép đúng message hoàn chỉnh.

Mỗi phiên kết nối TCP là **short-lived**:
```
Peer A kết nối TCP → Gửi tin nhắn JSON → Chờ ACK → Peer B đóng socket → Peer A nhận 'end'
```

### 4.2. Cấu trúc các loại thông điệp

#### 4.2.1. Tin nhắn 1-1 trực tiếp (CHAT)
```json
{
  "type": "CHAT",
  "id": "msg-1700000000000-abcd",
  "from": "peer-a",
  "to": "peer-b",
  "content": "Hello Hieu!",
  "timestamp": 1700000000000
}
```

#### 4.2.2. Tin nhắn nhóm (GROUP_CHAT)
```json
{
  "type": "GROUP_CHAT",
  "id": "msg-1700000000001-efgh",
  "from": "peer-a",
  "to": ["peer-b", "peer-c"],
  "content": "Xin chào cả nhóm!",
  "timestamp": 1700000000001
}
```

#### 4.2.3. Phát tin toàn mạng (BROADCAST)
```json
{
  "type": "BROADCAST",
  "id": "msg-1700000000002-ijkl",
  "from": "peer-a",
  "content": "Xin chào tất cả!",
  "timestamp": 1700000000002
}
```

#### 4.2.4. Xác nhận nhận tin (ACK)
```json
{
  "type": "ACK",
  "id": "msg-1700000000000-abcd",
  "from": "peer-b"
}
```

#### 4.2.5. Báo lỗi (ERROR)
```json
{
  "type": "ERROR",
  "id": "msg-1700000000000-abcd",
  "reason": "invalid_format"
}
```

> **Lưu ý**: Khi mã hóa được bật (tham số `--key`), trường `content` có dạng `enc:<iv_hex>:<ciphertext_hex>` thay vì plaintext.

---

## 5. CƠ CHẾ TRUYỀN TIN ĐÁNG TIN CẬY (RELIABLE DELIVERY)

### 5.1. Vấn đề

TCP đảm bảo byte đến đúng thứ tự — nhưng **KHÔNG** đảm bảo peer đích đang chạy. Nếu peer B offline khi peer A gửi → tin mất hoàn toàn, không có thông báo. Module `reliableDelivery.js` bổ sung tầng **ACK + Retry** ở application level.

**Nguyên lý cốt lõi**: *"Tin nhắn được giao đến người nhận, hoặc người gửi được thông báo thất bại rõ ràng."*

### 5.2. Sơ đồ trạng thái (State Machine)

```mermaid
stateDiagram-v2
    [*] --> Attempt0 : Gọi sendWithAck()

    state Attempt0 {
        [*] --> SetTimer0 : Đặt timer 5s TRƯỚC
        SetTimer0 --> SendTCP0
        SendTCP0 --> WaitACK0 : Connect OK
        WaitACK0 --> Success : Nhận ACK
        WaitACK0 --> Attempt1 : Timeout 5s
        SendTCP0 --> Attempt1 : Connect FAIL → clearTimeout()
    }

    state Attempt1 {
        [*] --> SetTimer1
        SetTimer1 --> SendTCP1
        SendTCP1 --> WaitACK1 : Connect OK
        WaitACK1 --> Success : Nhận ACK
        WaitACK1 --> Attempt2 : Timeout 5s
        SendTCP1 --> Attempt2 : Connect FAIL
    }

    state Attempt2 {
        [*] --> SetTimer2
        SetTimer2 --> SendTCP2
        SendTCP2 --> WaitACK2 : Connect OK
        WaitACK2 --> Success : Nhận ACK
        WaitACK2 --> Attempt3 : Timeout 5s
        SendTCP2 --> Attempt3 : Connect FAIL
    }

    state Attempt3 {
        [*] --> SetTimer3
        SetTimer3 --> SendTCP3
        SendTCP3 --> WaitACK3 : Connect OK
        WaitACK3 --> Success : Nhận ACK
        WaitACK3 --> StoreForward : Timeout 5s
        SendTCP3 --> StoreForward : Connect FAIL
    }

    Success --> [*] : DELIVERED ✓
    StoreForward --> [*] : FAILED → Store-and-Forward
```

### 5.3. Tham số cấu hình

| Tham số | Giá trị | Ý nghĩa |
|---------|---------|---------|
| `ACK_TIMEOUT_MS` | 5000 ms | Thời gian chờ ACK trước khi retry |
| `MAX_RETRY` | 3 | Số lần thử lại tối đa (4 lần gửi tổng cộng) |
| Thời gian thất bại tổng | ~20 giây | 4 lần × 5 giây |
| `MAX_RECEIVED_IDS` | 1000 entries | Giới hạn Set deduplication (FIFO) |

### 5.4. Bug "Double Execution" và cách khắc phục

**Vấn đề**: Nếu đặt timer **SAU** lệnh `sendTCP()`:
1. `sendTCP()` thất bại ngay lập tức → `catch()` gọi `attempt(1)`
2. Timer cũng bắn sau đó → gọi `attempt(1)` lần nữa
3. `attempt(1)` bị gọi **2 lần** = Bug!

**Giải pháp**: Luôn đặt timer **TRƯỚC** khi gọi `sendTCP()`, và `clearTimeout()` ngay trong `catch()` trước khi gọi lần thử tiếp theo.

### 5.5. Khử trùng lặp tin nhắn (Deduplication)

Vì có retry, peer nhận có thể nhận cùng một tin nhiều lần:
- Mỗi peer duy trì `receivedMsgIds: Set<string>` trong bộ nhớ
- Nếu ID **đã có** → bỏ qua (không hiển thị), **vẫn gửi ACK** (để sender dừng retry)
- Nếu ID **chưa có** → hiển thị + thêm vào Set + gửi ACK
- `Set.has()` = O(1) (nhanh hơn `Array.includes()` = O(n))
- Giới hạn 1000 entries FIFO để phòng memory leak

---

## 6. MÃ HÓA ĐẦU-CUỐI AES-256-CBC

### 6.1. Tổng quan thuật toán

Hệ thống sử dụng **AES-256-CBC** — chuẩn mã hóa được NIST công nhận:
- **AES**: Mã hóa đối xứng (symmetric key), mã hóa theo từng block 128-bit
- **256-bit key**: Mức bảo mật cao nhất trong họ AES
- **CBC (Cipher Block Chaining)**: Mỗi block phụ thuộc block trước → khó phân tích mẫu
- **IV ngẫu nhiên 16 bytes**: Mỗi lần mã hóa, cùng plaintext → khác ciphertext → chống replay attack
- **Không cần cài thêm package**: Dùng module `crypto` built-in của Node.js

### 6.2. Định dạng và luồng xử lý

```
FORMAT MÃ HÓA:
"enc:<iv_hex>:<ciphertext_hex>"

Ví dụ: "enc:a1b2c3d4e5f601234...:<64+ bytes hex>..."
```

```
PEER GỬI (ENCRYPT):
plaintext: "Hello Hieu!"
    │
    ├── deriveKey("dung123")
    │   └── SHA-256("dung123") → 32-byte Buffer (256-bit AES key)
    │
    ├── randomBytes(16) → iv (ngẫu nhiên, độc lập mỗi lần gọi)
    │
    └── createCipheriv('aes-256-cbc', key, iv)
        → "enc:<iv_hex>:<ciphertext_hex>"
        → Đặt vào trường content → Gửi qua TCP

PEER NHẬN (DECRYPT):
"enc:<iv_hex>:<ciphertext_hex>"
    │
    ├── Kiểm tra prefix "enc:" → isEncrypted() = true
    ├── Tách iv_hex và ciphertext_hex
    ├── deriveKey("dung123") → key
    └── createDecipheriv('aes-256-cbc', key, iv)
        → "Hello Hieu!" ✅  [ENC]✅
        → "[DECRYPTION FAILED — wrong key]" ❌
```

### 6.3. Khả năng tương thích ngược

| Peer gửi | Peer nhận | Kết quả hiển thị |
|----------|-----------|---------|
| Có khóa `dung123` | Có khóa `dung123` | ✅ Hiển thị plaintext kèm `[ENC]✅` |
| Có khóa `dung123` | Khóa sai | ❌ `[DECRYPTION FAILED — wrong key]` |
| Có khóa `dung123` | Không có khóa | 🔑 `[ENCRYPTED — không có key để giải mã]` |
| Không có khóa | Có khóa | 📄 Nhận và hiển thị plaintext bình thường |

### 6.4. Cách sử dụng

```bash
# Chế độ CLI với mã hóa
node peer.js --id peer-a --name Dung --port 5001 --key dung123
node peer.js --id peer-b --name Hieu --port 5002 --key dung123
node peer.js --id peer-c --name Viet --port 5003 --key dung123

# Chế độ Web GUI với mã hóa
node peer.js --id peer-a --name Dung --port 5001 --gui true --key dung123
node peer.js --id peer-b --name Hieu --port 5002 --gui true --key dung123
node peer.js --id peer-c --name Viet --port 5003 --gui true --key dung123
```

---

## 7. LƯU VÀ CHUYỂN TIẾP TIN NHẮN (STORE-AND-FORWARD)

### 7.1. Vấn đề

Khi peer đích offline và tin nhắn thất bại sau 3 lần retry, toàn bộ nỗ lực gửi tin bị mất — người dùng phải gửi lại thủ công sau khi biết peer đích đã online.

### 7.2. Luồng Store-and-Forward

```mermaid
sequenceDiagram
    actor Dung as Peer A (Dũng)
    participant Bootstrap as Bootstrap Server
    actor Viet as Peer C (Việt) — OFFLINE

    Dung->>Viet: TCP kết nối → ECONNREFUSED
    Dung->>Viet: RETRY 1/3 → ECONNREFUSED
    Dung->>Viet: RETRY 2/3 → ECONNREFUSED
    Dung->>Viet: RETRY 3/3 → ECONNREFUSED

    Note over Dung: onFailed() → kích hoạt store-and-forward

    Dung->>Bootstrap: POST /store {to:'peer-c', from:'peer-a', payload:{...}}
    Bootstrap->>Bootstrap: Kiểm tra peer-c offline → lưu vào offlineQueue
    Bootstrap-->>Dung: {ok: true, queueSize: 1}

    Note over Dung: [STORED] ✉ Message queued for peer-c

    Note over Viet: Peer C khởi động lại
    Viet->>Bootstrap: POST /register {id:'peer-c', host, port}
    Bootstrap->>Bootstrap: popMessages('peer-c') → lấy và xóa queue
    Bootstrap-->>Viet: {ok: true, pendingMessages: [{payload, storedAt}]}

    Note over Viet: [OFFLINE MSG from peer-a] Hi? (stored 25 seconds ago)
```

### 7.3. Giới hạn an toàn trên Bootstrap Server

| Giới hạn | Giá trị | Lý do |
|---------|---------|-------|
| Max tin nhắn/peer | 50 tin | Tránh quá tải RAM của Bootstrap |
| TTL tin nhắn | 1 giờ (3600s) | Tin nhắn cũ hơn 1h không còn giá trị |
| Periodic cleanup | Mỗi 10 giây | Dọn dẹp tin hết TTL |
| Kiểm tra online | Trả về 409 | Nếu peer đang online → không lưu, gửi TCP trực tiếp |

---

## 8. CẤU TRÚC MODULE VÀ THIẾT KẾ PHẦN MỀM

### 8.1. Cây thư mục dự án

```
Chat P2P/
├── bootstrap-server/
│   ├── server.js          ← Entry point Bootstrap (Express HTTP REST API)
│   └── peerRegistry.js    ← Business logic: quản lý peer + offline queue
│
├── peer-node/
│   ├── peer.js            ← Entry point (orchestrator, DI wiring)
│   ├── tcpServer.js       ← TCP Server: nhận tin từ peer khác (NDJSON)
│   ├── tcpClient.js       ← TCP Client: gửi tin tới peer khác
│   ├── messageHandler.js  ← Xử lý CHAT/GROUP/BROADCAST/ACK/ERROR
│   ├── reliableDelivery.js← ACK + Retry + Store-and-Forward trigger
│   ├── bootstrapClient.js ← HTTP client: /register, /peers, /heartbeat, /store
│   ├── crypto.js          ← AES-256-CBC encrypt/decrypt, key derivation
│   ├── state.js           ← Shared state (pendingAcks Map, receivedMsgIds Set)
│   ├── eventBus.js        ← Singleton EventEmitter (core → Web GUI bridge)
│   ├── logger.js          ← Logging với readline prompt restoration
│   ├── cli.js             ← CLI interface (readline, /msg /group /broadcast ...)
│   ├── webServer.js       ← Web GUI server (Express + Socket.IO)
│   └── public/
│       ├── index.html     ← HTML structure (PTIT P2P Chat UI)
│       ├── style.css      ← Dark mode glassmorphism design system
│       └── app.js         ← Frontend logic (Socket.IO client, peer list)
│
├── churn-sim.js           ← Kịch bản mô phỏng peer churn tự động
├── churn-sim.ps1          ← PowerShell wrapper cho churn-sim
└── test.js                ← Bộ kiểm thử tự động (38 test cases, 9 suites)
```

### 8.2. Thứ tự khởi tạo (Dependency Injection)

Module `peer.js` là orchestrator, kết nối tất cả module theo thứ tự DI để tránh circular dependency:

```
Step 1: handleMessage = createHandler(peerId, encKey)
         [messageHandler.js]
         → Cần peerId để gửi ACK đúng "from"

Step 2: sendTCP = createSendTCP(handleMessage)
         [tcpClient.js]
         → Inject handleMessage thay vì import trực tiếp
         → Tránh circular: tcpClient ↔ messageHandler

Step 3: bootstrap = createBootstrapClient(config)
         [bootstrapClient.js]
         → Chỉ cần config, độc lập với các module khác

Step 4: { sendWithAck } = createReliableDelivery(sendTCP, bootstrap.storeMessage)
         [reliableDelivery.js]
         → Inject cả sendTCP và storeMessage

Step 5: tcpServer = createTcpServer(handleMessage)
         [tcpServer.js]
         → Inject handleMessage để xử lý tin đến

Step 6: createCLI(config, coreDeps)  hoặc  startWebServer(config, coreDeps)
         [cli.js / webServer.js]
         → Inject tất cả dependencies đã sẵn sàng
```

### 8.3. Singleton Pattern qua Module Cache

`state.js` và `eventBus.js` được thiết kế theo **Singleton Pattern** thông qua cơ chế cache module của Node.js:

```javascript
// state.js — Chia sẻ giữa reliableDelivery.js và messageHandler.js
const pendingAcks = new Map();    // Map<msgId, {timer, payload, targetHost, targetPort}>
const receivedMsgIds = new Set(); // Set<msgId> — phục vụ deduplication

// Node.js chỉ thực thi state.js MỘT LẦN → mọi require('./state') trả về CÙNG object
module.exports = { pendingAcks, receivedMsgIds, ACK_TIMEOUT_MS: 5000, MAX_RETRY: 3 };
```

### 8.4. Kiến trúc Event Bus cho Web GUI

```
Core Modules
(messageHandler, reliableDelivery, bootstrapClient)
    │
    │  bus.emit('chat-received', {from, text, timestamp, ...})
    │  bus.emit('ack-received', {id, from})
    │  bus.emit('send-failed', {id, payload})
    │  bus.emit('offline-msg', {from, content, storedAt})
    │  bus.emit('stored-forward', {id, to})
    ▼
eventBus.js (Singleton EventEmitter — setMaxListeners(30))
    │
    │  bus.on('chat-received', data => io.emit('chat-received', data))
    ▼
webServer.js (Express + Socket.IO)
    │
    │  socket.emit('chat-received', data)  [WebSocket → Browser]
    ▼
Browser (app.js — Socket.IO Client)
    → Cập nhật giao diện, hiển thị tin nhắn
```

**Tính chất quan trọng**: Tin nhắn KHÔNG đi qua Web Server. Web Server chỉ là proxy notification từ core modules tới browser. Tính chất P2P hoàn toàn được bảo toàn.

### 8.5. TCP Half-Duplex ACK trên cùng Socket

```
Peer A                              Peer B
   │                                   │
   │── net.connect(host, port) ────────►│
   │── socket.write(JSON + '\n') ──────►│  (Gửi CHAT)
   │   [KHÔNG socket.end() ngay]        │
   │                                   │  handleMessage(msg, socket)
   │                                   │  socket.write(ACK + '\n')
   │◄── ACK JSON ──────────────────────│  socket.end()  ← Peer B đóng
   │   messageHandler.handleMessage()  │
   │   clearTimeout(timer)             │
   │   pendingAcks.delete(msgId)       │
   │   socket.destroy() [on 'end']     │
   │                                   │
```

Peer A KHÔNG đóng socket ngay sau khi gửi vì cần giữ socket mở để nhận ACK ngược lại. Đây là thiết kế **half-duplex** trên cùng một kết nối TCP, tránh mở thêm kết nối riêng cho ACK.

---

## 9. GIAO DIỆN NGƯỜI DÙNG

### 9.1. CLI Interface (Giao diện dòng lệnh)

| Lệnh | Mô tả | Ví dụ |
|------|-------|-------|
| `/help` | Danh sách tất cả lệnh | `/help` |
| `/list` | Xem peer đang online | `/list` |
| `/msg <id> <nội dung>` | Gửi tin 1-1 | `/msg peer-b Hello!` |
| `/group <a,b> <nội dung>` | Gửi tin nhóm | `/group peer-b,peer-c Hi nhóm!` |
| `/broadcast <nội dung>` | Gửi tới tất cả | `/broadcast Hello all!` |
| `/status` | Xem thông tin peer hiện tại | `/status` |
| `/exit` | Rời mạng và tắt peer | `/exit` |

**Màu sắc ANSI trong CLI**:
| Màu | Ngữ cảnh |
|-----|---------|
| Xanh lam `\x1b[36m` | Tin nhắn CHAT nhận được |
| Tím `\x1b[35m` | Tin nhắn GROUP_CHAT |
| Xanh ngọc `\x1b[96m` | Tin nhắn BROADCAST |
| Xanh lá `\x1b[32m` | ACK thành công `[ACK] ✓` |
| Vàng `\x1b[33m` | Đang retry `[RETRY 1/3]` |
| Đỏ `\x1b[31m` | Thất bại `[FAILED] ✗` |

**Prompt Restoration**: Khi tin nhắn mới đến trong lúc người dùng đang gõ lệnh, hệ thống xóa dòng prompt hiện tại, in tin nhắn mới, rồi vẽ lại prompt kèm nội dung đang gõ dở — trải nghiệm không bao giờ bị gián đoạn.

### 9.2. Web GUI Interface (Giao diện đồ họa Web)

**Khởi chạy**:
```bash
node peer.js --id peer-a --name Dung --port 5001 --gui true
# → Web GUI chạy tại http://localhost:6001 (port = TCP_port + 1000)
```

**Design System** (`style.css`):
| Element | Giá trị |
|---------|---------|
| Nền chính | `#0a0e17` (Dark Navy) |
| Accent | Gradient Cyan → Blue → Violet |
| Font chính | Inter (sans-serif) |
| Font code | JetBrains Mono |
| Effect | Glassmorphism (backdrop-filter blur) |

**Tính năng nổi bật của Web GUI**:
- **Danh sách peer thời gian thực** (poll 5 giây, cập nhật tự động)
- **Sắp xếp peer theo tin nhắn mới nhất** — peer có hoạt động gần nhất hiện đầu danh sách
- **Preview tin nhắn cuối** trong danh sách thay vì Peer ID (giống Telegram, Messenger)
- **Highlight unread** với viền cyan và badge số tin chưa đọc có animation pulse
- **ACK status indicator**: ◌ đang gửi → ✓ đã nhận → ✗ thất bại
- **Encryption badge** `🔒 AES-256` khi chạy với key
- **Toast notification** cho tin nhắn mới, lỗi, thông báo hệ thống
- **Lịch sử chat** lưu trong `localStorage` trình duyệt (tối đa 500 tin/conversation)
- **Info panel** với kiến trúc P2P diagram và trạng thái pending ACKs

---

## 10. KẾT QUẢ KIỂM THỬ

### 10.1. Kiểm thử tự động (Automated Testing)

Bộ kiểm thử tự động trong `test.js` — **9 Test Suite**, **38 Test Case**:

```
╔═══════════════════════════════════════════════════════════╗
║     PTIT P2P Chat — Comprehensive Automated Tests         ║
║     Requires: Bootstrap Server running on :3000           ║
╚═══════════════════════════════════════════════════════════╝

[Suite 1] Bootstrap REST API .............. 8 tests
  ✅ POST /register — đăng ký peer thành công
  ✅ GET /peers — trả về peer đã đăng ký
  ✅ POST /heartbeat — cập nhật lastSeen
  ✅ POST /heartbeat — 404 cho peer chưa đăng ký
  ✅ POST /register — validate required fields → 400
  ✅ POST /leave — xóa peer khỏi danh sách
  ✅ GET /peers — rỗng sau khi leave
  ✅ GET / — health check response đúng định dạng

[Suite 2] TCP CHAT → ACK .................. 2 tests
  ✅ Peer B nhận được CHAT: "Hello P2P!"
  ✅ Peer A nhận được ACK cho test-msg-001

[Suite 3] GROUP_CHAT → ACK ................ 4 tests
  ✅ Peer B nhận được GROUP_CHAT
  ✅ Peer C nhận được GROUP_CHAT
  ✅ ACK từ B cho GROUP_CHAT
  ✅ ACK từ C cho GROUP_CHAT

[Suite 4] BROADCAST → ACK ................. 2 tests
  ✅ Peer nhận được BROADCAST: "Broadcast!"
  ✅ ACK cho BROADCAST

[Suite 5] ACK timeout (unreachable peer) .. 1 test
  ✅ TCP connect fail fast (21ms) → kích hoạt retry/FAILED ngay

[Suite 6] Message Deduplication ........... 2 tests
  ✅ Mock peer nhận 3 bản sao (hệ thống thật dedup xuống 1)
  ✅ Logic dedup với receivedMsgIds Set được xác nhận

[Suite 7] Peer Churn Simulation ........... 5 tests
  ✅ Peer D joined (registered)
  ✅ Peer D left (removed from list)
  ✅ Peer D rejoin với port và tên mới
  ✅ 3 peers online đồng thời
  ✅ Churn cycle: join → leave → rejoin → multi-peer

[Suite 8] Store-and-Forward ............... 6 tests
  ✅ POST /store — message queued cho offline peer (queueSize=1)
  ✅ POST /store — tin thứ 2 queued (queueSize=2)
  ✅ POST /store — từ chối store cho peer online (409 Conflict)
  ✅ POST /register — 2 pending messages delivered khi reconnect
  ✅ POST /register — nội dung tin nhắn pending chính xác
  ✅ POST /register — queue cleared sau delivery (không duplicate)

[Suite 9] AES-256-CBC Encryption .......... 8 tests
  ✅ encrypt() — output có prefix "enc:"
  ✅ isEncrypted() — true cho ciphertext
  ✅ isEncrypted() — false cho plaintext
  ✅ decrypt() — khôi phục đúng plaintext (hỗ trợ Unicode ✓)
  ✅ encrypt() — non-deterministic (IV ngẫu nhiên mỗi lần gọi)
  ✅ decrypt() — ciphertext thứ 2 cũng giải mã đúng
  ✅ decrypt() — trả về DECRYPTION FAILED khi sai khóa
  ✅ encrypt/decrypt — roundtrip với ký tự đặc biệt (emoji, tiếng Việt)

══════════════════════════════════════════════════════
Result: 38 passed, 0 failed ✅
══════════════════════════════════════════════════════
```

**Cách chạy kiểm thử**:
```powershell
# 1. Khởi động Bootstrap Server trên cổng riêng
$env:PORT=3001; node bootstrap-server/server.js

# 2. Chạy bộ kiểm thử
$env:BOOTSTRAP_PORT=3001; node test.js
```

### 10.2. Kịch bản kiểm thử thủ công — CLI

```bash
# Thiết lập 4 terminal riêng biệt
# Terminal 1
cd bootstrap-server && npm run dev

# Terminal 2
cd peer-node && node peer.js --id peer-a --name Dung --port 5001

# Terminal 3
cd peer-node && node peer.js --id peer-b --name Hieu --port 5002

# Terminal 4
cd peer-node && node peer.js --id peer-c --name Viet --port 5003
```

**Kịch bản thực thi**:
1. `peer-a> /list` → Thấy peer-b và peer-c online.
2. `peer-a> /msg peer-b Hello Hieu!` (Tin nhắn 1-1) → Dũng thấy `[ACK] Message msg-xxx delivered ✓`, Hiếu thấy `[MSG from peer-a] Hello Hieu!`.
3. `peer-a> /group peer-b,peer-c Xin chào nhóm!` (Tin nhắn nhóm) → Cả B và C đều nhận được tin nhắn và gửi ACK lại. Dũng nhận đủ 2 ACK.
4. `peer-a> /broadcast Chào tất cả mọi người!` (Tin nhắn phát rộng) → Tất cả các peer đang online trong mạng (B và C) đều nhận được tin nhắn và gửi ACK về cho Dũng.
5. Tắt peer-c (Ctrl+C).
6. `peer-a> /msg peer-c Are you there?`
   - Hệ thống tự động Retry vì không kết nối được TCP trực tiếp tới C:
     - `[RETRY 1/3] msg xxx → retrying...`
     - `[RETRY 2/3] msg xxx → retrying...`
     - `[RETRY 3/3] msg xxx → retrying...`
     - `[FAILED] Message could not be delivered ✗`
   - Kích hoạt cơ chế Store-and-Forward:
     - `[STORED] ✉ Message queued for peer-c` (Đã lưu tạm trên Bootstrap Server).
7. Khởi động lại peer-c → Ngay lập tức nhận được tin nhắn offline từ hàng đợi của Bootstrap Server:
   - `[OFFLINE MSG from peer-a] Are you there? (stored 15 seconds ago)`

### 10.3. Kịch bản kiểm thử thủ công — Web GUI

```bash
# Chạy 3 peer với Web GUI
cd peer-node
node peer.js --id peer-a --name Dung --port 5001 --gui true  # → http://localhost:6001
node peer.js --id peer-b --name Hieu --port 5002 --gui true  # → http://localhost:6002
node peer.js --id peer-c --name Viet --port 5003 --gui true  # → http://localhost:6003
```

**Kịch bản thực thi từng bước**:

1. **Khởi chạy hệ thống**:
   - Khởi chạy Bootstrap Server.
   - Khởi chạy Peer A (Dũng) và Peer B (Hiếu) với tùy chọn `--gui true` ở 2 terminal riêng biệt:
     ```bash
     node peer.js --id peer-a --name Dung --port 5001 --gui true
     node peer.js --id peer-b --name Hieu --port 5002 --gui true
     ```
   - Mở trình duyệt Web tại 2 địa chỉ tương ứng: Dũng tại `http://localhost:6001` và Hiếu tại `http://localhost:6002`.

2. **Kiểm tra trạng thái kết nối & danh sách peer**:
   - Quan sát dấu chấm trạng thái (Online) màu xanh lá cạnh tên của mình.
   - Cột Sidebar của Dũng hiển thị nút "Hiếu" kèm chấm xanh online, cột của Hiếu hiển thị "Dũng".
   - Mở panel thông tin bên phải bằng nút `i` để xem cấu trúc mạng P2P thời gian thực.

3. **Gửi tin nhắn 1-1 trực tiếp (TCP Direct)**:
   - Dũng click chọn "Hiếu" trong sidebar. Nhập tin nhắn: `"Chào Hiếu, giao tiếp P2P trực tiếp nhé!"` và nhấn Enter.
   - Màn hình của Dũng: Tin nhắn xuất hiện kèm trạng thái gửi `◌` rồi nhanh chóng chuyển sang dấu `✓` màu xanh lá (chỉ trong ~10-20ms) xác nhận đã nhận được ACK trực tiếp từ Hiếu.
   - Màn hình của Hiếu: Dũng được tự động đẩy lên đầu danh sách peer kèm tin nhắn xem trước (preview). Hiếu click chọn Dũng để đọc nội dung cuộc trò chuyện.

4. **Kiểm thử Broadcast (Phát tin toàn mạng)**:
   - Hiếu click chọn kênh "Broadcast" (biểu tượng chiếc loa 📣 ở đầu sidebar). Nhập tin: `"Thông báo họp nhóm chat P2P!"` và gửi.
   - Màn hình của Dũng (nếu đang ở tab chat với Hiếu): Xuất hiện thông báo Toast màu xanh ở góc phải thông báo nhận được Broadcast từ Hiếu. Badge số tin chưa đọc màu đỏ ở kênh Broadcast hiển thị số `1`.

5. **Kiểm thử Store-and-Forward (Lưu và chuyển tiếp ngoại tuyến)**:
   - Tắt tiến trình Peer B (Hiếu) tại terminal bằng `Ctrl+C`.
   - Sau 15 giây (heartbeat timeout), danh sách peer online của Dũng tự động dọn dẹp và cập nhật trạng thái của Hiếu thành offline.
   - Dũng click chọn Hiếu (nằm trong danh sách lịch sử), nhập tin nhắn: `"Khi nào online nhớ xem tin này nhé!"` và gửi đi.
   - Màn hình của Dũng: Trạng thái tin nhắn hiển thị vòng xoay gửi `◌`. Do Hiếu offline, hệ thống tự động thử lại 3 lần. Khi hết 3 lần, xuất hiện thông báo toast đỏ báo lỗi gửi socket trực tiếp, tiếp nối bằng thông báo toast vàng báo `"Đã lưu tạm"`. Trạng thái tin chuyển sang biểu tượng thất bại `✗`.
   - Khởi động lại Peer B (Hiếu) bằng lệnh ban đầu và mở lại `http://localhost:6002`.
   - Màn hình của Hiếu: Ngay lập tức xuất hiện thông báo toast màu vàng `"Tin nhắn offline"`. Hiếu click chọn Dũng để xem sẽ thấy tin nhắn kèm badge màu cam ghi `[OFFLINE]` và thời gian lưu tin tương đối.

6. **Kiểm thử bảo mật (AES-256-CBC)**:
   - Tắt các peer cũ, chạy lại với tham số `--key dung123` (ví dụ: `node peer.js --id peer-a --name Dung --port 5001 --gui true --key dung123`).
   - Quan sát giao diện: Xuất hiện badge màu xanh lá biểu tượng ổ khóa ghi `🔒 AES-256` dưới ô nhập tin nhắn và trạng thái Encryption trong panel thông tin là `🔒 AES-256-CBC`.
   - Khi gửi tin nhắn qua lại, các tin nhắn hiển thị kèm badge `🔒 ENC` nhỏ gọn màu xám chứng minh tin nhắn được truyền qua socket dưới dạng ciphertext.

---

### 10.4. Kịch bản kiểm thử mã hóa đầu-cuối (E2EE) trên CLI

**Mục tiêu**: Xác minh tin nhắn được mã hóa trước khi truyền đi qua TCP socket và giải mã đúng cách khi các bên có khóa hợp lệ.

**Cấu hình chạy**:
* Khởi động 3 peer trong đó Peer A và B dùng chung khóa bí mật `dung123`, còn Peer C dùng khóa khác hoặc không dùng khóa:
  ```bash
  # Terminal 2 (Peer A - Dũng - Key 'dung123')
  node peer.js --id peer-a --name Dung --port 5001 --key dung123

  # Terminal 3 (Peer B - Hiếu - Key 'dung123')
  node peer.js --id peer-b --name Hieu --port 5002 --key dung123

  # Terminal 4 (Peer C - Việt - Key 'viet456')
  node peer.js --id peer-c --name Viet --port 5003 --key viet456
  ```

**Kịch bản thực thi & kết quả quan sát**:
1. **Trường hợp giải mã thành công (Đúng khóa)**:
   - Hành động: `peer-a> /msg peer-b Hello Hieu!`
   - Kết quả: Hiếu nhận được tin nhắn và giải mã thành công, hiển thị: `[MSG from peer-a] [ENC]✅ Hello Hieu!`.
2. **Trường hợp lỗi giải mã (Sai khóa)**:
   - Hành động: `peer-a> /msg peer-c Hi Viet!`
   - Kết quả: Việt nhận được tin nhắn nhưng do dùng khóa bí mật khác (`viet456`), hệ thống không thể giải mã và hiển thị cảnh báo: `[MSG from peer-a] [DECRYPTION FAILED — wrong key]`.
3. **Trường hợp không có khóa để giải mã (Không cấu hình key)**:
   - Hành động: Nếu tắt Peer C đi và khởi chạy lại không có tham số `--key` (`node peer.js --id peer-c --name Viet --port 5003`), sau đó Dũng gửi `/msg peer-c Hello!`.
   - Kết quả: Việt nhận được tin nhắn dạng chuỗi mã hóa gốc và hiển thị cảnh báo: `[MSG from peer-a] [ENCRYPTED — không có key để giải mã]`.

### 10.5. Kịch bản kiểm thử mô phỏng Churn tự động (Churn Simulation)

**Mục tiêu**: Đánh giá độ ổn định và khả năng tự phục hồi của mạng Hybrid P2P khi các nút liên tục tham gia và rời khỏi mạng đột ngột (Churn).

**Cách chạy**:
1. Đảm bảo Bootstrap Server đang chạy trên cổng mặc định (3000):
   ```bash
   cd bootstrap-server && npm run dev
   ```
2. Chạy script mô phỏng churn tại thư mục gốc:
   ```powershell
   node churn-sim.js --rounds 3
   ```

**Các bước thực thi tự động của Script**:
1. **Spawn Churn Peers**: Script tự động tạo ra 3 tiến trình con chạy `peer.js`: `Churn-Alpha` (port 5101), `Churn-Beta` (port 5102), và `Churn-Gamma` (port 5103).
2. **Kiểm tra Peer List**: Script gọi API `GET /peers` tới Bootstrap Server để xác nhận cả 3 nút churn đã đăng ký trực tuyến thành công.
3. **Mô phỏng thời gian online**: Các nút hoạt động bình thường trong 8 giây (để các nút khác nếu có trong mạng tiến hành gửi tin hoặc broadcast).
4. **Mô phỏng ngắt kết nối đột ngột (Churn Leave)**: Script gửi lệnh `SIGTERM/SIGKILL` để tắt toàn bộ 3 tiến trình peer churn này.
5. **Dọn dẹp và cập nhật trạng thái**: Đợi Bootstrap Server tự động dọn dẹp các nút mất kết nối sau thời gian hết hạn heartbeat (timeout 15 giây). Gọi lại `GET /peers` để xác nhận danh sách peer online đã trống rỗng.
6. **Lặp lại vòng tiếp theo**: Thực hiện lặp lại quy trình trên trong 3 vòng liên tiếp để chứng minh hệ thống không bị lỗi xung đột cổng kết nối hoặc rò rỉ bộ nhớ.

---


## 11. KẾT LUẬN VÀ HƯỚNG PHÁT TRIỂN

### 11.1. Đánh giá kết quả

| Tiêu chí đánh giá | Kết quả |
|---------|---------|
| **Tính phân tán** | ✅ Tin nhắn đi trực tiếp TCP peer-to-peer, không qua server |
| **Peer Discovery** | ✅ Bootstrap Tracker HTTP, heartbeat 5s, auto-timeout 15s |
| **Độ tin cậy** | ✅ ACK + Retry 3 lần, timeout 5s, deduplication O(1) |
| **Bảo mật** | ✅ AES-256-CBC E2E, IV ngẫu nhiên, SHA-256 key derivation |
| **Chịu lỗi** | ✅ Store-and-Forward (50 tin, TTL 1h), Churn Simulation |
| **Kiểm thử** | ✅ 38/38 test cases passed, 0 failed |
| **Giao diện** | ✅ CLI (readline + ANSI) + Web GUI (Socket.IO, glassmorphism) |

### 11.2. Điểm kỹ thuật nổi bật

1. **Factory Function + DI Pattern**: Tránh circular dependency trong module graph phức tạp
2. **Singleton qua Module Cache**: `state.js`, `eventBus.js` chia sẻ state an toàn không dùng global
3. **NDJSON Framing**: Giải quyết TCP stream boundary problem một cách đơn giản, hiệu quả
4. **Timer-before-Send**: Khắc phục "double execution bug" trong cơ chế retry bất đồng bộ
5. **Half-duplex ACK trên cùng socket**: Tiết kiệm kết nối, giảm latency so với mở socket mới
6. **Event Bus decoupling**: Core modules và Web GUI hoàn toàn tách biệt, không circular dep

### 11.3. Hướng phát triển tiếp theo

| Tính năng | Hướng kỹ thuật |
|---------|--------------|
| **DHT Peer Discovery** | Thay Bootstrap bằng Kademlia DHT — P2P hoàn toàn, không cần server |
| **Key Exchange** | Thay PSK bằng ECDH — không cần chia sẻ khóa trước |
| **NAT Traversal** | STUN/TURN để kết nối peer qua NAT khác nhau |
| **Persistent Storage** | SQLite hoặc LevelDB thay vì in-memory + localStorage |
| **Group Encryption** | Group Key Agreement (GKA) cho mã hóa nhóm |
| **File Transfer** | Truyền file trực tiếp qua TCP stream |
| **Mobile App** | React Native / Flutter kết nối qua WebSocket tới peer node |

---

*Báo cáo được tổng hợp từ mã nguồn thực tế của dự án — Học viện Công nghệ Bưu chính Viễn thông (PTIT) 🎓*
