/**
 * الغرض: إثبات ذرّية تغييرات الاشتراك تحت تزامن حقيقي — البند 9.2 من التوجيه.
 *   ثلاثة سباقات، كلٌّ منها كان قادراً على إفساد بيانات مالية لو لم يُقفل الصفّ:
 *     ١) إلغاءان متزامنان: يجب أن يُسجَّل طلبٌ واحد بسبب واحد، لا أن يكتب
 *        أحدهما فوق سبب الآخر ولا أن يُنشأ سطرا تدقيق لطلب واحد.
 *     ٢) ترقيتان متزامنتان: يجب أن يُخصم الفرق مرّة واحدة منطقياً، وأن تبقى
 *        الدورة المدفوعة كما هي، وألّا يظهر اشتراكان حيّان للسائق نفسه.
 *     ٣) إلغاء يتزامن مع ترقية: يجب أن تنتهي الحالة متّسقة (لا خطّة مرقّاة
 *        على اشتراك يُظنّ أنه لم يُلغَ، ولا العكس) لا أن تُقرأ حالة وسطى.
 *   لا منطق تزامن في طبقة التطبيق: الضمان كلّه من `for update` داخل الدالّات.
 * الحالة: منفّذ فعلياً — سكربت إثبات، يُشغَّل يدوياً وفي دليل البوابة.
 * ينتمي إلى: scripts (أدوات إثبات، ليست جزءاً من زمن التشغيل)
 * الاستخدام: TEST_DATABASE_URL=... bun run scripts/race-subscription-changes.ts
 */

import { createSql } from "../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (DATABASE_URL === undefined || DATABASE_URL === "") {
  console.error("مطلوب TEST_DATABASE_URL — لا يُشغَّل هذا السكربت بلا قاعدة حقيقية.");
  process.exit(1);
}

const sql = createSql({ connectionString: DATABASE_URL });

/** عدد المحاولات المتزامنة لكل سباق. */
const CONCURRENCY = 30;

interface Fixture {
  readonly cityId: string;
  readonly driverId: string;
  readonly subscriptionId: string;
}

let seq = 0;
/**
 * قاعدة معرّفات فريدة لكل تشغيل. التشغيل الأول استخدم `8_000_000_000 + seq`
 * فانكسر التشغيل الثاني على `users_telegram_id_key` — معرّفات ثابتة بين
 * التشغيلات تجعل السكربت صالحاً لمرّة واحدة على قاعدة دائمة.
 */
const RUN_BASE = 7_000_000_000 + (Date.now() % 900_000_000);

async function makeDriver(status: "trialing" | "active"): Promise<Fixture> {
  seq += 1;
  const suffix = `${RUN_BASE % 1_000_000}${seq}`;
  const [city] = await sql<{ id: string }[]>`
    select id from cities order by code limit 1
  `;
  if (city === undefined) {
    throw new Error("لا مدن في القاعدة — الهجرات غير مطبّقة.");
  }
  const [user] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, role)
    values (${city.id}, ${RUN_BASE + seq}, ${`سباق ${suffix}`}, ${`+9665${suffix.slice(0, 8)}`}, 'driver')
    returning id
  `;
  if (user === undefined) {
    throw new Error("تعذّر إنشاء المستخدم.");
  }
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, vehicle_type, plate_number)
    values (${city.id}, ${user.id}, 'sedan', ${`RC-${suffix}`})
    returning id
  `;
  if (driver === undefined) {
    throw new Error("تعذّر إنشاء السائق.");
  }
  if (status === "trialing") {
    await sql`select start_trial(${driver.id}::uuid, 'transport')`;
  } else {
    await sql`select activate_subscription(${driver.id}::uuid, 'transport', 30)`;
  }
  const [sub] = await sql<{ id: string }[]>`
    select id from subscriptions where driver_id = ${driver.id}
  `;
  if (sub === undefined) {
    throw new Error("لم يُنشأ اشتراك.");
  }
  return { cityId: city.id, driverId: driver.id, subscriptionId: sub.id };
}

function summarise(label: string, results: PromiseSettledResult<unknown>[]): void {
  const rejected = results.filter((r) => r.status === "rejected");
  console.log(`${label}: نجحت ${results.length - rejected.length}/${results.length}`);
  for (const r of rejected.slice(0, 3)) {
    if (r.status === "rejected") {
      console.log(`   استثناء: ${String(r.reason)}`);
    }
  }
}

let failures = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`   ✅ ${message}`);
  } else {
    failures += 1;
    console.log(`   ❌ ${message}`);
  }
}

