/**
 * الغرض: إصدارُ جلسةِ وَصْلةِ الداخليةِ وقراءتُها — رمزٌ موقَّعٌ بـHMAC-SHA256
 *   بسرٍّ خاصٍّ بالخادم، قصيرُ العمر، وبانتهاءٍ صريحٍ داخلَ الرمزِ وخارجَه.
 * الحالة: منفّذ فعلياً — البند `F1-03`.
 * ينتمي إلى: infrastructure/identity
 * يُتوقع أن يستخدمه لاحقاً: `apps/gateway/src/container.ts`، ثم بندُ `F1-04`.
 * ملاحظات مستقبلية: **الاستمرارُ والإبطالُ والتجديدُ ليست محسومةً ههنا**، وهي من
 *   نطاقِ `F1-04`. وهذا المحوّلُ بلا حالةٍ عن قصدٍ معلَنٍ لا عن غفلة: يُستبدَل
 *   بمحوّلٍ مُستمِرٍّ خلفَ نفسِ المنفذِ (`MiniAppSessionIssuer`) بلا مساسٍ بالمسارِ
 *   ولا بحالةِ الاستخدام. وحتى ذلك الحين: **لا مسارَ منتَجٍ واحدٍ يستهلك هذه
 *   الجلسة** — لا `GET /v1/me` ولا غيره — فسطحُ ما يمنحه الرمزُ اليومَ = صفر.
 *
 * قواعدُ صارمة: لا سطرَ تسجيلٍ في هذا الملف، ولا يُخرَج السرُّ ولا الرمزُ في
 * رسالةِ خطأٍ، والمقارنةُ بزمنٍ ثابت.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  IssuedMiniAppSession,
  MiniAppSessionIssuer,
  SessionIssueFailure,
  TelegramIdentityProof,
} from "../../application/identity/ports.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";

/**
 * عمرُ الجلسة: عشرُ دقائق. قيمةٌ أمنيةٌ تقنيةٌ لا تجارية (فلا مكانَ لها في
 * `platform_settings`). والقصرُ مقصودٌ: التجديدُ بندٌ لاحق (`F1-04`)، فحتى يوجدَ
 * التجديدُ تكون كلفةُ رمزٍ مسروقٍ محدودةً بعشرِ دقائق.
 */
export const MINIAPP_SESSION_TTL_SECONDS = 600;

/** الحدُّ الأدنى لطولِ سرِّ التوقيع — سرٌّ أقصرُ منه قابلٌ للتخمينِ بالقوّة. */
export const MINIAPP_SESSION_SECRET_MIN_LENGTH = 32;

const TOKEN_PREFIX = "wsl1";
const JTI_BYTES = 16;

/** حِمْلُ الرمز: أصغرُ ما يكفي. لا اسمَ ولا مُعرِّفَ محادثةٍ ولا لغةٍ فيه. */
interface SessionPayload {
  readonly v: 1;
  /** موضوعُ الجلسة: معرّفُ مستخدمِ تيليجرامَ المتحقَّقُ منه. */
  readonly sub: string;
  readonly bot: string;
  /** ثوانٍ. */
  readonly iat: number;
  readonly exp: number;
  /** معرّفٌ عشوائيٌّ للجلسة — يُتيح الإبطالَ عندَ بناءِ مخزنِه في `F1-04`. */
  readonly jti: string;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payloadPart: string, secret: string): string {
  return createHmac("sha256", secret).update(`${TOKEN_PREFIX}.${payloadPart}`).digest("base64url");
}

function signaturesMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface MiniAppSessionIssuerOptions {
  readonly secret: string;
  readonly ttlSeconds?: number;
  /** مُولِّدُ معرّفِ الجلسة — يُحقَن في الاختبارِ ليكون الناتجُ حتمياً. */
  readonly newSessionId?: () => string;
}

