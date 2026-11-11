// doite.vn — kết nối thời gian thực dùng chung (GET /api/events, Server-Sent Events; src/realtime.rs).
//
// doiteLive.start({ on, keepWhenHidden, onStatus, fallback }) mở một EventSource và lo phần khó:
// - Nối lại: trình duyệt tự nối khi rớt mạng; server đóng hẳn (lỗi, 429) thì tự mở lại, chờ tăng dần 2 → 30 giây.
// - Sự kiện `ready` đến mỗi lần nối xong. Lần thứ hai trở đi gọi on.ready(data, { reconnected: true })
//   để trang lấy bù những gì lỡ trong lúc mất kết nối.
// - SSE hỏng mãi (proxy chặn, mạng công ty): gọi fallback() mỗi 5 giây cho tới khi nối lại được.
// - Tab ẩn: đóng kết nối (trừ keepWhenHidden), hiện lại thì nối lại và lấy bù. HTTP/1.1 chỉ cho
//   6 kết nối mỗi tên miền, nên không để tab ẩn giữ kết nối vô ích.
// onStatus(trạng thái): "connecting" | "live" | "reconnecting" | "offline" (đã chuyển sang tải định kỳ).
(function () {
  function start({ on = {}, keepWhenHidden = false, onStatus = () => {}, fallback = null } = {}) {
    let source = null;
    let everReady = false;
    let failures = 0;
    let retryTimer = 0;
    let fallbackTimer = 0;
    let status = "";

    const setStatus = (next) => {
      if (next !== status) { status = next; onStatus(next); }
    };
    const parse = (event) => { try { return JSON.parse(event.data); } catch { return {}; } };
    const startFallback = () => {
      setStatus("offline");
      if (fallback && !fallbackTimer) fallbackTimer = setInterval(() => { if (!document.hidden) fallback(); }, 5000);
    };
    const stopFallback = () => { clearInterval(fallbackTimer); fallbackTimer = 0; };

    function close() {
      clearTimeout(retryTimer);
      if (source) { source.close(); source = null; }
    }

    function open() {
      close();
      setStatus(everReady ? "reconnecting" : "connecting");
      const current = new EventSource("/api/events");
      source = current;
      current.addEventListener("ready", (event) => {
        failures = 0;
        stopFallback();
        setStatus("live");
        const reconnected = everReady;
        everReady = true;
        on.ready?.(parse(event), { reconnected });
      });
      for (const name of Object.keys(on)) {
        if (name !== "ready") current.addEventListener(name, (event) => on[name](parse(event)));
      }
      current.onerror = () => {
        if (source !== current) return;
        failures += 1;
        if (current.readyState === EventSource.CLOSED) {
          // Server trả lỗi (không phải rớt mạng): trình duyệt không tự nối nữa, mình tự mở lại
          source = null;
          startFallback();
          retryTimer = setTimeout(open, Math.min(30000, 2000 * 2 ** Math.min(failures - 1, 4)));
        } else if (failures >= 3) {
          startFallback();
        } else {
          setStatus("reconnecting");
        }
      };
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (!keepWhenHidden) { close(); stopFallback(); }
      } else if (!source || source.readyState === EventSource.CLOSED) {
        open();
      }
    });
    addEventListener("online", () => { if (status !== "live") { failures = 0; open(); } });
    addEventListener("pagehide", close);
    // Bấm Back quay lại trang từ bộ nhớ đệm (bfcache): kết nối đã đóng lúc rời trang, mở lại và lấy bù
    addEventListener("pageshow", (event) => { if (event.persisted) { failures = 0; open(); } });
    if (!document.hidden || keepWhenHidden) open();
    return { reconnect: open, status: () => status };
  }

  // Số tin chưa đọc cho các trang chỉ cần chấm đỏ (trang chủ, trang người dùng). SSE hỏng thì hỏi 5 giây một lần.
  function watchUnread(onCount) {
    const poll = () =>
      fetch("/api/messages/unread", { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && onCount(d.count || 0))
        .catch(() => {});
    return start({ on: { ready: (d) => onCount(d.unread || 0), unread: (d) => onCount(d.count || 0) }, fallback: poll });
  }

  // Vẽ lại chấm đỏ trên nút Tin nhắn ở header, tại chỗ (không vẽ lại cả trang đang dùng).
  function paintBadge(count) {
    for (const link of document.querySelectorAll('header a[href$="tin-nhan.html"]:not([aria-current])')) {
      link.setAttribute("aria-label", count ? `Tin nhắn, ${count} chưa đọc` : "Tin nhắn");
      link.querySelectorAll("span").forEach((el) => el.remove());
      if (count) {
        link.insertAdjacentHTML("beforeend", `<span class="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-semibold text-white tabular">${count > 99 ? "99+" : count}</span>`);
      }
    }
  }

  window.doiteLive = { start, watchUnread, paintBadge };
})();
