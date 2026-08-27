/**
 * الغرض: التحقّقُ التشفيريُّ من `initData` الخامِ لتطبيقِ تيليجرام المصغَّر وفقَ
 *   الطريقةِ الرسمية: مفتاحٌ سرّيٌّ = HMAC-SHA256(رمزُ البوت، "WebAppData")، ثم
 *   مقارنةُ `hash` بـHMAC-SHA256 لسلسلةِ الفحصِ بذلك المفتاح — مع فحصِ `auth_date`.
 * الحالة: منفّذ فعلياً — البند `F1-03`.
 * ينتمي إلى: infrastructure/identity
 * يُتوقع أن يستخدمه لاحقاً: `apps/gateway/src/container.ts` حقناً في مسارِ الجلسة.
 * ملاحظات مستقبلية: التحقّقُ بالتوقيعِ من غيرِ رمزِ البوت (Ed25519 · العميل 8.0+)
 *   طريقٌ ثانٍ ذكره القسم 9.8 تفضيلاً، **ولم يُنفَّذ ههنا**: يحتاج `bot_id` ومفتاحَ
 *   تيليجرامَ العامَّ مثبَّتاً، وهو بندٌ مستقلٌّ لا شرطاً في نصِّ `F1-03`.
 *
 * المرجع: توثيقُ تيليجرامَ الرسميُّ «Validating data received via the Mini App»
 *   https://core.telegram.org/bots/webapps
 *
 * قواعدُ صارمةٌ في هذا الملف:
 *   ١) لا يُسجَّل `initData` الخامُ ولا `hash` ولا رمزُ بوتٍ ولا أيُّ جزءٍ منها —
 *      ولا سطرَ تسجيلٍ واحدٍ في الملفِّ أصلاً.
 *   ٢) لا يُفسَّر حقلٌ واحدٌ من المحتوى قبلَ نجاحِ التحقّق: التوقيعُ أوّلاً.
 *   ٣) المقارنةُ بزمنٍ ثابت (`timingSafeEqual`) لا بـ`===`.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  TelegramIdentityProof,
  TelegramIdentityVerifier,
  TelegramProofRejection,
  TelegramProofRejectionReason,
} from "../../application/identity/ports.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";

/**
 * نافذةُ صلاحيةِ `initData`. قيمةٌ أمنيةٌ تقنيةٌ لا تجارية، فموضعُها الشيفرةُ لا
 * `platform_settings`: من عدّلها من لوحةٍ أطالَ عمرَ إثباتٍ مسروقٍ بلا مراجعة.
 * خمسُ دقائقَ تكفي لفتحِ التطبيقِ ومبادلةِ الإثباتِ على شبكةٍ بطيئة.
 */
export const TELEGRAM_INIT_DATA_MAX_AGE_SECONDS = 300;

/** تسامحٌ مع انحرافِ ساعةِ الجهازِ إلى الأمام؛ وما زاد عليه بياناتٌ لا تُقبَل. */
export const TELEGRAM_INIT_DATA_FUTURE_SKEW_SECONDS = 60;

const HASH_FIELD = "hash";
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const SECRET_KEY_CONSTANT = "WebAppData";

/** بوتٌ يجوز أن يكون موقِّعَ البيانات — الاسمُ للسجلّ، والرمزُ لا يُخرَج قطّ. */
export interface SigningBot {
  readonly name: string;
  readonly token: string;
}

export interface TelegramInitDataVerifierOptions {
  readonly bots: readonly SigningBot[];
  readonly maxAgeSeconds?: number;
  readonly futureSkewSeconds?: number;
}

function rejection(reason: TelegramProofRejectionReason): TelegramProofRejection {
  return { code: "TELEGRAM_PROOF_REJECTED", reason };
}

/** المفتاحُ السرّيُّ الرسميُّ: HMAC-SHA256 لرمزِ البوت بمفتاحِ النصِّ الثابت. */
function secretKeyFor(botToken: string): Buffer {
  return createHmac("sha256", SECRET_KEY_CONSTANT).update(botToken).digest();
}

/**
 * سلسلةُ الفحص: كلُّ الحقولِ المستقبَلةِ **إلا `hash`**، مرتَّبةً أبجدياً،
 * `مفتاح=قيمة` مفصولةً بسطرٍ جديد. و`signature` يبقى داخلَها لأنّه حقلٌ
 * مستقبَلٌ في طريقةِ رمزِ البوت، ولا يُستثنى إلا في طريقةِ Ed25519.
 */
export function dataCheckString(pairs: readonly (readonly [string, string])[]): string {
  return pairs
    .filter(([key]) => key !== HASH_FIELD)
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");
}

