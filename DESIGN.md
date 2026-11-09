# Thiết kế giao diện

Skill evon:ui-ux đọc file này trước khi dựng. Sửa tay được; file trái với code thì code thắng.

## Sản phẩm
- Sản phẩm: Sàn giao dịch đổi Nhân Dân Tệ (CNY) sang VND & ngược lại (doite.vn)
- Người dùng: Người buôn bán hàng Taobao/1688, kiều bào, du học sinh, thương nhân đổi tệ P2P
- Việc chính: Kết nối người đăng bài đổi tệ và thương nhân chào giá, thanh toán hộ Alipay/WeChat
- Nền tảng: Web Responsive (Desktop + Mobile Phone)
- Điểm khác biệt: Kết nối trực tiếp người cần đổi tiền và thương nhân uy tín đã xác thực ký quỹ

## Giao diện
- Bộ mặt: Soft (P13): font Be Vietnam Pro, sắc Neutral, nhấn Xanh dương (`#2563eb`), Logo 2 (Mũi tên đảo chiều P2P)
- Phương án chọn: Phương án A — Lưới thẻ bài đăng + Tỷ giá trực tiếp (giữ nguyên nguyên bản theo wireframe)
- Phong cách: Flat / Soft, pure inline SVG, không dùng CDN ngoài

## Người dùng dặn
- Chọn Phương án A nguyên bản, không chỉnh sửa thêm bớt bố cục hay nội dung
- Xuất bản mẫu xem trực tiếp trên đám mây và điện thoại

## Màn đã dựng
- `index.html`: Trang chủ Sàn Đổi Tệ P2P — Phương án A (khớp 153/153 neo 1440px & 144/144 neo 375px với wireframe, 0 mục Hỏng)
- `wireframe.html`: Wireframe 3 phương án A/B/C (mặc định Phương án A)
- `wireframe-mobile.html`: Wireframe bản di động (mặc định Phương án A, 0 lỗi probe)
