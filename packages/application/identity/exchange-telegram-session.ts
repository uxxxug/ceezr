/**
 * الغرض: حالةُ الاستخدامِ الوحيدةُ للبند `F1-03`: مبادلةُ `initData` الخامِ
 *   بجلسةٍ داخلية. ترتيبُها ملزَم: تحقّقٌ أوّلاً، فإصدارٌ بعدَه — ولا إصدارَ
 *   إطلاقاً قبلَ نجاحِ التحقّق.
 * الحالة: منفّذ فعلياً — البند `F1-03`.
 * ينتمي إلى: application/identity
 * يُتوقع أن يستخدمه لاحقاً: `apps/gateway/src/routes/session-telegram.ts`
 * ملاحظات مستقبلية: تحديدُ الدورِ (`F1-05`) وربطُ المستخدمِ في القاعدةِ ليسا ههنا:
 *   هذه الحالةُ لا تُنشِئ ولا تُعدِّل أيَّ كيانِ عمل (ADR 0035).
 *
 * ولا تشفيرَ في هذا الملفِّ ولا معرفةَ بصيغةِ `initData`: كلُّ ذلك خلفَ المنفذَين.
 */

import { err, ok, type Result } from "../../shared/result/index.ts";
import type {
  IssuedMiniAppRefresh,
  IssuedMiniAppSession,
  MiniAppRefreshTokenIssuer,
  MiniAppSessionGrantIssuer,
  MiniAppSessionIssuer,
  SessionIssueFailure,
  TelegramIdentityProof,
  TelegramIdentityVerifier,
  TelegramProofRejectionReason,
} from "./ports.ts";

/**
 * سلسلةُ التجديد (`F1-04`) — اختياريةٌ في العقدِ لا في الإنتاج: حين تُوصَل
 * يُصدَر مع رمزِ الوصولِ رمزُ تجديدٍ **بمعرّفِ الجلسةِ نفسِه**، وهو ما يجعل
 * الرمزَين وجهَي جلسةٍ واحدةٍ لا رمزَين متجاورَين. وحين لا تُوصَل يبقى سلوكُ
 * `F1-03` كما كان حرفياً: رمزُ وصولٍ وحدَه بلا تجديد.
 *
 * ولماذا يُصدَر التجديدُ أوّلاً ثمّ الوصول؟ لأنّ معرّفَ الجلسةِ يُولَد مرّةً
 * واحدةً في موضعٍ واحد، والوصولُ يُصدَر لذلك المعرّفِ بعينِه. والعكسُ كان
 * سيُلزِم `issue` بأن يُخرِج معرّفَه، وهو تغييرٌ في عقدِ `F1-03` بلا حاجة.
 */
export interface SessionRefreshChain {
  readonly refresh: MiniAppRefreshTokenIssuer;
  readonly grantIssuer: MiniAppSessionGrantIssuer;
}

