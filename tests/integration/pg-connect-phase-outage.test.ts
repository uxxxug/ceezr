/**
 * استمرارُ D7 (ADR 0286) — انقطاعُ PostgreSQL أثناءَ **إنشاءِ** الاتصالِ لا أثناءَ الاستعلامِ:
 * مجسُّ الدفعةِ 28 (b28-zombie، `probe-connect`) أثبتَ أنَّ قطعَ الاتصالاتِ وقتَ فتحِها يُفلتُ رفضًا
 * غيرَ معالَجٍ من مكتبةِ `postgres@3.4.9` — استعلامُ جلبِ أنواعِ المصفوفاتِ (`fetchArrayTypes`)
 * يُستدعى من معالجِ حدثٍ بلا منتظِرٍ، ففشلُه أثناءَ الموتِ يصيرُ `unhandledRejection`
 * يُسقطُ العمليةَ (سُلوكُ Bun الافتراضيُّ) — عطلُ D7 نفسُهُ في طورٍ آخر.
 *
 * الرقعةُ: `patches/postgres@3.4.9.patch` يوجّهُ فشلَ الجلبِ عبرَ مسارِ خطأِ الاتصالِ
 * (`error`) فيُرفَضُ ما هوَ معلَّقٌ من استعلاماتٍ بأصنافِ أخطاءٍ ظاهرةٍ للمستدعي، ولا يُفلتُ شيءٌ.
 *
 * المحاكمةُ: قاطعُ إداريٌّ يُنهي ظهورَ تجمُّعٍ جديدٍ كلَّما فتحَ اتصالًا (قتلٌ أثناءَ الإنشاءِ)،
 * ثمَّ يُفحصُ أنَّ كلَّ استعلامٍ استقرّ (نجحَ أو رُفضَ بصنفِ خطأِ اتصالٍ — لا تعليقَ)، وأنَّ التجمُّعَ
 * تعافى بعدها، وأنَّ صفرَ رفضٍ غيرِ معالَجٍ صدرَ عن العمليةِ، وأنَّ لا اتصالًا باقيًا باسمِ الاختبارِ.
 *
 * يسقطُ على الرقعةِ السابقةِ (قبلَ `fetchArrayTypes().catch(error)`) — يُثبتُه تاريخُ التشغيلِ
 * في دليلِ الدفعةِ (b28 §4 مجسّاتُ السائق): «قتلٌ أثناءَ الاتصالِ يُفلِتُ أخطاءً غيرَ معالَجةٍ — موجودٌ في main أيضًا».
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
const POOL_APP = "d7-connect-outage";
const ROUNDS = 3;

let observer: Sql;
let unhandled: unknown[] = [];

function trackUnhandled(): void {
  unhandled = [];
  process.on("unhandledRejection", onUnhandled);
  process.on("uncaughtException", onUnhandled);
}

function untrackUnhandled(): void {
  process.off("unhandledRejection", onUnhandled);
  process.off("uncaughtException", onUnhandled);
}

function onUnhandled(reason: unknown): void {
  unhandled.push(reason);
}

/** أصنافُ الأخطاءِ المتوقعةُ من موتِ الاتصالِ وقتَ الفتحِ — كلُّها ظاهرةٌ للمستدعي لا قاتلةٌ للعمليةِ. */
const CONNECTION_ERROR_CODES = new Set([
  "57P01", // terminating connection due to administrator command
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "ECONNRESET",
  "ECONNREFUSED",
]);

describeIf("انقطاعُ PostgreSQL أثناءَ إنشاءِ الاتصالِ (استمرارُ D7)", () => {
  beforeAll(async () => {
    observer = createSql({ connectionString: DATABASE_URL ?? "" });
    trackUnhandled();
  });

  afterAll(async () => {
    untrackUnhandled();
    await observer.end({ timeout: 5 });
  });

  it("لا رفضَ غيرَ معالَجٍ، وكلُّ استعلامٍ مستقرٌّ، والتجمُّعُ يتعافى", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const pool = createSql({
        connectionString: DATABASE_URL ?? "",
        max: 5,
        queryDeadlineMs: 3_000,
        applicationName: POOL_APP,
        idleTimeoutSeconds: null,
      });

      // القاطعُ: يُنهي كلَّ ظهورٍ للتجمُّعِ لحظةَ فتحِهِ — القتلُ أثناءَ الإنشاءِ لا أثناءَ الاستعلامِ.
      let stop = false;
      const killer = (async () => {
        while (!stop) {
          await observer`select pg_terminate_backend(pid) from pg_stat_activity where application_name = ${POOL_APP}`;
          await new Promise((r) => setTimeout(r, 1));
        }
      })();

      const first = await Promise.all(
        [0, 1, 2, 3, 4].map(async () => {
          try {
            await pool`select 3`;
            return "ok" as const;
          } catch (cause) {
            const code = (cause as { code?: string }).code;
            expect(
              CONNECTION_ERROR_CODES.has(String(code)),
              `صنفُ خطأٍ غيرِ متوقعٍ أثناءَ القطعِ: ${code}`,
            ).toBe(true);
            return "rejected" as const;
          }
        }),
      );
      stop = true;
      await killer;
      expect(first.every((x) => x === "ok" || x === "rejected")).toBe(true);

      // التعافي: بعدَ توقفِ القاطعِ يعملُ التجمُّعُ من جديدٍ. الرفضُ العابرُ واردٌ في
      // الجولةِ الأولىِ (هدمُ السوكيتاتِ المتبقيةِ)، فالميزانيّةُ: ثلاثةُ نجاحاتٍ متتاليةٍ
      // قبلَ 30 محاولةً — بعدها يُعدُّ التجمُّعُ غيرَ متعافٍ.
      let consecutiveOk = 0;
      let recovered = false;
      for (let i = 0; i < 30 && !recovered; i += 1) {
        try {
          await pool`select 1`;
          consecutiveOk += 1;
          recovered = consecutiveOk >= 3;
        } catch {
          consecutiveOk = 0;
        }
        if (!recovered) await Bun.sleep(200);
      }
      expect(recovered, "التجمُّعُ لم يتعافَ بعدَ 30 محاولةً").toBe(true);
      await pool.end({ timeout: 5 });

      const leftovers = await observer<
        { pid: number }[]
      >`select pid from pg_stat_activity where application_name = ${POOL_APP}`;
      expect(leftovers, "اتصالاتٌ باقيةٌ باسمِ الاختبارِ بعدَ الإغلاقِ").toHaveLength(0);
    }

    expect(
      unhandled,
      `رفوضٌ غيرُ معالَجٍ هربَ من المكتبةِ (أصلُ العطلِ قبلَ الرقعةِ): ${JSON.stringify(
        unhandled.map((x) => (x instanceof Error ? `${x.name}: ${x.message}` : String(x))),
      )}`,
    ).toHaveLength(0);
  }, 120_000);
});
