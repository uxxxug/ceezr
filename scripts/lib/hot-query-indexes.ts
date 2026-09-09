/**
 * الغرض: `F7-02` / `CAP-005` — سجلٌّ واحدٌ مُصرَّحٌ للفهارسِ التي أُنشئَت لخدمةِ
 *   استعلاماتٍ ساخنةٍ موجودةٍ في الكودِ اليومَ، ومصدرُ الحقيقةِ الوحيدُ لثلاثةِ
 *   مُستهلِكينَ: الحاجزُ (`scripts/check-hot-query-index-coverage.ts`) الذي يُثبِتُ
 *   أنَّ لكلِّ فهرسٍ هجرةً مطابقةً ومُستدعياً إنتاجيّاً، واختبارُ الوحدةِ الذي
 *   يُثبِتُ ثوابتَ السجلِّ، واختبارُ التكاملِ الذي يقيسُ **خطّةَ التنفيذِ قبلَ
 *   الفهرسِ وبعدَه** على محرِّكٍ حقيقيٍّ.
 *
 * الحالة: مكتبةٌ مُستخدَمةٌ — لا مُخرَجَ لها بنفسِها.
 * ينتمي إلى: scripts/lib
 * يُتوقع أن يستخدمه لاحقاً: أيُّ فهرسٍ جديدٍ يُضافُ لخدمةِ استعلامٍ ساخنٍ
 *   يُسجَّلُ ههنا فيُحاكَمُ آليّاً بلا مراجعةٍ يدويّةٍ.
 * ملاحظات مستقبلية: إذا صارَ للمشروعِ `pg_stat_statements` في الإنتاجِ فليصرْ
 *   ترتيبُ «الأثرِ» مقيساً من الإنتاجِ لا مُستنبَطاً من تواترِ الاستدعاءِ.
 * ما لا يفعله — وحدودُه مُعلَنةٌ لا مضمرةٌ:
 *   - لا يُنشئُ فهرساً ولا يُطبِّقُ هجرةً؛ الهجراتُ ملفّاتٌ مستقلّةٌ والمُطبِّقُ
 *     غيرُه (`scripts/migrate.ts`).
 *   - لا يدّعي أنَّ هذه الفهارسَ كلُّ ما تحتاجُه القاعدةُ؛ يدّعي أنَّ كلَّ واحدٍ
 *     منها يخدمُ استعلاماً موجوداً، وأنَّ الخطّةَ تحسَّنَت بهِ قياساً.
 *   - لا يُقدِّرُ حجمَ جدولٍ في الإنتاجِ؛ «الأثرُ» ههنا رتبةٌ مُعلَّلةٌ بتواترِ
 *     الاستدعاءِ ونموِّ الجدولِ، لا رقمٌ مقيسٌ من الإنتاجِ.
 */

/** مُستدعٍ إنتاجيٌّ مُصرَّحٌ: ملفٌّ وسطرٌ وسببٌ يُقرأُ. */
export type HotQueryCaller = {
  /** مسارٌ نسبيٌّ من جذرِ المستودعِ. */
  readonly file: string;
  /** وصفُ ما يفعلُه المُستدعي — لا نصُّ الاستعلامِ. */
  readonly what: string;
};

/** فهرسٌ مُصرَّحٌ: تعريفُه وهجرتُه ومُستدعوهُ واستعلامُ قياسِ خطّتِه. */
export type HotQueryIndex = {
  /** اسمُ الفهرسِ كما في `create index`. */
  readonly name: string;
  /** الجدولُ الذي يقومُ عليهِ. */
  readonly table: string;
  /** ملفُّ الهجرةِ الذي يُنشئُه — بلا مسارٍ. */
  readonly migration: string;
  /** رتبةُ الأثرِ: ١ أعلى. */
  readonly rank: number;
  /** سببُ وجودِه: لماذا لم يكفِ فهرسٌ قائمٌ. */
  readonly why: string;
  /** المُستدعونَ الإنتاجيّونَ — القاعدةُ السياديّةُ 0.1. */
  readonly callers: readonly HotQueryCaller[];
  /**
   * استعلامٌ يُمثِّلُ الشكلَ الساخنَ بلا معاملاتٍ، صالحٌ لـ`explain`.
   * ليسَ نسخةَ الاستعلامِ الإنتاجيِّ حرفاً — بل شكلَ ترشيحِه وفرزِه.
   */
  readonly probe: string;
};

/**
 * الفهارسُ الستُّ. لا يُضافُ إليها فهرسٌ إلّا بمُستدعٍ إنتاجيٍّ مُصرَّحٍ
 * وبهجرةٍ في طورِ `index`، وإلّا أسقطَ الحاجزُ البناءَ.
 */
