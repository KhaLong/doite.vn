# CLAUDE.md — hướng dẫn cho Claude Code khi làm tiếp doite.vn

Đọc file này, rồi `README.md` (cài đặt, chạy) và `DESIGN.md` (mọi quyết định thiết kế, màn đã dựng, điều người dùng đã dặn) trước khi sửa gì.

## Người dùng và cách làm việc

- **Luôn trả lời bằng tiếng Việt.** Mọi nhãn, thông báo và chú thích code trong dự án cũng bằng tiếng Việt.
- **Chỉ commit / push khi người dùng bảo rõ.** Người dùng làm việc lâu với bộ code này; tự ý push là sai. Repo GitHub `KhaLong/doite.vn` là **public**: trước khi push phải soát để không có mật khẩu, `.env`, email hay số điện thoại thật.
- **Không tự sửa `~/.claude/settings.json`.** Cần quyền gì thì nhờ người dùng thêm.
- Không gửi thông tin cá nhân, IP khách cho dịch vụ bên ngoài (GeoIP chỉ dùng file GeoLite2 offline).
- Tài khoản thật của người dùng trên doite (trong DB máy họ): **giữ nguyên**, không xoá. Test chỉ tạo và xoá tài khoản `test.*`.

## Skill thiết kế — BẮT BUỘC cho mọi việc giao diện

Người dùng yêu cầu "cài đặt và bám sát skill thiết kế này": skill **`evon:ui-ux`** (plugin `evon@evondevkit`, bản đang dùng 0.9.3).

- Cài trên máy mới: trong Claude Code chạy
  `/plugin marketplace add evondev/evondevKit` rồi `/plugin install evon@evondevkit` (phạm vi user).
- Mỗi việc UI: gọi skill `evon:ui-ux` và đi đúng các bước của nó:
  1. Audit dự án.
  2. Brief.
  3. Đưa 2–3 wireframe, chờ người dùng chọn rồi mới dựng.
  4. Dựng đúng phương án đã chọn.
  5. Tự kiểm tra (`probe`) trước khi giao.
- Chỉ bỏ bước wireframe khi người dùng nói "dựng luôn".
- Quyết định đã chốt (bộ mặt Soft, font Be Vietnam Pro, màu nhấn `#2563eb`, phong cách flat, token ở `:root`…) nằm trong `DESIGN.md` và **thắng** mặc định của skill. Mỗi tính năng xong thì ghi thêm vào `DESIGN.md`.

## Môi trường (Windows, PowerShell 5.1)

- Rust 1.99.1 **GNU** (ghim bằng `rust-toolchain.toml`) + WinLibs MinGW. Thiếu file ghim thì cargo dùng MSVC, báo lỗi `link.exe`.
- PowerShell không tự nhận PATH mới. Mỗi lệnh nên mở đầu bằng:
  `$env:Path = "$env:USERPROFILE\.cargo\bin;" + [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")`
- MySQL 8.4, dịch vụ `MySQL84`, ở `127.0.0.1:3306`. DB `doite`, user `doite`. Mật khẩu chỉ nằm trong `.env` (gitignored).
- Mật khẩu root MySQL nằm trong `%USERPROFILE%\duodate-mysql-root.txt`, dạng `MySQL root (localhost:3306) password: <pw>`.
  - Dùng: `$env:MYSQL_PWD = (Get-Content file).Split(' ')[-1]`.
  - **Không bao giờ in mật khẩu ra màn hình.** Dùng xong thì chạy `Remove-Item Env:MYSQL_PWD`.
- Dự án anh em `duodate` (thư mục cạnh `doite.vn`) chạy ở cổng 3000, doite chạy ở cổng 3001.

## Quy trình sau mỗi lần sửa

Trang HTML, `auth.js`, `live.js`, `page-transitions.*` được nhúng vào binary bằng `include_str!`. Vì vậy sửa bất kỳ file nào (Rust hay HTML) cũng phải làm đủ các bước:

1. `Get-Process doite -ErrorAction SilentlyContinue | Stop-Process -Force`
2. `cargo clippy --all-targets -q`, rồi `cargo test -q` (hiện có 30 unit test)
3. Chạy nền `cargo run --locked`. Đợi dòng `doite.vn đang chạy tại http://127.0.0.1:3001` trong output.
4. Chạy e2e cho phần vừa đụng tới: `tests\e2e\chay-tat-ca.ps1 -Only <bộ>` (cần `MYSQL_PWD`, xem README mục 5). Xem ảnh chụp trong `tests/e2e/out/`.

Mã OTP in ra log server theo dạng `[OTP thử] +84… (đăng ký): 123456`. Test đọc mã từ file log đó.

## Kiến trúc cần nhớ

- `AppState` (src/auth.rs) gồm:
  - `db`: MySqlPool
  - `limiter`: giới hạn tần suất trong bộ nhớ (`count` / `record`)
  - `cookie_secure`, `geo`, `trust_proxy`
  - `hub`: realtime
- Hàm dùng chung: `auth::current_user_id`, `auth::same_origin` (mọi POST đều phải kiểm tra), `avatar::AVATAR_URL_SQL`.
- Trang cần đăng nhập thì `main.rs` chuyển hướng tới `/dang-nhap.html?tiep=…`.
- **Tin nhắn realtime:**
  - Đẩy sự kiện qua SSE `GET /api/events` (src/realtime.rs). Gửi tin bằng POST (src/messages.rs).
  - Client dùng chung `/live.js`: tự nối lại; SSE hỏng thì tải định kỳ; tab ẩn thì đóng kết nối.
  - Mỗi tin có `clientId` và UNIQUE(sender, client_id), nên gửi lại không tạo tin trùng.
  - "Đã xem" chỉ tính khi client gọi POST `/read`.
  - Chi tiết ở `DESIGN.md`.
- **Thêm loại tin mới** (ảnh, đề nghị tỷ giá…), sửa ba chỗ:
  1. Một nhánh trong `validate_kind` (src/messages.rs).
  2. Giá trị mới trong CHECK `chk_messages_kind`, bằng một migration mới.
  3. Một mục trong `KINDS` ở `tin-nhan.html`.
- **Migration:** chỉ thêm file mới `migrations/00NN_*.sql`, **không sửa file đã chạy** (sqlx kiểm checksum).

## Việc còn mở (theo thứ tự người dùng có thể hỏi)

- Luồng Chào giá thật (hiện bấm Chào giá thì mở tin nhắn soạn sẵn).
- Quản lý tin của tôi: sửa, đóng tin.
- Nút tin nhắn kèm chấm chưa đọc trên header `tai-khoan.html` và `dang-tin.html`.
- Tỷ giá tham chiếu thật (đang cố định 3.530 trong src/posts.rs).
- SMS thật, GeoLite2, đăng nhập Google (đang trả 501).
