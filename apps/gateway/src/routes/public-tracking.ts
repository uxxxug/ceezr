/**
 * الغرض: صفحةُ تتبّعٍ حيّ عامّة برمزٍ مؤقّت — لا تسجيلَ دخول ولا تطبيق:
 *   GET /track/:token                  صفحةُ HTML عربيّةٌ مكتفيةٌ بذاتها فيها خريطة.
 *   GET /api/track/:token/position     موقعٌ بصيغة JSON تستفتيه الصفحة كلّ ٥ ثوانٍ.
 * الحالة: منفّذ فعلياً ومركَّب في apps/gateway/src/index.ts — أُضيف في 2026-08-14
 *   (§4.2 من أمر الإطلاق التجاري).
 * ينتمي إلى: apps/gateway/src/routes
 * يُتوقع أن يستخدمه: من يفتح رابطاً أرسله له عميلُ الرحلة أو مُرسِل الطرد.
 * ملاحظات مستقبلية: لو طُلِب مسارُ الرحلة لا نقطتُها الحاليّة، تُضاف نقاطٌ إلى
 *   ردّ الموقع ويُرسم خطٌّ — ولا يتغيّر الرمزُ ولا سياسةُ الأمن.
 *
 * ## هذا الملفّ ليس `routes/tracking.ts` — وبينهما فرقٌ يجب أن يُقال
 *
 * في المستودع ملفٌّ آخر يُعلن مسارات `/track/...` هو `routes/tracking.ts`، وهو
 * **غيرُ مركَّب** بقرارٍ موثَّقٍ في رأسه (يفترض `TrackingTokenStore` بلا تنفيذ،
 * ويُكرّر تقييمَ إصلاحة GPS). وهذا الملفُّ لا علاقة له به:
 *   - ذاك يستقبل موقعاً من السائق (كتابة) بمصادقة `Bearer`؛ وهذا يقرأ موقعاً
 *     لمن يحمل رابطاً (قراءة) بلا مصادقة.
 *   - ذاك `GET /track/:driverId` — معرّفُ سائقٍ في المسار؛ وهذا `GET /track/:token`
 *     — رمزٌ عشوائيٌّ لا يدلّ على أحد.
 *   - رموزُ هذا الملفّ لها جدولٌ ودوالٌّ ذرّية (`trip_tracking_tokens`)، وله
 *     مُصدِرٌ حقيقيّ في حوار الراكب.
 * ولمّا كان ذاك غيرَ مركَّب فلا تعارضَ في المسارات فعلاً — ولو رُكِّب يوماً وجب
 * فصلُ بادئته أوّلاً (`/driver-track` مثلاً)، وهذه الملاحظةُ هي التنبيه.
 *
 * ## لماذا صفحةٌ مبنيّةٌ في الخادم لا تطبيقُ واجهة
 *
 * الصفحةُ تُفتَح مرّةً من رابطٍ في محادثةِ واتساب أو تلغرام، وغالباً على شبكةِ
 * جوّالٍ ضعيفة، ومن شخصٍ لا حسابَ له عندنا ولن يعود. فحزمةُ واجهةٍ وبناءٌ ونشرٌ
 * لصفحةٍ واحدة كلفةٌ بلا مقابل، والصفحةُ هنا وسمُ HTML واحدٌ مع نصٍّ صغير.
 *
 * ## ولماذا استفتاءٌ كلّ خمس ثوانٍ لا SSE ولا WebSocket
 *
 * المجرى المستمرّ يحتفظ باتصالٍ مفتوحٍ لكلّ متفرّج، وهؤلاء عددٌ غيرُ محدودٍ ولا
 * معروف (الرابطُ يُشارَك في مجموعة). والاستفتاءُ طلبٌ صغير ينتهي، ويتعامل مع
 * انقطاع الشبكة بلا منطق إعادةِ اتصال — والدقّةُ المطلوبة «أين هو الآن؟» لا
 * تفرّق بين لحظةٍ وخمس ثوانٍ. (ADR-0016 مسّ السؤالَ نفسه للوحة الإدارة.)
 *
 * ## `BUG-009` — ولماذا لا رقمَ ترتيبٍ في ردِّ هذه الصفحةِ
 *
 * `ADR 0053` §٣-أ/٨ يوجب أن تحمل **اللقطةُ الموثوقةُ** آخرَ رقمٍ يمثّل الحالةَ،
 * كي يُحاذي بها المستهلكُ `lastAppliedSeq` عنده. والشرطُ في نصِّه: مستهلكٌ
 * **يُطبّق أحداثاً**. وهذه الصفحةُ ليست منه:
 *
 *   - لا تشترك في حدثٍ قطُّ. لا `SSE` ولا `WebSocket` ولا ناقلَ تتبّعٍ — تستفتي
 *     `GET /api/track/:token/position` كلَّ خمس ثوانٍ وتستبدل النقطةَ بما وصل.
 *     ومن لا يُطبّق حدثاً لا `lastAppliedSeq` عنده أصلاً، فلا شيءَ يُحاذى.
 *   - وقيمةُ الرقمِ هنا ستكون **مضلّلةً** لا زائدةً فقط: الردُّ يقرأ الموقعَ من
 *     `drivers.last_location` عبرَ الدالّةِ `get_tracking_position`، وكتابةُ ذاك
 *     العمودِ غيرُ محروسةٍ بترتيبٍ إلى اليومِ — وهو `BUG-001`، ولم يُنفَّذ. فإقرانُ
 *     رقمِ جلسةٍ صاعدٍ بإحداثيّةٍ قد تكون من إصلاحةٍ أقدمَ يُعطي المتلقّي شاهداً
 *     كاذباً على حداثةِ النقطةِ.
 *
 * فالحكمُ: `BUG-009` **لا يُصلح** تراجعَ النقطةِ في مسارِ استفتاءِ العميلِ هذا،
 * ولا يزعم ذلك. مسارُ الأحداثِ صار محروساً (النشرُ من قرارِ الكتابةِ وحدَه، وبوّابةُ
 * ترتيبٍ عندَ المُرحِّلِ)، وأمّا هذا العمودُ فحرسُه `BUG-001` وحدَه. و`ADR 0053` §٦
 * يفصل الطبقتَينِ صريحاً، فلا تعارضَ يُوجب وقفاً.
 */