export const HOT_QUERY_INDEXES: readonly HotQueryIndex[] = Object.freeze([
  {
    name: "orders_assigned_driver_status_idx",
    table: "orders",
    migration: "20260909060000_f7_02_orders_assigned_driver_status_index.sql",
    rank: 1,
    why:
      "`assigned_driver_id` مفتاحٌ خارجيٌّ بلا فهرسٍ ألبتّةَ، و`orders` ينمو بلا سقفٍ؛ " +
      "وكلُّ نبضةِ موقعٍ وكلُّ شوطِ خريطةٍ حيّةٍ يسألُ عن طلبِ سائقٍ بحالةٍ.",
    callers: [
      {
        file: "packages/infrastructure/tracking/tracking-queries.ts",
        what: "طلبُ السائقِ الجاري في مسارِ نبضةِ الموقعِ وصفحةِ التتبُّعِ",
      },
      {
        file: "apps/gateway/src/admin/queries.ts",
        what: "الخريطةُ الحيّةُ: طلبٌ لكلِّ سائقٍ عبرَ `lateral`",
      },
      {
        file: "supabase/migrations/20260808040000_phase_2_6_scheduled_jobs.sql",
        what: "`deactivate_stale_availability`: `not exists` لكلِّ سائقٍ بائتٍ كلَّ نصفِ ساعةٍ",
      },
    ],
    probe:
      "select id from orders where assigned_driver_id = $1 " +
      "and status in ('matched','in_progress') limit 1",
  },
  {
    name: "orders_rider_status_idx",
    table: "orders",
    migration: "20260909061000_f7_02_orders_rider_status_index.sql",
    rank: 2,
    why:
      "`rider_id` كذلكَ مفتاحٌ خارجيٌّ بلا فهرسٍ، والاستعلامانِ في **مسارِ طلبٍ " +
      "تفاعليٍّ** («أين طلبي؟» وسجلُّ الراكبِ) لا في مهمّةٍ خلفيّةٍ.",
    callers: [
      {
        file: "packages/infrastructure/transport/order-adapters.ts",
        what: "طلباتُ الراكبِ النشطةُ وسجلُّه",
      },
    ],
    probe:
      "select id from orders where rider_id = $1 " +
      "and status in ('searching','matched','in_progress') " +
      "order by created_at asc limit 20",
  },
  {
    name: "orders_city_searching_created_idx",
    table: "orders",
    migration: "20260909062000_f7_02_orders_city_searching_created_index.sql",
    rank: 3,
    why:
      "`orders_city_status_idx (city_id, status)` يُرشِّحُ ولا يُعطي `created_at` مُرتَّباً، " +
      "فيلزمُ فرزٌ في كلِّ شوطٍ: إعادةُ البثِّ كلَّ عشرينَ ثانيةً ومسحُ غيرِ المُسنَدِ " +
      "كلَّ دقيقةٍ. والفهرسُ جزئيٌّ فيبقى صغيراً لأنَّ «الباحثَ» حالةٌ عابرةٌ.",
    callers: [
      {
        file: "packages/infrastructure/dispatch/dispatch-adapters.ts",
        what: "إعادةُ بثِّ الطلباتِ الباحثةِ لكلِّ مدينةٍ",
      },
      {
        file: "packages/infrastructure/dispatch/unmatched-adapters.ts",
        what: "مسحُ الطلباتِ الباحثةِ التي طالَ بحثُها",
      },
    ],
    probe:
      "select id from orders where city_id = $1 and status = 'searching' " +
      "order by created_at asc limit 50",
  },
  {
    name: "notification_outbox_ride_cycle_due_idx",
    table: "notification_outbox",
    migration: "20260909063000_f7_02_outbox_ride_cycle_due_index.sql",
    rank: 4,
    why:
      "بعدَ توحيدِ الصندوقِ صارَ البثُّ الجماهيريُّ يسكنُ الجدولَ نفسَه، ودفعةٌ واحدةٌ " +
      "تُدخِلُ آلافَ صفوفٍ مُعلَّقةٍ. ومُطالِبُ دورةِ الرحلةِ يقرأُ الفهرسَ العامَّ " +
      "فيمرُّ على صفوفِ البثِّ كلِّها ثمَّ يُرتِّبُ — كلَّ ثلاثينَ ثانيةً. و`created_at` " +
      "وحدَه عمودُ الفهرسِ لأنَّ المُطالِبَ يُرتِّبُ بهِ ويكتفي بصفٍّ واحدٍ.",
    callers: [
      {
        file: "supabase/migrations/20260908021000_unified_outbox_ride_cycle_claim_scope.sql",
        what: "`claim_due_notifications`: مُطالِبُ أنواعِ دورةِ الرحلةِ وحدَها",
      },
    ],
    probe:
      "select id from notification_outbox where status = 'pending' " +
      "and next_attempt_at <= now() " +
      "and kind in ('offer','dispute_resolution','negotiation_turn_opened'," +
      "'negotiation_turn_closed','negotiation_agreed','wider_circle_opened'," +
      "'no_driver_found','order_cancelled') order by created_at limit 1",
  },
  {
    name: "audit_log_action_entity_idx",
    table: "audit_log",
    migration: "20260909064000_f7_02_audit_log_action_entity_index.sql",
    rank: 5,
    why:
      "`audit_log_entity_idx (entity_type, entity_id)` عمودُه اليسرى `entity_type` " +
      "وهوَ غيرُ مُرشَّحٍ في هذا الاستعلامِ فلا بادئةَ صحيحةَ لهُ، والجدولُ من أسرعِ " +
      "الجداولِ نموّاً: صفٌّ لكلِّ تبديلِ حضورٍ وكلِّ إسنادٍ وكلِّ قرارٍ إداريٍّ.",
    callers: [
      {
        file: "supabase/migrations/20260814020000_expiring_soon_is_per_city.sql",
        what: "`not exists` مُرتبِطٌ لكلِّ اشتراكٍ مرشَّحٍ في مهمّةِ التحذيرِ",
      },
    ],
    probe: "select 1 from audit_log where action = $1 and entity_id = $2 limit 1",
  },
  {
    name: "attendance_log_changed_at_idx",
    table: "attendance_log",
    migration: "20260909065000_f7_02_attendance_log_changed_at_index.sql",
    rank: 6,
    why:
      "سجلٌّ يُلحَقُ بهِ عندَ كلِّ تبديلِ توفُّرٍ فينمو بلا سقفٍ، والاستعلامانِ نافذةُ " +
      "زمنٍ وترشيحُ المدينةِ فيهما اختياريٌّ؛ فلا يخدمُهما `attendance_log_city_idx` " +
      "ولا `attendance_log_driver_time_idx` الذي يسراهُ `driver_id`.",
    callers: [
      {
        file: "apps/gateway/src/admin/queries.ts",
        what: "صفحةُ الحضورِ ورابطةُ الأحداثِ في تقريرِ ساعاتِ العملِ",
      },
    ],
    probe:
      "select id from attendance_log where changed_at >= now() - interval '7 days' " +
      "order by changed_at desc limit 100",
  },
]);

