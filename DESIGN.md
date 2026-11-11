# Thiết kế giao diện

Skill evon:ui-ux đọc file này trước khi dựng. Sửa tay được; file trái với code thì code thắng.

## Sản phẩm
- Sản phẩm: Sàn giao dịch đổi Nhân Dân Tệ (CNY) sang VND & ngược lại (doite.vn)
- Người dùng: Người buôn bán hàng Taobao/1688, kiều bào, du học sinh, thương nhân đổi tệ P2P
- Việc chính: Tìm tin đổi tệ đúng chiều cần với tỷ giá tốt rồi chào giá; đăng tin đổi tệ; biết tỷ giá hôm nay
- Mô hình: khách đăng tin nhu cầu, thương nhân bấm "Chào giá" (không phải thương nhân đăng quảng cáo)
- Nền tảng: Web responsive, điện thoại nhiều hơn máy tính (đoán, cần kiểm)
- Điểm khác biệt: Thương nhân đã xác thực và ký quỹ với sàn, không phụ phí sàn — hiện ngay trên dòng của từng người đăng

## Kỹ thuật
- Server Rust (Axum, như duodate), dữ liệu MySQL (người dùng chọn 11/2026). `cargo run --locked` → http://127.0.0.1:3001; migrations/ tự chạy khi khởi động; `.env` (gitignored) theo `.env.example`
- API: `/api/auth/*` (src/auth.rs: đăng ký + OTP SMS, đăng nhập bằng tên hoặc số, quên mật khẩu, đăng xuất, me), `/api/posts` (src/posts.rs: Bảng tin)
- OTP đang `SMS_MODE=log` (in mã ra console); cắm nhà cung cấp SMS ở `send_otp` trong src/auth.rs
- Chưa có: sửa hồ sơ, đổi mật khẩu khi đã đăng nhập, quản lý tin của tôi (sửa, đóng tin), chào giá khi đã đăng nhập, phân trang Bảng tin, tỷ giá và thương nhân ký quỹ thật, đăng nhập Google

## Giao diện
- Bộ mặt: Soft (P13): font Be Vietnam Pro, sắc Neutral, nhấn Xanh dương `#2563eb`, Logo 2 (Mũi tên đảo chiều P2P)
- Token màu ở khối `:root` trong `index.html`; Tailwind v3 (script allowlisted) trỏ tên lớp vào biến qua `tailwind.config`
- Phong cách: Flat / Soft, icon SVG nội tuyến (không CDN icon, vì CSP)

## Người dùng dặn
- Trang chủ: ưu tiên danh sách bài đăng lên đầu (11/2026, thay cho "giữ Phương án A nguyên bản" trước đó)
- Đã chọn bố cục mới "A · Sổ lệnh dạng dòng" từ wireframe 3 phương án

## Màn đã dựng
- `index.html` Trang chủ — A · Sổ lệnh dạng dòng:
  1. Header dính: logo, tỷ giá hôm nay (từ lg), Đăng tin đổi tệ, Đăng nhập (điện thoại vẫn ghi chữ "Đăng nhập", không chỉ icon). Đã đăng nhập: từ 768px là tên + "Đăng xuất"; dưới 768px là ảnh đại diện tròn (chữ viết tắt) dẫn tới trang cá nhân, Đăng xuất nằm trên header trang cá nhân
  2. Dải tỷ giá tham chiếu + ô quy đổi CNY → VND + "Tạo tin theo giá này"
  3. Hàng lọc dính dưới header: tab Tất cả / Cần bán / Cần mua / Nạp Alipay (có số đếm; thứ tự Tất cả · Mua · Bán · Thanh toán; dưới 640px nhãn ngắn Tất cả / Mua tệ / Bán tệ / Thanh toán vừa một hàng, dưới 360px ẩn số đếm, người dùng dặn 11/2026), ô "Số tệ cần đổi", menu Kênh, menu Sắp xếp (ẩn trên điện thoại)
  4. Danh sách tin (tiêu đề "Bảng tin", dưới là dải cảnh báo hổ phách "Hãy cẩn thận khi giao dịch với các tài khoản mới", người dùng đặt 11/2026): mỗi tin một dòng, cột Người đăng (uy tín, ký quỹ) · Nhu cầu · Tỷ giá · Kênh/hạn mức · Chào giá; dưới 1024px mỗi tin là một thẻ riêng cách nhau 12px (người dùng dặn 11/2026: tin dính nhau), từ 1024px là một bảng chung kẻ `#e8e8ec`. Đủ trạng thái đang tải / rỗng / lỗi (`?tt=dang-tai|rong|loi` để xem)
  5. Thương nhân ký quỹ + 3 bước giao dịch an toàn
  6. Footer
