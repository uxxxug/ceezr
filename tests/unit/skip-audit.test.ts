/**
 * الغرض: إثباتُ أنّ حاجزَ تصنيفِ التجاوزِ **يسقط** حيثُ يجب أن يسقط. وحاجزٌ لم
 *   يُبرهَن سقوطُه ليس حاجزاً بل زينةٌ خضراء: فلكلِّ قاعدةٍ ههنا مِسبارٌ يخالفها
 *   وحدَه، ويُنتظَر منه بلاغٌ.
 * الحالة: منفّذ فعلياً — البند `OPS-009` (ADR 0046).
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: كلُّ تعديلٍ في `scripts/lib/skip-audit.ts` أو في
 *   السجلِّ `scripts/lib/skip-registry.ts`.
 * ملاحظات مستقبلية: **السلبيُّ الكاذبُ المُعلَنُ مُثبَّتٌ ههنا بقصدٍ** (تجاوزٌ يُبنى
 *   بحسابِ نصٍّ لا يُكتشَف). ومن يُدخِل مُحلِّلاً نحوياً حقيقياً سيُسقِط ذلك الاختبارَ
 *   فيقرأ سببَه بدلاً من أن يظنّه سهواً.
 *
 * وما لا يفعله: لا يُشغِّل اختباراتِ التكاملِ ولا يتحقّق أنّها تنجح — يتحقّق أنّ
 * تجاوزَها لا يمرّ صامتاً.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  auditRegistry,
  auditRun,
  buildSuiteIndex,
  findSkipSites,
  parseCiSteps,
  parseTestLog,
  type RegistryAuditInput,
} from "../../scripts/lib/skip-audit.ts";
import { SKIP_REGISTRY, type SkipEntry } from "../../scripts/lib/skip-registry.ts";

/**
 * تُبنى صيغُ التجاوزِ في المسابرِ **بحسابٍ لا حرفاً**. والسببُ مبدئيٌّ لا تجميليٌّ:
 * لو كُتِبت حرفاً لعدّها الحاجزُ تجاوزاً غيرَ مشروطٍ **في ملفِّ الاختبارِ نفسِه** —
 * وهذا يُثبِت أنّ الحاجزَ يقرأ النصَّ لا النيّةَ، وهو حدُّه المُعلَنُ عينُه.
 */
const form = (fn: string, kind: string): string => `${fn}.${kind}`;

const GATED_SOURCE = [
  "const databaseUrl = process.env.TEST_DATABASE_URL;",
  `const describeIf = databaseUrl === undefined ? ${form("describe", "skip")} : describe;`,
  'describeIf("حزمةٌ على قاعدةٍ حقيقية", () => {});',
].join("\n");

const BASE_ENTRY: SkipEntry = {
  file: "tests/integration/sample.test.ts",
  suites: ["حزمةٌ على قاعدةٍ حقيقية"],
  skipped: 4,
  gate: "TEST_DATABASE_URL",
  reason:
    "يُثبِت سلوكَ المحرّكِ نفسِه — القيودَ والمعاملاتِ والترتيبَ تحت التزامن — ولا يُثبَت ذلك ببديلٍ في الذاكرة.",
  activation: "تُضبَط TEST_DATABASE_URL على قاعدةٍ حقيقيّةٍ بالهجرات مطبَّقة، ويفعله CI في وظيفةِ التكامل.",
  owner: "منفّذ المستودع",
  criticalPath: "دورةُ الرحلةِ والإسناد",
  runsIn: "اختبارات التكامل على قاعدة حقيقية",
  whyNotRun: null,
};

function baseInput(overrides: Partial<RegistryAuditInput> = {}): RegistryAuditInput {
  return {
    registry: [BASE_ENTRY],
    sources: new Map([[BASE_ENTRY.file, GATED_SOURCE]]),
    ciSteps: [
      {
        name: "اختبارات التكامل على قاعدة حقيقية",
        env: ["TEST_DATABASE_URL"],
        run: "set -o pipefail; bun run test:integration 2>&1 | tee /tmp/ci-output.log",
      },
    ],
    scriptPaths: new Map([["test:integration", "tests/integration"]]),
    ...overrides,
  };
}

