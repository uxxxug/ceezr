/**
 * الغرض: قياسُ حاجزِ «النافذةُ المحليّةُ ليست ساعةَ الحائطِ» بنصوصٍ **مزروعةٍ** —
 *   سالباتٍ يجبُ أن تُلتقَطَ (ومنها السطرُ الذي أسقطَ CI في `F3-07`) وموجباتٍ
 *   يجبُ ألّا تُلتقَطَ (`ح-٧`).
 * الحالة: مُختبَرٌ — بوّابةُ CI.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وخطوةُ «تحقّق» في CI.
 * يُتوقع أن يستخدمه لاحقاً: كلُّ تعديلٍ على قاعدةِ الحاجزِ — تُقاسُ ههنا لا في
 *   المستودَعِ، فحاجزٌ يُقاسُ بما يصادفُه القرصُ يمرُّ أخضرَ وهوَ معطوبٌ.
 * الحاكم: docs/adr/0123-a-local-window-is-not-the-wall-clock.md
 *
 * ## وما لا يقيسُه هذا الملفُّ عن قصدٍ
 * ــ **لا يمسحُ القرصَ**: ذاكَ عملُ `scripts/check-wall-clock-window-tests.ts`.
 * ــ **لا يقيسُ صدقَ نافذةِ الدالّةِ**: ذاكَ في `tests/integration/driver-activity`.
 */

import { describe, expect, it } from "bun:test";
import {
  ALLOW_MARKER,
  describeWallClockWindowViolation,
  PLANTED_NEGATIVE_FILES,
  TEST_ROOTS,
  wallClockWindowViolationsIn,
} from "../../scripts/lib/wall-clock-window-tests.ts";

const FILE = "tests/integration/some-report.test.ts";

/** قارئُ نافذةٍ محليّةٍ — بدونِه لا معنى للقاعدةِ في الملفِّ. */
const READER = 'select driver_activity_summary(${id}::bigint, "day") as result';

describe("حاجزُ النافذةِ المحليّةِ — سالباتٌ مزروعةٌ تُلتقَطُ", () => {
  it("١) السطرُ الذي أسقطَ CI في `F3-07` يُلتقَطُ بسطرِه", () => {
    const source = [
      READER,
      "await snapshotSetting(KEY_TIMEZONE);",
      'await setSetting(KEY_TIMEZONE, "Asia/Riyadh", "string");',
    ].join("\n");
    const violations = wallClockWindowViolationsIn(FILE, source);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(3);
    expect(violations[0]?.zone).toBe("Asia/Riyadh");
  });

  it("٢) المفتاحُ بحرفِه لا بثابتِه — والكتابةُ بـ`insert` لا بدالّةٍ", () => {
    const source = [
      READER,
      "await sql`insert into platform_settings (city_id, key, value, value_type)",
      "  values (${cityId}, 'city_timezone', to_jsonb('Etc/GMT+3'::text), 'string')`;",
    ].join("\n");
    // الكتابةُ تُقرأُ **كتلةً**: المفتاحُ والمنطقةُ في سطرٍ تالٍ لـ`insert`.
    const violations = wallClockWindowViolationsIn(FILE, source);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(3);
    expect(violations[0]?.zone).toBe("Etc/GMT+3");
  });

  it("٣) كتابةٌ ومفتاحٌ ومنطقةٌ في سطرٍ واحدٍ تُلتقَطُ ولو بـ`withSetting`", () => {
    const source = [
      READER,
      "await withSetting('city_timezone', 'Africa/Cairo', 'string', run);",
    ].join("\n");
    const violations = wallClockWindowViolationsIn(FILE, source);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.zone).toBe("Africa/Cairo");
  });

  it("٤) خرقانِ في ملفٍّ واحدٍ يُعَدَّانِ كِلاهما — لا أوّلُهما وحدَه", () => {
    const source = [
      READER,
      'setSetting(KEY_TIMEZONE, "Asia/Riyadh", "string");',
      'setSetting(KEY_TIMEZONE, "Europe/Paris", "string");',
    ].join("\n");
    expect(wallClockWindowViolationsIn(FILE, source)).toHaveLength(2);
  });

  it("٥) الرسالةُ تقولُ البديلَ والحاكمَ لا العيبَ وحدَه", () => {
    const [violation] = wallClockWindowViolationsIn(
      FILE,
      `${READER}\nsetSetting(KEY_TIMEZONE, "Asia/Riyadh", "string");`,
    );
    if (violation === undefined) throw new Error("لا خرقَ — والحاجزُ لا يُقاسُ بلا سالبٍ");
    const text = describeWallClockWindowViolation(violation);
    expect(text).toContain("Etc/GMT±N");
    expect(text).toContain("ADR 0123");
    expect(text).toContain(ALLOW_MARKER);
  });
});

