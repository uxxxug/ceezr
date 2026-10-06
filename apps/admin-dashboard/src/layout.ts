/**
 * الغرض: هيكل صفحات اللوحة المشترك: الترويسة، التنقّل بين الصفحات الثماني،
 *   البحث الموحَّد، وأدوات بناء HTML آمنة (هروب إلزامي لكل قيمة قادمة من القاعدة).
 * الحالة: منفّذ فعلياً — المرحلة 2.7 (القسم د.1).
 * ينتمي إلى: apps/admin-dashboard
 * يُتوقع أن يستخدمه لاحقاً: كل صفحة، وapps/gateway/src/routes/admin-ui.ts
 * ملاحظات مستقبلية: لا مُجمِّع ولا إطار واجهة عمداً (ADR 0007) — عند الحاجة إلى
 *   تفاعل أعمق يُضاف ملف JS مستقل، لا خطوة بناء.
 */

import { formatDateTime } from "./format.ts";

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * كل قيمة تُطبع في الصفحة تمرّ من هنا. أسماء المستخدمين وتعليقات التقييم ونصوص
 * الشكاوى كلها كتبها بشر عبر تلغرام: صفحة إدارة تطبع نصّ مستخدم بلا هروب هي
 * صفحة تُنفّذ ما يكتبه ذلك المستخدم في متصفّح المسؤول.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

export interface AdminUser {
  readonly userId: string;
  readonly cityId: string;
  readonly telegramId: string;
  readonly fullName: string | null;
}

export interface NavItem {
  readonly path: string;
  readonly label: string;
}

/** الصفحات بترتيب استخدامها التشغيلي لا بترتيب بنائها. */
export const NAV_ITEMS: readonly NavItem[] = [
  { path: "/admin", label: "نظرة عامة" },
  { path: "/admin/live-orders", label: "الطلبات الحية" },
  // بعد الطلبات الحيّة مباشرةً وقبل السائقين: هما شاشتا «ما يجري الآن»، والمشغّل
  // ينتقل بينهما في الحادثة الواحدة (طلبٌ متعثّر ⇐ أين سائقوه).
  { path: "/admin/live-map", label: "خريطة العمليات" },
  { path: "/admin/drivers", label: "السائقون" },
  { path: "/admin/heatmap", label: "خريطة الطلب والعرض" },
  { path: "/admin/disputes", label: "النزاعات" },
  { path: "/admin/ratings", label: "التقييمات" },
  { path: "/admin/attendance", label: "الحضور" },
  { path: "/admin/payments", label: "المدفوعات" },
  // البثّ قبل الإعدادات وبعد المدفوعات: فعلٌ تشغيليٌّ يوميٌّ لا ضبطٌ يُمسّ مرّةً.
  { path: "/admin/broadcast", label: "البثّ الجماعي" },
  // بعد البثّ: كلاهما عن «ما يصل المستخدمَ في تيليجرام».
  { path: "/admin/messages", label: "معرض الرسائل" },
  // الاسترداد قبل الإعدادات: فعلٌ تشغيليٌّ لا ضبطٌ.
  { path: "/admin/recovery", label: "استرداد الحسابات" },
  { path: "/admin/settings", label: "الإعدادات" },
];

