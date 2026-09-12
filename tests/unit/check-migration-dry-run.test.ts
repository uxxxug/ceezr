/**
 * الغرض: إثباتُ أنَّ حارسَ `W-8` **يُخفِقُ فعلاً**. وكلُّ اختبارٍ ههنا يُفسِدُ
 *   مُدخلاً واحداً ويُثبِتُ ظهورَ المشكلةِ المقصودةِ بعينِها؛ فحارسٌ لم يُقَسْ
 *   إخفاقُه حارسٌ مُدَّعىً. ثمَّ اختباراتٌ لمنطقِ الاشتقاقِ نفسِه: أنَّ
 *   `RECONCILED` **غيرُ قابلةٍ للبناءِ** بلا إشهادٍ.
 * الحالة: منفّذ فعلياً — `W-8`.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: كلُّ تعديلٍ على المسابرِ أو على مفرداتِ التسويةِ.
 * ملاحظات مستقبلية: عندَ إغلاقِ `DEP-CORE-007` يُضافُ اختبارٌ موجَبٌ لـ`RECONCILED`
 *   بإشهادٍ حقيقيٍّ، ولا يُحذَفُ اختبارُ المنعِ: يُنقَلُ إلى شرطِ الإشهادِ.
 */

import { describe, expect, it } from "bun:test";
import {
  coreEnvironmentDependencyOpen,
  type DryRunInputs,
  dryRunProblems,
  extractSlice,
  generatedSlice,
  stripCommentsAndDocs,
  withGeneratedBlock,
} from "../../scripts/check-migration-dry-run.ts";
import {
  buildProbeStatement,
  type CoreSide,
  columnsFromSchema,
  DRY_RUN_BEGIN,
  DRY_RUN_PROBES,
  DRY_RUN_RESERVED_WAVES,
  deriveReconciliation,
  entryConditionOf,
  probesForWave,
  READ_ONLY_SQLSTATE,
  wavesThatTouchRows,
} from "../../scripts/lib/wasla-migration-dry-run.ts";

const SCHEMA = `
create table if not exists users (
  id uuid primary key,
  city_id uuid not null,
  role text not null,
  phone text
);
create table if not exists riders (
  id uuid primary key,
  city_id uuid not null
);
create table if not exists admin_sessions (
  id uuid primary key,
  city_id uuid not null
);
create table if not exists admin_login_codes (
  id uuid primary key,
  city_id uuid not null
);
create table if not exists orders (
  id uuid primary key,
  city_id uuid not null,
  status text not null
);
create table if not exists operational_jobs (
  id uuid primary key,
  state text not null
);
`;

const ROADMAP_OPEN = "- `DEP-CORE-007` MOVE has no shared CORE environment. Open.";
const ROADMAP_CLOSED = "- `DEP-CORE-007` shared CORE environment. CLOSED at commit `abc1234`.";

function baseInputs(): DryRunInputs {
  const probes = DRY_RUN_PROBES.map((probe) => ({
    table: probe.table,
    groupBy: probe.groupBy,
    measures: probe.measures,
  }));
  const inputs: DryRunInputs = {
    toolSource: [
      "import { NO_CORE_READER } from './lib/x.ts';",
      "const begin = 'BEGIN TRANSACTION READ ONLY';",
      "await client.unsafe('ROLLBACK');",
      "await reconcile(reports, NO_CORE_READER);",
      "const client = await pool.reserve();",
    ].join("\n"),
    libSource: "export const DRY_RUN_BEGIN = 'BEGIN TRANSACTION READ ONLY';",
    schemaSql: SCHEMA,
    roadmapText: ROADMAP_OPEN,
    docText: "",
    probes,
    reservedWaves: DRY_RUN_RESERVED_WAVES,
  };
  return {
    ...inputs,
    docText: `x${"<!-- BEGIN GENERATED: dry-run-and-reconciliation -->"}${generatedSlice(inputs)}${"<!-- END GENERATED: dry-run-and-reconciliation -->"}`,
  };
}

function checksOf(inputs: DryRunInputs): string[] {
  return dryRunProblems(inputs).map((problem) => problem.check);
}