describe("حاجزُ النافذةِ المحليّةِ — موجباتٌ لا تُلتقَطُ", () => {
  it("٦) ملفٌّ لا يقرأُ نافذةً: تثبيتُ المنطقةِ لا معنى له ههنا", () => {
    const source = 'await setSetting(KEY_TIMEZONE, "Asia/Riyadh", "string");';
    expect(wallClockWindowViolationsIn(FILE, source)).toHaveLength(0);
  });

  it("٧) منطقةٌ **معامِلاً** للدالّةِ الخالصةِ بزمنٍ مُعطىً — قياسُ الحدِّ عندَ حدِّه", () => {
    const source = [
      READER,
      "select driver_activity_window('day'::text, 'Asia/Riyadh'::text,",
      "                              '2026-09-15T22:30:00Z'::timestamptz) as result",
    ].join("\n");
    expect(wallClockWindowViolationsIn(FILE, source)).toHaveLength(0);
  });

  it("٨) منطقةٌ محسوبةٌ لا مكتوبةٌ — وهوَ البديلُ المطلوبُ", () => {
    const source = [
      READER,
      'await setSetting(KEY_TIMEZONE, await middayCityTimezone(), "string");',
    ].join("\n");
    expect(wallClockWindowViolationsIn(FILE, source)).toHaveLength(0);
  });

  it("٩) محوُ الإعدادِ (`null`) لا منطقةَ فيه فلا خرقَ", () => {
    const source = [READER, 'await withSetting(KEY_TIMEZONE, null, "string", run);'].join("\n");
    expect(wallClockWindowViolationsIn(FILE, source)).toHaveLength(0);
  });

  it("١٠) رخصةٌ **مُعلَنةٌ بسببٍ** في السطرِ نفسِه تُقبَلُ", () => {
    const source = [
      READER,
      `await setSetting(KEY_TIMEZONE, "Asia/Riyadh", "string"); // ${ALLOW_MARKER} الأختامُ مطلقةٌ ولا زرعَ نسبيَّ`,
    ].join("\n");
    expect(wallClockWindowViolationsIn(FILE, source)).toHaveLength(0);
  });

  it("١١) التعليقُ العاديُّ يُمحى فلا يُلتقَطُ منهُ خرقٌ وهميٌّ", () => {
    const source = [READER, '// setSetting(KEY_TIMEZONE, "Asia/Riyadh", "string");'].join("\n");
    expect(wallClockWindowViolationsIn(FILE, source)).toHaveLength(0);
  });

  it("١٢) ملفُّ السالباتِ المزروعةِ مُستثنىً بالاسمِ — وهوَ هذا الملفُّ", () => {
    expect(PLANTED_NEGATIVE_FILES.has("tests/unit/check-wall-clock-window-tests.test.ts")).toBe(
      true,
    );
    expect(
      wallClockWindowViolationsIn(
        "tests/unit/check-wall-clock-window-tests.test.ts",
        `${READER}\nsetSetting(KEY_TIMEZONE, "Asia/Riyadh", "string");`,
      ),
    ).toHaveLength(0);
    expect(TEST_ROOTS).toContain("tests");
  });
});
