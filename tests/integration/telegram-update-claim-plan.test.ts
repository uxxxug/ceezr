/**
 * الغرض: LOAD-01 (فجوةُ السعةِ 2026-10-24، الدورةُ الثانية) — انحدارُ خطةِ فهرسِ
 *   التقاطِ وظائفِ تحديثِ تيليجرام بعدَ الهجرةِ `20261024140000`.
 *
 * ## السبب الجذري (مثبتٌ بخطةٍ مقيسةٍ)
 *
 * تعبيرُ الأولويةِ في `20261024120000` (المُدمَجُ عبرَ #645) كسرَ خطةَ فهرسِ الالتقاطِ:
 * عقدةُ `Sort` كاملةٌ فوقَ مجموعةِ المعلَّقِ (ذروةُ m5-1500 ≈ 1,700 صفٍّ) معَ تقييمٍ
 * غيرِ كسولٍ لتعبيرِ jsonb لكلِّ صفٍّ — فصارَ الالتقاطُ الدُّفعيُّ 10.13ms/نداءً بعدَ
 * <4.7ms، وارتفعَ انتظارُ الطابورِ p50 من 18.26ث إلى 23.16ث فوقَ مهلةِ إثباتِ الهاتفِ
 * (20ث)، وانكسرَ التنبؤُ المُسجَّلُ (G1 هبطتْ من 63.14% إلى 40.25% — موجةُ 40082574451).
 *
 * ## الإصلاحُ المُختَبَرُ هنا
 *
 * تجزئةُ الترتيبِ المُعلَنِ نفسِهِ إلى ثلاثِ مراحلَ مُفهرسةٍ: (1) المتقادمُ >120ث مسحًّا
 * بحدٍّ علويٍّ على `created_at`، (2) contact الطازجُ عبرَ الفهرسِ الجزئيِّ الجديدِ
 * `telegram_update_jobs_contact_pending_idx`، (3) تعويضٌ FIFO خالصٌ كخطِّ الأساسِ.
 *
 * ## المدّعى في هذا الاختبار
 *
 * (١) خطةُ كلِّ مرحلةٍ منَ الثلاثِ — **بالترميزِ العامِّ المعلمِ** (PREPARE معَ
 *     `plan_cache_mode = force_generic_plan` ثمّ EXPLAIN EXECUTE، كما في درسِ
 *     انحدارِ صندوقِ الصادرِ: الفهرسُ الجزئيُّ قد يسقطُ منَ الخطةِ العامةِ) — لا
 *     تفحصُ الجدولَ تسلسليًّا ولا تُنشئُ عقدةَ `Sort` كاملةً (Incremental Sort
 *     مقبولٌ: مسحٌ مرتَّبٌ بفهرسٍ معَ ربطِ الحسمِ فقط).
 * (٢) مرحلةُ contact تستخدمُ الفهرسَ الجزئيَّ `telegram_update_jobs_contact_pending_idx`
 *     تحديدًا (محمولُهُ حرفيٌّ كاملٌ فتنجو منَ الخطةِ العامةِ).
 * (٣) التكافؤُ الدلاليُّ: دفعةُ الدالةِ الفعليةِ على تراكمٍ مزروعٍ (70% contact،
 *     أعمارٌ 1–200ث) تطابقُ حرفيًّا ترتيبَ الاستعلامِ المُوحَّدِ القديمِ (تعبيرُ
 *     #645) — فالتجزئةُ لم تُغيّرِ الدلالةَ.
 * (٤) التقاطٌ فعليٌّ مقيدُ الزمنِ تحتَ التراكمِ (وسيطُ العيناتِ الدافئةِ لا أدناها).
 *
 * الحالة: اختبار تكاملٍ — يتطلب TEST_DATABASE_URL (قاعدة بها الهجراتُ مطبَّقةً
 *   بما فيها `20261024140000_load01_contact_first_indexed_claim.sql`).
 * ينتمي إلى: tests/integration
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const URL = process.env.TEST_DATABASE_URL;
const d = URL === undefined ? describe.skip : describe;
let sql: Sql;

const BASE = 9_700_000 + (Date.now() % 1_000) * 2_000;
const N = 1_700; // ذروةُ طابورِ m5-1500 المُقاسةِ
const CONTACT_SHARE = 7; // من كلِّ 10: 7 contact و3 رسائل

/** قيدُ D4 كما في نصِّ الدوالِّ — يُنسخُ حرفيًّا كي يختبرَ الخطةَ الفعليةَ لا نسخةً مبسطةً. */
const D4 = `(j.lane_key is null or not exists (
  select 1 from telegram_update_jobs e
   where e.lane_key = j.lane_key
     and e.status in ('pending', 'claimed') and e.attempts < 5
     and (e.created_at, e.update_id) < (j.created_at, j.update_id)))`;

