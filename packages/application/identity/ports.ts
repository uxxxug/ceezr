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

/* ───────────────────────────── تجديدُ الجلسة (`F1-04`) ───────────────────────────── */

/**
 * رمزُ التجديدِ كما يُصدَر — ومواعيدُه ثلاثةٌ صريحةٌ لا يشتقُّها العميل:
 * انتهاءُ رمزِ التجديدِ نفسِه، وسقفُ الجلسةِ المطلقُ الذي **لا يمتدُّ بالتجديد**.
 *
 * الحدُّ المعلَن: التصميمُ بلا حالةٍ على الخادمِ (لا مخزنَ جلساتٍ ولا Redis —
 * قرارُ المالكِ في `F1-04`). ولذلك: **لا إبطالَ فوريًّا من الخادم**، ولا كشفَ
 * لإعادةِ الاستخدام، ولا إحصاءَ جلساتٍ حقيقيًّا. وإصدارُ رمزِ تجديدٍ جديدٍ هو
 * **إصدارٌ** لا إبطالٌ للقديم: القديمُ يبقى صالحاً حتى `exp` أو حتى السقفِ
 * المطلق. وخروجُ المستخدمِ محليٌّ: يمسح ما على الجهازِ ولا يُبطِل رمزاً سُرِّب.
 */
export interface IssuedMiniAppRefresh {
  readonly refreshToken: string;
  readonly refreshExpiresAtMs: number;
  readonly refreshExpiresInSeconds: number;
  /** سقفُ عمرِ الجلسةِ المطلقُ بالملّي ثانية — ثابتٌ من لحظةِ إنشاءِ الجلسة. */
  readonly absoluteExpiresAtMs: number;
}

/**
 * ما يُقرأ من رمزِ تجديدٍ صحيح — **لا يُبنى إلا بعدَ نجاحِ التحقّقِ من التوقيع**،
 * كما أنّ `TelegramIdentityProof` لا يُبنى إلا بعدَ تحقّقِ تيليجرام. وبه وحدَه
 * يُصدَر رمزُ وصولٍ جديد: فيستحيل بنيوياً أن يُصدَر رمزٌ من نصٍّ لم يُتحقَّق منه.
 */
export interface MiniAppSessionRenewalGrant {
  readonly telegramUserId: string;
  readonly bot: string;
  /** معرّفُ الجلسةِ — يبقى نفسَه عبرَ كلِّ تجديد: التجديدُ لا يُنشئ جلسةً جديدة. */
  readonly sessionId: string;
  readonly absoluteExpiresAtSeconds: number;
  /** عدّادُ التجديد — للسجلِّ المصنَّفِ لا للإبطال (لا إبطالَ بلا حالةٍ على الخادم). */
  readonly generation: number;
}

export interface IssuedMiniAppRefreshWithGrant {
  readonly refresh: IssuedMiniAppRefresh;
  readonly grant: MiniAppSessionRenewalGrant;
}

/** سببُ رفضٍ داخليٌّ مصنَّف — يُخشَّن قبلَ أن يُعاد إلى العميل. */
export type RefreshTokenRejectionReason =
  | "MALFORMED"
  | "SIGNATURE_MISMATCH"
  | "UNSUPPORTED_VERSION"
  | "EXPIRED"
  | "ABSOLUTE_EXPIRED"
  | "NOT_CONFIGURED";

export interface RefreshTokenRejection {
  readonly code: "REFRESH_TOKEN_REJECTED";
  readonly reason: RefreshTokenRejectionReason;
}

/**
 * إصدارُ رموزِ التجديدِ وقراءتُها. مفصولٌ عن إصدارِ رمزِ الوصولِ لأنّ عمرَه
 * وسرَّه ووجهةَ استعمالِه مختلفة: رمزُ الوصولِ يُرسَل مع كلِّ طلبٍ، ورمزُ التجديدِ
 * لا يُرسَل إلا إلى مسارٍ واحد.
 */
export interface MiniAppRefreshTokenIssuer {
  issueForNewSession(
    proof: TelegramIdentityProof,
    nowMs: number,
  ): Result<IssuedMiniAppRefreshWithGrant, SessionIssueFailure>;
  issueForRenewal(
    grant: MiniAppSessionRenewalGrant,
    nowMs: number,
  ): Result<IssuedMiniAppRefreshWithGrant, SessionIssueFailure>;
  read(token: string, nowMs: number): Result<MiniAppSessionRenewalGrant, RefreshTokenRejection>;
}

