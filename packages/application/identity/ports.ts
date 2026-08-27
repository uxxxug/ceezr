/**
 * الغرض: منافذ مسار الهوية في `F1-03` — إثباتُ هويةِ تيليجرام، وإصدارُ الجلسةِ
 *   الداخلية. عقودٌ فقط بلا تنفيذ: التحقّقُ التشفيريُّ وإصدارُ الرمزِ في
 *   `packages/infrastructure/identity`، والمزدوجاتُ في الاختبارات.
 * الحالة: منفّذ فعلياً — البند `F1-03`.
 * ينتمي إلى: application/identity
 * يُتوقع أن يستخدمه لاحقاً: `exchange-telegram-session.ts` ومحوّلات البنية التحتية
 *   ومسارُ البوابة `POST /v1/session/telegram`.
 * ملاحظات مستقبلية: `F1-04` (تجديدُ الجلسةِ وتخزينُها) يوسّع `MiniAppSessionIssuer`
 *   أو يستبدل محوّلَه؛ ولا يلمس هذه العقود إلا بتوسيعٍ صريح.
 *
 * لماذا هنا لا في الدومين؟ لأنّ إثباتَ هويةِ تيليجرام **ليس حالةَ عملٍ ولا مفهوماً
 * في المجال** (ADR 0035): هو إثباتٌ خارجيٌّ لحظيٌّ يُستهلَك مرّةً عند إنشاءِ
 * الجلسة، ولا يُخزَّن كياناً ولا يُشتقّ منه سلوكُ عمل. ولذلك لا يستورد
 * `packages/domain` شيئاً من هذا الملف، ولا يُذكَر فيه نوعٌ من أنواعِ تيليجرام.
 */

import type { Result } from "../../shared/result/index.ts";

/**
 * إثباتُ هويةٍ متحقَّقٌ منه على الخادم — **لا يُبنى إلا بعدَ نجاحِ التحقّق**.
 * وكلُّ حقلٍ فيه مصدرُه النصُّ الموقَّع، لا حقلٌ أرسله العميلُ على حِدة.
 */
export interface TelegramIdentityProof {
  /** معرّفُ مستخدمِ تيليجرام كنصٍّ — لا يُستعمَل مفتاحاً في المجال ههنا. */
  readonly telegramUserId: string;
  /** اسمُ البوتِ الذي وقّع البيانات (`driver` أو `rider`) — لا رمزَه. */
  readonly bot: string;
  /** لحظةُ إصدارِ تيليجرامَ للبيانات، بالثواني. */
  readonly authDateSeconds: number;
  readonly username?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly languageCode?: string;
  readonly isPremium?: boolean;
  /** `start_param` كما وقّعه تيليجرام — نصٌّ لا يُفسَّر ههنا. */
  readonly startParam?: string;
}

/**
 * سببُ رفضٍ **حتميٌّ ومصنَّف** — للسجلِّ والقرارِ الداخليّ.
 * ولا يُعاد إلى العميلِ كما هو: المسارُ يترجمه إلى رمزٍ عامٍّ أخشنَ منه
 * كي لا يصير الردُّ عرّافاً (oracle) يدلُّ المهاجمَ على موضعِ خلله.
 */
export type TelegramProofRejectionReason =
  | "EMPTY"
  | "MALFORMED"
  | "HASH_MISSING"
  | "HASH_DUPLICATED"
  | "USER_MISSING"
  | "USER_MALFORMED"
  | "AUTH_DATE_MISSING"
  | "AUTH_DATE_MALFORMED"
  | "SIGNATURE_MISMATCH"
  | "AUTH_DATE_STALE"
  | "AUTH_DATE_IN_FUTURE"
  | "NO_SIGNING_BOT_CONFIGURED";

export interface TelegramProofRejection {
  readonly code: "TELEGRAM_PROOF_REJECTED";
  readonly reason: TelegramProofRejectionReason;
}

/**
 * التحقّقُ من `initData` الخام. **لا يقبل هذا المنفذُ أيَّ حقلِ هويةٍ منفصلٍ من
 * العميل**: مدخلُه النصُّ الموقَّعُ وحدَه، ومخرجُه إمّا إثباتٌ أو رفضٌ مصنَّف.
 */
export interface TelegramIdentityVerifier {
  verify(
    rawInitData: string,
    nowSeconds: number,
  ): Result<TelegramIdentityProof, TelegramProofRejection>;
}

/** جلسةُ وَصْلةِ الداخليةُ كما تُصدَر — قصيرةُ العمرِ وبانتهاءٍ صريح. */
export interface IssuedMiniAppSession {
  readonly accessToken: string;
  /** لحظةُ الانتهاءِ بالملّي ثانية — صريحةٌ لا مشتقّةٌ عند العميل. */
  readonly expiresAtMs: number;
  readonly expiresInSeconds: number;
  readonly tokenType: "Bearer";
}

export interface SessionIssueFailure {
  readonly code: "SESSION_ISSUE_FAILED";
  readonly reason: "NOT_CONFIGURED" | "ISSUER_ERROR";
}

/**
 * إصدارُ الجلسةِ الداخلية. **مفصولٌ عن التحقّقِ عمداً**: الأوّلُ إثباتُ هويةِ
 * طرفٍ خارجيّ، والثاني تفويضُ نظامِنا. ولذلك لا يقبل هذا المنفذُ نصَّ
 * `initData` ولا شيئاً منه، بل الإثباتَ المتحقَّقَ منه وحدَه — فيستحيل بنيوياً
 * أن تُصدَر جلسةٌ من بياناتٍ لم تمرَّ بالتحقّق.
 *
 * ونموذجُ الاستمرارِ والإبطالِ والتجديد **غيرُ محسومٍ ههنا وليس من نطاقِ
 * `F1-03`**: هو قرارُ `F1-04`. والمنفذُ يُبقيه مفتوحاً: محوّلٌ بلا حالةٍ اليومَ،
 * ومحوّلٌ مُستمِرٌّ غداً، بلا مساسٍ بالمسارِ ولا بحالةِ الاستخدام.
 */
export interface MiniAppSessionIssuer {
  issue(
    proof: TelegramIdentityProof,
    nowMs: number,
  ): Result<IssuedMiniAppSession, SessionIssueFailure>;
}
