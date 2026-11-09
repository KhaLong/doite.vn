# Thiết kế giao diện

Skill evon:ui-ux đọc file này trước khi dựng. Sửa tay được; file trái với code thì code thắng.

## Sản phẩm
- Sản phẩm: Sàn giao dịch đổi Nhân Dân Tệ (CNY) sang VND & ngược lại (doite.vn)
- Người dùng: Người buôn bán hàng Taobao/1688, kiều bào, du học sinh, thương nhân đổi tệ P2P
- Việc chính: Khớp lệnh Mua/Bán CNY tức thì, thanh toán hộ Alipay/WeChat, bảo chứng ký quỹ 100%
- Nền tảng: Web Responsive (Desktop + Mobile Phone)
- Điểm khác biệt: Cơ chế khóa ký quỹ Escrow bảo hiểm 100% rủi ro lừa đảo, sổ lệnh minh bạch 0đ phí sàn

## Giao diện
- Bộ mặt: Bản B — Sổ lệnh tài chính chuyên nghiệp (P2P Orderbook)
- Font chữ: Be Vietnam Pro + Inter
- Màu chủ đạo: Xanh lá Mua (`#15803d` / Emerald-700), Xanh dương Bán (`#1d4ed8` / Blue-700), Nền Slate nhạt (`#f8fafc`)
- Phong cách: Flat Clean, hiện đại, viền mảnh chuẩn M14, không CDN ngoài, pure inline SVG
- Tương tác: Chuyển tab Mua/Bán tức thì, tính nhẩm tự động VND <-> CNY, modal đặt lệnh khóa tỷ giá 15 phút

## Người dùng dặn
- Chọn Bản B (Sổ lệnh tài chính) làm bản mặc định và tối ưu toàn diện
- Đảm bảo xem mượt mà trên điện thoại di động (Mobile Wireframe & Responsive Flagship Web)
- Không dùng CDN ngoài tránh lỗi CSP môi trường đám mây

## Màn đã dựng
- `index.html`: Flagship Web Sàn Đổi Tệ P2P (Bản B tối ưu, 0 lỗi probe 360px - 1280px)
- `wireframe-mobile.html`: Wireframe bản di động (khung smartphone, 0 lỗi probe)
- `wireframe.html`: Wireframe bản desktop (3 phương án A/B/C với Bản B mặc định)
