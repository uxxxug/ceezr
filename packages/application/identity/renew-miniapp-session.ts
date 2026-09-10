/**
 * الغرض: حالةُ الاستخدامِ الوحيدةُ لتجديدِ جلسةِ التطبيقِ المصغَّرِ (`F1-04`):
 *   رمزُ تجديدٍ صحيحٌ ← رمزُ وصولٍ جديدٌ + رمزُ تجديدٍ جديد. وترتيبُها ملزَم:
 *   **قراءةٌ وتحقّقٌ من التوقيعِ أوّلاً، فإصدارٌ بعدَه** — ولا إصدارَ إطلاقاً قبلَه.
 * الحالة: منفّذ فعلياً — البند `F1-04`.
 * ينتمي إلى: application/identity
 * يُتوقع أن يستخدمه لاحقاً: `apps/gateway/src/routes/session-refresh.ts`
 * ملاحظات مستقبلية: تحديدُ الدورِ (`F1-05`) وربطُ المستخدمِ في القاعدةِ ليسا ههنا:
 *   هذه الحالةُ لا تُنشِئ ولا تُعدِّل أيَّ كيانِ عمل (ADR 0035)، ولا تلمس تيليجرامَ
 *   إطلاقاً: التحقّقُ من تيليجرامَ أُغلِق في `F1-03` ويقع عندَ إنشاءِ الجلسةِ وحدَه.
 *
 * وما لا تفعله عن قصدٍ معلَن — حدودُ التصميمِ بلا حالةٍ (قرارُ `F1-04`):
 *   ــ لا تُبطِل الرمزَ المستعمَل: الرمزُ الجديدُ **يُصدَر**، والقديمُ يبقى صالحاً
 *      حتى انتهائِه أو حتى السقفِ المطلق. ولا يجوز وصفُ ذلك بالإبطال.
 *   ــ لا تكشف إعادةَ الاستخدام، ولا تحصي جلساتٍ، ولا تعرف جهازاً من جهاز.
 *   ــ لا تمدُّ السقفَ المطلقَ: يُنقَل كما هو، وبعدَه لا تجديدَ بل تحقّقٌ جديد.
 */

import { err, ok, type Result } from "../../shared/result/index.ts";
import type {
  IssuedMiniAppRefresh,
  IssuedMiniAppSession,
  MiniAppRefreshTokenIssuer,
  MiniAppSessionGrantIssuer,
  RefreshTokenRejectionReason,
} from "./ports.ts";

