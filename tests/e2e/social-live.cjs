// Test đầu cuối: trang công khai, đánh giá (chỉ khi đã hoàn tất giao dịch), nhắn tin hai chiều.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright-core");
const BASE = "http://127.0.0.1:3001/";
const [LOG, OUT] = process.argv.slice(2);
const tag = Date.now().toString().slice(-5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mysql = (sql) => execFileSync(process.env.MYSQL_BIN || "C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysql.exe", ["-u", "root", "-h", "127.0.0.1", "-D", "doite", "-N", "--default-character-set=utf8mb4", "-e", sql], { encoding: "utf8" });
const results = [];
const check = (n, ok, x = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  — " + x : ""}`);

async function register(browser, who) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.__errors = [];
  page.on("pageerror", (e) => page.__errors.push(e.message));
  const e164 = `+84${who.phone.slice(1)}`;
  const lines = () => fs.readFileSync(LOG, "utf8").split(/\r?\n/).filter((l) => l.includes("[OTP") && l.includes(e164));
  await page.goto(BASE + "dang-ky.html");
  await page.fill("#username", who.username); await page.fill("#display-name", who.name); await page.fill("#phone", who.phone);
  await page.fill("#password", "matkhau-thu-1"); await page.fill("#confirm-password", "matkhau-thu-1");
  await page.click("label:has(#terms)", { position: { x: 10, y: 10 } });
  const before = lines().length;
  await page.click("button[type=submit]");
  await page.waitForSelector("[data-otp]");
  let code;
  for (let i = 0; i < 40 && !code; i++) { const l = lines(); if (l.length > before) code = l[l.length - 1].trim().slice(-6); else await sleep(250); }
  await page.focus('[data-otp="0"]'); await page.keyboard.type(code);
  await page.click("button[type=submit]");
  await page.waitForSelector('[data-action="logout"]');
  return page;
}

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge" });
  const A = { username: `test.a${tag}`, name: `An Bán Tệ ${tag}`, phone: `039${tag}111`.slice(0, 10) };
  const B = { username: `test.b${tag}`, name: `Bình Mua Tệ ${tag}`, phone: `039${tag}222`.slice(0, 10) };
  const a = await register(browser, A);
  const b = await register(browser, B);

  // A đăng 1 tin (qua SQL cho nhanh)
  mysql(`INSERT INTO posts (user_id, kind, amount_cny, rate_vnd, channel_label, channels, limit_label, expires_at)
    SELECT id, 'sell', 6000, 3536, 'Alipay', 'alipay', '', UTC_TIMESTAMP(3) + INTERVAL 1 DAY FROM users WHERE username = '${A.username}'`);

  // 1. B bấm tên A trên Bảng tin → trang công khai
  await b.goto(BASE);
  await b.waitForSelector(`a[href="/nguoi-dung/${A.username}"] >> visible=true`);
  await b.click(`a[href="/nguoi-dung/${A.username}"] >> visible=true`);
  await b.waitForURL(new RegExp(`/nguoi-dung/${A.username.replace(".", "\\.")}$`));
  await b.waitForSelector("#profile-name");
  const main = await b.textContent("main");
  check("trang công khai: tên, @tên, Thành viên mới", main.includes(A.name) && main.includes("@" + A.username) && main.includes("Thành viên mới"));
  check("không lộ số điện thoại", !main.includes(A.phone.slice(-3) + "") || !/\+84|0\d{9}/.test(main));
  check("tin đang mở của A có nút Chào giá", main.includes("6.000 ¥") && !!(await b.$("[data-bid]")));
  check("4 ô chỉ số", (await b.$$("dl > div")).length === 4);

  // 2. B chưa giao dịch với A → bấm Đánh giá thì giải thích, không mở hộp
  await b.click('[data-action="review"]');
  await b.waitForSelector('[role="status"]');
  check("chưa giao dịch xong → giải thích điều kiện, không mở hộp", (await b.textContent('[role="status"]')).includes("hoàn tất giao dịch") && !(await b.$('[role="dialog"]')));
  await b.screenshot({ path: path.join(OUT, "public-1280.png"), fullPage: true });

  // 3. Có giao dịch hoàn tất → mở hộp, gửi đánh giá
  mysql(`INSERT INTO trades (owner_id, counterparty_id, kind, amount_cny, rate_vnd, status, completed_at)
    SELECT a.id, b.id, 'sell', 6000, 3536, 'completed', UTC_TIMESTAMP(3) FROM users a, users b WHERE a.username = '${A.username}' AND b.username = '${B.username}'`);
  await b.reload();
  await b.waitForSelector("#profile-name");
  await b.click('[data-action="review"]');
  await b.waitForSelector('[role="dialog"]');
  await b.click('#review-form button[type="submit"]');
  check("gửi khi chưa chọn sao → báo lỗi", (await b.textContent("#review-form")).includes("Chọn số sao"));
  await b.click('[data-stars="5"]');
  await b.fill("#review-comment", "Giao nhanh, đúng tỷ giá.\nSẽ giao dịch tiếp.");
  await b.screenshot({ path: path.join(OUT, "review-dialog.png") });
  await b.click('#review-form button[type="submit"]');
  await b.waitForSelector('[role="dialog"]', { state: "detached", timeout: 8000 });
  await b.waitForSelector("text=Đã gửi đánh giá");
  const reviews = await b.textContent("section[aria-labelledby=reviews-title]");
  check("đánh giá hiện công khai: tên người đánh giá, nội dung, 'Đã giao dịch: Bán CNY 6.000 ¥'", reviews.includes(B.name) && reviews.includes("Giao nhanh, đúng tỷ giá.") && reviews.includes("Bán CNY 6.000 ¥"), reviews.replace(/\s+/g, " ").slice(0, 200));
  check("điểm trung bình 5 · 1 đánh giá", reviews.includes("1 đánh giá"));
  check("ô chỉ số: 1 giao dịch hoàn tất, 100%", (await b.textContent("dl")).includes("100%"));

  // 4. Đánh giá lần hai cho cùng giao dịch → không được
  await b.click('[data-action="review"]');
  await b.waitForSelector('[role="status"]');
  check("đã đánh giá giao dịch đó → không mở lại hộp", !(await b.$('[role="dialog"]')));
  const dup = await b.evaluate(async (u) => (await fetch(`/api/users/${u}/reviews`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tradeId: 1, stars: 5 }) })).status, A.username);
  check("API chặn đánh giá không đủ điều kiện (403)", dup === 403, String(dup));

  // 5. A xem trang mình: dòng 'Đây là trang công khai của bạn', không có nút Nhắn tin / Đánh giá
  await a.goto(BASE + "nguoi-dung/" + A.username);
  await a.waitForSelector("#profile-name");
  check("trang của chính mình: ghi chú + link sửa, không nút nhắn/đánh giá", (await a.textContent("main")).includes("Đây là trang công khai của bạn") && !(await a.$('[data-action="message"]')));

  // 6. Nhắn tin: B → A
  await b.goto(BASE + "nguoi-dung/" + A.username);
  await b.waitForSelector('[data-action="message"]');
  await b.click('[data-action="message"]');
  await b.waitForURL(/tin-nhan\.html/);
  await b.waitForSelector("#draft");
  await b.fill("#draft", "Chào anh, em muốn đổi 6.000 ¥");
  await b.keyboard.press("Enter");
  await b.waitForFunction(() => document.querySelector("#scroller").textContent.includes("Chào anh, em muốn đổi 6.000 ¥"));
  check("B gửi tin (Enter) → hiện trong khung chat", (await b.inputValue("#draft")) === "");
  await b.screenshot({ path: path.join(OUT, "messages-1280.png") });

  // A thấy chấm chưa đọc trên trang chủ, mở và trả lời
  await a.goto(BASE);
  await a.waitForSelector('a[href="tin-nhan.html"][aria-label*="chưa đọc"]', { timeout: 8000 });
  check("A thấy số tin chưa đọc trên header", true);
  await a.click('a[href="tin-nhan.html"]');
  await a.waitForSelector("[data-open]");
  check("danh sách: tên B, tin cuối, số chưa đọc", (await a.textContent("#list-pane")).includes(B.name) && (await a.textContent("#list-pane")).includes("Chào anh"));
  await a.click("[data-open]");
  await a.waitForSelector("#draft");
  await a.fill("#draft", "Ok em, chuyển Alipay nhé");
  await a.click('#composer button[type="submit"]');
  await a.waitForFunction(() => document.querySelector("#scroller").textContent.includes("Ok em, chuyển Alipay nhé"));
  // B nhận tin mới tự động (tải mỗi 4 giây)
  await b.waitForFunction(() => document.querySelector("#scroller").textContent.includes("Ok em, chuyển Alipay nhé"), null, { timeout: 10000 });
  check("B nhận tin trả lời tự động, không cần tải lại trang", true);

  // 7. Chào giá từ Bảng tin khi đã đăng nhập → tin nhắn soạn sẵn
  await b.goto(BASE);
  await b.waitForSelector(`li[data-post-id] a[href="/nguoi-dung/${A.username}"]`);
  const bidButton = await b.$(`li:has(a[href="/nguoi-dung/${A.username}"]) [data-bid] >> visible=true`);
  await bidButton.click();
  await b.waitForURL(/tin-nhan\.html/);
  await b.waitForFunction(() => document.querySelector("#draft")?.value.includes("muốn chào giá cho tin Cần bán CNY 6.000 ¥"));
  check("Chào giá (đã đăng nhập) → tin nhắn với người đăng, câu soạn sẵn", true);

  // 8. Người lạ không đọc được hội thoại của người khác
  const anon = await browser.newPage();
  await anon.goto(BASE);
  const peek = await anon.evaluate(async () => (await fetch("/api/messages/1")).status);
  check("chưa đăng nhập → API tin nhắn 401", peek === 401, String(peek));

  // 9. Điện thoại: tin nhắn một màn một lúc, trang công khai không cuộn ngang
  await b.setViewportSize({ width: 375, height: 812 });
  await b.goto(BASE + "tin-nhan.html");
  await b.waitForSelector("[data-open]");
  check("375: danh sách hiện, chưa có khung chat", await b.isVisible("#list-pane") && !(await b.$("#draft")));
  await b.click("[data-open]");
  await b.waitForSelector("#draft");
  check("375: mở hội thoại thì ẩn danh sách", !(await b.isVisible("#list-pane")));
  await b.screenshot({ path: path.join(OUT, "messages-375.png") });
  await b.click('[data-action="back"]');
  check("375: nút quay lại về danh sách", await b.isVisible("#list-pane"));
  await b.goto(BASE + "nguoi-dung/" + A.username);
  await b.waitForSelector("#profile-name");
  check("375: trang công khai không cuộn ngang", await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await b.screenshot({ path: path.join(OUT, "public-375.png"), fullPage: true });

  // 10. Không tồn tại
  await b.goto(BASE + "nguoi-dung/khong.co.ai");
  await b.waitForSelector("text=Không tìm thấy người dùng");
  check("người dùng không tồn tại → trang 'Không tìm thấy'", true);

  const errors = [...a.__errors, ...b.__errors];
  check("no JS errors", errors.length === 0, errors.join(" | "));
  mysql("DELETE FROM users WHERE username LIKE 'test.%'; DELETE FROM otp_codes;");
  console.log(results.join("\n"));
  await browser.close();
})().catch((e) => { console.log(results.join("\n")); console.log("CRASH", e.message); try { mysql("DELETE FROM users WHERE username LIKE 'test.%'; DELETE FROM otp_codes;"); } catch {} process.exit(1); });
