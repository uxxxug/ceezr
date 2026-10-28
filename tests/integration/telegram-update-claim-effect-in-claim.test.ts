/**
 * الغرض: LOAD-01 · C1 (2026-10-25) — البرهانُ الحيُّ على هجرةِ `20261025140000` (ضمِّ فحصِ
 *   الأثرِ إلى الالتقاط) على PostgreSQL حقيقيّ: دوالُّ الالتقاطِ الثلاثُ تُعيدُ `effect_recorded`
 *   مطابقًا لعمودِ `effect_recorded_at` لكلِّ وظيفةٍ ملتقَطة، والقيمةَ طازجةً بعدَ استرجاعِ إيجارٍ
 *   منقضٍ، والكاتبَ الحقيقيَّ الوحيدَ مشروطًا برمزِ إيجارٍ حيٍّ، والوظيفةَ المختومةَ لا تعودُ،
 *   وFIFO (المُستعادَ في `20261025120000`) محفوظًا معَ الحقلِ الجديد، ومُحلِّلَ الطابورِ في
 *   TypeScript يحملُ الحقلَ إلى الكنّاسِ (`job.effectRecorded`).
 *
 *   ملاحظةُ منهجٍ في «الحالةُ الصادقةُ»: الكاتبُ الحقيقيُّ (`record_telegram_update_effect`) يختمُ
 *   الأثرَ ويُتمُّ الوظيفةَ في معاملةٍ واحدةٍ، فلا تنشأُ «معلَّقةٌ مختومةٌ» من مسارٍ طبيعيٍّ —
 *   حالتها حالةٌ دفاعيةٌّ (مثالًا بعدَ إصلاحٍ يدويٍّ). لذا تُثبَتُ الحالةُ الصادقةُ هنا بكتابةِ
 *   العمودِ مباشرةً (وصفٌ لا مسارٌ)، بينما واجبَ الكنّاسِ حيالَها مُثبَتٌ في اختبارِ الوحدةِ.
 *
 *   لماذا هذا اختبارُ قاعدةٍ لا ذاكرةٍ: التكافؤُ المُدّعى هو «قيمةُ العمودِ لحظةَ الالتقاطِ لا
 *   تتغيّرُ ما دامَ الإيجارُ حيًّا» — وهذا سلوكُ قفلِ الصفِّ والكاتبِ الوحيدِ في PostgreSQL، لا
 *   يُثبِتُه بديلٌ في الذاكرة.
 * يتطلّبُ TEST_DATABASE_URL بقاعدةٍ مُهاجَرةٍ بما فيها 20261025140000. معرّفاتٌ فريدةٌ
 * وcreated_at مضبوطٌ نسبيًّا إلى الآن. ينتمي إلى: tests/integration
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  type ClaimedTelegramUpdateJob,
  createPostgresTelegramUpdateQueue,
} from "../../packages/infrastructure/db/telegram-update-queue.ts";

const URL = process.env.TEST_DATABASE_URL;
const d = URL === undefined ? describe.skip : describe;
let sql: Sql;
const BASE = 9_600_000 + (Date.now() % 100_000) * 10;
const SPAN = 100;

/**
 * إزاحةُ عمرٍ تجعلُ وظائفِ هذا الملفِّ أقدمَ من كلِّ وظيفةٍ غريبةٍ متروكةٍ في الجدولِ.
 * الالتقاطُ يعيدُ الأقدمَ المعلَّقَ عالميًّا (عدالةُ FIFO من `20261025120000`)، لا الأقدمَ في
 * نطاقِ الملفِّ فقط، فأيُّ وظيفةٍ متروكةٍ من ملفٍّ سابقٍ (مثلَ بقايا `tests/real-redis` التي
 * تنظِّفُ الجدولَ في بدايتِها لا نهايتِها) تسبقُ وظائفَنا في الالتقاطِ وتكسرُ الحتميّةَ.
 * فنحسبُ عمرَ أقدمِ صفٍّ موجودٍ وقتَ البدءِ ونضيفُ إزاحةً فوقَه إلى كلِّ أعمارِ هذا الملفِّ.
 */
