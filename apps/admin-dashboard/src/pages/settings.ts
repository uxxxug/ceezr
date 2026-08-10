/**
 * الغرض: صفحة الإعدادات: تعديل platform_settings لكل مدينة بلا نشر كود — وهي
 *   الوعد الذي قامت عليه القاعدة 0.3 كلها. بلا هذه الصفحة يبقى تغيير سعر أو وزن
 *   مطابقة عملية يدوية على القاعدة في الإنتاج، وهي بالضبط ما تمنعه القاعدة.
 * الحالة: منفّذ فعلياً — المرحلة 2.7 (القسم د.1).
 * ينتمي إلى: apps/admin-dashboard/pages
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/admin-ui.ts
 * ملاحظات مستقبلية: تاريخ تغيّر كل إعداد موجود في audit_log؛ عرضه صفحةً مستقلة
 *   يُضاف حين يُطلب.
 */

import { formatDateTime } from "../format.ts";
import { badge, escapeHtml, section, table } from "../layout.ts";
import type { CityOption } from "./drivers.ts";

export interface CityGroupStatus extends CityOption {
  readonly isActive?: boolean;
  /** سلاسل لا أرقام كي تبقى دقة bigint كاملة في HTML والنموذج. */
  readonly supportGroupId?: string | null;
  readonly escalationGroupId?: string | null;
  readonly unsubscribedDriversGroupId?: string | null;
}

export interface SettingRow {
  readonly key: string;
  /** القيمة كما هي في القاعدة بصيغة JSON نصّية — تُعرض وتُحرَّر بنفس الصيغة. */
  readonly value: string;
  readonly valueType: string;
  readonly descriptionAr: string;
  readonly isProvisional: boolean;
  readonly updatedAt: string;
}

export interface SettingsPageData {
  readonly cities: readonly CityGroupStatus[];
  readonly cityId: string;
  readonly cityName: string;
  readonly rows: readonly SettingRow[];
  readonly csrfToken: string;
}

const TYPE_LABEL: Readonly<Record<string, string>> = {
  number: "رقم",
  string: "نصّ",
  boolean: "صواب/خطأ",
  array: "قائمة",
};

function cityReadiness(city: CityGroupStatus): { label: string; tone: "ok" | "warn" | "bad" } {
  const complete =
    typeof city.supportGroupId === "string" &&
    typeof city.escalationGroupId === "string" &&
    typeof city.unsubscribedDriversGroupId === "string";
  if (city.isActive && complete) return { label: "مفعّلة وجاهزة", tone: "ok" };
  if (complete) return { label: "القروبات مكتملة؛ المدينة غير مفعّلة", tone: "warn" };
  return { label: "غير جاهزة: حقول قروبات ناقصة", tone: "bad" };
}

function groupValue(value: string | null | undefined): string {
  return value ?? "";
}

