/**
 * الغرض: حمايةُ **بوابةِ المخطَّطِ المؤجَّلِ** من الانحدارِ. فقبلَ هذهِ البوابةِ
 *   كانَ ملفّا `deferred/core-integration/tests/*` يُفعِّلهما وجودُ
 *   `TEST_DATABASE_URL` وحدَه، فأيُّ تشغيلٍ جُملةٍ (`bun test`) على قاعدةٍ
 *   مُهاجَرةٍ بالمسارِ الرئيسيِّ **بلا هجراتِ التأجيلِ** كان يُشغِّلُهما على جداولٍ
 *   غيرِ موجودةٍ فيُخفِقُ ٤٥ اختبارًا بخطأِ «relation does not exist» — فشلٌ زائفٌ
 *   يُشوِّهُ حكمَ حاجزِ التجاوزِ (`scripts/lib/skip-audit.ts`) ويُقرأَ إخفاقَ منطقٍ
 *   وهو إخفاقُ بيئةٍ. والبوابةُ تتحقَّقُ الآنَ من وجودِ الجداولِ الثلاثةِ قبلَ
 *   التشغيلِ وتتخطَّى بعلةٍ مقروءةٍ إن غابت. وهذا الاختبارُ يمنعُ عودةَ ذلك
 *   بصمتٍ: من يحذفُ التحقُّقَ يسقُطُ هنا لا في تشغيلٍ كاملٍ بعدَ ساعةٍ.
 *
 * الحالة: اختبارُ وحدةٍ فعليٌّ — يقرأُ نصَّ الملفَّينِ لا سلوكَهما (سلوكُهما
 *   مقيسٌ بالتشغيلِ نفسِه في القاعدتَينِ: بالمخطَّطِ ⇒ ٤٥ نجاحًا، وبدونِه ⇒ تخطٍّ).
 * ينتمي إلى: tests/unit · البند `S-2`.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const FILES = [
  "deferred/core-integration/tests/wasla-fulfillment-lifecycle.test.ts",
  "deferred/core-integration/tests/wasla-core-transport.test.ts",
] as const;

/** الجداولُ التي يقيسُ عليها الملفّانِ دورةَ `W-4`/`W-5` المؤجَّلة. */
const REQUIRED_TABLES = ["operational_jobs", "core_event_inbox", "move_event_outbox"] as const;

describe("بوابةُ المخطَّطِ المؤجَّلِ — حاجزٌ لا يُحذفُ بصمتًا", () => {
  for (const file of FILES) {
    test(`"${file}" يتحقَّقُ من مخطَّطِ التأجيلِ قبلَ التشغيلِ`, () => {
      const source = readFileSync(file, "utf8");
      // البوابةُ: استعلامُ وجودِ الجداولِ نفسُها لا مجرَّدُ وجودِ متغيّرِ البيئةِ
      expect(source).toContain("to_regclass");
      for (const table of REQUIRED_TABLES) {
        expect(source).toContain(table);
      }
      // والقرارُ تخطٍّ معلَنٌ بعلةٍ مقروءةٍ لا فشلٌ بخطأِ العلاقةِ المفقودةِ
      expect(source).toContain("describeOnDeferredSchema");
      expect(source).toContain("قاعدةِ الاختبارِ لتفعيلِها");
    });

    test(`"${file}" لا يُفعِّلُ نفسَهُ على قاعدةٍ بلا الجداولِ: البوابةُ تمنعُ الإخفاقَ الزائفَ`, () => {
      const source = readFileSync(file, "utf8");
      // التخطِّي قرارُ الملفِّ نفسِه لا اكتشافُ خطأٍ بعده: `describe.skip` اختيارًا
      expect(source).toMatch(
        /describeOnDeferredSchema = deferredSchemaPresent \? describe : describe\.skip/,
      );
      // والتحقُّقُ لا يُعطِّلُ الملفَّ على قاعدةٍ سليمةٍ: شرطُه وجودُ الجداولِ كلِّها
      const checks = source.match(/to_regclass\('public\.[a-z_]+'\)/g) ?? [];
      expect(checks.length).toBeGreaterThanOrEqual(REQUIRED_TABLES.length);
    });
  }
});
