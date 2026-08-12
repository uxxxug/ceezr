/**
 * الغرض: المرحلة ١٦ — إثباتُ أن حدَّ نطاقِ ADR 0025 **مُنفَّذٌ** لا مُعلَنٌ فقط.
 *
 *   الادّعاءُ المُختبَر ليس «الوثيقةُ تقول خارج النطاق» بل ثلاثةُ أشياء قابلة للقياس:
 *   (١) أن الفاحصَ يكتشف كلَّ نمطٍ من أنماطِ استعمالِ خدمةِ المطابقة الخمسة.
 *   (٢) أن الفاحصَ **لا** يصرخ على ألفاظِ `match` المشروعةِ التي يمتلئ بها
 *       المستودع — لأن حاجزاً كثيرَ الإنذارِ الكاذبِ يُحذَف في أوّلِ أسبوع، فيكون
 *       أسوأَ من عدمه.
 *   (٣) أن كودَ الإنتاجَ الحقيقيَّ اليومَ نظيفٌ — وهذا هو الادّعاءُ الذي يمنع
 *       العودة، لا الوثيقة.
 *
 * الحالة: اختبار وحدة فعلي — لا شبكة ولا قاعدة.
 * ينتمي إلى: tests/unit
 * ملاحظات مستقبلية: حين تُستوفى شروطُ ADR 0025 ويُنسَخ القرار، يُحذف هذا الملفّ
 *   مع الفاحص. حذفُ أحدهما دون الآخر يترك إمّا قيداً بلا إثبات أو إثباتاً بلا قيد.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  collectProductionFiles,
  findMatchServiceUses,
  PRODUCTION_ROOTS,
  SELF,
} from "../../scripts/check-map-matching-scope.ts";

describe("المرحلة ١٦: الفاحص يكتشف استعمالَ خدمة المطابقة", () => {
  it("يكتشف مسارَ الخدمة match/v1", () => {
    const found = findMatchServiceUses('const u = base + "/match/v1/driving/" + path;');
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(1);
  });

  it("يكتشف قراءةَ حقلِ matchings من الردّ", () => {
    expect(findMatchServiceUses("const m = body.matchings ?? [];")).toHaveLength(1);
  });

  it("يكتشف قراءةَ حقلِ tracepoints من الردّ", () => {
    expect(findMatchServiceUses("for (const t of json.tracepoints) {}")).toHaveLength(1);
  });

  it("يكتشف مُعامِلَ gaps الخاصَّ بالمطابقة", () => {
    expect(findMatchServiceUses('const q = p + "?gaps=ignore";')).toHaveLength(1);
  });

  it("يكتشف مُعامِلَ tidy الخاصَّ بالمطابقة", () => {
    expect(findMatchServiceUses('const q = p + "&tidy=true";')).toHaveLength(1);
  });

  it("يُبلّغ رقمَ السطرِ الصحيحَ ونصَّه مُقلَّماً", () => {
    const found = findMatchServiceUses("سطرٌ أول\nسطرٌ ثانٍ\n   const u = `/match/v1/driving`;   ");
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(3);
    expect(found[0]?.text).toBe("const u = `/match/v1/driving`;");
  });

  it("يُبلّغ عن كلّ سطرٍ مخالفٍ لا عن الأوّلِ وحدَه", () => {
    const found = findMatchServiceUses("a.matchings;\nb.tracepoints;\nc = `/match/v1/x`;");
    expect(found.map((v) => v.line)).toEqual([1, 2, 3]);
  });

  /**
   * أقربُ ما يُخشى ليس نداءً صريحاً بل **مخزنُ أثرٍ** يسمّي أعمدتَه بألفاظِ
   * المطابقة، وهو الشرطُ الثالثُ من شروطِ ADR 0025. وهذا ما كان يُفلِت
   * من صيغةٍ أولى بحدودِ كلمة، وقد أراه فحصُ التحوير لا التأمّل.
   */
  it("يكتشف ألفاظَ المطابقة داخلَ أسماءٍ مركّبةٍ كأعمدةِ مخزنِ أثر", () => {
    expect(findMatchServiceUses("readonly driver_tracepoints: string;")).toHaveLength(1);
    expect(findMatchServiceUses("create table route_matchings (")).toHaveLength(1);
  });
});

describe("المرحلة ١٦: الفاحص لا يُنذر كاذباً", () => {
  /**
   * كلُّ سطرٍ هنا مأخوذٌ من نمطٍ قائمٍ فعلاً في المستودع. لو صرخ الفاحصُ على
   * أحدها لصار عائقاً لا حاجزاً، ولأُلغي — فتُفتح الثغرةُ التي كُتب لإغلاقها.
   */
  const مشروع = [
    'import { matchOrder } from "../dispatch/match-order.ts";',
    "for (const match of sql.matchAll(pattern)) {",
    "const name = match[1];",
    "if (!/city_id/.test(body)) return;",
    "const result = await matchOrder(deps, orderId);",
    "readonly matchWeightPreferredArea: number;",
    "// تُطابق المطابقةُ السائقَ بالطلب",
    'const q = base + "/route/v1/driving/" + path + "?overview=full";',
    'const q = base + "/nearest/v1/driving/" + p + "?number=1";',
    'const q = base + "/table/v1/driving/" + p + "?sources=0";',
    "expect(text).toMatch(/دقيقة/);",
    "const tidyName = name.trim();",
  ];

  for (const line of مشروع) {
    it(`لا يصرخ على: ${line.slice(0, 46)}`, () => {
      expect(findMatchServiceUses(line)).toEqual([]);
    });
  }
});

describe("المرحلة ١٦: كودُ الإنتاجِ اليومَ خالٍ من خدمة المطابقة", () => {
  /**
   * السّاحةُ المفحوصةُ جزءٌ من العقد لا تفصيلٌ داخليٌّ: حاجزٌ يفحص `apps` وحدَه
   * يمرّ ناجحاً وهو أعمى عن `packages/maps` — أقربِ موضعٍ تُضاف فيه المطابقة.
   * فالتوكيدُ على الجذورِ نفسِها لا على نتيجةِ الفحصِ وحدها.
   */
  it("يفحص الجذورَ الثلاثةَ كلّها لا واحداً منها", () => {
    expect([...PRODUCTION_ROOTS]).toEqual(["apps", "packages", "scripts"]);
  });

  it("صفرُ استدعاءٍ في apps و packages و scripts", () => {
    const files = collectProductionFiles();
    expect(files.length).toBeGreaterThan(200);
    // الملفّاتُ مجموعةٌ من الجذورِ الثلاثة فعلاً، لا من أوّلِها فحسب.
    for (const root of PRODUCTION_ROOTS) {
      expect(files.some((f) => f.startsWith(`${root}/`))).toBe(true);
    }

    const offenders: string[] = [];
    for (const file of files) {
      if (file === SELF) continue;
      for (const v of findMatchServiceUses(readFileSync(file, "utf8"))) {
        offenders.push(`${file}:${v.line}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("خريطةُ العمليات تُسلّم خطوطاً فارغةً ومعها سببُ الفراغ", () => {
    const source = readFileSync("apps/gateway/src/routes/admin-ui.ts", "utf8");
    expect(source).toContain("polylines: []");
    // الفراغُ بلا سببٍ مكتوبٍ يُقرأ كنقصٍ فيُملأ خطأً — فالسببُ جزءٌ من القيد.
    expect(source).toContain("ADR 0025");
  });
});
