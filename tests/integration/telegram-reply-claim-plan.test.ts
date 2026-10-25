/**
 * الغرض: LOAD-01 — انحدارُ خطةِ `claim_telegram_update_replies` بعدَ فهرسَي
 *   `20261025160000_load01_reply_claim_lane_index.sql` و`20261025160100_load01_reply_claim_created_index.sql`.
 *
 * ## السياق
 *
 * في موجةِ LOAD-01-C1 (التشغيلُ 40160348095) بلغتِ الدالةُ 88.8–177.7ms/نداءً وسطيًّا داخلَ
 * PostgreSQL (أقصاها 2,517ms)، واحتجزتْ مقعدَ `gatewayRequest` نحوَ 782ms وسطيًّا. السببُ:
 * قيدُ ترتيبِ المسارِ (`not exists` على `lane_key` معَ محمولِ `reply_status`) لا يجدُ فهرسًا
 * مطابقًا فيُمسحُ الجدولُ لكلِّ مرشَّح. محليًّا على 16,000 وظيفةٍ (5,000 ردٍّ مفتوح): 2,540ms
 * و810,860 صفحةً قبلَ الفهرسين، و~2–3ms بعدَهما.
 *
 * ## المدّعى في هذا الاختبار
 *
 * (١) الاستعلامُ الداخليُّ للدالةِ — بالخطةِ العامةِ المعلمة (PREPARE معَ
 *     `plan_cache_mode = force_generic_plan`) — لا يفحصُ الجدولَ تسلسليًّا، ويستعملُ
 *     الفهرسينِ الجديدينِ بالاسم.
 * (٢) التكافؤُ الدلاليُّ: الدفعةُ الملتقطةُ رأسُ كلِّ مسارٍ وحدَهُ (لا ردَّ يُلتقطُ ولمسارِه
 *     ردٌّ مفتوحٌ أقدم)، وبترتيبِ الإنشاء.
 * (٣) عددُ الصفحاتِ المقروءةِ للنداءِ الواحدِ محدودٌ (يثبتُ العلاقةَ لا زمنًا مطلقًا).
 *
 * الحالة: اختبارُ تكامل — يتطلّب TEST_DATABASE_URL (قاعدةٌ بها الهجراتُ مطبَّقةً بما فيها
 *   `20261025160100_load01_reply_claim_created_index.sql`).
 * ينتمي إلى: tests/integration
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const URL = process.env.TEST_DATABASE_URL;
const d = URL === undefined ? describe.skip : describe;
let sql: Sql;

const BASE = 9_900_000 + (Date.now() % 1_000) * 20_000;
const N_DONE = 11_000;
const N_OPEN = 5_000;
const N = N_DONE + N_OPEN;
const USERS = 3_000; // كلُّ مستخدمٍ له عدّةُ ردودٍ مفتوحةٍ فيُختبرُ قيدُ المسار
const USER_BASE = 880_000_000;

/** الاستعلامُ الداخليُّ للدالةِ حرفيًّا (دونَ `for update` كي يُفحصَ بلا قفل). */
const DUE = `select j.bot, j.update_id
  from telegram_update_jobs j
 where (
         (j.reply_status = 'pending' and j.reply_next_attempt_at <= now())
      or (j.reply_status = 'sending' and j.reply_claimed_at < now() - make_interval(secs => $1::integer))
       )
   and (j.lane_key is null or not exists (
         select 1 from telegram_update_jobs e
          where e.lane_key = j.lane_key
            and e.reply_status in ('pending', 'sending')
            and (e.created_at, e.update_id) < (j.created_at, j.update_id)))
 order by j.created_at
 limit $2::integer`;

/** حدٌّ متساهلٌ عمدًا: قبلَ الفهرسينِ 810,860 صفحةً للنداءِ محليًّا، وبعدَهما ~800. */
const BUFFER_CEILING = 20_000;

