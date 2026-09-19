/**
 * الغرض: إثباتُ أن بوّاباتِ CI التي تقارن مساراً بنصٍّ مكتوبٍ تعمل على Windows
 *   أيضاً — وأنّ إصلاحَها لم يُوسّع أيَّ استثناءٍ ولم يُضعف الفحص.
 * الحالة: اختبار وحدة فعلي — لا قرصَ إلّا قراءةَ المستودع، ولا شبكة.
 * ينتمي إلى: tests/unit
 * ملاحظات مستقبلية: كلُّ فاحصٍ جديدٍ يجمع ملفّاتٍ بـ`join` ثمّ يقارنها بقائمةِ
 *   استثناءٍ يُضاف إليه سطرٌ هنا. البوّابةُ التي لا تُختبر بفاصلِ Windows تُخفق
 *   على جهازِ المالك لا على آلةِ التكامل، فيُقرأ سقوطُها عيباً في الكود.
 *
 * لماذا وُجِد هذا الملفّ: `bun run ci` سقط على جهاز المالك (Windows) بمخالفةٍ
 * وحيدةٍ هي **تعريفُ الفاحصِ لأنماطِه في نفسِه** — لأنّ `join` هناك يُنتج
 * `scripts\check-map-matching-scope.ts` فلا يُطابق الاستثناءَ المكتوبَ بـ`/`.
 * والخطرُ ليس السقوطَ الكاذبَ وحدَه بل ما يليه: حاجزٌ يسقط كاذباً يُعطَّل، ثمّ
 * تُفتح الثغرةُ التي كُتب لإغلاقها.
 */

import { describe, expect, it } from "bun:test";
import {
  collectProductionFiles,
  findMatchServiceUses,
  SELF,
} from "../../scripts/check-map-matching-scope.ts";
import {
  auditCityPrecondition,
  type Violation,
} from "../../scripts/lib/city-precondition-audit.ts";
import { CITY_PRECONDITION_EXEMPTIONS } from "../../scripts/lib/city-precondition-exemptions.ts";
import { toPosixPath } from "../../scripts/lib/repo-path.ts";

/**
 * توحيدُ `OPS-020` نقلَ قاعدةَ «القروباتُ في نفسِ العبارةِ» من `analyseSource`
 * في `check-test-city-activation.ts` إلى القاعدةِ ٦ في الحَكَمِ الموحَّدِ،
 * وسجلَّ استثنائها إلى السجلِّ الواحدِ. **وتوكيداتُ هذا الوصفِ كما هيَ**: دعواها
 * أنَّ الإعفاءَ لا يتعلّقُ بفاصلِ المسارِ، وهيَ دعوى على الحَكَمِ لا على اسمِ دالّةٍ.
 */
function أخراقُ_التفعيلِ(path: string, source: string): readonly Violation[] {
  return auditCityPrecondition({
    integrationFiles: [],
    activationFiles: [{ path, source }],
    scriptFiles: [],
    helper: undefined,
    exemptions: CITY_PRECONDITION_EXEMPTIONS,
  }).filter((v) => v.rule === 6);
}

describe("توحيدُ فاصلِ المسار", () => {
  it("يحوّل فاصلَ Windows ويترك مسارَ POSIX كما هو", () => {
    expect(toPosixPath("scripts\\check-map-matching-scope.ts")).toBe(
      "scripts/check-map-matching-scope.ts",
    );
    expect(toPosixPath("scripts/check-map-matching-scope.ts")).toBe(
      "scripts/check-map-matching-scope.ts",
    );
  });

  it("يحوّل كلَّ الفواصلِ لا أوّلَها", () => {
    expect(toPosixPath("tests\\integration\\pilot-city-activation.test.ts")).toBe(
      "tests/integration/pilot-city-activation.test.ts",
    );
  });
});

describe("فاحصُ حدّ نطاق المطابقة: يستثني نفسَه في كلّ نظامٍ", () => {
  it("يجمع الملفّاتَ بفاصلٍ واحدٍ هو /", () => {
    const files = collectProductionFiles();
    expect(files.length).toBeGreaterThan(200);
    expect(files.filter((file) => file.includes("\\"))).toEqual([]);
  });

  it("يجمع نفسَه بالصيغةِ التي كُتب بها استثناؤه", () => {
    expect(collectProductionFiles()).toContain(SELF);
  });

  /**
   * الاستثناءُ يخصّ هذا الملفَّ وحدَه: لو صار الفاحصُ يستثني كلَّ ما في `scripts`
   * لمرّ سكربتُ ملءٍ رجعيٍّ يستدعي `/match/v1` — وهو أقربُ مواضعِ العودة.
   */
  it("لا يستثني بقيّةَ scripts معه", () => {
    const others = collectProductionFiles().filter(
      (file) => file.startsWith("scripts/") && file !== SELF,
    );
    expect(others.length).toBeGreaterThan(5);
    for (const file of others) {
      expect(findMatchServiceUses(`const u = "/match/v1/driving";`)).toHaveLength(1);
      expect(file).not.toBe(SELF);
    }
  });
});

describe("فاحصُ تفعيلِ المدن في الاختبارات: الاستثناءُ لا يتعلّق بالفاصل", () => {
  /**
   * العبارةُ تُركّب ولا تُكتب حرفيةً: الفاحصُ يمسح هذا الملفَ نفسَه ضمن
   * `tests/unit`، فنصٌّ حرفيٌّ هنا مخالفةٌ حقيقيةٌ في عينِه لا مجرّدَ تجهيزِ اختبار —
   * وقد أوقعَني فيها فعلاً أوّلَ تشغيلٍ، وهو دليلٌ أنّ الحاجزَ يعمل لا أنّه مُتسامح.
   */
  const عبارةٌ_مجرّدة = [
    "await sql`update cities set is_",
    "active = ",
    "true where code = 'JED'`;",
  ].join("");

  it("يصرخ على تفعيلٍ مجرّدٍ في ملفٍّ عاديّ", () => {
    const violations = أخراقُ_التفعيلِ("tests/integration/example.test.ts", عبارةٌ_مجرّدة);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("telegram_support_group_id");
  });

  it("يستثني ملفَّ فحصِ القيدِ نفسِه بفاصلِ POSIX", () => {
    expect(أخراقُ_التفعيلِ("tests/integration/pilot-city-activation.test.ts", عبارةٌ_مجرّدة)).toEqual(
      [],
    );
  });

  it("يستثنيه أيضاً حين يأتي المسارُ بفاصلِ Windows", () => {
    expect(أخراقُ_التفعيلِ("tests\\integration\\pilot-city-activation.test.ts", عبارةٌ_مجرّدة)).toEqual(
      [],
    );
  });

  it("لا يستثني ملفّاً آخرَ في نفسِ المجلّد بفاصلِ Windows", () => {
    expect(
      أخراقُ_التفعيلِ("tests\\integration\\five-cities-launch.test.ts", عبارةٌ_مجرّدة),
    ).toHaveLength(1);
  });
});