export function createMiniAppSessionIssuer(
  options: MiniAppSessionIssuerOptions,
): MiniAppSessionIssuer {
  const ttl = options.ttlSeconds ?? MINIAPP_SESSION_TTL_SECONDS;
  const newId = options.newSessionId ?? (() => randomBytes(JTI_BYTES).toString("hex"));
  const configured =
    typeof options.secret === "string" &&
    options.secret.length >= MINIAPP_SESSION_SECRET_MIN_LENGTH;

  return {
    issue(
      proof: TelegramIdentityProof,
      nowMs: number,
    ): Result<IssuedMiniAppSession, SessionIssueFailure> {
      // سرٌّ ناقصٌ يعني «لا جلسة»، لا جلسةً بتوقيعٍ ضعيف.
      if (!configured) {
        return err({ code: "SESSION_ISSUE_FAILED", reason: "NOT_CONFIGURED" });
      }
      const iat = Math.floor(nowMs / 1000);
      const payload: SessionPayload = {
        v: 1,
        sub: proof.telegramUserId,
        bot: proof.bot,
        iat,
        exp: iat + ttl,
        jti: newId(),
      };
      const payloadPart = base64url(JSON.stringify(payload));
      const token = `${TOKEN_PREFIX}.${payloadPart}.${sign(payloadPart, options.secret)}`;
      return ok({
        accessToken: token,
        expiresAtMs: payload.exp * 1000,
        expiresInSeconds: ttl,
        tokenType: "Bearer",
      });
    },
  };
}

export type SessionReadRejection =
  | "MALFORMED"
  | "SIGNATURE_MISMATCH"
  | "EXPIRED"
  | "UNSUPPORTED_VERSION"
  | "NOT_CONFIGURED";

export interface VerifiedMiniAppSession {
  readonly telegramUserId: string;
  readonly bot: string;
  readonly sessionId: string;
  readonly issuedAtSeconds: number;
  readonly expiresAtSeconds: number;
}

/**
 * قراءةُ رمزِ جلسةٍ والتحقّقُ منه. **ليست حدَّ API للمنتَج** (ذاك `F1-04`): هي
 * الوجهُ الثاني لعقدِ الإصدارِ، وبها تُختبَر سياسةُ الانتهاءِ اختباراً حقيقياً
 * لا بقراءةِ حقلٍ أعدناه بأنفسِنا.
 */
export function readMiniAppSession(
  token: string,
  secret: string,
  nowMs: number,
): Result<VerifiedMiniAppSession, SessionReadRejection> {
  if (typeof secret !== "string" || secret.length < MINIAPP_SESSION_SECRET_MIN_LENGTH) {
    return err("NOT_CONFIGURED");
  }
  if (typeof token !== "string" || token.length === 0) return err("MALFORMED");
  const parts = token.split(".");
  if (parts.length !== 3) return err("MALFORMED");
  const [prefix, payloadPart, signature] = parts as [string, string, string];
  if (prefix !== TOKEN_PREFIX) return err("UNSUPPORTED_VERSION");
  if (payloadPart.length === 0 || signature.length === 0) return err("MALFORMED");

  // التوقيعُ قبلَ قراءةِ الحِمل: لا يُفسَّر حِمْلٌ غيرُ موثوق.
  if (!signaturesMatch(sign(payloadPart, secret), signature)) return err("SIGNATURE_MISMATCH");

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    return err("MALFORMED");
  }
  if (payload === null || typeof payload !== "object") return err("MALFORMED");
  const claims = payload as Record<string, unknown>;
  if (claims.v !== 1) return err("UNSUPPORTED_VERSION");
  const sub = claims.sub;
  const bot = claims.bot;
  const iat = claims.iat;
  const exp = claims.exp;
  const jti = claims.jti;
  if (
    typeof sub !== "string" ||
    sub.length === 0 ||
    typeof bot !== "string" ||
    typeof jti !== "string" ||
    typeof iat !== "number" ||
    typeof exp !== "number" ||
    !Number.isSafeInteger(iat) ||
    !Number.isSafeInteger(exp)
  ) {
    return err("MALFORMED");
  }
  // الانتهاءُ يُقاس بالساعةِ المحقونةِ لا بساعةِ العميل.
  if (Math.floor(nowMs / 1000) >= exp) return err("EXPIRED");

  return ok({
    telegramUserId: sub,
    bot,
    sessionId: jti,
    issuedAtSeconds: iat,
    expiresAtSeconds: exp,
  });
}
