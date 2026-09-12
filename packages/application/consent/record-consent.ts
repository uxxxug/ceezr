/**
 * الغرض: حالتا استخدامِ الموافقاتِ — «ماذا يُطلَبُ منّي؟» و«سجِّلْ موافقتي»، مع
 *   التحقّقِ من الجلسةِ على الخادمِ وحدَه (البند `F2-01` · القسمان 9.8 و9.12).
 * الحالة: منفّذ فعلياً — البند `F2-01`.
 * ينتمي إلى: packages/application/consent
 * يُتوقع أن يستخدمه لاحقاً: `apps/gateway/src/routes/consents.ts`.
 * ملاحظات مستقبلية: حينَ تُبنى `F2-02` سيحتاجُ ردُّ «حالةِ التهيئةِ» أن يقولَ
 *   الشاشةَ التاليةَ أيضاً؛ وموضعُ ذاكَ هذا الملفُّ لا الشاشةُ، فلا يقرّرُ العميلُ
 *   متى يتخطّى الموافقةَ.
 *
 * ## ما لا تفعلُه هذه الحالاتُ عن قصدٍ
 *
 *   ــ **لا تثقُ بهويّةٍ من الطلبِ**: المعرّفُ من رمزٍ موقَّعٍ منّا وحدَه.
 *   ــ لا تقبلُ ختماً زمنيّاً من العميلِ: «بختمٍ زمنيٍّ مسجَّلٍ» في `F2-01` تعني
 *      ختمَ الخادمِ. ختمُ جهازٍ قابلٌ للتقديمِ والتأخيرِ، وسجلٌّ قانونيٌّ بختمٍ
 *      يملكُه المُوافِقُ نفسُه لا قيمةَ له.
 *   ــ لا تُنشئُ صفَّ مستخدمٍ: غيابُه يُعادُ حالةً (ADR 0035).
 *   ــ لا تُسجِّلُ موافقةً على إصدارٍ غيرِ الجاريِ ولا على وثيقةٍ مجهولةٍ: القرارُ
 *      في `packages/domain/consent/consent-decision.ts` وههنا ترجمتُه.
 *   ــ لا تطلبُ إذنَ موقعٍ ولا تُسجِّلُه: القسم 9.12 يُوجِبُ طلبَ كلِّ إذنٍ في
 *      لحظةِ حاجتِه، والترحيبُ لا يحتاجُ موقعاً (ADR 0093).
 */

import {
  admitConsentSubmission,
  type ConsentRejection,
  type ConsentSubmission,
  evaluateOnboardingConsent,
  type OnboardingConsentState,
} from "../../domain/consent/consent-decision.ts";
import {
  type ConsentDocument,
  DECLARED_CONSENT_DOCUMENTS,
} from "../../domain/consent/consent-documents.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import type { ConsentRecordReader, ConsentRecordWriter, ConsentStoreFailure } from "./ports.ts";

