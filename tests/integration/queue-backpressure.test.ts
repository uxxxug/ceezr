/**
 * الغرض: الضغطُ العكسيُّ لكلِّ طابورٍ على PostgreSQL حقيقيّةٍ (F6-06 / ADR-0066).
 *    المقصودُ إثباتُ ما لا يُثبتُه محاكٍ: أنَّ حكمَ القاعدةِ
 *    (`notification_outbox_backpressure`) وحكمَ الشيفرةِ
 *    (`evaluateQueueBackpressure`) **يتّفقانِ على الحِمْلِ نفسِه** — فلا مصدرا
 *    حقيقةٍ يفترقانِ؛ وأنَّ حملةَ بثٍّ كبيرةً تُؤجَّلُ **وحدةً واحدةً** لا
 *    مستقبِلاً مستقبِلاً؛ وأنَّ الحرجَ يمرُّ في الوقتِ نفسِه؛ وأنَّ سقفَ تزامنِ
 *    المستهلِكِ يمنعُ الالتقاطَ في `claim_notification_delivery` نفسِها؛ وأنَّ
 *    حدَّ منتِجِ طابورِ تيليجرام يردُّ الاستلامَ **قبلَ** استهلاكِ رقمِ التحديثِ.
 * الحالة: منفّذ فعلياً — 2026-09-09.
 * ينتمي إلى: tests/integration
 * يُستخدم من: bun test (وظيفةُ تكاملِ PostgreSQL في CI)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  evaluateQueueBackpressure,
  type QueueLimits,
  type QueueLoad,
} from "../../packages/application/scheduling/queue-backpressure.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { QUEUE_DEAD_WINDOW_SECONDS } from "../../packages/shared/config/queue-backpressure.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

let sql: Sql;
let cityId: string;
let adminUserId: string;
let recipientUserIds: string[] = [];
/** القيمُ المبذورةُ كما وُجِدت — تُستعادُ قبلَ كلِّ حالةٍ فلا تُسمِّمُ ما بعدَها. */
let seededLimits: Record<string, number> = {};

const OUTBOX_LIMIT_KEYS = [
  "outbox_queue_depth_limit",
  "outbox_queue_oldest_age_limit_seconds",
  "outbox_queue_dead_limit",
  "outbox_queue_producer_limit",
  "outbox_queue_consumer_concurrency",
  "outbox_queue_producer_defer_seconds",
] as const;

/** أوّلُ رقمِ تيليجرام في هذا الملفِّ — نطاقٌ خاصٌّ لا يتقاطعُ مع غيرِه. */
const TELEGRAM_BASE = 971_000;

/** يقرأُ مفتاحَ إعدادٍ رقميّاً لهذه المدينةِ — لا رقمَ مُثبَّتاً في الاختبارِ. */
async function setting(key: string): Promise<number> {
  const rows = await sql<{ value: number }[]>`
    select (value #>> '{}')::numeric as value
      from platform_settings
     where city_id = ${cityId}::uuid and key = ${key}
  `;
  const value = rows[0]?.value;
  if (value === undefined) throw new Error(`مفتاحٌ غيرُ مبذورٍ: ${key}`);
  return Number(value);
}

async function limits(): Promise<QueueLimits> {
  return {
    depthLimit: await setting("outbox_queue_depth_limit"),
    oldestAgeLimitSeconds: await setting("outbox_queue_oldest_age_limit_seconds"),
    retryLimit: await setting("notification_delivery_max_attempts"),
    deadLimit: await setting("outbox_queue_dead_limit"),
    deadWindowSeconds: QUEUE_DEAD_WINDOW_SECONDS,
    producerLimit: await setting("outbox_queue_producer_limit"),
    consumerConcurrency: await setting("outbox_queue_consumer_concurrency"),
  };
}

/** يضبطُ مفتاحَ إعدادٍ لهذه المدينةِ وحدَها — الحدُّ لكلِّ مدينةٍ لا عالميٌّ. */
async function setLimit(key: string, value: number): Promise<void> {
  await sql`
    update platform_settings
       set value = to_jsonb(${value}::numeric)
     where city_id = ${cityId}::uuid and key = ${key}
  `;
}

