/**
 * الغرض: مجالُ حقَّي البيانةِ — «نزِّلْ بياناتي» و«احذفْ حسابي» (`F2-11` ·
 *   `SR-12` · §9.12). **مجالاتٌ مغلقةٌ وأنواعٌ نقيّةٌ** بلا نصٍّ معروضٍ.
 * الحالة: منفَّذٌ فعليّاً — البند `F2-11`.
 * ينتمي إلى: packages/domain/privacy
 * يُستخدم من: `application/privacy/*` · `infrastructure/privacy/*`
 * يُتوقع أن يستخدمه لاحقاً: حقُّ السائقِ في بياناتِه (`SD-12`) — الأصنافُ
 *   ههنا لا تعرفُ دوراً، فلا سطرَ يُزادُ فيها حينَ يُبنى.
 * الحاكم: docs/adr/0112-erasure-is-a-per-table-judgement-not-a-delete.md
 *
 * ## لماذا **إيصالٌ** لا رسالةُ «تمَّ الحذفُ»
 *
 * «حُذِفَ حسابُكَ» جملةٌ كاذبةٌ في كلِّ منصّةٍ تقولُها: موافقتُكَ باقيةٌ لأنَّها
 * إثباتُ امتثالٍ، وتقييمُكَ للسائقِ باقٍ لأنَّه شهادةٌ لغيرِكَ، وسجلُّ الحذفِ
 * نفسُه باقٍ لأنَّه الدليلُ على أنَّكَ طلبتَ. فالصادقُ أن يُقالَ للإنسانِ
 * **ما مُحيَ وما بقيَ ولِمَ بقيَ**، صفّاً صفّاً وسبباً سبباً. ولذلكَ الجوابُ
 * ههنا بنيةٌ لا جملةٌ، والأسبابُ **رموزٌ من مجالٍ مغلقٍ** تُترجَمُ في الواجهةِ
 * إلى ثلاثِ لغاتٍ — لا نصٌّ عربيٌّ من القاعدةِ يصلُ شاشةَ من لا يقرؤه.
 *
 * ## ولماذا الرفضُ رمزٌ كذلكَ
 *
 * «لا يمكنُ حذفُ حسابِكَ الآنَ» تدفعُ إلى إعادةِ المحاولةِ بلا أملٍ. و
 * `ACTIVE_ORDER` تقولُ للإنسانِ ما يفعلُه: أنهِ رحلتَكَ ثمَّ عُدْ. وهذا ليسَ
 * تلطيفاً بل **فرقٌ بينَ بابٍ مغلقٍ وبابٍ عليه لافتةٌ**.
 */

/** أسبابُ الإبقاءِ — كلُّ سببٍ **مُقابِلٌ لصنفِ استبقاءٍ مُعلَنٍ**، لا اعتذارٌ. */
export const RETENTION_BASES = {
  /** موافقةٌ تُثبِتُ امتثالاً؛ محوُها يمحو الدليلَ على أنَّنا استأذنّا. */
  consentIsComplianceEvidence: "CONSENT_IS_COMPLIANCE_EVIDENCE",
  /** تقييمُكَ شهادةٌ **لغيرِكَ**؛ محوُها يسلبُ سُمعةَ إنسانٍ آخرَ. */
  ratingIsTestimonyForTheOtherParty: "RATING_IS_TESTIMONY_FOR_THE_OTHER_PARTY",
  /** بلاغُ دعمٍ قد يُنازَعُ فيه بعدَ الحذفِ. */
  supportRecordMayBeDisputed: "SUPPORT_RECORD_MAY_BE_DISPUTED",
  /** بلاغُ سلامةٍ قد يُنازَعُ فيه، وقد يخصُّ سلامةَ غيرِكَ. */
  safetyReportMayBeDisputed: "SAFETY_REPORT_MAY_BE_DISPUTED",
  /** سجلُّ التدقيقِ **هوَ** إثباتُ أنَّ هذا الحذفَ وقعَ. */
  auditTrailProvesThisErasure: "AUDIT_TRAIL_PROVES_THIS_ERASURE",
} as const;

export type RetentionBasis = (typeof RETENTION_BASES)[keyof typeof RETENTION_BASES];

const RETENTION_BASIS_SET: ReadonlySet<string> = new Set(Object.values(RETENTION_BASES));

export function isRetentionBasis(value: unknown): value is RetentionBasis {
  return typeof value === "string" && RETENTION_BASIS_SET.has(value);
}

