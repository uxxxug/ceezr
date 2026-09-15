/**
 * الغرض: نموذجُ عرضِ سطحِ الدعمِ — دالّاتٌ نقيّةٌ تُحوِّلُ الردَّ والرمزَ إلى
 *   مفاتيحِ نصٍّ، **مُعامَلةٌ بالبادئةِ والمجالِ** فتصلحُ للدورَينِ بلا نسخةٍ
 *   (`F2-12` · `SR-11` · `F3-08` · `SD-10` · القسم 9.11).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-08` (الزيادةُ `S-5`)، ومنقولٌ عن `F2-12`.
 * ينتمي إلى: apps/miniapp/src/surfaces/support
 * يُستخدم من: `rider/support/support-view.ts` · `driver/support/support-view.ts`
 *   · `TicketsScreen.tsx`، ويُقاسُ عبرَهما في `tests/unit`.
 *
 * ## لِمَ رموزُ العطبِ قائمةٌ **واحدةٌ** لا قائمةٌ لكلِّ دورٍ
 *
 * لأنَّ الرموزَ تصدرُ عن **نواةِ استقبالٍ واحدةٍ** في طبقةِ التطبيقِ
 * (`packages/application/support/intake.ts`)، فلا يوجدُ رمزٌ يراهُ راكبٌ ولا
 * يراهُ سائقٌ. وقائمتانِ تفترقانِ بعدَ رمزٍ يُزادُ: يُترجَمُ في سطحٍ ويُعرَضُ
 * خاماً في الآخرِ — على إنسانٍ **يشكو من عطبٍ** فيصيرُ العطبُ عطبَينِ.
 *
 * ## ولِمَ لا تُستورَدُ القائمةُ من `packages/application`
 *
 * لأنَّ التطبيقَ المُصغَّرَ لا يستوردُ طبقةَ التطبيقِ اليومَ (حزمةُ متصفِّحٍ لا
 * تحملُ شِفرةَ خادمٍ). والتطابقُ **مفروضٌ بحاجزٍ** لا بحسنِ نيّةٍ:
 * `scripts/lib/support-intake-contract.ts` يقرأُ مجالَ الطبقةِ ويطلبُ نصّاً
 * لكلِّ رمزٍ فيه في القواميسِ الثلاثةِ — فرمزٌ يُزادُ هناكَ ولا يُزادُ ههنا
 * **يُسقِطُ الحاجزَ** لا يمرُّ صامتاً.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ (`ح-5`)
 *
 *   ــ **لا يُنسِّقُ وقتاً بلغةٍ**: التنسيقُ في الشاشةِ بأداةِ المنصّةِ.
 *   ــ **لا يُصنِّفُ «مُهِمٌّ» ولا يُرتِّبُ أولويّةً**: الترتيبُ زمنيٌّ من
 *      القاعدةِ، وأولويّةُ الدعمِ حكمُ `ticket-advisor` في الخادمِ.
 *   ــ **لا يبني صنفَ نمطٍ**: النغمةُ رمزٌ مجرَّدٌ، والجدولُ الحرفيُّ في الشاشةِ
 *      كي يقرأَه حاجزُ تغطيةِ الأنماطِ ساكناً (`ADR 0105`).
 */

import type { ApiSupportStatus, ApiSupportTicket } from "./ticket-contract.ts";

/**
 * رموزُ العطبِ التي لسطحِ الدعمِ نصٌّ لها — **مُقابِلةٌ لمجالِ طبقةِ التطبيقِ
 * حرفاً** ومحروسةٌ بحاجزِ العقدِ.
 */
export const SUPPORT_SURFACE_ERROR_CODES: readonly string[] = [
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "SUPPORT_STORE_NOT_AVAILABLE",
  "CATEGORY_UNKNOWN",
  "MESSAGE_EMPTY",
  "MESSAGE_TOO_LONG",
  "ORDER_REQUIRED",
  "ORDER_INVALID",
  "ORDER_NOT_YOURS",
  "COOLDOWN_ACTIVE",
  "ACCOUNT_BLOCKED",
  "NOT_REGISTERED",
  "CITY_NOT_READY",
  "LIMIT_OUT_OF_RANGE",
  "CURSOR_INVALID",
];

const KNOWN_ERRORS: ReadonlySet<string> = new Set(SUPPORT_SURFACE_ERROR_CODES);

const KNOWN_STATUSES: readonly string[] = ["open", "claimed", "resolved", "rejected"];

/**
 * نغمةُ شارةِ الحالةِ — **رمزٌ مجرَّدٌ لا صنفُ نمطٍ**: بناءُ اسمِ صنفٍ ههنا
 * يُخرِجُه من قياسِ حاجزِ الأنماطِ (`ADR 0105`)، والشاشةُ وحدَها تملِكُ الجدولَ
 * الحرفيَّ الذي يُقابِلُ الرمزَ بصنفٍ مكتوبٍ.
 */
export type SupportStatusTone = "open" | "working" | "done" | "refused";

export function statusTone(status: string): SupportStatusTone {
  if (status === "claimed") return "working";
  if (status === "resolved") return "done";
  if (status === "rejected") return "refused";
  return "open";
}

