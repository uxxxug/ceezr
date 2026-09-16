/**
 * الغرض: قياسُ حاجزِ «التدهورُ يُقاسُ بعملِ المحرِّكِ لا بزمنِ الساعةِ» بنصوصٍ
 *   **مزروعةٍ** — سالبةٌ لكلِّ قاعدةٍ من الستِّ (ومنها التوكيدُ الذي قرأَ ٣٫٢ في
 *   التشغيلِ `35124024068`)، وموجبةٌ تقرأُ الملفَّينِ الحقيقيَّينِ من القرصِ (`ح-٧`).
 * الحالة: مُختبَرٌ — بوّابةُ CI.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وخطوةُ «تحقّق» في CI.
 * يُتوقع أن يستخدمه لاحقاً: كلُّ تعديلٍ على قواعدِ الحاجزِ — تُقاسُ ههنا لا في
 *   المستودَعِ، فحاجزٌ يُقاسُ بما يصادفُه القرصُ يمرُّ أخضرَ وهوَ معطوبٌ.
 * الحاكم: docs/adr/0130-degradation-is-measured-in-work-not-in-clock-time.md
 *
 * ## وما لا يقيسُه هذا الملفُّ عن قصدٍ
 * ــ **لا يُشغِّلُ اختبارَ الصمودِ**: ذاكَ على PostgreSQL حقيقيٍّ في `test:e2e`.
 * ــ **لا يقيسُ صدقَ العدّادِ نفسِه**: ذاكَ حكمُ `pg_stat_database` لا حكمُنا.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  describeSoakWorkViolation,
  type GuardedFile,
  MAX_ALLOWED_CEILING,
  REQUIRED_FILES,
  RULE_NAMES,
  SOAK_TEST_FILE,
  soakWorkMeasureViolations,
  WORK_SUPPORT_FILE,
} from "../../scripts/lib/soak-work-measure.ts";

/** ملفُّ دعمٍ سليمٌ مزروعٌ: يُستعمَلُ أساساً فتُقاسَ كلُّ سالبةٍ وحدَها. */
const GOOD_SUPPORT = [
  "export const WORK_GROWTH_CEILING = 3;",
  "async function readEngineWork(sql) {",
  "  return await sql`select (tup_returned + tup_fetched) as rows_scanned,",
  "    (blks_read + blks_hit) as blocks_touched",
  "    from pg_stat_database where datname = current_database()`;",
  "}",
  "export async function settleEngineWork(sql) { return readEngineWork(sql); }",
].join("\n");

/** ملفُّ صمودٍ سليمٌ مزروعٌ. */
const GOOD_SOAK = [
  "import { settleEngineWork, WORK_GROWTH_CEILING } from '../support/engine-work.ts';",
  "const at10 = await settleEngineWork(sql);",
  "expect(growth.rowsRatio).toBeLessThan(WORK_GROWTH_CEILING);",
  "expect(growth.blocksRatio).toBeLessThan(WORK_GROWTH_CEILING);",
].join("\n");

function files(soak: string, support: string): readonly GuardedFile[] {
  return [
    { path: SOAK_TEST_FILE, source: soak },
    { path: WORK_SUPPORT_FILE, source: support },
  ];
}

function rules(soak: string, support: string): readonly string[] {
  return soakWorkMeasureViolations(files(soak, support)).map((violation) => violation.rule);
}

