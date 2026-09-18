/**
 * الغرض: بذرُ حالةٍ ابتدائيّةٍ معروفةٍ وحتميّة في قاعدة القياس.
 * الحالة: منفّذ فعلياً ومُختبَر — المرحلة 2 وحدة 2-4.
 * ينتمي إلى: bench
 * يُتوقع أن يستخدمه لاحقاً: bench/runner.ts وسيناريوهات وحدة 2-5
 * ملاحظات مستقبلية: أيّ جدولٍ يُبذَر يُذكَر في `SEEDED_TABLES` وتُضبَط أزمنتُه صراحةً.
 *
 * ## معنى «حتميّ» هنا
 *
 * البذرُ حتميٌّ إذا كان تشغيلُه مرّتين على قاعدةٍ نظيفةٍ يُنتج **الحالةَ المنطقيّة
 * نفسَها**: نفسَ الصفوف، بنفس المعرّفات، وبنفس القيم ذات المعنى التجاريّ. وهذا
 * يفرض شيئين:
 *
 * 1. **لا `gen_random_uuid()` ولا عشوائيّة**: كلُّ معرّفٍ مُشتقٌّ اشتقاقاً من اسمٍ
 *    ثابت (UUIDv5). فمعرّفُ السائق الثالث هو هو في كلّ تشغيل، وهذا ما يجعل
 *    البصمةَ قابلةً للمقارنة أصلاً — لو كانت المعرّفاتُ عشوائيّةً لاختلفت البصمةُ
 *    في كلّ مرّةٍ ولو كانت الحالةُ منطقيّاً واحدة.
 * 2. **لا `now()` في أيّ قيمةٍ ذات معنى**: نهايةُ فترة التجربة وحدودُ الدورة
 *    تُشتقّ من `SEED_EPOCH` الثابت لا من ساعةِ التشغيل. و`created_at`/`updated_at`
 *    تبقى من ساعةِ الجدار لأنّ تزييفَهما كان سيُنتج حالةً لا ينتجها النظام —
 *    ولذلك تُستثنى من البصمة (انظر bench/state.ts).
 *
 * ## ولماذا `INSERT` مباشرٌ لا مسارُ التسجيل الحقيقيّ؟
 *
 * لأن مسارَ التسجيل الحقيقيّ هو **موضوعُ القياس** لا أداتُه: بذرُ عشرين ألفَ سائقٍ
 * عبر تسعِ خطواتِ حوارٍ لكلٍّ منهم يجعل تهيئةَ التجربة أبطأَ من التجربة، ويجعل
 * فشلَ التهيئة يُقرأ فشلَ منتج. والثمنُ معروفٌ ومُعلَن: البذرُ لا يُثبت أنّ مسارَ
 * التسجيل يُنتج هذه الحالة — وهذا ما ستُثبته سيناريوهاتُ وحدة 2-5 بمعايير عملٍ
 * على المسار الحقيقيّ نفسِه.
 */

import type { Sql } from "../../../packages/infrastructure/db/client.ts";
import {
  benchUuid,
  computeSeedFingerprint,
  DEFAULT_SEED_FINGERPRINT,
  DEFAULT_SEED_PLAN,
  SEED_EPOCH,
  type SeedPlan,
  VEHICLE_TYPES,
} from "../../../scripts/lib/bench-seed-fingerprint.ts";
import { assertConnectedToBenchDatabase, BENCH_TELEGRAM_ID_MIN } from "./isolation.ts";

export {
  benchUuid,
  computeSeedFingerprint,
  DEFAULT_SEED_FINGERPRINT,
  DEFAULT_SEED_PLAN,
  SEED_EPOCH,
  type SeedPlan,
  VEHICLE_TYPES,
};

const DAY_MS = 86_400_000;

/** نطاقُ معرّفات السائقين المبذورين — كلُّه فوق حدّ ملكيّة القياس. */
export const BENCH_DRIVER_TELEGRAM_BASE = BENCH_TELEGRAM_ID_MIN;
/** ونطاقُ العملاء منفصلٌ عنه بمسافةٍ واسعة، فلا يتراكبان مهما كبر المقياس. */
export const BENCH_RIDER_TELEGRAM_BASE = BENCH_TELEGRAM_ID_MIN + 100_000;

export const SEEDED_TABLES = [
  "users",
  "drivers",
  "riders",
  "subscriptions",
  "driver_capabilities",
] as const;

export interface SeedResult {
  readonly plan: SeedPlan;
  readonly cities: readonly { id: string; code: string }[];
  readonly insertedRows: Readonly<Record<string, number>>;
  readonly durationMs: number;
  /** بصمةُ مدخلاتِ البذر — لا بصمةُ نتيجته. تُذكَر في كلّ تجربة لتُعرَف بيانتُها. */
  readonly fingerprint: string;
}

/**
 * يبذر على قاعدةٍ **نظيفة**. لا يُصلح حالةً قائمةً ولا يُدمجها.
 *
 * والامتناعُ عن `on conflict do nothing` مقصود: بذرٌ «متسامح» كان سيُخفي أخطرَ
 * عطبٍ في منصّةِ قياس — أن يبقى أثرُ تشغيلٍ سابقٍ فيبدو أنّ البذرَ نجح والقاعدةُ
 * في الحالة المطلوبة، والحقيقةُ أنّ فيها صفوفاً من تجربةٍ أخرى. فالتصادمُ يجب أن
 * يُسقط البذر: معناه أنّ `reset` لم يُنادَ أو لم يُكمل.
 */
