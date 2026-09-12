/**
 * الغرض: قرارُ الموافقةِ نقيّاً — (أ) هل هذا الإقرارُ الواردُ **مقبولٌ** أصلاً،
 *   و(ب) هل تكفي الموافقاتُ المسجَّلةُ لعدِّ التهيئةِ مكتملةً (البند `F2-01`).
 * الحالة: منفّذ فعلياً — البند `F2-01` (دالّاتٌ نقيّةٌ بلا وقتٍ ولا شبكةٍ ولا قاعدةٍ).
 * ينتمي إلى: packages/domain/consent
 * يُتوقع أن يستخدمه لاحقاً: `packages/application/consent/record-consent.ts`
 *   و`apps/gateway/src/routes/consents.ts`.
 * ملاحظات مستقبلية: لو صارَ لوثيقةٍ «موافقةٌ اختياريّةٌ قابلةٌ للسحبِ» (إشعاراتٌ
 *   تسويقيّةٌ مثلاً) فالسحبُ حالةٌ ثالثةٌ تُضافُ ههنا صريحةً، ولا يُمثَّلُ بحذفِ
 *   صفٍّ: حذفُ الصفِّ يمحو أنَّ الموافقةَ كانت.
 *
 * ## القواعدُ التي يُمثِّلُها هذا الملفُّ، وكلُّها قابلةٌ للاختبارِ سلباً
 *
 *   1. **الصمتُ ليس موافقةً**: `accepted` يجبُ أن يكونَ `true` صريحاً. غيابُه أو
 *      `false` رفضٌ لا يُسجَّلُ موافقةً «ناقصةً».
 *   2. **لا موافقةَ على وثيقةٍ مجهولةٍ**: صنفٌ غيرُ مُعلَنٍ في السجلِّ يُردُّ.
 *   3. **لا موافقةَ على إصدارٍ غيرِ الجاريِ**: الموافقةُ على إصدارٍ قديمٍ تُردُّ
 *      لا تُقبَلُ «تقريباً». وإرسالُ إصدارٍ من العميلِ مقصودٌ: إن أرسلَ إصداراً
 *      قديماً فنسخةُ تطبيقِه قديمةٌ، وقبولُه يعني تسجيلَ موافقةٍ على نصٍّ لم يُرَه.
 *   4. **الإصدارُ المنسوخُ يُبطِلُ موافقتَه**: صفٌّ مسجَّلٌ بإصدارٍ سابقٍ لا يُقرأُ
 *      كفايةً؛ حالتُه `superseded` ويُعادُ السؤالُ. ولا يُحذَفُ الصفُّ القديمُ.
 *   5. **الوقتُ يُمرَّرُ لا يُقرأُ**: لا `Date.now()` ههنا، فالاختبارُ حتميٌّ.
 */

import { err, ok, type Result } from "../../shared/result/index.ts";
import {
  type ConsentDocument,
  type ConsentDocumentKind,
  findDeclaredDocument,
  requiredDocuments,
} from "./consent-documents.ts";

/** إقرارٌ كما وصلَ من العميلِ — نصوصٌ غيرُ موثوقةٍ، ولذلك حقولُه `string`. */
export interface ConsentSubmission {
  readonly kind: string;
  readonly version: string;
  readonly accepted: unknown;
}

export type ConsentRejectionReason =
  /** صنفٌ ليس في السجلِّ المُعلَنِ. */
  | "UNKNOWN_DOCUMENT"
  /** الصنفُ مُعلَنٌ والإصدارُ ليس الجاريَ. */
  | "VERSION_NOT_CURRENT"
  /** لم يُقَلْ «نعم» صريحاً. */
  | "NOT_ACCEPTED"
  /** حقلٌ ناقصٌ أو ليس نصّاً. */
  | "MALFORMED";

export interface ConsentRejection {
  readonly code: "CONSENT_REJECTED";
  readonly reason: ConsentRejectionReason;
}

