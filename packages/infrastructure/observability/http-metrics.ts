/**
 * الغرض: قواعدُ وسمِ مقاييسِ الحافةِ (`F8-02`) — تحويلُ قالبِ المسارِ ورمزِ الحالةِ
 *   إلى وسومٍ **محدودةِ التعدُّدِ**، بلا شبكةٍ ولا حالةٍ ولا استيرادِ إطارٍ.
 * الحالة: منفّذ فعلياً — طبقة المراقبة التشغيلية.
 * ينتمي إلى: packages/infrastructure/observability
 * يُتوقع أن يستخدمه لاحقاً: وسيطُ البوابةِ `apps/gateway/src/observability/http-metrics.ts`.
 * ملاحظات مستقبلية: لا يُضافُ وسمٌ من جسمِ الطلبِ ولا من استعلامِه ولا من رأسٍ يرسله العميل.
 *
 * ## لماذا **قالبُ** المسارِ لا المسارُ نفسُه
 *
 * `/v1/driver/offers/8f2c…/accept` مسارٌ واحدٌ في السجلِّ **وسلسلةٌ مستقلّةٌ في
 * Prometheus**. ووسمٌ يحملُ معرِّفاً يُنشئُ سلسلةً لكلِّ طلبٍ، فينفجرُ التعدُّدُ
 * ويُسقِطُ المُجمِّعَ قبلَ أن يُسقِطَ النظامَ عطبٌ حقيقيٌّ — **مراقبةٌ تصيرُ هيَ
 * العطب**. فالوسمُ **قالبُ المسارِ** (`/v1/driver/offers/:offerId/accept`): عددُه
 * محدودٌ بعددِ المساراتِ المُعرَّفةِ في الشِفرةِ، لا بعددِ الطلباتِ.
 *
 * وما لم يُطابِقْ شكلَ القالبِ — أو كانَ جامعاً (`*`) أو فارغاً — يُوسَمُ
 * `other`. **والسقوطُ إلى `other` ليسَ إخفاءً**: العدُّ يبقى، والمفقودُ تفصيلُ
 * المسارِ وحدَه. وبقاءُ الطلبِ بلا عدٍّ أسوأُ.
 */

/** وسمُ ما لم يُعرَفْ له قالبٌ — قيمةٌ واحدةٌ لا تنمو. */
export const ROUTE_LABEL_UNKNOWN = "other";

/** أقصى عددِ مقاطعَ في قالبٍ مقبولٍ — حدٌّ أعلى مُعلَنٌ لا حكمَ ذوقٍ. */
export const MAX_ROUTE_SEGMENTS = 8;

/** أقصى طولِ وسمِ مسارٍ — رأسٌ طويلٌ لا يصيرُ اسمَ سلسلةٍ. */
export const MAX_ROUTE_LABEL_LENGTH = 120;

/** الطرائقُ المُعلَنةُ؛ وما سواها يُوسَمُ `other` فلا يُدخِلُ نصّاً حرّاً في وسمٍ. */
export const KNOWN_HTTP_METHODS = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
] as const;

export type KnownHttpMethod = (typeof KNOWN_HTTP_METHODS)[number];

/** أصنافُ الحالةِ — خمسةٌ لا أكثرُ، و`unknown` لما خرجَ عن مدى HTTP. */
export type HttpStatusClass = "1xx" | "2xx" | "3xx" | "4xx" | "5xx" | "unknown";