describe("حاجزُ قياسِ التدهورِ — سالباتٌ مزروعةٌ تُلتقَطُ", () => {
  it("١) التوكيدُ الذي قرأَ ٣٫٢ في `35124024068` يُلتقَطُ بحرفِه", () => {
    const planted = [
      GOOD_SOAK,
      "const firstFive = durations.slice(0, 5).reduce((a, b) => a + b, 0) / 5;",
      "durations.push(performance.now() - startedAt);",
      "expect(lastFive).toBeLessThan(firstFive * 3);",
    ].join("\n");
    const violations = soakWorkMeasureViolations(files(planted, GOOD_SUPPORT));
    expect(violations.map((violation) => violation.rule)).toContain("clock.assertion");
    // ورقمٌ مبثوثٌ في التوكيدِ يُلتقَطُ بقاعدةٍ ثانيةٍ: عطبانِ لا عطبٌ.
    expect(violations.map((violation) => violation.rule)).toContain("work.assertion");
  });

  it("٢) `Date.now()` بدلاً من `performance.now()` لا يُفلِتُ", () => {
    const planted = [
      GOOD_SOAK,
      "const spent = Date.now() - began;",
      "expect(spent).toBeLessThan(WORK_GROWTH_CEILING);",
    ].join("\n");
    expect(rules(planted, GOOD_SUPPORT)).toContain("clock.assertion");
  });

  it("٣) مصدرُ عملٍ بلا حدِّ قاعدةٍ يُلتقَطُ — عملُ قاعدةٍ أخرى يُحسَبُ لنا", () => {
    const planted = GOOD_SUPPORT.replace("where datname = current_database()", "");
    expect(rules(GOOD_SOAK, planted)).toContain("work.source");
  });

  it("٤) عدّادُ الكُتَلِ إن سقطَ من الاستعلامِ يُلتقَطُ", () => {
    const planted = GOOD_SUPPORT.replace(
      "(blks_read + blks_hit) as blocks_touched",
      "0 as blocks_touched",
    );
    expect(rules(GOOD_SOAK, planted)).toContain("work.source");
  });

  it("٥) سقفٌ مبثوثٌ في التوكيدِ لا مستورَدٌ يُلتقَطُ", () => {
    const planted = GOOD_SOAK.replace(
      "toBeLessThan(WORK_GROWTH_CEILING);\nexpect(growth.blocksRatio).toBeLessThan(WORK_GROWTH_CEILING);",
      "toBeLessThan(3);\nexpect(growth.blocksRatio).toBeLessThan(3);",
    );
    expect(rules(planted, GOOD_SUPPORT)).toContain("work.assertion");
  });

  it("٦) اختبارُ صمودٍ بلا توكيدِ تدهورٍ أصلاً يُلتقَطُ", () => {
    const planted =
      "const at10 = await settleEngineWork(sql);\nconst ceiling = WORK_GROWTH_CEILING;";
    expect(rules(planted, GOOD_SUPPORT)).toContain("work.assertion");
  });

  it("٧) رفعُ السقفِ فوقَ ثلاثةٍ يُلتقَطُ — وهوَ مسارٌ محظورٌ بنصِّ `DEC-18`", () => {
    const planted = GOOD_SUPPORT.replace("= 3;", "= 5;");
    const violations = soakWorkMeasureViolations(files(GOOD_SOAK, planted));
    expect(violations.map((violation) => violation.rule)).toContain("ceiling.single-source");
    expect(violations.some((violation) => violation.detail.includes("5"))).toBe(true);
  });

  it("٨) إعلانُ السقفِ في موضعَينِ يُلتقَطُ — مصدرا حقيقةٍ لرقمٍ واحدٍ", () => {
    const planted = `${GOOD_SOAK}\nexport const WORK_GROWTH_CEILING = 3;`;
    expect(rules(planted, GOOD_SUPPORT)).toContain("ceiling.single-source");
  });

  it("٩) قراءةٌ عاريةٌ بلا سكونٍ مقيسٍ تُلتقَطُ", () => {
    const planted = GOOD_SOAK.replace("await settleEngineWork(sql)", "await readEngineWork(sql)");
    expect(rules(planted, GOOD_SUPPORT)).toContain("settle.before-read");
  });

  it("١٠) إعادةُ تشغيلٍ حتّى يخضَرَّ تُلتقَطُ", () => {
    const planted = `${GOOD_SOAK}\nit('صمود', { retry: 3 }, async () => {});`;
    expect(rules(planted, GOOD_SUPPORT)).toContain("no-retry");
  });

  it("١١) حذفُ ملفِّ القياسِ لا يُسقِطُ القاعدةَ — الغيابُ خرقٌ لا صمتٌ", () => {
    const violations = soakWorkMeasureViolations([{ path: SOAK_TEST_FILE, source: GOOD_SOAK }]);
    expect(violations.map((violation) => violation.file)).toContain(WORK_SUPPORT_FILE);
  });
});

describe("حاجزُ قياسِ التدهورِ — موجباتٌ لا تُلتقَطُ", () => {
  it("١٢) النصّانِ السليمانِ المزروعانِ يمرّانِ بلا خرقٍ", () => {
    expect(soakWorkMeasureViolations(files(GOOD_SOAK, GOOD_SUPPORT))).toEqual([]);
  });

  it("١٣) ذكرُ `performance.now()` في تعليقٍ شارحٍ لا يُدانُ", () => {
    const planted = `// كانَ ههنا توكيدٌ على performance.now() فبُدِّلَ\n${GOOD_SOAK}`;
    expect(rules(planted, GOOD_SUPPORT)).toEqual([]);
  });

  it("١٤) قياسُ زمنٍ للطباعةِ بلا توكيدٍ قريبٍ لا يُدانُ", () => {
    const planted = [
      "const began = performance.now();",
      "await run();",
      "console.log(performance.now() - began);",
      "",
      "",
      "",
      "",
      GOOD_SOAK,
    ].join("\n");
    expect(rules(planted, GOOD_SUPPORT)).toEqual([]);
  });

  it("١٥) الملفّانِ الحقيقيّانِ على القرصِ نظيفانِ — لا موجبةٌ مزروعةٌ وحدَها", () => {
    const onDisk = REQUIRED_FILES.map((path) => ({ path, source: readFileSync(path, "utf8") }));
    expect(soakWorkMeasureViolations(onDisk)).toEqual([]);
  });
});

describe("حاجزُ قياسِ التدهورِ — كلُّ قاعدةٍ لها سالبةٌ (`ح-٧`)", () => {
  it("١٦) القواعدُ الستُّ كلُّها مبذورةٌ في هذا الملفِّ", () => {
    const seeded = new Set<string>([
      ...rules(
        [
          GOOD_SOAK,
          "durations.push(performance.now() - startedAt);",
          "expect(lastFive).toBeLessThan(firstFive * 3);",
          "it('صمود', { retry: 3 }, async () => {});",
        ].join("\n"),
        GOOD_SUPPORT.replace("where datname = current_database()", "").replace("= 3;", "= 5;"),
      ),
      ...rules(
        GOOD_SOAK.replace("await settleEngineWork(sql)", "await readEngineWork(sql)"),
        GOOD_SUPPORT,
      ),
    ]);
    expect([...seeded].sort()).toEqual([...RULE_NAMES].sort());
  });

  it("١٧) السقفُ المسموحُ ثلاثةٌ — كما كانَ قبلَ `DEC-18` حرفاً", () => {
    expect(MAX_ALLOWED_CEILING).toBe(3);
  });

  it("١٨) رسالةُ الخرقِ تقولُ البديلَ لا العيبَ وحدَه", () => {
    const [first] = soakWorkMeasureViolations(
      files(GOOD_SOAK.replace("WORK_GROWTH_CEILING);", "3);"), GOOD_SUPPORT),
    );
    expect(first).toBeDefined();
    if (first === undefined) return;
    const message = describeSoakWorkViolation(first);
    expect(message).toContain("engine-work.ts");
    expect(message).toContain("DEC-18");
  });
});