function hexEqual(left: string, right: string): boolean {
  if (!HASH_PATTERN.test(left) || !HASH_PATTERN.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function readUser(rawUser: string): TelegramIdentityProof | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawUser);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const user = parsed as Record<string, unknown>;
  const id = user.id;
  // معرّفُ تيليجرامَ عددٌ صحيحٌ موجَب؛ وما سواه ليس مستخدماً.
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return null;
  const text = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;
  const first = text(user.first_name);
  const last = text(user.last_name);
  const username = text(user.username);
  const language = text(user.language_code);
  return {
    telegramUserId: String(id),
    bot: "",
    authDateSeconds: 0,
    ...(username === undefined ? {} : { username }),
    ...(first === undefined ? {} : { firstName: first }),
    ...(last === undefined ? {} : { lastName: last }),
    ...(language === undefined ? {} : { languageCode: language }),
    ...(user.is_premium === true ? { isPremium: true } : {}),
  };
}

/**
 * محوّلُ التحقّق. لا يقبل أيَّ حقلِ هويةٍ خارجَ النصِّ الموقَّع، ولا يُخرِج
 * شيئاً من مدخلِه عند الرفض — سبباً مصنَّفاً وحدَه.
 */
export function createTelegramInitDataVerifier(
  options: TelegramInitDataVerifierOptions,
): TelegramIdentityVerifier {
  const maxAge = options.maxAgeSeconds ?? TELEGRAM_INIT_DATA_MAX_AGE_SECONDS;
  const skew = options.futureSkewSeconds ?? TELEGRAM_INIT_DATA_FUTURE_SKEW_SECONDS;
  const bots = options.bots.filter((bot) => bot.token.length > 0);

  return {
    verify(
      rawInitData: string,
      nowSeconds: number,
    ): Result<TelegramIdentityProof, TelegramProofRejection> {
      if (typeof rawInitData !== "string" || rawInitData.trim().length === 0) {
        return err(rejection("EMPTY"));
      }
      if (bots.length === 0) return err(rejection("NO_SIGNING_BOT_CONFIGURED"));

      // `URLSearchParams` لا يرمي استثناءً على مدخلٍ مشوَّه، فالتشويهُ يُكتشَف
      // بغيابِ الحقولِ الملزَمةِ لا بالاستثناء — وهذا مقصودٌ: لا throw في مسارٍ
      // يستقبل مدخلاً غيرَ موثوق.
      const params = new URLSearchParams(rawInitData);
      const pairs = [...params.entries()];
      if (pairs.length === 0) return err(rejection("MALFORMED"));

      const hashes = params.getAll(HASH_FIELD);
      if (hashes.length === 0) return err(rejection("HASH_MISSING"));
      if (hashes.length > 1) return err(rejection("HASH_DUPLICATED"));
      const receivedHash = hashes[0] ?? "";
      if (!HASH_PATTERN.test(receivedHash)) return err(rejection("MALFORMED"));

      const rawAuthDate = params.get("auth_date");
      if (rawAuthDate === null || rawAuthDate.length === 0) {
        return err(rejection("AUTH_DATE_MISSING"));
      }
      if (!/^\d{1,15}$/.test(rawAuthDate)) return err(rejection("AUTH_DATE_MALFORMED"));
      const authDateSeconds = Number(rawAuthDate);
      if (!Number.isSafeInteger(authDateSeconds) || authDateSeconds <= 0) {
        return err(rejection("AUTH_DATE_MALFORMED"));
      }

      // التوقيعُ قبلَ تفسيرِ أيِّ محتوى: بياناتٌ غيرُ موقَّعةٍ لا تُقرأ أصلاً.
      const checkString = dataCheckString(pairs);
      let signedBy: string | null = null;
      for (const bot of bots) {
        const expected = createHmac("sha256", secretKeyFor(bot.token))
          .update(checkString)
          .digest("hex");
        if (hexEqual(expected, receivedHash)) {
          signedBy = bot.name;
          break;
        }
      }
      if (signedBy === null) return err(rejection("SIGNATURE_MISMATCH"));

      if (authDateSeconds > nowSeconds + skew) return err(rejection("AUTH_DATE_IN_FUTURE"));
      if (nowSeconds - authDateSeconds > maxAge) return err(rejection("AUTH_DATE_STALE"));

      const rawUser = params.get("user");
      if (rawUser === null || rawUser.length === 0) return err(rejection("USER_MISSING"));
      const user = readUser(rawUser);
      if (user === null) return err(rejection("USER_MALFORMED"));

      const startParam = params.get("start_param");
      return ok({
        ...user,
        bot: signedBy,
        authDateSeconds,
        ...(startParam === null || startParam.length === 0 ? {} : { startParam }),
      });
    },
  };
}
