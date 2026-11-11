// doite.vn — đăng nhập, đăng ký, quên mật khẩu (phương án A · Một cột giữa màn, DESIGN.md)
// Dùng chung cho dang-nhap.html, dang-ky.html, quen-mat-khau.html. Trang nào là <body data-page="…">.
//
// BACKEND: server Rust (src/auth.rs), API /api/auth/*. window.DoiteAuth gọi API đó; mỗi hàm trả về
// Promise<{ ok: boolean, reason?: string, field?: string }>. reason khớp với src/auth.rs.
//
// Tham số URL:
//   ?tiep=<đường dẫn trong site>  đăng nhập/đăng ký xong thì quay về đây (mặc định index.html)
//   ?tin=<nhãn tin>               câu dẫn "Đăng nhập để gửi chào giá cho tin …" (khi đến từ nút Chào giá)
//   ?sdt=<số>                     điền sẵn số điện thoại
//   ?buoc=… &tt=dang-gui|loi      chỉ để xem trạng thái tĩnh (như ?tt= ở trang chủ)

// Lỗi chung mọi hàm: "qua-nhieu-lan" (429), "mat-mang" (không tới được server), "loi-may-chu".
async function postJson(path, body) {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) return { ...data, ok: true };
    return { ok: false, reason: data.reason || (response.status === 429 ? "qua-nhieu-lan" : "loi-may-chu"), field: data.field };
  } catch {
    return { ok: false, reason: "mat-mang" };
  }
}

window.DoiteAuth = window.DoiteAuth || {
  // identifier: tên đăng nhập hoặc số điện thoại. reason: "sai"
  login: ({ identifier, password }) => postJson("/api/auth/login", { identifier, password }),
  // reason: "trung-ten" | "da-co" | "ten-dang-nhap-sai" | "ten-hien-thi-sai" | "so-dien-thoai-sai" | "mat-khau-sai" | "chua-dong-y"
  register: (data) => postJson("/api/auth/register", data),
  // flow: "dang-ky" | "quen-mk"; reason: "sai" | "het-han". Quên mật khẩu trả về resetToken.
  verifyOtp: ({ phone, code, flow }) => postJson("/api/auth/otp/verify", { phone, code, flow }),
  resendOtp: ({ phone, flow }) => postJson("/api/auth/otp/resend", { phone, flow }),
  requestReset: ({ phone }) => postJson("/api/auth/reset/request", { phone }),
  // reason: "het-han" (phiên đặt lại đã hết hạn)
  resetPassword: ({ token, password }) => postJson("/api/auth/reset", { token, password }),
  // reason: "google-chua-bat" cho tới khi cấu hình đăng nhập Google ở server
  google: ({ mode }) => postJson("/api/auth/google", { mode }),
};

function generalError(reason) {
  if (reason === "qua-nhieu-lan") return "Bạn thử quá nhiều lần, đợi vài phút rồi thử lại";
  if (reason === "mat-mang") return "Chưa kết nối được máy chủ, kiểm tra mạng rồi thử lại";
  if (reason === "google-chua-bat") return "Đăng nhập bằng Google chưa được bật";
  return "Máy chủ đang gặp lỗi, thử lại sau ít phút";
}
// Không nói sai tên, sai số hay sai mật khẩu (chống dò tài khoản)
const LOGIN_FAILED = "Tài khoản hoặc mật khẩu chưa đúng";

// ---------------------------------------------------------------- icon (SVG nội tuyến, không CDN — CSP)
const AUTH_ICONS = {
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  "eye-off": '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  "arrow-left": '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  "circle-alert": '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
};
const authIcon = (name, cls = "h-4 w-4") =>
  `<svg class="lucide lucide-${name} ${cls} shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${AUTH_ICONS[name]}</svg>`;
const LOGO_MARK = `<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m17 2 4 4-4 4"/><path d="M3 6h18"/><path d="m7 22-4-4 4-4"/><path d="M21 18H3"/></svg>`;
const GOOGLE_MARK = `<svg class="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`;
const SPINNER = `<svg class="h-4 w-4 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>`;

// ---------------------------------------------------------------- class dùng chung (chép từ wireframe A)
const inputBase = "h-12 w-full rounded-xl border bg-surface px-4 text-base text-foreground placeholder:text-muted outline-none transition-colors md:text-sm";
const inputOk = "border-border-strong focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[var(--ring-focus)]";
const inputErr = "border-[var(--danger-border)] focus:ring-2 focus:ring-[rgb(239_68_68/0.1)]";
const btnPrimary = "inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground transition-colors hover:bg-primary-hover outline-none focus-visible:bg-primary-hover disabled:cursor-default md:text-sm";
const btnOutline = "inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2.5 rounded-xl border border-border-strong bg-surface px-4 text-base font-medium text-foreground transition-colors hover:bg-item-hover outline-none focus-visible:bg-item-hover md:text-sm";
const textLink = "cursor-pointer font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:underline";
const subtleLink = "-my-1.5 inline-block cursor-pointer whitespace-nowrap py-1.5 font-normal text-muted underline underline-offset-2 outline-none hover:text-foreground focus-visible:text-foreground";

