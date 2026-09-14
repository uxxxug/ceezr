/**
 * الغرض: مجالُ دعمِ الراكبِ — **أصنافُ الشكوى** و**صيغةُ مرجعِ التذكرةِ**
 *   وحالاتُها، معرَّفةً مرّةً واحدةً (`F2-12` · `SR-11` · §9.11).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-12`.
 * ينتمي إلى: packages/domain/support
 * يُستخدم من: `packages/application/support/*` · `packages/infrastructure/support/*`
 *   · `apps/gateway/src/routes/support-tickets.ts`
 * يُتوقع أن يستخدمه لاحقاً: `SD-10` (شكوى السائقِ) — الأصنافُ تُوسَّعُ ههنا
 *   وحدَها ولا تُنسَخُ في سطحٍ ثانٍ.
 * الحاكم: docs/adr/0114-a-support-ticket-is-a-spoken-reference-not-a-uuid.md
 *
 * ## لماذا مجالٌ ولا مجرَّدُ نصٍّ يمرُّ من الواجهةِ إلى القاعدةِ
 *
 * الصنفُ الذي تقبلُه القاعدةُ نوعٌ معدودٌ؛ ونصٌّ يمرُّ بلا مقابلةٍ يُسقِطُ
 * النداءَ بعطبِ قاعدةٍ خامٍ (`22P02 invalid input value for enum`) يُقرأُ
 * `500` عندَ المستخدمِ. **فالمجالُ يُقرِّرُ قبلَ الشبكةِ**: صنفٌ خارجَ
 * المجالِ المغلقِ رفضٌ مُصنَّفٌ `422` لا عطبُ خادمٍ.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ — وحدودُه مُعلَنةٌ
 *
 *   ــ **لا يُولِّدُ مرجعاً**: التوليدُ في القاعدةِ (تسلسلٌ) لا في عمليّةٍ
 *      تُشغَّلُ مرّتَينِ فتُصادِمُ. وههنا **قراءةٌ ومقابلةٌ** فحسب.
 *   ــ **لا يقولُ زمنَ الاستجابةِ المتوقَّعَ**: قيمةٌ تجاريّةٌ في
 *      `platform_settings` لكلِّ مدينةٍ (القاعدة 0.3).
 *   ــ **لا يقولُ أيَّ صنفٍ يُسنَدُ إلى أيِّ موظّفٍ**: التوجيهُ في
 *      `ticket-advisor.ts` القائمِ، ولا يُنسَخُ حكمُه ههنا.
 *   ــ **لا يمنعُ صنفَ الاشتراكِ في القاعدةِ**: القاعدةُ تردُّه للراكبِ
 *      بـ`NOT_A_DRIVER`؛ وههنا يُخرَجُ من مجالِ الراكبِ **إضافةً** إلى ذاكَ
 *      لا بديلاً عنه (بابانِ لا بابٌ واحدٌ).
 */

/**
 * أصنافُ شكوى الراكبِ — **مجالٌ مغلقٌ يُقابِلُ النوعَ المعدودَ في القاعدةِ**
 * (`support_ticket_type`) في قيمِ الراكبِ وحدَها. و`subscription` غائبٌ عن
 * قصدٍ: شأنُ سائقٍ لا راكبٍ.
 */
export const RIDER_SUPPORT_CATEGORIES = [
  /** نزاعٌ على رحلةٍ بعينِها — قائمٌ منذُ المرحلةِ ٢٫٤. */
  "ride_dispute",
  /** مفقوداتٌ — منصوصةٌ في `SR-11` حرفاً. */
  "lost_item",
  /** سلوكُ سائقٍ. */
  "driver_conduct",
  /** عطبُ تطبيقٍ. */
  "app_problem",
  /** أخرى — بابٌ لا يُغلَقُ على مَن لا يجدُ صنفَه. */
  "other",
] as const;

export type RiderSupportCategory = (typeof RIDER_SUPPORT_CATEGORIES)[number];

export function isRiderSupportCategory(value: unknown): value is RiderSupportCategory {
  return (
    typeof value === "string" && (RIDER_SUPPORT_CATEGORIES as readonly string[]).includes(value)
  );
}