let AGE_OFFSET = 0;

async function enqueue(bot: string, id: number, user: number, secsAgo: number) {
  await sql`select claim_and_enqueue_telegram_update(${bot}, ${id}, ${sql.json({
    update_id: id,
    message: { from: { id: user }, chat: { id: user } },
  })}::jsonb, 100000)`;
  await sql`update telegram_update_jobs set created_at = now() - make_interval(secs => ${secsAgo + AGE_OFFSET})
             where bot = ${bot} and update_id = ${id}`;
}

/** إعادةُ وظيفةٍ اختبارٍ إلى المعلَّقِ المفردِ بلا محاولةٍ محسوبةٍ (كأنّها لم تُلتقط). */
async function release(bot: string, id: number) {
  await sql`update telegram_update_jobs set status = 'pending', claim_token = null, claimed_at = null,
              attempts = 0, next_attempt_at = now() where bot = ${bot} and update_id = ${id}`;
  await sql`update telegram_update_receipts set status = 'pending', claim_token = null, claimed_at = null,
              attempts = 0 where bot = ${bot} and update_id = ${id}`;
}

async function cleanup(bot: string, ids: number[]) {
  if (ids.length === 0) return;
  await sql`delete from telegram_update_jobs where bot = ${bot} and update_id = any(${ids}::bigint[])`;
  await sql`delete from telegram_update_receipts where bot = ${bot} and update_id = any(${ids}::bigint[])`;
}

/** نطاقُ هذا الملفِّ كلُّه (BASE يعتمدُ على الوقتِ فتُنظَّفُ بقايا التشغيلاتِ الفاشلةِ). */
const ALL_IDS = Array.from({ length: SPAN + 1 }, (_, i) => BASE + i);

