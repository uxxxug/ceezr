/**
 * الغرض: LOAD-01 (فجوةُ السعةِ 2026-10-24) — أولويةُ وظائفِ contact في التقاطِ وظائفِ
 *   تحديثِ تيليجرام على PostgreSQL حقيقيّ. إثباتُ الهاتفِ (contact) مسارٌ حرجٌ ذو مهلةٍ
 *   (20ث في المولّدِ)؛ فلا يجوزُ أن تنتظرَ خلفَ طابورٍ من الوظائفِ غيرِ الحرجةِ (رسائلَ/
 *   أزرارٍ) في الترتيبِ FIFO الخالصِ. هذا الملفُّ يُثبتُ الخللَ قبلَ الهجرةِ (أحمر) ويحرسُه
 *   بعدَها (أخضر)، ويحرسُ معَهُ: FIFO داخلَ الفئةِ، ترقيةَ تقادمِ 120ث (منعَ التجويعِ)،
 *   وحفاظَ D4 (ترتيبِ المستخدمِ الواحدِ) معَ الأولويةِ النوعيةِ.
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

d("أولويةُ contact في التقاطِ وظائفِ تحديثِ تيليجرام — قاعدةٌ حقيقية", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: URL ?? "" });
  });
  afterAll(async () => {
    await sql`delete from telegram_update_jobs where bot = 'driver' and update_id between ${BASE} and ${BASE + SPAN}`;
    await sql`delete from telegram_update_receipts where bot = 'driver' and update_id between ${BASE} and ${BASE + SPAN}`;
    await sql.end({ timeout: 2 });
  });

  it("وظيفةُ contact أحدثُ تُلتقطُ قبلَ رسائلَ أقدمَ منها (الحملُ المختلطُ)", async () => {
    const u1 = 92_000_001,
      u2 = 92_000_002,
      u3 = 92_000_003;
    await enqueue(BASE + 1, u1, 30); // رسالةٌ منذُ 30ث
    await enqueue(BASE + 2, u2, 20); // رسالةٌ منذُ 20ث
    await enqueueContact(BASE + 3, u3, 10); // contact منذُ 10ث — يجبُ أن يكونَ أولًا
    const ids = await claimBatch(3);
    expect(ids[0]).toBe(BASE + 3); // الأولويةُ النوعيةُ
    expect(ids.slice(1).sort((a, b) => a - b)).toEqual([BASE + 1, BASE + 2]); // FIFO للرسائل
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

  it("منعُ التجويعِ: رسالةٌ معلقةٌ أكثرَ من 120ث تُرقَّى فوقَ contact حديثةٍ", async () => {
    const u6 = 92_000_006,
      u7 = 92_000_007;
    await enqueue(BASE + 21, u6, 200); // رسالةٌ منذُ 200ث — تُرقَّى بترقيةِ التقادمِ
    await enqueueContact(BASE + 22, u7, 10); // contact حديثة
    const ids = await claimBatch(2);
    // الرسالةُ المرقَّاةُ (200ث) تسبقُ contact الحديثةَ — حدُّ التجويعِ مقيَّدٌ بـ120ث.
    expect(ids[0]).toBe(BASE + 21);
    expect(ids[1]).toBe(BASE + 22);
    await seal([BASE + 21, BASE + 22]);
  });

  it("D4 محفوظٌ معَ الأولويةِ: contact لا تُلتقطُ أمامَ وظيفةٍ أقدمَ لنفسِ المستخدمِ", async () => {
    const u8 = 92_000_008;
    await enqueue(BASE + 31, u8, 30); // رسالةٌ أقدمُ لنفسِ المستخدمِ — مستحقة
    await enqueueContact(BASE + 32, u8, 20); // contact أحدثُ لنفسِ المستخدمِ — يحجبُها D4
    const ids = await claimBatch(2);
    expect(ids).toContain(BASE + 31);
    expect(ids).not.toContain(BASE + 32);
    await seal([BASE + 31]);
    // بعدَ ختمِ الأقدمِ تُلتقطُ contact.
    const second = await claimBatch(2);
    expect(second).toContain(BASE + 32);
    await seal([BASE + 32]);
  });

  it("الالتقاطُ المفردُ كذلك يقدّمُ contact", async () => {
    const u9 = 92_000_009,
      u10 = 92_000_010;
    await enqueue(BASE + 41, u9, 30);
    await enqueueContact(BASE + 42, u10, 10);
    const [row] = await sql<{ r: { ok: boolean; delivery: { update_id: string } | null } }[]>`
      select claim_telegram_update_job_for_bot(30, 5, 'driver') as r`;
    expect(Number(row?.r.delivery?.update_id)).toBe(BASE + 42);
    await seal([BASE + 41, BASE + 42]);
  });
});