/**
 * الأصنافُ التي **يجبُ** أن تتعلَّقَ برحلةٍ بعينِها. ومفقوداتٌ بلا رحلةٍ شكوى
 * بلا موضوعٍ: لا سائقَ يُسألُ ولا مركبةَ تُفتَّشُ. وسلوكُ سائقٍ كذلكَ — بلا
 * رحلةٍ لا يُعرَفُ أيُّ سائقٍ. **والقاعدةُ تفحصُ المِلكيّةَ** إن أُرسِلَ معرّفٌ؛
 * وهذا يفحصُ **الحضورَ**، وهما شرطانِ لا شرطٌ مُكرَّرٌ.
 */
export const CATEGORIES_REQUIRING_ORDER: readonly RiderSupportCategory[] = [
  "ride_dispute",
  "lost_item",
  "driver_conduct",
];

export function categoryRequiresOrder(category: RiderSupportCategory): boolean {
  return CATEGORIES_REQUIRING_ORDER.includes(category);
}

/** حالاتُ التذكرةِ كما في `support_ticket_status` — مجالٌ مغلقٌ. */
export const SUPPORT_TICKET_STATUSES = ["open", "claimed", "resolved", "rejected"] as const;
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];

export function isSupportTicketStatus(value: unknown): value is SupportTicketStatus {
  return (
    typeof value === "string" && (SUPPORT_TICKET_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * صيغةُ المرجعِ المنطوقِ: `WSL-` ثمَّ ستُّ خاناتٍ عشريّةٍ بحدٍّ أدنى، **بلا حرفٍ
 * ملتبِسٍ ولا حدٍّ أعلى** — يطولُ من نفسِه بعدَ المليونِ بلا هجرةٍ ثانيةٍ.
 * والمقابلةُ مُثبَّتةٌ من الطرفَينِ (`^…$`) فلا يمرُّ مرجعٌ فيه زيادةٌ.
 */
export const SUPPORT_TICKET_REFERENCE_PATTERN = /^WSL-[0-9]{6,}$/;

export function isSupportTicketReference(value: unknown): value is string {
  return typeof value === "string" && SUPPORT_TICKET_REFERENCE_PATTERN.test(value);
}

/**
 * حدُّ نصِّ الشكوى بالمحارفِ. **ليسَ قيمةً تجاريّةً** بل حدُّ سلامةٍ: جسمٌ بلا
 * حدٍّ بابُ إنهاكٍ، والحدُّ يُقابِلُ ما تحملُه بطاقةُ قروبِ تيليجرام بلا قطعٍ.
 */
export const MAX_SUPPORT_MESSAGE_CHARS = 1000;

/** الحدُّ الأعلى لصفحةِ تذاكرَ — يُقابِلُ حدَّ الدالّةِ في القاعدةِ حرفاً. */
export const MAX_SUPPORT_PAGE_SIZE = 50;
export const DEFAULT_SUPPORT_PAGE_SIZE = 20;

/** تذكرةٌ كما تُعرَضُ لصاحبِها — **بلا اسمِ موظّفٍ ولا معرّفِه**. */
export interface RiderSupportTicket {
  readonly id: string;
  readonly reference: string;
  readonly category: RiderSupportCategory | "subscription";
  readonly status: SupportTicketStatus;
  readonly message: string;
  readonly resolution: string | null;
  readonly orderId: string | null;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

/** مؤشِّرُ الصفحةِ التاليةِ — **شطرانِ معاً أو لا شيءَ** (`ADR 0108`). */
export interface SupportTicketCursor {
  readonly createdAt: string;
  readonly id: string;
}

export interface RiderSupportPage {
  readonly tickets: readonly RiderSupportTicket[];
  readonly hasMore: boolean;
  readonly nextCursor: SupportTicketCursor | null;
  /**
   * يُعرَضُ للمستخدمِ نصّاً؛ مصدرُه إعدادُ المدينةِ لا شِفرةٌ. و`null` معناه
   * **لا وعدَ زمنٍ لهذه المدينةِ بعدُ** — والشاشةُ تسكتُ عنه ولا تختلقُ رقماً.
   */
  readonly expectedResponseMinutes: number | null;
}

/**
 * إيصالُ فتحِ تذكرةٍ — **المرجعُ أوّلُ ما يُقرأُ** لأنَّه ما يُنطَقُ. ولا زمنَ
 * استجابةٍ ههنا: الفتحُ لا يقرأُ إعداداً ثانياً بعدَ كتابتِه، والشاشةُ تقرؤه من
 * صفحةِ التذاكرِ التي تُعرَضُ بعدَ الفتحِ — قراءةٌ واحدةٌ لا قراءتانِ.
 */
export interface OpenedSupportTicket {
  readonly reference: string;
  readonly ticketId: string;
  readonly category: RiderSupportCategory;
}