export function renderSettingsPage(data: SettingsPageData): string {
  const cityOptions = data.cities
    .map(
      (city) =>
        `<option value="${escapeHtml(city.id)}"${
          data.cityId === city.id ? " selected" : ""
        }>${escapeHtml(city.nameAr)}</option>`,
    )
    .join("");
  const selectedCity = data.cities.find((city) => city.id === data.cityId);
  const selectedReadiness =
    selectedCity === undefined
      ? { label: "المدينة غير موجودة", tone: "bad" as const }
      : cityReadiness(selectedCity);

  const rows = data.rows.map((row) => [
    `<div class="mono">${escapeHtml(row.key)}</div>
     <div class="card-hint">${escapeHtml(row.descriptionAr)}</div>`,
    escapeHtml(TYPE_LABEL[row.valueType] ?? row.valueType),
    `<form class="inline" method="post" action="/admin/settings/${escapeHtml(
      data.cityId,
    )}/${escapeHtml(row.key)}">
      <input type="hidden" name="csrf" value="${escapeHtml(data.csrfToken)}">
      <input type="text" name="value" value="${escapeHtml(row.value)}" class="mono"
             aria-label="قيمة ${escapeHtml(row.key)}">
      <button type="submit">حفظ</button>
    </form>`,
    row.isProvisional ? badge("مبدئية", "warn") : badge("محسومة", "ok"),
    formatDateTime(row.updatedAt),
  ]);

  return `<h1>الإعدادات — ${escapeHtml(data.cityName)}</h1>
<form class="filters" method="get" action="/admin/settings">
  <label>المدينة
    <select name="city">${cityOptions}</select>
  </label>
  <button type="submit">عرض</button>
</form>
${section(
  "قروبات تيليجرام للمدينة",
  `<p class="note">الحالة الحالية: ${badge(selectedReadiness.label, selectedReadiness.tone)}.
  لا تُفعّل المدينة إلا بعد حفظ معرّفات القروبات الثلاثة الصحيحة معاً. الحقول الفارغة
  تُبقي المدينة غير مفعّلة.</p>
  <form method="post" action="/admin/settings/${escapeHtml(data.cityId)}/group-ids">
    <input type="hidden" name="csrf" value="${escapeHtml(data.csrfToken)}">
    <label>معرّف قروب الدعم
      <input type="text" name="support_group_id"
             value="${escapeHtml(groupValue(selectedCity?.supportGroupId ?? null))}"
             inputmode="numeric" class="mono" aria-label="معرّف قروب الدعم">
    </label>
    <label>معرّف قروب التصعيد
      <input type="text" name="escalation_group_id"
             value="${escapeHtml(groupValue(selectedCity?.escalationGroupId ?? null))}"
             inputmode="numeric" class="mono" aria-label="معرّف قروب التصعيد">
    </label>
    <label>معرّف قروب السائقين غير المشتركين
      <input type="text" name="unsubscribed_drivers_group_id"
             value="${escapeHtml(groupValue(selectedCity?.unsubscribedDriversGroupId ?? null))}"
             inputmode="numeric" class="mono" aria-label="معرّف قروب السائقين غير المشتركين">
    </label>
    <button type="submit">حفظ القروبات وتحديث حالة المدينة</button>
  </form>`,
  "تُقبل معرّفات القروبات السالبة كما يرسلها تيليجرام. لا تُكتب هذه القيم في متغيرات البيئة.",
)}
${section(
  "حالة المدن",
  table({
    headers: ["المدينة", "الدعم", "التصعيد", "غير المشتركين", "حالة التفعيل"],
    rows: data.cities.map((city) => {
      const readiness = cityReadiness(city);
      return [
        `${escapeHtml(city.nameAr)} <span class="mono">(${escapeHtml(city.code)})</span>`,
        `<span class="mono">${escapeHtml(groupValue(city.supportGroupId) || "—")}</span>`,
        `<span class="mono">${escapeHtml(groupValue(city.escalationGroupId) || "—")}</span>`,
        `<span class="mono">${escapeHtml(groupValue(city.unsubscribedDriversGroupId) || "—")}</span>`,
        badge(readiness.label, readiness.tone),
      ];
    }),
    emptyText: "لا مدن مزروعة.",
  }),
)}
${section(
  "طريقة الحصول على معرّف القروب",
  `<ol>
    <li>أنشئ قروب تيليجرام.</li>
    <li>أضف بوت السائق عضواً في القروب.</li>
    <li>أرسل رسالة اختبار إلى القروب.</li>
    <li>افتح <span class="mono">getUpdates</span>.</li>
    <li>انسخ <span class="mono">chat.id</span> والصقه في الحقل المناسب هنا.</li>
  </ol>`,
)}
${section(
  "قيم التشغيل",
  table({
    headers: ["المفتاح", "النوع", "القيمة", "الحالة", "آخر تعديل"],
    rows,
    emptyText: "لا إعدادات لهذه المدينة.",
  }),
  'القيمة تُكتب بصيغة JSON: الرقم 5، والنصّ "SAR" بعلامتي اقتباس، والقائمة ["ar","en"]. ' +
    "النوع مفروض في القاعدة: قيمة بنوع مخالف تُرفض قبل الحفظ لا بعده.",
)}
${section(
  "ما لا يُعدَّل من هنا",
  `<p class="note">قيم التشغيل أدناه مستقلة عن قروبات تيليجرام. لا تنسخ معرّفات
  القروبات إلى متغيرات البيئة؛ مصدرها الوحيد جدول المدن أعلاه.</p>`,
)}`;
}
