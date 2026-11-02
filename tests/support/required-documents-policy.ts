/**
 * الغرض: تثبيتُ سياسةِ وثائقِ السائقِ الإلزاميّةِ **صريحةً** في اختباراتِ
 *   التكاملِ التي تقيسُ سلوكَ الحارسِ (`F12-21`) تحتَ الإلزامِ — ثم ردُّها.
 * الحالة: وُلدَ بعدَ هجرةِ ADR 0302 (2026-11-02) التي جعلتِ الافتراضيَّ
 *   المعلنَ `[]` (لا وثائقَ مطلوبةً). الاختباراتُ التي كُتِبَت قبلَها كانت
 *   **ترثُ** الستةَ التاريخيّةَ من بذرةِ الهجراتِ — فصارَ ميراثُها متغيرًا،
 *   وأخضرُها رهنَ سياسةٍ لا يملكُها الملفُّ. هذا المعينُ يجعلُ الفرضيّةَ
 *   مكتوبةً في الملفِّ نفسِهِ: من يقيسُ الحارسَ تحتَ الإلزامِ يُعلِنُه.
 * ينتمي إلى: tests/support
 *
 * ولماذا الأنواعُ الستةُ **التاريخيّةُ** بالتحديد؟ لأنّ هذا ما زرعَتهُ بذرةُ
 * `20260915000000` وما بُنِيَت عليهِ اختباراتُ الانحدارِ — فتثبيتُهُ يُبقي
 * قياسَها على أساسٍ معروفٍ لا موروثٍ، ومن أرادَ قياسَ السياسةِ الجديدةِ
 * (`[]`) كتبَها بنفسِهِ (كما في `driver-documents-approval-guard`).
 *
 * والردُّ في afterAll إلزاميٌّ: الملفُّ الذي يُبدِّلُ السياسةَ ويتركُها
 * يُورِّثُ لمن بعدَه فرضيّةً لم يطلُبْها (القاعدةُ 0.6 — أقلُّ مصادرِ حقيقةٍ).
 */

import type { Sql } from "../../packages/infrastructure/db/client.ts";

/**
 * الأنواعُ الستةُ التاريخيّةُ (إلزامُ ما قبلَ 2026-11-02) — مصدرٌ واحدٌ
 * لكلِّ اختبارٍ يُثبِّتُ الإلزامَ.
 */
export const LEGACY_REQUIRED_DOCUMENT_TYPES = [
  "driving_license",
  "medical_exam",
  "criminal_record",
  "vehicle_registration",
  "insurance",
  "periodic_inspection",
] as const;

/** لقطةُ سياسةِ المدينةِ قبلَ التثبيتِ — وإليها تُردُّ. */
export type RequiredDocumentTypesSnapshot = {
  readonly cityId: string;
  readonly original: unknown;
};

/**
 * يثبِّتُ الأنواعَ المطلوبةَ (الافتراضيُّ: الستةُ التاريخيّة) لمدينةٍ صريحةً
 * ويُعيدُ لقطةَ ما قبلَها. يُنادى في `beforeAll` بعدَ `ensureActiveCity`.
 */
export async function pinRequiredDocumentTypes(
  sql: Sql,
  cityId: string,
  types: readonly string[] = LEGACY_REQUIRED_DOCUMENT_TYPES,
): Promise<RequiredDocumentTypesSnapshot> {
  const [setting] = await sql<{ value: unknown }[]>`
    select value from platform_settings
     where city_id = ${cityId}::uuid and key = 'driver_required_document_types'
  `;
  const original = setting === undefined ? null : setting.value;
  // sql.json — لا `${x}::jsonb`: الربطُ المزدوجُ يصلُ القاعدةَ نصًّا (حاجزُ check-jsonb-binding).
  await sql`
    insert into platform_settings (city_id, key, value, value_type, description_ar)
    values (
      ${cityId}::uuid, 'driver_required_document_types',
      ${sql.json(types)}, 'array',
      'أنواع الوثائق الإلزامية لتسجيل السائق — تثبيت صريح لاختبار الحارس (ADR 0302)'
    )
    on conflict (city_id, key) do update
    set value = ${sql.json(types)}
  `;
  return { cityId, original };
}

/**
 * يردُّ سياسةَ المدينةِ إلى اللقطةِ التي قُرِئَت قبلَ التثبيتِ — حرفاً.
 * يُنادى في `afterAll`. مُعادُ التنفيذِ (idempotent).
 */
export async function restoreRequiredDocumentTypes(
  sql: Sql,
  snapshot: RequiredDocumentTypesSnapshot | undefined,
): Promise<void> {
  if (snapshot === undefined) return;
  if (snapshot.original === null) {
    await sql`
      delete from platform_settings
       where city_id = ${snapshot.cityId}::uuid and key = 'driver_required_document_types'
    `;
    return;
  }
  await sql`
    update platform_settings set value = ${sql.json(snapshot.original as never)}
     where city_id = ${snapshot.cityId}::uuid and key = 'driver_required_document_types'
  `;
}
