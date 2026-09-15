/**
 * الغرض: حالاتُ استخدامِ حصيلةِ السائقِ — «حصيلتي» و«جدولُ رحلاتي»، والهويّةُ
 *   **من الرمزِ الموقَّعِ وحدَه** (`F3-05` · `SD-06` · `SD-09`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-05`.
 * ينتمي إلى: packages/application/driver
 * يُستخدم من: `apps/gateway/src/routes/driver-activity.ts`
 * يُتوقع أن يستخدمه لاحقاً: `SD-07` — الاشتراكُ حالةٌ تُضافُ، ولا يُوسَّعُ
 *   الملخَّصُ ليحملَ خطّةً وسعراً.
 * الحاكم: docs/adr/0120-transparency-is-a-denominator-not-a-slogan.md
 *
 * ## لِمَ المُدّةُ **تُفحَصُ ههنا** ولا تُمرَّرُ نصّاً إلى القاعدةِ
 *
 * القاعدةُ ترفضُ مُدّةً مجهولةً (`WINDOW_UNRESOLVED`) — ولكنَّ ذاكَ رفضٌ يُقرأُ
 * `409` أو `503` في نظرِ القارئِ، وهوَ في الحقيقةِ **طلبٌ مُشوَّهٌ** يستحقُّ
 * `422`. ففحصُ المجالِ المغلقِ في الطبقةِ يجعلُ رسالةَ الخطأِ صادقةً، **ولا
 * يُلغي** فحصَ القاعدةِ: الحاجزُ الأخيرُ يبقى حيثُ البياناتُ.
 *
 * ## ولِمَ السقفُ يُقصَرُ **مرّتَينِ**
 *
 * ههنا لتُقرأَ قيمةٌ سليمةٌ في السجلِّ، وفي القاعدةِ لأنَّها **الحاجزُ الحقيقيُّ**
 * لمن ينادي الدالّةَ من غيرِ هذا الطريقِ. وقصرٌ في مكانٍ واحدٍ يجعلُ الأمانَ
 * تابعاً لطريقِ النداءِ.
 *
 * ## وما لا تفعلُه هذه الحالاتُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تقرأُ معرِّفَ سائقٍ من طلبٍ**: من الجلسةِ وحدَها — فلا تقريرَ لغيرِه
 *      بتغييرِ رقمٍ.
 *   ــ **لا تحسبُ رقماً ولا تُدوِّرُ نسبةً**: القاعدةُ تحسبُ، والطبقةُ تنقلُ.
 *   ــ **لا تُخزِّنُ نتيجةً في ذاكرةٍ** (`cache`): تقريرٌ يُقرأُ قديماً بلا علامةٍ
 *      يجعلُ السائقَ يظنُّ أنَّ رحلتَه لم تُحسَبْ.
 *   ــ **لا تُقارِنُ سائقاً بسائقٍ ولا تقرأُ متوسّطَ مدينةٍ**: ترتيبٌ نسبيٌّ
 *      يُعرَضُ يجعلُ الرقمَ حكماً على شخصٍ لا مرآةً لعملِه.
 */

import type {
  ActivityPeriod,
  DriverActivityLog,
  DriverActivitySummary,
} from "../../domain/driver/activity.ts";
import { isActivityPeriod } from "../../domain/driver/activity.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import {
  type DriverActivityStore,
  type DriverActivityStoreError,
  isDriverActivityRejection,
} from "./activity-ports.ts";

/** رموزُ العطبِ المنشورةُ — قائمةٌ تُقرأُ في زمنِ التشغيلِ ليُلزِمَ الحاجزُ نصّاً لكلٍّ. */
export const DRIVER_ACTIVITY_PUBLIC_ERROR_CODES = [
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "ACTIVITY_STORE_NOT_AVAILABLE",
  "NOT_A_DRIVER",
  "PERIOD_INVALID",
  "WINDOW_UNRESOLVED",
] as const;

export type DriverActivityPublicErrorCode = (typeof DRIVER_ACTIVITY_PUBLIC_ERROR_CODES)[number];