describe("findSkipSites — يفرّق بين التعليقِ بشرطٍ والتجاوزِ الدائم", () => {
  it("يقرأ الاختيارَ الشرطيَّ تجاوزاً مشروطاً مقبولاً", () => {
    const sites = findSkipSites(GATED_SOURCE);
    expect(sites).toHaveLength(1);
    expect(sites[0]?.unconditional).toBe(false);
    expect(sites[0]?.form).toBe(form("describe", "skip"));
  });

  it("يرفض النداءَ المباشرَ لأنّه تجاوزٌ لا يعلّقه شرطٌ", () => {
    const sites = findSkipSites(`${form("describe", "skip")}("حزمةٌ معطَّلةٌ", () => {});`);
    expect(sites[0]?.unconditional).toBe(true);
  });

  it.each([
    ["it", "only"],
    ["test", "todo"],
    ["it", "failing"],
  ])("يرفض الصيغةَ الممنوعةَ منعاً مطلقاً: %s.%s", (fn, kind) => {
    const sites = findSkipSites(`${form(fn, kind)}("حالةٌ", () => {});`);
    expect(sites[0]?.form).toBe(form(fn, kind));
    expect(sites[0]?.unconditional).toBe(true);
  });

  it("يقبل التعليقَ بشرطٍ صريحٍ — صيغةَ `.if`", () => {
    const sites = findSkipSites(`${form("describe", "if")}(available)("منصّةُ القياس", () => {});`);
    expect(sites[0]?.unconditional).toBe(false);
  });

  it("لا يقرأ تجاوزاً مذكوراً في تعليقٍ — وهذا يمنع بلاغاً كاذباً", () => {
    expect(findSkipSites(`// مثالٌ: ${form("describe", "skip")}("لا يُنفَّذ")`)).toHaveLength(0);
  });

  it("السلبيُّ الكاذبُ المُعلَنُ: تجاوزٌ يُبنى بحسابِ نصٍّ يُفلِت", () => {
    expect(findSkipSites('describe["sk" + "ip"]("يُفلِت", () => {});')).toHaveLength(0);
  });
});

describe("parseCiSteps — قراءةٌ نصّيّةٌ لخطواتِ سيرِ العمل", () => {
  it("يقرأ الاسمَ ومفاتيحَ البيئةِ ونصَّ التشغيل", () => {
    const steps = parseCiSteps(
      [
        "jobs:",
        "  verify:",
        "    steps:",
        "      - name: خطوةٌ أولى",
        "        env:",
        "          TEST_DATABASE_URL: postgres://x",
        "        run: bun run test:integration",
        "      - name: خطوةٌ ثانية",
        "        run: |",
        "          echo مرحباً",
      ].join("\n"),
    );
    expect(steps).toHaveLength(2);
    expect(steps[0]?.env).toEqual(["TEST_DATABASE_URL"]);
    expect(steps[0]?.run).toContain("test:integration");
    expect(steps[1]?.env).toEqual([]);
  });

  it("لا يقرأ خطوةً من سطرٍ معلَّقٍ", () => {
    expect(parseCiSteps("      # - name: خطوةٌ موهومة")).toHaveLength(0);
  });

  it("خطواتُ ملفِّ سيرِ العملِ الحقيقيِّ التي يُسنِد إليها السجلُّ موجودةٌ وتضبط الشرطَ", () => {
    const steps = parseCiSteps(readFileSync(".github/workflows/ci.yml", "utf8"));
    for (const entry of SKIP_REGISTRY) {
      if (entry.runsIn === null) {
        continue;
      }
      const step = steps.find((candidate) => candidate.name === entry.runsIn);
      expect(step, `الخطوةُ «${entry.runsIn}» غيرُ موجودةٍ`).toBeDefined();
      expect(step?.env).toContain(entry.gate);
    }
  });
});

