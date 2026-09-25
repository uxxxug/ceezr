/**
 * الغرض: نموذجُ عرضِ سطحِ الحسابِ — دالّاتٌ نقيّةٌ **مُعامَلةٌ بالبادئةِ** تصلحُ
 *   للدورَينِ بلا نسخةٍ، ومجالاتُها المغلقةُ **مقروءةٌ من النطاقِ لا منسوخةٌ**
 *   (`F2-11` · `SR-12` · `SD-12` · القسم 9.11).
 * الحالة: منفَّذٌ فعليّاً — البند `SD-12`، ومنقولٌ عن `F2-11`.
 * ينتمي إلى: apps/miniapp/src/surfaces/account
 * يُستخدم من: `rider/account/account-view.ts` · `driver/account/account-view.ts`
 *   · `AccountRights.tsx`، ويُقاسُ عبرَها في `tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: أيُّ دورٍ ثالثٍ يمحو حسابَه — يُزادُ **وصفاً** ولا
 *   تُكتَبُ مجالاتٌ ثانيةٌ للسؤالِ نفسِه.
 * الحاكم: docs/adr/0126-one-account-core-two-roles.md
 *
 * ## لماذا رمزٌ مجهولٌ يُقرأُ مفتاحاً عامّاً لا رمزاً خاماً
 *
 * سابقةُ `sos-view.ts` حرفاً. وههنا الأثرُ أشدُّ: شاشةٌ تعرضُ
 * `RATING_IS_TESTIMONY_FOR_THE_OTHER_PARTY` خاماً على إنسانٍ سألَ «لماذا بقيَ
 * تقييمي؟» **لم تُجِبْه**، بل زادَته ريبةً في اللحظةِ التي كانَ يُطمأَنُ فيها.
 *
 * ## ولماذا المجالاتُ **تُستورَدُ من `packages/domain/privacy`** ولا تُنسَخُ
 *
 * **لأنَّ النسخَ أخفقَ فعلاً لا فرضاً**: النسخةُ التي كانت في
 * `rider/account/account-view.ts` أعلنَت خمسةَ أسسِ إبقاءٍ والنطاقُ يُعلِنُ
 * تسعةً، وقاعدةُ البياناتِ تُرسِلُ في إيصالِ **كلِّ** حذفٍ سطرَ `identityBar`
 * بأساسِ `BLOCK_AND_STANDING_SURVIVE_ERASURE` — ونصُّه **مكتوبٌ في القواميسِ
 * الثلاثةِ منذُ `ADR 0113`** ومع ذلكَ لم يُعرَضْ قطُّ، بل عُرِضَ محلَّه «سببُ
 * إبقاءٍ لا نعرفُ نصَّه بعدُ» على إنسانٍ نُصَّ له الجوابُ. وذاكَ عطبٌ صامتٌ في
 * **أخطرِ موضعٍ**: إفصاحُ ما يبقى بعدَ حذفٍ لا يُنقَضُ. فالمجالُ مصدرُ حقيقتِه
 * النطاقُ (القاعدة 0.6)، والاستيرادُ يجعلُ الافتراقَ مستحيلاً لا مُستبعَداً —
 * وسابقتُه `driver/support/support-view.ts` القائمةُ.
 *
 * ## وما لا يفعلُه هذا المِلفُّ عن قصدٍ (`ح-5`)
 *
 *   ــ **لا يُنسِّقُ تاريخاً ولا رقماً بلغةٍ**: التنسيقُ في الشاشةِ.
 *   ــ **لا يُلحِقُ عملةً برصيدٍ**: اسمُ العملةِ نصٌّ من القاموسِ، والبوّابةُ لا
 *      تنشرُ رمزَها اليومَ (تنشرُه القاعدةُ ولا يُمرِّرُه المنفذُ) — **ودَينُه
 *      مكتوبٌ** لا مُخترَعٌ في شاشةٍ.
 *   ــ **لا يبني صنفَ نمطٍ**: الأصنافُ حرفيّةٌ في الشاشةِ كي يقرأَها حاجزُ
 *      تغطيةِ الأنماطِ ساكناً (`ADR 0105`).
 *   ــ **لا يقيسُ تطابقَ نصِّ الراكبِ ونصِّ السائقِ**: البِنيةُ مِرآةٌ والمعنى
 *      ليسَ كذلكَ — «رحلتُك الجاريةُ» للراكبِ و«مَهمّتُك المُسنَدةُ» للسائقِ.
 */

