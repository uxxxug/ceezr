/**
 * الغرض: تعريف المقاييس التشغيلية الموحدة لمنصّة وَصْلة وتوفير واجهة تسجيل ذات دلالة
 *   أعمال واضحة؛ المصدر داخل العملية فقط، فلا تُرسل أي بيانات أو أسرار خارجها.
 * الحالة: منفّذ فعلياً — طبقة المراقبة التشغيلية.
 * ينتمي إلى: packages/infrastructure/observability
 * يُتوقع أن يستخدمه لاحقاً: محوّلات البوابة والعامل ومسار /metrics.
 * ملاحظات مستقبلية: لا تُضاف وسوم user_id أو order_id أو city_id كي لا يرتفع cardinality.
 */

import { methodLabel, routeLabel, statusClass } from "./http-metrics.ts";
import type { ProcessMemorySnapshot } from "./process-metrics.ts";
import { PrometheusRegistry } from "./registry.ts";

const DEFAULT_HISTOGRAM_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
] as const;

export type TelegramOutcome = "handled" | "failed";

/**
 * أنواع الرسائل الصادرة إلى تيليجرام — تطابق منفذ `TelegramSender` حرفاً.
 *
 * ولماذا تُوسَم بالنوع لا تُجمع في عدّادٍ واحد؟ لأن حدّ تيليجرام ليس واحداً لكلّ
 * الأنواع، وإرسال الصور أثقل من النصّ في الزمن والحمل، فجمعهما يطمر فرقاً
 * يهمّ من يقيس السقف الخارجي.
 */
export type TelegramSendKind = "message" | "photo" | "location";

export type WorkerOutcome = "success" | "failure" | "skipped_locked_elsewhere";

export interface OperationalMetrics {
  readonly registry: PrometheusRegistry;
  recordTelegramUpdate(bot: "driver" | "rider", outcome: TelegramOutcome, durationMs: number): void;
  recordTelegramDuplicate(bot: "driver" | "rider"): void;
  /**
   * يُسجّل رسالةً واحدةً **خرجت إلى تيليجرام**، لا رسالةً قُرّرَ إرسالها.
   *
   * ولم يوجد هذا المقياس قبل المرحلة 2: النظام كان يقيس ما **يدخل** عليه من
   * تحديثات، ولا يرى ما **يخرج** منه من رسائل. وهذا عمىٌ في أخطر موضع: الحدّ
   * الخارجي الحاكم للمنصّة هو معدّل الإرسال لا معدّل الورود (حدّ بوت واحد من
   * مرتبة عشرات الرسائل في الثانية)، فتخطيطُ السعة كان يجري على رقمٍ لا يُقاس.
   */
  recordTelegramMessageSent(bot: "driver" | "rider", kind: TelegramSendKind): void;
  recordDispatchRequest(): void;
  recordDispatchOffersSent(count: number): void;
  recordDispatchOfferAccepted(): void;
  recordDispatchOfferTimedOut(count: number): void;
  recordDispatchNoDriver(): void;
  recordWorkerRun(job: string, outcome: WorkerOutcome, durationMs: number, finishedAt: Date): void;
  recordPaymentCreated(): void;
  recordPaymentConfirmed(): void;
  recordPaymentFailure(): void;
  recordPaymentWebhookDuplicate(): void;
  observeCriticalDatabaseQuery(query: string, durationMs: number): void;
  setDatabaseGauges(values: DatabaseGaugeValues): void;
  recordDatabaseGaugeCollectionFailure(): void;
  /**
   * `F8-02` — معدَّلُ الحافةِ وتأخّرُها وأخطاؤُها في تسجيلٍ واحدٍ: الوسومُ
   * **مُطبَّعةٌ داخلَ هذه الدالّةِ** (`methodLabel` · `routeLabel` · `statusClass`)
   * فلا يملكُ موضعُ النداءِ أن يُمرِّرَ مساراً خاماً فيه معرِّفٌ.
   */
  recordHttpRequest(
    method: string,
    routePath: string | undefined,
    status: number,
    durationMs: number,
  ): void;
  /** طلبٌ خرجَ باستثناءٍ لم يُلتقَطْ — يُعَدُّ ويُعَدُّ معَه `5xx`. */
  recordHttpUnhandledError(method: string, routePath: string | undefined): void;
  /** `F8-02` — ذاكرةُ العمليّةِ وعمرُها لحظةَ المسحِ. */
  setProcessGauges(values: ProcessMemorySnapshot): void;
}

