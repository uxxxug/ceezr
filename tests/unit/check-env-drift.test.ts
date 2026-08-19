/**
 * الغرض: حراسةُ الحارس — `scripts/check-env-drift.ts` هو ما يمنع تكرار عيبٍ وقع
 *    مرّتين في هذا المستودع (OSRM_BASE_URL، وكلّ عائلة TRACKING_*). وفاحصٌ يمرّ
 *    على كلّ شيءٍ صامتاً أسوأ من لا فاحص: يمنح ثقةً لا سند لها في CI أخضر.
 * الحالة: اختبار وحدة فعلي.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import {
  analyse,
  declarationsFromEnvExample,
  declarationsFromRenderYaml,
  isReadInCode,
} from "../../scripts/check-env-drift.ts";

describe("استخراج الإعلانات", () => {
  it("يقرأ سطور KEY= ويتجاهل التعليقات والفراغ", () => {
    const names = declarationsFromEnvExample(
      ["# TELEGRAM_OLD=1", "", "PORT=3000", "  # SPACED_COMMENT=2", "DATABASE_URL=x"].join("\n"),
    ).map((d) => d.name);
    // السطر المعلَّق ليس إعلاناً: لو حُسب لصار كلّ قرارٍ موثَّقٍ بالتعليق مخالفةً.
    expect(names).toEqual(["PORT", "DATABASE_URL"]);
  });

  it("يقرأ مُدخلات - key: من render.yaml ويتجاهل المعلَّقة", () => {
    const names = declarationsFromRenderYaml(
      [
        "      - key: PORT",
        "        sync: false",
        "      # - key: DROPPED",
        "      - key: X_Y",
      ].join("\n"),
    ).map((d) => d.name);
    expect(names).toEqual(["PORT", "X_Y"]);
  });
});

describe("ما يُعدّ قراءةً فعليّة", () => {
  it("الوصول بالنقطة أو بالمفتاح أو بمتغيّر شِل يُعدّ قراءة", () => {
    expect(isReadInCode("FOO_BAR", ["const x = source.FOO_BAR;"])).toBe(true);
    expect(isReadInCode("FOO_BAR", ['process.env["FOO_BAR"]'])).toBe(true);
    // يُركَّب حرفاً بحرف كي لا يُقرأ سلسلةَ قالبٍ ناقصةً في هذا الملفّ نفسه.
    const shellRead = `echo "$\{FOO_BAR}"`.replace("\\", "");
    expect(isReadInCode("FOO_BAR", [shellRead])).toBe(true);
  });

  it("ذكرُ الاسم في تعليقٍ أو نصٍّ حرٍّ ليس قراءة", () => {
    /**
     * هذا هو الفرق الذي يجعل الفاحص ذا معنى. `.env.example` يشرح كلّ متغيّرٍ
     * بتعليقٍ يحمل اسمه، فلو كفى الحضورُ المجرّد لمرّ كلّ متغيّرٍ مُعلَنٍ دائماً
     * — ولصار الفاحص طقساً في CI لا حرساً.
     */
    expect(isReadInCode("FOO_BAR", ["// FOO_BAR يضبط الحدّ الأقصى"])).toBe(false);
    expect(isReadInCode("FOO_BAR", ["const msg = `اضبط FOO_BAR أوّلاً`;"])).toBe(false);
  });
});

describe("التحليل يُسقط الحالتين اللتين وقعتا فعلاً", () => {
  const code = ["const speed = source.TRACKING_MAX_REASONABLE_SPEED_KMH;"];

  it("مُعلَنٌ ولا يُقرأ ⇒ مخالفة تُسمّي الملفّ والسطر", () => {
    const report = analyse("OSRM_BASE_URL=\n", "", code);
    expect(report.declaredButUnread.map((d) => d.name)).toEqual(["OSRM_BASE_URL"]);
    expect(report.declaredButUnread[0]?.file).toBe(".env.example");
    expect(report.declaredButUnread[0]?.line).toBe(1);
  });

  it("اسمٌ في render.yaml لا نظير له في .env.example ⇒ انحراف", () => {
    // الحالة الحقيقيّة: render كان يحمل TRACKING_MAX_SPEED_KMH و.env يحمل
    // TRACKING_MAX_REASONABLE_SPEED_KMH — فمن ضبط الأوّل ضبط اسماً لا يقرؤه أحد.
    const report = analyse(
      "TRACKING_MAX_REASONABLE_SPEED_KMH=200\n",
      "      - key: TRACKING_MAX_SPEED_KMH\n",
      code,
    );
    expect(report.nameDrift).toContain("TRACKING_MAX_SPEED_KMH");
  });

  it("متغيّرٌ مُعلَنٌ ومقروءٌ فعلاً في الموضعين ⇒ لا مخالفة", () => {
    const report = analyse(
      "TRACKING_MAX_REASONABLE_SPEED_KMH=200\n",
      "      - key: TRACKING_MAX_REASONABLE_SPEED_KMH\n",
      code,
    );
    expect(report.declaredButUnread).toEqual([]);
    expect(report.nameDrift).toEqual([]);
  });
});

describe("المستودع الحقيقي في حالته الراهنة", () => {
  it("لا متغيّر مُعلَن غير مقروء ولا انحراف اسم", async () => {
    const [envExample, renderYaml] = await Promise.all([
      Bun.file(".env.example").text(),
      Bun.file("render.yaml").text(),
    ]);
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { extname, join } = await import("node:path");
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry.startsWith(".")) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...walk(full));
        else if ([".ts", ".tsx", ".js", ".mjs", ".sh"].includes(extname(full))) out.push(full);
      }
      return out;
    };
    const sources = ["apps", "packages", "scripts", "docker"]
      .flatMap(walk)
      .map((f) => readFileSync(f, "utf8"));
    const report = analyse(envExample, renderYaml, sources);
    expect(report.declaredButUnread.map((d) => `${d.name} (${d.file}:${d.line})`)).toEqual([]);
    expect(report.nameDrift).toEqual([]);
  });
});