// ---------------------------------------------------------------- trạng thái
const PAGE = document.body.dataset.page; // "dang-nhap" | "dang-ky" | "quen-mk"
const query = new URLSearchParams(location.search);
const PREVIEW = query.get("tt"); // "dang-gui" | "loi" — chỉ để xem
const TASK = query.get("tin");
const NEXT = safeNext(query.get("tiep")) || "index.html";
const SAMPLE_PHONE = "0912345678"; // chỉ dùng khi mở thẳng bước OTP bằng link

const state = {
  step: initialStep(),
  values: { identifier: query.get("sdt") || "", username: "", "display-name": "", phone: query.get("sdt") || "", password: "", "confirm-password": "", "new-password": "", terms: false },
  errors: {},
  formError: "",
  sending: false,
  visible: {}, // ô mật khẩu đang hiện chữ
  code: ["", "", "", "", "", ""],
  codeError: "",
  codeErrorBoxes: [],
  resetToken: "", // nhận sau khi nhập đúng mã quên mật khẩu, dùng một lần
  resendAt: 0,
  resent: false,
  expired: false,
};

function initialStep() {
  const step = query.get("buoc");
  if (PAGE === "dang-ky") return ["form", "otp"].includes(step) ? step : "form";
  if (PAGE === "quen-mk") return ["sdt", "otp", "mat-khau", "xong"].includes(step) ? step : "sdt";
  return "form";
}

function safeNext(value) {
  // Chỉ nhận đường dẫn trong site, chặn chuyển hướng ra ngoài
  if (!value || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(value)) return "";
  return value;
}

