// Test đầu cuối doite.vn với server Rust + MySQL thật. Mã OTP đọc từ log server (SMS_MODE=log).
const fs = require("fs");
const { chromium } = require("playwright-core");
const BASE = "http://127.0.0.1:3001/";
const LOG = process.argv[2];
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tag = Date.now().toString().slice(-6);
const USERNAME = `test.${tag}`;
const DISPLAY = `Người Thử ${tag}`;
const LOCAL_PHONE = `0399${tag}`;           // 10 số, đầu 03
const E164 = `+84399${tag}`;
const PASSWORD = "matkhau-thu-1";
const NEW_PASSWORD = "matkhau-moi-2";

function otpLines() {
  return fs.readFileSync(LOG, "utf8").split(/\r?\n/).filter((l) => l.includes("[OTP") && l.includes(E164));
}
async function nextOtp(before) {
  for (let i = 0; i < 40; i++) {
    const lines = otpLines();
    if (lines.length > before) return lines[lines.length - 1].trim().slice(-6);
    await sleep(250);
  }
  throw new Error("không thấy OTP mới trong log");
}
async function typeOtp(page, code) {
  await page.focus('[data-otp="0"]');
  await page.keyboard.type(code);
}

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const text = (sel) => page.textContent(sel);

  // 1. Trang chủ đọc Bảng tin từ MySQL
  await page.goto(BASE);
  await page.waitForSelector("li [data-bid] >> visible=true", { timeout: 8000 });
  const rows = await page.$$eval("ul li:has([data-bid])", (els) => els.length);
  check("home: 6 tin từ MySQL", rows === 6, `${rows}`);
  check("home: tên tiếng Việt đúng", (await text("main")).includes("Nguyễn Hoàng Minh Châu"));
  check("home: số đếm tab", (await page.textContent('[data-tab="all"]')).includes("6") && (await page.textContent('[data-tab="sell"]')).includes("3"));
  check("home: nút Đăng nhập khi chưa vào", !!(await page.$('[data-action="login"]')));

  // 2. Chào giá khi chưa đăng nhập → trang đăng nhập có câu dẫn
  await page.click("li [data-bid] >> visible=true >> nth=0");
  await page.waitForURL(/dang-nhap\.html/);
  await page.waitForTimeout(300);
  check("bid → login có câu dẫn tin", (await text("main")).includes("Đăng nhập để gửi chào giá cho tin"));

  // 3. Đăng ký → OTP sai → OTP đúng → về trang chủ đã đăng nhập
  await page.goto(BASE + "dang-ky.html");
  await page.fill("#username", USERNAME);
  await page.fill("#display-name", DISPLAY);
  await page.fill("#phone", LOCAL_PHONE);
  await page.fill("#password", PASSWORD);
  await page.fill("#confirm-password", PASSWORD);
  await page.click("label:has(#terms)", { position: { x: 10, y: 10 } });
  const before = otpLines().length;
  await page.click("button[type=submit]");
  await page.waitForSelector("[data-otp]", { timeout: 8000 });
  const code = await nextOtp(before);
  check("register → OTP gửi (log)", /^\d{6}$/.test(code), code.replace(/\d/g, "•"));
  const wrong = code === "000000" ? "111111" : "000000";
  await typeOtp(page, wrong);
  await page.click("button[type=submit]");
  await page.waitForFunction(() => document.getElementById("otp-msg")?.textContent.length > 0);
  check("OTP sai → báo lỗi", (await text("#otp-msg")) === "Mã chưa đúng, kiểm tra tin nhắn mới nhất");
  await typeOtp(page, code);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname === "/" || u.pathname.endsWith("index.html"), { timeout: 8000 });
  await page.waitForSelector('[data-action="logout"]', { timeout: 5000 });
  check("OTP đúng → đã đăng nhập, header có tên", (await text("#header-account")).includes(DISPLAY));

  // 4. Đã đăng nhập thì trang đăng nhập chuyển về trang chủ
  await page.goto(BASE + "dang-nhap.html");
  check("đã đăng nhập: /dang-nhap.html → /", new URL(page.url()).pathname === "/");

  // 5. Đăng xuất
  await page.waitForSelector('[data-action="logout"]');
  await page.click('[data-action="logout"]');
  await page.waitForSelector('[data-action="login"]', { timeout: 5000 });
  check("đăng xuất → nút Đăng nhập", true);

  // 6. Đăng nhập: sai mật khẩu, đúng bằng tên, đúng bằng số
  await page.goto(BASE + "dang-nhap.html");
  await page.fill("#identifier", USERNAME);
  await page.fill("#password", "sai-mat-khau");
  await page.click("button[type=submit]");
  await page.waitForSelector('[role="alert"]', { timeout: 8000 });
  check("sai mật khẩu → câu chung", (await text('[role="alert"]')).includes("Tài khoản hoặc mật khẩu chưa đúng") && (await page.inputValue("#password")) === "");
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForSelector('[data-action="logout"]', { timeout: 8000 });
  check("đăng nhập bằng tên đăng nhập", true);
  await page.click('[data-action="logout"]');
  await page.waitForSelector('[data-action="login"]');
  await page.goto(BASE + "dang-nhap.html");
  await page.fill("#identifier", "+84 " + LOCAL_PHONE.slice(1));
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForSelector('[data-action="logout"]', { timeout: 8000 });
  check("đăng nhập bằng số điện thoại (+84)", true);
  await page.click('[data-action="logout"]');
  await page.waitForSelector('[data-action="login"]');

  // 7. Đăng ký trùng tên / trùng số
  await page.goto(BASE + "dang-ky.html");
  await page.fill("#username", USERNAME.toUpperCase());
  await page.fill("#display-name", "Ai Đó");
  await page.fill("#phone", "0388" + tag);
  await page.fill("#password", PASSWORD);
  await page.fill("#confirm-password", PASSWORD);
  await page.click("label:has(#terms)", { position: { x: 10, y: 10 } });
  await page.click("button[type=submit]");
  await page.waitForFunction(() => document.getElementById("username-msg")?.textContent.includes("đã có người dùng"), null, { timeout: 8000 });
  check("trùng tên đăng nhập (khác hoa thường) → lỗi", true);
  await page.fill("#username", "khac." + tag);
  await page.fill("#phone", LOCAL_PHONE);
  await page.click("button[type=submit]");
  await page.waitForFunction(() => document.getElementById("phone-msg")?.textContent.includes("đã có tài khoản"), null, { timeout: 8000 });
  check("trùng số điện thoại → lỗi", true);

  // 8. Quên mật khẩu với số chưa đăng ký: vẫn sang bước mã (không lộ)
  await page.goto(BASE + "quen-mat-khau.html");
  await page.fill("#phone", "0377" + tag);
  await page.click("button[type=submit]");
  await page.waitForSelector("[data-otp]", { timeout: 8000 });
  check("quên MK số lạ → vẫn sang bước mã", (await text("main")).includes("Nếu số này đã đăng ký"));

  // 9. Quên mật khẩu thật → mật khẩu mới → đăng nhập bằng mật khẩu mới
  await page.goto(BASE + "quen-mat-khau.html?sdt=" + LOCAL_PHONE);
  await page.waitForTimeout(300);
  const beforeReset = otpLines().length;
  await page.click("button[type=submit]");
  await page.waitForSelector("[data-otp]", { timeout: 8000 });
  const resetCode = await nextOtp(beforeReset);
  await typeOtp(page, resetCode);
  await page.click("button[type=submit]");
  await page.waitForSelector("#new-password", { timeout: 8000 });
  await page.fill("#new-password", NEW_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForSelector("text=Đã đổi mật khẩu", { timeout: 8000 });
  check("đổi mật khẩu xong", true);
  await page.click('main a:text-is("Đăng nhập")');
  await page.waitForURL(/dang-nhap/);
  await page.waitForTimeout(300);
  check("về đăng nhập, số điền sẵn", (await page.inputValue("#identifier")) === LOCAL_PHONE);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForSelector('[role="alert"]', { timeout: 8000 });
  check("mật khẩu cũ không còn dùng được", (await text('[role="alert"]')).includes("chưa đúng"));
  await page.fill("#password", NEW_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForSelector('[data-action="logout"]', { timeout: 8000 });
  check("mật khẩu mới đăng nhập được", true);

  // 10. Google chưa bật
  await page.click('[data-action="logout"]');
  await page.goto(BASE + "dang-nhap.html");
  await page.click("[data-google]");
  await page.waitForSelector('[role="alert"]', { timeout: 5000 });
  check("Google → báo chưa bật", (await text('[role="alert"]')).includes("Google chưa được bật"));

  check("no JS errors", errors.length === 0, errors.join(" | "));
  console.log(results.join("\n"));
  console.log(`USER ${USERNAME} ${E164}`);
  await browser.close();
})().catch((e) => { console.log(results.join("\n")); console.log("CRASH", e.message); process.exit(1); });
