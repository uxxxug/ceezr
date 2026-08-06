/**
 * الغرض: المدن المفعَّلة فعلاً كما تراها البوتات. مدينة غير مفعَّلة لا تظهر لأي مستخدم.
 * الحالة: منفّذ فعلياً ومُختبَر على قاعدة حقيقية — المرحلة 2.1.
 * ينتمي إلى: infrastructure/geo
 * يُتوقع أن يستخدمه لاحقاً: بوت السائق وبوت العميل، لوحة الإدارة (2.4)
 * ملاحظات مستقبلية: قيد cities_active_requires_groups يمنع تفعيل مدينة بلا مجموعاتها الثلاث.
 */

import type { CityDirectory, CityRef } from "../../application/bots/types.ts";
import type { CityId } from "../../shared/kernel/index.ts";
import { guard, type Sql } from "../db/client.ts";

interface CityRow {
  readonly id: string;
  readonly code: string;
  readonly name_ar: string;
  readonly name_en: string;
}

export function createCityDirectory(sql: Sql, language = "ar"): CityDirectory {
  return {
    listActive: () =>
      guard("cities.listActive", async () => {
        const rows = await sql<CityRow[]>`
          select id, code, name_ar, name_en
            from cities
           where is_active = true
           order by name_ar
        `;
        return rows.map(
          (row): CityRef => ({
            id: row.id as CityId,
            code: row.code,
            name: language === "en" ? row.name_en : row.name_ar,
          }),
        );
      }),
  };
}