/** نصوصُ مراحلِ الدالةِ الثلاثِ (الأعمدةُ نفسُها، الشرطُ نفسُه، الترتيبُ نفسُه). */
const PHASE_AGED = `select j.bot, j.update_id from telegram_update_jobs j
 where j.status = 'pending' and j.attempts < 5 and j.next_attempt_at <= now() and j.bot = $1
   and j.created_at < now() - interval '120 seconds'
   and ${D4}
 order by j.created_at, j.update_id
 for update of j skip locked limit 10`;

const PHASE_CONTACTS = `select j.bot, j.update_id from telegram_update_jobs j
 where j.status = 'pending' and j.attempts < 5 and j.next_attempt_at <= now() and j.bot = $1
   and j.created_at >= now() - interval '120 seconds'
   and j.payload #> '{message,contact}' is not null
   and ${D4}
 order by j.created_at, j.update_id
 for update of j skip locked limit 10`;

const PHASE_FILL = `select j.bot, j.update_id from telegram_update_jobs j
 where j.status = 'pending' and j.attempts < 5 and j.next_attempt_at <= now() and j.bot = $1
   and ${D4}
 order by j.created_at, j.update_id
 for update of j skip locked limit 10`;

/** الترتيبُ المُوحَّدُ القديمُ (تعبيرُ #645) — مرجعُ التكافؤِ الدلاليِّ. */
const UNIFIED_ORDER = `update_id from telegram_update_jobs
 where bot = 'driver' and status = 'pending' and attempts < 5 and next_attempt_at <= now()
 order by ((payload #> '{message,contact}') is not null
           or created_at < now() - interval '120 seconds') desc, created_at, update_id
 limit 10`;

/**
 * حدٌّ معلنٌ مسبقًا على **وسيطِ** العيناتِ الدافئةِ: الانكسارُ المُقاسُ (عقدةُ Sort
 * الكاملةُ) ظهرَ في الموجةِ 10.13ms/نداءً على مقعدٍ متنازسٍ؛ محليًّا هادئًا لا يظهرُ
 * (الدرسُ الموثَّقُ: القياسُ الهادئُ لا يكشفُ انحدارَ الخطةِ) — لذا فالحارسُ الأساسيُّ
 * هوَ تأكيداتُ الخطةِ أعلاه، وهذا الحدُّ صمّامُ رصدٍ متساهلٌ عمدًا (50ms كنظيرِهِ في
 * انحدارِ صندوقِ الصادرِ) يثبتِ العلاقةَ لا زمنًا مطلقًا.
 */
const CLAIM_LATENCY_CEILING_MS = 50;

/** فحصُ خطةٍ نصيةً: لا فحصٌ تسلسليٌّ، ولا عقدةُ Sort كاملةٌ (Incremental Sort حلال). */
function assertIndexBackedPlan(name: string, planText: string) {
  expect(planText).not.toContain("Seq Scan");
  const plainSort = planText.split("\n").some((line) => /^\s*(->\s+)?Sort\s*$/.test(line));
  expect(plainSort).toBe(false); // عقدةُ Sort كاملةٌ = الانكسارُ المُقاسُ في الموجةِ
  expect(planText).toContain("Index Scan");
  void name;
}