/** يُدرِجُ صفوفاً معلَّقةً في الصادرِ مباشرةً — الحِمْلُ هو موضوعُ القياسِ. */
async function seedPending(count: number, dueSecondsAgo = 1): Promise<void> {
  // **تصحيحٌ مُضافٌ — `F6-07` (2026-09-09):** كانَ ههنا `no_driver_found` وكانَ
  // مُوصَفاً «صنفاً حرجاً غيرَ قابلٍ للتأجيلِ»، وقد صارَ بسجلِّ الأولويّاتِ
  // (القسمُ ١٥) **متوسّطاً قابلاً للتأجيلِ** — خبرُ نتيجةٍ لا فعلٌ يُنتظَرُ. فبُدِّلَ
  // إلى `negotiation_turn_opened` (حرجٌ: دورُ مطالبةٍ له مؤقّتٌ يجري)، إذ المرادُ
  // ههنا حِمْلٌ **لا يمسُّه** مطلِّبُ التأجيلِ كي يُقاسَ الحكمُ على حِمْلٍ خالصٍ.
  // ولو بقيَ النوعُ الأوّلُ لأُجِّلَ الحِمْلُ نفسُه فقاسَ الاختبارُ غيرَ ما يدَّعي.
  await sql`
    insert into notification_outbox (city_id, kind, status, payload, next_attempt_at, dedup_key)
    select ${cityId}::uuid, 'negotiation_turn_opened', 'pending', '{}'::jsonb,
           now() - make_interval(secs => ${dueSecondsAgo}::numeric),
           'bp-load:' || gen_random_uuid()::text
      from generate_series(1, ${count}::int)
  `;
}

/** حملةٌ حقيقيّةٌ ومستقبِلوها — قيدُ الشكلِ يوجبُ حملةً ومستقبِلاً ومحادثةً ولغةً. */
async function seedBroadcast(recipients: number): Promise<string> {
  const campaign = await sql<{ id: string }[]>`
    insert into broadcast_campaigns
      (city_id, batch_id, audience, body, recipients_total, created_by_user_id)
    values (${cityId}::uuid, gen_random_uuid(), 'riders', 'رسالةُ قياسٍ',
            ${recipients}::int, ${adminUserId}::uuid)
    returning id
  `;
  const campaignId = campaign[0]?.id ?? "";
  if (campaignId === "") throw new Error("تعذّر تجهيز الحملة");

  const users = recipientUserIds.slice(0, recipients);
  await sql`
    insert into notification_outbox (
      city_id, kind, status, broadcast_campaign_id, recipient_user_id,
      chat_id, language_code, next_attempt_at, dedup_key, payload
    )
    select ${cityId}::uuid, 'broadcast_recipient', 'pending', ${campaignId}::uuid,
           u::uuid, 9000000 + ordinality, 'ar', now(),
           'broadcast:' || ${campaignId}::text || ':' || u,
           '{}'::jsonb
      from unnest(${users}::text[]) with ordinality as t(u, ordinality)
  `;
  return campaignId;
}

async function loadOf(): Promise<QueueLoad> {
  const rows = await sql<{ result: Record<string, unknown> }[]>`
    select notification_outbox_load(${cityId}::uuid, ${QUEUE_DEAD_WINDOW_SECONDS}::int) as result
  `;
  const raw = rows[0]?.result ?? {};
  return {
    depth: Number(raw.depth ?? 0),
    oldestDueAgeSeconds: Number(raw.oldest_due_age_seconds ?? 0),
    deadInWindow: Number(raw.dead_in_window ?? 0),
    claimed: Number(raw.claimed ?? 0),
  };
}

async function verdictOf(): Promise<{
  saturated: boolean;
  reasons: string[];
  consumerAtCapacity: boolean;
}> {
  const rows = await sql<{ result: Record<string, unknown> }[]>`
    select notification_outbox_backpressure(${cityId}::uuid, ${QUEUE_DEAD_WINDOW_SECONDS}::int)
             as result
  `;
  const raw = rows[0]?.result ?? {};
  return {
    saturated: raw.saturated === true,
    reasons: (raw.reasons as string[] | undefined) ?? [],
    consumerAtCapacity: raw.consumer_at_capacity === true,
  };
}