d("LOAD-01 · C1 — فحصُ الأثرِ داخلَ الالتقاطِ على قاعدةٍ حقيقية", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: URL ?? "" });
    await cleanup("driver", ALL_IDS);
    await cleanup("rider", ALL_IDS);
    // وظائفُنا يجبُ أن تكونَ الأقدمَ المعلَّقَ عالميًّا وإلا استُهلكَ الالتقاطُ في بقايا غيرِنا.
    const [oldest] = await sql<{ offset: number | null }[]>`
      select (ceil(extract(epoch from (now() - min(created_at))) + 10))::int as offset
      from telegram_update_jobs`;
    AGE_OFFSET = oldest?.offset !== null && oldest?.offset !== undefined && oldest.offset > 0
      ? oldest.offset
      : 0;
  });
  afterAll(async () => {
    await cleanup("driver", ALL_IDS);
    await cleanup("rider", ALL_IDS);
    await sql.end({ timeout: 2 });
  });

  it("الدوالُّ الثلاثُ تُعيدُ effect_recorded مطابقًا للعمودِ، والأقدمُ أولًا", async () => {
    const a = BASE + 1;
    const b = BASE + 2;
    const c = BASE + 3;
    await enqueue("driver", a, 901, 50);
    await enqueue("driver", b, 902, 30);
    await enqueue("driver", c, 903, 40);

    // المفردةُ العامة: الأقدمُ (a، 50ث) بلا ختمٍ ⇒ false، وبرمزِ إيجارِها الحيِّ نستعملُه للختمِ الحقيقيِّ.
    const [r1] = await sql<{ r: { delivery: Record<string, unknown> | null } }[]>`
      select claim_telegram_update_job(30, 5) as r`;
    expect(r1?.r.delivery?.update_id).toBe(a);
    expect(r1?.r.delivery?.effect_recorded).toBe(false);
    const aToken = String(r1?.r.delivery?.claim_token);

    // الكاتبُ الحقيقيُّ يختمُ ويُتمُّ في معاملةٍ واحدةٍ، ثمّ نُعيدُها معلَّقةً (حالةٌ دفاعيةٌّ:
    // «معلَّقةٌ مختومةٌ» لا تنشأُ من مسارٍ طبيعيٍّ، وواجبَ الكنّاسِ حيالَها مُثبَتٌ في اختبارِ الوحدةِ).
    await sql`select record_telegram_update_effect('driver', ${a}, ${aToken}::uuid, '[]'::jsonb)`;
    await release("driver", a);

    // المفردةُ العامة ثانيًا: a ما زالتِ الأقدمَ المعلَّقةَ وقد خُتِمَ أثرُها ⇒ true.
    const [r2] = await sql<{ r: { delivery: Record<string, unknown> | null } }[]>`
      select claim_telegram_update_job(30, 5) as r`;
    expect(r2?.r.delivery?.update_id).toBe(a);
    expect(r2?.r.delivery?.effect_recorded).toBe(true);
    await release("driver", a);

    // المقيدةُ ببوت: الأقدمُ المعلَّقةُ a ⇒ true (القيمةُ نفسُها من مسارٍ آخر).
    const [r3] = await sql<{ r: { delivery: Record<string, unknown> | null } }[]>`
      select claim_telegram_update_job_for_bot(30, 5, 'driver') as r`;
    expect(r3?.r.delivery?.update_id).toBe(a);
    expect(r3?.r.delivery?.effect_recorded).toBe(true);
    await release("driver", a);

    // وظيفةٌ أقدمُ من الجميعِ بلا ختمٍ: لاختبارِ الكاذبةِ عبرَ المفردةِ والدفعةِ معًا.
    const dd = BASE + 9;
    await enqueue("driver", dd, 909, 100);

    // المفردةُ العامة: الأقدمُ الآن dd (100ث) ⇒ false.
    const [r4] = await sql<{ r: { delivery: Record<string, unknown> | null } }[]>`
      select claim_telegram_update_job(30, 5) as r`;
    expect(r4?.r.delivery?.update_id).toBe(dd);
    expect(r4?.r.delivery?.effect_recorded).toBe(false);
    await release("driver", dd);

    // الدفعيةُ: بترتيبِ الإنشاءِ dd (100ث) ثمّ a (50ث)، ولكلٍّ علمُه.
    const [r5] = await sql<{ r: { jobs: { update_id: number; effect_recorded: boolean }[] } }[]>`
      select claim_telegram_update_jobs_for_bot(30, 5, 'driver', 10) as r`;
    const mine = (r5?.r.jobs ?? []).filter(
      (j) => j.update_id >= BASE && j.update_id <= BASE + SPAN,
    );
    const ids = mine.map((j) => j.update_id);
    expect(ids.indexOf(dd)).toBeLessThan(ids.indexOf(a));
    const byId = new Map(mine.map((j) => [j.update_id, j.effect_recorded]));
    expect(byId.get(dd)).toBe(false);
    expect(byId.get(a)).toBe(true);
  });

  it("الكاتبُ مشروطٌ بإيجارٍ حيٍّ، والقيمةُ طازجةٌ بعدَ الاسترجاعِ، والمختومةُ لا تعود", async () => {
    const w = BASE + 4;
    // أقدمُ من كلِّ بقايا الحالةِ الأولى (a: 50ث، dd: 100ث) كي يكونَ الالتقاطُ لها حتميًّا.
    await enqueue("driver", w, 904, 200);

    // الالتقاطُ الأول: لا ختمَ ⇒ false.
    const [r1] = await sql<{ r: { delivery: Record<string, unknown> | null } }[]>`
      select claim_telegram_update_job(30, 5) as r`;
    expect(r1?.r.delivery?.update_id).toBe(w);
    expect(r1?.r.delivery?.effect_recorded).toBe(false);

    // رمزٌ غريبٌ لا يملكُ الوظيفةَ: الكاتبُ يرفضُ (لا يختمُ غيرُ الحائزِ الحيِّ).
    const [bad] = await sql<{ r: { ok: boolean; error: string } }[]>`
      select record_telegram_update_effect('driver', ${w}, gen_random_uuid()::uuid, '[]'::jsonb) as r`;
    expect(bad?.r.ok).toBe(false);
    expect(bad?.r.error).toBe("NOT_CLAIMED_BY_CALLER");

    // انقضاءُ الإيجارِ (30ث) بضبطِ claimed_at إلى الماضي (claim_token باقٍ فلا يُنقضُ الاقتران).
    await sql`update telegram_update_jobs set claimed_at = now() - make_interval(secs => 60)
               where bot = 'driver' and update_id = ${w}`;

    // الاسترجاعُ يعيدُ الوظيفةَ ويقرأُ القيمةَ طازجةً: لم يستطع أحدٌ ختمَها ⇒ false، والمحاولةُ 2.
    const [r2] = await sql<{ r: { delivery: Record<string, unknown> | null } }[]>`
      select claim_telegram_update_job(30, 5) as r`;
    expect(r2?.r.delivery?.update_id).toBe(w);
    expect(r2?.r.delivery?.effect_recorded).toBe(false);
    expect(r2?.r.delivery?.attempts).toBe(2);
    const wToken = String(r2?.r.delivery?.claim_token);

    // الختمُ بالرمزِ الحيِّ يُتمُّ الوظيفةَ نهائيًّا.
    const [good] = await sql<{ r: { ok: boolean; first: boolean } }[]>`
      select record_telegram_update_effect('driver', ${w}, ${wToken}::uuid, '[]'::jsonb) as r`;
    expect(good?.r.ok).toBe(true);
    expect(good?.r.first).toBe(true);

    // المختومةُ المُتمّةُ لا تعودُ إلى الالتقاطِ أبدًا.
    const [r3] = await sql<{ r: { delivery: Record<string, unknown> | null } }[]>`
      select claim_telegram_update_job(30, 5) as r`;
    expect(r3?.r.delivery === null || r3?.r.delivery?.update_id !== w).toBe(true);
  });

  it("FIFO محفوظٌ معَ الحقلِ: الدفعةُ بترتيبِ الإنشاءِ ولكلِّ وظيفةٍ علمُها", async () => {
    const x = BASE + 5;
    const y = BASE + 6;
    const z = BASE + 7;
    await enqueue("driver", x, 905, 50);
    await enqueue("driver", y, 906, 40);
    await enqueue("driver", z, 907, 30);
    // ختمُ الأحدثِ فقط (وصفٌ مباشرٌ للعمودِ — الحالةُ الدفاعية).
    await sql`update telegram_update_jobs set effect_recorded_at = now()
               where bot = 'driver' and update_id = ${z}`;

    const [r] = await sql<{ r: { jobs: { update_id: number; effect_recorded: boolean }[] } }[]>`
      select claim_telegram_update_jobs_for_bot(30, 5, 'driver', 10) as r`;
    const mine = (r?.r.jobs ?? []).filter((j) => j.update_id >= BASE && j.update_id <= BASE + SPAN);
    const ids = mine.map((j) => j.update_id);
    expect(ids.indexOf(x)).toBeLessThan(ids.indexOf(y));
    expect(ids.indexOf(y)).toBeLessThan(ids.indexOf(z));
    const byId = new Map(mine.map((j) => [j.update_id, j.effect_recorded]));
    expect(byId.get(z)).toBe(true);
    expect(byId.get(x)).toBe(false);
    expect(byId.get(y)).toBe(false);
  });

  it("مُحلِّلُ الطابورِ في TypeScript يحملُ الحقلَ إلى الكنّاسِ (job.effectRecorded)", async () => {
    const v = BASE + 8;
    await enqueue("rider", v, 908, 10);
    const queue = createPostgresTelegramUpdateQueue(sql);
    const first = await queue.claimFor?.("rider");
    expect((first?.job as ClaimedTelegramUpdateJob | null)?.updateId).toBe(v);
    expect(first?.job?.effectRecorded).toBe(false);
    // ختمٌ مباشرٌ على العمودِ (الحالةُ الدفاعية) ثمّ إعادةٌ معلَّقةً.
    await sql`update telegram_update_jobs set effect_recorded_at = now() where bot = 'rider' and update_id = ${v}`;
    await release("rider", v);
    const second = await queue.claimFor?.("rider");
    expect(second?.job?.updateId).toBe(v);
    expect(second?.job?.effectRecorded).toBe(true);
  });
});
