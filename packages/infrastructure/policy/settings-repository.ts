/**
 * الغرض: قراءة إعدادات المدينة الحقيقية من جدول platform_settings — مصدر كل سعر ومهلة ووزن.
 * الحالة: منفّذ فعلياً ومُختبَر على قاعدة حقيقية — المرحلة 2.1.
 * ينتمي إلى: infrastructure/policy
 * يُتوقع أن يستخدمه لاحقاً: application/dispatch/match-order، بوت السائق (عرض السعر)
 * ملاحظات مستقبلية: عند إضافة ذاكرة مؤقتة تبقى المهلة قصيرة جداً؛ تغيير السعر يجب أن يظهر فوراً.
 */

import type { PortFailureError, SettingsRepository } from "../../application/ports/index.ts";
import type { RawSetting, SettingValueType } from "../../domain/policy/entity.ts";
import type { CityId } from "../../shared/kernel/index.ts";
import type { Result } from "../../shared/result/index.ts";
import { guard, type Sql } from "../db/client.ts";

interface SettingRow {
  readonly city_id: string;
  readonly key: string;
  readonly value: unknown;
  readonly value_type: string;
}

export function createSettingsRepository(sql: Sql): SettingsRepository {
  return {
    findByCity: (cityId: CityId): Promise<Result<readonly RawSetting[], PortFailureError>> =>
      guard("settings.findByCity", async () => {
        const rows = await sql<SettingRow[]>`
          select city_id, key, value, value_type
            from platform_settings
           where city_id = ${cityId}
           order by key
        `;
        return rows.map((row) => ({
          cityId: row.city_id as CityId,
          key: row.key,
          value: row.value,
          valueType: row.value_type as SettingValueType,
        }));
      }),
  };
}
