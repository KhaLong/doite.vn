# doite.vn — Sàn đổi tệ (CNY ⇄ VND) giữa người với người

Người dùng đăng tin cần bán / cần mua CNY hoặc nạp Alipay / WeChat hộ. Người khác xem Bảng tin, nhắn tin thời gian thực để chào giá, và đánh giá nhau sau khi giao dịch xong.

- **Server:** Rust (Axum 0.8) + MySQL 8.4. Một file chạy duy nhất, các trang HTML được nhúng vào lúc build.
- **Giao diện:** HTML thuần + Tailwind v3 (bản CDN) + icon SVG nội tuyến, không có bước build frontend.
- **Thiết kế:** mọi quyết định giao diện và tính năng ghi trong [`DESIGN.md`](DESIGN.md). **Đọc file đó trước khi sửa giao diện.**
- **Làm việc cùng Claude Code:** quy tắc, skill và quy trình ghi trong [`CLAUDE.md`](CLAUDE.md).

---

## 1. Đã có gì

| Trang | Đường dẫn | Ghi chú |
| --- | --- | --- |
| Bảng tin | `/` | Lọc theo loại / kênh / số tệ, tin của mình tô xanh, chấm đỏ tin nhắn chưa đọc |
| Đăng ký / Đăng nhập / Quên mật khẩu | `/dang-ky.html`, `/dang-nhap.html`, `/quen-mat-khau.html` | Số điện thoại + mã OTP SMS (đang in mã ra log) |
| Trang cá nhân | `/tai-khoan.html` | Ảnh đại diện (cắt ảnh), lịch sử giao dịch, lịch sử đăng nhập (IP, thiết bị, vị trí) |
| Đăng tin | `/dang-tin.html` | Số tệ 100–1.000.000, tỷ giá ±10% tham chiếu, tối đa 5 tin còn hạn |
| Trang công khai | `/nguoi-dung/<tên>` | Uy tín, tin đang mở, đánh giá (chỉ người đã hoàn tất giao dịch) |
| Tin nhắn | `/tin-nhan.html` | Realtime (SSE): đã xem, đang soạn, gửi lại khi mất mạng, không lặp tin |

**Chưa có:** luồng Chào giá thật (đang tạm mở tin nhắn soạn sẵn), sửa / đóng tin của mình, tỷ giá tham chiếu thật (đang cố định 3.530), gửi SMS thật, đăng nhập Google, GeoLite2 (vị trí đăng nhập), sửa hồ sơ, đổi mật khẩu khi đã đăng nhập.

## 2. Cấu trúc thư mục

```
src/
  main.rs        định tuyến, phục vụ trang, khởi động (đọc .env, chạy migrations)
  auth.rs        đăng ký, OTP, đăng nhập, phiên (cookie doite_session), giới hạn tần suất, AppState
  account.rs     lịch sử đăng nhập, đăng xuất thiết bị khác, GeoIP
  avatar.rs      ảnh đại diện (lưu trong DB, mã hoá lại JPEG)
  posts.rs       Bảng tin, đăng tin
  trades.rs      lịch sử giao dịch
  users.rs       trang công khai, đánh giá
  messages.rs    tin nhắn: gửi (chống trùng bằng clientId), đã xem, đang soạn, tin cũ hơn
  realtime.rs    Hub đẩy sự kiện + GET /api/events (Server-Sent Events)
migrations/      0001…0008 — server tự chạy khi khởi động (sqlx migrate)
*.html, auth.js, live.js, page-transitions.*   giao diện (nhúng vào binary bằng include_str!)
tests/e2e/       test đầu cuối bằng trình duyệt thật (playwright-core)
scripts/         tao-database.sql
DESIGN.md        quyết định thiết kế, từng màn, người dùng đã dặn gì
CLAUDE.md        hướng dẫn cho Claude Code khi làm tiếp dự án
wireframe*.html  wireframe cũ (tham khảo)
```

## 3. Cài đặt lần đầu (Windows 10/11)

### 3.1. Rust (bản GNU, không cần Visual Studio)

