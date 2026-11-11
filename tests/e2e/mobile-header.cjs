// Header điện thoại sau đăng nhập: có ảnh đại diện dẫn tới trang cá nhân, header không tràn.
const fs = require("fs");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright-core");
const BASE = "http://127.0.0.1:3001/";
const LOG = process.argv[2], OUT = process.argv[3];
const tag = Date.now().toString().slice(-6);
const E164 = `+84399${tag}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const otpLines = () => fs.readFileSync(LOG, "utf8").split(/\r?\n/).filter((l) => l.includes("[OTP") && l.includes(E164));
const mysql = (sql) => execFileSync(process.env.MYSQL_BIN || "C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysql.exe", ["-u", "root", "-h", "127.0.0.1", "-D", "doite", "-N", "-e", sql], { encoding: "utf8" });
const results = [];
const check = (n, ok, x = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  — " + x : ""}`);
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge" });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, userAgent: UA, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "dang-ky.html");
  await page.fill("#username", `test.${tag}`); await page.fill("#display-name", `Minh Anh ${tag}`); await page.fill("#phone", `0399${tag}`);
  await page.fill("#password", "matkhau-thu-1"); await page.fill("#confirm-password", "matkhau-thu-1");
  await page.click("label:has(#terms)", { position: { x: 10, y: 10 } });
  const before = otpLines().length;
  await page.click("button[type=submit]");
  await page.waitForSelector("[data-otp]");
  let code;
  for (let i = 0; i < 40 && !code; i++) { const l = otpLines(); if (l.length > before) code = l[l.length - 1].trim().slice(-6); else await sleep(250); }
  await page.focus('[data-otp="0"]'); await page.keyboard.type(code);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname === "/" || u.pathname.endsWith("index.html"));
  for (const width of [320, 360, 375, 414, 767, 768]) {
    await page.setViewportSize({ width, height: 812 });
    await page.waitForSelector('a[href="tai-khoan.html"] >> visible=true', { timeout: 5000 });
    const info = await page.evaluate(() => {
      const header = document.querySelector("header > div");
      const visible = [...document.querySelectorAll('header a[href="tai-khoan.html"], header [data-action="logout"]')].filter((el) => el.offsetParent).map((el) => {
        const r = el.getBoundingClientRect();
        return `${el.getAttribute("aria-label") ? "avatar" : el.textContent.trim().slice(0, 12)}@${Math.round(r.width)}x${Math.round(r.height)}`;
      });
      return { overflow: header.scrollWidth > header.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth, visible };
    });
    check(`${width}px: thấy lối vào trang cá nhân, header không tràn`, !info.overflow && info.visible.length > 0, info.visible.join(", "));
    if (width === 375) await page.screenshot({ path: `${OUT}\\header-375.png`, clip: { x: 0, y: 0, width: 375, height: 120 } });
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.tap('a[href="tai-khoan.html"] >> visible=true');
  await page.waitForURL(/tai-khoan\.html/);
  await page.waitForSelector("#history-title");
  check("chạm ảnh đại diện → trang cá nhân", true);
  check("trang cá nhân điện thoại có nút Đăng xuất", await page.isVisible('[data-action="logout"]'));
  check("no JS errors", errors.length === 0, errors.join(" | "));
  mysql("DELETE FROM users WHERE username LIKE 'test.%'; DELETE FROM otp_codes;");
  console.log(results.join("\n"));
  await browser.close();
})().catch((e) => { console.log(results.join("\n")); console.log("CRASH", e.message); process.exit(1); });