describe("الحارسُ لا يُخفِقُ على مُدخلٍ سليمٍ", () => {
  it("لا مشكلةَ حينَ يكونُ كلُّ شيءٍ في موضعِه", () => {
    expect(dryRunProblems(baseInputs())).toEqual([]);
  });

  it("والسجلُّ الحقيقيُّ نفسُه يمرُّ — فالاختبارُ يقيسُ الشيفرةَ لا مزدوجاً وحدَه", () => {
    for (const probe of DRY_RUN_PROBES) {
      expect(probe.groupBy.length).toBeGreaterThan(0);
      expect(probe.measures.trim().length).toBeGreaterThan(40);
    }
  });
});

describe("١. لا فعلَ كتابةٍ في وحدةِ التشغيلِ الجافِّ", () => {
  for (const verb of [
    "INSERT",
    "UPDATE",
    "DELETE",
    "TRUNCATE",
    "DROP",
    "ALTER",
    "COPY",
    "COMMIT",
  ]) {
    it(`يُخفِقُ حينَ تظهرُ \`${verb}\` في شيفرةٍ مُنفَّذةٍ`, () => {
      const inputs = baseInputs();
      const problems = dryRunProblems({
        ...inputs,
        toolSource: `${inputs.toolSource}\nawait client.unsafe('${verb} INTO t VALUES (1)');`,
      });
      expect(problems.some((problem) => problem.check.startsWith("١."))).toBe(true);
      expect(problems.some((problem) => problem.detail.includes(verb))).toBe(true);
    });
  }

  it("ولا يُخفِقُ حينَ تُذكَرُ في تعليقٍ — وإلّا لَخفَّفَ المُراجعُ الحارسَ", () => {
    const inputs = baseInputs();
    const problems = dryRunProblems({
      ...inputs,
      toolSource: `/** لا INSERT ولا UPDATE ولا DELETE ههنا. */\n// TRUNCATE ممنوعةٌ\n${inputs.toolSource}`,
    });
    expect(problems.some((problem) => problem.check.startsWith("١."))).toBe(false);
  });
});

describe("٢. الإنفاذُ قائمٌ لا منزوعٌ", () => {
  it("يُخفِقُ حينَ تُنزَعُ `READ ONLY` من السجلِّ", () => {
    const inputs = baseInputs();
    expect(checksOf({ ...inputs, libSource: "export const DRY_RUN_BEGIN = 'BEGIN';" })).toContain(
      "٢. الإنفاذُ قائمٌ في الشيفرةِ",
    );
  });

  it("يُخفِقُ حينَ يُنزَعُ حجزُ الاتّصالِ — والعطبُ كشفَهُ القياسُ لا المراجعةُ", () => {
    const inputs = baseInputs();
    const problems = dryRunProblems({
      ...inputs,
      toolSource: inputs.toolSource.replace("await pool.reserve()", "pool"),
    });
    expect(problems.some((problem) => problem.detail.includes("reserve()"))).toBe(true);
    expect(problems.some((problem) => problem.detail.includes("يستطيعُ الكتابةَ"))).toBe(true);
  });

  it("يُخفِقُ حينَ يُنزَعُ `ROLLBACK` من الأداةِ", () => {
    const inputs = baseInputs();
    const problems = dryRunProblems({
      ...inputs,
      toolSource: inputs.toolSource.replace("await client.unsafe('ROLLBACK');", ""),
    });
    expect(problems.some((problem) => problem.detail.includes("ROLLBACK"))).toBe(true);
  });
});

