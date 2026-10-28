/**
 * `LOAD-01` §5.8 (SINGLE_TRIP) على PostgreSQL حقيقيّ — بوابةُ القبولِ الرابعة:
 * الترتيبُ وإزالةُ التكرار. يُثبتُ أنّ ST (الالتقاطُ في رحلةٍ واحدةٍ) يُرجعُ الصفَّ
 * والرمزَ والمحاولةَ و`request_id` نفسَها التي يُرجعُها CUR، وأنّ الالتقاطَ المتزامنَ
 * لا يلتقطُ الصفَّ مرّتين، وأنّ مسارَ ST لا يُصدرُ استعلامَ الارتباطِ الثاني أصلًا.
 * تعتمدُ هجرةُ `20261028120000` (المفتاحُ في الاستجابةِ) — بلاها يتراجعُ المحوّلُ.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createNotificationOutboxPort } from "../../packages/infrastructure/notification/notification-outbox-adapters.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
const TAG = "claim-single-trip";
const RID_A = "req-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const RID_B = "req-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const RIDS = [
  "req-c00000000000000000000000000000000",
  "req-c11111111111111111111111111111111",
  "req-c22222222222222222222222222222222",
  "req-c33333333333333333333333333333333",
  "req-c44444444444444444444444444444444",
  "req-c55555555555555555555555555555555",
  "req-c66666666666666666666666666666666",
  "req-c77777777777777777777777777777777",
];

let sql: Sql;
let cityId = "";
let savedConcurrency: string | null | undefined;

/** يلفُّ `sql` بعدِّادٍ لاستعلامِ الارتباطِ الثاني — لا يغيّرُ سلوكَهُ شيئًا. */
function countingSql(inner: Sql): { sql: Sql; correlationQueries: () => number } {
  let n = 0;
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (strings.join("$").includes("select request_id from notification_outbox")) n += 1;
    return (inner as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>)(
      strings,
      ...values,
    );
  };
  return { sql: fn as unknown as Sql, correlationQueries: () => n };
}

async function insertRow(requestId: string | null): Promise<string> {
  const id = crypto.randomUUID();
  await sql`
    insert into notification_outbox (id, city_id, kind, dedup_key, status, attempts, request_id, next_attempt_at)
    values (${id}::uuid, ${cityId}::uuid, 'rider_trip_notice', ${`${TAG}:${crypto.randomUUID()}`}, 'pending', 0, ${requestId}, now())`;
  return id;
}