// `D-33` · `ADR 0188`: نصوصُ جزءِ `account` تُسجَّلُ معَ حزمتِه لا في `shell`.
import "../../../../../packages/shared/i18n/miniapp/ar-parts/account.ts";
import { minorUnitsToMajorText } from "../../../../../packages/domain/financial/minor-units.ts";
import {
  ERASURE_REFUSALS,
  EXPORT_REFUSALS,
  RETENTION_BASES,
} from "../../../../../packages/domain/privacy/data-rights.ts";
import type { ApiErasureReceipt, ApiRetainedSection } from "./account-contract.ts";

/**
 * أسبابُ الإبقاءِ التي تعرفُ الواجهةُ نصَّها — **مجالُ النطاقِ نفسُه**، فلا
 * أساسٌ يُزادُ هناكَ ويبقى بلا نصٍّ ههنا بلا أن يسقطَ الحاجزُ.
 */
export const ACCOUNT_RETENTION_BASES: readonly string[] = Object.values(RETENTION_BASES);

/**
 * رفوضُ المحوِ. **`NOT_A_RIDER` باقٍ فيها** (`ح-8`): القاعدةُ لم تعُدْ تردُّه بعدَ
 * `SD-12` ونصُّه مكتوبٌ ودليلُه قائمٌ، ورمزٌ يُسقَطُ من المجالِ يجعلُ نصّاً
 * مكتوباً غيرَ مقروءٍ ومسارَ الدعمِ الذي يقولُه بلا مُقابِلٍ.
 */
export const ACCOUNT_ERASURE_REFUSALS: readonly string[] = Object.values(ERASURE_REFUSALS);

export const ACCOUNT_EXPORT_REFUSALS: readonly string[] = Object.values(EXPORT_REFUSALS);

/**
 * أخطاءُ الحدِّ التي لها نصٌّ — **مُقابِلةٌ لاتّحادِ `DataRightsPublicErrorCode`
 * في طبقةِ التطبيقِ حرفاً** ومحروسةٌ بالحاجزِ. و`CONFIRMATION_REQUIRED` منها:
 * شرطٌ لا عطلٌ.
 */
export const ACCOUNT_ERROR_CODES: readonly string[] = [
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "PRIVACY_STORE_NOT_AVAILABLE",
  "CONFIRMATION_REQUIRED",
];

const KNOWN_BASES: ReadonlySet<string> = new Set(ACCOUNT_RETENTION_BASES);
const KNOWN_ERASURE_REFUSALS: ReadonlySet<string> = new Set(ACCOUNT_ERASURE_REFUSALS);
const KNOWN_EXPORT_REFUSALS: ReadonlySet<string> = new Set(ACCOUNT_EXPORT_REFUSALS);
const KNOWN_ERRORS: ReadonlySet<string> = new Set(ACCOUNT_ERROR_CODES);

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

/**
 * ترتيبُ الإيصالِ «مُحيَ ← جُهِّلَ ← بقيَ» لأنَّ الإنسانَ سألَ الحذفَ، فأوّلُ ما
 * يستحقُّ أن يراه هوَ ما مُحيَ فعلاً. وعرضُ «ما بقيَ» أوّلاً يقرؤه نقضاً
 * لطلبِه. والترتيبُ ههنا في دالّةٍ نقيّةٍ **لا في ترتيبِ مفاتيحِ الردِّ**:
 * ترتيبُ `jsonb` غيرُ مضمونٍ.
 */
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

