/**
 * الغرض: توليدُ `initData` مُوقَّعٍ صالحٍ للقياسِ ببروتوكولِ تيليجرامَ الرسميِّ
 *   (HMAC-SHA256) باستعمالِ رمزِ بوتٍ اختباريٍّ — لا اتصالَ بتيليجرامَ.
 * الحالة: أداةُ قياسٍ لا منطقَ أعمالٍ — تُستعملُ من `scripts/measure-tti.ts`.
 * ينتمي إلى: scripts/lib
 * يُتوقع أن يستخدمه لاحقاً: scripts/measure-tti.ts
 *
 * **ولماذا ههنا لا في الاختباراتِ**: لأنَّ القياسَ في CI يحتاجُ `initData` حقيقيةً
 * التوقيعِ ليمرَّ التحقّقُ التشفيريُّ على البوّابةِ (`SEC-17` · `F1-03`)، ولا يجوزُ
 * أن يُستعملَ الحقلُ غيرُ المُوقَّعِ في قرارٍ (`ADR 0035`). والاختباراتُ الوحدويةُ تُولِّدُ
 * بياناتٍ مزوَّرةً بلا توقيعٍ، وهذا لا يكفي لقياسِ الصفِّ ٥ الذي يقطعُ مسارَ
 * الإقلاعِ كاملًا.
 *
 * المرجع: توثيقُ تيليجرامَ الرسميُّ «Validating data received via the Mini App»
 *   https://core.telegram.org/bots/webapps
 */

import { createHmac } from "node:crypto";

const SECRET_KEY_CONSTANT = "WebAppData";
const HASH_FIELD = "hash";

/** مستخدمُ تيليجرامَ الاختباريُّ — بلا بياناتٍ شخصيّةٍ حقيقيةٍ. */
export interface TestTelegramUser {
  readonly id: number;
  readonly first_name: string;
  readonly last_name?: string;
  readonly username?: string;
  readonly language_code?: string;
}

export interface SignedInitData {
  /** سلسلةُ `initData` الخامُ كما يصلُ البوّابةَ. */
  readonly raw: string;
  /** قيمةُ `hash` المنفصلةُ — للتحقّقِ في الاختبارات. */
  readonly hash: string;
}

/** المفتاحُ السرّيُّ الرسميُّ: HMAC-SHA256 لرمزِ البوت بمفتاحِ النصِّ الثابت. */
function secretKeyFor(botToken: string): Buffer {
  return createHmac("sha256", SECRET_KEY_CONSTANT).update(botToken).digest();
}

/**
 * يُولِّدُ `initData` مُوقَّعةً بصيغةِ `query-string` كما يُرسِلُها تيليجرامُ:
 * الحقولُ مفصولةٌ بـ`&`، و`hash` في آخرِها. و`auth_date` بالثواني (Unix epoch)
 * لضمانِ أنَّ كلَّ توليدٍ يُنتِجُ بصمةً مختلفةً (تفاديًا لحارسِ إعادةِ الاستعمالِ `SEC-17`).
 */
export function signInitData(
  botToken: string,
  user: TestTelegramUser,
  authDate: Date = new Date(),
): SignedInitData {
  const params = new URLSearchParams();
  params.set("query_id", `test-${Math.random().toString(36).slice(2, 10)}`);
  const userObj: Record<string, unknown> = { id: user.id, first_name: user.first_name };
  if (user.last_name !== undefined) userObj.last_name = user.last_name;
  if (user.username !== undefined) userObj.username = user.username;
  if (user.language_code !== undefined) userObj.language_code = user.language_code;
  params.set("user", JSON.stringify(userObj));
  params.set("auth_date", String(Math.floor(authDate.getTime() / 1000)));
  params.set("hash", "0".repeat(64)); // مؤقَّتٌ يُستبدلُ بعدَ الحساب.

  // سلسلةُ الفحص: كلُّ الحقولِ إلّا `hash`، مرتَّبةً أبجديًّا، `مفتاح=قيمة` بأسطرٍ جديدة.
  const pairs = [...params.entries()]
    .filter(([key]) => key !== HASH_FIELD)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`);
  const dataCheckString = pairs.join("\n");

  const secretKey = secretKeyFor(botToken);
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  // أعد بناء الـ query-string بـ `hash` الصحيح.
  params.set(HASH_FIELD, hash);
  return { raw: params.toString(), hash };
}

/**
 * يُولِّدُ `initData` متعددةً لاستعمالٍ في تشغيلاتٍ متتاليةٍ (تفاديًا لـ`SEC-17`).
 * كلُّ استدعاءٍ يُنتِجُ `query_id` و`auth_date` مختلفين.
 */
export function signFreshInitData(
  botToken: string,
  user: TestTelegramUser,
  count: number,
): readonly SignedInitData[] {
  const results: SignedInitData[] = [];
  for (let i = 0; i < count; i++) {
    // كلُّ ثانيةٍ `auth_date` مختلفٌ — بصمةٌ مختلفةٌ.
    const authDate = new Date(Date.now() + i * 1000);
    results.push(signInitData(botToken, user, authDate));
  }
  return results;
}