describe("parseTestLog — يقرأ ما طبعه المُشغِّلُ لا ما كتبه المطوّرُ", () => {
  const log = [
    "tests/integration/sample.test.ts:",
    "(skip) حزمةٌ على قاعدةٍ حقيقية > حالةٌ أولى",
    "(skip) حزمةٌ على قاعدةٍ حقيقية > حالةٌ أولى",
    "(skip) حزمةٌ على قاعدةٍ حقيقية > حالةٌ ثانية",
    "",
    " 12 pass",
    " 3 skip",
    " 0 fail",
  ].join("\n");

  it("يُسنِد الحالاتَ إلى ملفِّها ويطوي التكرارَ", () => {
    const reading = parseTestLog(log);
    expect(reading.pass).toBe(12);
    expect(reading.skip).toBe(3);
    expect(reading.skippedByFile.get("tests/integration/sample.test.ts")).toHaveLength(2);
    expect(reading.unattributed).toEqual([]);
  });

  it("حالةٌ متجاوَزةٌ قبلَ أيِّ عنوانِ ملفٍّ تُعَدُّ غيرَ مُسنَدةٍ لا مغتفَرةً", () => {
    const reading = parseTestLog("(skip) حالةٌ يتيمةٌ\n 1 pass\n 1 skip");
    expect(reading.unattributed).toEqual(["حالةٌ يتيمةٌ"]);
    expect(auditRun(reading, []).length).toBeGreaterThan(0);
  });

  it("سجلٌّ بلا ملخَّصٍ إخفاقٌ — لا يُستنتَج نجاحٌ من غيابِ دليلٍ", () => {
    expect(auditRun(parseTestLog("لا شيءَ مفيدٌ ههنا"), []).length).toBeGreaterThan(0);
  });
});

/**
 * صيغةُ البيئةِ المُدارةِ عيبٌ حقيقيٌّ سقط فيه هذا القارئُ في التشغيلِ `33252715645`:
 * المُشغِّلُ يطبع بادئةَ تجميعٍ لكلِّ ملفٍّ، **ويجمع كلَّ الحالاتِ المتجاوَزةِ في كتلةٍ
 * واحدةٍ في آخرِ التشغيلِ** — فالإسنادُ بعنوانِ الملفِّ السابقِ نسب تجاوزَ ملفٍّ إلى
 * ملفٍّ آخرَ وأسقط البناءَ بمخالفةٍ **مُختلَقةٍ**. وهذه المسابرُ تُثبِّت الصيغتَين معاً.
 */
describe("parseTestLog — صيغةُ البيئةِ المُدارةِ: بادئةُ تجميعٍ وكتلةٌ مجمَّعةٌ في الآخر", () => {
  const suiteToFile = new Map([
    ["حزمةُ منصّةِ القياس", "tests/integration/bench.test.ts"],
    ["حزمةُ الأمنِ الهجوميّ", "tests/integration/security.test.ts"],
  ]);
  const escapeChar = String.fromCharCode(27);
  const managedLog = [
    "::group::tests/integration/security.test.ts",
    `${escapeChar}[32m(pass) حزمةُ الأمنِ الهجوميّ > حالةٌ ناجحةٌ${escapeChar}[0m`,
    "::endgroup::",
    "::group::tests/integration/bench.test.ts",
    "::endgroup::",
    "2 tests skipped:",
    "(skip) حزمةُ منصّةِ القياس > حالةٌ أولى",
    "(skip) حزمةُ منصّةِ القياس > حالةٌ ثانية",
    " 446 pass",
    " 2 skip",
    " 0 fail",
  ].join("\n");

  it("يُسنِد كتلةَ الآخرِ بعنوانِ الحزمةِ لا بآخرِ ملفٍّ طُبِع قبلَها", () => {
    const reading = parseTestLog(managedLog, suiteToFile);
    expect(reading.skip).toBe(2);
    expect(reading.skippedByFile.get("tests/integration/bench.test.ts")).toHaveLength(2);
    expect(reading.skippedByFile.has("tests/integration/security.test.ts")).toBe(false);
    expect(reading.unattributed).toEqual([]);
  });

  it("العيبُ نفسُه بلا الخريطةِ: الكتلةُ المجمَّعةُ لا تُنسَب إلى آخرِ ملفٍّ", () => {
    const reading = parseTestLog(managedLog);
    expect(reading.skippedByFile.size).toBe(0);
    expect(reading.unattributed).toHaveLength(2);
  });

  it("عنوانُ الحزمةِ يُسنِد أيضاً في الصيغةِ المتداخلةِ المحليّةِ", () => {
    const local = [
      "tests/integration/security.test.ts:",
      "(skip) حزمةُ منصّةِ القياس > حالةٌ أولى",
      " 5 pass",
      " 1 skip",
    ].join("\n");
    const reading = parseTestLog(local, suiteToFile);
    expect(reading.skippedByFile.get("tests/integration/bench.test.ts")).toHaveLength(1);
    expect(reading.skippedByFile.has("tests/integration/security.test.ts")).toBe(false);
  });
});

