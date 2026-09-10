/**
 * الغرض: **مصدرُ الحقيقةِ الوحيدُ لسياسةِ الاستبقاءِ** — تصنيفُ كلِّ جدولٍ في
 *   المخطّطِ، ومُدَدُ `DEC-15` المعتمدةُ. البند `F7-06`، العائق `CAP-010`،
 *   `ADR-0075`.
 * الحالة: منفّذ فعلياً — 2026-09-10 · البند `F7-06`.
 * ينتمي إلى: shared/config
 * يُستخدم من: `packages/application/geo/archive-location-partitions.ts`،
 *   `apps/workers/src/container.ts`، والحاجزُ `scripts/check-retention-policy.ts`.
 * ملاحظات مستقبلية: `F12-10` (امتثالُ PDPL) هوَ من يحسمُ مُدَدَ الأصنافِ
 *   الموسومةِ `pending-decision`؛ ولا تُحسَمُ ههنا بيدِ منفِّذٍ.
 *
 * ## لماذا ملفٌّ واحدٌ لا رقمٌ عندَ كلِّ مُستعمِلٍ
 *
 * لأنَّ سياسةَ الاستبقاءِ **إقرارٌ قانونيٌّ يُعلَنُ للجهةِ الرقابيّةِ**، لا ضبطاً
 * تقنيّاً. فرقمانِ مختلفانِ في موضعَينِ يعنيانِ أنَّ ما يُعلَنُ للجهةِ غيرُ ما
 * يفعلُه العاملُ — وذاكَ أسوأُ من ألّا تكونَ سياسةٌ أصلاً، لأنَّ الأوّلَ نقصٌ
 * والثانيَ إقرارٌ كاذبٌ. ولذلكَ الأرقامُ ههنا وحدَها، والحاجزُ يمنعُ جدولاً
 * جديداً من الدخولِ بلا تصنيفٍ.
 *
 * ## ولماذا التصنيفُ قائمةٌ مغلقةٌ تشملُ الجداولَ كلَّها
 *
 * لأنَّ الخطرَ في الاستبقاءِ ليسَ جدولاً صُنِّفَ خطأً — بل جدولاً **لم يُنظَرْ فيه
 * أصلاً** فبقيَ ينمو إلى الأبدِ ولا أحدَ يذكرُ أنّه موجودٌ. فالقائمةُ المغلقةُ
 * تجعلُ إضافةَ جدولٍ جديدٍ **قراراً واعياً** يُسقِطُ CI حتّى يُصنَّفَ صاحبُه.
 * والتصنيفُ لا يعني حذفاً: أكثرُ الأصنافِ ههنا «لا يُحذَفُ».
 */

/**
 * أصنافُ الاستبقاءِ. الصنفُ يُجيبُ سؤالاً واحداً: **هل يجوزُ إخراجُ صفٍّ من هذا
 * الجدولِ من القاعدةِ، ومتى؟**
 */