export interface DriverActivityRejection {
  readonly code: DriverActivityPublicErrorCode;
}

export interface DriverActivityDeps {
  readonly sessions: MiniAppSessionReader;
  readonly store: DriverActivityStore;
  readonly now: () => Date;
}

/** سقفُ الصفحةِ ومبدؤها — **مُعلَنانِ رقمانِ** يُقرآنِ في الحاجزِ وفي الاختبارِ. */
export const ACTIVITY_ENTRIES_DEFAULT_LIMIT = 20;
export const ACTIVITY_ENTRIES_MAX_LIMIT = 50;

function rejection(code: DriverActivityPublicErrorCode): DriverActivityRejection {
  return { code };
}

function sessionErrorFrom(reason: string): DriverActivityPublicErrorCode {
  if (reason === "EXPIRED") return "SESSION_EXPIRED";
  if (reason === "NOT_CONFIGURED") return "SESSION_NOT_AVAILABLE";
  return "SESSION_INVALID";
}

function openSession(
  deps: DriverActivityDeps,
  accessToken: string | undefined,
): Result<string, DriverActivityRejection> {
  if (accessToken === undefined || accessToken.length === 0) {
    return err(rejection("SESSION_REQUIRED"));
  }
  const session = deps.sessions.read(accessToken, deps.now().getTime());
  if (!session.ok) return err(rejection(sessionErrorFrom(session.error.reason)));
  return ok(session.value.telegramUserId);
}

/**
 * سقفُ الصفحةِ من طلبٍ — **يُقصَرُ ولا يُرفَضُ**: رقمٌ خرافيٌّ في استعلامٍ ليسَ
 * عدواناً ولا يستحقُّ `422`، ونصٌّ غيرُ رقمٍ يُقرأُ افتراضاً.
 */
export function readEntriesLimit(value: unknown): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) return ACTIVITY_ENTRIES_DEFAULT_LIMIT;
  return Math.min(Math.max(parsed, 1), ACTIVITY_ENTRIES_MAX_LIMIT);
}

/** **شاملٌ حرفاً** لاتّحادِ الرفضِ: رمزٌ جديدٌ في القاعدةِ يُسقِطُ البناءَ. */
function publicCodeFrom(error: DriverActivityStoreError): DriverActivityRejection {
  if (!isDriverActivityRejection(error)) return rejection("ACTIVITY_STORE_NOT_AVAILABLE");
  switch (error.rejection) {
    // حسابٌ لا صفَّ له ليسَ جلسةً فاسدةً — ولا يُفرَّقُ عن «ليسَ سائقاً».
    case "USER_NOT_FOUND":
    case "NOT_A_DRIVER":
      return rejection("NOT_A_DRIVER");
    case "WINDOW_UNRESOLVED":
      return rejection("WINDOW_UNRESOLVED");
  }
}

export async function readDriverActivitySummary(
  deps: DriverActivityDeps,
  input: { readonly accessToken: string | undefined; readonly period: unknown },
): Promise<Result<DriverActivitySummary, DriverActivityRejection>> {
  const session = openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  const period: ActivityPeriod | null = isActivityPeriod(input.period) ? input.period : null;
  if (period === null) return err(rejection("PERIOD_INVALID"));

  const read = await deps.store.readSummary({ telegramUserId: session.value, period });
  if (!read.ok) return err(publicCodeFrom(read.error));
  return ok(read.value);
}

export async function readDriverActivityEntries(
  deps: DriverActivityDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly period: unknown;
    readonly limit: unknown;
  },
): Promise<Result<DriverActivityLog, DriverActivityRejection>> {
  const session = openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  const period: ActivityPeriod | null = isActivityPeriod(input.period) ? input.period : null;
  if (period === null) return err(rejection("PERIOD_INVALID"));

  const read = await deps.store.readEntries({
    telegramUserId: session.value,
    period,
    limit: readEntriesLimit(input.limit),
  });
  if (!read.ok) return err(publicCodeFrom(read.error));
  return ok(read.value);
}