/**
 * إصدارُ رمزِ وصولٍ من إذنِ تجديدٍ متحقَّقٍ منه — منفذٌ **منفصلٌ** عن
 * `MiniAppSessionIssuer` لا توسيعٌ له: التوسيعُ كان سيُلزِم كلَّ مزدوجِ اختبارٍ
 * قائمٍ في `F1-03` بتنفيذِ دالّةٍ لا يعنيه أمرُها.
 *
 * وانتهاءُ الرمزِ المُصدَرِ ههنا **مقصوصٌ عندَ السقفِ المطلق**: رمزُ وصولٍ يعيش
 * بعدَ السقفِ يمدُّ الجلسةَ فعلاً وإن لم يمدَّها اسماً.
 */
export interface MiniAppSessionGrantIssuer {
  issueForGrant(
    grant: MiniAppSessionRenewalGrant,
    nowMs: number,
  ): Result<IssuedMiniAppSession, SessionIssueFailure>;
}

/* ──────────────────── تحديدُ الدورِ والحالة (`F1-05`) ──────────────────── */

/**
 * الدورُ كما هو في القاعدةِ لا كما يظنُّه العميل: عمودُ `users.role` من نوعٍ
 * محصورٍ (`user_role`) بأربعِ قيمٍ. ونصُّ بندِ `F1-05` يسمّي ثلاثاً (راكب/سائق/
 * مشرف)، و`support` رابعٌ **قائمٌ في القاعدةِ فلا يُخفى ولا يُطوى إلى غيرِه**:
 * يُعاد كما هو، وسطحُه في التطبيقِ المصغَّرِ مؤجَّلٌ لا مُنكَر.
 *
 * ولا يُقبَل دورٌ من العميلِ إطلاقاً: هذا النوعُ **لا يُبنى إلا من صفٍّ في
 * القاعدة**. ورمزُ الجلسةِ (`F1-03`/`F1-04`) لا يحمل دوراً في حِمْلِه أصلاً، فلا
 * يستطيع حاملُ رمزٍ أن يرفع دورَه بتعديلِ ما يرسله.
 */
export type ViewerRole = "rider" | "driver" | "support" | "admin";

/** حالةُ الحسابِ كما تُقرأ — لا كما يقرّرها العميل. */
export type ViewerStatus = "active" | "unregistered";

/** صفُّ الحسابِ المقروءُ: الدورُ والحجبُ وحدَهما. لا اسمَ ولا هاتفَ ولا مدينة. */
export interface ViewerAccount {
  readonly role: ViewerRole;
  readonly isBlocked: boolean;
}

export type ViewerLookupFailureReason = "READER_ERROR" | "UNSUPPORTED_ROLE";

export interface ViewerLookupFailure {
  readonly code: "VIEWER_LOOKUP_FAILED";
  readonly reason: ViewerLookupFailureReason;
}

/**
 * قراءةُ حسابِ المستخدمِ بمعرّفِ تيليجرام — **قراءةٌ فقط**. لا `insert` ولا
 * `update` ولا `upsert`: قرارُ مالكِ المنتجِ في `F1-05` أنّ غيابَ الصفِّ حالةٌ
 * تُعاد لا حالةُ أعمالٍ تُنشأ (ADR 0035 §2)، ولذلك هذا المنفذُ بدالّةٍ واحدةٍ
 * لا تكتب. و`null` تعني «لا صفَّ» لا «خطأً».
 */
export interface ViewerAccountReader {
  findByTelegramUserId(
    telegramUserId: string,
  ): Promise<Result<ViewerAccount | null, ViewerLookupFailure>>;
}

/** ما يُقرأ من رمزِ وصولٍ صحيح — لا يُبنى إلا بعدَ نجاحِ التحقّقِ من التوقيع. */
export interface VerifiedViewerSession {
  readonly telegramUserId: string;
  readonly bot: string;
  readonly sessionId: string;
  readonly expiresAtSeconds: number;
}

/** سببُ رفضٍ داخليٌّ مصنَّف — يُخشَّن قبلَ أن يُعاد إلى العميل. */
export type ViewerSessionRejectionReason =
  | "MALFORMED"
  | "SIGNATURE_MISMATCH"
  | "UNSUPPORTED_VERSION"
  | "EXPIRED"
  | "NOT_CONFIGURED";

export interface ViewerSessionRejection {
  readonly code: "SESSION_REJECTED";
  readonly reason: ViewerSessionRejectionReason;
}

/**
 * قراءةُ رمزِ الوصولِ والتحقّقُ منه على الخادمِ — منفذٌ لأنّ التحقّقَ التشفيريَّ
 * بنيةٌ تحتيةٌ لا حالةُ استخدام. ومحوّلُه في `F1-05` **يغلّف `readMiniAppSession`
 * الموجودَ من `F1-03` ولا يعيد تنفيذَ تحقّقٍ**.
 *
 * وكلُّ انتهاءٍ يُقاس بالساعةِ المحقونةِ ههنا: لا يُقبَل انتهاءٌ يُرسِله العميل.
 */
export interface MiniAppSessionReader {
  read(accessToken: string, nowMs: number): Result<VerifiedViewerSession, ViewerSessionRejection>;
}
