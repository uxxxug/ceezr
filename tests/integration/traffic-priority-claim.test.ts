/**
 * الغرض: **إثباتُ** أولويّاتِ المرورِ (القسمُ ١٥ / `F6-07`) على PostgreSQL حقيقيّةٍ.
 *    وحدةُ الاختبارِ تُثبِتُ أنَّ الرتبةَ مكتوبةٌ في الكودِ؛ وههنا وحدَه يُثبَتُ ما
 *    لا يُثبِتُه محاكٍ: أنَّ **المُطالِبَ** (`claim_notification_delivery`) يُقدِّمُ
 *    صفّاً حرجاً **أحدَثَ** على صفٍّ متوسّطٍ **أقدمَ** — أي أنَّ الترتيبَ الرتبيَّ
 *    سارٍ في القاعدةِ لا في التعليقِ؛ وأنَّ الأقدميّةَ تبقى حاكمةً داخلَ الرتبةِ
 *    الواحدةِ فلا يُجاعُ صفٌّ بلا نهايةٍ داخلَ صنفِه؛ وأنَّ رتبةَ كلِّ نوعٍ في
 *    القاعدةِ تُطابِقُ رتبتَه في الكودِ **بالنداءِ لا بقراءةِ نصِّ الهجرةِ**.
 * الحالة: منفّذ فعلياً — 2026-09-09.
 * ينتمي إلى: tests/integration
 * يُستخدم من: bun test (وظيفةُ تكاملِ PostgreSQL في CI)
 * ما لا يفعله: لا يقيسُ خطّةَ الاستعلامِ (استعمالَ فهرسِ الرتبةِ) — ذلكَ دَينٌ
 *   مُعلَنٌ في `docs/adr/0071-traffic-priority-classes.md` §٧، ولا يُدَّعى ههنا.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { NOTIFICATION_KINDS } from "../../packages/shared/config/notification-kinds.ts";
import { isDeferrableUnderBackpressure } from "../../packages/shared/config/queue-backpressure.ts";
import { priorityRankOfKind } from "../../packages/shared/config/traffic-priority.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

let sql: Sql;
let cityId: string;
/** القيمُ المبذورةُ كما وُجِدت — تُستعادُ في النهايةِ فلا تُسمِّمُ ما بعدَها. */
let seeded: Record<string, number> = {};

const TOUCHED_KEYS = [
  "outbox_queue_consumer_concurrency",
  "outbox_queue_depth_limit",
  "outbox_queue_oldest_age_limit_seconds",
] as const;

/** وسمٌ في `dedup_key` يُميِّزُ صفوفَ هذا الملفِّ وحدَها عندَ التنظيفِ. */
const TAG = "f6-07-claim";

async function setLimit(key: string, value: number): Promise<void> {
  await sql`
    update platform_settings
       set value = to_jsonb(${value}::numeric)
     where city_id = ${cityId}::uuid and key = ${key}
  `;
}

/** يُدرِجُ صفّاً معلَّقاً بنوعٍ وعُمرٍ محدَّدَينِ ويُعيدُ معرّفَه. */
async function seedRow(kind: string, ageSeconds: number): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into notification_outbox
      (city_id, kind, status, payload, created_at, next_attempt_at, dedup_key)
    values (${cityId}::uuid, ${kind}, 'pending', '{}'::jsonb,
            now() - make_interval(secs => ${ageSeconds}::numeric),
            now() - make_interval(secs => ${ageSeconds}::numeric),
            ${`${TAG}:`} || gen_random_uuid()::text)
    returning id
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("تعذّرَ بذرُ صفٍّ في الصادرِ");
  return id;
}

async function claimOne(): Promise<{ deliveryId: string | null; kind: string | null }> {
  const rows = await sql<{ result: Record<string, unknown> }[]>`
    select claim_notification_delivery() as result
  `;
  const delivery = rows[0]?.result?.delivery as Record<string, unknown> | null | undefined;
  if (delivery === null || delivery === undefined) return { deliveryId: null, kind: null };
  return {
    deliveryId: String(delivery.delivery_id ?? ""),
    kind: String(delivery.kind ?? ""),
  };
}

