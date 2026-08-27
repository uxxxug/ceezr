/**
 * الغرض: بانيةُ `initData` **اصطناعيّة للاختبارِ وحدَه** — تُوقّع بالطريقةِ الرسمية
 *   نفسِها كي يُختبَر المتحقِّقُ بمدخلٍ صحيحٍ حقيقيِّ البنيةِ لا بمدخلٍ مُصادَقٍ عليه.
 * الحالة: مزدوجُ اختبار. لا يُستورد من `apps` ولا من `packages` إطلاقاً.
 * ينتمي إلى: tests/support
 * يُتوقع أن يستخدمه لاحقاً: tests/unit/telegram-init-data.test.ts
 *   وtests/unit/session-telegram-route.test.ts
 * ملاحظات مستقبلية: هذه البانيةُ **لا تُثبِت شيئاً عن تيليجرامَ الحقيقي**: هي تنفيذٌ
 *   ثانٍ للخوارزميةِ الموصوفةِ في التوثيقِ الرسمي، فلو كان فهمُنا للخوارزمية خاطئاً
 *   لاتّفق الخطأُ في الطرفين ونجحَ الاختبارُ باطلاً. ولذلك في الدليلِ حدٌّ معرفيٌّ
 *   صريح: القبولُ على جهازٍ حقيقيٍّ غيرُ مُتحقَّقٍ منه ههنا.
 *
 * والرموزُ في هذا الملفِّ **مختلَقةٌ للاختبار**، لا رمزَ بوتٍ حقيقياً ولا سرَّ إنتاج.
 */

import { createHmac } from "node:crypto";

/** رمزُ بوتٍ وهميٌّ للاختبار — لا يمتّ لبوتٍ حقيقيٍّ بصلة. */
export const FAKE_DRIVER_BOT_TOKEN = "111111:AA-fake-driver-token-for-tests-only";
export const FAKE_RIDER_BOT_TOKEN = "222222:BB-fake-rider-token-for-tests-only";

export interface FakeTelegramUser {
  readonly id: number;
  readonly first_name?: string;
  readonly last_name?: string;
  readonly username?: string;
  readonly language_code?: string;
  readonly is_premium?: boolean;
}

export interface BuildInitDataOptions {
  readonly botToken: string;
  readonly authDateSeconds: number;
  readonly user?: FakeTelegramUser | null;
  /** يُدرَج كما هو حين يُمرَّر — لاختبارِ بقاءِ `signature` داخلَ سلسلةِ الفحص. */
  readonly signature?: string;
  readonly queryId?: string;
  readonly startParam?: string;
  /** حقولٌ إضافيةٌ تُوقَّع أيضاً — لاختبارِ ترتيبِ الأبجديةِ وحقولٍ لا نعرفها. */
  readonly extra?: Readonly<Record<string, string>>;
  /** يستبدل `hash` بعد التوقيع — لاختبارِ توقيعٍ لا يطابق. */
  readonly overrideHash?: string;
  /** يحذف `hash` كلياً. */
  readonly omitHash?: boolean;
}

function secretKeyFor(botToken: string): Buffer {
  return createHmac("sha256", "WebAppData").update(botToken).digest();
}

/** يبني نصَّ `initData` موقَّعاً توقيعاً صحيحاً بالرمزِ المُعطى. */
export function buildInitData(options: BuildInitDataOptions): string {
  const fields: Record<string, string> = { ...(options.extra ?? {}) };
  fields.auth_date = String(options.authDateSeconds);
  if (options.user !== null && options.user !== undefined) {
    fields.user = JSON.stringify(options.user);
  }
  if (options.queryId !== undefined) fields.query_id = options.queryId;
  if (options.startParam !== undefined) fields.start_param = options.startParam;
  if (options.signature !== undefined) fields.signature = options.signature;

  const checkString = Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");
  const hash = createHmac("sha256", secretKeyFor(options.botToken))
    .update(checkString)
    .digest("hex");

  const params = new URLSearchParams(fields);
  if (options.omitHash !== true) {
    params.set("hash", options.overrideHash ?? hash);
  }
  return params.toString();
}

/**
 * يعبث بحقلٍ واحدٍ **بعدَ** التوقيع: القيمةُ تتغيّر و`hash` يبقى كما كان —
 * وهذا هو معنى «العبثُ بالبيانات» في شرطِ البند.
 */
export function tamperField(initData: string, field: string, newValue: string): string {
  const params = new URLSearchParams(initData);
  params.set(field, newValue);
  return params.toString();
}

/** يحذف حقلاً بعد التوقيع. */
export function dropField(initData: string, field: string): string {
  const params = new URLSearchParams(initData);
  params.delete(field);
  return params.toString();
}

export const SAMPLE_USER: FakeTelegramUser = {
  id: 8_100_200_300,
  first_name: "نورة",
  last_name: "الحربي",
  username: "noura_test",
  language_code: "ar",
};
