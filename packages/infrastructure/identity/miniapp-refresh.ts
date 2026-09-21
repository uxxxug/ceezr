/**
 * الغرض: إصدارُ رمزِ تجديدِ جلسةِ التطبيقِ المصغَّرِ وقراءتُه — رمزٌ موقَّعٌ
 *   بـHMAC-SHA256 بمفتاحٍ **مشتقٍّ بفصلِ نطاقٍ** عن سرِّ رمزِ الوصول، عمرُه ساعةٌ،
 *   ويحمل سقفَ الجلسةِ المطلقَ (اثنتا عشرةَ ساعةً) الذي لا يمتدُّ بالتجديد.
 * الحالة: منفّذ فعلياً — البند `F1-04`.
 * ينتمي إلى: infrastructure/identity
 * يُتوقع أن يستخدمه لاحقاً: `apps/gateway/src/index.ts` ومسارُ
 *   `POST /v1/session/refresh` وحالةُ الاستخدامِ `renewMiniAppSession`.
 * ملاحظات مستقبلية: إن قُرِّر مخزنُ جلساتٍ على الخادمِ يوماً (قرارٌ مؤجَّلٌ لا
 *   ناقصٌ) فيُستبدَل هذا المحوّلُ خلفَ المنفذِ `MiniAppRefreshTokenIssuer` بلا
 *   مساسٍ بالمسارِ ولا بحالةِ الاستخدام — وعندَها فقط يصحُّ الكلامُ عن إبطال.
 *
 * الحدودُ المعلَنةُ لهذا التصميمِ بلا حالة — تُقال صريحةً لا تُترَك للقارئ:
 *   ــ **لا إبطالَ فوريًّا من الخادم**: لا قائمةَ منعٍ ولا مخزنَ جلسات.
 *   ــ إصدارُ رمزِ تجديدٍ جديدٍ **إصدارٌ لا إبطالٌ**: الرمزُ القديمُ يبقى صالحاً
 *      حتى `exp` الخاصِّ به أو حتى السقفِ المطلقِ، أيُّهما أقربُ. ولا يجوز في
 *      وصفِ هذا الملفِّ ولا في وثائقِه أن يُقال إنّ الجديدَ «يُبطِل» القديم.
 *   ــ **لا كشفَ لإعادةِ الاستخدام**: استعمالُ الرمزِ نفسِه مرّتين لا يُميَّز عن
 *      استعمالِه مرّةً؛ الكشفُ يحتاج حالةً على الخادم.
 *   ــ **لا إحصاءَ لعددِ الجلسات**: لا يُعرَف كم جلسةً فُتحت لمستخدم.
 *   ــ خروجُ المستخدمِ محليٌّ: يمسح ما على الجهاز، ولا يُبطِل رمزاً خرج منه.
 * والحدُّ الفعليُّ الذي يحمي: قِصَرُ العمرِ والسقفُ المطلق.
 *
 * قواعدُ صارمة: لا سطرَ تسجيلٍ في هذا الملف، ولا يُخرَج السرُّ ولا الرمزُ في
 * رسالةِ خطأٍ، والمقارنةُ بزمنٍ ثابت.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  IssuedMiniAppRefreshWithGrant,
  MiniAppRefreshTokenIssuer,
  MiniAppSessionRenewalGrant,
  RefreshTokenRejection,
  SessionIssueFailure,
  TelegramIdentityProof,
} from "../../application/identity/ports.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import { MINIAPP_SESSION_SECRET_MIN_LENGTH } from "./miniapp-session.ts";

/**
 * عمرُ رمزِ التجديد: ساعةٌ واحدة (قرارُ مالكِ المنتَجِ في `F1-04`). قيمةٌ أمنيةٌ
 * تقنيةٌ لا تجارية، فلا مكانَ لها في `platform_settings`.
 */
export const MINIAPP_REFRESH_TTL_SECONDS = 3600;

/**
 * سقفُ عمرِ الجلسةِ المطلق: اثنتا عشرةَ ساعة. **لا يمتدُّ بالتجديد إطلاقاً**:
 * يُحسَب مرّةً عندَ إنشاءِ الجلسةِ بعدَ تحقّقِ تيليجرام، ويُنقَل كما هو في كلِّ
 * رمزِ تجديدٍ تالٍ. وبعدَه لا تجديدَ: جلسةٌ جديدةٌ بتحقّقٍ جديدٍ من تيليجرام.
 */
export const MINIAPP_SESSION_ABSOLUTE_TTL_SECONDS = 43200;

const REFRESH_TOKEN_PREFIX = "wslr1";
const SESSION_ID_BYTES = 16;

