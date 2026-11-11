(() => {
  // Có View Transitions: chuyển trang bị huỷ giữa chừng (bấm sang trang khác quá nhanh, trang tự chuyển hướng)
  // làm các promise của transition bị từ chối. Đó là chuyện bình thường, bắt lại để không thành lỗi không ai xử lý.
  if ("CSSViewTransitionRule" in window) {
    const quiet = (event) => {
      const transition = event.viewTransition;
      if (!transition) return;
      for (const promise of [transition.ready, transition.finished, transition.updateCallbackDone]) promise?.catch(() => {});
    };
    window.addEventListener("pageswap", quiet);
    window.addEventListener("pagereveal", quiet);
    return;
  }
  // Trình duyệt chưa có View Transitions giữa các trang: chỉ cho nội dung hiện dần khi trang mở.
  // Không chặn link, không trì hoãn điều hướng, không transform cả trang (giữ header sticky, hộp thoại fixed đúng chỗ).
  if (!Element.prototype.animate) return;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let entry;
  window.addEventListener("pageshow", () => {
    entry?.cancel();
    if (reducedMotion.matches) return;
    entry = document.documentElement.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
  });
  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) entry?.cancel();
  });
})();