- Chỗ nối API: `window.DoiteHandlers` (onCreatePost, onLogin, onBid, onLoadMore, onFiltersChange); dữ liệu mẫu ở `POSTS`, `REFERENCE`, `MERCHANTS`
- `wireframe.html`, `wireframe-mobile.html`: wireframe cũ (Phương án A/B/C bản đầu)
- `dang-nhap.html`, `dang-ky.html`, `quen-mat-khau.html` — xác thực, phương án A · Một cột giữa màn (11/2026). Chung logic và giao diện ở `auth.js`:
  - Ô số điện thoại có cờ Việt Nam + "+84" cố định đầu ô (người dùng dặn); nhận "912…", "0912…" hay dán "+84…"; gửi backend dạng `+84912345678`
  - Đăng nhập bằng **số điện thoại** + mật khẩu, xác minh bằng mã OTP qua SMS; một loại tài khoản chung (thương nhân nộp hồ sơ ký quỹ sau, trong app)
  - Card trắng không viền `max-w-md`, logo trên tiêu đề, ô và nút `h-12`, có "Quên mật khẩu?" cùng hàng nhãn, nút Google; không "Ghi nhớ đăng nhập"
  - Đăng ký (người dùng dặn 11/2026): Tên đăng nhập (4–20 ký tự, chữ không dấu, số, . _), Tên hiển thị, Số điện thoại, Mật khẩu, Nhập lại mật khẩu, ô tick đồng ý điều khoản (không tick sẵn, bắt buộc). Phải vừa một màn laptop không cuộn (người dùng dặn): từ 640px thẻ `max-w-2xl`, ô xếp 2 cột (Số điện thoại trải cả hàng), "Đã có tài khoản? Đăng nhập" ở góc trên phải cạnh logo, nút Google cạnh nút "Tạo tài khoản"
  - Câu dẫn nói việc đang chờ khi có `?tin=` ("Đăng nhập để gửi chào giá cho tin …"); xong thì về `?tiep=` (chỉ nhận đường dẫn trong site)
  - Chỗ nối API: `window.DoiteAuth` (login, register, verifyOtp, resendOtp, requestReset, resetPassword, google); xem trạng thái tĩnh bằng `?buoc=` và `?tt=dang-gui|loi`

- `tai-khoan.html` — Trang cá nhân, phương án A · Một cột (11/2026): thẻ tài khoản (tên hiển thị, @tên đăng nhập, số điện thoại che giữa, ngày tham gia) trên; "Lịch sử đăng nhập" dưới: 20 lần gần nhất trong 90 ngày, cột Thiết bị · thời gian | Địa chỉ IP | Vị trí | Kết quả (Phiên này / Thành công / Sai mật khẩu, dòng sai tô vàng), dải cảnh báo tổng hợp lần sai, nút "Đăng xuất khỏi các thiết bị khác". Điện thoại: mỗi lần 3 hàng chữ. Mở bằng cách bấm tên trên header; chưa đăng nhập thì chuyển sang đăng nhập rồi quay lại. API `/api/account`, `/api/account/logout-others` (src/account.rs). Vị trí từ GeoLite2 (`GEOIP_DB`), chưa có file thì "Chưa xác định vị trí"; IP nội bộ "Mạng nội bộ"

- Ảnh đại diện (11/2026, người dùng xin): đổi ở thẻ tài khoản trang cá nhân (nút máy ảnh trên ảnh + "Đổi ảnh" / "Thêm ảnh đại diện", "Xoá ảnh"). Chọn ảnh xong mở hộp "Chỉnh ảnh đại diện" (khung tròn, kéo để căn, thanh trượt và nút −+ / cuộn chuột / phím để phóng to, Huỷ · Lưu ảnh; điện thoại nổi từ đáy); chỉ khi "Lưu ảnh" mới cắt 256px và gửi; server (src/avatar.rs) giải mã và mã hoá lại JPEG, lưu trong `users.avatar`, phục vụ ở `/anh-dai-dien/<tên>.jpg?v=…`. Ảnh hiện ở header (trang chủ, trang cá nhân) và trên tin trong Bảng tin; chưa có ảnh thì chữ viết tắt

- Lịch sử giao dịch (11/2026, người dùng xin, dựng luôn không wireframe): khối giữa thẻ tài khoản và lịch sử đăng nhập. Tab Tất cả / Đang xử lý (gồm Khiếu nại) / Hoàn tất / Đã huỷ có số đếm; 20 giao dịch mỗi trang + "Xem thêm"; đang xử lý và khiếu nại đứng đầu. Máy tính: bảng Giao dịch (loại · thời gian) | Số tệ | Tỷ giá | Thành tiền | Đối tác | Trạng thái; điện thoại 3 hàng chữ. Loại nhìn từ phía người xem (Bán / Mua CNY, Thanh toán, Thanh toán hộ). Bảng `trades` (migrations/0005), API `/api/account/trades` (src/trades.rs). Chưa có luồng tạo giao dịch (chào giá), chưa có trang chi tiết / khiếu nại