describe("buildSuiteIndex — تفرُّدُ العنوانِ شرطُ صحّةِ الإسنادِ لا ترتيبٌ", () => {
  it("السجلُّ الحقيقيُّ لا عنوانَ حزمةٍ مكرَّراً فيه", () => {
    expect(buildSuiteIndex(SKIP_REGISTRY).duplicates).toEqual([]);
    expect(buildSuiteIndex(SKIP_REGISTRY).index.size).toBeGreaterThanOrEqual(SKIP_REGISTRY.length);
  });

  it("عنوانٌ مكرَّرٌ في ملفَّين يُعاد صريحاً ويصير مخالفةً في auditRegistry", () => {
    const first: SkipEntry = { ...BASE_ENTRY, file: "tests/integration/one.test.ts" };
    const second: SkipEntry = { ...BASE_ENTRY, file: "tests/integration/two.test.ts" };
    expect(buildSuiteIndex([first, second]).duplicates).toHaveLength(BASE_ENTRY.suites.length);
    expect(
      auditRegistry(baseInput({ registry: [first, second] })).some((violation) =>
        violation.includes("عنوانُ حزمةٍ مكرَّرٌ"),
      ),
    ).toBe(true);
  });
});

describe("auditRegistry — الحالةُ السليمةُ تمرّ", () => {
  it("لا مخالفةَ على مدخلٍ مكتملٍ يطابق الشيفرةَ وسيرَ العمل", () => {
    expect(auditRegistry(baseInput())).toEqual([]);
  });
});

describe("auditRegistry — برهانُ السقوط: مِسبارٌ لكلِّ قاعدة", () => {
  const probes: readonly (readonly [string, RegistryAuditInput])[] = [
    ["تجاوزٌ غيرُ مُصنَّفٍ في ملفٍّ ليس في السجلّ", baseInput({ registry: [] })],
    [
      "مدخلٌ بائتٌ لملفٍّ لم يبقَ فيه تجاوزٌ",
      baseInput({
        sources: new Map([[BASE_ENTRY.file, "const x = 1;"]]),
      }),
    ],
    [
      "تجاوزٌ غيرُ مشروطٍ ممنوعٌ ولو كان الملفُّ مسجَّلاً",
      baseInput({
        sources: new Map([
          [BASE_ENTRY.file, `${GATED_SOURCE}\n${form("describe", "skip")}("معطَّلةٌ", () => {});`],
        ]),
      }),
    ],
    [
      "السجلُّ يزعم شرطاً لا يقرؤه الملفُّ",
      baseInput({ registry: [{ ...BASE_ENTRY, gate: "OTHER_DATABASE_URL" }] }),
    ],
    [
      "مالكٌ خارجَ القائمةِ المغلقة",
      baseInput({ registry: [{ ...BASE_ENTRY, owner: "أحدٌ ما" as never }] }),
    ],
    [
      "مسارٌ حرجٌ خارجَ القائمةِ المغلقة",
      baseInput({ registry: [{ ...BASE_ENTRY, criticalPath: "شيءٌ" as never }] }),
    ],
    ["سببٌ أقصرُ من أن يكون سبباً", baseInput({ registry: [{ ...BASE_ENTRY, reason: "لأنّه كذا" }] })],
    ["شرطُ تفعيلٍ أقصرُ من أن يُنفَّذ", baseInput({ registry: [{ ...BASE_ENTRY, activation: "بيئةٌ" }] })],
    ["عددٌ مقيسٌ دونَ الواحد", baseInput({ registry: [{ ...BASE_ENTRY, skipped: 0 }] })],
    ["حزمٌ فارغةٌ", baseInput({ registry: [{ ...BASE_ENTRY, suites: [] }] })],
    ["مدخلٌ مكرَّرٌ", baseInput({ registry: [BASE_ENTRY, BASE_ENTRY] })],
    [
      "مُشغِّلٌ مزعومٌ لا وجودَ لخطوتِه",
      baseInput({ registry: [{ ...BASE_ENTRY, runsIn: "خطوةٌ موهومةٌ" }] }),
    ],
    [
      "الخطوةُ المُعلَنةُ لا تضبط شرطَ التفعيل",
      baseInput({
        ciSteps: [
          {
            name: "اختبارات التكامل على قاعدة حقيقية",
            env: [],
            run: "bun run test:integration",
          },
        ],
      }),
    ],
    [
      "الخطوةُ المُعلَنةُ لا تُشغِّل مسارَ الملفّ",
      baseInput({
        ciSteps: [
          {
            name: "اختبارات التكامل على قاعدة حقيقية",
            env: ["TEST_DATABASE_URL"],
            run: "bun test tests/unit",
          },
        ],
      }),
    ],
    [
      "تجاوزٌ على مسارٍ حرجٍ بلا مُشغِّلٍ — وهو عينُ ما يمنعه البند",
      baseInput({
        registry: [
          {
            ...BASE_ENTRY,
            runsIn: null,
            whyNotRun: "لا خطوةَ في CI تضبط شرطَه، وهو مُعلَنٌ دَيناً حتى تُضاف خطوةٌ مستقلّةٌ له.",
          },
        ],
      }),
    ],
    [
      "لا مُشغِّلَ ولا بيانَ مكتوبٌ",
      baseInput({
        registry: [{ ...BASE_ENTRY, criticalPath: null, runsIn: null, whyNotRun: null }],
      }),
    ],
    [
      "مُشغِّلٌ مُعلَنٌ ومعه بيانُ «لا يعمل» — تناقضٌ",
      baseInput({
        registry: [{ ...BASE_ENTRY, whyNotRun: "بيانٌ لا موضعَ له لأنّ له مُشغِّلاً مُعلَناً في السجلّ." }],
      }),
    ],
    ["سجلٌّ فارغٌ ومستودعٌ بلا تجاوزٍ — مرورٌ خاوٍ", baseInput({ registry: [], sources: new Map() })],
  ];

  for (const [label, input] of probes) {
    it(`يسقط على: ${label}`, () => {
      expect(auditRegistry(input).length).toBeGreaterThan(0);
    });
  }
});

