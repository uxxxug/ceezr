/**
 * الغرض: سجلُّ الطوابيرِ الصامدةِ وأبعادِ ضغطِها العكسيِّ — **مصدرُ الحقيقةِ
 *    الواحدُ** لسؤالِ: أيُّ طوابيرَ عندَنا؟ وأينَ يسكنُ كلُّ حدٍّ من حدودِها
 *    الستّةِ؟ يقرؤه حارسُ `scripts/check-queue-backpressure.ts` وكودُ التشغيلِ معاً.
 *    البند `F6-06`.
 * الحالة: منفّذ فعلياً — 2026-09-09.
 * ينتمي إلى: shared/config
 * يُستخدم من: `scripts/check-queue-backpressure.ts`،
 *    `packages/infrastructure/db/queue-backpressure.ts`، `tests/unit/queue-backpressure.test.ts`
 *
 * ## لماذا سجلٌّ لا حدودٌ
 *
 * هذا الملفُّ **لا يحملُ رقماً واحداً**. وهوَ مقصودٌ: حدودُ طابورِ الصادرِ سياسةٌ
 * لكلِّ مدينةٍ فتسكنُ `platform_settings` (القاعدةُ ٠.٣)، وحدودُ طابورِ الوارِدِ
 * حدودٌ تقنيّةٌ لا مدينةَ لها فتسكنُ ثوابتَ `domain-ingress.ts`. فلو نُسِخَت
 * الأرقامُ ههنا لصارَ للحدِّ موضعانِ — وهوَ العطبُ الذي تمنعُه القاعدةُ ٠.٣ نفسُها.
 * فما ههنا **عناوينُ** الحدودِ لا قيمُها: مفتاحٌ يُقرأُ، أو اسمُ ثابتٍ يُصدَّرُ.
 *
 * ## لماذا سكنَ حدُّ كلِّ طابورٍ حيثُ سكن
 *
 * القاعدةُ الحاسمةُ: **كلُّ بُعدٍ يسكنُ حيثُ يسكنُ حدُّ إعادةِ المحاولةِ لطابورِه
 * سلفاً** — فلا يُبتدَعُ موضعٌ ثالثٌ ولا يُخالَفُ اختيارٌ سابقٌ.
 *
 * - `notification_outbox`: يحملُ `city_id` حقيقيّاً، وسقفُ محاولاتِه يسكنُ
 *   `platform_settings` منذُ `20260905030000` بمفتاحِ
 *   `notification_delivery_max_attempts`. فأخواتُه الخمسُ تسكنُ معه: صفٌّ لكلِّ
 *   مدينةٍ، تُبذَرُ في هذه الترحيلةِ، وتُورَّثُ لكلِّ مدينةٍ جديدةٍ آليّاً عبرَ
 *   `cities_seed_settings` القائمِ (`20260814050000`) — فلا مُطلِّبَ جديدٌ يُضاف.
 *
 * - `telegram_update_jobs`: من صنفِ `domain-ingress receipt` — **لا `city_id` له**
 *   بنصِّ الملحقِ الحاكمِ 2026-09-07، ومِلءُ `city_id` بقيمةٍ مصطنَعةٍ أو
 *   «أوّلِ مدينةٍ نشطةٍ» **منهيٌّ عنه نهياً مطلقاً** في القاعدةِ ٠.٤. وقراءةُ حدٍّ
 *   من مدينةٍ عشوائيّةٍ (`where key = … limit 1`) كذبٌ من الجهةِ الأخرى — وهوَ عطبٌ
 *   قائمٌ في `claim_notification_delivery` لا يُوسَّعُ. فحدودُه ثوابتُ مُعلَنةٌ في
 *   `packages/shared/config/domain-ingress.ts` حيثُ يسكنُ `TELEGRAM_JOB_MAX_ATTEMPTS`
 *   بالحُجّةِ المكتوبةِ هناك حرفاً: «حدٌّ تشغيليٌّ تقنيٌّ لا سياسةٌ تجاريّةٌ، فلا
 *   مكانَ له في `platform_settings`». وتُمرَّرُ وسائطَ إلى دوالِّ القاعدةِ فلا
 *   رقمَ محفورٌ فيها.
 *
 * ## ما يمنعُه الحارسُ فعلاً
 *
 * أنَّ **طابوراً جديداً يُولَدُ بلا ضغطٍ عكسيٍّ**. جدولٌ فيه `status` و`attempts`
 * و`claim_token` و`next_attempt_at` طابورٌ صامدٌ بالبناءِ لا بالتسميةِ، فإن ظهرَ
 * في ترحيلةٍ ولم يُعلَن ههنا سقطَ الحارسُ. وهذا هوَ الإنفاذُ الآليُّ الذي يجعلُ
 * القسمَ ١٤ («DLQ لكلِّ طابورٍ») قابلاً للتحقّقِ لا وصيّةً تُقرأُ.
 */