/**
 * سياقُ اشتقاقِ مفتاحِ التجديد. المفتاحُ **ليس** سرَّ رمزِ الوصولِ نفسَه: هو
 * `HMAC(secret, context)`، فتوقيعُ رمزِ وصولٍ لا يصلح توقيعَ تجديدٍ ولا العكس،
 * ولا يُخلَط النطاقان. ولم يُضَف متغيّرُ بيئةٍ ثانٍ عن قصدٍ: سرٌّ ثانٍ يُنشَر
 * ويُدوَّر ويُنسى، والاشتقاقُ يمنع خلطَ النطاقين بلا عبءِ تشغيلٍ جديد.
 *
 * والحدُّ المعلَن: الاشتقاقُ **فصلُ نطاقٍ لا استقلالُ سرّ** — من كشف السرَّ
 * الأساسيَّ كشف المفتاحين. الاستقلالُ التامُّ يحتاج سرّاً ثانياً في البيئة، وهو
 * قرارُ تشغيلٍ لا يُتّخذ ههنا.
 */
const REFRESH_KEY_CONTEXT = "waslah/miniapp/refresh/v1";

/** حِمْلُ رمزِ التجديد: أصغرُ ما يكفي لإصدارِ رمزِ وصولٍ بلا حالةٍ على الخادم. */
interface RefreshPayload {
  readonly v: 1;
  /** معرّفُ الجلسة — نفسُه في كلِّ تجديد. */
  readonly sid: string;
  /**
   * موضوعُ الجلسة: معرّفُ مستخدمِ تيليجرامَ المتحقَّقُ منه.
   * ضرورةٌ بنيويةٌ لا زيادة: بلا حالةٍ على الخادم، لا يمكن إصدارُ رمزِ وصولٍ
   * لمن لا يُعرَف موضوعُه. وهو موجودٌ أصلاً في رمزِ الوصولِ نفسِه، فليس كشفاً
   * جديداً. ولا اسمَ ولا لغةَ ولا دورَ ولا بيانَ رحلةٍ ههنا.
   */
  readonly sub: string;
  readonly bot: string;
  /** عدّادُ التجديد — للسجلِّ المصنَّف. */
  readonly gen: number;
  /** ثوانٍ. */
  readonly iat: number;
  readonly exp: number;
  /** السقفُ المطلق، ثوانٍ. */
  readonly abs: number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function deriveRefreshKey(secret: string): string {
  return createHmac("sha256", secret).update(REFRESH_KEY_CONTEXT).digest("hex");
}

function sign(payloadPart: string, key: string): string {
  return createHmac("sha256", key)
    .update(`${REFRESH_TOKEN_PREFIX}.${payloadPart}`)
    .digest("base64url");
}

function signaturesMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface MiniAppRefreshIssuerOptions {
  /** سرُّ الخادمِ نفسُه؛ المفتاحُ يُشتقُّ منه ولا يُستعمَل هو خاماً ههنا. */
  readonly secret: string;
  readonly ttlSeconds?: number;
  readonly absoluteTtlSeconds?: number;
  /** مُولِّدُ معرّفِ الجلسة — يُحقَن في الاختبارِ ليكون الناتجُ حتمياً. */
  readonly newSessionId?: () => string;
}

export function createMiniAppRefreshTokens(
  options: MiniAppRefreshIssuerOptions,
): MiniAppRefreshTokenIssuer {
  const ttl = options.ttlSeconds ?? MINIAPP_REFRESH_TTL_SECONDS;
  const absoluteTtl = options.absoluteTtlSeconds ?? MINIAPP_SESSION_ABSOLUTE_TTL_SECONDS;
  const newId = options.newSessionId ?? (() => randomBytes(SESSION_ID_BYTES).toString("hex"));
  const configured =
    typeof options.secret === "string" &&
    options.secret.length >= MINIAPP_SESSION_SECRET_MIN_LENGTH;
  const key = configured ? deriveRefreshKey(options.secret) : "";

  function mint(
    payload: RefreshPayload,
  ): Result<IssuedMiniAppRefreshWithGrant, SessionIssueFailure> {
    const payloadPart = base64url(JSON.stringify(payload));
    const token = `${REFRESH_TOKEN_PREFIX}.${payloadPart}.${sign(payloadPart, key)}`;
    return ok({
      refresh: {
        refreshToken: token,
        refreshExpiresAtMs: payload.exp * 1000,
        refreshExpiresInSeconds: payload.exp - payload.iat,
        absoluteExpiresAtMs: payload.abs * 1000,
      },
      grant: {
        telegramUserId: payload.sub,
        bot: payload.bot,
        sessionId: payload.sid,
        absoluteExpiresAtSeconds: payload.abs,
        startedAtSeconds: payload.abs - absoluteTtl,
        generation: payload.gen,
      },
    });
  }

  return {
    issueForNewSession(
      proof: TelegramIdentityProof,
      nowMs: number,
    ): Result<IssuedMiniAppRefreshWithGrant, SessionIssueFailure> {
      if (!configured) return err({ code: "SESSION_ISSUE_FAILED", reason: "NOT_CONFIGURED" });
      const iat = Math.floor(nowMs / 1000);
      const abs = iat + absoluteTtl;
      return mint({
        v: 1,
        sid: newId(),
        sub: proof.telegramUserId,
        bot: proof.bot,
        gen: 0,
        iat,
        // القصُّ عندَ السقفِ ليس حالةً نظريّةً وحدَها: هو ما يجعل السقفَ سقفاً.
        exp: Math.min(iat + ttl, abs),
        abs,
      });
    },

    issueForRenewal(
      grant: MiniAppSessionRenewalGrant,
      nowMs: number,
    ): Result<IssuedMiniAppRefreshWithGrant, SessionIssueFailure> {
      if (!configured) return err({ code: "SESSION_ISSUE_FAILED", reason: "NOT_CONFIGURED" });
      const iat = Math.floor(nowMs / 1000);
      // حاجزٌ ثانٍ بعدَ القراءة: لا يُصدَر شيءٌ لجلسةٍ بلغت سقفَها المطلق.
      if (iat >= grant.absoluteExpiresAtSeconds) {
        return err({ code: "SESSION_ISSUE_FAILED", reason: "ISSUER_ERROR" });
      }
      return mint({
        v: 1,
        sid: grant.sessionId,
        sub: grant.telegramUserId,
        bot: grant.bot,
        gen: grant.generation + 1,
        iat,
        exp: Math.min(iat + ttl, grant.absoluteExpiresAtSeconds),
        // السقفُ يُنقَل كما هو: **لا يمتدُّ بالتجديد**.
        abs: grant.absoluteExpiresAtSeconds,
      });
    },

    read(token: string, nowMs: number): Result<MiniAppSessionRenewalGrant, RefreshTokenRejection> {
      if (!configured) {
        return err({ code: "REFRESH_TOKEN_REJECTED", reason: "NOT_CONFIGURED" });
      }
      const reject = (reason: RefreshTokenRejection["reason"]) =>
        err<RefreshTokenRejection>({ code: "REFRESH_TOKEN_REJECTED", reason });

      if (typeof token !== "string" || token.length === 0) return reject("MALFORMED");
      const parts = token.split(".");
      if (parts.length !== 3) return reject("MALFORMED");
      const [prefix, payloadPart, signature] = parts as [string, string, string];
      // بادئةُ رمزِ الوصولِ (`wsl1`) تسقط ههنا: رمزُ وصولٍ ليس رمزَ تجديد.
      if (prefix !== REFRESH_TOKEN_PREFIX) return reject("UNSUPPORTED_VERSION");
      if (payloadPart.length === 0 || signature.length === 0) return reject("MALFORMED");

      // التوقيعُ قبلَ قراءةِ الحِمل: لا يُفسَّر حِمْلٌ غيرُ موثوق.
      if (!signaturesMatch(sign(payloadPart, key), signature)) return reject("SIGNATURE_MISMATCH");

      let payload: unknown;
      try {
        payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
      } catch {
        return reject("MALFORMED");
      }
      if (payload === null || typeof payload !== "object") return reject("MALFORMED");
      const claims = payload as Record<string, unknown>;
      if (claims.v !== 1) return reject("UNSUPPORTED_VERSION");
      const sid = claims.sid;
      const sub = claims.sub;
      const bot = claims.bot;
      const gen = claims.gen;
      const iat = claims.iat;
      const exp = claims.exp;
      const abs = claims.abs;
      if (
        typeof sid !== "string" ||
        sid.length === 0 ||
        typeof sub !== "string" ||
        sub.length === 0 ||
        typeof bot !== "string" ||
        typeof gen !== "number" ||
        typeof iat !== "number" ||
        typeof exp !== "number" ||
        typeof abs !== "number" ||
        !Number.isSafeInteger(gen) ||
        !Number.isSafeInteger(iat) ||
        !Number.isSafeInteger(exp) ||
        !Number.isSafeInteger(abs) ||
        gen < 0 ||
        iat > exp ||
        // رمزٌ يزعم انتهاءً بعدَ سقفِه المطلقِ ليس رمزاً أصدرناه نحن.
        exp > abs
      ) {
        return reject("MALFORMED");
      }

      const nowSeconds = Math.floor(nowMs / 1000);
      // السقفُ المطلقُ أوّلاً: هو الأعلى، وعلاجُه أشدُّ من علاجِ انتهاءِ الرمز.
      if (nowSeconds >= abs) return reject("ABSOLUTE_EXPIRED");
      if (nowSeconds >= exp) return reject("EXPIRED");

      return ok({
        telegramUserId: sub,
        bot,
        sessionId: sid,
        absoluteExpiresAtSeconds: abs,
        startedAtSeconds: abs - absoluteTtl,
        generation: gen,
      });
    },
  };
}