/**
 * وصفُ سطحِ دورٍ. **بادئةٌ ودَينٌ مُعلَنٌ**، ولا شيءَ غيرُهما: كلُّ ما سوى
 * ذلكَ في هذا السطحِ حكمُ خادمٍ لا اختلافُ دورٍ.
 */
export interface AccountSurfaceSpec {
  /** مثالُها `driver.account.` — **بنقطةٍ في آخرِها** فلا يُلصَقُ مفتاحٌ بمفتاحٍ. */
  readonly keyPrefix: string;
  /**
   * عناصرُ نصِّ البندِ التي **لا سندَ لها** في قاعدةٍ ولا حدَّ `API` — تُقالُ
   * ولا يُوضَعُ لها زرٌّ صوريٌّ (`ح-5`). مفاتيحُ لا نصوصٌ.
   */
  readonly declaredDebtKeys: readonly string[];
}

/** نموذجُ عرضٍ مربوطٌ بدورٍ — يُبنى مرّةً في سطحِ الدورِ. */
export interface AccountViewModel {
  readonly keyPrefix: string;
  readonly declaredDebtKeys: readonly string[];
  readonly retentionBasisKey: (basis: string) => string;
  readonly erasureRefusalKey: (refusal: string) => string;
  readonly exportRefusalKey: (refusal: string) => string;
  readonly accountErrorKey: (code: string) => string;
  readonly sectionKey: (section: string) => string;
  /**
   * نصُّ رصيدِ المحفظةِ المانعِ — **صفرٌ عندَ الغيابِ لا `NaN`**: خادمٌ أقدمُ
   * لا يُرسِلُ الحقلَ، وشاشةٌ تعرضُ `NaN` على إنسانٍ مُنِعَ تُضيفُ عطباً إلى منعٍ.
   */
  readonly walletBalanceText: (minor: number | undefined) => string;
}

export function accountViewModel(spec: AccountSurfaceSpec): AccountViewModel {
  const { keyPrefix } = spec;
  return {
    keyPrefix,
    declaredDebtKeys: spec.declaredDebtKeys,
    retentionBasisKey: (basis) =>
      KNOWN_BASES.has(basis) ? `${keyPrefix}basis.${basis}` : `${keyPrefix}basis.UNKNOWN`,
    erasureRefusalKey: (refusal) =>
      KNOWN_ERASURE_REFUSALS.has(refusal)
        ? `${keyPrefix}erasure.refusal.${refusal}`
        : `${keyPrefix}erasure.refusal.UNKNOWN`,
    exportRefusalKey: (refusal) =>
      KNOWN_EXPORT_REFUSALS.has(refusal)
        ? `${keyPrefix}export.refusal.${refusal}`
        : `${keyPrefix}export.refusal.UNKNOWN`,
    accountErrorKey: (code) =>
      KNOWN_ERRORS.has(code) ? `${keyPrefix}error.${code}` : `${keyPrefix}error.UNKNOWN`,
    /**
     * قسمُ الإيصالِ. **لا سقوطَ إلى `unknown` ههنا عن قصدٍ**: الأقسامُ مجالٌ
     * مغلقٌ يبنيه سجلُّ `erasure-policy.ts` والحاجزُ يُلزِمُ كلَّ قسمٍ فيه بنصٍّ
     * لكلِّ دورٍ يُنشَرُ إليه — فقسمٌ بلا نصٍّ **يُسقِطُ CI** ولا يُخبَّأُ خلفَ
     * جملةٍ عامّةٍ تجعلَ إيصالَ الحذفِ سطراً مُبهَماً.
     */
    sectionKey: (section) => `${keyPrefix}section.${section}`,
    walletBalanceText: (minor) => minorUnitsToMajorText(minor ?? 0),
  };
}