const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const digits = (text) => String(text).replace(/\D/g, "");
// Số Việt Nam, mã vùng +84 cố định trước ô. Gõ "912 345 678", "0912 345 678" hay dán "+84 912…" đều được.
// nationalDigits: 9 số sau +84 (bỏ 84 và số 0 đầu).
const nationalDigits = (text) => {
  let d = digits(text);
  if (d.startsWith("84") && d.length === 11) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  return d;
};
const e164 = (text) => "+84" + nationalDigits(text); // gửi backend dạng +84912345678
const localPhone = (text) => (nationalDigits(text) ? "0" + nationalDigits(text) : ""); // cho tham số ?sdt=
const formatPhone = (text) => {
  const d = nationalDigits(text);
  return d.length === 9 ? `+84 ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : text;
};
const flow = () => (PAGE === "quen-mk" ? "quen-mk" : "dang-ky");

function linkTo(page, extra = {}) {
  const p = new URLSearchParams();
  if (query.get("tiep")) p.set("tiep", query.get("tiep"));
  if (TASK) p.set("tin", TASK);
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  const s = p.toString();
  return page + (s ? "?" + s : "");
}

// Trạng thái tĩnh để xem (?tt=), không gọi backend
function applyPreview() {
  const v = state.values;
  // Mở thẳng một bước giữa luồng bằng link: dùng số mẫu, đếm ngược như vừa gửi
  if (["otp", "mat-khau", "xong"].includes(state.step) && !v.phone) v.phone = SAMPLE_PHONE;
  if (state.step === "otp") state.resendAt = Date.now() + 57000;
  if (!PREVIEW) return;
  if (PREVIEW === "dang-gui") {
    state.sending = true;
    Object.assign(v, { identifier: "minhanh.hn", username: "minhanh.hn", "display-name": "Minh Anh Hà Nội", phone: v.phone || SAMPLE_PHONE, password: "matkhau123", "confirm-password": "matkhau123", "new-password": "matkhaumoi1", terms: true });
    if (state.step === "otp") state.code = [..."482913"];
  }
  if (PREVIEW === "loi") {
    if (PAGE === "dang-nhap") { v.identifier = "minhanh.hn"; state.formError = LOGIN_FAILED; }
    else if (state.step === "form") {
      Object.assign(v, { username: "minh anh", phone: "091234", password: "matkhau123", "confirm-password": "matkhau12" });
      state.errors = {
        username: "Chỉ dùng chữ không dấu, số, dấu chấm hoặc gạch dưới",
        "display-name": "Chưa nhập tên hiển thị",
        phone: "Số điện thoại cần 9 số sau +84",
        "confirm-password": "Mật khẩu nhập lại chưa khớp",
        terms: "Cần đồng ý điều khoản để tạo tài khoản",
      };
    } else if (state.step === "sdt") { v.phone = "091234"; state.errors = { phone: "Số điện thoại cần 9 số sau +84" }; }
    else if (state.step === "otp") { state.codeError = "Mã chưa đúng, kiểm tra tin nhắn mới nhất"; state.codeErrorBoxes = [0, 1, 2, 3, 4, 5]; }
    else if (state.step === "mat-khau") state.expired = true;
  }
}

// ---------------------------------------------------------------- mảnh giao diện
function brand() {
  return `<a href="index.html" class="-m-1 inline-flex items-center gap-2.5 rounded-xl p-1 outline-none focus-visible:bg-item-hover" aria-label="doite.vn, về trang chủ">
    <span class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">${LOGO_MARK}</span>
    <span class="text-lg font-bold tracking-tight text-foreground">doite<b class="font-extrabold text-primary">.vn</b></span>
  </a>`;
}

function heading(title, lead = "") {
  return `<h1 tabindex="-1" class="mt-6 text-xl font-semibold tracking-tight text-foreground outline-none">${title}</h1>
    ${lead ? `<p class="pretty mt-1.5 text-sm text-muted">${lead}</p>` : ""}`;
}

function message(id, hint) {
  const error = state.errors[id];
  return `<p id="${id}-msg" data-hint="${esc(hint)}" class="pretty min-h-[1rem] text-xs ${error ? "text-danger" : "text-muted"}">${esc(error || hint)}</p>`;
}

// Ô đồng ý điều khoản: checkbox thật (appearance-none), không tick sẵn, lỗi dưới nhãn (choice-controls.md)
const checkOk = "border-border-strong [&:not(:checked):hover]:border-foreground";
const checkErr = "border-[var(--danger-border)]";
function termsCheckbox() {
  const error = state.errors.terms;
  const docLink = "cursor-pointer text-foreground underline underline-offset-2 outline-none hover:text-primary focus-visible:text-primary";
  return `<div class="flex flex-col gap-1.5">
    <label class="flex cursor-pointer items-start gap-3 text-sm text-foreground">
      <span class="relative mt-px inline-flex shrink-0">
        <input id="terms" type="checkbox" data-key="terms" ${state.values.terms ? "checked" : ""} ${error ? 'aria-invalid="true"' : ""} aria-describedby="terms-msg" ${state.sending ? "disabled" : ""} class="peer h-5 w-5 cursor-pointer appearance-none rounded-md border-[1.5px] bg-surface outline-none transition-colors checked:border-primary checked:bg-primary focus-visible:border-foreground focus-visible:bg-item-hover checked:focus-visible:border-primary-hover checked:focus-visible:bg-primary-hover ${error ? checkErr : checkOk}" />
        <svg class="pointer-events-none absolute inset-0 m-auto h-3.5 w-3.5 text-primary-foreground opacity-0 peer-checked:opacity-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
      </span>
      <span class="pretty">Tôi đồng ý với <a href="#" class="${docLink}">Quy định giao dịch an toàn</a> và <a href="#" class="${docLink}">Điều khoản sử dụng</a> của doite.vn</span>
    </label>
    <p id="terms-msg" data-hint="" class="min-h-[1rem] pl-8 text-xs text-danger">${esc(error || "")}</p>
  </div>`;
}

// Ô số điện thoại: cờ Việt Nam + "+84" cố định ở đầu ô (chỉ nhận số Việt Nam)
const VN_FLAG = `<svg class="h-[14px] w-5 shrink-0 rounded-[3px]" viewBox="0 0 30 20" aria-hidden="true"><rect width="30" height="20" fill="#da251d"/><path fill="#ffff00" d="M15 4.5l1.2 3.7h3.9l-3.15 2.29 1.2 3.7L15 11.9l-3.15 2.29 1.2-3.7L9.9 8.2h3.9z"/></svg>`;
function phoneField(hint = "") {
  const id = "phone";
  const error = state.errors[id];
  return `<div class="flex flex-col gap-1.5">
    <label for="${id}" class="w-fit cursor-pointer text-sm font-medium text-foreground">Số điện thoại</label>
    <div class="relative">
      <span class="pointer-events-none absolute inset-y-0 left-0 flex items-center gap-2 pl-4 text-base text-foreground md:text-sm">${VN_FLAG}<span class="tabular">+84</span><span class="ml-1 h-5 w-px bg-border-strong"></span></span>
      <input id="${id}" name="${id}" data-key="${id}" type="tel" placeholder="Nhập số điện thoại" value="${esc(state.values[id])}" autocomplete="tel-national" inputmode="numeric" ${error ? 'aria-invalid="true"' : ""} aria-describedby="${id}-prefix ${id}-msg" ${state.sending ? "readonly" : ""} class="${inputBase} ${error ? inputErr : inputOk} pl-[6.25rem]" />
      <span id="${id}-prefix" class="sr-only">Mã vùng Việt Nam +84</span>
    </div>
    ${message(id, hint)}
  </div>`;
}

function field({ id, label, type = "text", placeholder, autocomplete, inputmode = "", hint = "", attrs = "" }) {
  const error = state.errors[id];
  return `<div class="flex flex-col gap-1.5">
    <label for="${id}" class="w-fit cursor-pointer text-sm font-medium text-foreground">${label}</label>
    <input id="${id}" name="${id}" data-key="${id}" type="${type}" placeholder="${placeholder}" value="${esc(state.values[id])}" autocomplete="${autocomplete}" ${inputmode ? `inputmode="${inputmode}"` : ""} ${attrs} ${error ? 'aria-invalid="true"' : ""} aria-describedby="${id}-msg" ${state.sending ? "readonly" : ""} class="${inputBase} ${error ? inputErr : inputOk}" />
    ${message(id, hint)}
  </div>`;
}

function passwordField({ id, label, placeholder, autocomplete, hint = "", forgot = false }) {
  const error = state.errors[id];
  const shown = state.visible[id];
  return `<div class="relative flex flex-col gap-1.5">
    <label for="${id}" class="w-fit cursor-pointer text-sm font-medium text-foreground">${label}</label>
    <div class="relative">
      <input id="${id}" name="${id}" data-key="${id}" type="${shown ? "text" : "password"}" placeholder="${placeholder}" value="${esc(state.values[id])}" autocomplete="${autocomplete}" ${error ? 'aria-invalid="true"' : ""} aria-describedby="${id}-msg" ${state.sending ? "readonly" : ""} class="${inputBase} ${error ? inputErr : inputOk} pr-11" />
      <button type="button" data-eye="${id}" aria-label="${shown ? "Ẩn mật khẩu" : "Hiện mật khẩu"}" class="absolute inset-y-0 right-1 my-auto flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted outline-none hover:text-foreground focus-visible:text-foreground">${authIcon(shown ? "eye-off" : "eye")}</button>
    </div>
    ${message(id, hint)}
    ${forgot ? `<a href="${linkTo("quen-mat-khau.html", { sdt: forgotPhone() })}" data-forgot class="absolute -top-2 right-0 cursor-pointer py-2 pl-2 text-sm text-foreground outline-none hover:underline focus-visible:underline">Quên mật khẩu?</a>` : ""}
  </div>`;
}

function submitButton(label) {
  return `<button type="submit" ${state.sending ? 'disabled aria-busy="true"' : ""} class="${btnPrimary}">${state.sending ? SPINNER : ""}${label}</button>`;
}

const divider = `<div class="my-6 flex items-center gap-3"><span class="h-px flex-1 bg-border-strong"></span><span class="text-xs text-muted">hoặc</span><span class="h-px flex-1 bg-border-strong"></span></div>`;

function googleButton(text, mode) {
  return `<button type="button" data-google="${mode}" class="${btnOutline}">${GOOGLE_MARK}${text}</button>`;
}

function formError() {
  // Lỗi không gắn với ô nào: ngay trên nút, role=alert
  return `<div ${state.formError ? "" : "hidden"}><p role="alert" class="flex items-start gap-2 text-sm text-danger">${authIcon("circle-alert", "mt-0.5 h-4 w-4")}<span>${esc(state.formError)}</span></p></div>`;
}

// Số mang sang trang quên mật khẩu: ô đăng nhập gõ số điện thoại thì mang theo, gõ tên thì thôi
function forgotPhone() {
  if (PAGE !== "dang-nhap") return localPhone(state.values.phone);
  const value = state.values.identifier;
  return /^[\d\s+.-]+$/.test(value) && nationalDigits(value).length === 9 ? localPhone(value) : "";
}

// ---------------------------------------------------------------- các màn
function viewLogin() {
  const lead = TASK ? `Đăng nhập để gửi chào giá cho tin <b class="whitespace-nowrap font-medium text-foreground">${esc(TASK)}</b>.` : "";
  return `${heading("Đăng nhập", lead)}
  <form data-form="login" class="mt-6 flex flex-col gap-3" novalidate>
    ${field({ id: "identifier", label: "Tên đăng nhập hoặc số điện thoại", placeholder: "Nhập tên đăng nhập hoặc số điện thoại", autocomplete: "username", attrs: 'autocapitalize="none" spellcheck="false"' })}
    ${passwordField({ id: "password", label: "Mật khẩu", placeholder: "Nhập mật khẩu", autocomplete: "current-password", forgot: true })}
    ${formError()}
    <div class="mt-1">${submitButton("Đăng nhập")}</div>
  </form>
  ${divider}
  ${googleButton("Đăng nhập bằng Google", "dang-nhap")}
  <p class="mt-6 text-sm text-muted">Chưa có tài khoản? <a href="${linkTo("dang-ky.html")}" class="${textLink}">Tạo tài khoản</a></p>`;
}

function viewRegister() {
  // Gọn để vừa một màn không cần cuộn (người dùng dặn 11/2026): từ sm thẻ rộng, ô xếp 2 cột,
  // "Đã có tài khoản?" đứng trên cùng, nút Google cạnh nút chính. Dòng "mã gửi qua SMS" thành gợi ý dưới ô số.
  return `${heading("Tạo tài khoản")}
  <form data-form="register" class="mt-5 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2" novalidate>
    ${field({ id: "username", label: "Tên đăng nhập", placeholder: "Nhập tên đăng nhập", autocomplete: "username", hint: "4–20 ký tự: chữ không dấu, số, . hoặc _", attrs: 'autocapitalize="none" spellcheck="false"' })}
    ${field({ id: "display-name", label: "Tên hiển thị", placeholder: "Nhập tên hiển thị", autocomplete: "nickname", hint: "Hiện trên tin bạn đăng" })}
    <div class="sm:col-span-2">${phoneField("Mã xác minh sẽ được gửi qua SMS tới số này")}</div>
    ${passwordField({ id: "password", label: "Mật khẩu", placeholder: "Tạo mật khẩu", autocomplete: "new-password", hint: "Ít nhất 8 ký tự" })}
    ${passwordField({ id: "confirm-password", label: "Nhập lại mật khẩu", placeholder: "Nhập lại mật khẩu", autocomplete: "new-password" })}
    <div class="sm:col-span-2">${termsCheckbox()}</div>
    <div class="sm:col-span-2 ${state.formError ? "" : "hidden"}">${formError()}</div>
    <div class="grid grid-cols-1 gap-x-4 gap-y-3 sm:col-span-2 sm:grid-cols-2">
      ${submitButton("Tạo tài khoản")}
      ${googleButton("Đăng ký bằng Google", "dang-ky")}
    </div>
  </form>`;
}

function viewOtp() {
  const reset = flow() === "quen-mk";
  const boxes = state.code.map((value, i) => {
    const bad = state.codeErrorBoxes.includes(i);
    return `<input data-otp="${i}" inputmode="numeric" ${i === 0 ? 'autocomplete="one-time-code" maxlength="6"' : 'maxlength="1"'} aria-label="Số thứ ${i + 1} trên 6" value="${esc(value)}" ${state.sending ? "readonly" : ""} class="aspect-square w-full min-w-0 rounded-xl border bg-surface text-center text-2xl font-semibold text-foreground tabular outline-none transition-colors ${bad ? inputErr : inputOk}" />`;
  }).join("");
  return `${heading("Nhập mã xác minh")}
  <p class="mt-1.5 text-sm text-muted">${reset ? "Nếu số này đã đăng ký, mã gồm 6 số đã được gửi qua SMS tới" : "Mã gồm 6 số vừa được gửi qua SMS tới"}</p>
  <p class="text-sm font-medium text-foreground"><span class="tabular">${esc(formatPhone(state.values.phone))}</span> <button type="button" data-change-phone class="${subtleLink} ml-1">Đổi số</button></p>
  <form data-form="otp" class="mt-6" novalidate>
    <fieldset>
      <legend class="mb-2 text-sm font-medium text-foreground">Mã xác minh</legend>
      <div class="grid grid-cols-6 gap-2 sm:gap-3">${boxes}</div>
      <p id="otp-msg" aria-live="polite" class="mt-2 min-h-[1rem] text-xs text-danger">${esc(state.codeError)}</p>
    </fieldset>
    <div class="mt-4">${submitButton("Xác nhận")}</div>
  </form>
  <p id="otp-status" role="status" class="mt-6 min-h-[1.25rem] text-sm text-muted"></p>`;
}

function viewForgot() {
  return `${heading("Quên mật khẩu", "Nhập số điện thoại đã đăng ký, mã đặt lại mật khẩu sẽ được gửi qua SMS tới số đó.")}
  <form data-form="forgot" class="mt-6 flex flex-col gap-3" novalidate>
    ${phoneField()}
    ${formError()}
    <div class="mt-1">${submitButton("Gửi mã")}</div>
  </form>
  <p class="mt-6 text-sm"><a href="${linkTo("dang-nhap.html", { sdt: localPhone(state.values.phone) })}" class="${textLink} -my-2 inline-flex items-center gap-1.5 py-2">${authIcon("arrow-left")}Quay lại đăng nhập</a></p>`;
}

function viewNewPassword() {
  const phone = esc(formatPhone(state.values.phone));
  if (state.expired) {
    // Phiên đặt lại hết hạn: thay cả form, một nút duy nhất
    return `${heading("Phiên đặt lại đã hết hạn", "Mật khẩu cũ chưa bị đổi. Gửi mã mới để đặt lại mật khẩu cho tài khoản này.")}
    <p class="mt-4 text-sm font-medium text-foreground tabular">${phone}</p>
    <form data-form="resend-reset" class="mt-6 flex flex-col gap-3" novalidate>${formError()}${submitButton("Gửi mã mới")}</form>`;
  }
  return `${heading("Đặt mật khẩu mới", `Cho tài khoản <b class="font-medium text-foreground tabular">${phone}</b>`)}
  <form data-form="new-password" class="mt-6 flex flex-col gap-3" novalidate>
    <input type="text" name="username" value="${esc(e164(state.values.phone))}" autocomplete="username" hidden />
    ${passwordField({ id: "new-password", label: "Mật khẩu mới", placeholder: "Tạo mật khẩu", autocomplete: "new-password", hint: "Ít nhất 8 ký tự" })}
    ${formError()}
    <div class="mt-1">${submitButton("Lưu mật khẩu")}</div>
  </form>`;
}

function viewDone() {
  return `${heading("Đã đổi mật khẩu", `Dùng mật khẩu mới để đăng nhập tài khoản <b class="font-medium text-foreground tabular">${esc(formatPhone(state.values.phone))}</b>.`)}
  <div class="mt-6"><a href="${linkTo("dang-nhap.html", { sdt: localPhone(state.values.phone) })}" class="${btnPrimary}">Đăng nhập</a></div>`;
}

function currentView() {
  if (PAGE === "dang-nhap") return viewLogin();
  if (PAGE === "dang-ky") return state.step === "otp" ? viewOtp() : viewRegister();
  return { sdt: viewForgot, otp: viewOtp, "mat-khau": viewNewPassword, xong: viewDone }[state.step]();
}

const FIRST_FIELD = { form: PAGE === "dang-nhap" ? "identifier" : "username", sdt: "phone", otp: "otp-0", "mat-khau": "new-password" };

function render(focusId) {
  const wide = PAGE === "dang-ky" && state.step === "form";
  document.getElementById("app").innerHTML = `
  <div class="flex min-h-screen flex-col items-center justify-center px-4 ${wide ? "py-6 sm:py-4" : "py-10 sm:py-16"}">
    <main class="w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-2xl bg-surface p-6 sm:p-8">
      ${wide ? `<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">${brand()}<p class="text-sm text-muted">Đã có tài khoản? <a href="${linkTo("dang-nhap.html")}" class="${textLink}">Đăng nhập</a></p></div>` : brand()}
      ${currentView()}
    </main>
    <a href="index.html" class="${wide ? "sm:hidden " : ""}mt-4 inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-sm text-muted outline-none hover:text-foreground focus-visible:text-foreground">${authIcon("arrow-left")}Về trang chủ</a>
  </div>`;
  if (state.step === "otp") renderResendStatus();
  if (focusId === null) return;
  const id = focusId || FIRST_FIELD[state.step];
  const target = id === "otp-0" ? document.querySelector('[data-otp="0"]') : id && document.getElementById(id);
  // Lần vẽ đầu không cuộn trang theo con trỏ
  if (target) target.focus({ preventScroll: !rendered });
  rendered = true;
}
let rendered = false;

// ---------------------------------------------------------------- kiểm form
function checkPhone(value) {
  if (!digits(value)) return "Chưa nhập số điện thoại";
  if (nationalDigits(value).length !== 9) return "Số điện thoại cần 9 số sau +84";
  return "";
}

function failFields(errors, order) {
  state.errors = errors;
  render(order.find((id) => errors[id]));
}

async function send(request, onDone) {
  state.sending = true;
  state.formError = "";
  render(null);
  const result = (await request()) || { ok: true };
  state.sending = false;
  onDone(result);
}

function goToOtp() {
  state.step = "otp";
  state.code = ["", "", "", "", "", ""];
  state.codeError = "";
  state.codeErrorBoxes = [];
  state.resent = false;
  state.resendAt = Date.now() + 60000;
  render();
}

const ACTIONS = {
  login() {
    const v = state.values;
    const errors = {};
    if (!v.identifier.trim()) errors.identifier = "Chưa nhập tên đăng nhập hoặc số điện thoại";
    if (!v.password) errors.password = "Chưa nhập mật khẩu";
    state.formError = "";
    if (Object.keys(errors).length) return failFields(errors, ["identifier", "password"]);
    state.errors = {};
    send(() => DoiteAuth.login({ identifier: v.identifier.trim(), password: v.password }), (result) => {
      if (result.ok) { state.sending = true; render(null); location.href = NEXT; return; }
      // Sai: giữ tên/số, xoá mật khẩu, con trỏ vào ô mật khẩu; không nói sai ô nào
      state.formError = result.reason === "sai" ? LOGIN_FAILED : generalError(result.reason);
      v.password = "";
      render("password");
    });
  },
  register() {
    const v = state.values;
    const errors = {};
    const username = v.username.trim();
    if (!username) errors.username = "Chưa nhập tên đăng nhập";
    else if (!/^[a-zA-Z0-9._]+$/.test(username)) errors.username = "Chỉ dùng chữ không dấu, số, dấu chấm hoặc gạch dưới";
    else if (username.length < 4 || username.length > 20) errors.username = "Tên đăng nhập cần 4–20 ký tự";
    if (!v["display-name"].trim()) errors["display-name"] = "Chưa nhập tên hiển thị";
    if (checkPhone(v.phone)) errors.phone = checkPhone(v.phone);
    if (!v.password) errors.password = "Chưa nhập mật khẩu";
    else if (v.password.length < 8) errors.password = "Mật khẩu cần ít nhất 8 ký tự";
    if (!v["confirm-password"]) errors["confirm-password"] = "Chưa nhập lại mật khẩu";
    else if (v.password && v["confirm-password"] !== v.password) errors["confirm-password"] = "Mật khẩu nhập lại chưa khớp";
    if (!v.terms) errors.terms = "Cần đồng ý điều khoản để tạo tài khoản";
    if (Object.keys(errors).length) return failFields(errors, ["username", "display-name", "phone", "password", "confirm-password", "terms"]);
    state.errors = {};
    send(() => DoiteAuth.register({ username, displayName: v["display-name"].trim(), phone: e164(v.phone), password: v.password, acceptedTerms: true }), (result) => {
      if (result.ok) return goToOtp();
      const fieldErrors = {
        "trung-ten": ["username", "Tên đăng nhập này đã có người dùng, thử tên khác"],
        "ten-dang-nhap-sai": ["username", "Chỉ dùng chữ không dấu, số, dấu chấm hoặc gạch dưới"],
        "ten-hien-thi-sai": ["display-name", "Tên hiển thị cần 2–50 ký tự"],
        "da-co": ["phone", "Số này đã có tài khoản, hãy đăng nhập"],
        "so-dien-thoai-sai": ["phone", "Số điện thoại chưa đúng, kiểm tra lại đầu số"],
        "mat-khau-sai": ["password", "Mật khẩu cần 8–128 ký tự"],
        "chua-dong-y": ["terms", "Cần đồng ý điều khoản để tạo tài khoản"],
      }[result.reason];
      if (fieldErrors) return failFields({ [fieldErrors[0]]: fieldErrors[1] }, [fieldErrors[0]]);
      state.formError = generalError(result.reason);
      render(null);
    });
  },
  otp() {
    const code = state.code.join("");
    if (code.length < 6) {
      state.codeError = code ? "Mã còn thiếu số, nhập đủ 6 số" : "Chưa nhập mã";
      state.codeErrorBoxes = state.code.map((d, i) => (d ? -1 : i)).filter((i) => i >= 0);
      render(null);
      document.querySelector(`[data-otp="${state.codeErrorBoxes[0]}"]`).focus();
      return;
    }
    send(() => DoiteAuth.verifyOtp({ phone: e164(state.values.phone), code, flow: flow() }), (result) => {
      if (result.ok) {
        if (flow() === "dang-ky") { state.sending = true; render(null); location.href = NEXT; return; }
        state.resetToken = result.resetToken || "";
        state.step = "mat-khau";
        state.expired = false;
        return render();
      }
      // Sai hoặc hết hạn: xoá sáu ô, con trỏ về ô đầu
      state.codeError =
        result.reason === "het-han" ? "Mã đã hết hạn, bấm Gửi lại mã để nhận mã mới"
        : result.reason === "sai" ? "Mã chưa đúng, kiểm tra tin nhắn mới nhất"
        : generalError(result.reason);
      state.codeErrorBoxes = [0, 1, 2, 3, 4, 5];
      state.code = ["", "", "", "", "", ""];
      render("otp-0");
    });
  },
  forgot() {
    const error = checkPhone(state.values.phone);
    if (error) return failFields({ phone: error }, ["phone"]);
    state.errors = {};
    send(() => DoiteAuth.requestReset({ phone: e164(state.values.phone) }), (result) => {
      if (result.ok) return goToOtp();
      if (result.reason === "so-dien-thoai-sai") return failFields({ phone: "Số điện thoại chưa đúng, kiểm tra lại đầu số" }, ["phone"]);
      state.formError = generalError(result.reason);
      render(null);
    });
  },
  "new-password"() {
    const value = state.values["new-password"];
    if (!value) return failFields({ "new-password": "Chưa nhập mật khẩu mới" }, ["new-password"]);
    if (value.length < 8) return failFields({ "new-password": "Mật khẩu cần ít nhất 8 ký tự" }, ["new-password"]);
    state.errors = {};
    send(() => DoiteAuth.resetPassword({ token: state.resetToken, password: value }), (result) => {
      if (result.ok) { state.step = "xong"; return render(null); }
      if (result.reason === "het-han") { state.expired = true; return render(null); }
      state.formError = generalError(result.reason);
      render(null);
    });
  },
  "resend-reset"() {
    send(() => DoiteAuth.requestReset({ phone: e164(state.values.phone) }), (result) => {
      if (result.ok) return goToOtp();
      state.formError = generalError(result.reason);
      render(null);
    });
  },
};

// ---------------------------------------------------------------- gửi lại mã (đếm ngược)
function renderResendStatus() {
  const box = document.getElementById("otp-status");
  if (!box) return;
  const left = Math.max(0, Math.ceil((state.resendAt - Date.now()) / 1000));
  if (left > 0) {
    const time = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    box.innerHTML = state.resent
      ? `<span class="font-medium text-foreground">Đã gửi mã mới</span> · <span class="tabular">Gửi lại sau ${time}</span>`
      : `Chưa nhận được mã? <span class="tabular">Gửi lại sau ${time}</span>`;
  } else if (!box.querySelector("[data-resend]")) {
    state.resent = false;
    box.innerHTML = `Chưa nhận được mã? <button type="button" data-resend class="-my-2 -mx-1.5 cursor-pointer rounded-lg px-1.5 py-2 font-medium text-foreground outline-none hover:underline focus-visible:underline underline-offset-2">Gửi lại mã</button>`;
  }
}
setInterval(() => { if (state.step === "otp") renderResendStatus(); }, 1000);

// ---------------------------------------------------------------- sự kiện
document.addEventListener("submit", (event) => {
  event.preventDefault();
  if (state.sending) return;
  const action = ACTIONS[event.target.dataset.form];
  if (action) action();
});

document.addEventListener("input", (event) => {
  const input = event.target;
  if (input.dataset.key) {
    const key = input.dataset.key;
    state.values[key] = input.type === "checkbox" ? input.checked : input.value;
    if (state.errors[key]) {
      // Sửa xong thì câu lỗi mất, chỗ của nó ở lại (min-h)
      delete state.errors[key];
      input.className = input.type === "checkbox" ? input.className.replace(checkErr, checkOk) : input.className.replace(inputErr, inputOk);
      input.removeAttribute("aria-invalid");
      const msg = document.getElementById(`${key}-msg`);
      msg.textContent = msg.dataset.hint;
      msg.className = msg.className.replace("text-danger", "text-muted");
    }
    return;
  }
  if (input.dataset.otp === undefined) return;
  const boxes = [...document.querySelectorAll("[data-otp]")];
  const start = Number(input.dataset.otp);
  const typed = digits(input.value);
  if (state.codeError) {
    state.codeError = "";
    state.codeErrorBoxes = [];
    document.getElementById("otp-msg").textContent = "";
    for (const box of boxes) box.className = box.className.replace(inputErr, inputOk);
  }
  if (typed.length > 1) {
    // Dán cả mã hoặc tự điền từ SMS: chia ra các ô
    [...typed].slice(0, 6 - start).forEach((d, i) => { boxes[start + i].value = d; state.code[start + i] = d; });
    boxes[Math.min(start + typed.length, 5)].focus();
    return;
  }
  input.value = typed;
  state.code[start] = typed;
  if (typed && start < 5) boxes[start + 1].focus();
});

document.addEventListener("keydown", (event) => {
  const box = event.target.dataset && event.target.dataset.otp;
  if (box !== undefined && event.key === "Backspace" && !event.target.value && box !== "0") {
    document.querySelector(`[data-otp="${Number(box) - 1}"]`).focus();
  }
});

document.addEventListener("click", (event) => {
  const eye = event.target.closest("[data-eye]");
  if (eye) {
    const id = eye.dataset.eye;
    state.visible[id] = !state.visible[id];
    const input = document.getElementById(id);
    input.type = state.visible[id] ? "text" : "password";
    eye.setAttribute("aria-label", state.visible[id] ? "Ẩn mật khẩu" : "Hiện mật khẩu");
    eye.innerHTML = authIcon(state.visible[id] ? "eye-off" : "eye");
    return;
  }
  const forgot = event.target.closest("[data-forgot]");
  if (forgot) {
    // Mang theo số vừa gõ sang trang quên mật khẩu
    forgot.href = linkTo("quen-mat-khau.html", { sdt: forgotPhone() });
    return;
  }
  if (event.target.closest("[data-change-phone]")) {
    // Về bước trước, dữ liệu điền sẵn (mật khẩu để trống), con trỏ ở ô số điện thoại
    state.step = PAGE === "dang-ky" ? "form" : "sdt";
    state.values.password = "";
    state.values["confirm-password"] = "";
    state.errors = {};
    render("phone");
    return;
  }
  if (event.target.closest("[data-resend]")) {
    if (state.sending) return;
    Promise.resolve(DoiteAuth.resendOtp({ phone: e164(state.values.phone), flow: flow() })).then((result) => {
      if (result && !result.ok) {
        state.codeError = generalError(result.reason);
        render(null);
        return;
      }
      state.resent = true;
      state.resendAt = Date.now() + 60000;
      state.code = ["", "", "", "", "", ""];
      state.codeError = "";
      state.codeErrorBoxes = [];
      render("otp-0");
    });
    return;
  }
  const google = event.target.closest("[data-google]");
  if (google && !state.sending) {
    Promise.resolve(DoiteAuth.google({ mode: google.dataset.google })).then((result) => {
      if (result && !result.ok) {
        state.formError = generalError(result.reason);
        render(null);
      }
    });
  }
});

applyPreview();
render(PREVIEW === "loi" && PAGE === "dang-nhap" ? "password" : undefined);
