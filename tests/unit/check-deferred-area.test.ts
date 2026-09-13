/**
 * الغرض: إثباتُ أنَّ حاجزَ منطقةِ التأجيلِ (`ADR 0095`) **يُسقِطُ** فعلاً عندَ كلِّ
 *   صنفٍ من الخللِ الذي يزعمُ منعَه: استيرادٌ من `deferred/` في الشجرةِ الحيّةِ،
 *   وهجرةٌ مؤجَّلةٌ لها توأمٌ مُطبَّقٌ، ومجلّدٌ مؤجَّلٌ بلا بيانٍ أو ببيانٍ ناقصٍ.
 *   وحاجزٌ لا يُختبَرُ سقوطُه حاجزٌ مزعومٌ: أخضرُه لا يشهدُ بشيءٍ لأنَّه لا يعرفُ
 *   أن يحمَرَّ.
 * الحالة: اختبارُ وحدةٍ فعليٌّ.
 * ينتمي إلى: tests/unit · البند `S-2`.
 * يُتوقع أن يستخدمه لاحقاً: CI، وأيُّ تعديلٍ على `scripts/check-deferred-area.ts`.
 * ملاحظات مستقبلية: إن أُضيفَ مجلّدٌ مؤجَّلٌ ثانٍ فتُضافُ ههنا حالتاه: بيانٌ
 *   مستوفٍ يُقبَلُ، وبيانٌ ناقصٌ يُرفَضُ بالتفصيلِ المتوقَّعِ.
 */

import { describe, expect, test } from "bun:test";
import {
  type DeferredInputs,
  defaultInputs,
  deferredProblems,
} from "../../scripts/check-deferred-area.ts";

const SOUND_README =
  "## البند\n`S-2` · `O-7`\n\n## القرار\nADR 0094 · ADR 0095\n\n## شرطُ الاستئناف\nقرارُ مالكٍ صريحٌ.";

function base(overrides: Partial<DeferredInputs> = {}): DeferredInputs {
  return {
    sources: [{ file: "apps/gateway/src/index.ts", text: 'import { x } from "./routes/x.ts";' }],
    deferredMigrations: ["20260911100000_w4_operational_jobs.sql"],
    appliedMigrationNames: ["20260806120000_phase_2_1_core_schema.sql"],
    readmes: [{ dir: "core-integration", text: SOUND_README }],
    ...overrides,
  };
}

const details = (problems: readonly { detail: string }[]) =>
  problems.map((problem) => problem.detail).join(" | ");

describe("منطقةُ التأجيلِ — الحاجزُ أخضرُ على المستودعِ كما هوَ", () => {
  test("لا مخالفةَ واحدةً في المُدخلِ الحقيقيِّ الكاملِ", () => {
    expect(deferredProblems(defaultInputs())).toEqual([]);
  });

  test("المُدخلُ الحقيقيُّ يقرأُ شجرةً حيّةً غيرَ فارغةٍ — وإلّا فالأخضرُ كاذبٌ", () => {
    const inputs = defaultInputs();
    expect(inputs.sources.length).toBeGreaterThan(500);
    expect(inputs.deferredMigrations.length).toBe(6);
    // مجلّدانِ مؤجَّلانِ منذُ `S-4`: `core-integration` و`field-experiments`.
    expect(inputs.readmes.length).toBe(2);
  });

  test("مُدخلٌ سليمٌ مُختلَقٌ يمرُّ — كي يُعرَفَ أنَّ السقوطَ لاحقاً سببُه الخللُ لا الحاجزُ", () => {
    expect(deferredProblems(base())).toEqual([]);
  });
});

describe("منطقةُ التأجيلِ — يُسقِطُ عندَ الخللِ", () => {
  test("`import ... from` من المؤجَّلِ في الشجرةِ الحيّةِ يُسقِطُ الحاجزَ", () => {
    const problems = deferredProblems(
      base({
        sources: [
          {
            file: "apps/gateway/src/index.ts",
            text: 'import { job } from "../../../deferred/core-integration/src/job.ts";',
          },
        ],
      }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.where).toBe("apps/gateway/src/index.ts");
    expect(details(problems)).toContain("ليسَ تأجيلاً");
  });

  test("`require` و`import()` الديناميُّ لا يفلتانِ من الكشفِ", () => {
    for (const text of [
      'const j = require("../deferred/core-integration/src/job.ts");',
      'const j = await import("../deferred/core-integration/src/job.ts");',
    ]) {
      const problems = deferredProblems(
        base({ sources: [{ file: "packages/application/x.ts", text }] }),
      );
      expect(problems).toHaveLength(1);
    }
  });

  test('`import "..."` بلا أسماءٍ (أثرٌ جانبيٌّ) يُكشَفُ — وهوَ أخطرُها لأنَّه أخفاها', () => {
    const problems = deferredProblems(
      base({
        sources: [
          { file: "apps/workers/src/container.ts", text: 'import "../../deferred/x/boot.ts";' },
        ],
      }),
    );
    expect(problems).toHaveLength(1);
  });

  test("ذكرُ المسارِ في نصٍّ أو تعليقٍ لا يُقرأُ استيراداً — ولا يُسقِطُ بالباطلِ", () => {
    expect(
      deferredProblems(
        base({
          sources: [
            {
              file: "scripts/check-x.ts",
              text: '// الهجراتُ في deferred/core-integration/migrations لا تُطبَّقُ\nconst dir = "deferred/core-integration/migrations";',
            },
          ],
        }),
      ),
    ).toEqual([]);
  });

  test("المُعلِنُ المُستثنى بالاسمِ يمرُّ، وغيرُه لا يمرُّ بالنصِّ نفسِه", () => {
    const text = 'import { a } from "../deferred/core-integration/tests/x.test.ts";';
    expect(
      deferredProblems(base({ sources: [{ file: "scripts/lib/migration-sources.ts", text }] })),
    ).toEqual([]);
    expect(
      deferredProblems(base({ sources: [{ file: "scripts/lib/other.ts", text }] })),
    ).toHaveLength(1);
  });

  test("هجرةٌ مؤجَّلةٌ لها توأمٌ بالاسمِ في مسارِ التطبيقِ تُسقِطُ الحاجزَ", () => {
    const problems = deferredProblems(
      base({
        deferredMigrations: ["20260911100000_w4_operational_jobs.sql"],
        appliedMigrationNames: ["20260911100000_w4_operational_jobs.sql"],
      }),
    );
    expect(problems).toHaveLength(1);
    expect(details(problems)).toContain("التوأمُ يُبطِلُ التأجيلَ صامتاً");
  });

  test("مجلّدٌ مؤجَّلٌ بلا `README.md` يُسقِطُ الحاجزَ", () => {
    const problems = deferredProblems(base({ readmes: [{ dir: "core-integration", text: null }] }));
    expect(problems).toHaveLength(1);
    expect(details(problems)).toContain("مقبرةٌ لا قرارٌ");
  });

  test("بيانٌ ناقصُ الأقسامِ يُسقِطُ الحاجزَ ويُسمّي الناقصَ بالاسمِ", () => {
    const problems = deferredProblems(
      base({ readmes: [{ dir: "core-integration", text: "## البند\n`S-2`" }] }),
    );
    expect(problems).toHaveLength(1);
    expect(details(problems)).toContain("القرار");
    expect(details(problems)).toContain("شرطُ الاستئناف");
  });
});