describe("٣. كلُّ عمودِ تجميعٍ موجودٌ في المخطَّطِ", () => {
  it("يُخفِقُ حينَ يُجمَّعُ بعمودٍ لا وجودَ لهُ", () => {
    const inputs = baseInputs();
    const problems = dryRunProblems({
      ...inputs,
      probes: [{ table: "users", groupBy: ["tenant_id"], measures: "س".repeat(60) }],
    });
    expect(problems.some((problem) => problem.detail.includes("tenant_id"))).toBe(true);
  });

  it("يُخفِقُ حينَ يُقاسُ جدولٌ لا وجودَ لهُ في المخطَّطِ", () => {
    const inputs = baseInputs();
    const problems = dryRunProblems({
      ...inputs,
      probes: [{ table: "ghost_table", groupBy: ["city_id"], measures: "س".repeat(60) }],
    });
    expect(problems.some((problem) => problem.detail.includes("ghost_table"))).toBe(true);
  });

  it("يُخفِقُ حينَ يكونُ المِسبارُ بلا عمودِ تجميعٍ", () => {
    const inputs = baseInputs();
    const problems = dryRunProblems({
      ...inputs,
      probes: [{ table: "users", groupBy: [], measures: "س".repeat(60) }],
    });
    expect(problems.some((problem) => problem.detail.includes("بلا عمودِ تجميعٍ"))).toBe(true);
  });

  it("يُخفِقُ حينَ يكونُ المِسبارُ بلا سببِ قياسٍ مقروءٍ", () => {
    const inputs = baseInputs();
    const problems = dryRunProblems({
      ...inputs,
      probes: [{ table: "users", groupBy: ["city_id"], measures: "قياسٌ" }],
    });
    expect(problems.some((problem) => problem.detail.includes("بلا سببِ قياسٍ"))).toBe(true);
  });

  it("و`operational_jobs` بلا `city_id` في المخطَّطِ فعلاً — فالمِسبارُ صادقٌ لا مُتحفِّظٌ", () => {
    const columns = columnsFromSchema(SCHEMA).get("operational_jobs");
    expect(columns?.has("city_id")).toBe(false);
    expect(columns?.has("state")).toBe(true);
  });
});

describe("٤ و ٥. الطرفانِ: لا جدولَ بلا مِسبارٍ، ولا مِسبارَ خارجَ الحجزِ", () => {
  it("يُخفِقُ حينَ يُحذَفُ مِسبارُ جدولٍ محجوزٍ", () => {
    const inputs = baseInputs();
    const problems = dryRunProblems({
      ...inputs,
      probes: inputs.probes.filter((probe) => probe.table !== "users"),
    });
    expect(problems.some((problem) => problem.check.startsWith("٤."))).toBe(true);
    expect(problems.some((problem) => problem.detail.includes("users"))).toBe(true);
  });

  it("يُخفِقُ حينَ يُحذَفُ مِسبارُ `orders` — والموجةُ ٦ محجوزةٌ كالأولى", () => {
    const inputs = baseInputs();
    const problems = dryRunProblems({
      ...inputs,
      probes: inputs.probes.filter((probe) => probe.table !== "orders"),
    });
    expect(problems.some((problem) => problem.detail.includes("orders"))).toBe(true);
  });

  it("يُخفِقُ حينَ يُضافُ مِسبارٌ لموجةٍ غيرِ محجوزةٍ", () => {
    const inputs = baseInputs();
    const problems = dryRunProblems({
      ...inputs,
      schemaSql: `${SCHEMA}\ncreate table if not exists cities (\n  id uuid primary key,\n  city_id uuid\n);\n`,
      probes: [
        ...inputs.probes,
        { table: "cities", groupBy: ["city_id"], measures: "س".repeat(60) },
      ],
    });
    expect(problems.some((problem) => problem.check.startsWith("٥."))).toBe(true);
  });

  it("يُخفِقُ حينَ يُضافُ مِسبارٌ لجدولٍ لا سطرَ لهُ في المصفوفةِ ولا إعلانَ", () => {
    const inputs = baseInputs();
    const problems = dryRunProblems({
      ...inputs,
      schemaSql: `${SCHEMA}\ncreate table if not exists invented (\n  id uuid primary key,\n  state text\n);\n`,
      probes: [
        ...inputs.probes,
        { table: "invented", groupBy: ["state"], measures: "س".repeat(60) },
      ],
    });
    expect(problems.some((problem) => problem.detail.includes("DRY_RUN_POST_MATRIX_TABLES"))).toBe(
      true,
    );
  });

  it("ولا يُخفِقُ على `operational_jobs` — فهوَ مُعلَنٌ صراحةً بعدَ المصفوفةِ", () => {
    expect(checksOf(baseInputs())).toEqual([]);
  });
});