export const RETENTION_CLASSES = {
  /**
   * سجلٌّ ماليٌّ: **لا يُحذَفُ ولا يُؤرشَفُ خارجاً**. الحدُّ الأدنى ستُّ سنواتٍ
   * مأخوذٌ من متطلّباتِ حفظِ سجلّاتِ الفوترةِ، ومعَه شرطُ الحفظِ داخلَ المملكةِ —
   * فأيُّ تخزينٍ خارجيٍّ لهذه الجداولِ ممنوعٌ حتّى يُحسَمَ `F12-15`/`DEC-01`.
   */
  financialSixYears: "financial-min-6y-in-kingdom",

  /**
   * تاريخُ الموقعِ: ساخنٌ في القاعدةِ مدّةَ `LOCATION_HOT_DAYS`، ثمَّ **يُؤرشَفُ
   * خارجَ القاعدةِ ويُسقَطُ قِسمُه**. وهذا وحدَه ما نفَّذَه `F7-06` — بقرارِ
   * `DEC-15` لا باجتهادِ منفِّذٍ.
   */
  locationHotThenArchive: "location-hot-then-archive",

  /**
   * سجلُّ التدقيقِ: **بلا حدٍّ حتّى `F12-10`** — بقرارِ `DEC-15` صريحاً. وليسَ
   * إهمالاً: حذفُ سجلِّ تدقيقٍ يُتلِفُ الدليلَ الذي يُثبِتُ الامتثالَ نفسَه،
   * فتأجيلُ حسمِه إلى بندِ الامتثالِ هوَ الموضعُ الصحيحُ لا التسويفُ.
   */
  auditUnboundedUntilCompliance: "audit-unbounded-until-f12-10",

  /**
   * جدولُ حالةٍ أو مرجعٍ: عمرُه عمرُ الكيانِ الذي يصفُه، فلا سياسةَ زمنيّةً له.
   * حذفُ مدينةٍ أو خطّةٍ أو سائقٍ حدَثٌ تجاريٌّ لا وظيفةُ صيانةٍ ليليّةٍ.
   */
  lifecycleBound: "lifecycle-bound-no-timer",

  /**
   * يحكمُ نفسَه بآلةٍ قائمةٍ خارجَ هذا الملفِّ (نسخُ القاعدةِ تُقلَّمُ في مهمّةِ
   * النسخِ نفسِها). مُعلَنٌ ههنا كي لا يُظَنَّ منسيّاً.
   */
  selfGoverned: "self-governed-elsewhere",

  /**
   * **صُنِّفَ ولم يُحسَمْ**: جدولٌ ينمو ولا مدّةَ معتمدةً له. ليسَ إهمالاً بل
   * إقرارٌ مكتوبٌ بأنّه يُنتظِرُ `F12-10`. ولا يجوزُ لمهمّةٍ أن تحذفَ منه شيئاً
   * قبلَ ذلكَ — والحاجزُ يمنعُ.
   */
  pendingDecision: "pending-decision-f12-10",
} as const;

export type RetentionClass = (typeof RETENTION_CLASSES)[keyof typeof RETENTION_CLASSES];

/**
 * `DEC-15` — القرارُ المعتمَدُ من المالكِ بتاريخِ 2026-09-10. الأرقامُ ههنا
 * **قرارٌ مُعلَنٌ**، لا اشتقاقٌ ولا توصيةُ منفِّذٍ.
 */
export const DEC_15 = {
  /** المدّةُ الساخنةُ لتاريخِ الموقعِ في PostgreSQL — يوماً. */
  locationHotDays: 14,
  /** المصيرُ بعدَ الساخنِ: أرشفةٌ خارجَ القاعدةِ (لا إتلافٌ مباشرٌ). */
  locationDisposition: "archive-outside-database",
  /** سجلُّ التدقيقِ: لا مدّةَ — `null` قرارٌ لا سهوٌ. */
  auditLogDays: null,
} as const;

/** المدّةُ الساخنةُ لتاريخِ الموقعِ. لا يُكتَبُ هذا الرقمُ في موضعٍ آخرَ. */
export const LOCATION_HOT_DAYS = DEC_15.locationHotDays;

/**
 * أقصى عددِ صفوفٍ في ملفِّ أرشيفٍ واحدٍ. ليسَ ذوقاً: الملفُّ يُبنى في الذاكرةِ
 * قبلَ رفعِه، ويومٌ واحدٌ عندَ نموذجِ السعةِ المُعلَنِ مئاتُ ملايينِ الصفوفِ.
 * فالتجزئةُ إلى أجزاءٍ هيَ ما يجعلُ المهمّةَ تعملُ في عاملٍ محدودِ الذاكرةِ بدلَ
 * أن تسقطَ بلا سببٍ ظاهرٍ عندَ أوّلِ مدينةٍ مزدحمةٍ.
 */
export const ARCHIVE_PART_ROWS = 50_000;

/**
 * أقصى عددِ أيّامٍ يُعالَجُ في شوطٍ واحدٍ. متأخّرٌ متراكمٌ يُعالَجُ على أيّامٍ لا
 * دفعةً واحدةً تشغلُ القاعدةَ ساعاتٍ.
 */
export const ARCHIVE_MAX_DAYS_PER_RUN = 3;

