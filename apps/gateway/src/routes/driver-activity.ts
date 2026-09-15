/**
 * الغرض: مسارا حصيلةِ السائقِ — `GET /v1/driver/activity` و
 *   `GET /v1/driver/activity/entries` (`F3-05` · `SD-06` · `SD-09`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-05`.
 * ينتمي إلى: apps/gateway/src/routes
 * يُستخدم من: `apps/gateway/src/server.ts` عبرَ تركيبٍ اختياريٍّ.
 * يُتوقع أن يستخدمه لاحقاً: `SD-07` — الاشتراكُ مسارٌ يُضافُ، ولا يُوسَّعُ
 *   الملخَّصُ ليحملَ خطّةً وسعراً.
 * يحرسُه: scripts/check-driver-activity-contract.ts
 * الحاكم: docs/adr/0120-transparency-is-a-denominator-not-a-slogan.md
 *
 * ## لِمَ المُدّةُ في **الاستعلامِ** لا في المسارِ
 *
 * `GET /v1/driver/activity/day` كانت ستقولُ إنَّ «اليومَ» **مَورِدٌ**، وهوَ في
 * الحقيقةِ **مُرشِّحُ قراءةٍ** على مَورِدٍ واحدٍ. ومسارٌ لكلِّ مُدّةٍ يُضاعِفُ
 * قواعدَ حدِّ المعدَّلِ والتصريحِ ثلاثاً بلا فرقٍ في السلطةِ.
 *
 * ## ولِمَ الجدولُ **مسارٌ ثانٍ**
 *
 * لأنَّ الشاشةَ تفتحُ على الملخَّصِ، والجدولُ يُطلَبُ عندَ التوسيعِ. وجمعُهما
 * يجعلُ كلَّ فتحةٍ تقرأُ صفوفاً لا يراها أحدٌ، ويجعلُ `limit` حقلاً في طلبٍ
 * لا معنى له فيه.
 *
 * ## وما لا تفعلُه هذه المساراتُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تقبلُ تاريخَينِ من العميلِ**: لا `from` ولا `to` في الاستعلامِ —
 *      نافذةٌ يرسمُها العميلُ تجعلُ لكلِّ جهازٍ حصيلةً.
 *   ــ **لا تقبلُ معرِّفَ سائقٍ**: الهويّةُ من الرمزِ الموقَّعِ وحدَه.
 *   ــ **لا تنشرُ مالاً**: مفتاحُ المالِ يُنقَلُ **مُعلَنَ الغيابِ بسببِه** كما
 *      قالَته القاعدةُ، ولا يُحسَبُ ههنا ولا يُملأُ (`ADR 0039` §٤ · `DEC-11`).
 *   ــ **لا تُدوِّرُ نسبةً ولا تُترجِمُ رمزاً**: الأرقامُ خامٌ والنصُّ في الشاشةِ.
 *   ــ **لا تُسجِّلُ رقماً في السجلِّ**: الرمزُ والحكمُ والمُدّةُ فحسب — سجلٌّ
 *      يحملُ حصيلةَ سائقٍ يجعلُ من يقرأُ السجلَّ يعرفُ ما لا يحتاجُه.
 */

import { type Context, Hono } from "hono";
import {
  type DriverActivityDeps,
  type DriverActivityPublicErrorCode,
  type DriverActivityRejection,
  readDriverActivityEntries,
  readDriverActivitySummary,
} from "../../../../packages/application/driver/driver-activity.ts";