/**
 * أسبابُ رفضِ الحذفِ. **`ACTIVE_ORDER` ليسَ عطباً**: رحلةٌ جاريةٌ فيها سائقٌ
 * ينتظرُ ومالٌ لم يُحسَمْ، وحذفُ الراكبِ في أثنائِها يترُكُ سائقاً بلا مُقابِلٍ.
 */
export const ERASURE_REFUSALS = {
  activeOrder: "ACTIVE_ORDER",
  notARider: "NOT_A_RIDER",
  userNotFound: "USER_NOT_FOUND",
  invalidActor: "INVALID_ACTOR",
} as const;

export type ErasureRefusal = (typeof ERASURE_REFUSALS)[keyof typeof ERASURE_REFUSALS];

const ERASURE_REFUSAL_SET: ReadonlySet<string> = new Set(Object.values(ERASURE_REFUSALS));

export function isErasureRefusal(value: unknown): value is ErasureRefusal {
  return typeof value === "string" && ERASURE_REFUSAL_SET.has(value);
}

/** سطرٌ من الإيصالِ: قسمٌ، وكم صفّاً، وبأيِّ أساسٍ بقيَ. */
export interface RetainedSection {
  readonly section: string;
  readonly rows: number;
  readonly basis: RetentionBasis;
}

/**
 * إيصالُ الحذفِ. **الأعدادُ ههنا مقيسةٌ من القاعدةِ لا مُقدَّرةٌ**: كلُّ رقمٍ
 * ناتجُ `row_count` فعليٍّ في المعاملةِ نفسِها التي نفَّذَت المحوَ (`ح-5`).
 */
export interface ErasureReceipt {
  /** ما مُحيَ محواً تامّاً: القسمُ ← عددُ الصفوفِ. */
  readonly erased: Readonly<Record<string, number>>;
  /** ما بقيَ صفُّه وذهبَت هُويّتُه: القسمُ ← عددُ الصفوفِ. */
  readonly anonymized: Readonly<Record<string, number>>;
  /** ما بقيَ كما هوَ، **ومعَه سببُه**. */
  readonly retained: readonly RetainedSection[];
}

export type ErasureOutcome =
  | { readonly erased: true; readonly erasedAt: string; readonly receipt: ErasureReceipt }
  /** حُذِفَ من قبلُ — يُقرأُ نجاحاً لا عطباً: النتيجةُ المطلوبةُ قائمةٌ. */
  | { readonly erased: true; readonly erasedAt: string; readonly receipt: null }
  | { readonly erased: false; readonly refusal: ErasureRefusal; readonly activeOrders: number };

/**
 * حزمةُ التنزيلِ. **لا تُفسَّرُ أقسامُها في هذه الطبقةِ**: مصدرُ حقيقةِ
 * الأقسامِ سجلُّ `packages/shared/config/erasure-policy.ts` وحدَه، والحاجزُ
 * `scripts/check-erasure-policy.ts` يُقابِلُه بما تبنيه القاعدةُ فعلاً. ولو
 * نُسِخَت أسماءُ الأقسامِ ههنا لصارَت مصدرَ حقيقةٍ ثالثاً (القاعدة 0.6).
 */
export interface DataExportBundle {
  readonly exportedAt: string;
  readonly subject: string;
  readonly sections: Readonly<Record<string, unknown>>;
}

/** أسبابُ تعذُّرِ التنزيلِ — `ACCOUNT_ERASED` دفاعٌ، وشرحُه في المنفذِ. */
export const EXPORT_REFUSALS = {
  userNotFound: "USER_NOT_FOUND",
  accountErased: "ACCOUNT_ERASED",
  invalidActor: "INVALID_ACTOR",
} as const;

export type ExportRefusal = (typeof EXPORT_REFUSALS)[keyof typeof EXPORT_REFUSALS];

const EXPORT_REFUSAL_SET: ReadonlySet<string> = new Set(Object.values(EXPORT_REFUSALS));

export function isExportRefusal(value: unknown): value is ExportRefusal {
  return typeof value === "string" && EXPORT_REFUSAL_SET.has(value);
}

/**
 * اسمُ الملفِّ الذي يُنزَّلُ. **بلا اسمٍ ولا رقمِ هاتفٍ فيه**: اسمُ الملفِّ
 * يظهرُ في مجلَّدِ التنزيلاتِ وفي الإشعارِ وقد يُرى على شاشةٍ مُشارَكةٍ، ووضعُ
 * الهُويّةِ فيه تسريبٌ خارجَ الملفِّ المحميِّ نفسِه.
 */
export function dataExportFileName(exportedAt: string): string {
  const stamp = exportedAt.slice(0, 10).replaceAll("-", "");
  return `wasla-move-my-data-${stamp}.json`;
}