d("خطةُ التقاطِ تيليجرام المُفهرسةِ — ثلاثُ مراحلَ بلا Sort كاملٍ", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: URL ?? "" });
    // بذرُ التراكمِ: 1,700 معلقًا (70% contact)، أعمارٌ متدرجةٌ 1–200ث، مستخدمونَ
    // مميزونَ (لا حجبَ D4) — يُمحى كلهُ بعدَ الاختبارِ.
    await sql`insert into telegram_update_receipts (bot, update_id)
      select 'driver', ${BASE}::bigint + g from generate_series(0, ${N - 1}) g`;
    await sql`insert into telegram_update_jobs (bot, update_id, payload, created_at)
      select 'driver', ${BASE}::bigint + g,
        case when g % 10 < ${CONTACT_SHARE}
          then jsonb_build_object('update_id', ${BASE}::bigint + g, 'message',
            jsonb_build_object('from', jsonb_build_object('id', 97_000_000 + g),
              'chat', jsonb_build_object('id', 97_000_000 + g),
              'contact', jsonb_build_object('phone_number', '+966', 'first_name', 'd', 'user_id', 97_000_000 + g)))
          else jsonb_build_object('update_id', ${BASE}::bigint + g, 'message',
            jsonb_build_object('from', jsonb_build_object('id', 97_000_000 + g),
              'chat', jsonb_build_object('id', 97_000_000 + g), 'text', 'hello'))
        end,
        now() - make_interval(secs => 1 + (g % 200))
      from generate_series(0, ${N - 1}) g`;
    await sql`analyze telegram_update_jobs`;
  });

  afterAll(async () => {
    await sql`delete from telegram_update_jobs where bot = 'driver' and update_id between ${BASE} and ${BASE + N - 1}`;
    await sql`delete from telegram_update_receipts where bot = 'driver' and update_id between ${BASE} and ${BASE + N - 1}`;
    await sql.end({ timeout: 2 });
  });

  it("المراحلُ الثلاثُ مفهرسةٌ في الخطةِ العامةِ المعلمةِ (لا Seq Scan ولا Sort كاملٌ)", async () => {
    for (const [name, phaseSql] of [
      ["المرحلةُ 1: المتقادمُ >120ث", PHASE_AGED],
      ["المرحلةُ 2: contact الطازجُ", PHASE_CONTACTS],
      ["المرحلةُ 3: تعويضُ FIFO", PHASE_FILL],
    ] as const) {
      // خطةٌ خاصةٌ أولًا (EXPLAIN مباشر)
      const custom = await sql<
        { "QUERY PLAN": string }[]
      >`explain (costs off) ${sql.unsafe(phaseSql.replace(/\$1/g, "'driver'"))}`;
      assertIndexBackedPlan(name, custom.map((r) => r["QUERY PLAN"]).join("\n"));
      // ثمّ الخطةُ العامةُ المعلمةُ (درسُ صندوقِ الصادرِ: الفهرسُ الجزئيُّ قد يسقطُ منها)
      const prepared = `tg_plan_${name.length}`;
      await sql.unsafe(`set plan_cache_mode = force_generic_plan`);
      await sql.unsafe(`prepare ${prepared}(text) as ${phaseSql}`);
      await sql.unsafe(`execute ${prepared}('driver')`);
      await sql.unsafe(`execute ${prepared}('driver')`);
      const generic = await sql<
        { "QUERY PLAN": string }[]
      >`explain (costs off) ${sql.unsafe(`execute ${prepared}('driver')`)}`;
      assertIndexBackedPlan(name, generic.map((r) => r["QUERY PLAN"]).join("\n"));
      await sql.unsafe(`deallocate ${prepared}`);
    }
  });

  it("مرحلةُ contact تستخدمُ الفهرسَ الجزئيَّ الجديدَ في الخاصتينِ معًا", async () => {
    const custom = await sql<
      { "QUERY PLAN": string }[]
    >`explain (costs off) ${sql.unsafe(PHASE_CONTACTS.replace(/\$1/g, "'driver'"))}`;
    expect(custom.map((r) => r["QUERY PLAN"]).join("\n")).toContain(
      "telegram_update_jobs_contact_pending_idx",
    );
    const prepared = "tg_plan_contact_idx";
    await sql.unsafe(`set plan_cache_mode = force_generic_plan`);
    await sql.unsafe(`prepare ${prepared}(text) as ${PHASE_CONTACTS}`);
    await sql.unsafe(`execute ${prepared}('driver')`);
    await sql.unsafe(`execute ${prepared}('driver')`);
    const generic = await sql<
      { "QUERY PLAN": string }[]
    >`explain (costs off) ${sql.unsafe(`execute ${prepared}('driver')`)}`;
    expect(generic.map((r) => r["QUERY PLAN"]).join("\n")).toContain(
      "telegram_update_jobs_contact_pending_idx",
    );
    await sql.unsafe(`deallocate ${prepared}`);
  });

  it("تكافؤٌ دلاليٌّ: دفعةُ الدالةِ تطابقُ الترتيبَ الموحدَ القديمَ حرفيًّا", async () => {
    // المتوقعُ: أعلى 10 بحسبِ التعبيرِ الموحدِ (تعبيرُ #645) قبلَ أيِّ التقاطٍ.
    const expected = await sql<{ update_id: string }[]>`select ${sql.unsafe(UNIFIED_ORDER)}`;
    const expectedIds = expected.map((r) => Number(r.update_id));

    const [row] = await sql<{ r: { ok: boolean; jobs: { update_id: string }[] } }[]>`
      select claim_telegram_update_jobs_for_bot(30, 5, 'driver', 10) as r`;
    const claimedIds = (row?.r.jobs ?? []).map((j) => Number(j.update_id));

    expect(claimedIds.length).toBe(10);
    expect(claimedIds).toEqual(expectedIds);
  });

  it("التقاطٌ فعليٌّ مقيدُ الزمنِ تحتَ التراكمِ (وسيطُ الدافئةِ)", async () => {
    // عيناتٌ دافئةٌ: استنزافُ بقيةِ التراكمِ بدفعاتٍ متتاليةٍ وقياسُ زمنِ كلِّ نداءٍ.
    const samples: number[] = [];
    for (let i = 0; i < 15; i += 1) {
      const t0 = performance.now();
      await sql`select claim_telegram_update_jobs_for_bot(30, 5, 'driver', 10)`;
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];
    expect(median).toBeLessThan(CLAIM_LATENCY_CEILING_MS);
  });
});