export interface ConsentDeps {
  readonly sessions: MiniAppSessionReader;
  readonly reader: ConsentRecordReader;
  readonly writer: ConsentRecordWriter;
  readonly now: () => Date;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/**
 * رموزٌ ظاهرةٌ. `SESSION_*` مفصولةٌ كما في `resolve-viewer` كي يعرفَ العميلُ
 * «جدِّدْ» من «أعِدْ التحقّقَ»، و`CONSENT_*` تصفُ ما رُدَّ من الإقرارِ نفسِه.
 */
export type ConsentPublicErrorCode =
  | "SESSION_REQUIRED"
  | "SESSION_INVALID"
  | "SESSION_EXPIRED"
  | "SESSION_NOT_AVAILABLE"
  | "UNKNOWN_DOCUMENT"
  | "VERSION_NOT_CURRENT"
  | "NOT_ACCEPTED"
  | "MALFORMED"
  | "ACCOUNT_NOT_FOUND"
  | "CONSENT_STORE_NOT_AVAILABLE";

function sessionErrorFrom(reason: string): ConsentPublicErrorCode {
  if (reason === "EXPIRED") return "SESSION_EXPIRED";
  if (reason === "NOT_CONFIGURED") return "SESSION_NOT_AVAILABLE";
  return "SESSION_INVALID";
}

function storeErrorFrom(failure: ConsentStoreFailure): ConsentPublicErrorCode {
  if (failure.reason === "USER_NOT_FOUND") return "ACCOUNT_NOT_FOUND";
  return "CONSENT_STORE_NOT_AVAILABLE";
}

function rejectionErrorFrom(rejection: ConsentRejection): ConsentPublicErrorCode {
  return rejection.reason;
}

function authenticate(
  deps: ConsentDeps,
  accessToken: string | undefined,
): Result<string, ConsentPublicErrorCode> {
  if (accessToken === undefined || accessToken.length === 0) return err("SESSION_REQUIRED");
  const session = deps.sessions.read(accessToken, deps.now().getTime());
  if (!session.ok) return err(sessionErrorFrom(session.error.reason));
  return ok(session.value.telegramUserId);
}

/** الوثيقةُ كما تُعرَضُ للعميلِ: مفاتيحُ نصٍّ لا نصوصٌ (9.11). */
export interface PublishedConsentDocument {
  readonly kind: ConsentDocument["kind"];
  readonly version: string;
  readonly titleKey: string;
  readonly summaryKey: string;
  readonly requiredForOnboarding: boolean;
}

export interface ConsentStatusOutput {
  readonly documents: readonly PublishedConsentDocument[];
  readonly onboarding: OnboardingConsentState;
}

const PUBLISHED_DOCUMENTS: readonly PublishedConsentDocument[] = DECLARED_CONSENT_DOCUMENTS.map(
  (d) => ({
    kind: d.kind,
    version: d.version,
    titleKey: d.titleKey,
    summaryKey: d.summaryKey,
    requiredForOnboarding: d.requiredForOnboarding,
  }),
);

/**
 * حالةُ الموافقاتِ: **الوثائقُ الجاريةُ دائماً**، وحالةُ صاحبِ الجلسةِ منها. ولو
 * كانَ السجلُّ فارغاً فالردُّ يقولُ «ناقصٌ» صريحاً ولا يُعادُ جسمٌ فارغٌ يقرأُه
 * العميلُ «لا شيءَ مطلوبٌ» فيتخطّى الشاشةَ.
 */
export async function readConsentStatus(
  deps: ConsentDeps,
  input: { readonly accessToken: string | undefined },
): Promise<Result<ConsentStatusOutput, ConsentPublicErrorCode>> {
  const identified = authenticate(deps, input.accessToken);
  if (!identified.ok) return identified;

  const recorded = await deps.reader.listForTelegramUser(identified.value);
  if (!recorded.ok) return err(storeErrorFrom(recorded.error));

  return ok({
    documents: PUBLISHED_DOCUMENTS,
    onboarding: evaluateOnboardingConsent(recorded.value),
  });
}

export interface RecordConsentOutput {
  readonly status: "recorded" | "already_recorded";
  readonly acceptedAtMs: number;
  readonly onboarding: OnboardingConsentState;
}

/**
 * تسجيلُ موافقةٍ واحدةٍ. الترتيبُ: تحقّقُ الجلسةِ، ثمَّ قبولُ الإقرارِ في النطاقِ،
 * ثمَّ الكتابةُ الذرّيّةُ، ثمَّ **إعادةُ قراءةِ** السجلِّ لحسابِ حالةِ التهيئةِ من
 * القاعدةِ لا من الذاكرةِ — فلا يُقالُ «اكتملَت» بناءً على ما أرسلَه العميلُ.
 */
export async function recordConsent(
  deps: ConsentDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly submission: ConsentSubmission;
  },
): Promise<Result<RecordConsentOutput, ConsentPublicErrorCode>> {
  const identified = authenticate(deps, input.accessToken);
  if (!identified.ok) return identified;

  const admitted = admitConsentSubmission(input.submission);
  if (!admitted.ok) return err(rejectionErrorFrom(admitted.error));

  const written = await deps.writer.record({
    telegramUserId: identified.value,
    kind: admitted.value.kind,
    version: admitted.value.version,
    acceptedAtMs: deps.now().getTime(),
  });
  if (!written.ok) return err(storeErrorFrom(written.error));

  const recorded = await deps.reader.listForTelegramUser(identified.value);
  if (!recorded.ok) return err(storeErrorFrom(recorded.error));

  deps.log?.("consent.recorded", {
    kind: admitted.value.kind,
    version: admitted.value.version,
    status: written.value.status,
  });

  return ok({
    status: written.value.status,
    acceptedAtMs: written.value.acceptedAtMs,
    onboarding: evaluateOnboardingConsent(recorded.value),
  });
}

/** يُصدَّرُ للاختبارِ والشاشةِ: الوثائقُ المنشورةُ كما تُعادُ في الردِّ. */
export { PUBLISHED_DOCUMENTS };
