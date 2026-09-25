/**
 * الغرض: واجهة مزوّد التوجيه (Routing) — تجريد صرف.
 *   أيّ مزوّد (OSRM، Valhalla، Google) يُحقن عبر هذه الواجهة.
 *   تبديل المزوّد لا يُغيّر أي كود أعلى.
 * الحالة: منفّذ فعلياً — المرحلة 1.
 * ينتمي إلى: packages/maps/core
 */

import type { LatLng, NearestResult, ProviderName, RouteResult } from "./types.ts";

/** خيارات حساب المسار. */
export interface RouteOptions {
  /** نقطة البداية. */
  readonly origin: LatLng;
  /** نقطة النهاية. */
  readonly destination: LatLng;
  /** نقاط وسيطة اختيارية. */
  readonly waypoints?: readonly LatLng[];
  /** وضع التنقّل. */
  readonly profile?: "driving" | "walking" | "cycling";
  /** هل نريد خطوات تفصيلية؟ */
  readonly steps?: boolean;
}

/** خيارات البحث عن الأقرب. */
export interface NearestOptions {
  /** الموقع المرجعي. */
  readonly point: LatLng;
  /** عدد النتائج المطلوبة. */
  readonly count?: number;
  /** نصف قطر البحث بالمتر. */
  readonly radiusMeters?: number;
}

/**
 * مزوّد التوجيه — يوفّر: حساب المسار، البحث عن الأقرب، مصفوفة المسافات.
 * لا يحتوي على أي حالة (stateless) — كل استدعاء مستقل.
 */
export interface RoutingProvider {
  readonly name: ProviderName;

  /** يحسب المسار بين نقطتين (أو أكثر). */
  route(options: RouteOptions): Promise<Result<RouteResult, RoutingError>>;

  /** يبحث عن أقرب النقاط/السائقين لموقع معيّن. */
  nearest(options: NearestOptions): Promise<Result<NearestResult, RoutingError>>;

  /** يحسب مصفوفة مسافات/أزمنة بين مجموعة مصادر ووجهات. */
  table(
    sources: readonly LatLng[],
    destinations: readonly LatLng[],
  ): Promise<Result<DistanceMatrix, RoutingError>>;
}

/** نتيجة مصفوفة المسافات. */
export interface DistanceMatrix {
  readonly rows: readonly DistanceMatrixRow[];
}

export interface DistanceMatrixRow {
  readonly elements: readonly DistanceMatrixElement[];
}

/**
 * عنصر المصفوفة — اتحادٌ مُميَّز لا سجلٌّ بحقولٍ اختيارية، والفرق ليس تجميلاً.
 *
 * كان النوع `{ distanceMeters: number; durationSeconds: number; status }`،
 * و`status: "no_route"` مُعلنٌ فيه ولا يُنتَج قطّ: المزوّد كان يضع `"ok"` دائماً.
 * وOSRM يعيد `null` للأزواج غير الموصولة، فكان `distanceMeters` يحمل `null` في
 * حقلٍ نوعُه `number` (كذبةٌ في النوع نفسه)، و`durationSeconds` يصير صفراً بـ
 * `?? 0` — أي «الوصول فوري» بدل «لا طريق». وهي نفس علّة المرحلة ٨.
 *
 * وبالاتحاد لا يستطيع مستهلكٌ قراءة رقمٍ قبل فحص `status`: المُصرِّف يمنعه. أما
 * الحقول الاختيارية فتدعو إلى `?? 0` — وهو ما نُصلحه أصلاً.
 */
export type DistanceMatrixElement =
  | {
      readonly status: "ok";
      readonly distanceMeters: number;
      readonly durationSeconds: number;
    }
  | {
      readonly status: "no_route";
    };

/**
 * صنفُ عطل التوجيه — يُميّز «المزوّد لا يعمل» من «المزوّد أجاب: لا طريق».
 *
 * الفرق قرارٌ لا وصف: الأول يستحقّ سقوطاً آمناً إلى تقديرٍ تقريبي (هافرساين)،
 * والثاني **جوابٌ صحيح** لا يجوز تجميلُه بتقديرٍ تقريبي — لأن الطريق غير موجود.
 * وبلا هذا التمييز كان على المستهلك أن يقرأ نصّ `detail` بتعبيرٍ نمطي ليقرّر،
 * وهو ما يجعل تغييرَ رسالةٍ يكسر منطقَ سقوطٍ في موضعٍ آخر بلا أن يُلاحظ.
 */
