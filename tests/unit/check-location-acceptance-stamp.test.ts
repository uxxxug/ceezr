/**
 * الغرض: اختبارُ حاجزِ صدقِ `drivers.last_location_at` (`F4-05` · `CAP-009` ·
 *    ADR-0076): يُثبِتُ أنَّ المستودعَ اليومَ نظيفٌ، و**أنَّ الحاجزَ يُخفِقُ فعلاً
 *    عندَ كلِّ صورةٍ من صورِ الخرقِ الخمسِ** — لا أنَّه يُنفَّذُ فحسبُ.
 * الحالة: منفّذ فعلياً — 2026-09-10 · البند `F4-05`.
 * ينتمي إلى: tests/unit
 *
 * ## لماذا الأغلبُ سالبٌ
 *
 * حاجزٌ يُثبَتُ نجاحُه على شيفرةٍ سليمةٍ لم يُثبَتْ منه شيءٌ: تعليقٌ يُنفَّذُ
 * يفعلُ ذلك. والقيمةُ كلُّها في السالبِ — أن نُغذِّيَه نصّاً مخروقاً فيصرخَ.
 * وهذه العلّةُ عينُها كانَت قد كشفَت خطأً في التعبيرِ النمطيِّ لحاجزِ `F4-03`.
 */

import { describe, expect, test } from "bun:test";
import {
  assignmentsOf,
  BATCH_ADAPTER,
  batchFunctionMigrations,
  COLUMN,
  CONTRACT_MODULE,
  FIELD_SQL,
  FIELD_TS,
  findCodeLine,
  findViolations,
  INTAKE_MODULE,
  isCommentLine,
  MIGRATIONS_DIR,
  readMigrations,
  type SourceFile,
} from "../../scripts/check-location-acceptance-stamp.ts";

/** نسخٌ سليمةٌ مُصغَّرةٌ من الملفّاتِ الثلاثةِ — أساسُ كلِّ حالةٍ سالبةٍ. */
const CLEAN_CONTRACT = `export interface HotLocationFix {\n  readonly recordedAtMs: number;\n  readonly ${FIELD_TS}: number | null;\n}\n`;
const CLEAN_INTAKE = `const hot = await deps.hotState.record({\n      recordedAtMs: assessment.fix.recordedAtMs,\n      ${FIELD_TS}: nowMs,\n    });\n`;
const CLEAN_ADAPTER = `const batch = fixes.map((fix) => ({\n          recorded_at_ms: fix.recordedAtMs,\n          ${FIELD_SQL}: fix.observedAtMs,\n        }));\n`;

const CLEAN_MIGRATION: SourceFile = {
  path: `${MIGRATIONS_DIR}/20260910200000_f4_05.sql`,
  source: [
    `create or replace function persist_driver_location_batch(`,
    `  p_city_id uuid, p_batch jsonb) returns jsonb as $$`,
    `           ${COLUMN} = n.observed_at,`,
    `           last_location_recorded_at = n.recorded_at,`,
    `           updated_at = now()`,
    `$$;`,
  ].join("\n"),
};

function readerFor(files: Record<string, string | null>): (path: string) => string | null {
  return (path) => files[path] ?? null;
}

const CLEAN_FILES = {
  [CONTRACT_MODULE]: CLEAN_CONTRACT,
  [INTAKE_MODULE]: CLEAN_INTAKE,
  [BATCH_ADAPTER]: CLEAN_ADAPTER,
};

describe("حاجزُ صدقِ last_location_at — المستودعُ الحقيقيُّ", () => {
  test("لا خرقَ في المستودعِ كما هوَ الآنَ", () => {
    expect(findViolations()).toEqual([]);
  });

  test("مجلّدُ الهجراتِ مقروءٌ وفيه من يُعرِّفُ دالّةَ الدفعةِ", () => {
    const writers = batchFunctionMigrations(readMigrations());
    expect(writers.length).toBeGreaterThan(0);
  });

  test("أحدثُ هجرةٍ حاكمةٍ هي هجرةُ هذا البندِ — والأحدثُ آخراً", () => {
    const writers = batchFunctionMigrations(readMigrations());
    expect(writers[writers.length - 1]?.path).toContain(
      "f4_05_last_location_at_is_acceptance_time",
    );
  });

  test("النسخُ المُصغَّرةُ السليمةُ تمرُّ — فالسالبُ بعدَها يعني الخرقَ لا الهيكلَ", () => {
    expect(findViolations(readerFor(CLEAN_FILES), [CLEAN_MIGRATION])).toEqual([]);
  });
});