export async function seed(sql: Sql, plan: SeedPlan = DEFAULT_SEED_PLAN): Promise<SeedResult> {
  await assertConnectedToBenchDatabase(sql);
  const started = Bun.nanoseconds();

  const cities = await sql<{ id: string; code: string }[]>`
    select id, code from public.cities where is_active = true order by code
  `;
  if (cities.length === 0) {
    throw new Error("[bench/seed] لا مدن نشطة في قاعدة القياس — هل طُبّقت الترحيلات؟");
  }

  const cityOf = (index: number): string => {
    const city = cities[index % cities.length];
    if (city === undefined) throw new Error("[bench/seed] تعذّر اختيار مدينة.");
    return city.id;
  };

  const trialEndsAt = new Date(SEED_EPOCH.getTime() + 30 * DAY_MS);
  const periodEndsAt = new Date(SEED_EPOCH.getTime() + 60 * DAY_MS);

  const driverUsers: Record<string, unknown>[] = [];
  const drivers: Record<string, unknown>[] = [];
  const subscriptions: Record<string, unknown>[] = [];
  const capabilities: Record<string, unknown>[] = [];

  for (let i = 0; i < plan.drivers; i += 1) {
    const cityId = cityOf(i);
    const userId = benchUuid(`user:driver:${i}`);
    const driverId = benchUuid(`driver:${i}`);
    driverUsers.push({
      id: userId,
      city_id: cityId,
      telegram_id: BENCH_DRIVER_TELEGRAM_BASE + i,
      full_name: `سائق القياس ${i + 1}`,
      phone: `+96650${String(1_000_000 + i)}`,
      language_code: "ar",
      role: "driver",
    });
    drivers.push({
      id: driverId,
      city_id: cityId,
      user_id: userId,
      verification_status: "verified",
      vehicle_type: VEHICLE_TYPES[i % VEHICLE_TYPES.length] ?? "sedan",
      plate_number: `BCH${String(1000 + i)}`,
      national_id: `1${String(100_000_000 + i)}`,
      rating_count: 0,
    });
    subscriptions.push({
      id: benchUuid(`subscription:${i}`),
      city_id: cityId,
      driver_id: driverId,
      plan: "both",
      status: "active",
      trial_ends_at: trialEndsAt,
      current_period_end: periodEndsAt,
      /**
       * السعرُ يبقى فارغاً عن قصد: كلُّ ثابتٍ تجاريّ في هذا المشروع يسكن
       * `platform_settings` لا الكود (قاعدةٌ حاكمة في المستودع)، وإعادةُ كتابته
       * في أداةِ قياسٍ كانت ستُنشئ نسخةً ثانيةً تتعفّن بصمت.
       */
      price_amount: null,
      currency: null,
      cancel_at_period_end: false,
    });
    for (const service of ["transport", "delivery"] as const) {
      capabilities.push({
        id: benchUuid(`capability:${i}:${service}`),
        city_id: cityId,
        driver_id: driverId,
        service,
        is_enabled: true,
      });
    }
  }

  const riderUsers: Record<string, unknown>[] = [];
  const riders: Record<string, unknown>[] = [];
  for (let j = 0; j < plan.riders; j += 1) {
    const cityId = cityOf(j);
    const userId = benchUuid(`user:rider:${j}`);
    riderUsers.push({
      id: userId,
      city_id: cityId,
      telegram_id: BENCH_RIDER_TELEGRAM_BASE + j,
      full_name: `عميل القياس ${j + 1}`,
      phone: `+96655${String(1_000_000 + j)}`,
      language_code: "ar",
      role: "rider",
    });
    riders.push({
      id: benchUuid(`rider:${j}`),
      city_id: cityId,
      user_id: userId,
      rating_count: 0,
    });
  }

  /**
   * كلُّ الإدخال في معاملةٍ واحدة: بذرٌ نصفُه في القاعدة أسوأُ من بذرٍ فشل، لأن
   * الأوّلَ حالةٌ صامتةٌ لا يعرفها أحد، والثاني خطأٌ يُقرأ.
   */
  await sql.begin(async (tx) => {
    await tx`insert into public.users ${tx([...driverUsers, ...riderUsers])}`;
    await tx`insert into public.drivers ${tx(drivers)}`;
    await tx`insert into public.riders ${tx(riders)}`;
    await tx`insert into public.subscriptions ${tx(subscriptions)}`;
    await tx`insert into public.driver_capabilities ${tx(capabilities)}`;
  });

  const insertedRows = {
    users: driverUsers.length + riderUsers.length,
    drivers: drivers.length,
    riders: riders.length,
    subscriptions: subscriptions.length,
    driver_capabilities: capabilities.length,
  };

  return {
    plan,
    cities: cities.map((c) => ({ id: c.id, code: c.code })),
    insertedRows,
    durationMs: (Bun.nanoseconds() - started) / 1e6,
    fingerprint: computeSeedFingerprint(
      plan,
      cities.map((c) => c.code),
    ),
  };
}
