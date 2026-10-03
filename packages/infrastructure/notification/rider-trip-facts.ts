/**
 * الغرض: قراءةُ ما يلزمُ لإخطارِ الراكبِ بطَورِ رحلتِه (`RIDE-NOTICE-01`) —
 *   معرِّفُ تلغرامِه ولغتُه، واسمُ السائقِ ولوحتُه ونوعُ مركبتِه.
 * الحالة: منفَّذٌ فعليّاً — 2026-10-03.
 * ينتمي إلى: infrastructure/notification
 * يُستخدم من: apps/gateway/src/index.ts (مساراتُ السائقِ في التطبيقِ المصغَّرِ).
 *
 * معزولٌ عن `driver-job-store.ts` عمداً: ذاك المخزنُ **لا يقرأُ معرِّفَ تلغرامِ
 * راكبٍ** ولا يُعيدُه للسائقِ. وهذا القارئُ لا يُعيدُ شيئاً لأيِّ شاشةٍ — يُغذّي
 * رسالةً تذهبُ إلى الراكبِ نفسِه على بوتِه هو.
 */

import type {
  RiderTripFacts,
  RiderTripFactsReader,
} from "../../application/driver/rider-trip-notice.ts";
import type { Sql } from "../db/client.ts";

interface FactsRow {
  readonly rider_telegram_id: string | number | bigint | null;
  readonly rider_language: string | null;
  readonly driver_name: string | null;
  readonly plate: string | null;
  readonly vehicle: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createRiderTripFactsReader(sql: Sql): RiderTripFactsReader {
  return {
    read: async (orderId: string): Promise<RiderTripFacts | null> => {
      if (!UUID.test(orderId)) return null;
      const rows = await sql<FactsRow[]>`
        select ru.telegram_id::text as rider_telegram_id,
               ru.language_code     as rider_language,
               du.full_name         as driver_name,
               d.plate_number       as plate,
               d.vehicle_type::text as vehicle
          from orders o
          join riders r      on r.id = o.rider_id
          join users ru      on ru.id = r.user_id
          left join drivers d on d.id = o.assigned_driver_id
          left join users du  on du.id = d.user_id
         where o.id = ${orderId}::uuid
           and ru.erased_at is null`;
      const row = rows[0];
      if (row === undefined || row.rider_telegram_id === null) return null;
      return {
        riderTelegramId: String(row.rider_telegram_id),
        language: row.rider_language ?? "ar",
        driverName: row.driver_name,
        plate: row.plate,
        vehicle: row.vehicle,
      };
    },
  };
}