/**
 * حِمْلُ طابورٍ صامدٍ لحظةَ القياسِ (`F6-06`). والوسمُ **`queue` وحدَه**: وسمُ
 * مدينةٍ أو مستخدمٍ أو طلبٍ يجعلُ عددَ السلاسلِ يكبُرُ بكِبَرِ البياناتِ (انفجارُ
 * التعدُّدِ)، ويُخرِجُ معرِّفاتٍ إلى مُجمِّعٍ خارجيٍّ لا حاجةَ له بها. ومن أرادَ
 * التفصيلَ بالمدينةِ وجدَه في `queue_backpressure_events` داخلَ القاعدةِ حيثُ
 * تحكمُه RLS.
 */
export interface QueueGaugeValues {
  readonly queue: string;
  readonly depth: number;
  readonly oldestDueAgeSeconds: number;
  readonly deadInWindow: number;
  readonly claimed: number;
}

/**
 * اتصالاتُ القاعدةِ لحظةَ القياسِ (`F8-02` — «اتصالات»). والوسمُ **الحالةُ**
 * وحدَها (`active` · `idle` · `idle_in_transaction` · `other`): وسمُ المستخدمِ أو
 * التطبيقِ أو العنوانِ يُنشئُ سلسلةً لكلِّ نسخةٍ تُنشَرُ، ولا يُجيبُ عن السؤالِ
 * الذي يُسأَلُ ههنا: **أقاربٌ نحنُ من السقفِ أم لا؟**
 */
export interface DatabaseConnectionGaugeValues {
  readonly state: string;
  readonly count: number;
}

/**
 * زمنُ الإسنادِ (`F8-02` — «زمن الإسناد»): الفارقُ بينَ `orders.created_at` و
 * `orders.matched_at` لما أُسنِدَ **في نافذةٍ أخيرةٍ مُعلَنةٍ**. ويُقاسُ في
 * القاعدةِ لا في العمليّةِ لأنَّ الطلبَ يُنشَأُ في عمليّةٍ وقد يُسنَدُ في أخرى،
 * ومؤقِّتٌ في الذاكرةِ **يُفقَدُ بإعادةِ التشغيلِ ويكذبُ عندَ تعدُّدِ النسخِ**.
 *
 * و**الغيابُ صفرُ عدٍّ لا صفرُ زمنٍ**: إن لم يقعْ إسنادٌ في النافذةِ فالعدُّ صفرٌ
 * والزمنانِ صفرانِ، ويُقرآنِ بشرطِ العدِّ. وقارئٌ يقرأُ الزمنَ بلا العدِّ يقرأُ
 * «إسنادٌ فوريٌّ» حيثُ لا إسنادَ أصلاً — ولذلكَ نُشِرَ العدُّ معَهما.
 */
export interface AssignmentLatencyGaugeValues {
  /** عددُ الطلباتِ التي أُسنِدَت في النافذةِ. */
  readonly matchedInWindow: number;
  /** الوسيطُ بالثواني — صفرٌ إن لم يقعْ إسنادٌ. */
  readonly p50Seconds: number;
  /** المئينُ التسعونَ بالثواني — صفرٌ إن لم يقعْ إسنادٌ. */
  readonly p90Seconds: number;
  /**
   * طولُ النافذةِ بالثواني — **يُنشَرُ مقياساً لا يُتركُ تعليقاً**. ولقطةُ
   * لوحةِ الإدارةِ (`F7-08`) تقرأُ **العمودَينِ نفسَهما** (`created_at` و
   * `matched_at`) بنافذةٍ أخرى يضبطُها المُشغِّلُ. فالمصدرُ واحدٌ والنافذتانِ
   * مختلفتانِ؛ **ورقمانِ باسمٍ واحدٍ ونافذتينِ مسكوتٍ عنهما هوَ عينُ الكذبِ**،
   * فلذلكَ تُنشَرُ النافذةُ معَ الرقمِ لا في ورقةٍ جانبيّةٍ.
   */
  readonly windowSeconds: number;
}