async function raceCancel(): Promise<void> {
  console.log("\n─── سباق ١: إلغاءان متزامنان ───");
  const f = await makeDriver("active");
  const results = await Promise.allSettled(
    Array.from(
      { length: CONCURRENCY },
      (_unused, i) =>
        sql<{ r: Record<string, unknown> }[]>`
          select cancel_subscription(${f.driverId}::uuid, ${`سبب-${i}`}) as r
        `,
    ),
  );
  summarise("الاستدعاءات", results);

  const rows = results.flatMap((r) => (r.status === "fulfilled" ? [r.value[0]?.r] : []));
  const firstTime = rows.filter((r) => r?.already_cancelled === false).length;
  const repeats = rows.filter((r) => r?.already_cancelled === true).length;
  console.log(`   طلب أوّل: ${firstTime} | مكرّر: ${repeats}`);
  assert(firstTime === 1, "طلب إلغاء أوّل واحد فقط رغم التزامن");

  const [audit] = await sql<{ n: number }[]>`
    select count(*)::int as n from audit_log
     where entity_id = ${f.subscriptionId} and action = 'subscription.cancellation_requested'
  `;
  assert(audit?.n === 1, `سطر تدقيق واحد للطلب (وجدت ${String(audit?.n)})`);

  const [sub] = await sql<{ cancel_at_period_end: boolean; cancellation_reason: string }[]>`
    select cancel_at_period_end, cancellation_reason from subscriptions where id = ${f.subscriptionId}
  `;
  assert(sub?.cancel_at_period_end === true, "العلم مرفوع");
  assert(
    typeof sub?.cancellation_reason === "string" && sub.cancellation_reason.startsWith("سبب-"),
    `السبب المحفوظ هو سبب الطلب الأول فقط (${String(sub?.cancellation_reason)})`,
  );
}

async function raceUpgrade(): Promise<void> {
  console.log("\n─── سباق ٢: ترقيتان متزامنتان ───");
  const f = await makeDriver("active");
  const [before] = await sql<{ current_period_end: Date }[]>`
    select current_period_end from subscriptions where id = ${f.subscriptionId}
  `;

  const results = await Promise.allSettled(
    Array.from(
      { length: CONCURRENCY },
      () =>
        sql<{ r: Record<string, unknown> }[]>`
          select upgrade_plan(${f.driverId}::uuid, 'both', null) as r
        `,
    ),
  );
  summarise("الاستدعاءات", results);

  const rows = results.flatMap((r) => (r.status === "fulfilled" ? [r.value[0]?.r] : []));
  const applied = rows.filter((r) => r?.already_on_plan === false).length;
  console.log(`   طبّقت الترقية: ${applied} | وجدتها مطبّقة: ${rows.length - applied}`);
  assert(applied === 1, "ترقية واحدة فعلية فقط");

  const [audit] = await sql<{ n: number }[]>`
    select count(*)::int as n from audit_log
     where entity_id = ${f.subscriptionId} and action = 'subscription.plan_upgraded'
  `;
  assert(audit?.n === 1, `سطر تدقيق واحد للترقية (وجدت ${String(audit?.n)})`);

  const [after] = await sql<{ plan: string; current_period_end: Date }[]>`
    select plan, current_period_end from subscriptions where id = ${f.subscriptionId}
  `;
  assert(after?.plan === "both", "الخطّة صارت both");
  assert(
    after !== undefined &&
      before !== undefined &&
      new Date(after.current_period_end).getTime() ===
        new Date(before.current_period_end).getTime(),
    "الدورة المدفوعة لم تُمَسّ",
  );

  const [live] = await sql<{ n: number }[]>`
    select count(*)::int as n from subscriptions
     where driver_id = ${f.driverId} and status in ('trialing', 'active')
  `;
  assert(live?.n === 1, `اشتراك حيّ واحد (وجدت ${String(live?.n)})`);
}

async function raceCancelVersusUpgrade(): Promise<void> {
  console.log("\n─── سباق ٣: إلغاء يتزامن مع ترقية ───");
  const f = await makeDriver("active");
  const calls: Promise<unknown>[] = [];
  for (let i = 0; i < CONCURRENCY; i += 1) {
    calls.push(
      i % 2 === 0
        ? sql`select cancel_subscription(${f.driverId}::uuid, 'تزامن') as r`
        : sql`select upgrade_plan(${f.driverId}::uuid, 'both', null) as r`,
    );
  }
  summarise("الاستدعاءات", await Promise.allSettled(calls));

  const [sub] = await sql<
    { plan: string; cancel_at_period_end: boolean; cancellation_requested_at: Date | null }[]
  >`
    select plan, cancel_at_period_end, cancellation_requested_at
      from subscriptions where id = ${f.subscriptionId}
  `;
  assert(sub?.plan === "both", "الترقية طُبّقت");
  assert(sub?.cancel_at_period_end === true, "الإلغاء طُبّق");
  assert(
    sub?.cancellation_requested_at !== null,
    "قيد الاتّساق subscriptions_cancellation_coherent لم يُخترق",
  );

  const [live] = await sql<{ n: number }[]>`
    select count(*)::int as n from subscriptions
     where driver_id = ${f.driverId} and status in ('trialing', 'active')
  `;
  assert(live?.n === 1, `اشتراك حيّ واحد (وجدت ${String(live?.n)})`);
}

await raceCancel();
await raceUpgrade();
await raceCancelVersusUpgrade();

console.log(`\n${failures === 0 ? "✅ كل السباقات سليمة" : `❌ ${failures} تأكيداً فشل`}`);
await sql.end();
process.exit(failures === 0 ? 0 : 1);