/** وسيطٌ مُعلَنٌ في القالبِ (`:offerId`) — قيمتُه لا تدخلُ الوسمَ أصلاً. */
const PARAM_SEGMENT = /^:[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * مقطعٌ حرفيٌّ: حروفٌ وشُرَطٌ، **ولا رقمَ إلّا في وسمِ إصدارٍ** (`v1`).
 *
 * ولمَ مُنِعَ الرقمُ؟ لأنَّ القالبَ قد لا يصلُ: مسارٌ يُمرَّرُ خامّاً من موضعِ
 * نداءٍ مخطِئٍ (أو من إطارٍ لا يعرِفُ القالبَ) يبدو سليمَ الشكلِ:
 * `/v1/rides/8f2c1b90-0000-4000-8000-000000000001` حروفٌ وشُرَطٌ وأرقامٌ. فلو قُبِلَ
 * **لصارَ لكلِّ رحلةٍ سلسلةٌ**. ومساراتُ هذا المستودَعِ لا تحملُ رقماً في
 * مقطعٍ حرفيٍّ إلّا وسمَ الإصدارِ، فالحدُّ يكلِّفُ ما لا يُنفَقُ، ويمنعُ ما
 * لا يُستدرَكُ إلّا في الإنتاجِ. ومن أدخلَ مساراً ذا رقمٍ قصداً وسَمَه `other`
 * حتّى يُوسَّعَ الحدُّ عمداً — **وفقدُ تفصيلٍ أهونُ من إسقاطِ المُجمِّعِ**.
 */
const LITERAL_SEGMENT = /^(?:[A-Za-z][A-Za-z_.-]*|v\d+)$/;

/**
 * يُطبِّعُ الطريقةَ: ما ليسَ من الطرائقِ المُعلَنةِ يصيرُ `other`. وطريقةٌ حرّةٌ
 * (`PROPFIND` أو نصٌّ ملفَّقٌ من عميلٍ) لو مرَّت وسماً لفتحَت بابَ تعدُّدٍ يتحكَّمُ
 * فيهِ **من يُرسِلُ الطلبَ** لا من يكتبُ الشِفرةَ.
 */
export function methodLabel(method: string): KnownHttpMethod | typeof ROUTE_LABEL_UNKNOWN {
  const upper = method.toUpperCase();
  return (KNOWN_HTTP_METHODS as readonly string[]).includes(upper)
    ? (upper as KnownHttpMethod)
    : ROUTE_LABEL_UNKNOWN;
}

/**
 * يُطبِّعُ قالبَ المسارِ. المقبولُ: يبدأُ بشرطةٍ مائلةٍ، ومقاطعُه حروفٌ وأرقامٌ
 * وشُرَطٌ (أو وسيطٌ ببادئةِ `:`)، وعددُها لا يتجاوزُ الحدَّ المُعلَنَ. وما عدا
 * ذلكَ — ومنه الجامعُ `*` والفارغُ وغيرُ المُعرَّفِ — يصيرُ `other`.
 */
export function routeLabel(routePath: string | undefined | null): string {
  if (routePath === undefined || routePath === null) return ROUTE_LABEL_UNKNOWN;
  const trimmed = routePath.trim();
  if (trimmed === "" || !trimmed.startsWith("/")) return ROUTE_LABEL_UNKNOWN;
  if (trimmed.length > MAX_ROUTE_LABEL_LENGTH) return ROUTE_LABEL_UNKNOWN;
  if (trimmed === "/") return "/";
  const segments = trimmed.slice(1).split("/");
  if (segments.length > MAX_ROUTE_SEGMENTS) return ROUTE_LABEL_UNKNOWN;
  for (const segment of segments) {
    if (PARAM_SEGMENT.test(segment)) continue;
    if (!LITERAL_SEGMENT.test(segment)) return ROUTE_LABEL_UNKNOWN;
  }
  return trimmed;
}

/** صنفُ الحالةِ لا رمزُها: خمسُ قيمٍ تكفي للإنذارِ، والرمزُ التفصيليُّ في السجلِّ. */
export function statusClass(status: number): HttpStatusClass {
  if (!Number.isFinite(status)) return "unknown";
  const hundreds = Math.trunc(status / 100);
  switch (hundreds) {
    case 1:
      return "1xx";
    case 2:
      return "2xx";
    case 3:
      return "3xx";
    case 4:
      return "4xx";
    case 5:
      return "5xx";
    default:
      return "unknown";
  }
}