/**
 * تصنيفُ كلِّ جدولٍ. **قائمةٌ مغلقةٌ**: جدولٌ في هجرةٍ وليسَ ههنا يُسقِطُ الحاجزَ،
 * واسمٌ ههنا بلا جدولٍ يُسقِطُه أيضاً (مُدخلٌ ميّتٌ يُوهِمُ أنَّ شيئاً حُسِمَ).
 */
export const TABLE_RETENTION: Readonly<Record<string, RetentionClass>> = {
  admin_login_codes: RETENTION_CLASSES.pendingDecision,
  admin_sessions: RETENTION_CLASSES.pendingDecision,
  agent_decisions: RETENTION_CLASSES.pendingDecision,
  agent_outcomes: RETENTION_CLASSES.pendingDecision,
  attendance_log: RETENTION_CLASSES.pendingDecision,
  audit_log: RETENTION_CLASSES.auditUnboundedUntilCompliance,
  broadcast_campaigns: RETENTION_CLASSES.pendingDecision,
  broadcast_recipients: RETENTION_CLASSES.pendingDecision,
  cities: RETENTION_CLASSES.lifecycleBound,
  db_backups: RETENTION_CLASSES.selfGoverned,
  driver_availability: RETENTION_CLASSES.lifecycleBound,
  driver_capabilities: RETENTION_CLASSES.lifecycleBound,
  driver_location_history: RETENTION_CLASSES.locationHotThenArchive,
  drivers: RETENTION_CLASSES.lifecycleBound,
  job_heartbeats: RETENTION_CLASSES.pendingDecision,
  ledger_entries: RETENTION_CLASSES.financialSixYears,
  location_archive_manifest: RETENTION_CLASSES.lifecycleBound,
  notification_kind_policy: RETENTION_CLASSES.lifecycleBound,
  notification_outbox: RETENTION_CLASSES.pendingDecision,
  order_offers: RETENTION_CLASSES.pendingDecision,
  orders: RETENTION_CLASSES.lifecycleBound,
  payment_transactions: RETENTION_CLASSES.financialSixYears,
  platform_settings: RETENTION_CLASSES.lifecycleBound,
  queue_backpressure_events: RETENTION_CLASSES.pendingDecision,
  ratings: RETENTION_CLASSES.lifecycleBound,
  riders: RETENTION_CLASSES.lifecycleBound,
  safety_incident_deliveries: RETENTION_CLASSES.pendingDecision,
  safety_incidents: RETENTION_CLASSES.pendingDecision,
  subscription_invoices: RETENTION_CLASSES.financialSixYears,
  subscription_notices: RETENTION_CLASSES.pendingDecision,
  subscription_refunds: RETENTION_CLASSES.financialSixYears,
  subscription_wallet_entries: RETENTION_CLASSES.financialSixYears,
  subscription_wallets: RETENTION_CLASSES.financialSixYears,
  subscriptions: RETENTION_CLASSES.financialSixYears,
  support_tickets: RETENTION_CLASSES.pendingDecision,
  telegram_update_jobs: RETENTION_CLASSES.pendingDecision,
  telegram_update_receipts: RETENTION_CLASSES.pendingDecision,
  tracking_sessions: RETENTION_CLASSES.pendingDecision,
  trip_tracking_tokens: RETENTION_CLASSES.pendingDecision,
  unsubscribed_claims: RETENTION_CLASSES.pendingDecision,
  unsubscribed_negotiations: RETENTION_CLASSES.pendingDecision,
  user_notifications: RETENTION_CLASSES.pendingDecision,
  users: RETENTION_CLASSES.lifecycleBound,
  webhook_events: RETENTION_CLASSES.pendingDecision,
};

/**
 * الجداولُ التي **يُمنَعُ** إخراجُ صفٍّ منها من القاعدةِ إخراجاً آليّاً. تُقرَأُ
 * من التصنيفِ لا تُكتَبُ يدويّاً، فلا تتباعدُ القائمتانِ.
 */
export function isAutomatedRemovalForbidden(table: string): boolean {
  const cls = TABLE_RETENTION[table];
  return cls !== RETENTION_CLASSES.locationHotThenArchive;
}