d("خطةُ التقاطِ الردودِ المؤجَّلةِ — فهرسُ المسارِ وفهرسُ الترتيب", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: URL ?? "" });
    await sql`insert into telegram_update_receipts (bot, update_id, status, completed_at)
      select 'driver', ${BASE}::bigint + g, 'done', now() from generate_series(0, ${N - 1}) g`;
    // أعمارٌ في الماضي البعيدِ كي تكونَ هذه الصفوفُ أقدمَ المفتوحِ في القاعدةِ كلِّها.
    await sql`insert into telegram_update_jobs
        (bot, update_id, payload, status, completed_at, created_at, replies, reply_status, reply_next_attempt_at)
      select 'driver', ${BASE}::bigint + g,
        jsonb_build_object('message', jsonb_build_object(
          'from', jsonb_build_object('id', ${USER_BASE}::bigint + (g % ${USERS})),
          'chat', jsonb_build_object('id', ${USER_BASE}::bigint + (g % ${USERS})))),
        'done', now(),
        timestamptz '2001-01-01' + make_interval(secs => g / 100.0),
        '[{"text":"x"}]'::jsonb,
        case when g >= ${N_DONE} then 'pending' else 'done' end,
        now() - interval '1 second'
      from generate_series(0, ${N - 1}) g`;
    await sql`analyze telegram_update_jobs`;
  });

  afterAll(async () => {
    await sql`delete from telegram_update_jobs where bot = 'driver' and update_id between ${BASE} and ${BASE + N}`;
    await sql`delete from telegram_update_receipts where bot = 'driver' and update_id between ${BASE} and ${BASE + N}`;
    await sql.end();
  });

  it("الخطةُ العامةُ بلا فحصٍ تسلسليٍّ وتستعملُ الفهرسينِ الجديدينِ", async () => {
    await sql.begin(async (tx) => {
      await tx.unsafe("set local plan_cache_mode = force_generic_plan");
      await tx.unsafe(`prepare reply_due_probe(integer, integer) as ${DUE}`);
      const rows = await tx.unsafe<{ "QUERY PLAN": string }[]>("explain execute reply_due_probe(60, 20)");
      const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
      await tx.unsafe("deallocate reply_due_probe");
      expect(plan).not.toContain("Seq Scan");
      expect(plan).toContain("telegram_update_jobs_reply_lane_open_idx");
      expect(plan).toContain("telegram_update_jobs_reply_open_created_idx");
    });
  });

  it("الدفعةُ رؤوسُ مساراتٍ مميّزةٌ بترتيبِ الإنشاءِ (الدلالةُ لم تتغيّر)", async () => {
    const res = await sql<{ r: { ok: boolean; jobs: { update_id: number }[] } }[]>`
      select claim_telegram_update_replies(20, 60) as r`;
    const r = res[0]?.r;
    expect(r?.ok).toBe(true);
    const ids = (r?.jobs ?? []).map((j) => Number(j.update_id)).sort((a, b) => a - b);
    expect(ids).toHaveLength(20);
    // أقدمُ 20 ردًّا مفتوحًا هي g = N_DONE..N_DONE+19، ولكلٍّ منها مستخدمٌ مختلف (USERS > 20)،
    // وكلٌّ منها رأسُ مسارِه (ردودُ المستخدمِ نفسِه الأقدمُ مختومةٌ done).
    const expected = Array.from({ length: 20 }, (_, i) => BASE + N_DONE + i);
    expect(ids).toEqual(expected);
    const users = new Set(ids.map((id) => (id - BASE) % USERS));
    expect(users.size).toBe(20);
  });

  it("النداءُ الواحدُ يقرأُ صفحاتٍ محدودةً تحتَ تراكمِ الردود", async () => {
    await sql.begin(async (tx) => {
      const rows = await tx.unsafe<{ "QUERY PLAN": string }[]>(
        "explain (analyze, buffers, format text) select claim_telegram_update_replies(20, 60)",
      );
      const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
      const m = /shared hit=(\d+)(?: read=(\d+))?/.exec(plan);
      const pages = Number(m?.[1] ?? 0) + Number(m?.[2] ?? 0);
      expect(pages).toBeGreaterThan(0);
      expect(pages).toBeLessThan(BUFFER_CEILING);
      throw new RollbackProbe();
    }).catch((e) => {
      if (!(e instanceof RollbackProbe)) throw e;
    });
  });
});

class RollbackProbe extends Error {}
