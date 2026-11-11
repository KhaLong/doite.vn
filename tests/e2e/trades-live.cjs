// Test đầu cuối Lịch sử giao dịch trên trang cá nhân.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright-core");
const BASE = "http://127.0.0.1:3001/";
const [LOG, OUT] = process.argv.slice(2);
const tag = Date.now().toString().slice(-6);
const USER = `test.${tag}`, E164 = `+84399${tag}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const otpLines = () => fs.readFileSync(LOG, "utf8").split(/\r?\n/).filter((l) => l.includes("[OTP") && l.includes(E164));
const mysql = (sql) => execFileSync(process.env.MYSQL_BIN || "C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysql.exe", ["-u", "root", "-h", "127.0.0.1", "-D", "doite", "-N", "--default-character-set=utf8mb4", "-e", sql], { encoding: "utf8" });
const results = [];
const check = (n, ok, x = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  — " + x : ""}`);
const rowsText = (page) => page.$$eval("#trades-title ~ * ul li, section[aria-labelledby=trades-title] ul li", (els) => els.map((li) => li.innerText.replace(/\s+/g, " ")));

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "dang-ky.html");
  await page.fill("#username", USER); await page.fill("#display-name", `Minh Anh ${tag}`); await page.fill("#phone", `0399${tag}`);
  await page.fill("#password", "matkhau-thu-1"); await page.fill("#confirm-password", "matkhau-thu-1");
  await page.click("label:has(#terms)", { position: { x: 10, y: 10 } });
  const before = otpLines().length;
  await page.click("button[type=submit]");
  await page.waitForSelector("[data-otp]");
  let code;
  for (let i = 0; i < 40 && !code; i++) { const l = otpLines(); if (l.length > before) code = l[l.length - 1].trim().slice(-6); else await sleep(250); }
  await page.focus('[data-otp="0"]'); await page.keyboard.type(code);
  await page.click("button[type=submit]");
  await page.waitForSelector('[data-action="logout"]');

  // 1. Chưa có giao dịch → khối rỗng
  await page.goto(BASE + "tai-khoan.html");
  await page.waitForSelector("text=Chưa có giao dịch nào");
  check("tài khoản mới: 'Chưa có giao dịch nào' + nút Xem Bảng tin", !!(await page.$('section[aria-labelledby=trades-title] a[href="index.html"]')));
  const order = await page.$$eval("main section h2, main section h1", (els) => els.map((e) => e.textContent.trim()));
  check("thứ tự: tài khoản → giao dịch → đăng nhập", order.indexOf("Lịch sử giao dịch") < order.indexOf("Lịch sử đăng nhập") && order.indexOf("Lịch sử giao dịch") > 0, order.join(" | "));

  // 2. Nạp giao dịch (6 như tài khoản thật + 25 hoàn tất cũ để có trang sau)
  mysql(`SET @me = (SELECT id FROM users WHERE username = '${USER}');
    INSERT INTO trades (owner_id, counterparty_id, kind, amount_cny, rate_vnd, status, created_at)
    SELECT IF(s.mine, @me, p.id), IF(s.mine, p.id, @me), s.kind, s.amount, s.rate, s.status, UTC_TIMESTAMP(3) - INTERVAL s.minutes MINUTE
    FROM (SELECT 'mau.hakhau' partner, TRUE mine, 'sell' kind, 5000 amount, 3535 rate, 'processing' status, 18 minutes
      UNION ALL SELECT 'mau.yennhi', FALSE, 'buy', 1500, 3525, 'disputed', 1560
      UNION ALL SELECT 'mau.minhchau', FALSE, 'sell', 12500, 3535, 'completed', 2880
      UNION ALL SELECT 'mau.vanlong', TRUE, 'pay', 4200, 3540, 'completed', 5760
      UNION ALL SELECT 'mau.quocbao', TRUE, 'buy', 8000, 3542, 'cancelled', 8640
      UNION ALL SELECT 'mau.logistics', FALSE, 'sell', 30000, 3538, 'completed', 12960) s
    JOIN users p ON p.username = s.partner;
    INSERT INTO trades (owner_id, counterparty_id, kind, amount_cny, rate_vnd, status, created_at)
    SELECT @me, (SELECT id FROM users WHERE username = 'mau.hakhau'), 'sell', 1000 + n, 3530, 'completed', UTC_TIMESTAMP(3) - INTERVAL (20 + n) DAY
    FROM (SELECT 1 n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10
      UNION ALL SELECT 11 UNION ALL SELECT 12 UNION ALL SELECT 13 UNION ALL SELECT 14 UNION ALL SELECT 15 UNION ALL SELECT 16 UNION ALL SELECT 17 UNION ALL SELECT 18 UNION ALL SELECT 19 UNION ALL SELECT 20
      UNION ALL SELECT 21 UNION ALL SELECT 22 UNION ALL SELECT 23 UNION ALL SELECT 24 UNION ALL SELECT 25) nums;`);
  await page.reload();
  await page.waitForSelector("section[aria-labelledby=trades-title] ul li");
  let rows = await rowsText(page);
  check("trang đầu 20 giao dịch", rows.length === 20, String(rows.length));
  check("đang xử lý + khiếu nại đứng đầu", /Đang xử lý/.test(rows[0]) && /Khiếu nại/.test(rows[1]), `${rows[0]} || ${rows[1]}`);
  check("nhìn từ phía mình: đăng tin bán → 'Bán CNY'", /Bán CNY/.test(rows[0]));
  check("chào giá cho tin cần mua → 'Bán CNY' (khiếu nại)", /Bán CNY/.test(rows[1]), rows[1]);
  check("thành tiền = số tệ × tỷ giá", rows[0].includes("5.000 ¥") && rows[0].includes("17.675.000 ₫"), rows[0]);
  check("đối tác có tên", rows[0].includes("Đại Lý Đổi Tệ Hà Khẩu"));
  const counts = await page.$$eval("[data-trade-tab]", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ")));
  check("số đếm tab", counts.join(",") === "Tất cả 31,Đang xử lý 2,Hoàn tất 28,Đã huỷ 1", counts.join(","));
  await page.screenshot({ path: path.join(OUT, "trades-1280.png"), fullPage: true });

  // 3. Xem thêm
  await page.click('[data-action="trades-more"]');
  await page.waitForFunction(() => document.querySelectorAll("section[aria-labelledby=trades-title] ul li").length === 31);
  check("Xem thêm → đủ 31, hết nút", !(await page.$('[data-action="trades-more"]')));

  // 4. Lọc theo tab
  await page.click('[data-trade-tab="processing"]');
  await page.waitForFunction(() => document.querySelector('[data-trade-tab="processing"]').getAttribute("aria-selected") === "true" && !document.querySelector('section[aria-labelledby=trades-title] [aria-busy="true"]'));
  rows = await rowsText(page);
  check("tab Đang xử lý: 2 dòng (gồm khiếu nại)", rows.length === 2, String(rows.length));
  check("tiêu điểm giữ trên tab", await page.evaluate(() => document.activeElement.dataset.tradeTab === "processing"));
  await page.click('[data-trade-tab="cancelled"]');
  await page.waitForFunction(() => document.querySelector('[data-trade-tab="cancelled"]').getAttribute("aria-selected") === "true" && !document.querySelector('section[aria-labelledby=trades-title] [aria-busy="true"]'));
  rows = await rowsText(page);
  check("tab Đã huỷ: 1 dòng 'Mua CNY'", rows.length === 1 && /Mua CNY/.test(rows[0]) && /Đã huỷ/.test(rows[0]), rows[0]);

  // 5. Điện thoại
  await page.setViewportSize({ width: 375, height: 812 });
  await page.click('[data-trade-tab="all"]');
  await page.waitForFunction(() => document.querySelector('[data-trade-tab="all"]').getAttribute("aria-selected") === "true" && document.querySelectorAll("section[aria-labelledby=trades-title] ul li").length > 0);
  check("375: không cuộn ngang", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const section = await page.$("section[aria-labelledby=trades-title]");
  await section.screenshot({ path: path.join(OUT, "trades-375.png") });

  // 6. Người khác không xem được giao dịch của mình (API cần đăng nhập)
  const anon = await browser.newPage();
  const status = await anon.evaluate(async () => (await fetch("http://127.0.0.1:3001/api/account/trades")).status).catch(() => -1);
  await anon.goto(BASE);
  const anonStatus = await anon.evaluate(async () => (await fetch("/api/account/trades")).status);
  check("chưa đăng nhập → 401", anonStatus === 401, String(anonStatus));

  check("no JS errors", errors.length === 0, errors.join(" | "));
  mysql("DELETE FROM users WHERE username LIKE 'test.%'; DELETE FROM otp_codes;");
  console.log(results.join("\n"));
  await browser.close();
})().catch((e) => { console.log(results.join("\n")); console.log("CRASH", e.message); process.exit(1); });