/** الطورُ الذي تُطبَّقُ فيهِ هذه الهجراتُ — بلا معاملةٍ (F7-07). */
export const HOT_QUERY_INDEX_PHASE = "index";

/** الفهرسُ بالاسمِ، أو `undefined`. */
export function hotIndexByName(name: string): HotQueryIndex | undefined {
  return HOT_QUERY_INDEXES.find((entry) => entry.name === name);
}

/**
 * أعمدةُ فهرسٍ من نصِّ `create index` — بترتيبِها كما كُتِبَت، مُنظَّفةً من
 * `desc`/`asc` ومن الفراغِ. تُستخدَمُ لكشفِ الفهرسِ المُكرِّرِ.
 * ترجعُ `null` إن لم يكنِ النصُّ إنشاءَ فهرسٍ على الجدولِ المطلوبِ.
 */
export function indexColumnsOf(statement: string, table: string): string[] | null {
  const normalized = statement.replace(/\s+/g, " ").trim();
  const pattern = new RegExp(
    `create\\s+(?:unique\\s+)?index\\s+(?:concurrently\\s+)?(?:if\\s+not\\s+exists\\s+)?` +
      `[a-z0-9_]+\\s+on\\s+(?:public\\.)?${table}\\b\\s*(?:using\\s+[a-z0-9_]+\\s*)?\\(([^)]*)\\)`,
    "i",
  );
  const match = pattern.exec(normalized);
  if (match === null) return null;
  const inner = match[1];
  if (inner === undefined) return null;
  return inner
    .split(",")
    .map((column) =>
      column
        .trim()
        .replace(/\s+(desc|asc)$/i, "")
        .trim(),
    )
    .filter((column) => column.length > 0);
}

/**
 * شرطُ الفهرسِ الجزئيِّ مُطبَّعاً، أو `""` إن كانَ الفهرسُ كاملاً.
 * فهرسانِ بنفسِ الأعمدةِ ونفسِ الشرطِ مُكرِّرانِ، وبشرطَينِ مختلفَينِ ليسا كذلكَ:
 * الجزئيُّ يخدمُ ترشيحاً لا يخدمُه الكاملُ بنفسِ الكلفةِ.
 */
export function indexPredicateOf(statement: string): string {
  const normalized = statement.replace(/\s+/g, " ").trim();
  const match = /\bwhere\b(.*)$/i.exec(normalized);
  if (match === null) return "";
  const predicate = match[1];
  if (predicate === undefined) return "";
  return predicate.replace(/;\s*$/, "").replace(/\s+/g, " ").trim().toLowerCase();
}
