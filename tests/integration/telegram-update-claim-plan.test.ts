/**
 * الغرض: LOAD-01 — انحدارُ خطةِ فهرسِ التقاطِ وظائفِ تحديثِ تيليجرام بعدَ استعادةِ عدالةِ FIFO
 *   بالهجرةِ `20261025120000_load01_claim_fifo_fairness_restore.sql` (قرارُ المالكِ بعدَ PR #651).
 *
 * ## السياق
 *
 * #645 أضافَ تعبيرَ أولويّةِ contact إلى الترتيبِ فكسرَ خطةَ الفهرس (عقدةُ Sort كاملة)، و#647 جزّأه
 * إلى ثلاثِ مراحلَ مفهرسةٍ معَ فهرسٍ جزئيٍّ لـcontact. وعلى حِملٍ مختلطٍ لم تثبتْ قيمةُ الأولويّةِ
 * وثبتتْ كلفتُها (`docs/evidence/capacity/LOAD01M-MIXED-AB-20261025/RESULT.md`)، فعادَ الترتيبُ FIFO
 * خالصًا (`order by j.created_at`) كما قبلَ #645. هذا الملفُّ يحرسُ أنّ الاستعادةَ لم تُعِدِ الانكسار.
 *
 * ## المدّعى في هذا الاختبار
 *
 * (١) استعلامُ الالتقاطِ FIFO — بالخطةِ الخاصةِ ثمّ **العامّةِ المعلمة** (PREPARE معَ
 *     `plan_cache_mode = force_generic_plan` ثمّ EXPLAIN EXECUTE) — لا يفحصُ الجدولَ تسلسليًّا ولا
 *     يُنشئُ عقدةَ `Sort` كاملة (Incremental Sort مقبول).
 * (٢) لا خطّةَ تعتمدُ الفهرسَ الجزئيَّ `telegram_update_jobs_contact_pending_idx` (فإسقاطُه لاحقًا لا يمسُّ الالتقاط).
 * (٣) التكافؤُ الدلاليّ: دفعةُ الدالةِ الفعليّةِ على تراكمٍ مزروعٍ (70% contact، أعمارٌ 1–100ث كلُّها دونَ
 *     عتبةِ #647، وأقدمُها رسائلُ لا contact) هي أقدمُ الوظائفِ بترتيبِ الإنشاء، بلا قفزٍ بالنوع.
 * (٤) التقاطٌ فعليٌّ مقيدُ الزمنِ تحتَ التراكم (وسيطُ العيّناتِ الدافئة).
 *
 * الحالة: اختبارُ تكامل — يتطلّب TEST_DATABASE_URL (قاعدةٌ بها الهجراتُ مطبَّقةً بما فيها
 *   `20261025120000_load01_claim_fifo_fairness_restore.sql`).
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

/** استعلامُ الالتقاطِ في الدالّةِ الدُّفعيّة (الشرطُ نفسُه والترتيبُ نفسُه: `order by j.created_at`). */
const FIFO_PICK = `select j.bot, j.update_id from telegram_update_jobs j
 where j.status = 'pending' and j.attempts < 5 and j.next_attempt_at <= now() and j.bot = $1
   and ${D4}
 order by j.created_at
 for update of j skip locked limit 10`;

/**
 * حدٌّ معلنٌ مسبقًا على **وسيطِ** العيناتِ الدافئةِ: الانكسارُ المُقاسُ في #645 (عقدةُ Sort
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

d("خطةُ التقاطِ تيليجرام FIFO المُفهرسةِ — بلا Sort كاملٍ ولا أولويّةٍ نوعيّة", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: URL ?? "" });
    // بذرُ التراكمِ: 1,700 معلقًا (70% contact)، أعمارٌ متدرجةٌ 1–100ث، مستخدمونَ
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
        now() - make_interval(secs => 1 + (g % 100))
      from generate_series(0, ${N - 1}) g`;
    await sql`analyze telegram_update_jobs`;
  });

  afterAll(async () => {
    await sql`delete from telegram_update_jobs where bot = 'driver' and update_id between ${BASE} and ${BASE + N - 1}`;
    await sql`delete from telegram_update_receipts where bot = 'driver' and update_id between ${BASE} and ${BASE + N - 1}`;
    await sql.end({ timeout: 2 });
  });

  /** الخطةُ الخاصةُ ثمّ العامةُ المعلمةُ لاستعلامِ الالتقاط. */
  async function plans(tag: string): Promise<string[]> {
    const custom = await sql<
      { "QUERY PLAN": string }[]
    >`explain (costs off) ${sql.unsafe(FIFO_PICK.replace(/\$1/g, "'driver'"))}`;
    const prepared = `tg_fifo_${tag}`;
    await sql.unsafe(`set plan_cache_mode = force_generic_plan`);
    await sql.unsafe(`prepare ${prepared}(text) as ${FIFO_PICK}`);
    await sql.unsafe(`execute ${prepared}('driver')`);
    await sql.unsafe(`execute ${prepared}('driver')`);
    const generic = await sql<
      { "QUERY PLAN": string }[]
    >`explain (costs off) ${sql.unsafe(`execute ${prepared}('driver')`)}`;
    await sql.unsafe(`deallocate ${prepared}`);
    await sql.unsafe(`reset plan_cache_mode`);
    return [custom, generic].map((p) => p.map((r) => r["QUERY PLAN"]).join("\n"));
  }

  it("استعلامُ الالتقاطِ FIFO مفهرسٌ في الخطتينِ الخاصةِ والعامةِ المعلمة (لا Seq Scan ولا Sort كاملٌ)", async () => {
    for (const plan of await plans("idx")) assertIndexBackedPlan("FIFO", plan);
  });

  it("لا خطّةَ تعتمدُ الفهرسَ الجزئيَّ لـcontact", async () => {
    for (const plan of await plans("noc")) {
      expect(plan).not.toContain("telegram_update_jobs_contact_pending_idx");
    }
  });

  it("تكافؤٌ دلاليّ: دفعةُ الدالةِ هي أقدمُ الوظائفِ بترتيبِ الإنشاءِ بلا قفزٍ بالنوع", async () => {
    // الحدُّ: created_at للوظيفةِ العاشرةِ في ترتيبِ الإنشاءِ قبلَ أيِّ التقاط (الأعمارُ المزروعةُ متساويةٌ
    // في مجموعاتٍ، فيُقارَنُ بالحدِّ لا بالمعرّفاتِ حرفيًّا).
    // الأزمنةُ بالميكروثانيةِ عددًا صحيحًا (تجنّبًا لتحويلِ المعاملِ النصّيِّ في العميل).
    const [tenth] = await sql<{ us: string }[]>`
      select (extract(epoch from created_at) * 1000000)::bigint::text as us from telegram_update_jobs
       where bot = 'driver' and status = 'pending' and attempts < 5 and next_attempt_at <= now()
       order by created_at offset 9 limit 1`;
    const [row] = await sql<{ r: { ok: boolean; jobs: { update_id: string }[] } }[]>`
      select claim_telegram_update_jobs_for_bot(30, 5, 'driver', 10) as r`;
    const claimedIds = (row?.r.jobs ?? []).map((j) => Number(j.update_id));
    expect(claimedIds.length).toBe(10);
    const got = await sql<{ us: string }[]>`
      select (extract(epoch from created_at) * 1000000)::bigint::text as us from telegram_update_jobs
       where bot = 'driver' and update_id = any(${claimedIds}::bigint[])`;
    expect(got.length).toBe(10);
    const limit = BigInt(tenth?.us ?? "0");
    expect(got.filter((g) => BigInt(g.us) > limit)).toEqual([]);
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
