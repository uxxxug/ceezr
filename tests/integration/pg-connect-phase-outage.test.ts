/**
 * استمرارُ D7 (ADR 0286) — انقطاعُ PostgreSQL أثناءَ **إنشاءِ** الاتصالِ لا أثناءَ الاستعلامِ:
 * مجسُّ الدفعةِ 28 (b28-zombie، `probe-connect`) أثبتَ أنَّ قطعَ الاتصالاتِ وقتَ فتحِها يُفلتُ رفضًا
 * غيرَ معالَجٍ من مكتبةِ `postgres@3.4.9` — استعلامُ جلبِ أنواعِ المصفوفاتِ (`fetchArrayTypes`)
 * يُستدعى من معالجِ حدثِ جاهزيةِ الاتصالِ بلا منتظِرٍ، ففشلُهُ أثناءَ موتِ الاتصالِ يصيرُ رفضًا غيرَ
 * معالَجٍ يُسقطُ العمليةَ (سلوكُ Bun الافتراضيُّ) — عطلُ D7 نفسُهُ في طورٍ آخر، و«موجودٌ في main
 * أيضًا» بشهادةِ المجسّاتِ.
 *
 * الرقعةُ: `patches/postgres@3.4.9.patch` يوجّهُ فشلَ الجلبِ عبرَ مسارِ خطأِ الاتصالِ
 * (`fetchArrayTypes().catch(error)`) فيُرفَضُ ما هوَ معلَّقٌ بأصنافِ أخطاءٍ ظاهرةٍ للمستدعي،
 * ولا يُفلتُ شيءٌ. لا تغييرَ في مسارِ النجاحِ ولا في أصنافِ الأخطاءِ الظاهرةِ ولا في حدودِ المجمّعِ.
 *
 * الشاهدُ الرئيسُ **عمليةٌ فرعيّةٌ بلا أيِّ معالِجٍ للاعتراضِ أو الاستثناء** (`bun -e`): تعملُ
 * سيناريو القتلِ كاملًا وتخرجُ بصفرٍ معَ الرقعةِ، وتنهارُ بخروجٍ غيرِ صفريٍّ لو أفلتَ رفضٌ غيرُ
 * معالَجٍ — فلا حاجزَ يخفي الانهيارَ. والحقنُ **فاشلٌ مغلقًا**: يُعَدُّ كلُّ إنهاءِ خلفيةٍ ناجحٍ
 * وكلُّ رفضِ استعلامِ منَ الدفعةِ الأولى، فلو لم يُصِبِ القاطعُ نافذةَ الإنشاءِ سقطَ الاختبارُ
 * صريحًا لا نجحَ صدفةً. وحولَ «رفضٍ متأخرٍ يصيبُ طلبًا لاحقًا»: رفضُ استعلامِ الأنواعِ يقعُ
 * تزامنيًّا داخلَ تسلسلِ موتِ السوكيت، ومعالجُهُ microtask يعملُ قبلَ أيِّ setTimeout لإعادةِ
 * الاتصال — فلا يبلغُ رفضٌ قديمٌ طلبًا لاحقًا؛ والتعافي المقيسُ بعدَ كلِّ جولةٍ يعضدُ ذلك.
 */
import { describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
const POOL_APP = "d7-connect-outage";

/**
 * سيناريو العمليةِ الفرعيّةِ: بلا أيِّ معالِجٍ على مستوى العمليةِ — الرفضُ غيرُ المعالَجِ
 * يُسقطُ العمليةَ فيخرجُ الرمزُ غيرَ صفريٍّ، فنجاحُ الخروجِ هوَ الإثباتُ نفسُهُ.
 */
const CHILD_SCENARIO = `
const root = process.env.CHILD_ROOT;
const { createSql } = await import(root + "/packages/infrastructure/db/client.ts");
const URL = process.env.TEST_DATABASE_URL;
const admin = createSql({ connectionString: URL });
const app = ${JSON.stringify(POOL_APP)};
let kills = 0;
let rejected = 0;
for (let round = 0; round < 3; round += 1) {
  const pool = createSql({ connectionString: URL, max: 5, queryDeadlineMs: 3000, applicationName: app, idleTimeoutSeconds: null });
  let stop = false;
  const killer = (async () => {
    while (!stop) {
      const rows = await admin\`select pg_terminate_backend(pid) from pg_stat_activity where application_name = \${app}\`;
      for (const row of rows) if (row.pg_terminate_backend === true) kills += 1;
      await new Promise((r) => setTimeout(r, 1));
    }
  })();
  try {
    const first = await Promise.all([0, 1, 2, 3, 4].map(async () => {
      try { await pool\`select 3\`; return "ok" as const; } catch { return "rejected" as const; }
    }));
    rejected += first.filter((x) => x === "rejected").length;
  } finally {
    stop = true;
    await killer;
  }
  let consecutive = 0;
  let recovered = false;
  for (let i = 0; i < 30 && !recovered; i += 1) {
    try { await pool\`select 1\`; consecutive += 1; recovered = consecutive >= 3; } catch { consecutive = 0; }
    if (!recovered) await Bun.sleep(200);
  }
  try {
    if (!recovered) throw new Error("التجمُّعُ لم يتعافَ بعدَ 30 محاولة");
  } finally {
    await pool.end({ timeout: 5 }).catch(() => {});
  }
  const leftovers = await admin\`select pid from pg_stat_activity where application_name = \${app}\`;
  if (leftovers.length > 0) throw new Error("اتصالاتٌ باقيةٌ باسمِ الاختبارِ بعدَ الإغلاق");
}
await admin.end();
if (kills < 3) throw new Error("حقنُ العطلِ لم يُطلق: kills=" + kills);
if (rejected < 1) throw new Error("القتلُ لم يُصِبَّ استعلامًا جاريًا من الدفعةِ الأولى: rejected=" + rejected);
console.log("CHILD-OK kills=" + kills + " rejected=" + rejected);
`;

describeIf("انقطاعُ PostgreSQL أثناءَ إنشاءِ الاتصالِ (استمرارُ D7)", () => {
  it("العمليةُ تنجو (شاهدُ عمليةٍ فرعيّةٍ بلا معالجات)", async () => {
    expect(DATABASE_URL, "TEST_DATABASE_URL مطلوبٌ لاختبارِ قاعدةٍ حقيقيّة").toBeDefined();
    const proc = Bun.spawn(["bun", "-e", CHILD_SCENARIO], {
      cwd: `${import.meta.dir}/../..`,
      env: { ...process.env, CHILD_ROOT: `${import.meta.dir}/../..` },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(
        `العمليةُ الفرعيّةُ انهارتْ (exit=${exitCode}) — رفضٌ غيرُ معالَجٍ أفلتَ من المكتبةِ:\n${stdout}\n${stderr}`,
      );
    }
    if (!stdout.includes("CHILD-OK")) {
      throw new Error(`الشاهدُ لم يُعلِنْ نجاحَهُ:\n${stdout}\n${stderr}`);
    }
    // الحقنُ فاشلٌ مغلقًا: العدّاداتُ منَ الشاهدِ نفسِهِ (kills/rejected مذكورةٌ في خرجه).
    const kills = Number(/kills=(\d+)/.exec(stdout)?.[1] ?? 0);
    const rejected = Number(/rejected=(\d+)/.exec(stdout)?.[1] ?? 0);
    expect(kills, "لم يُوثَّقْ أيُّ إنهاءِ خلفيةٍ — الحقنُ معطَّل").toBeGreaterThanOrEqual(3);
    expect(
      rejected,
      "لم يُصِبَّ القتلُ استعلامًا جاريًا — النافذةُ المستهدفةُ لم تُمَسّ",
    ).toBeGreaterThanOrEqual(1);
  }, 240_000);

  /** الأثرُ نفسُهُ في عمليةِ الاختبارِ مباشرةً — الحدُّ الإضافيُّ فوقَ الشاهدِ الفرعيّ. */
  it("داخلَ عمليةِ الاختبارِ لا رفضَ غيرَ معالَجٍ", async () => {
    const observer: Sql = createSql({ connectionString: DATABASE_URL ?? "" });
    try {
      for (let round = 0; round < 2; round += 1) {
        const pool = createSql({
          connectionString: DATABASE_URL ?? "",
          max: 5,
          queryDeadlineMs: 3_000,
          applicationName: POOL_APP,
          idleTimeoutSeconds: null,
        });
        let stop = false;
        const killer = (async () => {
          while (!stop) {
            await observer`select pg_terminate_backend(pid) from pg_stat_activity where application_name = ${POOL_APP}`;
            await new Promise((r) => setTimeout(r, 1));
          }
        })();
        try {
          await Promise.all(
            [0, 1, 2, 3, 4].map(async () => {
              try {
                await pool`select 3`;
              } catch {
                // الرفضُ بظاهرِ صنفِ خطأِ اتصالٍ متوقَّعٌ — لا تعليقَ ولا انهيارَ.
              }
            }),
          );
        } finally {
          stop = true;
          await killer;
        }
        let consecutive = 0;
        let recovered = false;
        for (let i = 0; i < 30 && !recovered; i += 1) {
          try {
            await pool`select 1`;
            consecutive += 1;
            recovered = consecutive >= 3;
          } catch {
            consecutive = 0;
          }
          if (!recovered) await Bun.sleep(200);
        }
        expect(recovered, "التجمُّعُ لم يتعافَ").toBe(true);
        await pool.end({ timeout: 5 }).catch(() => {});
      }
    } finally {
      await observer.end({ timeout: 5 });
    }
  }, 240_000);
});
