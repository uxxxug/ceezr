#!/usr/bin/env bun
/**
 * # أداةُ قياسٍ: كلفةُ التقاطِ وظائفِ تيليجرام تحتَ التنازعِ — `LOAD-01` (الدورةُ الثانيةُ)
 *
 * **الغرض:** قياسُ زمنِ نداءِ الالتقاطِ الدُّفعيِّ `claim_telegram_update_jobs_for_bot`
 * تحتَ تنازسٍ حقيقيٍّ (عدّةُ عمالٍ متزامنينَ على طابورِ معلَّقٍ ثابتِ الحجمِ) — لا في
 * العزلةِ الهادئةِ. الدرسُ الموثَّقُ منَ موجةِ m5-1500 (التشغيلُ 40082574451): القياسُ
 * المصغّرُ الهادئُ لم يكشفْ انكسارَ خطةِ الفهرسِ (Sort كاملٌ فوقَ المعلَّقِ) بينما
 * الموجةُ كشفتْه (10.13ms/نداءً بعدَ <4.7ms، وG1 من 63.14% إلى 40.25%).
 *
 * **المنهجُ:** بذرُ طابورٍ منَ contact (ذروةُ m5-1500 ≈ 1,700) ثمّ عمالٌ متزامنونَ،
 * كلٌّ في حلقةٍ: التقاطُ دفعةٍ ← قياسُ الزمنِ ← إعادةُ تعليقِ ما التُقطَ (يثبّتُ حجمَ
 * الطابورِ). الناتجُ JSON على المخرجِ القياسيِّ (عددُ النداءاتِ، الوسيطُ، p95، p99،
 * العياراتُ/الثانيةِ) للالتقاطِ في الأدلةِ.
 *
 * **الاستعمالُ:** `BENCH_DATABASE_URL=postgres://... bun run scripts/bench-telegram-claim-contention.ts`
 * ‏(افتراضيًّا: 4 عمالٍ، 10 ثوانٍ، 1,700 صفًّا، دفعةُ 10 — راجعِ الثوابتَ أدناه).
 *
 * **ما لا يدّعيه:** لا يُثبتُ سعةً ولا يحكمُ على بوابةِ قبولٍ — يقيسُ العلاقةَ بينَ
 * خطةِ الاستعلامِ وزمنِ النداءِ تحتَ التنازسِ فحسبْ؛ الحكمُ للموجةِ على المقعدِ الحاكمِ.
 *
 * **الينتمي إلى:** حزمةُ `load01-contact-first-indexed-claim` · القسمُ 9.
 */

import postgres from "postgres";

const DATABASE_URL = process.env.BENCH_DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? "";
if (DATABASE_URL === "") {
  console.error("⚠️  عيّن BENCH_DATABASE_URL (أو TEST_DATABASE_URL) بقاعدةٍ مهاجَرة.");
  process.exit(1);
}

const WORKERS = Number(process.env.BENCH_WORKERS ?? 4);
const DURATION_MS = Number(process.env.BENCH_DURATION_MS ?? 10_000);
const ROWS = Number(process.env.BENCH_ROWS ?? 1_700);
const BATCH = Number(process.env.BENCH_BATCH ?? 10);
const BASE = 9_750_000;

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return -1;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? -1;
}

const sql = postgres(DATABASE_URL, { max: WORKERS + 1 });

async function seed() {
  await sql`delete from telegram_update_jobs where bot = 'driver' and update_id between ${BASE} and ${BASE + ROWS - 1}`;
  await sql`delete from telegram_update_receipts where bot = 'driver' and update_id between ${BASE} and ${BASE + ROWS - 1}`;
  await sql`insert into telegram_update_receipts (bot, update_id)
    select 'driver', ${BASE}::bigint + g from generate_series(0, ${ROWS - 1}) g`;
  // طابورُ contact متجانسٌ كطابورِ m5-1500 المُقاسِ (أعمارٌ 1–60ث)، مستخدمونَ مميزونَ.
  await sql`insert into telegram_update_jobs (bot, update_id, payload, created_at)
    select 'driver', ${BASE}::bigint + g, jsonb_build_object('update_id', ${BASE}::bigint + g, 'message',
        jsonb_build_object('from', jsonb_build_object('id', 97_500_000 + g),
          'chat', jsonb_build_object('id', 97_500_000 + g),
          'contact', jsonb_build_object('phone_number', '+966', 'first_name', 'd', 'user_id', 97_500_000 + g))),
        now() - make_interval(secs => 1 + (g % 60))
    from generate_series(0, ${ROWS - 1}) g`;
  await sql`analyze telegram_update_jobs`;
}

type Sample = { ms: number; claimed: number };

async function worker(stopAt: number, out: Sample[]) {
  const w = postgres(DATABASE_URL, { max: 1 });
  while (performance.now() < stopAt) {
    const t0 = performance.now();
    const [row] = await w<{ r: { jobs: { update_id: string; claim_token: string }[] } }[]>`
      select claim_telegram_update_jobs_for_bot(30, 5, 'driver', ${BATCH}) as r`;
    const ms = performance.now() - t0;
    const jobs = row?.r.jobs ?? [];
    out.push({ ms, claimed: jobs.length });
    // إعادةُ التعليقِ تُثبّتُ حجمَ الطابورِ (والمحاولةُ تُصفَّرُ كي لا تُميتَ الدفعةَ).
    if (jobs.length > 0) {
      const tokens = jobs.map((j) => j.claim_token);
      // إعادةُ التعليقِ في معاملةٍ واحدةٍ (وظيفةٌ وإيصالٌ ذرّيًّا): لو انفصلتا
      // لالتقطَ عاملٌ آخرُ الوظيفةََ بين البيانتينِ فيقفَ قفلانِ متقابلانِ على
      // الإيصالِ — سباقٌ في الأداةِ لا في الدالةِ (مُوثّقٌ من تشغيلٍ فاشلٍ أولٍ).
      await w.begin(async (tx) => {
        await tx`update telegram_update_jobs set status = 'pending', claim_token = null, claimed_at = null, attempts = 0
                where claim_token = any(${tokens}::uuid[])`;
        await tx`update telegram_update_receipts set status = 'pending', claim_token = null, claimed_at = null, attempts = 0
                where claim_token = any(${tokens}::uuid[])`;
      });
    }
  }
  await w.end({ timeout: 2 });
}

const main = async () => {
  await seed();
  const stopAt = performance.now() + DURATION_MS;
  const out: Sample[] = [];
  await Promise.all(Array.from({ length: WORKERS }, () => worker(stopAt, out)));
  const sorted = out.map((s) => s.ms).sort((a, b) => a - b);
  const elapsed = DURATION_MS / 1000;
  const result = {
    rows: ROWS,
    workers: WORKERS,
    duration_s: elapsed,
    batch: BATCH,
    calls: out.length,
    claims_total: out.reduce((a, s) => a + s.claimed, 0),
    claims_per_sec: Number((out.reduce((a, s) => a + s.claimed, 0) / elapsed).toFixed(1)),
    latency_ms: {
      p50: Number(pct(sorted, 50).toFixed(2)),
      p95: Number(pct(sorted, 95).toFixed(2)),
      p99: Number(pct(sorted, 99).toFixed(2)),
      max: Number((sorted[sorted.length - 1] ?? 0).toFixed(2)),
    },
  };
  console.log(JSON.stringify(result, null, 2));
  await sql.end({ timeout: 2 });
};

await main();
