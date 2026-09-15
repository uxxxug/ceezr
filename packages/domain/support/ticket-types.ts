/**
 * الغرض: **مجالُ القراءةِ** لأصنافِ تذاكرِ الدعمِ — كلُّ قيمِ
 *   `support_ticket_type` في القاعدةِ، معرَّفةً مرّةً واحدةً (`F3-08` · `SD-10`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-08`.
 * ينتمي إلى: packages/domain/support
 * يُستخدم من: `packages/domain/support/{rider,driver}-support.ts` ·
 *   `packages/infrastructure/support/*-store.ts`
 * يُتوقع أن يستخدمه لاحقاً: أيُّ سطحٍ يقرأُ تذكرةً لا يكتبُها (لوحُ موظّفِ دعمٍ).
 * الحاكم: docs/adr/0114-a-support-ticket-is-a-spoken-reference-not-a-uuid.md
 *
 * ## لِمَ مجالُ **القراءةِ** يختلفُ عن مجالِ **الكتابةِ**
 *
 * مَن يفتحُ تذكرةً يفتحُها **بدورٍ**: الراكبُ لا يفتحُ «خصماً»، والسائقُ لا يفتحُ
 * «مفقوداتٍ». فمجالُ الكتابةِ مُقسَّمٌ في ملفَّي الدورَينِ.
 *
 * **أمّا القراءةُ فلا تُقسَمُ**، وذاكَ لعِلّةٍ في المخطَّطِ لا في الذوقِ:
 * `open_support_ticket` تكتبُ في الصفِّ **`driver_id` و`rider_id` معاً** إذا كانَ
 * لصاحبِ الحسابِ صفَّانِ. فحسابٌ سائقٌ وراكبٌ يفتحُ تذكرةَ «خصمٍ» **تظهرُ في
 * صفحةِ تذاكرِه الراكبةِ أيضاً** (`where rider_id = …`). ومحوّلٌ يرفضُ صنفاً لا
 * يعرفُه يُسقِطُ **الصفحةَ كلَّها** بـ`MALFORMED_RESULT` — أي `503` على شاشةِ
 * راكبٍ لم يفعلْ شيئاً. **فمجالُ القراءةِ هوَ النوعُ كلُّه** أو تنكسرُ صفحةٌ
 * قائمةٌ عندَ أوّلِ صنفٍ جديدٍ.
 *
 * وهذا **توسيعٌ لا تخفيفٌ** (`ح-8`): الصنفُ الذي **يُقبَلُ كتابةً** ما زالَ
 * محكوماً بدورِه في القاعدةِ (`NOT_A_DRIVER`) وفي مجالِ الدورِ قبلَ الشبكةِ.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ
 *
 *   ــ **لا يقولُ مَن يفتحُ أيَّ صنفٍ**: ذاكَ في ملفَّي الدورَينِ.
 *   ــ **لا يُقرأُ في نداءِ كتابةٍ**: استعمالُه هناك يفتحُ لكلِّ دورٍ كلَّ صنفٍ.
 *   ــ **لا يُولَّدُ من القاعدةِ في زمنِ التشغيلِ**: قائمةٌ مكتوبةٌ يقابلُها فحصُ
 *      تكاملٍ يقرأُ `pg_enum` ويُسقِطُ عندَ أوّلِ افتراقٍ — فالتطابقُ **مقيسٌ**
 *      لا مأمولٌ، ولا استعلامَ في كلِّ قراءةِ صفحةٍ.
 */

/**
 * كلُّ قيمِ `support_ticket_type` في القاعدةِ — **بترتيبِ إضافتِها** لا
 * بترتيبِ حروفٍ، فيُقرأُ التاريخُ من القائمةِ نفسِها.
 */
export const SUPPORT_TICKET_TYPES = [
  /** اشتراكُ السائقِ — أوّلُ القيمِ منذُ المرحلةِ ٢٫٤. */
  "subscription",
  /** نزاعٌ على رحلةٍ. */
  "ride_dispute",
  /** مفقوداتٌ — `SR-11`. */
  "lost_item",
  /** سلوكُ سائقٍ — يفتحُها الراكبُ. */
  "driver_conduct",
  /** عطبُ تطبيقٍ — للدورَينِ. */
  "app_problem",
  /** أخرى — للدورَينِ. */
  "other",
  /** خصمٌ من حصيلةِ السائقِ — `SD-10`. */
  "deduction",
  /** سلوكُ راكبٍ — يفتحُها السائقُ، `SD-10`. */
  "rider_conduct",
  /** مركبةُ السائقِ — `SD-10`. */
  "vehicle",
] as const;

export type SupportTicketType = (typeof SUPPORT_TICKET_TYPES)[number];

export function isSupportTicketType(value: unknown): value is SupportTicketType {
  return typeof value === "string" && (SUPPORT_TICKET_TYPES as readonly string[]).includes(value);
}

/**
 * حالاتُ التذكرةِ كما في `support_ticket_status` — مجالٌ مغلقٌ **عديمُ الدورِ**:
 * حالةُ تذكرةٍ لا تختلفُ بمَن فتحَها، فمصدرُها واحدٌ ههنا.
 */
export const SUPPORT_TICKET_STATUSES = ["open", "claimed", "resolved", "rejected"] as const;
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];

export function isSupportTicketStatus(value: unknown): value is SupportTicketStatus {
  return (
    typeof value === "string" && (SUPPORT_TICKET_STATUSES as readonly string[]).includes(value)
  );
}

/** مؤشِّرُ الصفحةِ التاليةِ — **شطرانِ معاً أو لا شيءَ** (`ADR 0108`). */
export interface SupportTicketCursor {
  readonly createdAt: string;
  readonly id: string;
}

/**
 * تذكرةٌ كما تُعرَضُ لصاحبِها — **بلا اسمِ موظّفٍ ولا معرِّفِه**، وصنفُها من
 * **مجالِ القراءةِ** لا من مجالِ دورٍ (العِلّةُ في رأسِ الملفِّ).
 */
export interface SupportTicketView {
  readonly id: string;
  readonly reference: string;
  readonly category: SupportTicketType;
  readonly status: SupportTicketStatus;
  readonly message: string;
  readonly resolution: string | null;
  readonly orderId: string | null;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

/** صفحةُ تذاكرَ بترقيمِ مفتاحٍ — شكلٌ واحدٌ للدورَينِ لأنَّ الدالّتَينِ نظيرتانِ. */
export interface SupportTicketsPage {
  readonly tickets: readonly SupportTicketView[];
  readonly hasMore: boolean;
  readonly nextCursor: SupportTicketCursor | null;
  /**
   * يُعرَضُ للمستخدمِ نصّاً؛ مصدرُه إعدادُ المدينةِ لا شِفرةٌ. و`null` معناه
   * **لا وعدَ زمنٍ لهذه المدينةِ بعدُ** — والشاشةُ تسكتُ عنه ولا تختلقُ رقماً.
   */
  readonly expectedResponseMinutes: number | null;
}

/**
 * إيصالُ فتحِ تذكرةٍ — **المرجعُ أوّلُ ما يُقرأُ** لأنَّه ما يُنطَقُ. والصنفُ
 * **مُعامَلُ نوعٍ** لأنَّ الكتابةَ بدورٍ: إيصالُ الراكبِ لا يحملُ «خصماً».
 */
export interface OpenedSupportTicketOf<C extends SupportTicketType> {
  readonly reference: string;
  readonly ticketId: string;
  readonly category: C;
}
