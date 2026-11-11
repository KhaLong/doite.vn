// Phiên mở trước khi có lịch sử: trang cá nhân phải tự ghi bù dòng "Phiên này".
const fs = require("fs");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright-core");
const BASE = "http://127.0.0.1:3001/";
const LOG = process.argv[2];
const tag = Date.now().toString().slice(-6);
const E164 = `+84399${tag}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const otpLines = () => fs.readFileSync(LOG, "utf8").split(/\r?\n/).filter((l) => l.includes("[OTP") && l.includes(E164));
const mysql = (sql) => execFileSync(process.env.MYSQL_BIN || "C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysql.exe", ["-u", "root", "-h", "127.0.0.1", "-D", "doite", "-N", "-e", sql], { encoding: "utf8" });

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(BASE + "dang-ky.html");
  await page.fill("#username", `test.${tag}`); await page.fill("#display-name", `Người Thử ${tag}`); await page.fill("#phone", `0399${tag}`);
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
  // Giả lập phiên cũ: xoá lịch sử của tài khoản này
  mysql(`DELETE e FROM doite.login_events e JOIN doite.users u ON u.id = e.user_id WHERE u.username = 'test.${tag}'`);
  const left = mysql(`SELECT COUNT(*) FROM doite.login_events e JOIN doite.users u ON u.id = e.user_id WHERE u.username = 'test.${tag}'`).trim();
  await page.goto(BASE + "tai-khoan.html");
  await page.waitForSelector("#history-title");
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  const rows = await page.$$eval("ul li", (els) => els.map((li) => li.innerText.replace(/\s+/g, " ")));
  console.log((left === "0" && rows.length === 1 && /Phiên này/.test(rows[0]) ? "PASS" : "FAIL") + "  phiên cũ được ghi bù — events trước: " + left + " | " + rows.join(" || "));
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  const again = await page.$$eval("ul li", (els) => els.length);
  console.log((again === 1 ? "PASS" : "FAIL") + "  tải lại không ghi trùng — " + again);
  mysql("DELETE FROM doite.users WHERE username LIKE 'test.%'; DELETE FROM doite.otp_codes;");
  await browser.close();
})().catch((e) => { console.log("CRASH", e.message); process.exit(1); });
