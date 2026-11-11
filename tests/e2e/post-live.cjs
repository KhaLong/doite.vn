// Test đầu cuối: đăng tin đổi tệ.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright-core");
const BASE = "http://127.0.0.1:3001/";
const [LOG, OUT] = process.argv.slice(2);
const tag = Date.now().toString().slice(-6);
const USER = `test.${tag}`, NAME = `Minh Anh ${tag}`, E164 = `+84399${tag}`, PASSWORD = "matkhau-thu-1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const otpLines = () => fs.readFileSync(LOG, "utf8").split(/\r?\n/).filter((l) => l.includes("[OTP") && l.includes(E164));
const mysql = (sql) => execFileSync(process.env.MYSQL_BIN || "C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysql.exe", ["-u", "root", "-h", "127.0.0.1", "-D", "doite", "-N", "--default-character-set=utf8mb4", "-e", sql], { encoding: "utf8" });
const results = [];
const check = (n, ok, x = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  — " + x : ""}`);
const msg = (page, id) => page.textContent(`#${id}-msg`);

async function fill(page, { kind = "sell", amount = "5000", rate = "3535", channels = ["alipay", "bank"], note = "", minutes = 1440 } = {}) {
  if (kind) await page.click(`[data-kind="${kind}"]`);
  await page.fill("#amount", amount);
  await page.fill("#rate", rate);
  for (const c of channels) await page.click(`[data-channel="${c}"]`);
  if (note) await page.fill("#note", note);
  await page.click(`[data-minutes="${minutes}"]`);
}

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // 1. Chưa đăng nhập: /dang-tin.html?cny=5000 → đăng nhập → quay lại có số tệ
  await page.goto(BASE + "dang-tin.html?cny=5000");
  check("chưa đăng nhập → trang đăng nhập (giữ cny)", /dang-nhap\.html\?tiep=dang-tin\.html%3Fcny%3D5000/.test(page.url()), page.url());
  await page.goto(BASE + "dang-ky.html?" + new URLSearchParams({ tiep: "dang-tin.html?cny=5000" }));
  await page.fill("#username", USER); await page.fill("#display-name", NAME); await page.fill("#phone", `0399${tag}`);
  await page.fill("#password", PASSWORD); await page.fill("#confirm-password", PASSWORD);
  await page.click("label:has(#terms)", { position: { x: 10, y: 10 } });
  const before = otpLines().length;
  await page.click("button[type=submit]");
  await page.waitForSelector("[data-otp]");
  let code;
  for (let i = 0; i < 40 && !code; i++) { const l = otpLines(); if (l.length > before) code = l[l.length - 1].trim().slice(-6); else await sleep(250); }
  await page.focus('[data-otp="0"]'); await page.keyboard.type(code);
  await page.click("button[type=submit]");
  await page.waitForURL(/dang-tin\.html\?cny=5000/, { timeout: 8000 });
  await page.waitForSelector("#post-form");
  check("đăng ký xong quay về form, số tệ điền sẵn 5.000", (await page.inputValue("#amount")) === "5.000");
  check("tỷ giá để trống cho tự nhập", (await page.inputValue("#rate")) === "");
  await page.screenshot({ path: path.join(OUT, "post-1280.png"), fullPage: true });

  // 2. Gửi khi trống → báo lỗi từng mục, con trỏ vào mục đầu
  await page.fill("#amount", "");
  await page.click('button[type="submit"]');
  check("trống: báo đủ 4 lỗi", (await msg(page, "kind")) === "Chọn loại tin" && (await msg(page, "amount")) === "Chưa nhập số tệ" && (await msg(page, "rate")) === "Chưa nhập tỷ giá" && (await msg(page, "channels")) === "Chọn ít nhất một kênh");
  check("con trỏ vào loại tin", await page.evaluate(() => !!document.activeElement.dataset.kind));
  check("trên nút báo 'Còn 4 mục chưa đúng'", (await page.textContent("#error-summary")).includes("Còn 4 mục chưa đúng"));

  // 3. Tỷ giá lệch xa, số tệ ngoài khoảng
  await fill(page, { amount: "50", rate: "3000" });
  await page.click('button[type="submit"]');
  check("số tệ < 100 → lỗi", (await msg(page, "amount")).includes("từ 100 đến 1.000.000"));
  check("tỷ giá lệch → lỗi có khoảng", (await msg(page, "rate")).includes("3.177–3.883"));
  check("số tiền quy đổi ẩn khi chưa hợp lệ", (await page.textContent("#estimate")).includes("Nhập số tệ và tỷ giá"));

  // 4. Hợp lệ → quy đổi → đăng → về Bảng tin, tin mới đứng đầu, tô sáng
  await page.fill("#amount", "5000");
  await page.fill("#rate", "3535");
  check("định dạng số khi gõ", (await page.inputValue("#amount")) === "5.000");
  check("quy đổi: nhận về ≈ 17.675.000 ₫", /Bạn nhận về khoảng\s*17\.675\.000 ₫/.test(await page.textContent("#estimate")));
  await page.fill("#note", "Tối thiểu 3.000 ¥, chia nhỏ được");
  await page.click('[data-minutes="30"]');
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname === "/" || u.pathname.endsWith("index.html"), { timeout: 8000 });
  await page.waitForSelector("#post-status:not([hidden])", { timeout: 8000 });
  check("báo 'Đã đăng tin'", (await page.textContent("#post-status")).includes("Đã đăng tin"));
  check("bỏ ?moi khỏi địa chỉ", !page.url().includes("moi="));
  const first = await page.$eval("ul li[data-post-id]", (li) => ({ text: li.innerText.replace(/\s+/g, " "), ring: li.classList.contains("ring-2") }));
  check("tin mới đứng đầu, đúng nội dung", first.text.includes(NAME) && first.text.includes("5.000") && first.text.includes("3.535") && first.text.includes("Alipay · Ngân hàng") && first.text.includes("Tối thiểu 3.000 ¥, chia nhỏ được"), first.text);
  check("tin mới được tô sáng", first.ring);
  check("hạn 30 phút → 'Hết hạn chào giá sau 30 phút'", first.text.includes("Hết hạn chào giá sau 30 phút"), first.text);
  check("tài khoản mới hiện 'Thành viên mới'", first.text.includes("Thành viên mới"));
  await page.screenshot({ path: path.join(OUT, "post-board-1280.png") });

  // 5. Giới hạn 5 tin đang mở
  for (let i = 0; i < 4; i++) {
    await page.goto(BASE + "dang-tin.html");
    await page.waitForSelector("#post-form");
    await fill(page, { kind: "buy", amount: String(1000 + i), rate: "3520", channels: ["wechat"] });
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => u.pathname === "/" || u.pathname.endsWith("index.html"), { timeout: 8000 });
  }
  await page.goto(BASE + "dang-tin.html");
  await page.waitForSelector("#post-form");
  await fill(page, { kind: "pay", amount: "2000", rate: "3540", channels: ["taobao"] });
  await page.click('button[type="submit"]');
  await page.waitForSelector('[role="alert"]:not(:empty)', { timeout: 8000 });
  check("tin thứ 6 → báo đã có 5 tin còn hạn", (await page.textContent('#post-form [role="alert"]')).includes("5 tin còn hạn"));

  // 6. Tin hết hạn rời Bảng tin
  mysql(`UPDATE posts p JOIN users u ON u.id = p.user_id SET p.expires_at = UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE WHERE u.username = '${USER}'`);
  await page.goto(BASE);
  await page.waitForSelector("ul li[data-post-id]");
  check("tin hết hạn không còn trên Bảng tin", !(await page.textContent("main")).includes(NAME));

  // 7. "Tạo tin theo giá này" ở trang chủ → form có số tệ
  await page.fill("#convert-cny", "8000");
  await page.click('[data-action="create-at-rate"]');
  await page.waitForURL(/dang-tin\.html\?cny=8000/);
  await page.waitForSelector("#post-form");
  check("'Tạo tin theo giá này' → số tệ 8.000 điền sẵn", (await page.inputValue("#amount")) === "8.000");

  // 8. Điện thoại
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(300);
  check("375: không cuộn ngang", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(200);
  const btn = await page.$eval('button[type="submit"]', (b) => { const r = b.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: innerHeight }; });
  check("375: nút Đăng tin thấy ngay ở đáy màn khi chưa cuộn", btn.top >= 0 && btn.bottom <= btn.vh, JSON.stringify(btn));
  await page.screenshot({ path: path.join(OUT, "post-375-top.png") });
  await page.screenshot({ path: path.join(OUT, "post-375.png"), fullPage: true });

  // 9. API: chưa đăng nhập không đăng được; trang khác không gửi được
  const anon = await browser.newPage();
  await anon.goto(BASE);
  const anonStatus = await anon.evaluate(async () => (await fetch("/api/posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "sell", amountCny: 5000, rateVnd: 3535, channels: ["bank"], minutes: 30 }) })).status);
  check("chưa đăng nhập POST /api/posts → 401", anonStatus === 401, String(anonStatus));

  check("no JS errors", errors.length === 0, errors.join(" | "));
  mysql("DELETE FROM users WHERE username LIKE 'test.%'; DELETE FROM otp_codes;");
  console.log(results.join("\n"));
  await browser.close();
})().catch((e) => { console.log(results.join("\n")); console.log("CRASH", e.message); process.exit(1); });