export interface DriverActivityRouteDependencies {
  /** غيابُها **يُعطّلُ المسارَينِ بـ503** ولا يجعلهما يُجيبانِ بلا قاعدةٍ. */
  readonly activity?: DriverActivityDeps;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/** خريطةُ الحالاتِ — **شاملةٌ حرفاً** لاتّحادِ رموزِ الطبقةِ. */
const STATUS_BY_ERROR: Readonly<
  Record<DriverActivityPublicErrorCode, 401 | 403 | 409 | 422 | 503>
> = {
  SESSION_REQUIRED: 401,
  SESSION_EXPIRED: 401,
  SESSION_INVALID: 401,
  SESSION_NOT_AVAILABLE: 503,
  ACTIVITY_STORE_NOT_AVAILABLE: 503,
  NOT_A_DRIVER: 403,
  // مُدّةٌ ليسَت في المجالِ المغلقِ — طلبٌ مُشوَّهٌ لا عطبُ خدمةٍ.
  PERIOD_INVALID: 422,
  // **إعدادُ مدينةٍ ناقصٌ** (منطقةُ زمنٍ) — حالُ نظامٍ لا خطأُ طالبٍ، ويُقالُ
  // `409` لا `503`: الخدمةُ قائمةٌ وتعرفُ بالضبطِ ما ينقصُها.
  WINDOW_UNRESOLVED: 409,
};

function rejected(c: Context, rejection: DriverActivityRejection) {
  return c.json({ ok: false, error: rejection.code }, STATUS_BY_ERROR[rejection.code]);
}

function bearerTokenFrom(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}

function unavailable(code: DriverActivityPublicErrorCode): DriverActivityRejection {
  return { code };
}

export function createDriverActivityRoutes(deps: DriverActivityRouteDependencies): Hono {
  const app = new Hono();

  /** «حصيلتي» — `SD-06` عدَداً وساعةً، و`SD-09` نِسَباً بمقاماتِها وعواملَ ترتيبٍ. */
  app.get("/v1/driver/activity", async (c) => {
    if (deps.activity === undefined) {
      deps.log?.("driver_activity.summary_disabled", {});
      return rejected(c, unavailable("ACTIVITY_STORE_NOT_AVAILABLE"));
    }

    const result = await readDriverActivitySummary(deps.activity, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      period: c.req.query("period"),
    });
    if (!result.ok) {
      deps.log?.("driver_activity.summary_rejected", { error: result.error.code });
      return rejected(c, result.error);
    }

    const summary = result.value;
    return c.json({
      ok: true,
      // **لحظةُ الخادمِ تُنشَرُ**: كلُّ عُمرٍ يُعرَضُ فرقٌ عنها لا عن ساعةِ جهازٍ.
      server_time: summary.serverTime,
      window: {
        period: summary.window.period,
        // منطقةُ الزمنِ **تُعرَضُ** كي يفهمَ السائقُ حدَّ «يومِه» ولا يظنَّ رقماً ضائعاً.
        timezone: summary.window.timezone,
        from: summary.window.from,
        to: summary.window.to,
      },
      rides: { completed: summary.ridesCompleted },
      attendance: {
        available_seconds: summary.attendance.availableSeconds,
        // **الفترةُ الجاريةُ تُعلَنُ**: رقمٌ ما زالَ يزيدُ لا يُقرأُ نهائيّاً.
        open: summary.attendance.open,
      },
      // **كسرٌ بمقامِه**: `rate: null` عندَ مقامٍ صفرٍ — لا صفرٌ يُقرأُ حكماً.
      acceptance: {
        numerator: summary.acceptance.numerator,
        denominator: summary.acceptance.denominator,
        rate: summary.acceptance.rate,
      },
      cancellation: {
        numerator: summary.cancellation.numerator,
        denominator: summary.cancellation.denominator,
        rate: summary.cancellation.rate,
      },
      rating: {
        average: summary.rating.average,
        count: summary.rating.count,
        trust_min_count: summary.rating.trustMinCount,
        below_trust: summary.rating.belowTrust,
      },
      ranking: {
        // **العواملُ الفعليّةُ بأوزانِها** كما تقرأُها المطابَقةُ نفسُها.
        factors: summary.rankingFactors.map((factor) => ({
          key: factor.key,
          // `null` = «لم يُضبَطْ» لا «صفرٌ» — والفرقُ يُعرَضُ ولا يُوحَّدُ.
          weight: factor.weight,
        })),
        // **الحقيقةُ كما هيَ**: لا سلوكَ يُنقِصُ الترتيبَ اليومَ.
        behaviour_affects_ranking: summary.behaviourAffectsRanking,
      },
      // **المالُ طبقةٌ غائبةٌ بإعلانٍ**: مبلغٌ معدومٌ وسببٌ منشورٌ.
      money: { amount: summary.money.amount, basis: summary.money.basis },
    });
  });

  /** «جدولُ رحلاتي» — الصفوفُ المُكتمِلةُ في النافذةِ، بلا هويّةِ راكبٍ ولا أجرةٍ. */
  app.get("/v1/driver/activity/entries", async (c) => {
    if (deps.activity === undefined) {
      deps.log?.("driver_activity.entries_disabled", {});
      return rejected(c, unavailable("ACTIVITY_STORE_NOT_AVAILABLE"));
    }

    const result = await readDriverActivityEntries(deps.activity, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      period: c.req.query("period"),
      limit: c.req.query("limit"),
    });
    if (!result.ok) {
      deps.log?.("driver_activity.entries_rejected", { error: result.error.code });
      return rejected(c, result.error);
    }

    const log = result.value;
    return c.json({
      ok: true,
      server_time: log.serverTime,
      window: {
        period: log.window.period,
        timezone: log.window.timezone,
        from: log.window.from,
        to: log.window.to,
      },
      // السقفُ **المُنفَذُ** يُنشَرُ لا المطلوبُ: العميلُ يعلمُ أنَّه قُصِرَ.
      limit: log.limit,
      entries: log.entries.map((entry) => ({
        order_id: entry.orderId,
        service: entry.service,
        matched_at: entry.matchedAt,
        started_at: entry.startedAt,
        completed_at: entry.completedAt,
        // `null` = ختمُ بدءٍ غائبٌ — لا صفرٌ يُقرأُ رحلةً لحظيّةً (`ADR 0023`).
        duration_seconds: entry.durationSeconds,
        // مسافةٌ **موسومةٌ بأساسِها** أو عَدَمٌ (`ADR 0117` §٣).
        distance:
          entry.distance === null ? null : { km: entry.distance.km, basis: entry.distance.basis },
      })),
    });
  });

  return app;
}