- `dang-tin.html` — Đăng tin đổi tệ (11/2026, dựng luôn): trang riêng (cần đăng nhập, chưa vào thì đăng nhập rồi quay lại, giữ ?cny=). Thẻ một cột max-w-2xl: Loại tin (3 thẻ chọn: Cần bán CNY / Cần mua CNY / Thanh toán hộ), Số tệ | Tỷ giá mong muốn (người dùng tự nhập, gợi ý tham chiếu dưới ô), dải quy đổi "Bạn nhận về / Bạn trả khoảng … ₫", Kênh (chip chọn nhiều), Ghi chú/hạn mức (≤120 ký tự, đếm từ 80%), Nhận chào giá trong 30 phút / 2 giờ / 24 giờ; thanh Huỷ · Đăng tin dính đáy màn hình (người dùng không thấy nút ở cuối form), trên nút báo "Còn N mục chưa đúng ở trên" bấm để nhảy tới. Đăng xong về Bảng tin `?moi=<id>`: dải xanh "Đã đăng tin…", tin mới đứng đầu, viền xanh 6 giây. Server (src/posts.rs): số tệ 100–1.000.000, tỷ giá ±10% tham chiếu 3.530, tối đa 5 tin còn hạn mỗi tài khoản; tin hết hạn rời Bảng tin, còn dưới 1 giờ hiện "Hết hạn chào giá sau N phút"

- Chuyển trang (11/2026, người dùng xin): View Transitions giữa các trang (`page-transitions.css`, nạp ở mọi trang): trang cũ mờ 120ms, trang mới hiện + trượt lên 8px trong 240ms; header (`view-transition-name: site-header`) đứng yên. Trình duyệt cũ: nội dung hiện dần 180ms (`page-transitions.js`). Tắt khi người dùng bật giảm chuyển động

- Tin của chính mình trên Bảng tin (11/2026, người dùng xin): nền #f5f8ff + vạch xanh 3px mép trái + nhãn đặc "Tin của bạn" cạnh tên; không có nút Chào giá (máy tính ghi "Chờ chào giá" ở cột nút, điện thoại chỉ giữ nhãn); sắp xếp Mới nhất thì đứng đầu. API `/api/posts` trả `mine` theo phiên

