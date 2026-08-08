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
  readonly cities: readonly CityOption[];
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

export function renderSettingsPage(data: SettingsPageData): string {
  const cityOptions = data.cities
    .map(
      (city) =>
        `<option value="${escapeHtml(city.id)}"${
          data.cityId === city.id ? " selected" : ""
        }>${escapeHtml(city.nameAr)}</option>`,
    )
    .join("");

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
  `<p class="note">معرّفات قروبات تلغرام وحالة تفعيل المدينة ليست إعدادات تشغيل يومي:
  تغييرها يوجّه رسائل حقيقية إلى قروب آخر، ومكانها هجرة مراجَعة لا حقل نصّي في صفحة.</p>`,
)}`;
}
