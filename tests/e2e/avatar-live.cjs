// Test đầu cuối đổi ảnh đại diện.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright-core");
const BASE = "http://127.0.0.1:3001/";
const [LOG, OUT, PHOTO] = process.argv.slice(2);
const tag = Date.now().toString().slice(-6);
const E164 = `+84399${tag}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const otpLines = () => fs.readFileSync(LOG, "utf8").split(/\r?\n/).filter((l) => l.includes("[OTP") && l.includes(E164));
const mysql = (sql) => execFileSync(process.env.MYSQL_BIN || "C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysql.exe", ["-u", "root", "-h", "127.0.0.1", "-D", "doite", "-N", "-e", sql], { encoding: "utf8" });
const results = [];
const check = (n, ok, x = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  — " + x : ""}`);

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
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
  await page.waitForSelector('[data-action="logout"]');

  await page.goto(BASE + "tai-khoan.html");
  await page.waitForSelector('[data-action="pick-avatar"]');
  check("chưa có ảnh: nút 'Thêm ảnh đại diện', không có 'Xoá ảnh'", (await page.textContent("main")).includes("Thêm ảnh đại diện") && !(await page.$('[data-action="remove-avatar"]')));

  // File không phải ảnh (đuôi .png nhưng nội dung chữ)
  const fake = path.join(OUT, "gia.png");
  fs.writeFileSync(fake, "khong phai anh");
  await page.setInputFiles("#avatar-file", fake);
  await page.waitForSelector('main [role="alert"]', { timeout: 5000 });
  check("file giả → báo không đọc được", (await page.textContent('main [role="alert"]')).includes("Không đọc được ảnh"));

  // Ảnh thật
  await page.setInputFiles("#avatar-file", PHOTO);
  await page.waitForSelector("main img[src*='/anh-dai-dien/']", { timeout: 8000 });
  const src = await page.getAttribute("main img[src*='/anh-dai-dien/']", "src");
  check("ảnh đại diện hiện trên trang cá nhân", /^\/anh-dai-dien\/test\.\d+\.jpg\?v=\d+$/.test(src), src);
  check("header trang cá nhân dùng ảnh", !!(await page.$("header img[src*='/anh-dai-dien/']")));
  check("có nút Xoá ảnh, chữ đổi thành 'Đổi ảnh'", !!(await page.$('[data-action="remove-avatar"]')) && (await page.textContent("main")).includes("Đổi ảnh"));
  check("không còn câu lỗi cũ", !(await page.$('main [role="alert"]')));
  const served = await page.evaluate(async (url) => {
    const r = await fetch(url);
    const blob = await r.blob();
    const bmp = await createImageBitmap(blob);
    return { type: r.headers.get("content-type"), cache: r.headers.get("cache-control"), w: bmp.width, h: bmp.height, bytes: blob.size };
  }, src);
  check("server trả JPEG 256×256, cache lâu", served.type === "image/jpeg" && served.w === 256 && served.h === 256 && /immutable/.test(served.cache), JSON.stringify(served));
  await page.screenshot({ path: path.join(OUT, "avatar-1280.png"), clip: { x: 0, y: 0, width: 1280, height: 280 } });

  // Trang chủ: header dùng ảnh (máy tính và điện thoại)
  await page.goto(BASE);
  await page.waitForSelector("header img[src*='/anh-dai-dien/'] >> visible=true");
  check("trang chủ: header máy tính có ảnh", true);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForSelector("header a[aria-label^='Trang cá nhân'] img", { state: "visible" });
  check("trang chủ: header điện thoại có ảnh", true);
  await page.screenshot({ path: path.join(OUT, "avatar-header-375.png"), clip: { x: 0, y: 0, width: 375, height: 80 } });

  // Xoá ảnh
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(BASE + "tai-khoan.html");
  await page.waitForSelector('[data-action="remove-avatar"]');
  await page.click('[data-action="remove-avatar"]');
  await page.waitForFunction(() => !document.querySelector("main img") && document.querySelector("main").textContent.includes("Thêm ảnh đại diện"));
  check("xoá ảnh → về chữ viết tắt", true);
  const gone = await page.evaluate(async (url) => (await fetch(url.split("?")[0] + "?x=1")).status, src);
  check("ảnh cũ không còn phục vụ", gone === 404, String(gone));

  // CSRF: PUT từ trang khác bị chặn (Origin lạ)
  const cross = await page.evaluate(async () => {
    try { const r = await fetch("/api/account/avatar", { method: "DELETE", headers: { "X-Test": "1" } }); return r.status; } catch { return -1; }
  });
  check("cùng trang thì DELETE được (đối chứng)", cross === 200, String(cross));

  check("no JS errors", errors.length === 0, errors.join(" | "));
  mysql("DELETE FROM users WHERE username LIKE 'test.%'; DELETE FROM otp_codes;");
  console.log(results.join("\n"));
  await browser.close();
})().catch((e) => { console.log(results.join("\n")); console.log("CRASH", e.message); process.exit(1); });