describe("٦. الحاجزُ الذي يمنعُ الأخضرَ الزائفَ", () => {
  it("يُخفِقُ حينَ تُكتَبُ `RECONCILED` في شيفرةِ الأداةِ و`DEP-CORE-007` مفتوحٌ", () => {
    const inputs = baseInputs();
    const problems = dryRunProblems({
      ...inputs,
      toolSource: `${inputs.toolSource}\nconst status = "RECONCILED";`,
    });
    expect(problems.some((problem) => problem.check.startsWith("٦."))).toBe(true);
  });

  it("يُخفِقُ حينَ يُنزَعُ `NO_CORE_READER` فيُستبدَلُ بقارئٍ يُعيدُ صفراً", () => {
    const inputs = baseInputs();
    const problems = dryRunProblems({
      ...inputs,
      toolSource: inputs.toolSource.replace(/NO_CORE_READER/g, "zeroReader"),
    });
    expect(problems.some((problem) => problem.check.startsWith("٦."))).toBe(true);
  });

  it("ويسقطُ الفحصُ من نفسِه حينَ تُغلَقُ التبعيّةُ — بلا تعديلِ حرفٍ في الحارسِ", () => {
    const inputs = baseInputs();
    const problems = dryRunProblems({
      ...inputs,
      roadmapText: ROADMAP_CLOSED,
      toolSource: `${inputs.toolSource}\nconst status = "RECONCILED";`,
    });
    expect(problems.some((problem) => problem.check.startsWith("٦."))).toBe(false);
  });

  it("ويقرأُ الخارطةَ لا يفترضُها", () => {
    expect(coreEnvironmentDependencyOpen(ROADMAP_OPEN)).toBe(true);
    expect(coreEnvironmentDependencyOpen(ROADMAP_CLOSED)).toBe(false);
    expect(coreEnvironmentDependencyOpen("لا ذكرَ للتبعيّةِ ههنا")).toBe(false);
  });
});

describe("٧. الوثيقةُ المولَّدةُ تطابقُ السجلَّ", () => {
  it("يُخفِقُ حينَ تغيبُ علامتا التوليدِ", () => {
    expect(checksOf({ ...baseInputs(), docText: "وثيقةٌ بلا علاماتٍ" })).toContain(
      "٧. الوثيقةُ المولَّدةُ تطابقُ السجلَّ",
    );
  });

  it("يُخفِقُ حينَ يُحرَّرُ ما بينَ العلامتَينِ يدوياً", () => {
    const inputs = baseInputs();
    expect(
      checksOf({ ...inputs, docText: inputs.docText.replace("`city_id`", "`tenant_id`") }),
    ).toContain("٧. الوثيقةُ المولَّدةُ تطابقُ السجلَّ");
  });

  it("و`withGeneratedBlock` تُبدِلُ ما بينَ العلامتَينِ ولا تلمسُ ما حولَهما", () => {
    const before =
      "قبلُ\n<!-- BEGIN GENERATED: dry-run-and-reconciliation -->قديمٌ<!-- END GENERATED: dry-run-and-reconciliation -->\nبعدُ";
    const after = withGeneratedBlock(before, "جديدٌ");
    expect(after).toContain("قبلُ");
    expect(after).toContain("بعدُ");
    expect(after).toContain("جديدٌ");
    expect(after).not.toContain("قديمٌ");
    expect(extractSlice(after)).toBe("جديدٌ");
  });
});

