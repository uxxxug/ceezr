/**
 * الغرض: مساعدُ زرعِ وثائقَ مقبولةٍ لسائقٍ في اختباراتِ التكامل —
 *   لكي يمرَّ حارسُ `F12-21` في `admin_set_driver_verification`.
 * الحالة: مساعدٌ مُستعمَلٌ في عدّةِ ملفّاتِ تكاملٍ (F12-21).
 * ينتمي إلى: tests/support
 */

import type { Sql } from "../../packages/infrastructure/db/client.ts";

/**
 * يزرعُ كلَّ الوثائقِ الإلزاميّةِ لمدينةِ السائقِ بحالةِ `accepted` وتاريخِ
 * انتهاءٍ مستقبليٍّ. لا يفترضُ عدداً ولا نوعاً — يقرأُها من القاعدةِ.
 */
export async function seedAcceptedDocuments(
  sql: Sql,
  cityId: string,
  driverId: string,
  daysValid = 400,
): Promise<void> {
  const [types] = await sql<{ types: string[] }[]>`
    select driver_required_document_types(${cityId}::uuid)::text[] as types
  `;
  const required = types?.types ?? [];
  if (required.length === 0) return;

  const [day] = await sql<{ day: string }[]>`
    select to_char(current_date + ${daysValid}::integer, 'YYYY-MM-DD') as day
  `;
  const expiresAt = day?.day;
  if (expiresAt === undefined) throw new Error("تعذّر قراءةُ يومِ القاعدةِ");

  for (const docType of required) {
    const objectPath = `drivers/${driverId}/${docType}/${docType}.png`;
    await sql`
      insert into driver_documents
        (city_id, driver_id, doc_type, status, object_path, expires_at, submitted_at, reviewed_at)
      values
        (${cityId}, ${driverId}, ${docType}::driver_document_type, 'accepted',
         ${objectPath}, ${expiresAt}::date, now(), now())
      on conflict (driver_id, doc_type) do update
      set status = 'accepted', expires_at = ${expiresAt}::date, reviewed_at = now()
    `;
  }
}
