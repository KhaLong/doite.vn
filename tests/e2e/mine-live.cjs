// Tin của chính mình trên Bảng tin: nổi bật, nhãn "Tin của bạn", không có nút Chào giá, đứng đầu khi Mới nhất.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright-core");
const BASE = "http://127.0.0.1:3001/";
const [LOG, OUT] = process.argv.slice(2);
const tag = Date.now().toString().slice(-6);
const USER = `test.${tag}`, NAME = `Minh Anh ${tag}`, E164 = `+84399${tag}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const otpLines = () => fs.readFileSync(LOG, "utf8").split(/\r?\n/).filter((l) => l.includes("[OTP") && l.includes(E164));
const mysql = (sql) => execFileSync(process.env.MYSQL_BIN || "C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysql.exe", ["-u", "root", "-h", "127.0.0.1", "-D", "doite", "-N", "--default-character-set=utf8mb4", "-e", sql], { encoding: "utf8" });
const results = [];
const check = (n, ok, x = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  — " + x : ""}`);

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "dang-ky.html");
  await page.fill("#username", USER); await page.fill("#display-name", NAME); await page.fill("#phone", `0399${tag}`);
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

  // Tin của mình, đăng lùi 3 giờ (để không phải mới nhất), có hạn 24 giờ
  mysql(`INSERT INTO posts (user_id, kind, amount_cny, rate_vnd, channel_label, channels, limit_label, created_at, expires_at)
    SELECT id, 'buy', 7000, 3522, 'Ngân hàng', 'bank', 'Chia nhỏ được', UTC_TIMESTAMP(3) - INTERVAL 3 HOUR, UTC_TIMESTAMP(3) + INTERVAL 21 HOUR FROM users WHERE username = '${USER}'`);
  await page.goto(BASE);
  await page.waitForSelector("li[data-post-id] >> visible=true");
  const first = await page.$eval("ul li[data-post-id]", (li) => ({ mine: li.dataset.mine, text: li.innerText.replace(/\s+/g, " "), bid: !!li.querySelector("[data-bid]"), shadow: getComputedStyle(li).boxShadow, bg: getComputedStyle(li).backgroundColor }));
  check("tin của mình đứng đầu (Mới nhất)", first.mine === "true" && first.text.includes(NAME), first.text);
  check("có nhãn 'Tin của bạn'", first.text.includes("Tin của bạn"));
  check("không có nút Chào giá, thay bằng 'Chờ chào giá'", !first.bid && first.text.includes("Chờ chào giá"));
  check("nền xanh nhạt + vạch xanh mép trái", first.bg === "rgb(245, 248, 255)" && first.shadow.includes("rgb(37, 99, 235)"), `${first.bg} / ${first.shadow}`);
  const others = await page.$$eval("ul li[data-post-id]:not([data-mine])", (els) => els.every((li) => li.querySelector("[data-bid]")));
  check("tin người khác vẫn có nút Chào giá", others);
  await page.screenshot({ path: path.join(OUT, "mine-1280.png"), clip: { x: 0, y: 250, width: 1280, height: 330 } });

  // Sắp theo số lượng: không ép lên đầu
  await page.click('[data-dd="sort"] [data-dd-btn]');
  await page.click('[data-dd="sort"] [role=option][data-value="amount"]');
  const firstByAmount = await page.$eval("ul li[data-post-id]", (li) => li.dataset.mine || "");
  check("sắp theo số lượng thì theo số lượng (không ép lên đầu)", firstByAmount === "");

  // Điện thoại
  await page.setViewportSize({ width: 375, height: 812 });
  await page.click('[data-tab="all"]');
  await page.evaluate(() => document.querySelector("li[data-mine]").scrollIntoView({ block: "center" }));
  const mobile = await page.$eval("li[data-mine]", (li) => ({ text: li.innerText.replace(/\s+/g, " "), bid: [...li.querySelectorAll("[data-bid]")].some((b) => b.offsetParent) }));
  check("375: nhãn 'Tin của bạn', tên đầy đủ, không nút Chào giá", mobile.text.includes("Tin của bạn") && mobile.text.includes(NAME) && !mobile.bid, mobile.text);
  const li = await page.$("li[data-mine]");
  await li.screenshot({ path: path.join(OUT, "mine-375.png") });

  // Đăng xuất: không còn là "của mình", có lại nút Chào giá
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.click('[data-action="logout"]');
  await page.waitForSelector('[data-action="login"]');
  await page.waitForFunction(() => !document.querySelector("li[data-mine]") && document.querySelectorAll("li[data-post-id]").length > 0);
  check("đăng xuất → tin đó thành tin thường, có nút Chào giá", true);

  check("no JS errors", errors.length === 0, errors.join(" | "));
  mysql("DELETE FROM users WHERE username LIKE 'test.%'; DELETE FROM otp_codes;");
  console.log(results.join("\n"));
  await browser.close();
})().catch((e) => { console.log(results.join("\n")); console.log("CRASH", e.message); process.exit(1); });