describe("auditRun — التشغيلُ الحقيقيُّ", () => {
  const unrunEntry: SkipEntry = {
    ...BASE_ENTRY,
    file: "tests/integration/bench.test.ts",
    criticalPath: null,
    runsIn: null,
    whyNotRun: "لا خطوةَ في CI تضبط شرطَه اليوم، وهو مُعلَنٌ دَيناً لا مُخضَّراً في السجلّ.",
  };
  const logFor = (file: string, skip: number): string =>
    [`${file}:`, "(skip) حزمةٌ > حالةٌ", " 9 pass", ` ${skip} skip`, " 0 fail"].join("\n");

  it("يمرّ على تجاوزٍ في ملفٍّ مُعلَنٍ أنّه لا مُشغِّلَ له", () => {
    expect(auditRun(parseTestLog(logFor(unrunEntry.file, 4)), [unrunEntry])).toEqual([]);
  });

  it("يسقط على تجاوزٍ في ملفٍّ له مُشغِّلٌ مُعلَنٌ — لأنّه كان يجب أن يعمل", () => {
    expect(auditRun(parseTestLog(logFor(BASE_ENTRY.file, 4)), [BASE_ENTRY]).length).toBeGreaterThan(
      0,
    );
  });

  it("يسقط إن زاد المتجاوَزُ على السقفِ المقيسِ في السجلّ", () => {
    expect(auditRun(parseTestLog(logFor(unrunEntry.file, 99)), [unrunEntry]).length).toBe(1);
  });

  it("يمرّ على تشغيلٍ بلا تجاوَزٍ ولا سطرَ skip — والمُشغِّلُ لا يطبعه حينئذٍ", () => {
    expect(auditRun(parseTestLog(" 10 pass\n 0 fail"), [BASE_ENTRY])).toEqual([]);
  });

  it("يسقط على تشغيلٍ لم تنجح فيه حالةٌ واحدةٌ", () => {
    expect(auditRun(parseTestLog(" 0 pass\n 0 skip\n 0 fail"), []).length).toBeGreaterThan(0);
  });
});