import { Hono, type MiddlewareHandler } from "hono";
import {
  type GetLivePositionDeps,
  getLivePosition,
} from "../../../../packages/application/tracking/get-live-position.ts";
import type { TrackingReadState } from "../../../../packages/application/tracking/tracking-token-ports.ts";
import type { ResolvedMapStyle } from "../../../../packages/maps/index.ts";
import type { PublicEnv } from "../public/security-headers.ts";
import { renderTrackingPage } from "../public/tracking-page.ts";
import type { RateLimiter } from "../rate-limit/fixed-window.ts";
import { rateLimitRejection } from "../rate-limit/guard.ts";

export interface PublicTrackingDeps extends GetLivePositionDeps {
  /** نمطُ الخريطة المُحلَّل عند الإقلاع — نفسُ ما تستعمله اللوحة. */
  readonly mapStyle: ResolvedMapStyle;
  /** رابطُ نصّ MapLibre وورقةُ أنماطه وبصمتُهما — تُمرَّر ولا تُبنى هنا. */
  readonly scriptUrl: string;
  readonly stylesheetUrl: string;
  readonly integrity: string;
  readonly log?: (message: string, meta?: Record<string, unknown>) => void;
  /**
   * وسيطُ ترويسات الأمن. يُمرَّر ليُسجَّل **قبل** المُعالِجات في هذا الموجّه نفسه:
   * Hono يُنفّذ الوسائط بترتيب تسجيلها، فوسيطٌ يُضاف بعد تسجيل المسار لا يعمل
   * قبله — والصفحةُ تحتاج الـ`nonce` موضوعاً على السياق قبل أن تُصيَّر.
   *
   * **ومُلزِمٌ لا اختياريٌّ** (`SEC-06` · `ADR 0135`): كانَ
   * `securityHeaders?` ومُركَّباً بشرطِ `!== undefined`، فكانَ نسيانُه في مُنشِئٍ
   * واحدٍ يُخرِجُ صفحةً عامّةً **عاريةً** بلا سياسةِ محتوىً ولا منعِ تأطيرٍ ولا
   * كتمِ مُحيلٍ — **بلا خطأٍ ولا تحذيرٍ ولا سطرِ سجلٍّ**. وهذا أخطرُ من غيابِ
   * الوسيطِ أصلاً لأنَّ الوسيطَ موجودٌ فيُقرَأُ تغطيةً. فصارَ حقلاً مطلوباً:
   * المُترجِمُ يرفضُ المُنشِئَ الذي يُهمِلُه.
   */
  /**
   * حاصرا المعدَّلِ **بمفتاحِ الرمزِ لا العنوانِ**: وُصلةُ التتبّعِ تُرسَلُ في
   * محادثةٍ فيفتحُها أهلُ الراكبِ من عناوينَ شتّى — والمحميُّ رحلةٌ لا شبكةٌ.
   * يُمرَّرانِ من موضعِ التركيبِ بأرقامِ `rate-limit/policy.ts` (`SEC-07`).
   */
  readonly limits?: {
    readonly perTokenPage: RateLimiter;
    readonly perTokenPosition: RateLimiter;
  };
  readonly securityHeaders: MiddlewareHandler<PublicEnv>;
}

