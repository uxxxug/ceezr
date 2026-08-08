/**
 * الغرض: إثبات أن سباق المطابقة لا يُنتج رحلةً لسائقين — ألف مطالبة متزامنة على
 *   طلب واحد، وألف مطالبة موزَّعة على مئة طلب، بأثرٍ يُفحَص في القاعدة لا بجوابٍ
 *   يُصدَّق.
 * الحالة: منفّذ فعلياً — البند المعلَّق من الأمر السابق.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: كل تعديل يمسّ claim_ride أو order_offers أو orders
 * ملاحظات مستقبلية: هذا قياسٌ **وتحقّق** معاً. لو صار جزءاً من CI فليُخفَّض العدد،
 *   فقيمة الإثبات في التزامن لا في الكمّ، والتزامن يظهر عند مئة كما عند ألف.
 *
 * التشغيل:
 *   TEST_DATABASE_URL=postgres://... bun run scripts/match-race-test.ts [--claims 1000]
 */

import { createSql } from "../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
if (DATABASE_URL === undefined || DATABASE_URL === "") {
  console.error("❌ عيّن TEST_DATABASE_URL لقاعدة بها كل الهجرات مطبَّقة.");
  process.exit(1);
}

function intArg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number.parseInt(process.argv[index + 1] ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const CLAIMS = intArg("claims", 1000);
const ORDERS_IN_SPREAD = intArg("orders", 100);

// بِركة واسعة عمداً: بِركة ضيّقة تُسلسِل المطالبات في طابور العميل فلا تصل القاعدة
// متزامنة أصلاً — فيمرّ الاختبار بلا أن يختبر شيئاً. الغرض إجهاد قفل القاعدة نفسه.
const sql = createSql({ connectionString: DATABASE_URL, max: 64 });

const failures: string[] = [];
function check(condition: boolean, description: string): void {
  if (condition) {
    console.log(`   ✅ ${description}`);
    return;
  }
  console.log(`   ❌ ${description}`);
  failures.push(description);
}

async function reset(): Promise<string> {
  await sql`truncate table audit_log, attendance_log, order_offers, orders,
                           subscriptions, driver_capabilities, driver_availability,
                           drivers, riders, users restart identity cascade`;
  await sql`
    update cities
       set is_active = true,
           telegram_support_group_id = -1001,
           telegram_escalation_group_id = -1002,
           telegram_unsubscribed_drivers_group_id = -1003
     where code = 'JED'
  `;
  const rows = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
  const cityId = rows[0]?.id;
  if (cityId === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن");
  return cityId;
}

async function seedDrivers(cityId: string, count: number, offset: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const telegram = 900_000 + offset + index;
    const users = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, ${telegram}::bigint, ${`سائق ${telegram}`},
              ${`+9665${String(telegram).padStart(8, "0")}`}, 'ar', 'driver')
      returning id
    `;
    const userId = users[0]?.id;
    if (userId === undefined) throw new Error("تعذّر إنشاء المستخدم");

    const drivers = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
      values (${cityId}, ${userId}, 'verified', 'sedan', ${`R-${telegram}`})
      returning id
    `;
    const driverId = drivers[0]?.id;
    if (driverId === undefined) throw new Error("تعذّر إنشاء السائق");
    await sql`
      insert into driver_availability (city_id, driver_id, is_available)
      values (${cityId}, ${driverId}, true)
    `;
    ids.push(driverId);
  }
  return ids;
}