import { NOTIFICATION_KINDS, type NotificationKind } from "./notification-kinds.ts";
import { isDeferrableClass, NOTIFICATION_KIND_PRIORITY } from "./traffic-priority.ts";

/**
 * الطوابيرُ الصامدةُ. **قائمةٌ مغلقةٌ** يُنفِذُها الحارسُ ضدَّ الترحيلاتِ: من زادَ
 * طابوراً زادَ سطرَه ههنا وحدودَه، أو سقطَ الحاجزُ في CI.
 */
export const DURABLE_QUEUES = ["notification_outbox", "telegram_update_jobs"] as const;

export type DurableQueue = (typeof DURABLE_QUEUES)[number];

/**
 * طوابيرُ **متقاعدةٌ**: بنيتُها بنيةُ طابورٍ صامدٍ (حالةٌ، ومحاولاتٌ، ورمزُ حجزٍ،
 * وموعدُ استحقاقٍ) لكنَّ حركتَها نُقِلَت إلى `notification_outbox` في مرحلةِ
 * التوسيعِ من `expand-then-contract` (`F6-03` / ADR-0061)، وجداولُها باقيةٌ
 * مكانَها حتّى مرحلةِ التقليصِ كي يبقى التراجعُ آمناً.
 *
 * ولمَ تُعلَنُ بدلَ أن تُسكَتَ في الحارسِ: قائمةُ استثناءٍ داخلَ الحارسِ تجعلُه
 * خصماً لنفسِه — كلُّ من ضاقَ به سطرٌ أضافَ اسماً فمرَّ. والإعلانُ ههنا يُقرأُ
 * **دعوىً** قابلةً للفحصِ: أنَّ الجدولَ لا يُكتَبُ فيه، وأنَّ حدودَه صارت حدودَ
 * الصندوقِ الموحَّدِ. ومن أعادَ الكتابةَ في أحدِها أعادَ طابوراً بلا ضغطٍ عكسيٍّ،
 * فليُخرِجْه من هذه القائمةِ ويُعلِنْ حدودَه الستّةَ.
 */
export const RETIRED_QUEUES = [
  { table: "safety_incident_deliveries", retiredIn: "20260908010000" },
  { table: "subscription_notices", retiredIn: "20260908020000" },
  { table: "broadcast_recipients", retiredIn: "20260908030000" },
] as const;

export type RetiredQueue = (typeof RETIRED_QUEUES)[number]["table"];

export function isRetiredQueue(name: string): name is RetiredQueue {
  return RETIRED_QUEUES.some((entry) => entry.table === name);
}

/** موضعُ الحدِّ: صفُّ إعدادٍ لكلِّ مدينةٍ، أو ثابتٌ مُصدَّرٌ في الشيفرةِ. */
export type LimitHome =
  | { readonly kind: "platform_settings"; readonly key: string }
  | { readonly kind: "code_constant"; readonly module: string; readonly name: string };

export interface QueueBackpressureDeclaration {
  readonly queue: DurableQueue;
  /** أيَحملُ الطابورُ `city_id`؟ يُحدِّدُ موضعَ الحدودِ ونطاقَ القياسِ معاً. */
  readonly cityScoped: boolean;
  readonly capacity: LimitHome;
  readonly oldest_age: LimitHome;
  readonly retry: LimitHome;
  readonly dead_letter: LimitHome;
  readonly producer: LimitHome;
  readonly consumer_concurrency: LimitHome;
}

const INGRESS_MODULE = "packages/shared/config/domain-ingress.ts";

/**
 * الإعلانُ. لا يُقرأُ منه رقمٌ — يُقرأُ منه **مكانُ** الرقمِ، ثمَّ يُقرأُ الرقمُ
 * من مكانِه. وهذا ما يجعلُ تغييرَ حدٍّ تغييراً في موضعٍ واحدٍ.
 */