/**
 * أيُّ الأعطابِ **تُعادُ المحاولةُ فيه بزرٍّ**. والتهدئةُ ليست منها: إعادةٌ
 * فوريّةٌ تُردُّ رفضاً ثانياً فيُقرأُ عطلاً — والشاشةُ تقولُ الثانيةَ وتنتظرُ.
 */
export function isRetryableSupportError(code: string): boolean {
  return code === "SUPPORT_STORE_NOT_AVAILABLE" || code === "UNKNOWN" || code === "CITY_NOT_READY";
}

/** صفٌّ كما تعرضُه الشاشةُ — مفاتيحُ لا نصوصٌ. */
export interface SupportTicketRow {
  readonly id: string;
  readonly reference: string;
  readonly categoryKey: string;
  readonly statusKey: string;
  readonly statusTone: SupportStatusTone;
  readonly message: string;
  readonly resolution: string | null;
  readonly createdAt: string;
  /** هل لها رحلةٌ؟ — الشاشةُ تُظهِرُ سطراً لا معرّفاً خاماً بطولِ ٣٦ محرفاً. */
  readonly hasOrder: boolean;
}

/**
 * وصفُ سطحِ دورٍ — **بادئةُ نصٍّ ومجالُ اختيارٍ ومجالُ قراءةٍ**. والفرقُ بينَ
 * الأخيرَينِ هوَ عِلّةُ وجودِ هذا النوعِ: صنفٌ يُعرَضُ ولا يُختارُ (اشتراكُ
 * سائقٍ في صفحةِ راكبٍ ذي دورَينِ) له نصٌّ واجبٌ وليسَ له مدخلٌ في النموذجِ.
 */
export interface SupportSurfaceSpec {
  /** مثالُها `rider.support.` — **بنقطةٍ في آخرِها** فلا يُلصَقُ مفتاحٌ بمفتاحٍ. */
  readonly keyPrefix: string;
  /** ما يُختارُ في نموذجِ الفتحِ — بترتيبِ العرضِ. */
  readonly selectableCategories: readonly string[];
  /** ما يُعرَضُ في القائمةِ ولا يُختارُ. */
  readonly readOnlyCategories: readonly string[];
  /** أصنافٌ لا معنى لها بلا رحلةٍ — حكمُ الطبقةِ نفسُه لا نسخةٌ عرضٍ. */
  readonly requiresOrder: (category: string) => boolean;
  /** حدُّ نصِّ الشكوى **بالمحارفِ** كما نشرَه النطاقُ. */
  readonly maxMessageChars: number;
}

/** نموذجُ عرضٍ مربوطٌ بدورٍ — يُبنى مرّةً في سطحِ الدورِ. */
export interface SupportViewModel {
  readonly errorKey: (code: string) => string;
  readonly categoryKey: (category: string) => string;
  readonly statusKey: (status: ApiSupportStatus | string) => string;
  readonly toTicketRow: (ticket: ApiSupportTicket) => SupportTicketRow;
  readonly canSubmit: (input: {
    readonly category: string | null;
    readonly message: string;
    readonly orderId: string | null;
    readonly busy: boolean;
  }) => boolean;
  readonly remainingChars: (message: string) => number;
}

export function supportViewModel(spec: SupportSurfaceSpec): SupportViewModel {
  const displayable: ReadonlySet<string> = new Set([
    ...spec.selectableCategories,
    ...spec.readOnlyCategories,
  ]);

  const categoryKey = (category: string): string =>
    displayable.has(category)
      ? `${spec.keyPrefix}category.${category}`
      : `${spec.keyPrefix}category.unknown`;

  const statusKey = (status: ApiSupportStatus | string): string =>
    KNOWN_STATUSES.includes(status)
      ? `${spec.keyPrefix}status.${status}`
      : `${spec.keyPrefix}status.unknown`;

  return {
    errorKey: (code) =>
      KNOWN_ERRORS.has(code) ? `${spec.keyPrefix}error.${code}` : `${spec.keyPrefix}error.UNKNOWN`,
    categoryKey,
    statusKey,
    toTicketRow: (ticket) => ({
      id: ticket.id,
      reference: ticket.reference,
      categoryKey: categoryKey(ticket.category),
      statusKey: statusKey(ticket.status),
      statusTone: statusTone(ticket.status),
      message: ticket.message,
      resolution: ticket.resolution,
      createdAt: ticket.createdAt,
      hasOrder: ticket.orderId !== null,
    }),
    /**
     * هل النموذجُ صالحٌ للإرسالِ؟ — **فحصٌ للزرِّ لا بديلٌ عن الخادمِ**: يمنعُ
     * ذَهاباً يُردُّ يقيناً، ولا يُغنِي عن حكمِ الخادمِ لأنَّ الزرَّ يُتجاوَزُ.
     */
    canSubmit: (input) => {
      if (input.busy) return false;
      if (input.category === null) return false;
      if (!spec.selectableCategories.includes(input.category)) return false;
      const trimmed = input.message.trim();
      if (trimmed.length === 0) return false;
      if ([...trimmed].length > spec.maxMessageChars) return false;
      if (input.orderId === null && spec.requiresOrder(input.category)) return false;
      return true;
    },
    /** المتبقّي من الحدِّ — عدٌّ يُعرَضُ، وسالبُه صفرٌ لا رقمٌ سالبٌ على شاشةٍ. */
    remainingChars: (message) => Math.max(0, spec.maxMessageChars - [...message].length),
  };
}
