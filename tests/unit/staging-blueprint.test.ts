/**
 * `F9-01` · `OPS-001` · `ADR 0206` — staging مُشتقّةٌ من الإنتاجِ.
 *
 * لكلِّ قاعدةٍ في الحكمِ سالبةٌ مزروعةٌ تُفسِدُ مُدخلَها ويُرفَضُ الاختبارُ إن لم
 * يسقطِ الحكمُ (`ح-7`)، ويُفحَصُ الملفُّ الحقيقيُّ في المستودعِ لا نسخةٌ منه.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { analyse } from "../../scripts/check-instance-invariant";
import {
  deriveStagingBlueprint,
  dimensionFindings,
  f901ItemText,
  OPS001_DIMENSIONS,
  PRODUCTION_BLUEPRINT,
  STAGING_BLUEPRINT,
  STAGING_HEADER,
  STAGING_PROVISIONING_BLOCKERS,
  STAGING_SUFFIX,
  StagingDerivationError,
  serviceNames,
  stagingFindings,
} from "../../scripts/lib/staging-blueprint";

const production = readFileSync(PRODUCTION_BLUEPRINT, "utf8");
const committed = readFileSync(STAGING_BLUEPRINT, "utf8");
const roadmap = readFileSync("docs/ROADMAP-MASTER.md", "utf8");
const itemLine = f901ItemText(roadmap) ?? "";

const MINIMAL = [
  "# رأسٌ",
  "services:",
  "  - type: web",
  "    name: svc-a # تعليق",
  "    runtime: docker",
  "    envVars:",
  "      - key: NODE_ENV",
  "        value: production",
  "  - type: worker",
  "    name: svc-b",
  "",
].join("\n");

describe("الاشتقاقُ", () => {
  test("الملفُّ المحفوظُ يساوي اشتقاقَ render.yaml الحقيقيِّ بايتاً ببايتٍ", () => {
    expect(committed).toBe(deriveStagingBlueprint(production));
    expect(stagingFindings(production, committed)).toEqual([]);
  });

  test("كلُّ خدمةٍ إنتاجيّةٍ لها أختٌ في staging باللاحقةِ وحدَها، وبالترتيبِ نفسِه", () => {
    const prod = serviceNames(production);
    // 2026-10-02: البوّابةُ الجامعةُ والتطبيقُ المصغَّرُ (الخطّةُ المجّانيّةُ).
    expect(prod.length).toBeGreaterThanOrEqual(2);
    expect(serviceNames(committed)).toEqual(prod.map((name) => `${name}${STAGING_SUFFIX}`));
  });

  test("ما بعدَ «services:» لا يختلفُ إلا في أسطرِ الأسماءِ", () => {
    const body = (text: string) => text.slice(text.indexOf("\nservices:\n")).split("\n");
    const a = body(production);
    const b = body(committed);
    expect(b.length).toBe(a.length);
    const differing = a.flatMap((line, index) => (line === b[index] ? [] : [line]));
    expect(differing.length).toBe(serviceNames(production).length);
    for (const line of differing) expect(line).toMatch(/^( {2}- | {4})name:/);
  });

  test("المُشتقُّ بعدَ نزعِ اللاحقةِ يمرُّ على حاجزِ شرطِ الصحّةِ كالأصلِ (R-17 · BUG-016)", () => {
    const unsuffixed = committed
      .replaceAll(`${STAGING_SUFFIX}\n`, "\n")
      .replaceAll(`${STAGING_SUFFIX} `, " ");
    expect(analyse(unsuffixed)).toEqual(analyse(production));
    expect(analyse(production)).toEqual([]);
  });

  test("حتميٌّ: اشتقاقانِ متتاليانِ متطابقانِ، والرأسُ ثابتٌ", () => {
    expect(deriveStagingBlueprint(MINIMAL)).toBe(deriveStagingBlueprint(MINIMAL));
    expect(deriveStagingBlueprint(MINIMAL).startsWith(STAGING_HEADER)).toBe(true);
    expect(deriveStagingBlueprint(MINIMAL)).toContain("    name: svc-a-staging # تعليق");
    expect(deriveStagingBlueprint(MINIMAL)).not.toContain("# رأسٌ");
  });

  test("أسماءُ الترويساتِ (مسافاتٌ ثمانٍ) لا تُمَسُّ", () => {
    const withHeader = MINIMAL.replace(
      "    runtime: docker\n",
      "    runtime: docker\n    headers:\n      - path: /*\n        name: X-Frame-Options\n",
    );
    expect(deriveStagingBlueprint(withHeader)).toContain("        name: X-Frame-Options\n");
  });
});

describe("سالباتٌ مزروعةٌ (ح-7)", () => {
  test("تعديلُ متغيّرٍ في المُولَّدِ باليدِ ⇒ STAGING_DRIFT", () => {
    const tampered = committed.replace("value: production", "value: development");
    expect(tampered).not.toBe(committed);
    expect(stagingFindings(production, tampered).map((f) => f.code)).toContain("STAGING_DRIFT");
  });

  test("تعديلُ render.yaml بلا إعادةِ توليدٍ ⇒ STAGING_DRIFT", () => {
    const changed = production.replace("plan: free", "plan: standard");
    expect(changed).not.toBe(production);
    expect(stagingFindings(changed, committed).map((f) => f.code)).toContain("STAGING_DRIFT");
  });

  test("ملفُّ staging غائبٌ ⇒ STAGING_MISSING لا تخطٍّ", () => {
    expect(stagingFindings(production, null).map((f) => f.code)).toEqual(["STAGING_MISSING"]);
  });

  test("خدمةٌ في staging باسمٍ إنتاجيٍّ ⇒ STAGING_NAME_COLLISION", () => {
    const colliding = committed.replace(
      `name: waslah-gateway${STAGING_SUFFIX}`,
      "name: waslah-gateway",
    );
    const codes = stagingFindings(production, colliding).map((f) => f.code);
    expect(codes).toContain("STAGING_NAME_COLLISION");
  });

  test("مُدخلٌ بلا services: ⇒ DERIVATION_FAILED لا نجاحٌ على غيرِ مفهومٍ", () => {
    expect(() => deriveStagingBlueprint("# فارغ\n")).toThrow(StagingDerivationError);
    expect(stagingFindings("# فارغ\n", committed).map((f) => f.code)).toEqual([
      "DERIVATION_FAILED",
    ]);
  });

  test("خدمةٌ بلا اسمٍ أو باسمَينِ ⇒ يرمي", () => {
    expect(() => deriveStagingBlueprint(MINIMAL.replace("    name: svc-b\n", ""))).toThrow(
      StagingDerivationError,
    );
    expect(() =>
      deriveStagingBlueprint(
        MINIMAL.replace("    name: svc-b\n", "    name: svc-b\n    name: svc-c\n"),
      ),
    ).toThrow(StagingDerivationError);
  });

  test("اشتقاقٌ فوقَ اشتقاقٍ ⇒ يرمي", () => {
    expect(() => deriveStagingBlueprint(committed)).toThrow(StagingDerivationError);
  });
});

describe("أبعادُ OPS-001", () => {
  test("كلُّ بعدٍ مُصنَّفٌ ويردُ في نصِّ F9-01، وكلُّ حاجزٍ له صفٌّ في الخارطةِ", () => {
    expect(itemLine.startsWith("بيئة staging")).toBe(true);
    expect(itemLine).not.toContain("`[ ]`");
    expect(dimensionFindings(itemLine, roadmap)).toEqual([]);
    expect(OPS001_DIMENSIONS.length).toBe(11);
    expect(new Set(OPS001_DIMENSIONS.map((d) => d.dimension)).size).toBe(11);
  });

  test("كلُّ بعدٍ خارجيٍّ بحاجزٍ، ولا مُنفَذَ يحملُ حاجزاً", () => {
    for (const entry of OPS001_DIMENSIONS) {
      if (entry.status === "external") expect(entry.blockers.length).toBeGreaterThan(0);
      else expect(entry.blockers).toEqual([]);
    }
  });

  test("سالبةٌ: بعدٌ لا يردُ في النصِّ ⇒ DIMENSION_UNACCOUNTED", () => {
    const withoutWaf = itemLine.replace("WAF", "");
    expect(dimensionFindings(withoutWaf, roadmap).map((f) => f.code)).toContain(
      "DIMENSION_UNACCOUNTED",
    );
  });

  test("سالبةٌ: حاجزٌ مُحالٌ إليه بلا صفٍّ ⇒ DIMENSION_UNACCOUNTED", () => {
    const withoutReq04 = roadmap.replace(/^\| REQ-04 \|/m, "| REQ-XX |");
    expect(dimensionFindings(itemLine, withoutReq04).map((f) => f.code)).toContain(
      "DIMENSION_UNACCOUNTED",
    );
    const withoutReq01 = roadmap.replace(/^\| REQ-01 \|/m, "| REQ-XX |");
    expect(STAGING_PROVISIONING_BLOCKERS).toContain("REQ-01");
    expect(dimensionFindings(itemLine, withoutReq01).length).toBeGreaterThan(0);
  });
});