export interface ShellOptions {
  readonly title: string;
  readonly activePath: string;
  readonly user: AdminUser;
  readonly csrfToken: string;
  readonly body: string;
  /** رسالة نتيجة آخر فعل كتابي — تُمرَّر في الرابط بعد إعادة التوجيه. */
  readonly notice?: { readonly kind: "ok" | "error"; readonly text: string };
  /**
   * صدقُ عُمرِ القراءةِ للصفحاتِ التشغيلية (UI-6 / PR 9 · ADR 0240).
   *
   * كانت الصفحاتُ التشغيليةُ تُعيدُ تحميلَ نفسِها بمؤقّتٍ دوريٍّ في المتصفّح؛ والمصدرُ
   * الكانونيُّ (§9) يحظرُ الاستقصاءَ الدوريَّ. والبديلُ لا يُخفي المشكلةَ التي جاءَ
   * المؤقّتُ لها (طلبٌ أُلغي يبقى معروضاً): **القراءةُ تُعلَنُ بساعتِها**، وبعدَ
   * `staleAfterSeconds` يظهرُ شريطُ «قراءةٌ قديمة» بلا جافاسكربت (تأخيرُ حركةِ CSS)،
   * ومعه رابطُ تحديثٍ يدويّ. لا طلبَ شبكةٍ إلا بيدِ المسؤول.
   */
  readonly freshness?: { readonly observedAt: Date; readonly staleAfterSeconds: number };
  /**
   * قيمة `nonce` الموافقة لسياسة أمن المحتوى في ترويسة الردّ (المرحلة ١٠).
   *
   * إلزامية لا اختيارية: مع `script-src 'nonce-…'` يرفض المتصفّح كلّ وسم نصّ لا
   * يحمل القيمة نفسها — فقيمةٌ خاطئة أو غائبة تُعطّل البحث بلا أي رسالة خطأ في
   * الصفحة. وجعلُها اختيارية كان سيسمح بنسيانها في مُتصِلٍ واحد فتُشلّ صفحةٌ
   * واحدة دون غيرها، وهو أسوأ أنواع العطل: متقطّع وصامت.
   */
  readonly cspNonce: string;
}

/** أدنى تأخيرٍ لشريطِ القِدَم — قيمةٌ أصغرُ تُعلنُ القراءةَ قديمةً قبل أن تُقرأ. */
const MIN_STALE_SECONDS = 5;

function freshnessBlock(freshness: NonNullable<ShellOptions["freshness"]>): string {
  const iso = freshness.observedAt.toISOString();
  const seconds = Math.max(MIN_STALE_SECONDS, Math.trunc(freshness.staleAfterSeconds));
  return `<div class="freshness" data-freshness="${seconds}">
<p class="freshness-line">قراءةُ الخادمِ في <time datetime="${escapeHtml(iso)}">${escapeHtml(
    formatDateTime(freshness.observedAt),
  )}</time> (توقيت الرياض). الصفحةُ لا تتحدّثُ وحدَها. <a class="refresh-link" href="">تحديثُ القراءة</a></p>
${stateBlock(
  "stale",
  `مضى أكثرُ من ${seconds} ثانيةً على هذه القراءة؛ ما يجري الآنَ قد يختلفُ عمّا تراه.`,
  { href: "", label: "حدِّث الآن" },
  "stale-reveal",
)}
</div>`;
}

export function renderShell(options: ShellOptions): string {
  const nav = NAV_ITEMS.map((item) => {
    const isActive = item.path === options.activePath;
    return `<a class="nav-link${isActive ? " is-active" : ""}" href="${escapeHtml(item.path)}"${
      isActive ? ' aria-current="page"' : ""
    }>${escapeHtml(item.label)}</a>`;
  }).join("");

  // الخطأ «تنبيهٌ» يُقرأ فوراً لقارئ الشاشة، والنجاحُ «حالةٌ» لا تقاطعه.
  const notice =
    options.notice === undefined
      ? ""
      : `<div role="${options.notice.kind === "error" ? "alert" : "status"}" class="notice notice--${
          options.notice.kind
        }">${escapeHtml(options.notice.text)}</div>`;

  const staleDelay =
    options.freshness === undefined
      ? ""
      : `.stale-reveal{animation-delay:${Math.max(
          MIN_STALE_SECONDS,
          Math.trunc(options.freshness.staleAfterSeconds),
        )}s}`;

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(options.title)} — لوحة وَصْلة</title>
<style nonce="${escapeHtml(options.cspNonce)}">${STYLE}${staleDelay}</style>
</head>
<body>
<a class="skip" href="#main">تخطَّ إلى المحتوى</a>
<header class="top">
  <div class="brand">وَصْلة · لوحة الإدارة</div>
  <form id="search-form" class="search" role="search">
    <label class="vh" for="q">بحث موحَّد</label>
    <input id="q" name="q" type="search" placeholder="ابحث: اسم، جوال، معرّف تلغرام، رقم طلب…"
           autocomplete="off" aria-controls="search-results">
    <button type="submit">بحث</button>
  </form>
  <div class="who">
    <span>${escapeHtml(options.user.fullName ?? "مسؤول")}</span>
    <form method="post" action="/admin/logout">
      <input type="hidden" name="csrf" value="${escapeHtml(options.csrfToken)}">
      <button class="ghost" type="submit">خروج</button>
    </form>
  </div>