const NOT_FOUND = 404 as const;
const SERVICE_UNAVAILABLE = 503 as const;

/**
 * مدّةُ الاستفتاء بالثواني. فاصلٌ تقنيٌّ لا قيمةٌ تجارية: لا يُسعّر شيئاً ولا
 * يُحدّد استحقاقاً، ونظيرُه `LIVE_REFRESH_SECONDS` في لوحة الإدارة.
 */
export const POSITION_POLL_SECONDS = 5;

/**
 * أقصى طولٍ لرمزٍ يُقبل النظرُ فيه. الرمزُ عندنا ٦٤ محرفاً بالضبط، والحدُّ هنا
 * يمنع مساراً بطول ميغابايت من أن يصل القاعدة أصلاً.
 */
const MAX_TOKEN_LENGTH = 128;

/** الرمزُ hex محضٌ — وأيُّ محرفٍ سواه لا يمكن أن يكون رمزاً أصدرناه. */
const TOKEN_PATTERN = /^[0-9a-f]{32,128}$/;

/**
 * حمولةُ الاستفتاءِ.
 *
 * ## إضافةُ البند F2-09 (2026-09-14): عُمرٌ وسببٌ بدلَ ختمٍ مطلقٍ
 *
 * كانَ الحقلُ `updated_at` ختماً مطلقاً تطرحُه الصفحةُ من ساعةِ الجهازِ — وجهازٌ
 * مضبوطٌ خطأً كانَ يُري حاملَ الرابطِ نقطةً «طازجةً» وهيَ متقادمةٌ. فصارَ
 * `age_seconds` **مقيساً في القاعدةِ**، وصارَ معَه `stale_reason` كي تُقالَ
 * الحقيقةُ صريحةً: «انقطعَت إشارتُه» لا «جارٍ التحديثُ» إلى الأبدِ.
 *
 * **ولا حقلَ هويّةٍ زيدَ**: لا اسمَ ولا لوحةَ ولا معرّفَ طلبٍ — وهذا الغيابُ
 * محروسٌ ساكناً في `scripts/check-ride-share-contract.ts`.
 */
interface PositionPayload {
  readonly lat: number | null;
  readonly lng: number | null;
  /** عُمرُ النقطةِ بالثواني كما قاسَته القاعدةُ — و`null` متى لا ختمَ أصلاً. */
  readonly age_seconds: number | null;
  /** `null` متى كانَ الموقعُ معروضاً؛ وإلّا سببُ الحجبِ مُصنَّفاً. */
  readonly stale_reason: "NEVER_REPORTED" | "NO_TIMESTAMP" | "TOO_OLD" | null;
  readonly active: boolean;
}

function toPayload(state: TrackingReadState): PositionPayload | null {
  if (state.kind === "invalid") return null;
  if (state.kind === "awaiting") {
    return {
      lat: null,
      lng: null,
      age_seconds: state.ageSeconds,
      stale_reason: state.reason,
      active: state.active,
    };
  }
  return {
    lat: state.position.lat,
    lng: state.position.lng,
    age_seconds: state.position.ageSeconds,
    stale_reason: null,
    active: state.active,
  };
}