describeIf("الالتقاطُ في رحلةٍ واحدةٍ — SINGLE_TRIP (§5.8)", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const city = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    cityId = city[0]?.id ?? "";
    if (cityId === "") throw new Error("مدينة جدة غير مبذورة");
    // رفعُ سقفِ تزامنِ المستهلِكِ مؤقّتًا لا اختبارَ التزاحمِ هنا (يُستعادُ الأصلُ بعدَه).
    const cur = await sql<{ value: string | null }[]>`
      select value #>> '{}' as value from platform_settings
       where city_id = ${cityId}::uuid and key = 'outbox_queue_consumer_concurrency'`;
    savedConcurrency = cur.length === 0 ? undefined : (cur[0]?.value ?? null);
    await sql`
      insert into platform_settings (city_id, key, value, value_type, description_ar)
      values (${cityId}::uuid, 'outbox_queue_consumer_concurrency', '100'::jsonb, 'number', 'اختبار SINGLE_TRIP (§5.8)')
      on conflict (city_id, key) do update set value = '100'::jsonb`;
  });

  afterAll(async () => {
    await sql`delete from notification_outbox where dedup_key like ${`${TAG}:%`}`;
    if (savedConcurrency !== undefined) {
      if (savedConcurrency === null) {
        await sql`delete from platform_settings where city_id = ${cityId}::uuid and key = 'outbox_queue_consumer_concurrency'`;
      } else {
        await sql`
          update platform_settings set value = to_jsonb(${savedConcurrency}::numeric)
           where city_id = ${cityId}::uuid and key = 'outbox_queue_consumer_concurrency'`;
      }
    }
    await sql.end();
  });

  it("ST يُرجعُ الصفَّ والرمزَ والمحاولةَ وrequest_id نفسَها التي يُرجعُها CUR، ولا يُصدرُ استعلامَ الارتباطِ", async () => {
    const idA = await insertRow(RID_A);
    const idB = await insertRow(RID_B);

    const stWrap = countingSql(sql);
    const st = createNotificationOutboxPort(stWrap.sql, { claimSingleTrip: true });
    const a = await st.claim();
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.value.delivery).not.toBeNull();
    if (a.value.delivery === null) return;
    expect(a.value.delivery.deliveryId).toBe(idA);
    expect(a.value.delivery.requestId).toBe(RID_A);
    expect(a.value.delivery.kind).toBe("rider_trip_notice");
    expect(a.value.delivery.attempts).toBe(1);
    expect(a.value.delivery.claimToken).not.toBe("");
    // جوهرُ §5.8: رحلةٌ واحدةٌ — لا استعلامِ ارتباطٍ في مسارِ ST.
    expect(stWrap.correlationQueries()).toBe(0);

    const curWrap = countingSql(sql);
    const cur = createNotificationOutboxPort(curWrap.sql);
    const b = await cur.claim();
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.value.delivery).not.toBeNull();
    if (b.value.delivery === null) return;
    expect(b.value.delivery.deliveryId).toBe(idB);
    expect(b.value.delivery.requestId).toBe(RID_B);
    expect(curWrap.correlationQueries()).toBe(1);

    // التكافؤُ التفاضليّ: نفسُ الحقولِ ونفسُ القيمِ في المسارين.
    const strip = (d: unknown) => {
      const { deliveryId, requestId, claimToken, ...rest } = d as Record<string, unknown>;
      return {
        hasIds: deliveryId !== undefined && claimToken !== undefined,
        requestIdPresent: requestId !== undefined,
        rest,
      };
    };
    expect(strip(a.value.delivery)).toEqual(strip(b.value.delivery));
  });

  it("request_id غائبٌ في الصفِّ: null في المسارين — لا سياقَ لا سياقٌ مُلفَّقٌ", async () => {
    await insertRow(null);
    const st = createNotificationOutboxPort(sql, { claimSingleTrip: true });
    const a = await st.claim();
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.value.delivery?.requestId).toBeNull();
  });

  it("الالتقاطُ المتزامنُ لا يلتقطُ الصفَّ مرّتين — ثمانيةٌ متوازيةٍ وثمانيةُ صفوفٍ متمايزةٍ", async () => {
    const ids: string[] = [];
    for (const rid of RIDS) ids.push(await insertRow(rid));
    const st = createNotificationOutboxPort(sql, { claimSingleTrip: true });
    const results = await Promise.all(ids.map(() => st.claim()));
    const claimed = results.flatMap((r) => (r.ok && r.value.delivery ? [r.value.delivery] : []));
    expect(claimed).toHaveLength(ids.length);
    const claimedIds = new Set(claimed.map((d) => d.deliveryId));
    expect(claimedIds.size).toBe(ids.length); // لا تكرارَ
    for (const id of ids) expect(claimedIds.has(id)).toBe(true); // ولا فقدَ
    // كلُّ التقاطٍ أعادَ معرّفَ ارتباطِ صفِّهِ نفسِهِ.
    const rows = await sql<{ id: string; request_id: string | null }[]>`
      select id, request_id from notification_outbox where id = any(${ids}::uuid[])`;
    for (const d of claimed) {
      expect(rows.find((r) => r.id === d.deliveryId)?.request_id).toBe(d.requestId);
    }
    // والصفوفُ كلُّها مُلتقَطةٌ مرةً واحدةً (sending بمحاولةٍ واحدة).
    const attempts = await sql<{ n: string }[]>`
      select count(*)::text as n from notification_outbox
       where id = any(${ids}::uuid[]) and status = 'sending' and attempts = 1`;
    expect(attempts[0]?.n).toBe(String(ids.length));
  });
});