</header>
<nav class="nav" aria-label="أقسام اللوحة">${nav}</nav>
<section id="search-results" class="search-results" aria-live="polite" aria-label="نتائج البحث" tabindex="-1" hidden></section>
<main id="main" tabindex="-1">
${notice}
${options.freshness === undefined ? "" : freshnessBlock(options.freshness)}
${options.body}
</main>
<noscript><p class="noscript">البحثُ الموحَّدُ ونوافذُ تأكيدِ الأفعالِ الخطرةِ تحتاجُ جافاسكربت؛ الصفحاتُ والنماذجُ تعملُ بدونه، والخادمُ يتحقّقُ من كلِّ فعلٍ في الحالتين.</p></noscript>
<script nonce="${escapeHtml(options.cspNonce)}">${SHELL_SCRIPT}</script>
</body>
</html>`;
}

/**
 * الحالاتُ السبعُ (المصدرُ الكانونيُّ §5) — لا تُخلط: لكلٍّ رسمٌ ونصٌّ وسبب.
 * الرسمُ زخرفٌ مخفيٌّ عن قارئِ الشاشة، والمعنى في النصِّ دائماً لا في اللون.
 */
export type StateKind =
  | "loading"
  | "empty"
  | "error"
  | "refused"
  | "unavailable"
  | "stale"
  | "unknown";

export const STATE_META: Readonly<
  Record<StateKind, { readonly glyph: string; readonly label: string }>
> = {
  loading: { glyph: "…", label: "جارٍ التحميل" },
  empty: { glyph: "○", label: "لا شيء هنا" },
  error: { glyph: "!", label: "خطأ" },
  refused: { glyph: "⊘", label: "مرفوض" },
  unavailable: { glyph: "⏸", label: "غير متاح" },
  stale: { glyph: "⏱", label: "قراءة قديمة" },
  unknown: { glyph: "?", label: "غير معروف" },
};

/** كتلةُ حالةٍ كاملة: رسمٌ + اسمُ الحالة + سببٌ + فعلٌ اختياريّ. */
export function stateBlock(
  kind: StateKind,
  reason: string,
  action?: { readonly href: string; readonly label: string },
  extraClass?: string,
): string {
  const meta = STATE_META[kind];
  const role = kind === "error" || kind === "refused" ? ' role="alert"' : "";
  const link =
    action === undefined
      ? ""
      : ` <a class="state-action" href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>`;
  return `<div class="state state--${kind}${extraClass === undefined ? "" : ` ${escapeHtml(extraClass)}`}" data-state="${kind}"${role}>
<span class="state-glyph" aria-hidden="true">${meta.glyph}</span>
<p class="state-body"><strong class="state-label">${escapeHtml(meta.label)}</strong> <span class="state-reason">${escapeHtml(reason)}</span>${link}</p>
</div>`;
}

/** بطاقة رقم واحد في شبكة المؤشرات. */
export function metricCard(label: string, value: string, hint?: string): string {
  return `<div class="card">
  <div class="card-label">${escapeHtml(label)}</div>
  <div class="card-value">${escapeHtml(value)}</div>
  ${hint === undefined ? "" : `<div class="card-hint">${escapeHtml(hint)}</div>`}
</div>`;
}

export type BadgeTone = "ok" | "warn" | "bad" | "muted";

export function badge(text: string, tone: BadgeTone): string {
  return `<span class="badge badge--${tone}">${escapeHtml(text)}</span>`;
}

export interface TableOptions {
  readonly headers: readonly string[];
  /** كل خلية HTML جاهز: المُتصِل مسؤول عن الهروب، وأدوات الهروب فوق. */
  readonly rows: readonly (readonly string[])[];
  readonly emptyText: string;
  /** عنوانٌ للجدول يقرؤه قارئُ الشاشة (مخفيٌّ بصرياً). */
  readonly caption?: string;
}

export function table(options: TableOptions): string {
  if (options.rows.length === 0) {
    return stateBlock("empty", options.emptyText);
  }
  // عمودٌ بلا عنوانٍ مرئيٍّ (عمودُ الأفعال) يبقى له اسمٌ يُقرأ.
  const head = options.headers
    .map((h) =>
      h === ""
        ? '<th scope="col"><span class="vh">الإجراء</span></th>'
        : `<th scope="col">${escapeHtml(h)}</th>`,
    )
    .join("");
  const body = options.rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
    .join("");
  const caption =
    options.caption === undefined
      ? ""
      : `<caption class="vh">${escapeHtml(options.caption)}</caption>`;
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="${escapeHtml(
    options.caption ?? "جدول",
  )}"><table>${caption}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function section(title: string, body: string, note?: string): string {
  return `<section class="block">
  <h2>${escapeHtml(title)}</h2>
  ${note === undefined ? "" : `<p class="note">${escapeHtml(note)}</p>`}
  ${body}