export interface DatabaseGaugeValues {
  readonly searchingOrders: number;
  readonly availableDrivers: number;
  readonly expiredSubscriptionsToday: number;
  readonly lastSuccessfulBackupTimestampSeconds: number;
  /** حِمْلُ الطوابيرِ الصامدةِ — سطرٌ لكلِّ طابورٍ، بلا وسمِ مدينةٍ. */
  readonly queues: readonly QueueGaugeValues[];
  /** اتصالاتُ القاعدةِ بحسبِ الحالةِ — سطرٌ لكلِّ حالةٍ. */
  readonly connections: readonly DatabaseConnectionGaugeValues[];
  /** السقفُ المضبوطُ في المحرِّكِ (`max_connections`) — بلا سقفٍ لا معنى للعدِّ. */
  readonly maxConnections: number;
  readonly assignment: AssignmentLatencyGaugeValues;
}

function secondsFromMs(durationMs: number): number {
  return Math.max(0, durationMs) / 1000;
}

function integralCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

/** ينشئ كل تعريف مرة واحدة لكل عملية، ثم تُمرّر الواجهة نفسها إلى محوّلات الإنتاج. */
export function createOperationalMetrics(): OperationalMetrics {
  const registry = new PrometheusRegistry();
  registry.defineCounter({
    name: "waslah_telegram_webhook_updates_total",
    help: "عدد تحديثات Telegram التي وصلت إلى المعالج بحسب البوت والنتيجة.",
    labelNames: ["bot", "outcome"],
  });
  registry.defineCounter({
    name: "waslah_telegram_webhook_duplicates_total",
    help: "عدد تحديثات Telegram المكررة التي أُهملت قبل المعالجة.",
    labelNames: ["bot"],
  });
  registry.defineCounter({
    name: "waslah_telegram_webhook_failures_total",
    help: "عدد تحديثات Telegram التي تعذرت معالجتها.",
    labelNames: ["bot"],
  });
  registry.defineHistogram({
    name: "waslah_telegram_webhook_duration_seconds",
    help: "زمن معالجة تحديث Telegram بعد قبوله.",
    labelNames: ["bot", "outcome"],
    buckets: DEFAULT_HISTOGRAM_BUCKETS,
  });

  registry.defineCounter({
    name: "waslah_telegram_messages_sent_total",
    help: "عدد الرسائل التي خرجت فعلاً إلى تيليجرام بحسب البوت ونوع الإرسال.",
    labelNames: ["bot", "kind"],
  });

  registry.defineCounter({ name: "waslah_dispatch_requests_total", help: "عدد طلبات التوزيع." });
  registry.defineCounter({
    name: "waslah_dispatch_offers_sent_total",
    help: "عدد عروض التوزيع التي أُرسلت فعلاً إلى السائقين.",
  });
  registry.defineCounter({
    name: "waslah_dispatch_offers_accepted_total",
    help: "عدد عروض التوزيع المقبولة ذرّياً.",
  });
  registry.defineCounter({
    name: "waslah_dispatch_offers_timed_out_total",
    help: "عدد عروض التوزيع التي انتهت مهلتها.",
  });
  registry.defineCounter({
    name: "waslah_dispatch_no_driver_total",
    help: "عدد طلبات التوزيع التي لم تجد سائقاً مؤهلاً.",
  });

  registry.defineCounter({
    name: "waslah_worker_executions_total",
    help: "نتيجة كل تنفيذ لمهمة دورية، بما فيه تجاوز القفل في نسخة أخرى.",
    labelNames: ["job", "outcome"],
  });
  registry.defineHistogram({
    name: "waslah_worker_duration_seconds",
    help: "زمن تنفيذ المهمة الدورية بحسب اسمها ونتيجتها.",
    labelNames: ["job", "outcome"],
    buckets: DEFAULT_HISTOGRAM_BUCKETS,
  });
  registry.defineGauge({
    name: "waslah_worker_last_success_timestamp_seconds",
    help: "Unix timestamp لآخر تنفيذ ناجح لكل مهمة دورية.",
    labelNames: ["job"],
  });

  registry.defineCounter({
    name: "waslah_payment_transactions_created_total",
    help: "عدد معاملات الدفع المنشأة لأول مرة.",
  });
  registry.defineCounter({
    name: "waslah_payment_transactions_confirmed_total",
    help: "عدد تأكيدات معاملات الدفع الناجحة.",
  });
  registry.defineCounter({
    name: "waslah_payment_failures_total",
    help: "عدد إخفاقات إنشاء أو تأكيد معاملات الدفع.",
  });
  registry.defineCounter({
    name: "waslah_payment_webhook_duplicates_total",
    help: "عدد أحداث ويبهوك الدفع المكررة التي أُهملت.",
  });

  registry.defineHistogram({
    name: "waslah_database_critical_query_duration_seconds",
    help: "زمن الاستعلامات الحرجة الخاصة بالمراقبة في قاعدة البيانات.",
    labelNames: ["query"],
    buckets: DEFAULT_HISTOGRAM_BUCKETS,
  });
  registry.defineCounter({
    name: "waslah_database_gauge_collection_failures_total",
    help: "عدد إخفاقات قراءة المقاييس اللحظية من قاعدة البيانات.",
  });
  registry.defineGauge({ name: "waslah_orders_searching", help: "عدد الطلبات في حالة searching." });
  registry.defineGauge({ name: "waslah_drivers_available", help: "عدد السائقين المتاحين الآن." });
  registry.defineGauge({
    name: "waslah_subscriptions_expired_today",
    help: "عدد الاشتراكات التي انتقلت إلى expired اليوم وفق زمن القاعدة.",
  });
  registry.defineGauge({
    name: "waslah_backup_last_success_timestamp_seconds",
    help: "Unix timestamp لآخر نسخة احتياطية ناجحة، أو صفر إن لم توجد بعد.",
  });

  registry.defineGauge({
    name: "waslah_queue_depth",
    help: "عددُ الصفوفِ المعلَّقةِ المستحقَّةِ في كلِّ طابورٍ صامدٍ.",
    labelNames: ["queue"],
  });
  registry.defineGauge({
    name: "waslah_queue_oldest_due_age_seconds",
    help: "عمرُ أقدمِ صفٍّ مستحقٍّ في الطابورِ بالثواني — صفرٌ إن لم يوجد مستحقٌّ.",
    labelNames: ["queue"],
  });
  registry.defineGauge({
    name: "waslah_queue_dead_letter_recent",
    help: "عددُ الصفوفِ التي ماتت في نافذةِ القياسِ الأخيرةِ لكلِّ طابورٍ.",
    labelNames: ["queue"],
  });
  registry.defineGauge({
    name: "waslah_queue_claimed",
    help: "عددُ الصفوفِ المحجوزةِ الآنَ لكلِّ طابورٍ — تزامنُ المستهلِكِ الفعليُّ.",
    labelNames: ["queue"],
  });

  /**
   * `F8-02` — الحافةُ: معدَّلٌ وتأخّرٌ وأخطاءٌ. والعدَّادُ يحملُ صنفَ الحالةِ فيُقرأُ
   * منه المعدَّلُ ونسبةُ الأخطاءِ **من مصدرٍ واحدٍ**؛ ومعَه عدَّادٌ صريحٌ للأخطاءِ
   * ليُقرأَ الإنذارُ بلا شرطٍ على وسمٍ (`5xx` مجموعةٌ فرعيّةٌ مُعلَنةٌ منه لا رقمٌ ثانٍ).
   */
  registry.defineCounter({
    name: "waslah_http_requests_total",
    help: "عددُ طلباتِ HTTP بحسبِ القالبِ والطريقةِ وصنفِ الحالةِ — معدَّلُ الحافةِ.",
    labelNames: ["route", "method", "status_class"],
  });
  registry.defineHistogram({
    name: "waslah_http_request_duration_seconds",
    help: "زمنُ خدمةِ طلبِ HTTP من دخولِ الوسيطِ إلى خروجِ الردِّ.",
    labelNames: ["route", "method"],
    buckets: DEFAULT_HISTOGRAM_BUCKETS,
  });
  registry.defineCounter({
    name: "waslah_http_errors_total",
    help: "عددُ ردودِ HTTP التي صنفُها 5xx أو التي خرجت باستثناءٍ لم يُلتقَط.",
    labelNames: ["route", "method", "status_class"],
  });

  /** `F8-02` — الذاكرةُ: قيمٌ لحظيّةٌ تُقرأُ عندَ المسحِ لا بمؤقِّتٍ. */
  registry.defineGauge({
    name: "waslah_process_resident_memory_bytes",
    help: "الذاكرةُ المقيمةُ للعمليّةِ بالبايتِ لحظةَ المسحِ.",
  });
  registry.defineGauge({
    name: "waslah_process_heap_used_bytes",
    help: "الكومةُ المستعملةُ بالبايتِ لحظةَ المسحِ.",
  });
  registry.defineGauge({
    name: "waslah_process_heap_total_bytes",
    help: "الكومةُ المحجوزةُ كلُّها بالبايتِ لحظةَ المسحِ.",
  });
  registry.defineGauge({
    name: "waslah_process_external_memory_bytes",
    help: "الذاكرةُ خارجَ الكومةِ بالبايتِ لحظةَ المسحِ.",
  });
  registry.defineGauge({
    name: "waslah_process_uptime_seconds",
    help: "عمرُ العمليّةِ بالثواني — يفرِّقُ بينَ نموِّ الذاكرةِ وإعادةِ التشغيلِ.",
  });

  /** `F8-02` — الاتصالاتُ: العدُّ بحسبِ الحالةِ والسقفُ معاً، فالعدُّ بلا سقفٍ لا يُقرأُ. */
  registry.defineGauge({
    name: "waslah_database_connections",
    help: "عددُ اتصالاتِ PostgreSQL بحسبِ الحالةِ لحظةَ القياسِ.",
    labelNames: ["state"],
  });
  registry.defineGauge({
    name: "waslah_database_connections_limit",
    help: "سقفُ الاتصالاتِ المضبوطُ في المحرِّكِ (max_connections).",
  });

  /** `F8-02` — زمنُ الإسنادِ: مقيسٌ في القاعدةِ على نافذةٍ، ومعَه عدُّ النافذةِ. */
  registry.defineGauge({
    name: "waslah_order_assignment_seconds",
    help: "زمنُ الإسنادِ (من إنشاءِ الطلبِ إلى مطابقتِه) في النافذةِ الأخيرةِ بحسبِ المئينِ.",
    labelNames: ["quantile"],
  });
  registry.defineGauge({
    name: "waslah_order_assignment_window_seconds",
    help: "طولُ نافذةِ قياسِ زمنِ الإسنادِ بالثواني — منشورٌ معَ الرقمِ لا مفترَضٌ.",
  });
  registry.defineGauge({
    name: "waslah_orders_matched_in_window",
    help: "عددُ الطلباتِ التي أُسنِدَت في نافذةِ قياسِ زمنِ الإسنادِ — شرطُ قراءةِ الزمنِ.",
  });

  return {
    registry,
    recordTelegramUpdate: (bot, outcome, durationMs) => {
      registry.increment("waslah_telegram_webhook_updates_total", { bot, outcome });
      registry.observe(
        "waslah_telegram_webhook_duration_seconds",
        { bot, outcome },
        secondsFromMs(durationMs),
      );
      if (outcome === "failed")
        registry.increment("waslah_telegram_webhook_failures_total", { bot });
    },
    recordTelegramDuplicate: (bot) =>
      registry.increment("waslah_telegram_webhook_duplicates_total", { bot }),
    recordTelegramMessageSent: (bot, kind) =>
      registry.increment("waslah_telegram_messages_sent_total", { bot, kind }),
    recordDispatchRequest: () => registry.increment("waslah_dispatch_requests_total"),
    recordDispatchOffersSent: (count) =>
      registry.increment("waslah_dispatch_offers_sent_total", {}, integralCount(count)),
    recordDispatchOfferAccepted: () => registry.increment("waslah_dispatch_offers_accepted_total"),
    recordDispatchOfferTimedOut: (count) =>
      registry.increment("waslah_dispatch_offers_timed_out_total", {}, integralCount(count)),
    recordDispatchNoDriver: () => registry.increment("waslah_dispatch_no_driver_total"),
    recordWorkerRun: (job, outcome, durationMs, finishedAt) => {
      registry.increment("waslah_worker_executions_total", { job, outcome });
      registry.observe(
        "waslah_worker_duration_seconds",
        { job, outcome },
        secondsFromMs(durationMs),
      );
      if (outcome === "success") {
        registry.setGauge(
          "waslah_worker_last_success_timestamp_seconds",
          { job },
          finishedAt.getTime() / 1000,
        );
      }
    },
    recordPaymentCreated: () => registry.increment("waslah_payment_transactions_created_total"),
    recordPaymentConfirmed: () => registry.increment("waslah_payment_transactions_confirmed_total"),
    recordPaymentFailure: () => registry.increment("waslah_payment_failures_total"),
    recordPaymentWebhookDuplicate: () =>
      registry.increment("waslah_payment_webhook_duplicates_total"),
    observeCriticalDatabaseQuery: (query, durationMs) =>
      registry.observe(
        "waslah_database_critical_query_duration_seconds",
        { query },
        secondsFromMs(durationMs),
      ),
    setDatabaseGauges: (values) => {
      registry.setGauge("waslah_orders_searching", {}, integralCount(values.searchingOrders));
      registry.setGauge("waslah_drivers_available", {}, integralCount(values.availableDrivers));
      registry.setGauge(
        "waslah_subscriptions_expired_today",
        {},
        integralCount(values.expiredSubscriptionsToday),
      );
      registry.setGauge(
        "waslah_backup_last_success_timestamp_seconds",
        {},
        Math.max(0, values.lastSuccessfulBackupTimestampSeconds),
      );
      for (const value of values.queues) {
        const labels = { queue: value.queue };
        registry.setGauge("waslah_queue_depth", labels, integralCount(value.depth));
        registry.setGauge(
          "waslah_queue_oldest_due_age_seconds",
          labels,
          Math.max(0, value.oldestDueAgeSeconds),
        );
        registry.setGauge(
          "waslah_queue_dead_letter_recent",
          labels,
          integralCount(value.deadInWindow),
        );
        registry.setGauge("waslah_queue_claimed", labels, integralCount(value.claimed));
      }
      for (const connection of values.connections) {
        registry.setGauge(
          "waslah_database_connections",
          { state: connection.state },
          integralCount(connection.count),
        );
      }
      registry.setGauge(
        "waslah_database_connections_limit",
        {},
        integralCount(values.maxConnections),
      );
      registry.setGauge(
        "waslah_orders_matched_in_window",
        {},
        integralCount(values.assignment.matchedInWindow),
      );
      registry.setGauge(
        "waslah_order_assignment_seconds",
        { quantile: "0.5" },
        Math.max(0, values.assignment.p50Seconds),
      );
      registry.setGauge(
        "waslah_order_assignment_window_seconds",
        {},
        Math.max(0, values.assignment.windowSeconds),
      );
      registry.setGauge(
        "waslah_order_assignment_seconds",
        { quantile: "0.9" },
        Math.max(0, values.assignment.p90Seconds),
      );
    },
    recordDatabaseGaugeCollectionFailure: () =>
      registry.increment("waslah_database_gauge_collection_failures_total"),
    recordHttpRequest: (method, routePath, status, durationMs) => {
      const labels = { route: routeLabel(routePath), method: methodLabel(method) };
      const klass = statusClass(status);
      registry.increment("waslah_http_requests_total", { ...labels, status_class: klass });
      registry.observe("waslah_http_request_duration_seconds", labels, secondsFromMs(durationMs));
      if (klass === "5xx") {
        registry.increment("waslah_http_errors_total", { ...labels, status_class: klass });
      }
    },
    recordHttpUnhandledError: (method, routePath) => {
      registry.increment("waslah_http_errors_total", {
        route: routeLabel(routePath),
        method: methodLabel(method),
        status_class: "5xx",
      });
    },
    setProcessGauges: (values) => {
      registry.setGauge("waslah_process_resident_memory_bytes", {}, values.residentBytes);
      registry.setGauge("waslah_process_heap_used_bytes", {}, values.heapUsedBytes);
      registry.setGauge("waslah_process_heap_total_bytes", {}, values.heapTotalBytes);
      registry.setGauge("waslah_process_external_memory_bytes", {}, values.externalBytes);
      registry.setGauge("waslah_process_uptime_seconds", {}, values.uptimeSeconds);
    },
  };
}
