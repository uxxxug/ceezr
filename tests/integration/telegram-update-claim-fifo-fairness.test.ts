/**
 * الغرض: LOAD-01 (قرارُ المالكِ بعدَ PR #651، 2026-10-25) — عدالةُ الالتقاطِ FIFO في دوالِّ التقاطِ
 *   وظائفِ تحديثِ تيليجرام على PostgreSQL حقيقيّ، بعدَ إيقافِ أولويّةِ contact بالهجرةِ
 *   `20261025120000_load01_claim_fifo_fairness_restore.sql`.
 *
 *   الدليلُ: على حِملٍ مختلطٍ (`docs/evidence/capacity/LOAD01M-MIXED-AB-20261025/RESULT.md`) انتظرتِ
 *   الوظائفُ غيرُ contact تحتَ ترتيبِ #645/#647 نحو 6.2 ضعفِ خطِّ الأساسِ حتى عتبةِ التقادمِ 120ث،
 *   وقيمةُ الأولويّةِ لـcontact غيرُ مُثبَتة. هذا الملفُّ أحمرُ على ترتيبِ #645/#647 وأخضرُ بعدَ الهجرة:
 *   لا قفزَ بالنوعِ في الدفعةِ ولا في المفرد، وFIFO داخلَ النوعِ وعبرَه، وD4 (ترتيبُ المستخدمِ الواحد) محفوظ،
 *   ونصُّ الدوالِّ الثلاثِ بلا أيِّ محمولٍ على contact ولا ترقيةِ تقادم.
 * يتطلّبُ TEST_DATABASE_URL بقاعدةٍ مهاجَرة. معرّفاتٌ فريدةٌ وcreated_at مضبوطٌ نسبيًّا إلى الآن.
 * ينتمي إلى: tests/integration
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const URL = process.env.TEST_DATABASE_URL;
const d = URL === undefined ? describe.skip : describe;
let sql: Sql;
const BASE = 9_400_000 + (Date.now() % 100_000) * 10;
const SPAN = 100;

/** إيداعُ وظيفةٍ ثمّ ضبطُ created_at نسبيًّا إلى الآن (secsAgo) لضبطِ الترتيبِ والتقادمِ. */
async function enqueue(
  id: number,
  user: number,
  secsAgo: number,
  payload: Record<string, unknown> = {},
) {
  await sql`select claim_and_enqueue_telegram_update('driver', ${id}, ${sql.json({
    update_id: id,
    message: {
      from: { id: user },
      chat: { id: user },
      ...payload,
    },
  })}::jsonb, 100000)`;
  await sql`update telegram_update_jobs set created_at = now() - make_interval(secs => ${secsAgo})
             where bot = 'driver' and update_id = ${id}`;
}

/** إيداعُ وظيفةِ contact (إثباتُ هاتفٍ). */
async function enqueueContact(id: number, user: number, secsAgo: number) {
  await enqueue(id, user, secsAgo, {
    contact: { phone_number: "+966500000000", first_name: "d", user_id: user },
  });
}

async function claimBatch(limit: number): Promise<number[]> {
  const [row] = await sql<{ r: { ok: boolean; jobs: { update_id: number }[] } }[]>`
    select claim_telegram_update_jobs_for_bot(30, 5, 'driver', ${limit}) as r`;
  const ids = (row?.r.jobs ?? []).map((j) => Number(j.update_id));
  const foreign = ids.filter((id) => id < BASE || id > BASE + SPAN);
  if (foreign.length > 0) {
    await sql`update telegram_update_jobs set status = 'pending', claim_token = null, claimed_at = null, attempts = attempts - 1
               where bot = 'driver' and update_id = any(${foreign}::bigint[])`;
    await sql`update telegram_update_receipts set status = 'pending', claim_token = null, claimed_at = null, attempts = attempts - 1
               where bot = 'driver' and update_id = any(${foreign}::bigint[])`;
  }
  return ids.filter((id) => id >= BASE && id <= BASE + SPAN);
}

/** ختمُ وظائفِ اختبارٍ كي لا تتسربَ بينَ الحالاتِ. */
async function seal(ids: number[]) {
  if (ids.length === 0) return;
  await sql`update telegram_update_jobs set status = 'done', claim_token = null, claimed_at = null, completed_at = now()
             where bot = 'driver' and update_id = any(${ids}::bigint[])`;
  await sql`update telegram_update_receipts set status = 'done', claim_token = null, claimed_at = null, completed_at = now()
             where bot = 'driver' and update_id = any(${ids}::bigint[])`;
}

