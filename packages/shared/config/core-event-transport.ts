/**
 * الغرض: ثوابتُ **ناقلِ** أحداثِ الحدِّ مع CORE في اتّجاهَيه: مسارُ الإرسالِ
 *    وترويساتُه ومهلتُه وتصنيفُ ردودِه، وحدودُ الاستقبالِ وترويسةُ توقيعِه. مصدرُ
 *    كلِّ قيمةٍ ههنا عقدٌ منقولٌ في `docs/contracts/core/transport/`، لا اختيارٌ
 *    منّا. البند `W-5` (ناقلٌ).
 * الحالة: منفّذ فعلياً — 2026-09-12.
 * ينتمي إلى: packages/shared/config
 * يُستخدم من: `packages/infrastructure/wasla/core-event-shipper.ts`، و
 *    `apps/gateway/src/routes/core-event-intake.ts`، و
 *    `scripts/check-core-contract-parity.ts` (يُقابِلُها بالعقدِ المنقولِ).
 * ملاحظات مستقبلية: عنوانُ CORE ورمزُ حاملِه وسرُّ التوقيعِ **لا تُكتَبُ ههنا**
 *    ولا تُقرأُ ههنا من البيئةِ: تُمرَّرُ وسائطَ عندَ التركيبِ فيبقى هذا الملفُّ
 *    قابلاً للاستيرادِ في اختبارٍ بلا بيئةٍ. وأسماءُ متغيّراتِ البيئةِ مُعلَنةٌ
 *    أدناهُ لتكونَ مصدرَ حقيقةٍ واحداً لفحصِ انسياقِ البيئةِ.
 *
 * ## لِمَ ثوابتُ الناقلِ في ملفٍّ لا في المُحوِّلِ
 *
 * لأنَّ حاجزَ المطابقةِ يجبُ أن يقرأَها **بلا تشغيلِ شبكةٍ**: قيمةٌ مدفونةٌ في
 * جسمِ دالّةٍ لا يقرأُها حاجزٌ إلّا بتعبيرٍ نمطيٍّ هشٍّ، وقيمةٌ مُصدَّرةٌ يقرأُها
 * باستيرادٍ. فالتصديرُ ههنا شرطُ الإنفاذِ الآليِّ لا زينةَ تنظيمٍ.
 *
 * ## ولِمَ التصنيفُ دالّةٌ لا جدولُ حالاتٍ مكتوبٌ في موضعَينِ
 *
 * تصنيفُ الردِّ حكمٌ واحدٌ يلزمُ الناقلَ والعاملَ والاختبارَ. فلو كُتِبَ في كلٍّ
 * منها انحرفَ أحدُها يوماً، ولا يكشفُه أحدٌ لأنَّ كليهما «صحيحٌ» في موضعِه. فهوَ
 * دالّةٌ واحدةٌ تُنادى، وحاجزُ المطابقةِ يُقابِلُ ناتجَها بجدولِ العقدِ المنقولِ
 * صفّاً صفّاً.
 */

/** مسارُ إيداعِ حدثٍ في CORE — `contracts/openapi/core-v1.yaml` المنقولُ. */
export const CORE_EVENT_SUBMIT_PATH = "/v1/events";

/** ترويسةُ هويّةِ الحدثِ في التسليمِ الصادرِ من CORE إلينا. */
export const CORE_EVENT_ID_HEADER = "x-wasla-event-id";

/** ترويسةُ توقيعِ CORE على البايتاتِ المُرسَلةِ إلينا. */
export const CORE_EVENT_SIGNATURE_HEADER = "x-wasla-signature";

/** بادئةُ التوقيعِ: `sha256=<hex>` — البادئةُ جزءٌ من العقدِ لا تجميلٌ. */
export const CORE_EVENT_SIGNATURE_PREFIX = "sha256=";

/**
 * مهلةُ الإيداعِ. اختيارُنا لا اختيارُ العقدِ: أقصرُ من مهلةِ العاملِ حتّى تنتهيَ
 * المحاولةُ بحكمٍ مكتوبٍ («مهلةٌ ⇒ أَعِدْ») لا بقتلِ العاملِ بلا سببٍ مسجَّلٍ.
 */
export const CORE_EVENT_SUBMIT_TIMEOUT_MS = 10_000;

/** رمزُ النجاحِ المنصوصُ في العقدِ للإيداعِ: `202 Accepted`. */
export const CORE_EVENT_SUBMIT_ACCEPTED_STATUS = 202;

/**
 * رمزا `4xx` اللذانِ ينصُّ العقدُ على إعادتِهما استثناءً من قاعدةِ «سائرُ `4xx`
 * موتٌ»: مهلةُ الطلبِ، وكثرةُ الطلباتِ.
 */
export const CORE_EVENT_RETRYABLE_CLIENT_STATUSES: readonly number[] = [408, 429];

/** أقصرُ سرِّ توقيعٍ يقبلُه CORE للاشتراكِ — فلا نقبلُ أضعفَ ممّا يُصدِرُ. */
export const CORE_INBOUND_MIN_SECRET_LENGTH = 32;

/** حدُّ جسمِ الحدثِ الواردِ. مغلَّفُ CORE أصغرُ من هذا بمراتبَ. */
export const CORE_INBOUND_MAX_BYTES = 256 * 1024;

/** أسماءُ متغيّراتِ البيئةِ — مُعلَنةٌ لتُفحَصَ آليّاً لا لتُخمَّنَ. */
export const CORE_EVENT_TRANSPORT_ENV = {
  baseUrl: "CORE_EVENTS_BASE_URL",
  bearerToken: "CORE_EVENTS_BEARER_TOKEN",
  inboundSigningSecret: "CORE_INBOUND_SIGNING_SECRET",
} as const;

/** حكمُ المحاولةِ الواحدةِ. `dead` تعني «لا تُعِدْ»، لا «فشلَ النظامُ». */
export type CoreSubmitVerdict = "delivered" | "retry" | "dead";

/**
 * تصنيفُ ردٍّ ذي رمزٍ، وفقَ جدولِ العقدِ المنقولِ:
 * `2xx` تسليمٌ · `5xx` إعادةٌ · `408` و`429` إعادةٌ · سائرُ `4xx` موتٌ فوريٌّ.
 * وما دونَ `200` أو فوقَ `599` لا ينصُّ عليه العقدُ، فيُعادُ احتياطاً لا يُماتُ:
 * الموتُ حكمٌ لا يُبنى على فراغٍ.
 */
export function classifyCoreSubmitStatus(status: number): CoreSubmitVerdict {
  if (status >= 200 && status < 300) return "delivered";
  if (status >= 500 && status < 600) return "retry";
  if (CORE_EVENT_RETRYABLE_CLIENT_STATUSES.includes(status)) return "retry";
  if (status >= 400 && status < 500) return "dead";
  return "retry";
}