describeIf("الضغطُ العكسيُّ لكلِّ طابورٍ على PostgreSQL فعلية (F6-06)", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const city = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    cityId = city[0]?.id ?? "";
    if (cityId === "") throw new Error("مدينة جدة غير مبذورة");

    const admin = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, role, language_code)
      values (${cityId}::uuid, ${TELEGRAM_BASE}::bigint, 'مشرفُ الضغطِ',
              ${`+9665${TELEGRAM_BASE}`}, 'admin'::user_role, 'ar')
      on conflict (telegram_id) do update set full_name = excluded.full_name
      returning id
    `;
    adminUserId = admin[0]?.id ?? "";

    recipientUserIds = [];
    for (let index = 1; index <= 5; index += 1) {
      const telegramId = TELEGRAM_BASE + index;
      const user = await sql<{ id: string }[]>`
        insert into users (city_id, telegram_id, full_name, phone, role, language_code)
        values (${cityId}::uuid, ${telegramId}::bigint, 'مستقبِلُ الضغطِ',
                ${`+9665${telegramId}`}, 'rider'::user_role, 'ar')
        on conflict (telegram_id) do update set full_name = excluded.full_name
        returning id
      `;
      recipientUserIds.push(user[0]?.id ?? "");
    }

    const seeded = await sql<{ key: string; value: number }[]>`
      select key, (value #>> '{}')::numeric as value
        from platform_settings
       where city_id = ${cityId}::uuid and key like 'outbox_queue_%'
    `;
    seededLimits = Object.fromEntries(seeded.map((row) => [row.key, Number(row.value)]));
    for (const key of OUTBOX_LIMIT_KEYS) {
      if (seededLimits[key] === undefined) throw new Error(`مفتاحٌ غيرُ مبذورٍ: ${key}`);
    }
  });

  afterAll(async () => {
    await sql`delete from notification_outbox where city_id = ${cityId}::uuid`;
    await sql`delete from broadcast_campaigns where created_by_user_id = ${adminUserId}::uuid`;
    await sql`delete from queue_backpressure_events where city_id = ${cityId}::uuid`;
    await sql`
      delete from users
       where telegram_id between ${TELEGRAM_BASE}::bigint and ${TELEGRAM_BASE + 99}::bigint
    `;
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`delete from notification_outbox where city_id = ${cityId}::uuid`;
    await sql`delete from broadcast_campaigns where created_by_user_id = ${adminUserId}::uuid`;
    await sql`delete from queue_backpressure_events where city_id = ${cityId}::uuid`;
    // استعادةُ الحدودِ المبذورةِ: حالةٌ تترُكُ حدّاً مُعدَّلاً تُسمِّمُ ما بعدَها.
    for (const key of OUTBOX_LIMIT_KEYS) {
      await setLimit(key, seededLimits[key] as number);
    }
  });

  it("المفاتيحُ الستّةُ مبذورةٌ لهذه المدينةِ — لا رقمَ مُثبَّتٌ في شيفرةٍ", async () => {
    // القاعدةُ ٠.٣: كلُّ سياسةٍ قابلةٍ للتغييرِ في `platform_settings`.
    const read = await limits();
    expect(read.depthLimit).toBeGreaterThan(0);
    expect(read.oldestAgeLimitSeconds).toBeGreaterThan(0);
    expect(read.deadLimit).toBeGreaterThan(0);
    expect(read.producerLimit).toBeGreaterThan(0);
    expect(read.consumerConcurrency).toBeGreaterThan(0);
  });

  it("حكمُ القاعدةِ وحكمُ الشيفرةِ متطابقانِ على الحِمْلِ نفسِه — في السَّعَةِ", async () => {
    await seedPending(3);
    const inTs = evaluateQueueBackpressure(await loadOf(), await limits());
    const inSql = await verdictOf();

    expect(inSql.saturated).toBe(inTs.saturated);
    expect(inSql.reasons).toEqual([...inTs.reasons]);
    expect(inSql.consumerAtCapacity).toBe(inTs.consumerAtCapacity);
    expect(inSql.saturated).toBe(false);
  });

  it("حكمُ القاعدةِ وحكمُ الشيفرةِ متطابقانِ — عندَ خرقِ العمقِ", async () => {
    await setLimit("outbox_queue_depth_limit", 3);
    await seedPending(5);

    const inTs = evaluateQueueBackpressure(await loadOf(), await limits());
    const inSql = await verdictOf();

    expect(inSql.saturated).toBe(true);
    expect(inSql.saturated).toBe(inTs.saturated);
    expect(inSql.reasons).toEqual([...inTs.reasons]);
    expect(inSql.reasons).toContain("DEPTH");
  });

  it("حكمُ القاعدةِ وحكمُ الشيفرةِ متطابقانِ — عندَ خرقِ عمرِ الأقدمِ", async () => {
    await setLimit("outbox_queue_oldest_age_limit_seconds", 5);
    await seedPending(1, 600);

    const inTs = evaluateQueueBackpressure(await loadOf(), await limits());
    const inSql = await verdictOf();

    expect(inSql.reasons).toEqual([...inTs.reasons]);
    expect(inSql.reasons).toContain("OLDEST_AGE");
  });

  it("حكمُ القاعدةِ وحكمُ الشيفرةِ متطابقانِ — عندَ خرقِ الموتى في النافذةِ", async () => {
    await setLimit("outbox_queue_dead_limit", 2);
    await sql`
      insert into notification_outbox
        (city_id, kind, status, payload, dead_reason, died_at, dedup_key)
      select ${cityId}::uuid, 'negotiation_turn_opened', 'dead', '{}'::jsonb,
             'MAX_ATTEMPTS', now() - interval '1 minute',
             'bp-dead:' || gen_random_uuid()::text
        from generate_series(1, 3)
    `;

    const inTs = evaluateQueueBackpressure(await loadOf(), await limits());
    const inSql = await verdictOf();

    expect(inSql.reasons).toEqual([...inTs.reasons]);
    expect(inSql.reasons).toContain("DEAD_LETTER");
  });

  it("موتى خارجَ النافذةِ لا يُشبِعونَ الطابورَ — النافذةُ لها معنىً", async () => {
    await setLimit("outbox_queue_dead_limit", 2);
    await sql`
      insert into notification_outbox
        (city_id, kind, status, payload, dead_reason, died_at, dedup_key)
      select ${cityId}::uuid, 'negotiation_turn_opened', 'dead', '{}'::jsonb,
             'MAX_ATTEMPTS',
             now() - make_interval(secs => ${QUEUE_DEAD_WINDOW_SECONDS + 600}::numeric),
             'bp-old-dead:' || gen_random_uuid()::text
        from generate_series(1, 10)
    `;

    const load = await loadOf();
    expect(load.deadInWindow).toBe(0);
    expect((await verdictOf()).reasons).not.toContain("DEAD_LETTER");
  });

  it("الحرجُ يُقبَلُ ولو أُشبِعَ الطابورُ — لا تأجيلَ لإسنادِ رحلةٍ", async () => {
    await setLimit("outbox_queue_depth_limit", 2);
    await seedPending(5);
    expect((await verdictOf()).saturated).toBe(true);

    const before = await sql<{ n: number }[]>`
      select count(*)::int as n from notification_outbox
       where city_id = ${cityId}::uuid and kind = 'negotiation_turn_opened' and status = 'pending'
    `;
    await sql`
      insert into notification_outbox
        (city_id, kind, status, payload, next_attempt_at, dedup_key)
      values (${cityId}::uuid, 'negotiation_turn_opened', 'pending', '{}'::jsonb, now(),
              'bp-critical:' || gen_random_uuid()::text)
    `;
    const after = await sql<{ n: number; deferred: number }[]>`
      select count(*)::int as n,
             count(*) filter (where next_attempt_at > now() + interval '5 seconds')::int as deferred
        from notification_outbox
       where city_id = ${cityId}::uuid and kind = 'negotiation_turn_opened' and status = 'pending'
    `;
    expect(after[0]?.n).toBe((before[0]?.n ?? 0) + 1);
    // ولم يُؤجَّلْ صفٌّ حرجٌ واحدٌ: المطلِّبُ لا يمسُّ ما لا يقبلُ التأجيلَ.
    expect(after[0]?.deferred).toBe(0);
  });

  it("البثُّ القابلُ للتأجيلِ يُؤجَّلُ **وحدةً واحدةً** عندَ الإشباعِ", async () => {
    await setLimit("outbox_queue_depth_limit", 2);
    await seedPending(5);
    expect((await verdictOf()).saturated).toBe(true);

    // إدراجٌ مجموعيٌّ كما يفعلُ `create_broadcast`: كلُّ المستقبِلينَ في عبارةٍ واحدةٍ.
    await seedBroadcast(5);

    const rows = await sql<{ total: number; deferred: number; distinct_due: number }[]>`
      select count(*)::int                                                as total,
             count(*) filter (where next_attempt_at > now())::int         as deferred,
             count(distinct next_attempt_at)::int                         as distinct_due
        from notification_outbox
       where city_id = ${cityId}::uuid and kind = 'broadcast_recipient'
    `;
    expect(rows[0]?.total).toBe(5);
    // كلُّ المستقبِلينَ أُجِّلوا: حملةٌ نصفُها مؤجَّلٌ ونصفُها ماضٍ حملةٌ ممزَّقةٌ.
    expect(rows[0]?.deferred).toBe(5);
    // وبموعدٍ واحدٍ: الحكمُ حُفِظَ للمعاملةِ فلم يُقرَأ الحِمْلُ مئتي مرّةٍ.
    expect(rows[0]?.distinct_due).toBe(1);
  });

  it("البثُّ في السَّعَةِ يمرُّ بلا تأجيلٍ — المطلِّبُ ليسَ ضريبةً دائمةً", async () => {
    await seedBroadcast(5);
    const rows = await sql<{ deferred: number }[]>`
      select count(*) filter (where next_attempt_at > now() + interval '5 seconds')::int as deferred
        from notification_outbox
       where city_id = ${cityId}::uuid and kind = 'broadcast_recipient'
    `;
    expect(rows[0]?.deferred).toBe(0);
  });

  it("التأجيلُ يُسجَّلُ أثراً مُلخَّصاً بالدقيقةِ لا صفّاً لكلِّ مستقبِلٍ", async () => {
    await setLimit("outbox_queue_depth_limit", 2);
    await seedPending(5);
    await seedBroadcast(5);

    const events = await sql<{ n: number; occurrences: number; reason: string }[]>`
      select count(*)::int as n, max(occurrences)::int as occurrences, min(reason) as reason
        from queue_backpressure_events
       where city_id = ${cityId}::uuid and queue = 'notification_outbox'
    `;
    expect(events[0]?.n).toBe(1);
    expect(events[0]?.reason).toBe("DEPTH");
  });

  it("سقفُ تزامنِ المستهلِكِ يمنعُ الالتقاطَ ويُعلِنُ سببَه", async () => {
    await setLimit("outbox_queue_consumer_concurrency", 1);
    await seedPending(3);
    // صفٌّ محجوزٌ الآنَ = مستهلِكٌ واحدٌ مشغولٌ، والسقفُ واحدٌ.
    await sql`
      update notification_outbox
         set status = 'sending', claim_token = gen_random_uuid(), claimed_at = now()
       where city_id = ${cityId}::uuid and status = 'pending'
         and id = (select id from notification_outbox
                    where city_id = ${cityId}::uuid and status = 'pending' limit 1)
    `;

    const rows = await sql<{ result: Record<string, unknown> }[]>`
      select claim_notification_delivery() as result
    `;
    const envelope = rows[0]?.result ?? {};
    expect(envelope.ok).toBe(true);
    expect(envelope.delivery).toBeNull();
    expect(envelope.backpressure).toBe("CONSUMER_CONCURRENCY");
  });

  it("دونَ السقفِ: الالتقاطُ يقعُ ويحملُ سعةَ الشوطِ لا سقفَ المحاولاتِ", async () => {
    await setLimit("outbox_queue_consumer_concurrency", 4);
    await seedPending(2);

    const rows = await sql<{ result: Record<string, unknown> }[]>`
      select claim_notification_delivery() as result
    `;
    const envelope = rows[0]?.result ?? {};
    const delivery = envelope.delivery as Record<string, unknown> | null;
    expect(delivery).not.toBeNull();
    expect(Number(delivery?.batch_limit)).toBe(4);
  });

  it("حدُّ منتِجِ طابورِ تيليجرام يردُّ **قبلَ** استهلاكِ رقمِ التحديثِ", async () => {
    const updateId = 9_710_001;
    await sql`delete from telegram_update_receipts where update_id = ${updateId}`;

    // حدٌّ قدرُه واحدٌ مع وظيفةٍ معلَّقةٍ واحدةٍ على الأقلِّ ⇒ الطابورُ بالغٌ حدَّه.
    await sql`
      insert into telegram_update_receipts (bot, update_id, status, attempts, first_seen_at)
      values ('driver', ${updateId - 1}::bigint, 'pending', 0, now())
      on conflict (bot, update_id) do nothing
    `;
    await sql`
      insert into telegram_update_jobs (bot, update_id, payload, status, attempts)
      values ('driver', ${updateId - 1}::bigint, '{"update_id": 1}'::jsonb, 'pending', 0)
      on conflict (bot, update_id) do nothing
    `;

    const shed = await sql<{ result: Record<string, unknown> }[]>`
      select claim_and_enqueue_telegram_update(
        'driver', ${updateId}::bigint, '{"update_id": 2}'::jsonb, 30, 1
      ) as result
    `;
    expect(shed[0]?.result?.outcome).toBe("shed");

    // ورقمُ التحديثِ لم يُوسَمْ: إعادةُ إرسالِ تيليجرام بعدَ 429 **تُقبَلُ**.
    const receipts = await sql<{ n: number }[]>`
      select count(*)::int as n from telegram_update_receipts
       where bot = 'driver' and update_id = ${updateId}::bigint
    `;
    expect(receipts[0]?.n).toBe(0);

    const admitted = await sql<{ result: Record<string, unknown> }[]>`
      select claim_and_enqueue_telegram_update(
        'driver', ${updateId}::bigint, '{"update_id": 2}'::jsonb, 30, 10000
      ) as result
    `;
    expect(admitted[0]?.result?.outcome).toBe("enqueued");

    await sql`delete from telegram_update_receipts where update_id in (${updateId}, ${updateId - 1})`;
  });
});