- `/nguoi-dung/<tên>` (nguoi-dung.html) — Trang công khai (11/2026, dựng luôn): ảnh 64px, tên, @tên · tham gia, huy hiệu (Ký quỹ / Doanh nghiệp đã xác thực / Thành viên mới), nút Nhắn tin (chính) + Đánh giá; 4 ô chỉ số (Giao dịch hoàn tất · Tỷ lệ thành công · Đánh giá · Ký quỹ); Tin đang mở (Chào giá); Đánh giá (sao, người đánh giá → trang của họ, "Đã giao dịch: Bán CNY 6.000 ¥", bình luận). Không hiện số điện thoại / lịch sử riêng. Trang của chính mình: dòng "Đây là trang công khai của bạn · Sửa ở trang cá nhân". Lối vào: tên/ảnh người đăng trên Bảng tin, tên đối tác ở Lịch sử giao dịch, tên người đánh giá. API `/api/users/<tên>` (src/users.rs)
- Đánh giá: chỉ người đã cùng **hoàn tất** giao dịch, mỗi giao dịch một lần (bảng `reviews`, UNIQUE trade+người). Không đủ điều kiện: bấm Đánh giá hiện dòng giải thích, không mở hộp. Hộp: chọn giao dịch, 1–5 sao (Rất tệ…Rất tốt), bình luận ≤500 ký tự
- `tin-nhan.html` — Tin nhắn (11/2026): máy tính danh sách 20rem | khung chat, điện thoại một màn (← quay lại). Bong bóng mình xanh phải, người kia xám trái, tách theo ngày; Enter gửi, Shift+Enter xuống dòng. Header trang chủ / trang công khai có nút tin nhắn + số chưa đọc (cập nhật trực tiếp). `?u=<tên>` mở hội thoại; "Chào giá" khi đã đăng nhập → tin nhắn soạn sẵn "Chào bạn, mình muốn chào giá cho tin …" (tạm, tới khi có luồng chào giá). API `/api/messages*` (src/messages.rs)
- Nhắn tin thời gian thực (11/2026, người dùng dặn: "kiểm tra kĩ để không xảy ra lỗi, đảm bảo realtime, sau này còn kèm công cụ hỗ trợ"):
  - Đẩy bằng SSE `GET /api/events` (src/realtime.rs, `Hub` trong bộ nhớ, tối đa 8 tab mỗi người), gửi bằng POST. Sự kiện: `ready{unread}`, `message`, `read`, `typing`, `unread`, `conversation-read`, `resync` (tab chậm bị lỡ → tải bù). Client dùng chung `/live.js`: tự nối lại (chờ 2 → 30 giây), nối xong lấy bù tin `?after=`, SSE hỏng thì tải định kỳ 5 giây, tab ẩn thì đóng kết nối (trừ trang tin nhắn), có mạng lại thì nối ngay
  - Không mất, không lặp tin: mỗi tin gửi kèm `clientId` (UUID trình duyệt), UNIQUE(sender, client_id): gửi lại cùng mã trả đúng tin cũ. Client gộp mọi nguồn (phản hồi POST, echo SSE, lấy bù) theo clientId rồi id, sắp theo id; gửi lần lượt đúng thứ tự gõ
  - Gửi lạc quan: tin hiện ngay, mờ + "Đang gửi…"; lỗi → "Chưa gửi được · Gửi lại" (lỗi mạng tự gửi lại khi có mạng / nối lại). Tin cuối của mình ghi "Đã gửi" / "Đã xem"
  - "Đã xem" chỉ khi hội thoại đang mở và tab đang hiện (POST `/api/messages/{id}/read {upTo}`); GET hội thoại không tự đánh dấu. "<Tên> đang soạn tin…" (POST `…/typing`, ≤ 1 lần / 3 giây, tắt sau 6 giây)
  - Dải trên khung: "Đang kết nối lại…" (chỉ khi mất quá 2 giây) / "Mất kết nối trực tiếp. Tin mới vẫn tự tải vài giây một lần." Đang đọc tin cũ mà có tin mới: nút "N tin mới ↓", không giật cuộn. Mở hội thoại thấy 50 tin mới nhất, "Xem tin cũ hơn" tải thêm 50, giữ chỗ đang đọc. Tiêu đề tab "(N) Tin nhắn"
  - Mở rộng công cụ (ảnh, đề nghị tỷ giá, ảnh chuyển khoản, tin hệ thống…): cột `kind` + `meta` JSON (migrations/0008). Thêm loại = một nhánh `validate_kind` (src/messages.rs) + giá trị trong CHECK `chk_messages_kind` + một mục `KINDS` (bubble, preview) ở tin-nhan.html. Loại lạ hiện "Loại tin này cần tải lại trang để xem"
  - Giới hạn: một tiến trình server (nhiều tiến trình thì thay `Hub` bằng Redis/NATS pub/sub, giữ `publish`/`subscribe`). Triển khai sau nginx: HTTPS + HTTP/2 (HTTP/1.1 chỉ 6 kết nối mỗi tên miền), `proxy_buffering off` cho `/api/events` (server đã gửi `X-Accel-Buffering: no`), `proxy_read_timeout` > 20 giây (server gửi ping 20 giây)
  - Kiểm: 30 unit test; e2e `realtime-live` 49 mục (độ trễ ~40 ms, thứ tự, gửi trùng song song, 2 tab, XSS, emoji, 1.000 ký tự, quyền 404/401, tab ẩn, mất mạng, lỗi 500 + Gửi lại, SSE bị chặn, server tắt rồi bật lại, tin cũ, 375px)

## Luồng xác thực
```
Trang chủ ─[Đăng nhập]→ dang-nhap.html
dang-nhap ─[Đăng nhập ✓]→ ?tiep (mặc định index.html) · ─[sai]→ ở lại, "Số điện thoại hoặc mật khẩu chưa đúng", xoá ô mật khẩu
dang-nhap ─[Tạo tài khoản]→ dang-ky ─[Tạo tài khoản]→ bước OTP ─[Xác nhận ✓]→ ?tiep
bước OTP ─[Đổi số]→ form đăng ký (điền sẵn, mật khẩu trống) · ─[Gửi lại mã, sau 60 giây]→ "Đã gửi mã mới"
dang-nhap ─[Quên mật khẩu?]→ quen-mat-khau (số điền sẵn) → OTP → Mật khẩu mới → Đã đổi ─[Đăng nhập]→ dang-nhap (số điền sẵn)
Mật khẩu mới ─[phiên hết hạn]→ "Phiên đặt lại đã hết hạn" ─[Gửi mã mới]→ OTP
```
