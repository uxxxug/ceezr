/**
 * الغرض: نموذجُ عرضِ شاشةِ الحسابِ — دالّاتٌ نقيّةٌ تُحوِّلُ الردَّ إلى مفاتيحِ
 *   نصٍّ وأعدادٍ، بلا JSX وبلا شبكةٍ (البند `F2-11` · `SR-12` · القسم 9.11).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-11`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/account
 * يُستخدم من: `AccountScreen.tsx`، ويُقاسُ مباشرةً في `tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: سطحُ السائقِ (`SD-12`) — المفاتيحُ مُعامَلةٌ.
 *
 * ## لماذا رمزٌ مجهولٌ يُقرأُ مفتاحاً عامّاً لا رمزاً خاماً
 *
 * سابقةُ `sos-view.ts` حرفاً. وههنا الأثرُ أشدُّ: شاشةٌ تعرضُ
 * `RATING_IS_TESTIMONY_FOR_THE_OTHER_PARTY` خاماً على إنسانٍ سألَ «لماذا بقيَ
 * تقييمي؟» **لم تُجِبْه**، بل زادَته ريبةً في اللحظةِ التي كانَ يُطمأَنُ فيها.
 *
 * ## ولماذا الإيصالُ يُرتَّبُ «مُحيَ ← جُهِّلَ ← بقيَ»
 *
 * لأنَّ الإنسانَ سألَ الحذفَ، فأوّلُ ما يستحقُّ أن يراه هوَ ما مُحيَ فعلاً.
 * وعرضُ «ما بقيَ» أوّلاً يقرؤه نقضاً لطلبِه. والترتيبُ ههنا في دالّةٍ نقيّةٍ
 * **لا في ترتيبِ مفاتيحِ الردِّ**: ترتيبُ `jsonb` غيرُ مضمونٍ.
 */

import type { ApiErasureReceipt, ApiRetainedSection } from "./account-contract.ts";

/** أسبابُ الإبقاءِ التي تعرفُ الواجهةُ نصَّها — مُقابِلةٌ للمجالِ في المجالِ. */
const KNOWN_BASES: ReadonlySet<string> = new Set([
  "CONSENT_IS_COMPLIANCE_EVIDENCE",
  "RATING_IS_TESTIMONY_FOR_THE_OTHER_PARTY",
  "SUPPORT_RECORD_MAY_BE_DISPUTED",
  "SAFETY_REPORT_MAY_BE_DISPUTED",
  "AUDIT_TRAIL_PROVES_THIS_ERASURE",
]);

const KNOWN_ERASURE_REFUSALS: ReadonlySet<string> = new Set([
  "ACTIVE_ORDER",
  "NOT_A_RIDER",
  "USER_NOT_FOUND",
  "INVALID_ACTOR",
]);

const KNOWN_EXPORT_REFUSALS: ReadonlySet<string> = new Set([
  "USER_NOT_FOUND",
  "ACCOUNT_ERASED",
  "INVALID_ACTOR",
]);

export function retentionBasisKey(basis: string): string {
  return KNOWN_BASES.has(basis) ? `rider.account.basis.${basis}` : "rider.account.basis.UNKNOWN";
}

export function erasureRefusalKey(refusal: string): string {
  return KNOWN_ERASURE_REFUSALS.has(refusal)
    ? `rider.account.erasure.refusal.${refusal}`
    : "rider.account.erasure.refusal.UNKNOWN";
}

export function exportRefusalKey(refusal: string): string {
  return KNOWN_EXPORT_REFUSALS.has(refusal)
    ? `rider.account.export.refusal.${refusal}`
    : "rider.account.export.refusal.UNKNOWN";
}

/** أخطاءُ الحدِّ التي لها نصٌّ. `CONFIRMATION_REQUIRED` منها: شرطٌ لا عطلٌ. */
const KNOWN_ERRORS: ReadonlySet<string> = new Set([
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "PRIVACY_STORE_NOT_AVAILABLE",
  "CONFIRMATION_REQUIRED",
]);

export function accountErrorKey(code: string): string {
  return KNOWN_ERRORS.has(code) ? `rider.account.error.${code}` : "rider.account.error.UNKNOWN";
}

/** انقطاعُ جلسةٍ لا تُعالَجُ بإعادةِ المحاولةِ بل بفتحِ التطبيقِ من جديدٍ. */
export function isRetryableAccountError(code: string): boolean {
  return code === "PRIVACY_STORE_NOT_AVAILABLE" || code === "UNKNOWN";
}

export interface ReceiptLine {
  readonly section: string;
  readonly rows: number;
  /** `null` لِما مُحيَ أو جُهِّلَ: لا أساسَ إبقاءٍ يُكتَبُ لِما لم يبقَ. */
  readonly basis: string | null;
}

export interface ReceiptView {
  readonly erased: readonly ReceiptLine[];
  readonly anonymized: readonly ReceiptLine[];
  readonly retained: readonly ReceiptLine[];
  /** مجموعُ ما مُحيَ وجُهِّلَ — يُعرَضُ رقماً واحداً يُطمئنُ قبلَ التفصيلِ. */
  readonly totalRemoved: number;
}

function linesOf(counts: Readonly<Record<string, number>>): readonly ReceiptLine[] {
  return Object.entries(counts)
    .map(([section, rows]) => ({ section, rows, basis: null }))
    .sort((a, b) => a.section.localeCompare(b.section));
}

function retainedLines(rows: readonly ApiRetainedSection[]): readonly ReceiptLine[] {
  return [...rows]
    .sort((a, b) => a.section.localeCompare(b.section))
    .map((entry) => ({ section: entry.section, rows: entry.rows, basis: entry.basis }));
}

export function toReceiptView(receipt: ApiErasureReceipt): ReceiptView {
  const erased = linesOf(receipt.erased);
  const anonymized = linesOf(receipt.anonymized);
  const totalRemoved = [...erased, ...anonymized].reduce((sum, line) => sum + line.rows, 0);
  return { erased, anonymized, retained: retainedLines(receipt.retained), totalRemoved };
}

/**
 * عددُ الأقسامِ في الحزمةِ — يُعرَضُ قبلَ التنزيلِ ليعرفَ الإنسانُ أنَّ ما
 * يأخذُه شيءٌ لا ملفٌّ فارغٌ. **ولا يُعرَضُ محتوى الأقسامِ على الشاشةِ**:
 * بيانةُ إنسانٍ كاملةً على شاشةٍ قد تُرى من فوقِ كتفِه.
 */
export function exportSectionCount(sections: Readonly<Record<string, unknown>>): number {
  return Object.keys(sections).length;
}
