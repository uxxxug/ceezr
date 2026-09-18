/**
 * الغرض: مجالُ إبلاغِ الاختراقِ — أنواعٌ نقيّةٌ لحوادثِ البياناتِ الشخصيّةِ
 *   ومواعيدِ الإبلاغِ وفقَ المادةِ ٢٤ من اللائحةِ التنفيذيّةِ لنظامِ حمايةِ
 *   البياناتِ الشخصيّةِ (PDPL).
 * الحالة: منفَّذٌ — البند `F12-08`.
 * ينتمي إلى: packages/domain/privacy
 * يُستخدم من: `application/privacy/*` · `infrastructure/privacy/*`
 * الحاكم: المادةُ ٢٤ من اللائحةِ التنفيذيّةِ لـPDPL
 *
 * ## لماذا الأنواعُ النقيّةُ لا واجهاتٌ
 *
 * حوادثُ الاختراقِ سجلٌّ لا كائنٌ حيٌّ: تُرصَدُ ثمَّ تُقيَّمُ ثمَّ تُبلَّغُ.
 * والأنواعُ ههنا أسماءُ للحالاتِ والشدائدِ لا سلوكٌ — فالسلوكُ في الدوالِّ
 * والهجرات. وهذا يُبقي المجالَ مفتوحاً لمن يقرؤُه لاحقاً بلا إعادةِ تعريفٍ.
 *
 * ## ولماذا `subjects_notification_required` حكمٌ يُحسَبُ لا رايةٌ
 *
 * لأنَّ موعدَ الإبلاغِ والتزامَه حُكمانِ يُحسَبانِ من وقتِ العلمِ والشدّةِ لا
 * يُخزَّنانِ. والقاعدةُ `0-6`: مصدرُ الحقيقةِ واحدٌ. والدالّةُ في الهجرةِ
 * هيَ المصدرُ، والأنواعُ ههنا أسماءٌ لها فقط.
 */

/** حالةُ حادثِ الاختراقِ — ستُّ مراحلَ متتابعةٌ لا أربعٌ. */
export type BreachIncidentStatus =
  /** رُصِدَ الحادثُ ولم يُقيَّمْ بعدُ. */
  | "detected"
  /** قُدِّرَ الخطرُ وصُنِّفَ. */
  | "assessed"
  /** بُلِّغَت الهيئةُ (SDAIA) خلالَ ٧٢ ساعةً. */
  | "authority_notified"
  /** بُلِّغَ أصحابُ البياناتِ بلا تأخيرٍ غيرِ مُبرَّرٍ. */
  | "subjects_notified"
  /** احتوِيَ الحادثُ. */
  | "contained"
  /** أُغلِقَ الحادثُ. */
  | "resolved";

/** شدّةُ الخطرِ — ثلاثٌ لا أربعٌ. */
export type BreachSeverity = "high_risk" | "medium_risk" | "low_risk";

/** مَن يُبلَّغُ — الهيئةُ أم أصحابُ البياناتِ. */
export type NotificationRecipient = "authority" | "data_subjects";

/** زوجٌ منشورٌ يُعرِفُ المواعيدَ النظاميّةَ. */
export const BREACH_NOTIFICATION_DEADLINES = {
  /** موعدُ إبلاغِ الهيئةِ: ٧٢ ساعةً من العلمِ (المادةُ ٢٤/١). */
  authorityHours: 72,
} as const;

/** ساعاتٌ بالأرقامِ — للحاجزِ والاختبارِ لا للإنتاجِ. */
export const AUTHORITY_NOTIFICATION_HOURS = BREACH_NOTIFICATION_DEADLINES.authorityHours;

/**
 * محتوى إبلاغِ الهيئةِ — المادةُ ٢٤/١ يُلزِمُ بخمسةِ عناصرَ.
 * هذا **هيكلُ البياناتِ** الذي يُولَّدُ من الحادثِ، لا الإرسالُ نفسُه.
 */
export interface AuthorityNotificationContent {
  /** أ) وصفُ الحادثِ: الوقتُ والتاريخُ والظروفُ ووقتُ العلمِ. */
  readonly incidentDescription: {
    readonly breachTime: string | null;
    readonly awarenessTime: string;
    readonly description: string;
  };
  /** ب) أصنافُ البياناتِ والأعدادُ وأنواعُ البياناتِ الشخصيّة. */
  readonly dataScope: {
    readonly dataCategories: readonly string[];
    readonly affectedCount: number | null;
    readonly personalDataTypes: readonly string[];
  };
  /** ج) تقييمُ الخطرِ: الأثرُ والإجراءاتُ والتدابيرُ المستقبليّة. */
  readonly riskAssessment: {
    readonly riskDescription: string | null;
    readonly correctiveMeasures: string | null;
    readonly preventionMeasures: string | null;
  };
  /** د) هل بُلِّغَ أصحابُ البياناتِ؟ */
  readonly subjectsNotified: boolean;
  /** ه) بياناتُ الاتّصالِ — تُملأُ من التهيئةِ. */
  readonly contact: {
    readonly controllerName: string;
    readonly dpoContact: string | null;
  };
}

/**
 * محتوى إبلاغِ صاحبِ البياناتِ — المادةُ ٢٤/٥ تُلزِمُ بأربعةِ عناصرَ.
 */
export interface SubjectNotificationContent {
  /** وصفُ الاختراقِ بلغةٍ بسيطةٍ وواضحةٍ. */
  readonly breachDescription: string;
  /** وصفُ المخاطرِ المحتملة. */
  readonly riskDescription: string | null;
  /** الإجراءاتُ المُتَّخَذةُ لمنعِ أو الحدِّ من المخاطر. */
  readonly correctiveMeasures: string | null;
  /** اسمُ المتحكِّمِ وبياناتُ الاتّصالِ. */
  readonly contact: {
    readonly controllerName: string;
    readonly dpoContact: string | null;
  };
}