describeIf("أولويّاتُ المرورِ في المُطالِبِ على PostgreSQL فعلية (F6-07)", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const city = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    cityId = city[0]?.id ?? "";
    if (cityId === "") throw new Error("مدينة جدة غير مبذورة");

    const rows = await sql<{ key: string; value: number }[]>`
      select key, (value #>> '{}')::numeric as value
        from platform_settings
       where city_id = ${cityId}::uuid and key like 'outbox_queue_%'
    `;
    seeded = Object.fromEntries(rows.map((row) => [row.key, Number(row.value)]));
    for (const key of TOUCHED_KEYS) {
      if (seeded[key] === undefined) throw new Error(`مفتاحٌ غيرُ مبذورٍ: ${key}`);
    }
    // حدودٌ واسعةٌ: موضوعُ القياسِ **الترتيبُ** لا الضغطُ العكسيُّ. ولو بقيَ سقفُ
    // التزامنِ ضيّقاً لَرَدَّ المُطالِبُ الالتقاطَ الثانيَ بسببِ الضغطِ فقاسَ
    // الاختبارُ حاجزاً آخرَ وادَّعى أنَّه قاسَ الرتبةَ.
    await setLimit("outbox_queue_consumer_concurrency", 50);
    await setLimit("outbox_queue_depth_limit", 10_000);
    await setLimit("outbox_queue_oldest_age_limit_seconds", 86_400);
  });

  afterEach(async () => {
    await sql`
      delete from notification_outbox
       where city_id = ${cityId}::uuid and dedup_key like ${`${TAG}:%`}
    `;
  });

  afterAll(async () => {
    for (const key of TOUCHED_KEYS) {
      const value = seeded[key];
      if (value !== undefined) await setLimit(key, value);
    }
    await sql`
      delete from notification_outbox
       where city_id = ${cityId}::uuid and dedup_key like ${`${TAG}:%`}
    `;
    await sql.end({ timeout: 5 });
  });

  it("الحرجُ الأحدَثُ يُلتقَطُ قبلَ المتوسّطِ الأقدمِ — الرتبةُ قبلَ الأقدميّةِ", async () => {
    // المتوسّطُ أقدمُ بدقيقةٍ كاملةٍ: بترتيبِ `F6-06` (الأقدميّةُ وحدَها) كانَ
    // يُلتقَطُ أوّلاً بلا خلافٍ، فالمقياسُ ههنا مقياسٌ فارقٌ لا تأكيدُ سلوكٍ قائمٍ.
    const older = await seedRow("no_driver_found", 60);
    const newer = await seedRow("negotiation_turn_opened", 1);

    const first = await claimOne();
    expect(first.kind).toBe("negotiation_turn_opened");
    expect(first.deliveryId).toBe(newer);

    const second = await claimOne();
    expect(second.kind).toBe("no_driver_found");
    expect(second.deliveryId).toBe(older);
  });

  it("المرتفعُ قبلَ المتوسّطِ، والمتوسّطُ قبلَ المنخفضِ — الرتبُ الأربعُ مُرتَّبةٌ فعلاً", async () => {
    // الأعمارُ مقلوبةٌ على الرتبِ عمداً: الأدنى رتبةً هوَ الأقدمُ، فلو أُهمِلَت
    // الرتبةُ لَخرجَ الترتيبُ معكوساً تماماً.
    await seedRow("broadcast_recipient", 400);
    await seedRow("no_driver_found", 300);
    await seedRow("offer", 200);
    await seedRow("order_cancelled", 100);

    const order: (string | null)[] = [];
    for (let index = 0; index < 3; index += 1) {
      order.push((await claimOne()).kind);
    }
    // `broadcast_recipient` ليسَ من أنواعِ دورةِ الرحلةِ التي يُطالِبُ بها هذا
    // المُطالِبُ (له مطالِبُه الخاصُّ)، فلا يظهرُ في الالتقاطِ — وهذا مقصودٌ.
    expect(order).toEqual(["order_cancelled", "offer", "no_driver_found"]);
    expect((await claimOne()).kind).toBeNull();
  });

  it("الأقدميّةُ تبقى حاكمةً داخلَ الرتبةِ الواحدةِ — لا جوعَ داخلَ الصنفِ", async () => {
    const older = await seedRow("no_driver_found", 120);
    await seedRow("no_driver_found", 5);
    expect((await claimOne()).deliveryId).toBe(older);
  });

  it("رتبةُ كلِّ نوعٍ في القاعدةِ تُطابِقُ رتبتَه في الكودِ — بالنداءِ لا بقراءةِ النصِّ", async () => {
    for (const kind of NOTIFICATION_KINDS) {
      const rows = await sql<{ rank: number; deferrable: boolean }[]>`
        select notification_kind_priority(${kind})::int as rank,
               notification_kind_is_deferrable(${kind}) as deferrable
      `;
      expect(rows[0]?.rank).toBe(priorityRankOfKind(kind));
      expect(rows[0]?.deferrable).toBe(isDeferrableUnderBackpressure(kind));
    }
  });

  it("نوعٌ مجهولٌ يُقرأُ حرجاً في القاعدةِ — السهوُ يُقدِّمُ ولا يُؤخِّرُ", async () => {
    const rows = await sql<{ rank: number; deferrable: boolean }[]>`
      select notification_kind_priority('kind_that_does_not_exist')::int as rank,
             notification_kind_is_deferrable('kind_that_does_not_exist') as deferrable
    `;
    expect(rows[0]?.rank).toBe(priorityRankOfKind("safety_incident"));
    expect(rows[0]?.deferrable).toBe(false);
  });

  it("فهرسُ الرتبةِ قائمٌ في القاعدةِ لا في ملفِّ الهجرةِ وحدَه", async () => {
    const rows = await sql<{ indexdef: string }[]>`
      select indexdef from pg_indexes
       where tablename = 'notification_outbox'
         and indexname = 'notification_outbox_priority_due_idx'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toContain("notification_kind_priority");
  });
});