describe("السجلُّ الحقيقيُّ — أرقامٌ مقيسةٌ مُثبَّتةٌ", () => {
  /**
   * الأعدادُ مُثبَّتةٌ عن قصدٍ: ملفٌّ جديدٌ فيه تجاوزٌ **يُسقِط هذا الاختبارَ** فيُقرَأ
   * السجلُّ ويُصنَّف الملفُّ صراحةً. و514 في خمسةٍ وخمسين ملفّاً قياسُ `OPS-009` يومَ
   * 2026-08-29؛ والاثنتا عشرةَ الزائدةُ في الملفِّ السادسِ والخمسين قياسُ `OPS-006` يومَ
   * 2026-08-30 — ملفُّ Redis الحقيقيِّ يعمل في وظيفتِه ويُتجاوَز حيث لا نقطةَ له.
   * والثمانِ الزائدةُ في الملفِّ السابعِ والخمسين قياسُ `BUG-009` يومَ 2026-09-02 —
   * حزمةُ ترتيبِ أحداثِ التتبُّعِ، شرطَ `ADR 0053 §٨` قاعدةً حقيقيّةً لحالتَيها ١ و٧.
   * والعشرُ الزائدةُ في الملفِّ الثامنِ والخمسين قياسُ `BUG-001` يومَ 2026-09-02 —
   * حزمةُ الكتابةِ الشرطيّةِ على الموقعِ القانونيِّ، وسباقُها لا يُقاس إلَّا على قاعدةٍ
   * حقيقيّةٍ فيُتجاوَز حيث لا `TEST_DATABASE_URL`.
   * والسبعُ الزائدةُ في الملفِّ التاسعِ والخمسين قياسُ `BUG-005` يومَ 2026-09-03 —
   * حزمةُ ذرّيّةِ فتحِ دورةِ البثِّ، وسباقُها وتراجُعُها لا يُقاسانِ إلَّا على قاعدةٍ
   * حقيقيّةٍ فيُتجاوَزانِ حيث لا `TEST_DATABASE_URL`.
   * والسبعُ الزائدةُ في الملفِّ الستّينَ قياسُ `BUG-008` يومَ 2026-09-03 — حزمةُ تمييزِ
   * التسليمِ المكرَّرِ من فقدانِ السباقِ، ولا يُقاسُ فائزٌ وخاسرٌ وإعادةُ تسليمٍ إلَّا
   * على قاعدةٍ حقيقيّةٍ فيُتجاوَزُ حيث لا `TEST_DATABASE_URL`.
   * والخمسُ الزائدةُ في الملفِّ الحاديَ والستّينَ قياسُ `BUG-002` يومَ 2026-09-04 —
   * حزمةُ الاستلامِ الصامدِ لتحديثاتِ تيليجرام، ولا تُقاسُ ذرّيّةُ الإيداعِ ولا بقاءُ
   * القرارِ بعدَ موتِ العمليةِ إلَّا على قاعدةٍ حقيقيّةٍ فتُتجاوَزُ حيث لا
   * `TEST_DATABASE_URL`.
   * والثلاثُ الزائدةُ في الملفِّ الثانيَ والستّينَ قياسُ `BUG-003` يومَ 2026-09-05 —
   * حزمةُ تحديدِ نطاقِ الرفضِ بمعرّفِ عرضٍ واحدٍ، ولا يُقاسُ قرارُ القاعدةِ نفسِها
   * (أنّ الرفضَ يُغيّرُ صفّاً واحداً ويتركُ عرضَ الجولةِ الأخرى معلَّقاً) إلَّا على قاعدةٍ
   * حقيقيّةٍ فيُتجاوَزُ حيث لا `TEST_DATABASE_URL`.
   * والثمانُ الزائدةُ في الملفِّ الثالثِ والستّينَ قياسُ `BUG-004` — صندوقُ صادرِ
   * الإشعارِ: أنَّ صفَّ الإشعارِ يُكتَبُ في معاملةِ تغييرِ الحالةِ نفسِها وأنَّ المطالبةَ
   * والإتمامَ والتركَ ذرّيةٌ، ولا يُقاسُ ذلك إلَّا على قاعدةٍ حقيقيّةٍ فيُتجاوَزُ حيث
   * لا `TEST_DATABASE_URL`.
   * والستُّ الزائدةُ في الملفِّ الرابعِ والستّينَ قياسُ `BUG-004` كذلك — نوعُ قرارِ
   * الدعمِ في صندوقِ الصادرِ الموحَّدِ: أنَّ التبليغَ يُودَعُ في معاملةِ القرارِ نفسِها،
   * وأنَّ رجوعَ المعاملةِ لا يُبقي صفًّا، وأنَّ إعادةَ الإرسالِ لا تُكرِّرُ الأثرَ، ولا
   * يُقاسُ ذلك إلَّا على قاعدةٍ حقيقيّةٍ فيُتجاوَزُ حيث لا `TEST_DATABASE_URL`.
   * والسبعُ الزائدةُ في الملفِّ الخامسِ والستّينَ قياسُ `BUG-004` كذلك — أنواعُ دورةِ
   * غيرِ المشتركينِ الثلاثةُ: أنَّ إخطارَ الدورِ يُودَعُ في معاملةِ الضغطةِ نفسِها،
   * وأنَّ فشلَ جانبٍ يُعادُ وحدَه بلا تكرارِ أثرٍ على مَن وصلَه، ولا يُقاسُ ذلك إلَّا
   * على قاعدةٍ حقيقيّةٍ فيُتجاوَزُ حيث لا `TEST_DATABASE_URL`.
   * والسبعُ الزائدةُ في الملفِّ السادسِ والستّينَ قياسُ `BUG-004` كذلك — إخطارا
   * صاحبِ الطلبِ العالقِ: أنَّ خبرَ الدائرةِ الأوسعِ يُودَعُ في معاملةِ فتحِ الدورةِ
   * نفسِها وخبرَ «لا سائقَ» في معاملةِ أوّلِ تسليمٍ، وأنَّ الخبرَ واحدٌ لا يتكرّرُ
   * بدورةٍ ثانيةٍ ولا بشوطٍ ثانٍ، ولا يُقاسُ ذلك إلّا على قاعدةٍ حقيقيّةٍ فيُتجاوَزُ
   * حيث لا `TEST_DATABASE_URL`.
   * والستُّ الزائدةُ في الملفِّ السابعِ والستّينَ قياسُ `BUG-004` كذلك — إخطارُ إلغاءِ
   * الراكبِ: أنَّ صفًّا لكلِّ سائقٍ يُودَعُ في معاملةِ الإلغاءِ نفسِها والإسنادُ يغلبُ
   * العرضَ، وأنَّ فشلَ سائقٍ يُعادُ له وحدَه فلا يصلُ مَن وصلَه إخطارٌ ثانٍ، ولا يُقاسُ
   * ذلك إلّا على قاعدةٍ حقيقيّةٍ فيُتجاوَزُ حيث لا `TEST_DATABASE_URL`.
   * والستُّ الزائدةُ في الملفِّ التاسعِ والستّينَ قياسُ `CAP-002` — طابورُ الموتى في
   * صندوقِ الصادرِ: أنَّ سقفَ المحاولاتِ يُنفَّذُ في المحرِّكِ فيموتُ الصفُّ بـ
   * `MAX_ATTEMPTS` ولا يُلتقَطُ بعدَها، وأنَّ التراجعَ أُسّيٌّ، وأنَّ رمزاً لا يملكُ
   * الصفَّ يُرفَضُ بلا أثرٍ؛ ولا يُقاسُ ذلك إلّا على قاعدةٍ حقيقيّةٍ فيُتجاوَزُ حيث لا
   * `TEST_DATABASE_URL`.
   * **والأعدادُ تُرفَع ولا تُخفَّض**: الاختبارُ حرزٌ على التصنيفِ لا سقفٌ على العملِ.
   */
  it("تسعةٌ وستّونَ ملفّاً و613 حالةً — 514 قياسُ OPS-009 و12 لـOPS-006 و8 لـBUG-009 و10 لـBUG-001 و7 لـBUG-005 و7 لـBUG-008 و5 لـBUG-002 و3 لـBUG-003 و34 لـBUG-004 و7 لـCAP-003 و6 لـCAP-002", () => {
    expect(SKIP_REGISTRY).toHaveLength(69);
    expect(SKIP_REGISTRY.reduce((sum, entry) => sum + entry.skipped, 0)).toBe(613);
  });

  it("لا تجاوزَ على مسارٍ حرجٍ بلا مُشغِّلٍ، وما لا مُشغِّلَ له مُعلَنٌ ببيانٍ", () => {
    const unrun = SKIP_REGISTRY.filter((entry) => entry.runsIn === null);
    expect(unrun).toHaveLength(1);
    expect(unrun[0]?.file).toBe("tests/integration/bench-reset-seed.test.ts");
    for (const entry of unrun) {
      expect(entry.criticalPath).toBeNull();
      expect((entry.whyNotRun ?? "").length).toBeGreaterThan(40);
    }
  });
});