export interface RenewMiniAppSessionDeps {
  readonly refresh: MiniAppRefreshTokenIssuer;
  readonly issuer: MiniAppSessionGrantIssuer;
  /** الساعةُ محقونةٌ لا مقروءةٌ من العالم: سياسةُ الانتهاءِ تُختبَر حتمياً. */
  readonly now: () => Date;
  /**
   * مُسجِّلٌ اختياريٌّ للسببِ الداخليِّ المصنَّف. **لا يُمرَّر إليه رمزُ تجديدٍ ولا
   * رمزُ وصولٍ ولا جزءٌ منهما ولا التوقيعُ** — الأسماءُ المصنَّفةُ فقط.
   */
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

export interface RenewMiniAppSessionInput {
  readonly refreshToken: string;
}

export interface RenewMiniAppSessionOutput {
  readonly session: IssuedMiniAppSession;
  readonly refresh: IssuedMiniAppRefresh;
  /** معرّفُ الجلسةِ — نفسُه قبلَ التجديدِ وبعدَه. للسجلِّ لا للعميل. */
  readonly sessionId: string;
}

/**
 * الرموزُ العامّةُ — أخشنُ من الأسبابِ الداخليةِ عن قصد: الفرقُ بين «توقيعٌ لا
 * يطابق» و«إصدارٌ لا نعرفه» يُفيد المهاجمَ ولا يُفيد العميلَ الشريف. أمّا
 * الانتهاءُ فيُفرَد لأنّ علاجَه عندَ العميلِ مختلفٌ تماماً: **جلسةٌ جديدةٌ بتحقّقٍ
 * جديدٍ من تيليجرام**، لا إعادةُ محاولةِ التجديد. وانتهاءُ رمزِ التجديدِ وبلوغُ
 * السقفِ المطلقِ يُجمَعان في رمزٍ واحدٍ لأنّ علاجَهما واحد.
 */
export type PublicRenewRejectionCode =
  | "REFRESH_TOKEN_MISSING"
  | "REFRESH_TOKEN_MALFORMED"
  | "REFRESH_TOKEN_REJECTED"
  | "SESSION_EXPIRED";

export type RenewMiniAppSessionError =
  | {
      readonly code: "REFRESH_TOKEN_REJECTED";
      readonly reason: RefreshTokenRejectionReason;
      readonly publicCode: PublicRenewRejectionCode;
    }
  | {
      readonly code: "SESSION_ISSUE_FAILED";
      readonly reason: "NOT_CONFIGURED" | "ISSUER_ERROR";
      readonly publicCode: "SESSION_NOT_AVAILABLE";
    };

const PUBLIC_CODES: Readonly<
  Record<Exclude<RefreshTokenRejectionReason, "NOT_CONFIGURED">, PublicRenewRejectionCode>
> = {
  MALFORMED: "REFRESH_TOKEN_MALFORMED",
  SIGNATURE_MISMATCH: "REFRESH_TOKEN_REJECTED",
  UNSUPPORTED_VERSION: "REFRESH_TOKEN_REJECTED",
  EXPIRED: "SESSION_EXPIRED",
  ABSOLUTE_EXPIRED: "SESSION_EXPIRED",
};

export function publicRenewCodeFor(
  reason: Exclude<RefreshTokenRejectionReason, "NOT_CONFIGURED">,
): PublicRenewRejectionCode {
  return PUBLIC_CODES[reason];
}

export async function renewMiniAppSession(
  input: RenewMiniAppSessionInput,
  deps: RenewMiniAppSessionDeps,
): Promise<Result<RenewMiniAppSessionOutput, RenewMiniAppSessionError>> {
  const nowMs = deps.now().getTime();

  if (typeof input.refreshToken !== "string" || input.refreshToken.length === 0) {
    deps.log?.("session.renew_missing_token", { reason: "MISSING" });
    return err({
      code: "REFRESH_TOKEN_REJECTED",
      reason: "MALFORMED",
      publicCode: "REFRESH_TOKEN_MISSING",
    });
  }

  const read = deps.refresh.read(input.refreshToken, nowMs);
  if (!read.ok) {
    const reason = read.error.reason;
    // سرٌّ ناقصٌ على الخادمِ ليس رفضاً للعميل: هو ضبطٌ ناقصٌ يُعلَن ٥٠٣ لا ٤٠١.
    if (reason === "NOT_CONFIGURED") {
      deps.log?.("session.renew_not_configured", { reason });
      return err({
        code: "SESSION_ISSUE_FAILED",
        reason: "NOT_CONFIGURED",
        publicCode: "SESSION_NOT_AVAILABLE",
      });
    }
    deps.log?.("session.refresh_token_rejected", { reason });
    return err({
      code: "REFRESH_TOKEN_REJECTED",
      reason,
      publicCode: publicRenewCodeFor(reason),
    });
  }

  // لا يصل الإصدارُ إلا من هذا السطر: مسارٌ واحدٌ لا فرعَ له.
  const nextRefresh = deps.refresh.issueForRenewal(read.value, nowMs);
  if (!nextRefresh.ok) {
    deps.log?.("session.renew_refresh_issue_failed", { reason: nextRefresh.error.reason });
    return err({
      code: "SESSION_ISSUE_FAILED",
      reason: nextRefresh.error.reason,
      publicCode: "SESSION_NOT_AVAILABLE",
    });
  }

  const issued = deps.issuer.issueForGrant(nextRefresh.value.grant, nowMs);
  if (!issued.ok) {
    deps.log?.("session.renew_access_issue_failed", { reason: issued.error.reason });
    return err({
      code: "SESSION_ISSUE_FAILED",
      reason: issued.error.reason,
      publicCode: "SESSION_NOT_AVAILABLE",
    });
  }

  deps.log?.("session.renewed", {
    bot: read.value.bot,
    generation: nextRefresh.value.grant.generation,
    expiresInSeconds: issued.value.expiresInSeconds,
    refreshExpiresInSeconds: nextRefresh.value.refresh.refreshExpiresInSeconds,
  });

  return ok({
    session: issued.value,
    refresh: nextRefresh.value.refresh,
    sessionId: nextRefresh.value.grant.sessionId,
  });
}