describe("حاجزُ صدقِ last_location_at — الحالاتُ السالبةُ", () => {
  test("١) عقدُ الإصلاحةِ بلا حقلِ لحظةِ القبولِ يُخفِقُ", () => {
    const violations = findViolations(
      readerFor({
        ...CLEAN_FILES,
        [CONTRACT_MODULE]: `export interface HotLocationFix {\n  readonly recordedAtMs: number;\n}\n`,
      }),
      [CLEAN_MIGRATION],
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe(CONTRACT_MODULE);
    expect(violations[0]?.why).toContain(FIELD_TS);
  });

  test("١-ب) عقدٌ غائبٌ كلّيّاً يُخفِقُ ولا يُقرأُ نجاحاً", () => {
    const violations = findViolations(readerFor({ ...CLEAN_FILES, [CONTRACT_MODULE]: null }), [
      CLEAN_MIGRATION,
    ]);
    expect(violations.some((v) => v.file === CONTRACT_MODULE)).toBe(true);
  });

  test("١-ج) إعلانُ الحقلِ في تعليقٍ وحدَه لا يُقبَلُ", () => {
    const violations = findViolations(
      readerFor({
        ...CLEAN_FILES,
        [CONTRACT_MODULE]: `export interface HotLocationFix {\n  // readonly ${FIELD_TS}: number | null;\n}\n`,
      }),
      [CLEAN_MIGRATION],
    );
    expect(violations.some((v) => v.file === CONTRACT_MODULE)).toBe(true);
  });

  test("٢) استقبالٌ لا يُمرِّرُ الحقلَ يُخفِقُ", () => {
    const violations = findViolations(
      readerFor({
        ...CLEAN_FILES,
        [INTAKE_MODULE]: `const hot = await deps.hotState.record({\n      recordedAtMs: 1,\n    });\n`,
      }),
      [CLEAN_MIGRATION],
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe(INTAKE_MODULE);
  });

  test("٢-ب) قراءةٌ ثانيةٌ للساعةِ (`Date.now()`) بدلَ `nowMs` تُخفِقُ", () => {
    const violations = findViolations(
      readerFor({ ...CLEAN_FILES, [INTAKE_MODULE]: `      ${FIELD_TS}: Date.now(),\n` }),
      [CLEAN_MIGRATION],
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.why).toContain("nowMs");
  });

  test("٢-ج) طابعُ الجهازِ مكانَ لحظةِ القبولِ يُخفِقُ", () => {
    const violations = findViolations(
      readerFor({
        ...CLEAN_FILES,
        [INTAKE_MODULE]: `      ${FIELD_TS}: assessment.fix.recordedAtMs,\n`,
      }),
      [CLEAN_MIGRATION],
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe(INTAKE_MODULE);
  });

  test("٣) محوّلٌ لا يُرسِلُ الاسمَ الحرفيَّ يُخفِقُ — وهوَ العطبُ الصامتُ", () => {
    const violations = findViolations(
      readerFor({
        ...CLEAN_FILES,
        [BATCH_ADAPTER]: `const batch = fixes.map((fix) => ({\n          observedAtMs: fix.observedAtMs,\n        }));\n`,
      }),
      [CLEAN_MIGRATION],
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.why).toContain(FIELD_SQL);
  });

  test("٤) هجرةٌ حاكمةٌ تكتبُ `now()` تُخفِقُ", () => {
    const broken: SourceFile = {
      path: `${MIGRATIONS_DIR}/29990101000000_regression.sql`,
      source: `create or replace function persist_driver_location_batch(a uuid) returns jsonb as $$\n           ${COLUMN} = now(),\n$$;`,
    };
    const violations = findViolations(readerFor(CLEAN_FILES), [CLEAN_MIGRATION, broken]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe(broken.path);
    expect(violations[0]?.line).toBe(2);
  });

  test("٤-ب) هجرةٌ **أقدمُ** فيها `now()` لا تُخفِقُ — الأحدثُ هوَ الحاكمُ", () => {
    const old: SourceFile = {
      path: `${MIGRATIONS_DIR}/20260909140000_f4_02.sql`,
      source: `create or replace function persist_driver_location_batch(a uuid) returns jsonb as $$\n           ${COLUMN} = now(),\n$$;`,
    };
    expect(findViolations(readerFor(CLEAN_FILES), [old, CLEAN_MIGRATION])).toEqual([]);
  });

  test("٤-ج) هجرةٌ حاكمةٌ لا تكتبُ العمودَ بحالٍ تُخفِقُ — الجمودُ عطبٌ آخرُ", () => {
    const silent: SourceFile = {
      path: `${MIGRATIONS_DIR}/29990101000000_silent.sql`,
      source: `create or replace function persist_driver_location_batch(a uuid) returns jsonb as $$\n           last_location_recorded_at = n.recorded_at,\n$$;`,
    };
    const violations = findViolations(readerFor(CLEAN_FILES), [CLEAN_MIGRATION, silent]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.why).toContain("بحالٍ");
  });

  test("٤-د) صفرُ هجراتٍ تُعرِّفُ الدالّةَ = خرقٌ لا نجاحٌ", () => {
    const violations = findViolations(readerFor(CLEAN_FILES), []);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe(MIGRATIONS_DIR);
  });

  test("٥) أيُّ هجرةٍ تُسنِدُ طابعَ الجهازِ إلى عمودِ زمنِ الخادمِ تُخفِقُ", () => {
    const device: SourceFile = {
      path: `${MIGRATIONS_DIR}/20260101000000_device.sql`,
      source: `update drivers set ${COLUMN} = n.recorded_at;`,
    };
    const violations = findViolations(readerFor(CLEAN_FILES), [device, CLEAN_MIGRATION]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe(device.path);
    expect(violations[0]?.why).toContain("يُزوَّرُ");
  });

  test("٥-ب) `where` على العمودِ ليسَ كتابةً فيه — ولا يُقرأُ خرقاً", () => {
    const readOnly: SourceFile = {
      path: `${MIGRATIONS_DIR}/20260101000000_read.sql`,
      source: `select 1 from drivers where ${COLUMN} < now() - interval '1 hour';`,
    };
    expect(findViolations(readerFor(CLEAN_FILES), [readOnly, CLEAN_MIGRATION])).toEqual([]);
  });

  test("٥-ج) العمودُ الأطولُ اسماً لا يُلتقَطُ بالخطأِ", () => {
    // `last_location_recorded_at = …` تحوي `last_location_at`? لا — لكنَّ العكسَ
    // (بادئةٌ مشتركةٌ) هوَ ما يُختَبَرُ: إسنادٌ لعمودٍ آخرَ لا يُعَدُّ إسناداً لهذا.
    expect(assignmentsOf(`  last_location_accuracy_m = 5,`, COLUMN)).toEqual([]);
    expect(assignmentsOf(`  drivers_last_location_at = now(),`, COLUMN)).toEqual([]);
  });
});

describe("الدوالُّ الصغيرةُ — حدودُها مُختبَرةٌ لا مفترَضةٌ", () => {
  test("سطرُ التعليقِ يُعرَفُ بأشكالِه الثلاثةِ", () => {
    expect(isCommentLine("  // x")).toBe(true);
    expect(isCommentLine("-- x")).toBe(true);
    expect(isCommentLine(" * x")).toBe(true);
    expect(isCommentLine("const x = 1; // y")).toBe(false);
  });

  test("`findCodeLine` يتجاوزُ التعليقَ ويُعيدُ رقمَ السطرِ من واحدٍ", () => {
    expect(findCodeLine("// hit\nconst hit = 1;\n", "hit")).toBe(2);
    expect(findCodeLine("// hit only\n", "hit")).toBe(null);
  });

  test("`assignmentsOf` يقرأُ الإسنادَ بمسافاتٍ وبلا مسافاتٍ", () => {
    expect(assignmentsOf(`  ${COLUMN}=now(),`, COLUMN)).toHaveLength(1);
    expect(assignmentsOf(`  ${COLUMN}   =   n.observed_at,`, COLUMN)).toHaveLength(1);
    expect(assignmentsOf(`  -- ${COLUMN} = now()`, COLUMN)).toHaveLength(0);
  });

  test("`readMigrations` على مجلّدٍ غيرِ موجودٍ يُعيدُ فراغاً لا يرمي", () => {
    expect(readMigrations("supabase/does-not-exist")).toEqual([]);
  });
});