export type RoutingErrorKind =
  /** انتهت الميزانية الزمنية قبل أن يردّ المزوّد. */
  | "timeout"
  /** لا اتصال بالمزوّد أصلاً (رفض اتصال، DNS، قطع شبكة). */
  | "unreachable"
  /** المزوّد قال صراحةً «أكثرتَ» (429). */
  | "rate_limited"
  /** عطلٌ في المزوّد (5xx). */
  | "server_error"
  /** نداءٌ مرفوض بحكمٍ نهائي (4xx غير 429). */
  | "client_error"
  /** ردٌّ لا يطابق ما تعِد به الوثائق: حقلٌ ناقص أو مقاسٌ مخالف. */
  | "protocol"
  /** المزوّد أجاب: لا طريق بين هذين الموضعين. جوابٌ لا عطل. */
  | "no_route"
  /** مدخلاتُ النداء نفسها غير صالحة — يُكتشف قبل أي شبكة. */
  | "invalid_request"
  /**
   * قاطعُ الدائرةِ مفتوحٌ فالنداءُ **لم يُرسَلْ** (`F8-04`). ويُفرَدُ عن `timeout`
   * لأنَّ الخلطَ يُنتجُ في اللوحةِ «المزوّدُ بطيءٌ» وهوَ لم يُسأَلْ أصلاً.
   */
  | "circuit_open"
  /**
   * ضِيقُ حدِّ التزامنِ عندَنا لا عندَ المزوّدِ (`F8-04`). وهوَ حكمٌ على سعتِنا،
   * فنسبتُه إلى المزوّدِ تَظلِمُه وتُخفي عنّا الحدَّ الذي بلغناه.
   */
  | "saturated"
  /**
   * الحدُّ **المُعلَنُ في عقدِ حسابِ المزوّدِ** (`REQ-09` · `ADR 0190`) بلغَ نهايتَه
   * عندَنا فالنداءُ **لم يُرسَلْ**. ويُفرَدُ عن `rate_limited` لأنَّ ذاكَ قولُ المزوّدِ
   * بعدَ أن دُفِعَ ثمنُ النداءِ، وهذا امتناعُنا قبلَه؛ وعن `saturated` لأنَّ ذاكَ حدُّ
   * تزامنِنا لا حدُّ الحسابِ. لا يُعادُ فوراً ولا يُحتسَبُ عطلاً عندَ القاطعِ.
   */
  | "quota_exhausted";

/**
 * حصّةُ طلباتِ HTTP إلى المزوّدِ (`REQ-09` · `ADR 0190`). تُستشارُ **قبلَ كلِّ طلبٍ**
 * — المحاولةُ الثانيةُ طلبٌ مُفوتَرٌ كالأولى — ولا ترمي أبداً. شكلُها يطابقُ
 * `RateLimiter` في البوّابةِ بنيويّاً فيُمرَّرُ حدُّ `Redis` نفسُه حينَ تتعدّدُ النسخُ.
 */
export interface RoutingQuota {
  hit(key: string): Promise<{ readonly allowed: boolean; readonly resetSeconds: number }>;
}

/** مفتاحُ الحصّةِ: واحدٌ للحسابِ كلِّه لا لكلِّ مسارٍ ولا لكلِّ نسخةٍ. */
export const ROUTING_QUOTA_KEY = "routing-provider";

/**
 * ما يستحقّ محاولةً ثانية، في **جدولٍ واحد** لكل المزوّدين.
 *
 * موضعُه هنا لا في ملفّ المزوّد قرارٌ مقصود: من أضاف Valhalla أو Google (المرحلة
 * ٢٩) سيحتاج نفس التمييز، ونسخُه في كل مزوّد يعني جداول قرارٍ تتباعد صامتةً.
 *
 *   * `timeout` و`unreachable` و`server_error`: أعطالٌ عابرة بطبيعتها، والإعادة
 *     هي بالضبط ما يُصلحها.
 *   * `rate_limited`: نداءٌ ثانٍ فوري يُطيل الحظر لا يرفعه.
 *   * `client_error` و`invalid_request` و`protocol`: نتيجةٌ محسومة لن تتغيّر،
 *     وإعادتُها تُضاعف الكلفة وتُؤخّر ردّاً معروفاً.
 *   * `no_route`: ليس عطلاً أصلاً. إعادتُه سؤالٌ عن جوابٍ وصل.
 *   * `circuit_open` و`saturated`: ردٌّ من حاجزِنا لا من المزوّدِ (`F8-04`).
 *     وإعادتُهما فوراً هي بعينِها ما فتحَ القاطعَ وأشبعَ الحدَّ، فالإعادةُ ههنا
 *     تُطيلُ العطلَ. والانتظارُ المشروعُ مُعلَنٌ في `retryAfterMs` من الحاجزِ.
 */
export function deservesRoutingRetry(kind: RoutingErrorKind): boolean {
  return kind === "timeout" || kind === "unreachable" || kind === "server_error";
}

/** خطأ من مزوّد التوجيه. */
export class RoutingError {
  readonly code = "ROUTING_FAILURE" as const;
  constructor(
    readonly provider: ProviderName,
    readonly detail: string,
    /**
     * الصنف. اختياريٌّ للتوافق مع مواضع نداءٍ سابقة، ويُقرأ `"unreachable"` عند
     * غيابه — أي الافتراض المتحفّظ: «عطلٌ عابر» لا «جوابٌ نهائي».
     */
    readonly kind: RoutingErrorKind = "unreachable",
  ) {}
}

import type { Result } from "../../shared/result/index.ts";