d("عدالةُ الالتقاطِ FIFO في وظائفِ تحديثِ تيليجرام بلا أولويّةٍ نوعيّة — قاعدةٌ حقيقية", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: URL ?? "" });
  });
  afterAll(async () => {
    await sql`delete from telegram_update_jobs where bot = 'driver' and update_id between ${BASE} and ${BASE + SPAN}`;
    await sql`delete from telegram_update_receipts where bot = 'driver' and update_id between ${BASE} and ${BASE + SPAN}`;
    await sql.end({ timeout: 2 });
  });

  it("الحِملُ المختلط: contact أحدثُ لا تقفزُ فوقَ رسائلَ أقدمَ منها — الدفعةُ بترتيبِ الإنشاء", async () => {
    const u1 = 92_000_001,
      u2 = 92_000_002,
      u3 = 92_000_003;
    await enqueue(BASE + 1, u1, 30); // رسالةٌ منذُ 30ث
    await enqueue(BASE + 2, u2, 20); // رسالةٌ منذُ 20ث
    await enqueueContact(BASE + 3, u3, 10); // contact منذُ 10ث — الأحدث، فالأخيرة
    const ids = await claimBatch(3);
    expect(ids).toEqual([BASE + 1, BASE + 2, BASE + 3]);
    await seal([BASE + 1, BASE + 2, BASE + 3]);
  });

  it("FIFO داخلَ فئةِ contact: الأقدمُ أولًا", async () => {
    const u4 = 92_000_004,
      u5 = 92_000_005;
    await enqueueContact(BASE + 11, u4, 30);
    await enqueueContact(BASE + 12, u5, 20);
    const ids = await claimBatch(2);
    expect(ids).toEqual([BASE + 11, BASE + 12]);
    await seal([BASE + 11, BASE + 12]);
  });

  it("لا عتبةَ تقادم: رسالةٌ عمرُها 60ث (دونَ 120ث) تسبقُ contact أحدثَ منها، والدفعةُ المحدودةُ تأخذُ الأقدم", async () => {
    const u6 = 92_000_006,
      u7 = 92_000_007;
    await enqueue(BASE + 21, u6, 60); // رسالةٌ طازجةٌ بمعيارِ #647 (< 120ث)
    await enqueueContact(BASE + 22, u7, 10);
    const first = await claimBatch(1); // تحتَ #647 كانت contact تُلتقطُ هنا
    expect(first).toEqual([BASE + 21]);
    const second = await claimBatch(1);
    expect(second).toEqual([BASE + 22]);
    await seal([BASE + 21, BASE + 22]);
  });

  it("D4 محفوظ: وظيفةٌ أحدثُ لا تُلتقطُ أمامَ وظيفةٍ أقدمَ معلّقةٍ لنفسِ المستخدم", async () => {
    const u8 = 92_000_008;
    await enqueue(BASE + 31, u8, 30); // رسالةٌ أقدمُ لنفسِ المستخدمِ — مستحقة
    await enqueueContact(BASE + 32, u8, 20); // contact أحدثُ لنفسِ المستخدمِ — يحجبُها D4
    const ids = await claimBatch(2);
    expect(ids).toContain(BASE + 31);
    expect(ids).not.toContain(BASE + 32);
    await seal([BASE + 31]);
    const second = await claimBatch(2);
    expect(second).toContain(BASE + 32);
    await seal([BASE + 32]);
  });

  it("الالتقاطُ المفردُ يأخذُ الأقدم، ونصُّ الدوالِّ الثلاثِ بلا محمولِ contact ولا ترقيةِ تقادم", async () => {
    const u9 = 92_000_009,
      u10 = 92_000_010;
    await enqueue(BASE + 41, u9, 30);
    await enqueueContact(BASE + 42, u10, 10);
    const [row] = await sql<{ r: { ok: boolean; delivery: { update_id: string } | null } }[]>`
      select claim_telegram_update_job_for_bot(30, 5, 'driver') as r`;
    const got = Number(row?.r.delivery?.update_id);
    if (got < BASE || got > BASE + SPAN) {
      // وظيفةٌ أقدمُ من خارجِ الاختبارِ على القاعدةِ المشتركة: تُعادُ ولا يُحكَمُ بها.
      await sql`update telegram_update_jobs set status = 'pending', claim_token = null, claimed_at = null, attempts = attempts - 1
                 where bot = 'driver' and update_id = ${got}`;
    } else {
      expect(got).toBe(BASE + 41);
    }
    const defs = await sql<{ name: string; def: string }[]>`
      select p.proname as name, pg_get_functiondef(p.oid) as def from pg_proc p
       where p.proname in ('claim_telegram_update_job', 'claim_telegram_update_job_for_bot', 'claim_telegram_update_jobs_for_bot')`;
    expect(defs.map((d) => d.name).sort()).toEqual([
      "claim_telegram_update_job",
      "claim_telegram_update_job_for_bot",
      "claim_telegram_update_jobs_for_bot",
    ]);
    for (const d of defs) {
      expect(d.def).not.toContain("contact");
      expect(d.def).not.toContain("120 seconds");
      expect(d.def).toContain("order by j.created_at");
    }
    await seal([BASE + 41, BASE + 42]);
  });
});
