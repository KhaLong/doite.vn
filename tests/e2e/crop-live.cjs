// Test đầu cuối: chọn ảnh → hộp chỉnh (kéo, phóng to) → Huỷ không đổi gì / Lưu mới đổi ảnh.
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
  let uploads = 0;
  page.on("request", (r) => { if (r.url().includes("/api/account/avatar") && r.method() === "PUT") uploads++; });

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

  // 1. Chọn ảnh → hộp chỉnh mở, chưa gửi gì
  await page.setInputFiles("#avatar-file", PHOTO);
  await page.waitForSelector('[role="dialog"]');
  await page.waitForTimeout(300);
  check("chọn ảnh → mở hộp 'Chỉnh ảnh đại diện', chưa tải lên", (await page.textContent("#crop-title")) === "Chỉnh ảnh đại diện" && uploads === 0);
  check("tiêu điểm vào vùng chỉnh", await page.evaluate(() => document.activeElement.id === "crop-box"));
  await page.screenshot({ path: path.join(OUT, "crop-1280.png") });

  // 2. Kéo, phóng to
  const t0 = await page.$eval("#crop-image", (el) => el.style.transform);
  const box = await page.$eval("#crop-box", (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.mouse.move(box.x + 60, box.y + 10, { steps: 5 }); await page.mouse.up();
  const t1 = await page.$eval("#crop-image", (el) => el.style.transform);
  check("kéo ảnh dịch chuyển (ảnh ngang kéo được theo chiều ngang)", t0 !== t1, `${t0} → ${t1}`);
  const w0 = await page.$eval("#crop-image", (el) => parseFloat(el.style.width));
  await page.click('[data-crop="zoom-in"]'); await page.click('[data-crop="zoom-in"]');
  const w1 = await page.$eval("#crop-image", (el) => parseFloat(el.style.width));
  check("nút + phóng to", w1 > w0 * 1.4, `${w0} → ${w1}`);
  await page.$eval("#crop-zoom", (el) => { el.value = "1"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  const w2 = await page.$eval("#crop-image", (el) => parseFloat(el.style.width));
  check("thanh trượt về 1 → hết phóng to", Math.abs(w2 - w0) < 1, `${w2}`);
  // Không kéo lộ nền: ảnh luôn phủ kín khung
  await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.mouse.move(box.x + 2000, box.y + 2000, { steps: 4 }); await page.mouse.up();
  const covered = await page.evaluate(() => {
    const b = document.getElementById("crop-box").getBoundingClientRect(), i = document.getElementById("crop-image").getBoundingClientRect();
    return i.left <= b.left + 0.5 && i.top <= b.top + 0.5 && i.right >= b.right - 0.5 && i.bottom >= b.bottom - 0.5;
  });
  const rects = await page.evaluate(() => { const r = (el) => { const b = el.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map((n) => Math.round(n * 10) / 10).join(","); }; return { box: r(document.getElementById("crop-box")), img: r(document.getElementById("crop-image")), t: document.getElementById("crop-image").style.transform }; });
  check("kéo quá tay vẫn phủ kín khung", covered, JSON.stringify(rects));
  // Phím mũi tên
  await page.focus("#crop-box");
  const k0 = await page.$eval("#crop-image", (el) => el.style.transform);
  await page.keyboard.press("ArrowRight");
  check("phím mũi tên dịch ảnh", k0 !== (await page.$eval("#crop-image", (el) => el.style.transform)));

  // 3. Huỷ → không gửi, ảnh cũ (chưa có) giữ nguyên
  await page.keyboard.press("Escape");
  await page.waitForSelector('[role="dialog"]', { state: "detached" });
  check("Esc đóng hộp, không tải lên, ảnh không đổi", uploads === 0 && !(await page.$("main img")));
  check("tiêu điểm trả về nút đổi ảnh", await page.evaluate(() => !!document.activeElement.closest("[data-action='pick-avatar']") || document.activeElement.id === "avatar-file"), await page.evaluate(() => document.activeElement.outerHTML.slice(0, 60)));
  await page.setInputFiles("#avatar-file", PHOTO);
  await page.waitForSelector('[role="dialog"]');
  await page.click('button:text-is("Huỷ")');
  await page.waitForSelector('[role="dialog"]', { state: "detached" });
  check("Huỷ đóng hộp, không tải lên", uploads === 0);

  // 4. Chọn lại → phóng to → Lưu ảnh → ảnh đổi chính thức
  await page.setInputFiles("#avatar-file", PHOTO);
  await page.waitForSelector('[role="dialog"]');
  await page.click('[data-crop="zoom-in"]');
  await page.click('[data-crop="save"]');
  await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 8000 });
  await page.waitForSelector("main img[src*='/anh-dai-dien/']");
  check("Lưu ảnh → tải lên đúng 1 lần, ảnh đại diện đổi", uploads === 1);
  check("header cũng đổi ảnh", !!(await page.$("header img[src*='/anh-dai-dien/']")));

  // 5. Điện thoại: hộp nổi từ đáy
  await page.setViewportSize({ width: 375, height: 812 });
  await page.setInputFiles("#avatar-file", PHOTO);
  await page.waitForSelector('[role="dialog"]');
  await page.waitForTimeout(300);
  const fit = await page.evaluate(() => { const d = document.querySelector('[role="dialog"]').getBoundingClientRect(); return d.left >= 0 && d.right <= innerWidth && d.bottom <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth; });
  check("375: hộp vừa màn, không cuộn ngang", fit);
  await page.screenshot({ path: path.join(OUT, "crop-375.png") });
  await page.keyboard.press("Escape");

  check("no JS errors", errors.length === 0, errors.join(" | "));
  mysql("DELETE FROM users WHERE username LIKE 'test.%'; DELETE FROM otp_codes;");
  console.log(results.join("\n"));
  await browser.close();
})().catch((e) => { console.log(results.join("\n")); console.log("CRASH", e.message); process.exit(1); });
