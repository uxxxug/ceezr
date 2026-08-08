/**
 * الغرض: هيكل صفحات اللوحة المشترك: الترويسة، التنقّل بين الصفحات الثماني،
 *   البحث الموحَّد، وأدوات بناء HTML آمنة (هروب إلزامي لكل قيمة قادمة من القاعدة).
 * الحالة: منفّذ فعلياً — المرحلة 2.7 (القسم د.1).
 * ينتمي إلى: apps/admin-dashboard
 * يُتوقع أن يستخدمه لاحقاً: كل صفحة، وapps/gateway/src/routes/admin-ui.ts
 * ملاحظات مستقبلية: لا مُجمِّع ولا إطار واجهة عمداً (ADR 0007) — عند الحاجة إلى
 *   تفاعل أعمق يُضاف ملف JS مستقل، لا خطوة بناء.
 */

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

/** الصفحات الثماني بترتيب استخدامها التشغيلي لا بترتيب بنائها. */
export const NAV_ITEMS: readonly NavItem[] = [
  { path: "/admin", label: "نظرة عامة" },
  { path: "/admin/live-orders", label: "الطلبات الحية" },
  { path: "/admin/drivers", label: "السائقون" },
  { path: "/admin/heatmap", label: "خريطة الطلب والعرض" },
  { path: "/admin/disputes", label: "النزاعات" },
  { path: "/admin/ratings", label: "التقييمات" },
  { path: "/admin/attendance", label: "الحضور" },
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
}

export function renderShell(options: ShellOptions): string {
  const nav = NAV_ITEMS.map((item) => {
    const isActive = item.path === options.activePath;
    return `<a class="nav-link${isActive ? " is-active" : ""}" href="${escapeHtml(item.path)}"${
      isActive ? ' aria-current="page"' : ""
    }>${escapeHtml(item.label)}</a>`;
  }).join("");

  const notice =
    options.notice === undefined
      ? ""
      : `<div class="notice notice--${options.notice.kind}" role="status">${escapeHtml(
          options.notice.text,
        )}</div>`;

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(options.title)} — لوحة وَصْلة</title>
<style>${STYLE}</style>
</head>
<body>
<header class="top">
  <div class="brand">وَصْلة · لوحة الإدارة</div>
  <form class="search" role="search" onsubmit="return waslahSearch(event)">
    <input id="q" name="q" type="search" placeholder="ابحث: اسم، جوال، معرّف تلغرام، رقم طلب…"
           autocomplete="off" aria-label="بحث موحَّد">
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
<nav class="nav">${nav}</nav>
<div id="search-results" class="search-results" hidden></div>
<main>
${notice}
${options.body}
</main>
<script>${SEARCH_SCRIPT}</script>
</body>
</html>`;
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
}

export function table(options: TableOptions): string {
  if (options.rows.length === 0) {
    return `<p class="empty">${escapeHtml(options.emptyText)}</p>`;
  }
  const head = options.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const body = options.rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
    .join("");
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function section(title: string, body: string, note?: string): string {
  return `<section class="block">
  <h2>${escapeHtml(title)}</h2>
  ${note === undefined ? "" : `<p class="note">${escapeHtml(note)}</p>`}
  ${body}