describe("التسويةُ لا تستطيعُ أن تُخرِجَ أخضرَ زائفاً", () => {
  const attestation = {
    readVia: "قارئُ CORE عبرَ عقدِ الأحداثِ",
    closedDependency: "`DEP-CORE-007`",
    measuredAt: "abc1234",
  };

  it("لا قراءةَ ⇒ `UNVERIFIABLE`، ولا `coreRows` صفراً", () => {
    const record = deriveReconciliation({ table: "users", rows: 142 }, undefined);
    expect(record.status).toBe("UNVERIFIABLE");
    expect(record.coreRows).toBeUndefined();
    expect(record.moveRows).toBe(142);
  });

  it("ولا `DIVERGED` بلا قراءةٍ — فالاختلافُ ادّعاءُ معرفةٍ بطرفٍ لم يُقرأْ", () => {
    expect(deriveReconciliation({ table: "users", rows: 0 }, undefined).status).not.toBe(
      "DIVERGED",
    );
    expect(deriveReconciliation({ table: "users", rows: 0 }, undefined).status).not.toBe(
      "RECONCILED",
    );
  });

  it("وجدولٌ مختلفٌ في الطرفَينِ ⇒ `UNVERIFIABLE` لا مقارنةٌ", () => {
    const core: CoreSide = { table: "riders", rows: 142, attestation };
    expect(deriveReconciliation({ table: "users", rows: 142 }, core).status).toBe("UNVERIFIABLE");
  });

  it("وبإشهادٍ وتطابقٍ ⇒ `RECONCILED`، وبإشهادٍ واختلافٍ ⇒ `DIVERGED`", () => {
    const same = deriveReconciliation(
      { table: "users", rows: 9 },
      { table: "users", rows: 9, attestation },
    );
    expect(same.status).toBe("RECONCILED");
    expect(same.coreRows).toBe(9);
    const differs = deriveReconciliation(
      { table: "users", rows: 9 },
      { table: "users", rows: 4, attestation },
    );
    expect(differs.status).toBe("DIVERGED");
    expect(differs.reason).toContain("5");
  });
});

describe("منطقُ الاشتقاقِ من المصفوفةِ لا تكرارٌ لها", () => {
  it("`probesForWave` تُشتَقُّ من المصفوفةِ", () => {
    expect(
      probesForWave(1)
        .map((probe) => probe.table)
        .sort(),
    ).toEqual(["admin_login_codes", "admin_sessions", "riders", "users"]);
    expect(probesForWave(6).map((probe) => probe.table)).toEqual(["orders"]);
    expect(probesForWave(99)).toEqual([]);
  });

  it("والموجةُ ٠ لا تلمسُ صفّاً فلا تظهرُ في الموجاتِ اللامسةِ", () => {
    expect(wavesThatTouchRows()).not.toContain(0);
    expect(wavesThatTouchRows()).toContain(1);
    expect(wavesThatTouchRows()).toContain(6);
  });

  it("وشرطُ الدخولِ يُقرأُ من المصفوفةِ لا يُعادُ كتابتُه", () => {
    expect(entryConditionOf(1)).toContain("B-2");
    expect(entryConditionOf(999)).toBeUndefined();
  });
});

describe("الجملةُ المبنيّةُ قراءةٌ لا غيرُ", () => {
  it("`SELECT` وحدَها، بأعمدةٍ مُقتَبَسةٍ", () => {
    const statement = buildProbeStatement({
      table: "users",
      groupBy: ["city_id", "role"],
      measures: "س".repeat(60),
    });
    expect(statement.startsWith("SELECT ")).toBe(true);
    expect(statement).toBe(
      'SELECT "city_id", "role", count(*)::bigint AS rows FROM "users" GROUP BY "city_id", "role" ORDER BY "city_id", "role"',
    );
    for (const verb of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "DROP"]) {
      expect(statement).not.toContain(verb);
    }
  });

  it("وكلُّ مِسبارٍ حقيقيٍّ يبني جملةَ قراءةٍ", () => {
    for (const probe of DRY_RUN_PROBES) {
      expect(buildProbeStatement(probe).startsWith("SELECT ")).toBe(true);
    }
  });

  it("وجملةُ الفتحِ تُعلِنُ `READ ONLY` صريحاً، والرمزُ المُتوقَّعُ للكتابةِ مُعلَنٌ", () => {
    expect(DRY_RUN_BEGIN).toContain("READ ONLY");
    expect(READ_ONLY_SQLSTATE).toBe("25006");
  });
});

describe("حذفُ التعليقاتِ", () => {
  it("يحذفُ الكتليَّ والسطريَّ ويُبقي الشيفرةَ", () => {
    expect(
      stripCommentsAndDocs("/** INSERT */ const a = 1; // DELETE\nconst b = 2;"),
    ).not.toContain("INSERT");
    expect(stripCommentsAndDocs("/** INSERT */ const a = 1; // DELETE\nconst b = 2;")).toContain(
      "const b = 2",
    );
  });
});
