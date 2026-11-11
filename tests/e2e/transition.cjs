// Kiểm tra hiệu ứng chuyển trang: có View Transition khi đi giữa các trang, header giữ tên site-header,
// trang mới có style ngay ở khung đầu, tắt khi người dùng bật giảm chuyển động.
const path = require("path");
const { chromium } = require("playwright-core");
const BASE = "http://127.0.0.1:3001/";
const OUT = process.argv[2];
const results = [];
const check = (n, ok, x = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  — " + x : ""}`);

const RECORD = () => {
  window.__vt = { reveal: null, header: null };
  window.addEventListener("pagereveal", (event) => {
    window.__vt.reveal = !!event.viewTransition;
    const header = document.querySelector("header");
    window.__vt.header = header ? getComputedStyle(header).viewTransitionName : "(không có header)";
    // Khung đầu của trang mới phải có style Tailwind (không chớp trang trơn)
    const app = document.querySelector("main, #app > div");
    window.__vt.styled = app ? getComputedStyle(document.body).backgroundColor : "";
  });
};

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge" });
  for (const reduce of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: reduce ? "reduce" : "no-preference" });
    await ctx.addInitScript(RECORD);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(BASE);
    await page.waitForSelector("li [data-bid] >> visible=true");
    check(`${reduce ? "[giảm chuyển động] " : ""}nạp css chuyển trang`, await page.evaluate(() => [...document.styleSheets].some((s) => s.href?.endsWith("page-transitions.css"))));
    await page.click('[data-action="login"]');
    await page.waitForURL(/dang-nhap/);
    await page.waitForFunction(() => window.__vt && window.__vt.reveal !== null);
    const vt = await page.evaluate(() => window.__vt);
    if (!reduce) {
      check("trang chủ → đăng nhập có View Transition", vt.reveal === true, JSON.stringify(vt));
      check("nền trang mới đã có style ở khung đầu", vt.styled === "rgb(244, 244, 246)", vt.styled);
      await page.click('a:text-is("Tạo tài khoản")');
      await page.waitForURL(/dang-ky/);
      await page.waitForFunction(() => window.__vt && window.__vt.reveal !== null);
      check("đăng nhập → đăng ký có View Transition", (await page.evaluate(() => window.__vt.reveal)) === true);
      await page.goto(BASE);
      await page.waitForFunction(() => window.__vt && window.__vt.reveal !== null);
      check("header trang chủ mang tên site-header (đứng yên khi chuyển)", (await page.evaluate(() => window.__vt.header)) === "site-header");
    } else {
      check("giảm chuyển động → không chạy View Transition", vt.reveal === false, JSON.stringify(vt));
    }
    check(`${reduce ? "[giảm chuyển động] " : ""}không lỗi JS`, errors.length === 0, errors.join(" | "));
    await ctx.close();
  }
  console.log(results.join("\n"));
  await browser.close();
})().catch((e) => { console.log(results.join("\n")); console.log("CRASH", e.message); process.exit(1); });