async function seedOrder(cityId: string, riderId: string): Promise<string> {
  const orders = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, dropoff,
                        pickup_label, dropoff_label)
    values (${cityId}, ${riderId}, 'transport', 'searching',
            st_point(39.1751, 21.5471)::geography, st_point(39.1901, 21.5601)::geography,
            'الحرم', 'المطار')
    returning id
  `;
  const id = orders[0]?.id;
  if (id === undefined) throw new Error("تعذّر إنشاء الطلب");
  return id;
}

async function seedRider(cityId: string): Promise<string> {
  const users = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, language_code, role)
    values (${cityId}, 880001::bigint, 'راكب السباق', '+966500880001', 'ar', 'rider')
    returning id
  `;
  const userId = users[0]?.id;
  if (userId === undefined) throw new Error("تعذّر إنشاء المستخدم");
  const riders = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${userId}) returning id
  `;
  const riderId = riders[0]?.id;
  if (riderId === undefined) throw new Error("تعذّر إنشاء الراكب");
  return riderId;
}

async function offerAll(cityId: string, orderId: string, driverIds: string[]): Promise<void> {
  // عرضٌ صالح لكل سائق على نفس الطلب: بلا هذا يفشل الجميع على OFFER_NOT_VALID
  // فيمرّ الاختبار بلا أن يلمس القفل الذي جاء لأجله.
  await sql`
    insert into order_offers (city_id, order_id, driver_id, round, status, expires_at)
    select ${cityId}, ${orderId}, unnest(${driverIds}::uuid[]), 1, 'pending',
           now() + interval '10 minutes'
  `;
}

interface ClaimOutcome {
  readonly ok: boolean;
  readonly error: string | null;
  readonly driverId: string;
  readonly ms: number;
}

async function claim(orderId: string, driverId: string): Promise<ClaimOutcome> {
  const startedAt = performance.now();
  try {
    const rows = await sql<{ claim_ride: { ok: boolean; error?: string } }[]>`
      select claim_ride(${orderId}::uuid, ${driverId}::uuid) as claim_ride
    `;
    const envelope = rows[0]?.claim_ride;
    return {
      ok: envelope?.ok === true,
      error: envelope?.ok === true ? null : (envelope?.error ?? "NO_ENVELOPE"),
      driverId,
      ms: performance.now() - startedAt,
    };
  } catch (error) {
    // استثناء من القاعدة ليس «خسارة في السباق»: الخسارة تُعاد في المغلَّف. أي
    // استثناء هنا عيبٌ يجب أن يُرى، فيُحسب صراحةً ولا يُبتلع.
    return {
      ok: false,
      error: `EXCEPTION: ${error instanceof Error ? error.message : String(error)}`,
      driverId,
      ms: performance.now() - startedAt,
    };
  }
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? 0;
}

/** السيناريو الأقسى: كل المطالبات على طلبٍ واحد، فالتنافس أقصى ما يمكن. */
async function singleOrderRace(cityId: string): Promise<void> {
  console.log(`\n▶️  السيناريو 1: ${CLAIMS} مطالبة متزامنة على **طلب واحد**`);
  const riderId = await seedRider(cityId);
  const driverIds = await seedDrivers(cityId, CLAIMS, 0);
  const orderId = await seedOrder(cityId, riderId);
  await offerAll(cityId, orderId, driverIds);

  const startedAt = performance.now();
  const outcomes = await Promise.all(driverIds.map((driverId) => claim(orderId, driverId)));
  const elapsedMs = performance.now() - startedAt;

  const winners = outcomes.filter((outcome) => outcome.ok);
  const exceptions = outcomes.filter((outcome) => outcome.error?.startsWith("EXCEPTION") === true);
  const reasons = new Map<string, number>();
  for (const outcome of outcomes) {
    if (outcome.ok) continue;
    reasons.set(outcome.error ?? "?", (reasons.get(outcome.error ?? "?") ?? 0) + 1);
  }

  const latencies = outcomes.map((outcome) => outcome.ms);
  console.log(
    `   الزمن ${(elapsedMs / 1000).toFixed(2)}s — ${(CLAIMS / (elapsedMs / 1000)).toFixed(0)} مطالبة/ثانية`,
  );
  console.log(
    `   زمن المطالبة: وسيط ${percentile(latencies, 0.5).toFixed(1)}ms  p95 ${percentile(latencies, 0.95).toFixed(1)}ms  أقصى ${Math.max(...latencies).toFixed(1)}ms`,
  );
  console.log(`   أسباب الخسارة: ${[...reasons].map(([r, c]) => `${r}×${c}`).join("  ")}`);

  // ── التحقّق في القاعدة لا في الجواب: الجواب يُصدَّق، والأثر يُفحَص ──────────
  const order = await sql<{ status: string; assigned_driver_id: string | null }[]>`
    select status, assigned_driver_id from orders where id = ${orderId}
  `;
  const offers = await sql<{ status: string; count: string }[]>`
    select status::text, count(*)::text as count from order_offers
     where order_id = ${orderId} group by status
  `;
  const audits = await sql<{ count: string }[]>`
    select count(*)::text as count from audit_log
     where entity_id = ${orderId} and action = 'order.claimed'
  `;
  const byStatus = new Map(offers.map((row) => [row.status, Number(row.count)]));

  check(exceptions.length === 0, `لا استثناء واحد من القاعدة (وقع ${exceptions.length})`);
  check(winners.length === 1, `فائزٌ واحد لا أكثر ولا أقل (${winners.length})`);
  check(order[0]?.status === "matched", `الطلب صار matched (${order[0]?.status})`);
  check(
    order[0]?.assigned_driver_id === winners[0]?.driverId,
    "السائق المسنَد هو الفائز نفسه لا غيره",
  );
  check(byStatus.get("accepted") === 1, `عرضٌ مقبول واحد فقط (${byStatus.get("accepted") ?? 0})`);
  check(
    (byStatus.get("pending") ?? 0) === 0,
    `لا عرض بقي pending بعد المطابقة (${byStatus.get("pending") ?? 0})`,
  );
  check(
    byStatus.get("cancelled") === CLAIMS - 1,
    `أُلغيت العروض الباقية كلها (${byStatus.get("cancelled") ?? 0} من ${CLAIMS - 1})`,
  );
  check(Number(audits[0]?.count) === 1, `سجلّ تدقيق واحد للمطالبة (${audits[0]?.count})`);
  check(
    (reasons.get("ORDER_NOT_CLAIMABLE") ?? 0) + (reasons.get("OFFER_NOT_VALID") ?? 0) ===
      CLAIMS - 1,
    "كل الخاسرين خسروا بسببٍ متوقَّع لا بعطل",
  );
}

/** السيناريو الواقعي: مطالبات موزَّعة على طلبات كثيرة معاً — لا يقفل بعضها بعضاً. */
async function spreadRace(cityId: string): Promise<void> {
  const perOrder = Math.max(2, Math.floor(CLAIMS / ORDERS_IN_SPREAD));
  const orderCount = ORDERS_IN_SPREAD;
  console.log(
    `\n▶️  السيناريو 2: ${orderCount} طلباً × ${perOrder} سائقاً = ${orderCount * perOrder} مطالبة متزامنة`,
  );

  const riderId = await seedRider(cityId);
  const driverIds = await seedDrivers(cityId, orderCount * perOrder, 0);

  const pairs: { orderId: string; driverId: string }[] = [];
  for (let index = 0; index < orderCount; index += 1) {
    const orderId = await seedOrder(cityId, riderId);
    const slice = driverIds.slice(index * perOrder, (index + 1) * perOrder);
    await offerAll(cityId, orderId, slice);
    for (const driverId of slice) pairs.push({ orderId, driverId });
  }

  const startedAt = performance.now();
  const outcomes = await Promise.all(pairs.map((pair) => claim(pair.orderId, pair.driverId)));
  const elapsedMs = performance.now() - startedAt;

  const winners = outcomes.filter((outcome) => outcome.ok);
  const exceptions = outcomes.filter((outcome) => outcome.error?.startsWith("EXCEPTION") === true);
  const latencies = outcomes.map((outcome) => outcome.ms);
  console.log(
    `   الزمن ${(elapsedMs / 1000).toFixed(2)}s — ${(pairs.length / (elapsedMs / 1000)).toFixed(0)} مطالبة/ثانية`,
  );
  console.log(
    `   زمن المطالبة: وسيط ${percentile(latencies, 0.5).toFixed(1)}ms  p95 ${percentile(latencies, 0.95).toFixed(1)}ms  أقصى ${Math.max(...latencies).toFixed(1)}ms`,
  );

  const matched = await sql<{ count: string }[]>`
    select count(*)::text as count from orders where status = 'matched'
  `;
  const doubleAccepted = await sql<{ count: string }[]>`
    select count(*)::text as count from (
      select order_id from order_offers where status = 'accepted'
       group by order_id having count(*) > 1
    ) as duplicated
  `;
  const orphaned = await sql<{ count: string }[]>`
    select count(*)::text as count from orders o
     where o.status = 'matched'
       and not exists (
         select 1 from order_offers f
          where f.order_id = o.id and f.status = 'accepted'
            and f.driver_id = o.assigned_driver_id
       )
  `;

  check(exceptions.length === 0, `لا استثناء واحد من القاعدة (وقع ${exceptions.length})`);
  check(winners.length === orderCount, `فائزٌ واحد لكل طلب (${winners.length} من ${orderCount})`);
  check(Number(matched[0]?.count) === orderCount, `كل الطلبات طوبقت (${matched[0]?.count})`);
  check(Number(doubleAccepted[0]?.count) === 0, "لا طلب بعرضين مقبولين — لا رحلة لسائقَين");
  check(Number(orphaned[0]?.count) === 0, "لا طلب مسنَد لسائق بلا عرض مقبول يقابله");
}

async function main(): Promise<void> {
  console.log("=== سباق المطابقة تحت التزامن ===");
  await reset();
  await singleOrderRace(
    await sql<{ id: string }[]>`select id from cities where code = 'JED'`.then(
      (rows) => rows[0]?.id ?? "",
    ),
  );

  await reset();
  const cityId = (await sql<{ id: string }[]>`select id from cities where code = 'JED'`)[0]?.id;
  if (cityId === undefined) throw new Error("لا مدينة");
  await spreadRace(cityId);

  console.log(
    `\n=== النتيجة: ${failures.length === 0 ? "✅ نجح كل تحقّق" : `❌ ${failures.length} فشل`}`,
  );
  for (const failure of failures) console.log(`   - ${failure}`);
  if (failures.length > 0) process.exitCode = 1;
}

try {
  await main();
} finally {
  await sql.end({ timeout: 5 });
}