export function createPublicTrackingRoutes(deps: PublicTrackingDeps): Hono<PublicEnv> {
  const app = new Hono<PublicEnv>();
  // بلا شرطٍ: الشرطُ كانَ يجعلُ الوسيطَ وعداً لا ضماناً (`SEC-06` · `ADR 0135`).
  app.use("*", deps.securityHeaders);

  /**
   * ردُّ الموقع. **الأخصّ أوّلاً** يُطبَّق هنا داخل الموجّه نفسه: المسار الحرفيّ
   * `/api/track/:token/position` مُعلَنٌ قبل صفحة `/track/:token`، وهما لا يتشابهان
   * في البادئة أصلاً فلا التقاطَ خاطئاً — والترتيبُ مُحافظٌ على العادة لا أكثر.
   */
  app.get("/api/track/:token/position", async (c) => {
    const token = c.req.param("token");
    // رمزٌ لا يوافق شكلَ ما نُصدره: 404 بلا نداءِ قاعدةٍ. وسببُ توحيد الردّ مع
    // «غير موجود» أنّ التفريق كان سيُخبر من يجرّب أنّ شكلَه صحيحٌ وقيمتَه خاطئة.
    if (token.length > MAX_TOKEN_LENGTH || !TOKEN_PATTERN.test(token)) {
      return c.json({ error: "NOT_FOUND" }, NOT_FOUND);
    }

    /**
     * الحدُّ **بعدَ فحصِ الشكلِ وقبلَ نداءِ القاعدةِ**: بعدَه كي لا يُنشَأَ مفتاحُ
     * عدٍّ لكلِّ نصٍّ عشوائيٍّ فيُتَّخذَ الحاصرُ نفسُه سبيلاً لإتخامِ الذاكرةِ،
     * وقبلَه كي لا يُدفَعَ ثمنُ استعلامٍ لكلِّ نداءٍ (`SEC-07`).
     */
    const exceeded = rateLimitRejection(
      c,
      await deps.limits?.perTokenPosition.hit(`track-position:${token}`),
    );
    if (exceeded !== null) return exceeded;

    const result = await getLivePosition(token, deps);
    if (!result.ok) {
      // عطلُ قاعدةٍ ليس رمزاً منتهياً: 503 كي يُقرأ عطلاً في المراقبة، ولا يُقال
      // للمنتظِر «انتهى الرابط» وهو سليم.
      deps.log?.("track.position.failure", { detail: result.error.detail });
      return c.json({ error: "UNAVAILABLE" }, SERVICE_UNAVAILABLE);
    }

    const payload = toPayload(result.value);
    if (payload === null) return c.json({ error: "NOT_FOUND" }, NOT_FOUND);
    return c.json(payload);
  });

  /**
   * الصفحة. تُصيَّر بالحالة الأولى مُحمّلةً فيها (لا شاشةَ تحميلٍ فارغة على شبكةٍ
   * بطيئة)، ثمّ يُحدِّثها الاستفتاء.
   */
  app.get("/track/:token", async (c) => {
    const token = c.req.param("token");
    if (token.length > MAX_TOKEN_LENGTH || !TOKEN_PATTERN.test(token)) {
      return c.html(renderTrackingPage({ kind: "not-found", nonce: c.get("cspNonce") }), NOT_FOUND);
    }

    /**
     * تجاوزُ الصفحةِ يُجابُ **جسمَ `JSON` معَ `Retry-After`** لا صفحةً: لم يُخترَعْ
     * لِـ`renderTrackingPage` طَورٌ سادسٌ لحالةٍ لا يبلغُها راكبٌ بيدِه، وشكلُ
     * الجوابِ واحدٌ في كلِّ البوّابةِ فيُقاسُ مرّةً. **وما لا يُدَّعى** (`ح-5`):
     * ليسَ للتجاوزِ ههنا صفحةٌ عربيّةٌ مُصيَّرةٌ.
     */
    const exceeded = rateLimitRejection(
      c,
      await deps.limits?.perTokenPage.hit(`track-page:${token}`),
    );
    if (exceeded !== null) return exceeded;

    const result = await getLivePosition(token, deps);
    if (!result.ok) {
      deps.log?.("track.page.failure", { detail: result.error.detail });
      return c.html(
        renderTrackingPage({ kind: "unavailable", nonce: c.get("cspNonce") }),
        SERVICE_UNAVAILABLE,
      );
    }
    if (result.value.kind === "invalid") {
      return c.html(renderTrackingPage({ kind: "not-found", nonce: c.get("cspNonce") }), NOT_FOUND);
    }

    return c.html(
      renderTrackingPage({
        kind: "live",
        nonce: c.get("cspNonce"),
        token,
        pollSeconds: POSITION_POLL_SECONDS,
        initial: toPayload(result.value),
        mapStyle: deps.mapStyle,
        scriptUrl: deps.scriptUrl,
        stylesheetUrl: deps.stylesheetUrl,
        integrity: deps.integrity,
      }),
    );
  });

  return app;
}