export interface ExchangeTelegramSessionDeps {
  readonly verifier: TelegramIdentityVerifier;
  readonly issuer: MiniAppSessionIssuer;
  /** سلسلةُ التجديد (`F1-04`). غيابُها = جلسةٌ بلا تجديدٍ لا جلسةٌ بلا توقيع. */
  readonly refreshChain?: SessionRefreshChain;
  /** الساعةُ محقونةٌ لا مقروءةٌ من العالم: سياسةُ الصلاحيةِ تُختبَر حتمياً. */
  readonly now: () => Date;
  /**
   * مُسجِّلٌ اختياريٌّ للسببِ الداخليِّ المصنَّف. **لا يُمرَّر إليه `initData` ولا
   * جزءٌ منه ولا التوقيعُ ولا الرمزُ المُصدَر** — الأسماءُ المصنَّفةُ فقط.
   */
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

export interface ExchangeTelegramSessionInput {
  /** النصُّ الخامُ كما قرأه العميلُ من تيليجرام، بلا تفسيرٍ ولا تفكيك. */
  readonly initData: string;
}

export interface ExchangeTelegramSessionOutput {
  readonly session: IssuedMiniAppSession;
  /** الإثباتُ المتحقَّقُ منه — يُستهلَك في الطبقةِ الأعلى ولا يُخزَّن كيانَ عمل. */
  readonly proof: TelegramIdentityProof;
  /** رمزُ التجديد (`F1-04`) — يظهر إن وُصِلت سلسلةُ التجديدِ وحدَها. */
  readonly refresh?: IssuedMiniAppRefresh;
}

/**
 * خطأُ حالةِ الاستخدامِ: مصنَّفٌ وحتميٌّ، ولا يحمل قيمةً سرّيّةً إطلاقاً.
 * `publicCode` هو ما يجوز أن يراه العميل، و`reason` للسجلِّ الداخليِّ وحدَه.
 */
export type ExchangeTelegramSessionError =
  | {
      readonly code: "TELEGRAM_PROOF_REJECTED";
      readonly reason: TelegramProofRejectionReason;
      readonly publicCode: PublicRejectionCode;
    }
  | {
      readonly code: "SESSION_ISSUE_FAILED";
      readonly reason: "NOT_CONFIGURED" | "ISSUER_ERROR";
      readonly publicCode: "SESSION_NOT_AVAILABLE";
    };

/**
 * الرموزُ العامّةُ الأربعةُ — أخشنُ من الأسبابِ الداخليةِ عن قصد:
 * الفرقُ بين «توقيعٌ لا يطابق» و«حقلُ المستخدمِ ناقص» **يُفيد المهاجمَ** ولا
 * يُفيد العميلَ الشريف، فكلاهما `INIT_DATA_REJECTED`. أمّا انتهاءُ الصلاحيةِ
 * فيُفرَد لأنّ علاجَه عندَ العميلِ مختلفٌ: يُعيد القراءةَ من تيليجرامَ ويحاول.
 */
export type PublicRejectionCode =
  | "INIT_DATA_MISSING"
  | "INIT_DATA_MALFORMED"
  | "INIT_DATA_REJECTED"
  | "INIT_DATA_EXPIRED";

const PUBLIC_CODES: Readonly<Record<TelegramProofRejectionReason, PublicRejectionCode>> = {
  EMPTY: "INIT_DATA_MISSING",
  MALFORMED: "INIT_DATA_MALFORMED",
  HASH_MISSING: "INIT_DATA_MALFORMED",
  HASH_DUPLICATED: "INIT_DATA_MALFORMED",
  USER_MISSING: "INIT_DATA_REJECTED",
  USER_MALFORMED: "INIT_DATA_REJECTED",
  AUTH_DATE_MISSING: "INIT_DATA_MALFORMED",
  AUTH_DATE_MALFORMED: "INIT_DATA_MALFORMED",
  SIGNATURE_MISMATCH: "INIT_DATA_REJECTED",
  AUTH_DATE_STALE: "INIT_DATA_EXPIRED",
  AUTH_DATE_IN_FUTURE: "INIT_DATA_REJECTED",
  NO_SIGNING_BOT_CONFIGURED: "INIT_DATA_REJECTED",
};

export function publicCodeFor(reason: TelegramProofRejectionReason): PublicRejectionCode {
  return PUBLIC_CODES[reason];
}

export async function exchangeTelegramSession(
  input: ExchangeTelegramSessionInput,
  deps: ExchangeTelegramSessionDeps,
): Promise<Result<ExchangeTelegramSessionOutput, ExchangeTelegramSessionError>> {
  const now = deps.now();
  const nowMs = now.getTime();
  const nowSeconds = Math.floor(nowMs / 1000);

  const verified = deps.verifier.verify(input.initData, nowSeconds);
  if (!verified.ok) {
    const reason = verified.error.reason;
    deps.log?.("session.telegram_proof_rejected", { reason });
    return err({
      code: "TELEGRAM_PROOF_REJECTED",
      reason,
      publicCode: publicCodeFor(reason),
    });
  }

  // لا يصل الإصدارُ إلا من بعدِ هذا السطر: مسارٌ واحدٌ لا فرعَ له قبلَ التحقّق.
  const chain = deps.refreshChain;
  let refresh: IssuedMiniAppRefresh | undefined;
  let issued: Result<IssuedMiniAppSession, SessionIssueFailure>;

  if (chain === undefined) {
    issued = deps.issuer.issue(verified.value, nowMs);
  } else {
    const issuedRefresh = chain.refresh.issueForNewSession(verified.value, nowMs);
    if (!issuedRefresh.ok) {
      deps.log?.("session.refresh_token_issue_failed", { reason: issuedRefresh.error.reason });
      return err({
        code: "SESSION_ISSUE_FAILED",
        reason: issuedRefresh.error.reason,
        publicCode: "SESSION_NOT_AVAILABLE",
      });
    }
    refresh = issuedRefresh.value.refresh;
    issued = chain.grantIssuer.issueForGrant(issuedRefresh.value.grant, nowMs);
  }

  if (!issued.ok) {
    deps.log?.("session.issue_failed", { reason: issued.error.reason });
    return err({
      code: "SESSION_ISSUE_FAILED",
      reason: issued.error.reason,
      publicCode: "SESSION_NOT_AVAILABLE",
    });
  }

  deps.log?.("session.issued", {
    bot: verified.value.bot,
    expiresInSeconds: issued.value.expiresInSeconds,
    ...(refresh === undefined ? {} : { refreshExpiresInSeconds: refresh.refreshExpiresInSeconds }),
  });

  return ok({
    session: issued.value,
    proof: verified.value,
    ...(refresh === undefined ? {} : { refresh }),
  });
}
