// Test đầu cuối: nhắn tin thời gian thực (SSE) — độ trễ, thứ tự, chống trùng, mất mạng, server khởi động lại,
// dự phòng khi SSE bị chặn, đã xem, đang soạn, quyền truy cập, XSS, emoji, tin cũ hơn, chấm đỏ, 375px.
const fs = require("fs");
const path = require("path");
const { execFileSync, spawn } = require("child_process");
const { chromium } = require("playwright-core");
const BASE = "http://127.0.0.1:3001/";
const ROOT = path.resolve(__dirname, "..", "..");
const [LOG, OUT] = process.argv.slice(2);
const tag = Date.now().toString().slice(-5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mysql = (sql) => execFileSync(process.env.MYSQL_BIN || "C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysql.exe", ["-u", "root", "-h", "127.0.0.1", "-D", "doite", "-N", "--default-character-set=utf8mb4", "-e", sql], { encoding: "utf8" }).trim();
const results = [];
const check = (n, ok, x = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  — " + x : ""}`);
let logFile = LOG;

async function register(browser, who) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.__errors = [];
  page.on("pageerror", (e) => page.__errors.push(e.message));
  const e164 = `+84${who.phone.slice(1)}`;
  const lines = () => fs.readFileSync(logFile, "utf8").split(/\r?\n/).filter((l) => l.includes("[OTP") && l.includes(e164));
  await page.goto(BASE + "dang-ky.html");
  await page.fill("#username", who.username); await page.fill("#display-name", who.name); await page.fill("#phone", who.phone);
  await page.fill("#password", "matkhau-thu-1"); await page.fill("#confirm-password", "matkhau-thu-1");
  await page.click("label:has(#terms)", { position: { x: 10, y: 10 } });
  const before = lines().length;
  await page.click("button[type=submit]");
  await page.waitForSelector("[data-otp]");
  let code;
  for (let i = 0; i < 40 && !code; i++) { const l = lines(); if (l.length > before) code = l[l.length - 1].trim().slice(-6); else await sleep(250); }
  await page.focus('[data-otp="0"]'); await page.keyboard.type(code);
  await page.click("button[type=submit]");
  await page.waitForSelector('[data-action="logout"]');
  return page;
}
const track = (page) => { page.__errors = []; page.on("pageerror", (e) => page.__errors.push(e.message)); return page; };
async function openThread(page, id) {
  await page.goto(`${BASE}tin-nhan.html?c=${id}`);
  await page.waitForFunction(() => state.thread === "xong" && state.live === "live", null, { timeout: 10000 });
}
async function send(page, text) {
  await page.fill("#draft", text);
  await page.keyboard.press("Enter");
}
const bodies = (page) => page.$$eval("#scroller li[data-status]", (items) => items.map((li) => li.querySelector("div p").textContent));
const waitText = (page, text, timeout = 5000) => page.waitForFunction((t) => [...document.querySelectorAll("#scroller li[data-status] div p")].some((p) => p.textContent === t), text, { timeout });
const countOf = (page, text) => page.$$eval("#scroller li[data-status] div p:first-child", (ps, t) => ps.filter((p) => p.textContent === t).length, text);
const dbCount = (convId, body) => Number(mysql(`SELECT COUNT(*) FROM messages WHERE conversation_id = ${convId} AND body = '${body.replace(/'/g, "''")}'`));
async function waitServer() {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(BASE + "api/posts")).ok) return true; } catch {} await sleep(250); }
  return false;
}

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge" });
  const A = { username: `test.ra${tag}`, name: `An Realtime ${tag}`, phone: `038${tag}111`.slice(0, 10) };
  const B = { username: `test.rb${tag}`, name: `Bình Realtime ${tag}`, phone: `038${tag}222`.slice(0, 10) };
  const a = await register(browser, A);
  const b = await register(browser, B);
  const convId = await b.evaluate(async (u) => (await (await fetch("/api/messages/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: u }) })).json()).conversationId, A.username);
  check("mở hội thoại B ↔ A", convId > 0, String(convId));

  await openThread(a, convId);
  await openThread(b, convId);
  check("cả hai tab nối SSE (state.live = live)", true);

  // 1. Độ trễ: B gửi → A thấy ngay, không có tải định kỳ nào chạy
  const t0 = Date.now();
  await send(b, "xin chào 1");
  await waitText(a, "xin chào 1", 3000);
  const latency = Date.now() - t0;
  check("A nhận tin qua SSE dưới 1,5 giây", latency < 1500, `${latency} ms`);
  check("ô nhập của B được xoá ngay khi gửi", (await b.inputValue("#draft")) === "");

  // 2. Đã xem: A đang mở hội thoại, tab hiện → B thấy "Đã xem"
  await b.waitForSelector('[data-receipt="seen"]', { timeout: 4000 });
  check("B thấy 'Đã xem' khi A đang xem", true);

  // 3. Đang soạn tin
  await a.type("#draft", "đang gõ", { delay: 30 });
  await b.waitForFunction(() => document.querySelector("#typing").textContent.includes("đang soạn tin"), null, { timeout: 4000 });
  check("B thấy 'An … đang soạn tin…'", (await b.textContent("#typing")).includes(A.name));
  await a.fill("#draft", "");
  await b.waitForFunction(() => document.querySelector("#typing").textContent === "", null, { timeout: 8000 });
  check("'đang soạn tin' tự tắt sau vài giây", true);

  // 4. Thứ tự: B gửi dồn 6 tin thật nhanh
  for (let i = 1; i <= 6; i++) await send(b, `dồn ${i}`);
  await waitText(a, "dồn 6", 5000);
  await b.waitForFunction(() => !document.querySelector('#scroller [data-status="sending"]'), null, { timeout: 8000 });
  const seqA = (await bodies(a)).filter((t) => t.startsWith("dồn"));
  const seqB = (await bodies(b)).filter((t) => t.startsWith("dồn"));
  const expected = ["dồn 1", "dồn 2", "dồn 3", "dồn 4", "dồn 5", "dồn 6"];
  check("6 tin gửi dồn: A thấy đúng thứ tự, không trùng", JSON.stringify(seqA) === JSON.stringify(expected), seqA.join(","));
  check("6 tin gửi dồn: B thấy đúng thứ tự, không trùng", JSON.stringify(seqB) === JSON.stringify(expected), seqB.join(","));
  const dbOrder = mysql(`SELECT GROUP_CONCAT(body ORDER BY id SEPARATOR ',') FROM messages WHERE conversation_id = ${convId} AND body LIKE 'dồn %'`);
  check("DB lưu đúng thứ tự gõ", dbOrder === expected.join(","), dbOrder);

  // 5. Chống trùng: cùng clientId gửi 3 lần cùng lúc → một tin
  const dupe = await b.evaluate(async (id) => {
    const body = JSON.stringify({ body: "gửi trùng", clientId: "11111111-2222-4333-8444-555555555555" });
    const post = () => fetch(`/api/messages/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body }).then((r) => r.json());
    const all = await Promise.all([post(), post(), post()]);
    return all.map((r) => r.message?.id);
  }, convId);
  check("cùng clientId gửi 3 lần song song → cùng một id", dupe.every((id) => id && id === dupe[0]), dupe.join(","));
  check("DB chỉ có 1 tin 'gửi trùng'", dbCount(convId, "gửi trùng") === 1);
  await waitText(a, "gửi trùng");
  await sleep(500);
  check("A thấy 'gửi trùng' đúng một lần", (await countOf(a, "gửi trùng")) === 1);

  // 6. Tab thứ hai của B: tin B gửi từ tab 1 hiện ở tab 2 là tin của mình, một lần
  const b2 = track(await b.context().newPage());
  await b2.setViewportSize({ width: 1280, height: 900 });
  await openThread(b2, convId);
  await send(b, "từ tab một");
  await waitText(b2, "từ tab một");
  const mineInTab2 = await b2.$eval("#scroller li[data-status]:last-child", (li) => li.classList.contains("items-end"));
  check("tab 2 của B nhận tin B gửi ở tab 1, bên phải (của mình)", mineInTab2);
  await b2.close();

  // 7. Nội dung đặc biệt: XSS, emoji, nhiều dòng, 1.000 ký tự
  const xss = `<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>`;
  await send(b, xss);
  await waitText(a, xss);
  check("chuỗi HTML hiện nguyên văn, không chạy", !(await a.evaluate(() => window.__xss)) && !(await a.$("#scroller img[src=x]")));
  await send(b, "Tỷ giá 3.530 ₫ 😀🇻🇳 ổn không?");
  await waitText(a, "Tỷ giá 3.530 ₫ 😀🇻🇳 ổn không?");
  check("emoji, cờ, ký tự tiếng Việt giữ nguyên", true);
  await b.fill("#draft", "dòng 1");
  await b.keyboard.press("Shift+Enter");
  await b.keyboard.type("dòng 2");
  await b.keyboard.press("Enter");
  await waitText(a, "dòng 1\ndòng 2");
  check("Shift+Enter xuống dòng, gửi giữ hai dòng", true);
  await b.fill("#draft", "x".repeat(1001));
  await b.keyboard.press("Enter");
  check("1.001 ký tự → báo trên ô nhập, không gửi", (await b.isVisible("#notice")) && (await b.textContent("#notice")).includes("1.000") && (await b.inputValue("#draft")).length === 1001);
  const tooLong = await b.evaluate(async (id) => (await fetch(`/api/messages/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: "x".repeat(1001) }) })).status, convId);
  check("API chặn 1.001 ký tự (400)", tooLong === 400, String(tooLong));
  await b.fill("#draft", "ữ".repeat(1000));
  check("gõ lại đúng giới hạn → báo lỗi tự ẩn", !(await b.isVisible("#notice")));
  await b.keyboard.press("Enter");
  await waitText(a, "ữ".repeat(1000));
  check("đúng 1.000 ký tự có dấu → gửi được", true);
  const badKind = await b.evaluate(async (id) => (await fetch(`/api/messages/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "image", body: "x" }) })).json(), convId);
  check("loại tin chưa hỗ trợ → từ chối", badKind.reason === "loai-tin-chua-ho-tro", JSON.stringify(badKind));

  // 8. Quyền truy cập: hội thoại A ↔ người khác, B không đọc / gửi / đánh dấu / báo đang soạn được
  mysql(`INSERT INTO conversations (user_low, user_high) SELECT LEAST(a.id, m.id), GREATEST(a.id, m.id) FROM users a, users m WHERE a.username = '${A.username}' AND m.username = (SELECT username FROM users WHERE username LIKE 'mau.%' ORDER BY id LIMIT 1)`);
  const foreign = Number(mysql(`SELECT c.id FROM conversations c JOIN users a ON a.id IN (c.user_low, c.user_high) JOIN users m ON m.id IN (c.user_low, c.user_high) WHERE a.username = '${A.username}' AND m.username LIKE 'mau.%' LIMIT 1`));
  const statuses = await b.evaluate(async (id) => {
    const j = { "Content-Type": "application/json" };
    return [
      (await fetch(`/api/messages/${id}`)).status,
      (await fetch(`/api/messages/${id}`, { method: "POST", headers: j, body: JSON.stringify({ body: "lén" }) })).status,
      (await fetch(`/api/messages/${id}/read`, { method: "POST", headers: j, body: JSON.stringify({ upTo: 999999 }) })).status,
      (await fetch(`/api/messages/${id}/typing`, { method: "POST", headers: j })).status,
    ];
  }, foreign);
  check("hội thoại của người khác: xem/gửi/đã xem/đang soạn đều 404", statuses.every((s) => s === 404), statuses.join(","));
  const anon = track(await browser.newPage());
  await anon.goto(BASE);
  const anonStatus = await anon.evaluate(async () => [(await fetch("/api/events")).status, (await fetch("/api/messages")).status]);
  check("chưa đăng nhập: /api/events và /api/messages 401", anonStatus.every((s) => s === 401), anonStatus.join(","));


  // 9. Chấm đỏ trên trang chủ cập nhật ngay, không tải lại trang
  await a.goto(BASE);
  await a.waitForSelector("#header-account a[href='tin-nhan.html']");
  await a.waitForFunction(() => !!document.querySelector("header a[href$='tin-nhan.html']") && typeof doiteLive === "object");
  await sleep(800);
  const before = await a.getAttribute("header a[href$='tin-nhan.html']", "aria-label");
  await send(b, "tin cho chấm đỏ");
  await a.waitForFunction(() => document.querySelector("header a[href$='tin-nhan.html']").getAttribute("aria-label").includes("1 chưa đọc"), null, { timeout: 4000 });
  check("trang chủ: chấm đỏ hiện 1 ngay khi có tin (trước: " + before + ")", true);
  await a.screenshot({ path: path.join(OUT, "rt-badge.png"), clip: { x: 900, y: 0, width: 380, height: 70 } });
  await openThread(a, convId);
  check("A mở hội thoại → tiêu đề tab hết số chưa đọc", await a.waitForFunction(() => !document.title.startsWith("("), null, { timeout: 4000 }).then(() => true, () => false));
  check("DB: tin của B đã đánh dấu đọc hết", mysql(`SELECT COUNT(*) FROM messages WHERE conversation_id = ${convId} AND read_at IS NULL AND sender_id = (SELECT id FROM users WHERE username = '${B.username}')`) === "0");

  // 10. Tab ẩn thì chưa tính là đã xem
  await a.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); });
  await send(b, "lúc A ẩn tab");
  await waitText(a, "lúc A ẩn tab");
  await sleep(600);
  check("A ẩn tab → tin chưa được đánh dấu đã xem", mysql(`SELECT read_at IS NULL FROM messages WHERE conversation_id = ${convId} AND body = 'lúc A ẩn tab'`) === "1");
  await a.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); });
  await b.waitForFunction(() => { const r = document.querySelector("[data-receipt]"); return r && r.dataset.receipt === "seen"; }, null, { timeout: 4000 });
  check("A quay lại tab → đánh dấu đã xem, B thấy 'Đã xem'", true);

  // 11. Mất mạng khi gửi → tin hiện "Chưa gửi được"; có mạng lại tự gửi, không trùng
  await b.context().setOffline(true);
  await send(b, "gửi lúc mất mạng");
  await b.waitForSelector('#scroller [data-status="failed"]', { timeout: 5000 });
  check("mất mạng → tin ở lại, ghi 'Chưa gửi được' kèm nút Gửi lại", (await b.textContent('#scroller [data-status="failed"]')).includes("Gửi lại"));
  await b.screenshot({ path: path.join(OUT, "rt-failed.png") });
  await b.context().setOffline(false);
  await waitText(a, "gửi lúc mất mạng", 10000);
  await b.waitForFunction(() => !document.querySelector('#scroller [data-status="failed"], #scroller [data-status="sending"]'), null, { timeout: 8000 });
  check("có mạng lại → tự gửi, A nhận một lần, DB một bản", (await countOf(a, "gửi lúc mất mạng")) === 1 && dbCount(convId, "gửi lúc mất mạng") === 1);

  // 12. Nút Gửi lại (server từ chối vì quá giới hạn thì không tự gửi lại) — giả lập lỗi 500 một lần
  let failOnce = true;
  await b.route(`**/api/messages/${convId}`, (route) => {
    if (route.request().method() === "POST" && failOnce) { failOnce = false; return route.fulfill({ status: 500, contentType: "application/json", body: '{"ok":false,"reason":"loi-may-chu"}' }); }
    return route.continue();
  });
  await send(b, "thử nút gửi lại");
  await b.waitForSelector("[data-retry]", { timeout: 5000 });
  await b.click("[data-retry]");
  await waitText(a, "thử nút gửi lại");
  check("bấm Gửi lại → gửi được, không trùng", dbCount(convId, "thử nút gửi lại") === 1);
  await b.unroute(`**/api/messages/${convId}`);

  // 13. SSE bị chặn (proxy, mạng công ty) → dải báo, tin vẫn tự tải
  const a2 = track(await a.context().newPage());
  await a2.setViewportSize({ width: 1280, height: 900 });
  await a2.route("**/api/events", (route) => route.fulfill({ status: 502, body: "" }));
  await a2.goto(`${BASE}tin-nhan.html?c=${convId}`);
  await a2.waitForFunction(() => state.thread === "xong");
  await a2.waitForFunction(() => state.live === "offline", null, { timeout: 8000 });
  check("SSE lỗi → dải 'Mất kết nối trực tiếp…'", (await a2.textContent("#conn")).includes("Mất kết nối trực tiếp"));
  await a2.screenshot({ path: path.join(OUT, "rt-offline.png") });
  await send(b, "tin lúc SSE hỏng");
  await waitText(a2, "tin lúc SSE hỏng", 9000);
  check("SSE hỏng vẫn nhận tin nhờ tải định kỳ", true);
  await a2.unroute("**/api/events");
  await a2.waitForFunction(() => state.live === "live", null, { timeout: 40000 });
  check("SSE thông lại → tự nối lại, ẩn dải báo", (await a2.textContent("#conn")).trim() === "");
  await a2.close();

  // 14. Tin cũ hơn: hội thoại có 120 tin → mở thấy 50, bấm xem thêm hai lần
  const C = { username: `test.rc${tag}` };
  mysql(`INSERT INTO users (username, display_name, phone, password_hash, phone_verified_at) VALUES ('${C.username}', 'Cường Lịch Sử', '+8437${tag}333', 'x', UTC_TIMESTAMP())`);
  const histConv = await b.evaluate(async (u) => (await (await fetch("/api/messages/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: u }) })).json()).conversationId, C.username);
  const values = Array.from({ length: 120 }, (_, i) => `(${histConv}, (SELECT id FROM users WHERE username = '${C.username}'), 'cũ ${i + 1}', UTC_TIMESTAMP(3) - INTERVAL ${120 - i} MINUTE)`).join(",");
  mysql(`INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES ${values}; UPDATE conversations SET last_message_at = UTC_TIMESTAMP(3) WHERE id = ${histConv}`);
  await openThread(b, histConv);
  let shown = await bodies(b);
  check("mở hội thoại dài: 50 tin mới nhất, cuộn sẵn xuống cuối", shown.length === 50 && shown[0] === "cũ 71" && shown[49] === "cũ 120" && await b.$eval("#scroller", (s) => s.scrollHeight - s.scrollTop - s.clientHeight < 5), `${shown.length}: ${shown[0]}…${shown.at(-1)}`);
  await b.$eval("#scroller", (s) => { s.scrollTop = 0; });
  const anchorTop = await b.$eval('#scroller li[data-status]', (li) => li.getBoundingClientRect().top);
  await b.click('[data-action="older"]');
  await b.waitForFunction(() => document.querySelectorAll("#scroller li[data-status]").length === 100);
  const anchorAfter = await b.$eval('#scroller li[data-status]:nth-child(52)', (li) => li.querySelector("div p").textContent);
  check("Xem tin cũ hơn → thêm 50 tin, đúng thứ tự", (await bodies(b))[0] === "cũ 21" && anchorAfter !== null);
  const kept = await b.evaluate(() => { const li = [...document.querySelectorAll("#scroller li[data-status]")].find((x) => x.querySelector("div p").textContent === "cũ 71"); return li.getBoundingClientRect().top; });
  check("giữ nguyên chỗ đang đọc khi chèn tin cũ", Math.abs(kept - anchorTop) < 60, `${anchorTop} → ${kept}`);
  await b.click('[data-action="older"]');
  await b.waitForFunction(() => document.querySelectorAll("#scroller li[data-status]").length === 120);
  check("hết tin cũ → nút Xem tin cũ hơn biến mất", !(await b.$('[data-action="older"]')) && (await bodies(b))[0] === "cũ 1");

  // 15. Tin mới khi đang đọc tin cũ → nút "1 tin mới", không giật cuộn
  await b.$eval("#scroller", (s) => { s.scrollTop = 0; });

  await openThread(b, convId);
  await b.$eval("#scroller", (s) => { s.scrollTop = 0; });
  await openThread(a, convId);
  await send(a, "tin mới khi B đang đọc tin cũ");
  await b.waitForSelector('[data-action="to-bottom"]', { timeout: 4000 });
  check("B đang cuộn lên trên → nút '1 tin mới', không tự giật xuống", (await b.textContent('[data-action="to-bottom"]')).includes("1 tin mới") && await b.$eval("#scroller", (s) => s.scrollTop < 50));
  await b.screenshot({ path: path.join(OUT, "rt-new-pill.png") });
  await b.click('[data-action="to-bottom"]');
  check("bấm nút → xuống cuối, nút ẩn", !(await b.$('[data-action="to-bottom"]')) && await b.$eval("#scroller", (s) => s.scrollHeight - s.scrollTop - s.clientHeight < 5));

  // 16. Danh sách hội thoại cập nhật trực tiếp: người mới nhắn tới → hiện lên đầu
  await openThread(a, convId);
  await b.click('[data-action="back"]').catch(() => {});
  await b.goto(BASE + "tin-nhan.html");
  await b.waitForFunction(() => state.list === "xong" && state.live === "live");
  await send(a, "lên đầu danh sách");
  await b.waitForFunction((name) => document.querySelector("#list-pane li button").textContent.includes(name) && document.querySelector("#list-pane li button").textContent.includes("lên đầu danh sách"), A.name, { timeout: 4000 });
  check("danh sách của B: hội thoại có tin mới nhảy lên đầu, có số chưa đọc", !!(await b.$('#list-pane li:first-child [aria-label="1 tin chưa đọc"]')));

  // 17. Server khởi động lại: các tab tự nối lại, tin gửi trong lúc server tắt được gửi bù, không mất không trùng
  await openThread(b, convId);
  execFileSync("taskkill", ["/F", "/IM", "doite.exe"], { stdio: "ignore" });
  await b.waitForFunction(() => state.live !== "live", null, { timeout: 8000 });
  await send(b, "gửi lúc server tắt");
  await b.waitForSelector('#scroller [data-status="failed"]', { timeout: 8000 });
  await sleep(2200);
  check("server tắt → dải 'Đang kết nối lại…' / 'Mất kết nối…'", /Đang kết nối lại|Mất kết nối/.test(await b.textContent("#conn")), await b.textContent("#conn"));
  await b.screenshot({ path: path.join(OUT, "rt-reconnecting.png") });
  logFile = path.join(OUT, "server-restarted.log");
  const fd = fs.openSync(logFile, "a");
  spawn(path.join(ROOT, "target", "debug", "doite.exe"), [], { cwd: ROOT, detached: true, stdio: ["ignore", fd, fd] }).unref();
  check("server chạy lại", await waitServer());
  await a.waitForFunction(() => state.live === "live", null, { timeout: 40000 });
  await b.waitForFunction(() => state.live === "live", null, { timeout: 40000 });
  await waitText(a, "gửi lúc server tắt", 10000);
  await b.waitForFunction(() => !document.querySelector('#scroller [data-status="failed"], #scroller [data-status="sending"]'), null, { timeout: 8000 });
  check("nối lại → tin gửi lúc server tắt tự gửi bù, A nhận một lần", (await countOf(a, "gửi lúc server tắt")) === 1 && dbCount(convId, "gửi lúc server tắt") === 1);
  await send(a, "sau khi server chạy lại");
  await waitText(b, "sau khi server chạy lại", 3000);
  check("sau khi nối lại, tin realtime chạy bình thường", true);
  const aAll = await bodies(a);
  check("A: không tin nào bị lặp trong cả hội thoại", new Set(aAll).size === aAll.length, `${aAll.length} tin`);

  // 18. Điện thoại 375
  await b.setViewportSize({ width: 375, height: 812 });
  await openThread(b, convId);
  check("375: khung chat không cuộn ngang", await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await b.screenshot({ path: path.join(OUT, "rt-375.png") });

  const errors = [...a.__errors, ...b.__errors, ...anon.__errors];
  check("không có lỗi JS", errors.length === 0, errors.join(" | "));
  mysql("DELETE FROM users WHERE username LIKE 'test.%'; DELETE FROM otp_codes;");
  console.log(results.join("\n"));
  await browser.close();
})().catch((e) => { console.log(results.join("\n")); console.log("CRASH", e.message); try { mysql("DELETE FROM users WHERE username LIKE 'test.%'; DELETE FROM otp_codes;"); } catch {} process.exit(1); });