export const QUEUE_BACKPRESSURE_DECLARATIONS: readonly QueueBackpressureDeclaration[] = [
  {
    queue: "notification_outbox",
    cityScoped: true,
    capacity: { kind: "platform_settings", key: "outbox_queue_depth_limit" },
    oldest_age: { kind: "platform_settings", key: "outbox_queue_oldest_age_limit_seconds" },
    // مفتاحٌ **قائمٌ** يُعادُ استخدامُه لا يُستحدَثُ نظيرُه: سقفُ محاولاتِ الصفِّ
    // الواحدِ مُنفَّذٌ في `finish_notification_delivery` منذُ `CAP-002`.
    retry: { kind: "platform_settings", key: "notification_delivery_max_attempts" },
    dead_letter: { kind: "platform_settings", key: "outbox_queue_dead_limit" },
    producer: { kind: "platform_settings", key: "outbox_queue_producer_limit" },
    consumer_concurrency: {
      kind: "platform_settings",
      key: "outbox_queue_consumer_concurrency",
    },
  },
  {
    queue: "telegram_update_jobs",
    cityScoped: false,
    capacity: { kind: "code_constant", module: INGRESS_MODULE, name: "TELEGRAM_JOB_DEPTH_LIMIT" },
    oldest_age: {
      kind: "code_constant",
      module: INGRESS_MODULE,
      name: "TELEGRAM_JOB_OLDEST_AGE_LIMIT_SECONDS",
    },
    // ثابتٌ **قائمٌ** لا يُستحدَثُ نظيرُه (`ADR 0057`).
    retry: { kind: "code_constant", module: INGRESS_MODULE, name: "TELEGRAM_JOB_MAX_ATTEMPTS" },
    dead_letter: {
      kind: "code_constant",
      module: INGRESS_MODULE,
      name: "TELEGRAM_JOB_DEAD_LIMIT",
    },
    producer: {
      kind: "code_constant",
      module: INGRESS_MODULE,
      name: "TELEGRAM_JOB_PRODUCER_LIMIT",
    },
    consumer_concurrency: {
      kind: "code_constant",
      module: INGRESS_MODULE,
      name: "TELEGRAM_JOB_CONSUMER_CONCURRENCY",
    },
  },
];

/**
 * أصنافُ الإشعارِ التي **يجوزُ تأجيلُها** عندَ الإشباعِ. القسمُ ١٥ من الخارطةِ
 * يصنِّفُ «البثَّ الجماهيريَّ» منخفضاً وينصُّ: «يؤجَّلُ البثُّ غيرُ الضروريِّ»،
 * ويحمي الرحلاتَ النشطةَ والدفعَ والاستغاثةَ.
 *
 * **تصحيحٌ مُضافٌ — `F6-07` (2026-09-09):** كانَت هذه القائمةُ صريحةً بالأسماءِ
 * (`broadcast_recipient` وحدَه) وكانَ سببُ صراحتِها مُعلَناً ههنا: «الرتبةُ
 * الكاملةُ للأصنافِ الأحدَ عشرَ هيَ `F6-07`، وبناؤها ههنا استباقٌ لبندٍ لم
 * يُنفَّذ». وقد نُفِّذَ البندُ، فصارَت القائمةُ **مُشتقّةً** من
 * `packages/shared/config/traffic-priority.ts` — لا لِتُبنى مُبكِّرةً بل لِئلّا
 * يبقى للتأجيلِ مصدرُ حقيقةٍ ثانٍ يُفارِقُ الرتبةَ بلا أن يُلاحَظَ. والاشتقاقُ
 * يُوسِّعُ القائمةَ إلى المتوسّطِ والمنخفضِ، وهوَ عينُ نصِّ القسمِ ١٥: «تُقلَّص
 * الوظائف الثانوية، ويؤجَّل البثّ غير الضروري».
 *
 * وميلُ القائمةِ يبقى آمناً بالبناءِ: نوعٌ لا يُصنَّفُ يُقرأُ `critical`
 * فـ**لا يُؤجَّلُ** — فالسهوُ يُبقي الإشعارَ عاجلاً لا يُسكِتُه، ويسقطُ في CI
 * بحاجزِ `scripts/check-traffic-priority.ts`.
 */
export const DEFERRABLE_UNDER_BACKPRESSURE_KINDS: readonly NotificationKind[] =
  NOTIFICATION_KINDS.filter((kind) => isDeferrableClass(NOTIFICATION_KIND_PRIORITY[kind]));

export type DeferrableKind = NotificationKind;

export function isDeferrableUnderBackpressure(kind: string): kind is DeferrableKind {
  return (DEFERRABLE_UNDER_BACKPRESSURE_KINDS as readonly string[]).includes(kind);
}

/**
 * نافذةُ عدِّ الموتى، ثوانيَ. حدٌّ تقنيٌّ واحدٌ للطابورَينِ: النافذةُ ليست سياسةً
 * لكلِّ مدينةٍ بل **وحدةُ قياسٍ** — تغييرُها يغيِّرُ معنى الرقمِ المقروءِ لا
 * تصرُّفَ النظامِ. وساعةٌ لأنَّها أقصرُ من نوبةِ مناوَبةٍ فيُرى الانفجارُ حينَ
 * يقعُ، وأطولُ من أيِّ عاصفةِ إعادةِ محاولةٍ عابرةٍ فلا يُقرأُ ضجيجُها إنذاراً.
 */
export const QUEUE_DEAD_WINDOW_SECONDS = 3600;

/** الإعلانُ لطابورٍ بعينِه، أو `undefined` إن لم يُعلَن — والحارسُ يُنكِرُ ذلك. */
export function declarationFor(queue: string): QueueBackpressureDeclaration | undefined {
  return QUEUE_BACKPRESSURE_DECLARATIONS.find((entry) => entry.queue === queue);
}
