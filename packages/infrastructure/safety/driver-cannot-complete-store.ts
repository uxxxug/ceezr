/**
 * الغرض: محوّلُ فعلِ «تعذَّرَ الإكمالُ» إلى RPC `driver_cannot_complete` —
 *   الذرّيّةُ كلُّها في PostgreSQL (ملكيّةٌ · إسنادٌ جارٍ · بلاغٌ · صفُّ
 *   تسليمٍ)، وههنا نداءٌ واحدٌ **بلا انتظارٍ قبله**.
 * الحالة: منفَّذٌ فعليّاً — 2026-09-20 (البند `PD-020`).
 * ينتمي إلى: infrastructure/safety
 * يُستخدم من: `apps/gateway/src/routes/driver-job.ts` عبرَ حقنِ التبعياتِ.
 * الحاكم: docs/adr/0159-safety-channel-entry-delivery-review-and-driver-cannot-complete.md
 *
 * ## لماذا ههنا وليس في `driver-job-store`
 *
 * لأنَّ الفعلَ **بلاغُ سلامةٍ** لا عمليّةَ نقلٍ: الجدولُ الذي يكتبُهُ
 * (`safety_incidents`) والصفُّ الذي يُودِعُهُ (`notification_outbox`) ملكُ
 * قناةِ السلامةِ، وحدودُ الشقِّ `ج` من البندِ تقولُ إنَّهُ يدخلُ من بابِ
 * المهمّةِ ويُحفَظُ في بيتِ السلامةِ — فلا يُفتَحُ بابُ مخزنِ النقلِ لجدولٍ
 * ليسَ لهُ.
 */

import type {
  DriverCannotCompletePort,
  DriverCannotCompleteStoreRejection,
} from "../../application/safety/driver-cannot-complete.ts";
import { guard, readEnvelope, type Sql, withRequestContext } from "../db/client.ts";

const REJECTIONS: readonly DriverCannotCompleteStoreRejection[] = [
  "USER_NOT_FOUND",
  "NOT_A_DRIVER",
  "JOB_NOT_FOUND",
  "ACTOR_BLOCKED",
  "ESCALATION_GROUP_MISSING",
  "SOS_DEDUP_SETTING_MISSING",
  "TRANSITION_REFUSED",
];

function rejectionFrom(payload: Record<string, unknown>): DriverCannotCompleteStoreRejection {
  const code = typeof payload.error === "string" ? payload.error : "UNKNOWN";
  return REJECTIONS.some((candidate) => candidate === code)
    ? (code as DriverCannotCompleteStoreRejection)
    : "TRANSITION_REFUSED";
}

function envelope(value: unknown): Record<string, unknown> {
  const result = readEnvelope(value);
  if (result === null) throw new Error("ردّ driver_cannot_complete غير مفهوم");
  return result;
}

export function createDriverCannotCompletePort(sql: Sql): DriverCannotCompletePort {
  return {
    report: (input) =>
      guard("rpc.driver_cannot_complete", async () => {
        // `F8-01` — كما في `trigger_sos`: البلاغُ وصفُّهُ يُكتَبانِ داخلَ
        // معاملةٍ يحملُ معرِّفَ وحدةِ العملِ.
        const rows = await withRequestContext(
          sql,
          (tx) =>
            tx<
              { result: unknown }[]
            >`select driver_cannot_complete(${input.actorTelegramId}::bigint, ${input.orderId}::uuid) result`,
        );
        const row = envelope(rows[0]?.result);
        return row.ok === true
          ? {
              incidentId: String(row.incident_id),
              created: row.created === true,
            }
          : { incidentId: null, rejection: rejectionFrom(row) };
      }),
  };
}
