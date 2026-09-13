/**
 * الغرض: حالةُ استعمالٍ — قراءةُ صفحةٍ من سجلِّ رحلاتِ الراكبِ، مُجمَّعةً
 *   بالشهرِ ومصحوبةً بتصنيفِ الثقةِ في منطقةِ التصنيفِ (البند `F2-08` · `SR-09`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-08`.
 * ينتمي إلى: packages/application/transport
 * يُستخدم من: `apps/gateway/src/routes/rides.ts` (`GET /v1/rides`)
 * يُتوقع أن يستخدمه لاحقاً: `F2-11` (تصديرُ بياناتي) يستدعيها في حلقةٍ بالمؤشِّرِ
 *   ولا يكتبُ قراءةً ثانيةً.
 * ملاحظات مستقبلية: **لا حقلَ مبلغٍ يُقرأُ ههنا ولا خانةً له** قبلَ `DEC-11`.
 *
 * ## لماذا الجلسةُ تُقرأُ ههنا لا في المسارِ
 *
 * كما في `F2-05`…`F2-07`: الهويّةُ تُستخرَجُ من **الرمزِ الموقَّعِ** لا من جسمِ
 * الطلبِ ولا من ترويسةٍ. ولو تُرِكَ ذلكَ للمسارِ لَكانَ لكلِّ مسارٍ فرصةُ نسيانٍ،
 * والنسيانُ ههنا **قراءةُ سجلِّ رحلاتِ غيرِك**.
 *
 * ## ولماذا التجميعُ في هذه الطبقةِ لا في السطحِ
 *
 * لأنَّ التجميعَ **حكمٌ مقيسٌ** (اختبارُ وحدةٍ يُثبِتُ أنَّ المتتابعَ يُطوى ولا
 * يُفرَزُ)، والسطحُ يرسمُ ما يُعطى. ولو جُمِّعَ في المتصفِّحِ لَاحتاجَ كلُّ سطحٍ
 * (راكبٌ · تصديرٌ · إدارةٌ) نسخةً من الحكمِ نفسِه.
 *
 * ## وما لا تفعلُه هذه الحالةُ عن قصدٍ
 *
 *   ــ **لا تدمجُ صفحاتٍ ولا تحتفظُ بحالةٍ بينَ نداءَينِ**: الحلقةُ ملكُ
 *      المُنادي، وذاكرةٌ ههنا تعني خادماً يتذكَّرُ تصفُّحَ راكبٍ بلا سببٍ.
 *   ــ **لا تُعيدُ ترتيبَ الصفوفِ** — الترتيبُ حكمُ القاعدةِ.
 *   ــ **لا تفتحُ تذكرةَ دعمٍ ولا تعرضُ إيصالاً** (`F2-12` · `ADR 0039` §٤).
 */

import {
  groupRidesByMonth,
  type MonthTimezoneTrust,
  monthTimezoneTrustOf,
  type RideHistoryMonthGroup,
  readRideHistoryPageSize,
  readRideHistoryQuery,
} from "../../domain/transport/ride-history.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import { type RequestRidePublicErrorCode, rideStoreErrorFrom } from "./request-ride.ts";
import type {
  RideHistoryCursor,
  RideHistoryReader,
  RideHistoryRefusal,
} from "./ride-history-ports.ts";

export interface ReadRideHistoryDeps {
  readonly sessions: MiniAppSessionReader;
  readonly history: RideHistoryReader;
  readonly now: () => Date;
}

export interface RideHistoryView {
  readonly groups: readonly RideHistoryMonthGroup[];
  readonly hasMore: boolean;
  readonly nextCursor: RideHistoryCursor | null;
  readonly monthTimezone: string;
  readonly monthTimezoneTrust: MonthTimezoneTrust;
  /** النصُّ الذي بُحِثَ به فعلاً بعدَ التشذيبِ — `null` = لم يُبحَثْ. */
  readonly query: string | null;
}

export type ReadRideHistoryResult =
  | { readonly ok: true; readonly view: RideHistoryView }
  | { readonly ok: false; readonly refusal: RideHistoryRefusal | "QUERY_TOO_LONG" };

export async function readRideHistory(
  deps: ReadRideHistoryDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly query: unknown;
    readonly pageSize: unknown;
    readonly cursor: RideHistoryCursor | null;
  },
): Promise<Result<ReadRideHistoryResult, RequestRidePublicErrorCode>> {
  if (input.accessToken === undefined || input.accessToken.length === 0) {
    return err("SESSION_REQUIRED");
  }
  const session = deps.sessions.read(input.accessToken, deps.now().getTime());
  if (!session.ok) {
    const reason = session.error.reason;
    if (reason === "EXPIRED") return err("SESSION_EXPIRED");
    if (reason === "NOT_CONFIGURED") return err("SESSION_NOT_AVAILABLE");
    return err("SESSION_INVALID");
  }

  // المُدخلانِ يُحكَمانِ **قبلَ** أيِّ نداءٍ: رفضٌ يُقرأُ نصّاً أفضلُ من جولةِ
  // شبكةٍ تعودُ برمزٍ من القاعدةِ نفسِه.
  const size = readRideHistoryPageSize(input.pageSize);
  if (!size.accepted) return ok({ ok: false, refusal: size.refusal });

  const query = readRideHistoryQuery(input.query);
  if (!query.accepted) return ok({ ok: false, refusal: query.refusal });

  const read = await deps.history.read({
    telegramUserId: session.value.telegramUserId,
    query: query.query,
    cursor: input.cursor,
    limit: size.limit,
  });
  if (!read.ok) return err(rideStoreErrorFrom(read.error));

  const verdict = read.value;
  if (!verdict.ok) return ok({ ok: false, refusal: verdict.refusal });

  const { page } = verdict;
  return ok({
    ok: true,
    view: {
      groups: groupRidesByMonth(page.rides),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
      monthTimezone: page.monthTimezone,
      monthTimezoneTrust: monthTimezoneTrustOf(page.monthTimezoneSource),
      query: query.query,
    },
  });
}