</section>`;
}

/**
 * ورقةُ الأنماطِ الوحيدةُ للوحة (UI-6 / PR 9 · ADR 0240). رموزُ الهويةِ من المصدرِ
 * الكانونيّ §2 (الطبقةُ الثانية، قيمُ الداكن) وسلّمُ الطباعةِ من §3. خصائصُ منطقيةٌ
 * فقط (inline/block) فتصحُّ الاتجاهاتُ دون نسخةٍ ثانية؛ لا `@layer` ولا تداخلَ ولا
 * `!important`. والحركةُ الوحيدةُ (الانتقالاتُ) محصورةٌ في `prefers-reduced-motion:
 * no-preference`؛ وكشفُ شريطِ القِدَمِ ليس حركةً بل تبديلُ ظهورٍ بلا مدّة.
 */
export const STYLE = `
:root{--bg:#0f1115;--panel:#171a21;--panel-2:#12141a;--field:#0d0f14;--line:#2c3242;
--text:#e7e9ee;--muted:#a7afbd;--brand:#8b90ff;--amber:#f5b23e;--ok:#34d399;--bad:#ef5350;
--on-solid:#0f1115;--focus:#8b90ff;
--fs-display:1.75rem;--fs-title:1.375rem;--fs-heading:1.0625rem;--fs-body:.9375rem;
--fs-label:.8125rem;--fs-caption:.75rem}
*{box-sizing:border-box}
html{color-scheme:dark}
body{margin:0;background:var(--bg);color:var(--text);
font-family:-apple-system,BlinkMacSystemFont,"SF Arabic","Segoe UI","Noto Sans Arabic",Roboto,system-ui,Tahoma,sans-serif;
font-size:var(--fs-body);line-height:1.6;font-variant-numeric:tabular-nums lining-nums}
a{color:var(--brand);text-decoration:none}
a:hover{text-decoration:underline}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.vh{position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.skip{position:absolute;inset-inline-start:12px;inset-block-start:-48px;padding:8px 14px;border-radius:8px;
background:var(--brand);color:var(--on-solid);font-weight:700;z-index:10}
.skip:focus{inset-block-start:8px}
.top{display:flex;gap:16px;align-items:center;padding-block:10px;padding-inline:18px;background:var(--panel);
border-block-end:1px solid var(--line);flex-wrap:wrap}
.brand{font-weight:800;white-space:nowrap}
.search{display:flex;gap:6px;flex:1;min-inline-size:240px;margin:0}
.search input{flex:1;padding-block:7px;padding-inline:10px;border-radius:6px;border:1px solid var(--line);
background:var(--field);color:var(--text);font:inherit}
.who{display:flex;gap:10px;align-items:center;color:var(--muted);white-space:nowrap}
.who form{margin:0}
button{min-block-size:36px;padding-block:7px;padding-inline:12px;border-radius:6px;border:1px solid var(--brand);
background:var(--brand);color:var(--on-solid);cursor:pointer;font-family:inherit;font-size:var(--fs-label);font-weight:600}
button.ghost{background:transparent;color:var(--text);border-color:var(--line)}
button.danger{background:transparent;color:var(--bad);border-color:var(--bad)}
button.danger--solid{background:var(--bad);color:var(--on-solid);border-color:var(--bad)}
button:hover{filter:brightness(1.1)}
.nav{display:flex;gap:4px;padding-block:8px;padding-inline:18px;background:var(--panel-2);
border-block-end:1px solid var(--line);flex-wrap:wrap}
.nav-link{padding-block:6px;padding-inline:12px;border-radius:6px;color:var(--muted)}
.nav-link.is-active{background:var(--panel);color:var(--text);font-weight:700;
box-shadow:inset 0 -2px 0 var(--brand)}
main{padding:18px;max-inline-size:1400px;margin-inline:auto}
main:focus{outline:none}
h1{font-size:var(--fs-title);line-height:1.95rem;font-weight:800;margin-block:0 6px}
h2{font-size:var(--fs-heading);line-height:1.65rem;font-weight:700;margin-block:0 10px}
h3{font-size:var(--fs-body);font-weight:700;margin-block:12px 6px}
.block{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;margin-block-end:16px}
.note,.help-text{color:var(--muted);margin-block:0 10px;font-size:var(--fs-label);line-height:1.6}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
.cards--spaced{margin-block-end:16px}
.card{background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:12px}
.card-label{color:var(--muted);font-size:var(--fs-label)}
.card-value{font-size:var(--fs-display);line-height:2.2rem;font-weight:800;margin-block-start:2px}
.card-hint{color:var(--muted);font-size:var(--fs-caption);margin-block-start:4px}
.card-header{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-block-end:8px}
.card-title{font-weight:700}
.table-wrap{overflow-x:auto}
table{inline-size:100%;border-collapse:collapse;font-size:var(--fs-label)}
th,td{text-align:start;padding-block:8px;padding-inline:10px;border-block-end:1px solid var(--line);vertical-align:middle}
th{color:var(--muted);font-weight:600;white-space:nowrap}
tbody tr:hover{background:var(--panel-2)}
.badge{display:inline-block;padding-block:2px;padding-inline:8px;border-radius:999px;font-size:var(--fs-caption);
font-weight:600;border:1px solid transparent}
.badge--ok{background:rgba(52,211,153,.12);color:var(--ok);border-color:rgba(52,211,153,.45)}
.badge--warn{background:rgba(245,178,62,.12);color:var(--amber);border-color:rgba(245,178,62,.45)}
.badge--bad{background:rgba(239,83,80,.12);color:#ff8a87;border-color:rgba(239,83,80,.5)}
.badge--muted{background:var(--panel-2);color:var(--muted);border-color:var(--line)}
.state{display:flex;gap:10px;align-items:flex-start;padding-block:10px;padding-inline:12px;border-radius:8px;
border:1px solid var(--line);background:var(--panel-2);margin-block:6px}
.state-glyph{flex:none;inline-size:24px;block-size:24px;border-radius:999px;display:inline-flex;align-items:center;
justify-content:center;font-weight:800;border:1px solid currentColor;color:var(--muted)}
.state-body{margin:0}
.state-label{color:var(--text)}
.state-reason{color:var(--muted)}
.state-action{margin-inline-start:6px;font-weight:600}
.state--error,.state--refused{border-color:rgba(239,83,80,.5)}
.state--error .state-glyph,.state--refused .state-glyph{color:#ff8a87}
.state--stale,.state--unavailable{border-color:rgba(245,178,62,.45)}
.state--stale .state-glyph,.state--unavailable .state-glyph{color:var(--amber)}
.freshness{margin-block-end:14px}
.freshness-line{color:var(--muted);font-size:var(--fs-label);margin:0}
.stale-reveal{visibility:hidden;animation-name:stale-reveal;animation-duration:0s;animation-fill-mode:forwards}
@keyframes stale-reveal{to{visibility:visible}}
.map-canvas{inline-size:100%;border-radius:8px;border:1px solid var(--line);background:var(--field)}
.maplibregl-popup-content{background:var(--panel);color:var(--text);font-family:inherit}
.empty{color:var(--muted);margin:0;padding-block:12px}
.notice{padding-block:10px;padding-inline:14px;border-radius:8px;margin-block-end:14px}
.notice--ok{background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.45)}
.notice--error{background:rgba(239,83,80,.12);border:1px solid rgba(239,83,80,.5)}
.filters{display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-block-end:12px}
.filters label,.city-picker label{display:flex;flex-direction:column;gap:4px;color:var(--muted);font-size:var(--fs-label)}
.filters select,.filters input,.city-picker select,.recovery-form select{padding-block:6px;padding-inline:9px;border-radius:6px;
border:1px solid var(--line);background:var(--field);color:var(--text);font-family:inherit}
.pay-status-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-block-end:12px}
.city-picker{display:flex;gap:8px;align-items:center}
form.inline{display:inline-flex;gap:6px;align-items:center;margin:0}
form.inline input[type=text],form.inline input[type=number]{padding-block:5px;padding-inline:8px;border-radius:6px;
border:1px solid var(--line);background:var(--field);color:var(--text);min-inline-size:110px;font-family:inherit}
.search-results{margin-block:0;margin-inline:18px;background:var(--panel);border:1px solid var(--line);
border-radius:10px;padding:12px}
.search-results:focus{outline:2px solid var(--focus)}
.search-detail{color:var(--muted)}
.grid-map{display:grid;gap:2px}
.cell{aspect-ratio:1;border-radius:3px;display:flex;align-items:center;justify-content:center;
font-size:11px;color:var(--on-solid);font-weight:700}
.legend{display:flex;gap:12px;align-items:center;color:var(--muted);font-size:var(--fs-label);margin-block-start:10px;flex-wrap:wrap}
.swatch{inline-size:16px;block-size:16px;border-radius:3px;display:inline-block;vertical-align:-3px;margin-inline-end:4px}
.swatch--short{background:hsl(0 62% 40%)}
.swatch--enough{background:hsl(146 48% 40%)}
.swatch--none{background:#1c202a}
.login{max-inline-size:380px;margin-block:8vh;margin-inline:auto;background:var(--panel);border:1px solid var(--line);
border-radius:12px;padding:22px}
.login label{display:block;color:var(--muted);font-size:var(--fs-label)}
.login input{inline-size:100%;padding-block:9px;padding-inline:11px;margin-block:6px 12px;border-radius:6px;
border:1px solid var(--line);background:var(--field);color:var(--text);font-family:inherit;font-size:var(--fs-body)}
.login button{inline-size:100%}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:var(--fs-label)}
.mono--wrap{word-break:break-all}
textarea{inline-size:100%;min-block-size:150px;padding:10px;border-radius:8px;border:1px solid var(--line);
background:var(--field);color:var(--text);font-family:inherit;font-size:var(--fs-body);line-height:1.7;resize:vertical}
.stack{display:flex;flex-direction:column;gap:4px;margin-block-end:12px;color:var(--muted);font-size:var(--fs-label)}
.stack>span{color:var(--text)}
.optionset{display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-block:4px 12px}
.optionset label{display:inline-flex;gap:6px;align-items:center;color:var(--text);font-size:var(--fs-label)}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-block:8px}
.chip{padding-block:4px;padding-inline:10px;border-radius:999px;border:1px solid var(--line);background:var(--panel-2);
color:var(--text);font-size:16px;cursor:pointer;line-height:1}
.chip:hover{border-color:var(--brand)}
.progress{display:block;inline-size:100%;min-inline-size:120px;block-size:8px;accent-color:var(--ok)}
.preview{white-space:pre-wrap;background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:12px;margin:0}
.danger-zone{border-color:rgba(239,83,80,.5)}
.danger-zone h2{color:#ff8a87}
.recovery-list{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}
.recovery-meta{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:0 0 10px}
.recovery-meta dt{color:var(--muted)}
.recovery-meta dd{margin:0}
.recovery-evidence p{white-space:pre-wrap;margin-block:4px 10px}
.recovery-form{display:flex;gap:10px;flex-wrap:wrap;align-items:end}
.recovery-form label{display:flex;flex-direction:column;gap:4px;color:var(--muted);font-size:var(--fs-label)}
.stack input{inline-size:min(100%,420px);padding-block:8px;padding-inline:10px;border-radius:6px;border:1px solid var(--line);
background:var(--field);color:var(--text);font-family:inherit;font-size:var(--fs-body)}
.stack label{color:var(--muted)}
.noscript{margin:18px;color:var(--muted);font-size:var(--fs-label)}
.tg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
.tg-card{background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:12px;
display:flex;flex-direction:column;gap:6px}
.tg-card--delivery{border-color:#d4a72c;box-shadow:inset 4px 0 0 #e8c547}
.tg-card--transport{border-color:#2f9e63;box-shadow:inset 4px 0 0 #3fbf7a}
.tg-head{display:flex;justify-content:space-between;gap:8px;align-items:center}
.tg-chat{background:#0e1621;border-radius:10px;padding:10px;flex:1}
.tg-bubble{background:#182533;color:#f5f5f5;border-radius:12px 12px 12px 4px;padding-block:9px;padding-inline:12px;
white-space:pre-wrap;word-break:break-word;font-size:var(--fs-label);line-height:1.55}
.tg-photo{background:#22303f;border-radius:8px;padding:18px;text-align:center;margin-block-end:6px;color:var(--muted)}
.tg-inline,.tg-reply{margin-block-start:4px;display:flex;flex-direction:column;gap:4px}
.tg-row{display:flex;gap:4px}
.tg-btn{flex:1;text-align:center;background:rgba(43,82,120,.55);color:#fff;border-radius:8px;
padding-block:7px;padding-inline:6px;font-size:var(--fs-label)}
.tg-key{flex:1;text-align:center;background:#232e3c;color:#fff;border-radius:6px;padding-block:8px;padding-inline:6px;font-size:var(--fs-label)}
.tg-foot{display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap}
.tg-foot .mono{color:var(--muted);font-size:11px;word-break:break-all}
.tg-details{margin-block-end:10px}
.tg-details summary{cursor:pointer;font-weight:600;padding-block:6px}
@media (max-width:720px){
.top{padding-inline:12px;gap:10px}
.search{min-inline-size:100%;order:3}
.nav{flex-wrap:nowrap;overflow-x:auto;padding-inline:12px}
.nav-link{white-space:nowrap}
main{padding:12px}
.search-results{margin-inline:12px}
.cards{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}
.recovery-list,.tg-grid{grid-template-columns:1fr}
}
@media (prefers-reduced-motion:no-preference){
button,.nav-link,.chip{transition:filter .12s ease,background-color .12s ease,border-color .12s ease}
}
`;

/**
 * نصُّ الهيكلِ الوحيد: تحسينٌ تدريجيٌّ لا شرط. بلا مؤقّتٍ ولا استقصاء — كلُّ طلبِ
 * شبكةٍ هنا بيدِ المسؤول (زرُّ البحث). ثلاثةُ أدوار:
 *
 * ١. **البحثُ الموحَّد** بحالاتِه السبع: تحميلٌ، فراغٌ، خطأٌ، رفضٌ (جلسةٌ منتهية/صلاحية/
 *    حدُّ معدّل)، عدمُ إتاحة (503 أو انقطاع)، وردٌّ غيرُ مفهومٍ يُقال مجهولاً. لا تُعرض
 *    «لا نتيجة» إلا لردٍّ ناجحٍ فارغٍ فعلاً: الانقطاعُ ليس فراغاً.
 * ٢. **تأكيدُ الأفعالِ الخطرة** (`data-confirm` على النموذج أو زرِّ الإرسال): نيّةٌ
 *    صريحةٌ قبل فعلٍ لا يُسترجَع بنقرةٍ عابرة. ومنعُ الإرسالِ المزدوجِ للنموذجِ نفسِه.
 *    الخادمُ يبقى الحَكَم: CSRF والصلاحيةُ والتحقّقُ هناك، وهذا لا يُضعف منها شيئاً.
 * ٣. **مُنتقي المدينة** (`data-nav-param`) كما كان.
 *
 * والربطُ بالمستند لا بسماتِ الأحداث: سياسةُ أمن المحتوى (المرحلة ١٠) لا تُجيزها.
 */
const SHELL_SCRIPT = `
(function(){
var GLYPH={loading:'…',empty:'○',error:'!',refused:'⊘',unavailable:'⏸',stale:'⏱',unknown:'?'};
var LABEL={loading:'جارٍ البحث',empty:'لا نتيجة',error:'تعذّر البحث',refused:'مرفوض',unavailable:'غير متاح',unknown:'ردٌّ غير مفهوم'};
function esc(v){
  return String(v).replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
var CLOSE='<button type="button" class="ghost" data-close-search="1">إغلاق النتائج</button>';
function box(){return document.getElementById('search-results');}
function showState(kind,reason,action){
  var el=box();if(!el)return;
  el.innerHTML='<div class="state state--'+kind+'" data-state="'+kind+'"'+((kind==='error'||kind==='refused')?' role="alert"':'')+'>'
    +'<span class="state-glyph" aria-hidden="true">'+GLYPH[kind]+'</span>'
    +'<p class="state-body"><strong class="state-label">'+esc(LABEL[kind])+'</strong> <span class="state-reason">'+esc(reason)+'</span>'
    +(action||'')+'</p></div>'+(kind==='loading'?'':CLOSE);
}
function closeResults(){
  var el=box();if(!el)return;
  el.hidden=true;el.innerHTML='';el.removeAttribute('aria-busy');
  var q=document.getElementById('q');if(q)q.focus();
}
async function search(q){
  var el=box();if(!el)return;
  el.hidden=false;el.setAttribute('aria-busy','true');
  showState('loading','يُسأل الخادم عن «'+q+'»…');
  var res;
  try{
    res=await fetch('/admin/api/search?q='+encodeURIComponent(q),{credentials:'same-origin',headers:{accept:'application/json'}});
  }catch(e){
    showState('unavailable','لا اتصال بالخادم — لم تُقرأ نتيجة، وهذا لا يعني أنه لا نتيجة.');
    el.removeAttribute('aria-busy');el.focus();return;
  }
  if(res.status===401||res.status===403||res.redirected){
    showState('refused','الجلسة منتهية أو لا صلاحية لهذا البحث.',' <a class="state-action" href="/admin/login">الدخول من جديد</a>');
  }else if(res.status===429){
    showState('refused','طلبات بحث كثيرة في وقت قصير — انتظر قليلاً ثم أعد المحاولة.');
  }else if(res.status===503){
    showState('unavailable','الخادم أبلغ أن البحث غير متاح الآن (503).');
  }else if(!res.ok){
    showState('error','ردّ الخادم برمز '+res.status+'.');
  }else{
    var data=null;
    try{data=await res.json();}catch(e){data=null;}
    if(!data||!Array.isArray(data.groups)){
      showState('unknown','وصل ردٌّ لا يُعرف شكله — لا يُعرض منه شيء.');
    }else if(data.groups.length===0){
      showState('empty','لا نتيجة لـ «'+q+'».');
    }else{
      var html='<h2>نتائج «'+esc(q)+'»</h2>';
      for(var g of data.groups){
        html+='<h3>'+esc(g.title)+'</h3><ul>';
        for(var it of g.items){
          html+='<li><a href="'+esc(it.href)+'">'+esc(it.label)+'</a> '
              +'<span class="search-detail">'+esc(it.detail)+'</span></li>';
        }
        html+='</ul>';
      }
      el.innerHTML=html+CLOSE;
    }
  }
  el.removeAttribute('aria-busy');el.focus();
}
document.addEventListener('submit',function(ev){
  var form=ev.target;
  if(!form||!form.getAttribute)return;
  if(form.id==='search-form'){
    ev.preventDefault();
    var input=document.getElementById('q');
    var q=input?input.value.trim():'';
    if(q===''){closeResults();return;}
    search(q);
    return;
  }
  var sub=ev.submitter;
  var message=(sub&&sub.getAttribute&&sub.getAttribute('data-confirm'))||form.getAttribute('data-confirm');
  if(message&&!window.confirm(message)){ev.preventDefault();return;}
  if(form.getAttribute('data-submitting')==='1'){ev.preventDefault();return;}
  if((form.getAttribute('method')||'').toLowerCase()==='post')form.setAttribute('data-submitting','1');
});
document.addEventListener('click',function(ev){
  var el=ev.target;
  if(!el||!el.closest)return;
  if(!el.closest('[data-close-search]'))return;
  ev.preventDefault();
  closeResults();
});
document.addEventListener('keydown',function(ev){
  if(ev.key!=='Escape')return;
  var el=box();
  if(el&&!el.hidden)closeResults();
});
// عودةٌ بزرِّ الرجوع (ذاكرةُ الصفحة): النموذجُ لم يعد قيدَ الإرسال.
window.addEventListener('pageshow',function(){
  var forms=document.querySelectorAll('form[data-submitting]');
  for(var i=0;i<forms.length;i++)forms[i].removeAttribute('data-submitting');
});
document.addEventListener('change',function(ev){
  var el=ev.target;
  if(!el||!el.getAttribute)return;
  var param=el.getAttribute('data-nav-param');
  if(!param)return;
  window.location.href='?'+encodeURIComponent(param)+'='+encodeURIComponent(el.value);
});
})();
`;
