/**
 * الدوالُّ الصرفةُ لبذرةِ القياس — حتميّةٌ بلا قاعدةِ بيانات.
 *
 * وُضِعَت ههنا لتُختبَر وتُستوردَ بلا خرقِ منطقةِ التأجيل: البذرةُ في
 * `deferred/field-experiments/bench/seed.ts` تستوردُ هذه الدوالَ، واختباراتُ
 * الوحدةِ والحاجزُ الساكنُ يستوردانها من ههنا — فلا استيرادَ من `deferred/`
 * في الشجرةِ الحيّة.
 *
 * ## معنى «حتميّ» هنا
 *
 * البذرُ حتميٌّ إذا كان تشغيلُه مرّتين على قاعدةٍ نظيفةٍ يُنتج **الحالةَ المنطقيّة
 * نفسَها**: نفسَ الصفوف، بنفس المعرّفات، وبنفس القيم ذات المعنى التجاريّ. وهذا
 * يفرض شيئين:
 *
 * 1. **لا `gen_random_uuid()` ولا عشوائيّة**: كلُّ معرّفٍ مُشتقٌّ اشتقاقاً من اسمٍ
 *    ثابت (UUIDv5).
 * 2. **لا `now()` في أيّ قيمةٍ ذات معنى**: نهايةُ فترة التجربة وحدودُ الدورة
 *    تُشتقّ من `SEED_EPOCH` الثابت لا من ساعةِ التشغيل.
 */

import { createHash } from "node:crypto";

/** لحظةٌ ثابتة يُشتقّ منها كلُّ زمنٍ ذي معنىً في البذر. */
export const SEED_EPOCH = new Date("2026-01-01T00:00:00.000Z");

/** أنواعُ المركبات — منسوخةٌ عن عقد المنتج بترتيبها لأن البذر يوزّعها دوريّاً. */
export const VEHICLE_TYPES = ["sedan", "suv", "van", "motorcycle"] as const;

export interface SeedPlan {
  readonly drivers: number;
  readonly riders: number;
}

export const DEFAULT_SEED_PLAN: SeedPlan = { drivers: 20, riders: 10 };

/**
 * معرّفٌ مُشتقٌّ اشتقاقاً تامّاً من اسمه (UUIDv5، فضاءُ أسماءٍ خاصٌّ بالقياس).
 *
 * ولماذا v5 لا مجرّد قصٍّ لتلبيدة؟ لأن v5 يضبط رقمَ الإصدار وبتّاتَ الصنف، فيكون
 * الناتجُ UUID صالحاً يقبله عمودُ `uuid` وأيُّ أداةٍ تقرؤه — لا سلسلةً تشبه UUID.
 */
export function benchUuid(name: string): string {
  const namespace = "1b671a64-40d5-491e-99b0-da01ff1f3341";
  const nsBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(nsBytes).update(name, "utf8").digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  const b6 = bytes[6] ?? 0;
  const b8 = bytes[8] ?? 0;
  bytes[6] = (b6 & 0x0f) | 0x50;
  bytes[8] = (b8 & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * بصمةُ خطةِ البذر — دالّةٌ صرفةٌ تُحسَب بلا قاعدةِ بيانات.
 *
 * حتميّةُ البذر ليست زعمَ تشغيلٍ واحدٍ، بل برهانٌ آليٌّ أنّ المدخلاتِ نفسَها
 * تُنتجُ البصمةَ نفسَها — وأنّ مدخلاتٍ مختلفةً تُنتجُ بصمةً مختلفة.
 */
export function computeSeedFingerprint(plan: SeedPlan, cityCodes: readonly string[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        drivers: plan.drivers,
        riders: plan.riders,
        epoch: SEED_EPOCH.toISOString(),
        cities: cityCodes,
        vehicleTypes: VEHICLE_TYPES,
      }),
    )
    .digest("hex")
    .slice(0, 16);
}

export const DEFAULT_SEED_FINGERPRINT = computeSeedFingerprint(
  DEFAULT_SEED_PLAN,
  [], // بصمةُ الكود وحدَه — بلا مدنٍ لأنّ المدنَ تأتي من القاعدة.
);