</section>`;
}

const STYLE = `
:root{--bg:#0f1115;--panel:#171a21;--line:#262b36;--text:#e7e9ee;--muted:#9aa3b2;
--ok:#2f9e63;--warn:#c8901f;--bad:#c04a4a;--accent:#3f7cc4}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
font-family:"Segoe UI",Tahoma,"Noto Naskh Arabic",sans-serif;font-size:15px;line-height:1.6}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.top{display:flex;gap:16px;align-items:center;padding:10px 18px;background:var(--panel);
border-bottom:1px solid var(--line);flex-wrap:wrap}
.brand{font-weight:700;white-space:nowrap}
.search{display:flex;gap:6px;flex:1;min-width:240px}
.search input{flex:1;padding:7px 10px;border-radius:6px;border:1px solid var(--line);
background:#0d0f14;color:var(--text)}
.who{display:flex;gap:10px;align-items:center;color:var(--muted);white-space:nowrap}
.who form{margin:0}
button{padding:7px 12px;border-radius:6px;border:1px solid var(--line);background:var(--accent);
color:#fff;cursor:pointer;font-family:inherit;font-size:14px}
button.ghost{background:transparent;color:var(--muted)}
button:hover{filter:brightness(1.1)}
.nav{display:flex;gap:4px;padding:8px 18px;background:#12141a;border-bottom:1px solid var(--line);
flex-wrap:wrap}
.nav-link{padding:6px 12px;border-radius:6px;color:var(--muted)}
.nav-link.is-active{background:var(--panel);color:var(--text);font-weight:600}
main{padding:18px;max-width:1400px;margin:0 auto}
h1{font-size:21px;margin:0 0 4px}
h2{font-size:17px;margin:0 0 10px}
.block{background:var(--panel);border:1px solid var(--line);border-radius:10px;
padding:16px;margin-bottom:16px}
.note{color:var(--muted);margin:0 0 10px;font-size:13px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
.card{background:#12141a;border:1px solid var(--line);border-radius:8px;padding:12px}
.card-label{color:var(--muted);font-size:13px}
.card-value{font-size:24px;font-weight:700;margin-top:2px}
.card-hint{color:var(--muted);font-size:12px;margin-top:4px}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:right;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
th{color:var(--muted);font-weight:600;white-space:nowrap}
tbody tr:hover{background:#12141a}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;
border:1px solid transparent}
.badge--ok{background:rgba(47,158,99,.15);color:#6cd39a;border-color:rgba(47,158,99,.4)}
.badge--warn{background:rgba(200,144,31,.15);color:#e0b45c;border-color:rgba(200,144,31,.4)}
.badge--bad{background:rgba(192,74,74,.15);color:#e08a8a;border-color:rgba(192,74,74,.4)}
.badge--muted{background:#1c202a;color:var(--muted);border-color:var(--line)}
.empty{color:var(--muted);margin:0;padding:12px 0}
.notice{padding:10px 14px;border-radius:8px;margin-bottom:14px}
.notice--ok{background:rgba(47,158,99,.15);border:1px solid rgba(47,158,99,.4)}
.notice--error{background:rgba(192,74,74,.15);border:1px solid rgba(192,74,74,.4)}
.filters{display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:12px}
.filters label{display:flex;flex-direction:column;gap:4px;color:var(--muted);font-size:13px}
.filters select,.filters input{padding:6px 9px;border-radius:6px;border:1px solid var(--line);
background:#0d0f14;color:var(--text);font-family:inherit}
form.inline{display:inline-flex;gap:6px;align-items:center;margin:0}
form.inline input[type=text],form.inline input[type=number]{padding:5px 8px;border-radius:6px;
border:1px solid var(--line);background:#0d0f14;color:var(--text);min-width:110px;font-family:inherit}
.search-results{position:relative;margin:0 18px;background:var(--panel);border:1px solid var(--line);
border-radius:10px;padding:12px}
.grid-map{display:grid;gap:2px}
.cell{aspect-ratio:1;border-radius:3px;display:flex;align-items:center;justify-content:center;
font-size:11px;color:#0c0e12;font-weight:700}
.legend{display:flex;gap:12px;align-items:center;color:var(--muted);font-size:13px;margin-top:10px}
.swatch{width:16px;height:16px;border-radius:3px;display:inline-block;vertical-align:-3px;
margin-left:4px}
.login{max-width:380px;margin:8vh auto;background:var(--panel);border:1px solid var(--line);
border-radius:12px;padding:22px}
.login input{width:100%;padding:9px 11px;margin:6px 0 12px;border-radius:6px;
border:1px solid var(--line);background:#0d0f14;color:var(--text);font-family:inherit}
.login button{width:100%}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
`;

/**
 * البحث الموحَّد: نداء واحد إلى ‎/admin/api/search‎ وعرض النتائج فوق الصفحة الحالية.
 * لا يُغادر المشغّل صفحته ليبحث، ولا تُبنى صفحة نتائج تاسعة لا يزورها إلا عابراً.
 */
const SEARCH_SCRIPT = `
async function waslahSearch(event){
  event.preventDefault();
  var box=document.getElementById('search-results');
  var q=document.getElementById('q').value.trim();
  if(q===''){box.hidden=true;box.innerHTML='';return false;}
  box.hidden=false;box.textContent='جارٍ البحث…';
  try{
    var res=await fetch('/admin/api/search?q='+encodeURIComponent(q),{credentials:'same-origin'});
    if(!res.ok){box.textContent='تعذّر البحث ('+res.status+')';return false;}
    var data=await res.json();
    if(data.groups.length===0){box.textContent='لا نتيجة لـ «'+q+'»';return false;}
    var html='<h2>نتائج «'+escapeText(q)+'»</h2>';
    for(var g of data.groups){
      html+='<h3>'+escapeText(g.title)+'</h3><ul>';
      for(var it of g.items){
        html+='<li><a href="'+escapeText(it.href)+'">'+escapeText(it.label)+'</a> '
            +'<span style="color:#9aa3b2">'+escapeText(it.detail)+'</span></li>';
      }
      html+='</ul>';
    }
    html+='<button class="ghost" onclick="document.getElementById(\\'search-results\\').hidden=true">إغلاق</button>';
    box.innerHTML=html;
  }catch(e){box.textContent='تعذّر البحث: '+e;}
  return false;
}
function escapeText(v){
  return String(v).replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
`;
