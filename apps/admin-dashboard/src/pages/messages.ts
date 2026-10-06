/**
 * الغرض: صفحة «معرض الرسائل» — كلُّ ما يُرسِلُه النظامُ في تيليجرام لطالبِ الخدمةِ والسائقِ
 *   والقروباتِ الثلاثةِ، معروضاً كفقاعةِ تيليجرام بأزرارِها، مع «أرسلها لي» لكلِّ عيّنةٍ،
 *   ثمّ القاموسُ الكاملُ مجمّعاً بالجمهورِ (`ADM-MSG-01`).
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/admin-dashboard/pages
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/admin-ui.ts
 * ملاحظات: الصفحةُ عرضٌ محضٌ كسائرِ الحزمةِ — العيّناتُ تُبنى في البوّابةِ من الناشراتِ
 *   الحقيقيّةِ وتصلُ ههنا بياناتٍ جاهزةً.
 */

import { escapeHtml, section } from "../layout.ts";

export interface MessagesPageSpecimen {
  readonly id: string;
  readonly audience: string;
  readonly bot: "rider" | "driver";
  readonly title: string;
  readonly when: string;
  readonly source: string;
  readonly text: string;
  readonly markup: unknown;
  readonly photo?: true;
  readonly service?: "delivery" | "transport";
}

export interface MessagesPageData {
  readonly audiences: readonly { readonly id: string; readonly label: string }[];
  readonly specimens: readonly MessagesPageSpecimen[];
  readonly catalog: readonly {
    readonly label: string;
    readonly entries: readonly { readonly key: string; readonly text: string }[];
  }[];
  readonly csrfToken: string;
  /** هل الإرسالُ إلى محادثةِ المسؤولِ مُهيَّأٌ (رمزا البوتينِ موجودانِ)؟ */
  readonly canSend: boolean;
}

interface Button {
  readonly text?: unknown;
  readonly url?: unknown;
  readonly web_app?: { readonly url?: unknown };
  readonly callback_data?: unknown;
}

/** يقرأُ `reply_markup` كما يُرسَلُ لتيليجرام ويُصيِّرُه أزراراً — بلا افتراضٍ على شكلِه. */
function renderMarkup(markup: unknown): string {
  if (markup === null || typeof markup !== "object") return "";
  const value = markup as {
    readonly inline_keyboard?: readonly (readonly Button[])[];
    readonly keyboard?: readonly (readonly (Button | string)[])[];
  };
  if (Array.isArray(value.inline_keyboard)) {
    const rows = value.inline_keyboard
      .map((row) => {
        const cells = row
          .map((button: Button) => {
            const kind =
              button.web_app !== undefined ? "تطبيق" : button.url !== undefined ? "رابط" : "زر";
            const target = button.web_app?.url ?? button.url ?? button.callback_data ?? "";
            return `<span class="tg-btn" title="${escapeHtml(`${kind}: ${String(target)}`)}">${escapeHtml(
              button.text,
            )}${kind === "زر" ? "" : " ↗"}</span>`;
          })
          .join("");
        return `<div class="tg-row">${cells}</div>`;
      })
      .join("");
    return `<div class="tg-inline">${rows}</div>`;
  }
  if (Array.isArray(value.keyboard)) {
    const rows = value.keyboard
      .map(
        (row) =>
          `<div class="tg-row">${row
            .map(
              (b: Button | string) =>
                `<span class="tg-key">${escapeHtml(typeof b === "string" ? b : b.text)}</span>`,
            )
            .join("")}</div>`,
      )
      .join("");
    return `<div class="tg-reply"><p class="note">لوحة أسفل الشاشة:</p>${rows}</div>`;
  }
  return "";
}

const BOT_LABEL = { rider: "بوت الراكب", driver: "بوت السائق" } as const;

function renderSpecimen(s: MessagesPageSpecimen, data: MessagesPageData): string {
  const send = data.canSend
    ? `<form method="post" action="/admin/messages/${escapeHtml(s.id)}/send" class="inline">
  <input type="hidden" name="csrf" value="${escapeHtml(data.csrfToken)}">
  <button type="submit">أرسلها لي</button>
</form>`
    : "";
  const tone = s.service === undefined ? "" : ` tg-card--${s.service}`;
  return `<article class="tg-card${tone}" id="m-${escapeHtml(s.id)}">
  <header class="tg-head"><strong>${escapeHtml(s.title)}</strong>
  <span class="badge badge--muted">${escapeHtml(BOT_LABEL[s.bot])}</span></header>
  <p class="note">${escapeHtml(s.when)}</p>
  <div class="tg-chat">
    <div class="tg-bubble">${s.photo === true ? '<div class="tg-photo">🖼 صورة مرفقة</div>' : ""}${escapeHtml(s.text)}</div>
    ${renderMarkup(s.markup)}
  </div>
  <footer class="tg-foot"><span class="mono">${escapeHtml(s.source)}</span>${send}</footer>
</article>`;
}

export function renderMessagesPage(data: MessagesPageData): string {
  const intro =
    `<h1>معرض الرسائل</h1>` +
    section(
      "عن المعرض",
      `<p class="note">${escapeHtml(
        `${data.specimens.length} رسالة مولَّدة من الكود الإنتاجي نفسه ببيانات نموذجية. «أرسلها لي» يرسلها إلى محادثتك الخاصة فقط بالبوت الذي يرسلها في الواقع؛ رسائل القروبات تصلك كما تظهر في القروب. الأزرار تحمل معرّفات وهمية فلا يغيّر ضغطها شيئاً.`,
      )}</p>
<nav class="chips">${data.audiences
        .map((a) => `<a class="chip" href="#aud-${escapeHtml(a.id)}">${escapeHtml(a.label)}</a>`)
        .join("")}<a class="chip" href="#catalog">القاموس الكامل</a></nav>`,
    );
  const groups = data.audiences
    .map((audience) => {
      const items = data.specimens.filter((s) => s.audience === audience.id);
      if (items.length === 0) return "";
      return `<div id="aud-${escapeHtml(audience.id)}">${section(
        `${audience.label} (${items.length})`,
        `<div class="tg-grid">${items.map((s) => renderSpecimen(s, data)).join("")}</div>`,
      )}</div>`;
    })
    .join("");
  const total = data.catalog.reduce((sum, g) => sum + g.entries.length, 0);
  const catalog = `<div id="catalog">${section(
    `القاموس الكامل (${total} نصّاً)`,
    data.catalog
      .filter((g) => g.entries.length > 0)
      .map(
        (
          g,
        ) => `<details class="tg-details"><summary>${escapeHtml(g.label)} (${g.entries.length})</summary>
<div class="table-wrap"><table><tbody>${g.entries
          .map(
            (e) =>
              `<tr><td class="mono">${escapeHtml(e.key)}</td><td><div class="preview">${escapeHtml(e.text)}</div></td></tr>`,
          )
          .join("")}</tbody></table></div></details>`,
      )
      .join(""),
    "كل نصوص البوتين كما في ar.json، ومنها خطوات الحوارات (التسجيل، اللغة، الطوارئ، التقييم…) التي لا تُعرض عيّناتٍ أعلاه. {name} وأمثالها تُملأ وقت الإرسال.",
  )}</div>`;
  return intro + groups + catalog;
}