1. Cài [rustup](https://rustup.rs). Khi hỏi, chọn **customize** → host `x86_64-pc-windows-gnu`. Nếu đã cài rồi thì chạy `rustup set default-host x86_64-pc-windows-gnu`.
2. Cài **WinLibs MinGW-w64** (UCRT, x86_64) từ <https://winlibs.com>, rồi thêm thư mục `mingw64\bin` vào PATH. Có thể cài nhanh bằng `winget install BrechtSanders.WinLibs.POSIX.UCRT`. Thư viện `windows-sys` cần `dlltool` trong bộ này.
3. File `rust-toolchain.toml` ghim Rust **1.99.1**, nên cargo tự tải đúng bản. Nếu gặp lỗi `link.exe not found` thì cargo đang dùng bản MSVC: làm lại bước 1.

> Mở cửa sổ PowerShell **mới** sau khi cài để nhận PATH. Nếu vẫn chưa nhận, chạy:
> `$env:Path = "$env:USERPROFILE\.cargo\bin;" + [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")`

### 3.2. MySQL 8.4

1. Cài MySQL Server 8.4 (`winget install Oracle.MySQL`, hoặc bộ cài MSI). Chạy như dịch vụ Windows ở `127.0.0.1:3306` và ghi lại mật khẩu root.
2. Mở `scripts/tao-database.sql`, đổi `DOI_MAT_KHAU_NAY` thành mật khẩu bạn chọn, rồi chạy:
   ```powershell
   & "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe" -u root -p < scripts\tao-database.sql
   ```
   (PowerShell không hỗ trợ `<`. Có hai cách thay: `Get-Content scripts\tao-database.sql | & "...\mysql.exe" -u root -p`, hoặc mở mysql rồi dán nội dung file vào.)

### 3.3. File `.env`

```powershell
Copy-Item .env.example .env
```

Mở `.env` và sửa `DATABASE_URL=mysql://doite:<mật khẩu ở bước 3.2>@127.0.0.1:3306/doite`. Các biến khác giữ nguyên khi chạy trên máy mình:

| Biến | Ý nghĩa |
| --- | --- |
| `DATABASE_URL` | Chuỗi kết nối MySQL |
| `BIND_ADDR` | Địa chỉ server, mặc định `127.0.0.1:3001` |
| `COOKIE_SECURE` | Đặt `true` khi chạy HTTPS |
| `SMS_MODE` | `log`: mã OTP chỉ in ra cửa sổ server (thử nghiệm) |
| `GEOIP_DB` | (tuỳ chọn) đường dẫn `GeoLite2-City.mmdb` để hiện vị trí đăng nhập |
| `TRUST_PROXY` | Đặt `true` khi chạy sau nginx, để đọc IP thật từ `X-Forwarded-For` |

**Không bao giờ commit `.env`** (đã có trong `.gitignore`).

## 4. Chạy

```powershell
cargo run --locked
```

Lần đầu sẽ biên dịch vài phút. Khi thấy dòng `doite.vn đang chạy tại http://127.0.0.1:3001` thì mở địa chỉ đó trên trình duyệt. Bảng và 6 tin mẫu (tài khoản `mau.*`) tự được tạo.

- **Đăng ký thử:** mã OTP không gửi SMS mà in ra cửa sổ server, dạng `[OTP thử] +84… (đăng ký): 123456`.
- **Sau khi sửa file HTML / JS / CSS:** các trang được nhúng vào lúc build, nên phải tắt server (Ctrl+C) rồi chạy lại `cargo run --locked`. Chỉ tải lại trình duyệt thì không thấy thay đổi.
- **Kiểm tra code:** `cargo clippy --all-targets` và `cargo test` (unit test, không cần DB).

## 5. Test đầu cuối (trình duyệt thật)

Cần Node.js LTS và Microsoft Edge (hoặc Chrome).

```powershell
cargo build --locked
cd tests\e2e; npm install; cd ..\..
$env:MYSQL_PWD = "<mật khẩu root MySQL>"      # test dùng root để đọc và dọn dữ liệu test
powershell -ExecutionPolicy Bypass -File tests\e2e\chay-tat-ca.ps1 -Photo C:\anh-bat-ky.jpg
Remove-Item Env:MYSQL_PWD
```

- Chạy một vài bộ: thêm `-Only realtime-live,social-live`.
- Dùng Chrome thay Edge: `$env:BROWSER_CHANNEL = "chrome"`. MySQL cài chỗ khác thì đặt `$env:MYSQL_BIN`.
- Test chỉ tạo tài khoản `test.*` và tự xoá khi xong. Ảnh chụp màn hình nằm trong `tests/e2e/out/`.
- `realtime-live` (49 mục) có bước **tắt rồi bật lại server**, để kiểm tra tin nhắn nối lại được.

Lần chạy gần nhất đạt hết: auth, account, backfill, mobile-header, avatar, crop (14), trades (16), post (24), transition (9), mine (9), social (24), realtime (49).

## 6. Đưa lên mạng (khi cần)

- Build bản chạy thật: `cargo build --release --locked`, được file `target/release/doite.exe` (Linux là `doite`). Chép file đó cùng `.env` lên server, không cần thư mục nào khác.
- Đặt sau **nginx có HTTPS và HTTP/2**. Không có HTTP/2 thì trình duyệt chỉ mở được 6 kết nối mỗi tên miền, nhiều tab tin nhắn sẽ bị nghẽn. Đặt `COOKIE_SECURE=true` và `TRUST_PROXY=true`.
- Riêng `location /api/events` cần `proxy_buffering off;`, `proxy_read_timeout 1h;` và `proxy_http_version 1.1;`. Server gửi ping mỗi 20 giây.
- Phần realtime chạy trong bộ nhớ của một tiến trình. Muốn chạy nhiều tiến trình thì thay `Hub` trong `src/realtime.rs` bằng Redis hoặc NATS pub/sub.
- Trước khi mở thật: cắm nhà cung cấp SMS vào hàm `send_otp` (src/auth.rs) và đặt `SMS_MODE` khác `log`.

## 7. Lỗi hay gặp

| Triệu chứng | Cách xử lý |
| --- | --- |
| `link.exe not found` | Rust đang dùng MSVC. Chạy `rustup set default-host x86_64-pc-windows-gnu` |
| `dlltool not found` | Chưa cài WinLibs hoặc chưa thêm `mingw64\bin` vào PATH |
| `cargo` / `node` không nhận | Mở PowerShell mới, hoặc chạy lệnh nạp PATH ở mục 3.1 |
| Server báo lỗi kết nối DB | Dịch vụ `MySQL84` chưa chạy (`Start-Service MySQL84`), hoặc sai mật khẩu trong `.env` |
| Sửa HTML mà trang không đổi | Chưa build lại: tắt server rồi `cargo run --locked` |
| Đăng ký báo "quá nhiều lần" | Giới hạn 10 lần đăng ký mỗi IP. Khởi động lại server để xoá bộ đếm (bộ đếm nằm trong bộ nhớ) |
| Cổng 3001 đang bận | Có server cũ đang chạy: `Get-Process doite \| Stop-Process` |
