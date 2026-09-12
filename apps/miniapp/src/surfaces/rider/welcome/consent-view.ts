/**
 * الغرض: نموذجُ عرضِ شاشةِ الترحيبِ — تحويلُ ردِّ `/v1/consents` وأخطائِه إلى
 *   صفوفٍ ومفاتيحِ نصٍّ، منطقاً خالصاً بلا DOM (البند `F2-01` · SR-01).
 * الحالة: منفّذ فعلياً — البند `F2-01`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/welcome
 * يُتوقع أن يستخدمه لاحقاً: `WelcomeScreen.tsx`، وأيُّ شاشةٍ في `F2-11` تعرضُ
 *   موافقاتٍ مسجَّلةً (تنزيلُ بياناتي).
 * ملاحظات مستقبلية: حينَ تُنشَرُ وثيقةٌ ثالثةٌ (شروطُ الكابتن مثلاً) لا يتغيّرُ
 *   شيءٌ ههنا: الصفوفُ تُبنى من ردِّ الخادمِ لا من قائمةٍ في العميلِ.
 *
 * ## ما لا يفعلُه هذا الملفُّ عن قصدٍ
 *
 *   ــ **لا يحملُ قائمةَ وثائقٍ**: العميلُ لا يعرفُ ما يُطلَبُ منه إلّا من الردِّ.
 *      ولو حملَها لصارَ إصدارٌ قديمٌ من الحزمةِ يعرضُ موافقةً على نصٍّ مُبدَّلٍ.
 *   ــ لا يقرّرُ «اكتملَت التهيئةُ»: `satisfied` من الخادمِ تُقرأُ ولا تُحسَبُ.
 *   ــ لا يُنشئُ ختماً زمنيّاً ولا يعرضُه: الختمُ في السجلِّ، وعرضُه بندُ `F2-11`.
 *   ــ لا يُترجِمُ: يُعيدُ مفاتيحَ (9.11)، والترجمةُ في `shared/i18n/miniapp`.
 */

export type ConsentRowState = "missing" | "satisfied" | "superseded";

export interface ConsentApiDocument {
  readonly kind: string;
  readonly version: string;
  readonly titleKey: string;
  readonly summaryKey: string;
  readonly requiredForOnboarding: boolean;
}

export interface ConsentApiDocumentState {
  readonly kind: string;
  readonly currentVersion: string;
  readonly state: ConsentRowState;
  readonly recordedVersion?: string;
}

export interface ConsentApiStatus {
  readonly ok: true;
  readonly documents: readonly ConsentApiDocument[];
  readonly onboarding: {
    readonly satisfied: boolean;
    readonly documents: readonly ConsentApiDocumentState[];
  };
}

export interface ConsentRow {
  readonly kind: string;
  readonly version: string;
  readonly titleKey: string;
  readonly summaryKey: string;
  readonly required: boolean;
  readonly state: ConsentRowState;
  /** مفتاحُ النصِّ الذي يُقالُ تحتَ الصفِّ — لا لونٌ وحدَه (UX-10). */
  readonly statusKey: string;
}

const STATUS_KEY_BY_STATE: Readonly<Record<ConsentRowState, string>> = {
  missing: "welcome.consent_pending",
  satisfied: "welcome.consent_recorded",
  superseded: "welcome.consent_superseded",
};

/**
 * دمجُ قائمةِ الوثائقِ بحالاتِها. وثيقةٌ بلا حالةٍ مقابلةٍ تُعَدُّ `missing`
 * **لا تُطرَحُ**: صفٌّ مطروحٌ يعني موافقةً لا تُطلَبُ من المستخدمِ أبداً، وذاكَ
 * تخطٍّ صامتٌ لإقرارٍ تنظيميٍّ (القسم 16). وحالةٌ بلا وثيقةٍ تُهمَلُ: الخادمُ
 * أعلنَ ما يُطلَبُ في `documents`، فالزائدُ ليسَ مطلوباً.
 */
export function consentRows(status: ConsentApiStatus): readonly ConsentRow[] {
  return status.documents.map((document) => {
    const matched = status.onboarding.documents.find((d) => d.kind === document.kind);
    const state: ConsentRowState = matched?.state ?? "missing";
    return {
      kind: document.kind,
      version: document.version,
      titleKey: document.titleKey,
      summaryKey: document.summaryKey,
      required: document.requiredForOnboarding,
      state,
      statusKey: STATUS_KEY_BY_STATE[state],
    };
  });
}

/** ما يبقى مطلوباً فعلاً: الواجبُ الذي ليسَ `satisfied` وحدَه. */
export function outstandingRows(rows: readonly ConsentRow[]): readonly ConsentRow[] {
  return rows.filter((row) => row.required && row.state !== "satisfied");
}

/**
 * ترجمةُ رمزِ الخطأِ إلى مفتاحِ نصٍّ. ورمزٌ مجهولٌ **لا يُخفى**: يرتدُّ إلى
 * `welcome.error.rejected` وهي رسالةٌ تقولُ «لم تُقبل» وتعرضُ فعلاً — لا شاشةَ
 * بيضاءَ ولا نصَّ خطأٍ خامٌّ من الخادمِ يُعرَضُ كما هو (9.7 · UX-5).
 */
export function consentErrorKey(code: string): string {
  switch (code) {
    case "SESSION_REQUIRED":
    case "SESSION_INVALID":
    case "SESSION_EXPIRED":
      return "welcome.error.session";
    case "SESSION_NOT_AVAILABLE":
    case "CONSENT_STORE_NOT_AVAILABLE":
      return "welcome.error.unavailable";
    case "VERSION_NOT_CURRENT":
    case "UNKNOWN_DOCUMENT":
      return "welcome.error.version_not_current";
    case "ACCOUNT_NOT_FOUND":
      return "welcome.error.account_not_found";
    default:
      return "welcome.error.rejected";
  }
}

/**
 * أخطاءٌ لا تُصلَحُ بإعادةِ المحاولةِ من هذه الشاشةِ: جلسةٌ ساقطةٌ وحسابٌ غيرُ
 * موجودٍ وإصدارٌ قديمٌ — كلُّها تحتاجُ إعادةَ فتحِ التطبيقِ أو `‏/start`. وعرضُ
 * «أعِد المحاولةَ» عليها يدعو المستخدمَ إلى فعلٍ نعلمُ أنّه لن ينفعَ.
 */
export function isRetryable(code: string): boolean {
  switch (code) {
    case "SESSION_REQUIRED":
    case "SESSION_INVALID":
    case "SESSION_EXPIRED":
    case "ACCOUNT_NOT_FOUND":
    case "VERSION_NOT_CURRENT":
    case "UNKNOWN_DOCUMENT":
      return false;
    default:
      return true;
  }
}