/** إقرارٌ قُبِلَ: صنفُه وإصدارُه صارا من النوعِ المُعلَنِ لا نصّاً حرّاً. */
export interface AdmittedConsent {
  readonly kind: ConsentDocumentKind;
  readonly version: string;
}

function rejected(reason: ConsentRejectionReason): Result<never, ConsentRejection> {
  return err({ code: "CONSENT_REJECTED", reason });
}

export function admitConsentSubmission(
  submission: ConsentSubmission,
): Result<AdmittedConsent, ConsentRejection> {
  if (typeof submission.kind !== "string" || submission.kind.length === 0) {
    return rejected("MALFORMED");
  }
  if (typeof submission.version !== "string" || submission.version.length === 0) {
    return rejected("MALFORMED");
  }
  // الترتيبُ مقصودٌ: «مجهولٌ» قبلَ «إصدارٌ قديمٌ» قبلَ «لم يُقبَل» — فالرسالةُ
  // تصفُ أوّلَ ما اختلَّ لا آخرَه، ولا تُخبِرُ عن إصدارِ وثيقةٍ لا وجودَ لها.
  const declared = findDeclaredDocument(submission.kind);
  if (declared === undefined) return rejected("UNKNOWN_DOCUMENT");
  if (declared.version !== submission.version) return rejected("VERSION_NOT_CURRENT");
  if (submission.accepted !== true) return rejected("NOT_ACCEPTED");
  return ok({ kind: declared.kind, version: declared.version });
}

/** موافقةٌ كما تُقرأُ من القاعدةِ. */
export interface RecordedConsent {
  readonly kind: string;
  readonly version: string;
  readonly acceptedAtMs: number;
}

export type DocumentConsentState = "satisfied" | "superseded" | "missing";

export interface DocumentOnboardingState {
  readonly kind: ConsentDocumentKind;
  readonly currentVersion: string;
  readonly state: DocumentConsentState;
  /** إصدارُ آخرِ موافقةٍ مسجَّلةٍ إن وُجِدَت — يُقالُ صريحاً حتّى يُقرأَ الفرقُ. */
  readonly recordedVersion?: string;
}

export interface OnboardingConsentState {
  /** `true` فقط إذا كانت كلُّ وثيقةٍ واجبةٍ `satisfied`. */
  readonly satisfied: boolean;
  readonly documents: readonly DocumentOnboardingState[];
}

function stateFor(
  document: ConsentDocument,
  recorded: readonly RecordedConsent[],
): DocumentOnboardingState {
  const forKind = recorded.filter((r) => r.kind === document.kind);
  if (forKind.length === 0) {
    return { kind: document.kind, currentVersion: document.version, state: "missing" };
  }
  if (forKind.some((r) => r.version === document.version)) {
    return {
      kind: document.kind,
      currentVersion: document.version,
      state: "satisfied",
      recordedVersion: document.version,
    };
  }
  // أحدثُ ما وُوفِقَ عليه زمناً — لا أكبرُ إصدارٍ نصّيّاً: الزمنُ هوَ ما جرى فعلاً.
  const latest = forKind.reduce((a, b) => (b.acceptedAtMs > a.acceptedAtMs ? b : a));
  return {
    kind: document.kind,
    currentVersion: document.version,
    state: "superseded",
    recordedVersion: latest.version,
  };
}

export function evaluateOnboardingConsent(
  recorded: readonly RecordedConsent[],
): OnboardingConsentState {
  const documents = requiredDocuments().map((d) => stateFor(d, recorded));
  return { satisfied: documents.every((d) => d.state === "satisfied"), documents };
}

/** الأصنافُ الواجبةُ التي لم تُستوفَ — ما تسألُ عنه الشاشةُ، بترتيبِ السجلِّ. */
export function outstandingConsentKinds(
  recorded: readonly RecordedConsent[],
): readonly ConsentDocumentKind[] {
  return evaluateOnboardingConsent(recorded)
    .documents.filter((d) => d.state !== "satisfied")
    .map((d) => d.kind);
}
