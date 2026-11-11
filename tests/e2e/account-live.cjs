// Test đầu cuối trang cá nhân: lịch sử đăng nhập (thời gian, IP, vị trí, thiết bị), đăng xuất thiết bị khác.
const fs = require("fs");
const { chromium } = require("playwright-core");
const BASE = "http://127.0.0.1:3001/";
const LOG = process.argv[2];
const OUT = process.argv[3];
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = Date.now().toString().slice(-6);
const USERNAME = `test.${tag}`, DISPLAY = `Người Thử ${tag}`, PHONE = `0399${tag}`, E164 = `+84399${tag}`, PASSWORD = "matkhau-thu-1";
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const otpLines = () => fs.readFileSync(LOG, "utf8").split(/\r?\n/).filter((l) => l.includes("[OTP") && l.includes(E164));
async function nextOtp(before) {
  for (let i = 0; i < 40; i++) { const l = otpLines(); if (l.length > before) return l[l.length - 1].trim().slice(-6); await sleep(250); }
  throw new Error("no OTP");
}
async function login(page, identifier, password) {
  await page.goto(BASE + "dang-nhap.html");
  await page.fill("#identifier", identifier);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
}

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge" });
  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await desk.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Chưa đăng nhập → /tai-khoan.html chuyển sang đăng nhập, xong quay lại
  await page.goto(BASE + "tai-khoan.html");
  check("chưa đăng nhập → trang đăng nhập có tiep", /dang-nhap\.html\?tiep=tai-khoan\.html/.test(page.url()));

  // Đăng ký (máy tính)
  await page.goto(BASE + "dang-ky.html");
  await page.fill("#username", USERNAME); await page.fill("#display-name", DISPLAY); await page.fill("#phone", PHONE);
  await page.fill("#password", PASSWORD); await page.fill("#confirm-password", PASSWORD);
  await page.click("label:has(#terms)", { position: { x: 10, y: 10 } });
  const before = otpLines().length;
  await page.click("button[type=submit]");
  await page.waitForSelector("[data-otp]");
  const code = await nextOtp(before);
  await page.focus('[data-otp="0"]'); await page.keyboard.type(code);
  await page.click("button[type=submit]");
  await page.waitForSelector('[data-action="logout"]', { timeout: 8000 });

  // Điện thoại: một lần sai mật khẩu, một lần đúng
  const phone = await browser.newContext({ viewport: { width: 375, height: 812 }, userAgent: PHONE_UA, isMobile: true });
  const mob = await phone.newPage();
  await login(mob, USERNAME, "sai-mat-khau");
  await mob.waitForSelector('[role="alert"]', { timeout: 8000 });
  await login(mob, PHONE, PASSWORD);
  await mob.waitForSelector('[data-action="logout"]', { timeout: 8000 });

  // Header trang chủ: bấm tên → trang cá nhân
  await page.goto(BASE);
  await page.waitForSelector('a[href="tai-khoan.html"]');
  await page.click('a[href="tai-khoan.html"]');
  await page.waitForURL(/tai-khoan\.html/);
  await page.waitForSelector("#history-title");
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  const main = await page.textContent("main");
  check("thẻ tài khoản: tên, @username", main.includes(DISPLAY) && main.includes("@" + USERNAME));
  check("số điện thoại đã che", main.includes(`+84 399 ••• ${tag.slice(-3)}`), main.match(/\+84[^T]*/)?.[0]);
  const rows = await page.$$eval("ul li", (els) => els.map((li) => li.innerText.replace(/\s+/g, " ")));
  check("3 lần đăng nhập", rows.length === 3, String(rows.length));
  check("mới nhất trước: iPhone thành công", /Safari · iPhone/.test(rows[0]) && /Thành công/.test(rows[0]), rows[0]);
  check("lần sai mật khẩu có nhãn", /Sai mật khẩu/.test(rows[1]), rows[1]);
  check("phiên này = Edge · Windows", /Edge · Windows/.test(rows[2]) && /Phiên này/.test(rows[2]), rows[2]);
  check("IP và vị trí nội bộ", rows.every((r) => r.includes("127.0.0.1") && r.includes("Mạng nội bộ")));
  check("thời gian giờ VN, 'Hôm nay'", rows.every((r) => /\d\d:\d\d · Hôm nay/.test(r)));
  check("dải cảnh báo sai mật khẩu", (await page.textContent("main")).includes("1 lần đăng nhập sai mật khẩu"));
  await page.screenshot({ path: `${OUT}\\account-1280.png`, fullPage: true });

  // Điện thoại: xem trang cá nhân (ảnh 375)
  await mob.goto(BASE + "tai-khoan.html");
  await mob.waitForSelector("#history-title");
  await mob.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  const mobRows = await mob.$$eval("ul li", (els) => els.map((li) => li.innerText.replace(/\s+/g, " ")));
  check("điện thoại: phiên này là iPhone", /iPhone/.test(mobRows[0]) && /Phiên này/.test(mobRows[0]), mobRows[0]);
  check("375: không cuộn ngang", await mob.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mob.screenshot({ path: `${OUT}\\account-375.png`, fullPage: true });

  // Đăng xuất khỏi thiết bị khác (từ máy tính) → điện thoại mất phiên
  await page.click('[data-action="logout-others"]');
  await page.waitForSelector("text=Đã đăng xuất các thiết bị khác", { timeout: 5000 });
  check("nút báo đã đăng xuất thiết bị khác", true);
  const meMobile = await mob.evaluate(async () => (await fetch("/api/auth/me")).status);
  const meDesk = await page.evaluate(async () => (await fetch("/api/auth/me")).status);
  check("điện thoại bị đăng xuất, máy tính còn phiên", meMobile === 401 && meDesk === 200, `${meMobile}/${meDesk}`);

  // Trạng thái xem thử
  for (const tt of ["dang-tai", "loi", "rong"]) {
    await page.goto(BASE + "tai-khoan.html?tt=" + tt);
    await page.waitForSelector("#history-title");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}\\account-${tt}.png` });
  }
  check("trạng thái rỗng có câu", (await page.textContent("main")).includes("Chưa có lần đăng nhập nào khác trong 90 ngày"));

  // Đăng xuất từ trang cá nhân
  await page.goto(BASE + "tai-khoan.html");
  await page.click('[data-action="logout"]');
  await page.waitForURL((u) => u.pathname === "/" || u.pathname.endsWith("index.html"));
  check("đăng xuất → trang chủ", true);

  check("no JS errors", errors.length === 0, errors.join(" | "));
  console.log(results.join("\n"));
  console.log("USER", USERNAME);
  await browser.close();
})().catch((e) => { console.log(results.join("\n")); console.log("CRASH", e.message); process.exit(1); });
