/**
 * الغرض: فعلُ «تعذَّرَ الإكمالُ» من سطحِ مهمّةِ السائقِ (`PD-020` · الشقُّ `ج`)
 *   — بلاغُ سلامةٍ مرتبطٌ بالمهمّةِ الجاريةِ **لا انتقالُ حالةِ رحلةٍ**:
 *   بطاقةٌ تصلُ قروبَ الإسنادِ وقرارُ الإسنادِ والإلغاءِ يبقى للفريقِ البشريِّ.
 * الحالة: منفَّذٌ فعليّاً — 2026-09-20 (البند `PD-020`).
 * ينتمي إلى: packages/application/safety
 * يُستخدم من: `apps/gateway/src/routes/driver-job.ts` (مدخلُ `POST` الرابعِ
 *   للمهمّةِ) · البنيةُ في `packages/infrastructure/driver/driver-job-store.ts`.
 * الحاكم: docs/adr/0159-safety-channel-entry-delivery-review-and-driver-cannot-complete.md
 *
 * ## لماذا بلاغٌ لا انتقالُ حالةٍ
 *
 * جدولُ الانتقالاتِ يسمحُ نظريّاً بـ`matched→searching` و`in_progress→cancelled`،
 * لكن لا كاتبًا قائمًا يفتحُ الطلبَ من جديدٍ بإخطارِ الراكبِ، واختراعُ كاتبٍ
 * تحتَ بندِ سلامةٍ قرارُ سياسةِ مالكٍ لا قرارُ قناةٍ (`ADR 0027`: لا عقوبةَ ولا
 * سياسةَ ماليّةً تُختلَقُ هنا). فالفعلُ يُوصِلُ الخبرَ إلى مَن يملكُ القرارَ،
 * ويقفُ عندَ حدودِهِ — والسائقُ يرى مآلَ بلاغِهِ بنموذجِ `PD-020` نفسِهِ
 * (استُقبِلَ ← اطَّلعَ) من مسارِ القراءةِ الذي يُركِّبُ الدورَ `driver`.
 *
 * ## وما لا يفعله هذا الملفُّ عن قصدٍ (`ح-5`)
 *
 *   ــ **لا يغيِّرُ حالةَ الطلبِ ولا يُخطِرُ الراكبَ**: ذاكَ قرارُ الفريقِ بعدَ
 *      قراءةِ البطاقةِ.
 *   ــ **لا يخترعُ رموزًا عامّةً**: رموزُ الرفضِ رموزُ الحاكمِ (`trigger_sos`)
 *      تُترجَمُ إلى مجالِ هذا السطحِ المغلقِ كما فعلَ `driver_start_ride`
 *      قبلَهُ — لا تُمرَّرُ خامًا.
 */

import { err, ok, type Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import type { PortFailureError } from "../ports/index.ts";

/**
 * رموزُ الرفضِ من الحاكمِ (`driver_cannot_complete`) التي يترجِمُها هذا
 * السطحُ المغلقُ لرموزِهِ العامّةِ.
 */
export type DriverCannotCompleteStoreRejection =
  | "USER_NOT_FOUND"
  | "NOT_A_DRIVER"
  | "JOB_NOT_FOUND"
  | "ACTOR_BLOCKED"
  | "ESCALATION_GROUP_MISSING"
  | "SOS_DEDUP_SETTING_MISSING"
  | "TRANSITION_REFUSED";

/** منفذُ البلاغِ — الذرّيّةُ كلُّها في الدالّةِ القاعدةِ، لا ههنا. */
export interface DriverCannotCompletePort {
  report(input: { readonly actorTelegramId: string; readonly orderId: string }): Promise<
    Result<
      | { readonly incidentId: string; readonly created: boolean }
      | {
          readonly incidentId: null;
          readonly rejection: DriverCannotCompleteStoreRejection;
        },
      PortFailureError
    >
  >;
}

export const DRIVER_CANNOT_COMPLETE_PUBLIC_ERROR_CODES = [
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "SAFETY_STORE_NOT_AVAILABLE",
  "NOT_A_DRIVER",
  "ORDER_ID_INVALID",
  "JOB_NOT_FOUND",
  "ACTOR_BLOCKED",
  "CITY_NOT_READY",
  "REPORT_REJECTED",
] as const;

export type DriverCannotCompletePublicErrorCode =
  (typeof DRIVER_CANNOT_COMPLETE_PUBLIC_ERROR_CODES)[number];

export interface DriverCannotCompleteRejection {
  readonly code: DriverCannotCompletePublicErrorCode;
}

export interface DriverCannotCompleteDeps {
  readonly sessions: MiniAppSessionReader;
  readonly now: () => Date;
  readonly reports: DriverCannotCompletePort;
}

export type DriverCannotCompleteOutcome =
  | {
      readonly accepted: true;
      readonly incidentId: string;
      readonly created: boolean;
      readonly orderId: string;
    }
  | { readonly accepted: false; readonly rejection: DriverCannotCompleteRejection };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rejection(code: DriverCannotCompletePublicErrorCode): DriverCannotCompleteRejection {
  return { code };
}

function sessionErrorFrom(reason: string): DriverCannotCompletePublicErrorCode {
  if (reason === "EXPIRED") return "SESSION_EXPIRED";
  if (reason === "NOT_CONFIGURED") return "SESSION_NOT_AVAILABLE";
  return "SESSION_INVALID";
}

function publicCodeFrom(
  store: DriverCannotCompleteStoreRejection,
): DriverCannotCompletePublicErrorCode {
  switch (store) {
    case "USER_NOT_FOUND":
    case "NOT_A_DRIVER":
      return "NOT_A_DRIVER";
    case "JOB_NOT_FOUND":
      return "JOB_NOT_FOUND";
    case "ACTOR_BLOCKED":
      return "ACTOR_BLOCKED";
    case "ESCALATION_GROUP_MISSING":
    case "SOS_DEDUP_SETTING_MISSING":
      return "CITY_NOT_READY";
    default:
      return "REPORT_REJECTED";
  }
}

/**
 * الضغطةُ — انتظارٌ واحدٌ على المنفذِ، ومُعرِّفُ المهمّةِ من المسارِ لا من
 * جسمٍ يُكتبُ بيدٍ: مُعرِّفٌ يُرسَلُ يُفحَصُ مِلكيّةً وإسنادًا في الحاكمِ
 * تحتَ القفلِ، فلا ثقةَ في ذاكرةِ شاشةٍ.
 */
export async function requestDriverCannotComplete(
  deps: DriverCannotCompleteDeps,
  input: { readonly accessToken: string | undefined; readonly orderId: string },
): Promise<Result<DriverCannotCompleteOutcome, DriverCannotCompletePublicErrorCode>> {
  if (input.accessToken === undefined || input.accessToken.length === 0) {
    return err(rejection("SESSION_REQUIRED").code);
  }
  const session = await deps.sessions.read(input.accessToken, deps.now().getTime());
  if (!session.ok) return err(sessionErrorFrom(session.error.reason));

  const orderId = input.orderId.trim();
  if (!UUID_PATTERN.test(orderId)) return err("ORDER_ID_INVALID");

  const reported = await deps.reports.report({
    actorTelegramId: session.value.telegramUserId,
    orderId,
  });
  if (!reported.ok) return err("SAFETY_STORE_NOT_AVAILABLE");
  if (reported.value.incidentId === null) {
    return ok({ accepted: false, rejection: rejection(publicCodeFrom(reported.value.rejection)) });
  }
  return ok({
    accepted: true,
    incidentId: reported.value.incidentId,
    created: reported.value.created,
    orderId,
  });
}
