/**
 * الغرض: قياسُ حاجزِ عقدِ تجميعاتِ الإدارةِ — **حالةٌ سالبةٌ مبذورةٌ لكلِّ قاعدةٍ
 *   من السبعِ** (`ح-7`: قاعدةٌ بلا حالةٍ سالبةٍ غيرُ مُنفَذةٍ)، ومعَها المستودَعُ
 *   الحقيقيُّ في حالتِه الموجبةِ (البند `F7-08` · `CAP-011`).
 * الحالة: منفَّذٌ فعليّاً — البند `F7-08`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci` وخطوةٌ مسمّاةٌ في CI.
 * الحاكم: docs/adr/0128-an-aggregate-without-its-age-is-a-lie.md
 *
 * ولماذا تُقاسُ مدخلاتٌ مصنوعةٌ لا المستودَعُ وحدَه: المستودَعُ اليومَ **نظيفٌ**،
 * فلو قِيسَ وحدَه لَنجحَ الاختبارُ ولو كانَ الحاجزُ لا يفحصُ شيئاً. فالحالةُ
 * السالبةُ هيَ ما يُثبِتُ أنَّ القاعدةَ تعملُ، والموجبةُ تُقاسُ معَها.
 *
 * وما لا يفعلُه: لا يُثبِتُ أنَّ العدَّاداتَ صادقةٌ على قاعدةٍ حقيقيّةٍ — ذاكَ
 * أثرٌ يُقاسُ في `tests/integration/admin-metric-snapshots.test.ts` بمحرِّكٍ.
 */

import { describe, expect, it } from "bun:test";
import { readRepository } from "../../scripts/check-admin-metric-snapshot-contract.ts";
import {
  ADMIN_API_FILE,
  type AdminMetricContractInput,
  adminMetricSnapshotProblems,
  BOUNDARY_AUDIT_FILE,
  BOUNDARY_REGISTRY_FILE,
  CONTAINER_FILE,
  DOMAIN_FILE,
  ERASURE_FILE,
  JOB_FILE,
  OVERVIEW_FILE,
  QUERIES_FILE,
  RETENTION_FILE,
  SNAPSHOT_MIGRATION_FILE,
  STORE_FILE,
  TABLE_NAME,
} from "../../scripts/lib/admin-metric-snapshot-contract.ts";

/** مستودَعٌ مصنوعٌ **سليمٌ** — كلُّ حالةٍ سالبةٍ تُشوِّهُ منه سطراً واحداً. */
function healthy(): {
  files: Record<string, string>;
  repositoryTexts: Record<string, string>;
} {
  return {
    files: {
      [DOMAIN_FILE]: `export const ADMIN_METRIC_WINDOW_HOURS = 24;\nexport function ageSecondsOf(a: Date, b: Date): number { return 0; }\n`,
      [STORE_FILE]: `export function createMetricSnapshotRefreshPort(sql: Sql) { return { refresh }; }\n`,
      [QUERIES_FILE]:
        `import { ADMIN_METRIC_WINDOW_HOURS } from "packages/domain/admin/metric-snapshot.ts";\n` +
        `export const DAY_WINDOW_HOURS = ADMIN_METRIC_WINDOW_HOURS;\n` +
        `export interface AdminOverviewReading {\n  readonly counters: OverviewCounters;\n  readonly stamp: MetricTruthStamp;\n}\n` +
        `const q = "admin_metrics_stale_after_seconds admin_overview_live_fallback_enabled";\n`,
      [OVERVIEW_FILE]: `export interface OverviewData {\n  readonly stamp: MetricTruthStamp;\n}\n`,
      [ADMIN_API_FILE]: `const body = { metrics: reading.stamp };\n`,
      [CONTAINER_FILE]:
        `const JOB_INTERVALS = { refreshAdminMetrics: 60 };\n` +
        `await refreshMetricSnapshots({ port }, { windowHours: ADMIN_METRIC_WINDOW_HOURS });\n`,
      [JOB_FILE]: `export const run = () => refreshMetricSnapshots(deps, input);\n`,
      [RETENTION_FILE]: `export const TABLE_RETENTION = { ${TABLE_NAME}: "lifecycleBound" };\n`,
      [ERASURE_FILE]: `export const TABLE_ERASURE = { ${TABLE_NAME}: reference() };\n`,
      [BOUNDARY_REGISTRY_FILE]: `{ table: "${TABLE_NAME}", owner: "MOVE" },\n`,
      [BOUNDARY_AUDIT_FILE]: `| ${TABLE_NAME} | MOVE | KEEP |\n`,
      [SNAPSHOT_MIGRATION_FILE]:
        `create table if not exists ${TABLE_NAME} ();\n` +
        `insert into platform_settings (key) values ('admin_metrics_stale_after_seconds'),\n` +
        `('admin_overview_live_fallback_enabled');\n`,
    },
    repositoryTexts: {
      "apps/workers/src/container.ts": `const JOB_INTERVALS = { refreshAdminMetrics: 60 };\n`,
    },
  };
}

function judge(mutate: (repo: ReturnType<typeof healthy>) => void): readonly string[] {
  const repo = healthy();
  mutate(repo);
  return adminMetricSnapshotProblems(repo as AdminMetricContractInput);
}

describe("حاجزُ عقدِ تجميعاتِ الإدارةِ — الحالةُ الموجبةُ", () => {
  it("المستودَعُ المصنوعُ السليمُ يمرُّ بلا خرقٍ", () => {
    expect(adminMetricSnapshotProblems(healthy() as AdminMetricContractInput)).toEqual([]);
  });

  it("المستودَعُ **الحقيقيُّ** يمرُّ — فالحاجزُ يقيسُ الشِّفرةَ القائمةَ لا مُصنَّعاً فقط", () => {
    expect(adminMetricSnapshotProblems(readRepository())).toEqual([]);
  });
});

describe("القاعدةُ ١: لا رقمَ منشوراً بلا وَسْمِ صدقٍ", () => {
  it("نزعُ `stamp` من نموذجِ القراءةِ يُسقِطُ الحاجزَ", () => {
    const problems = judge((repo) => {
      repo.files[QUERIES_FILE] = (repo.files[QUERIES_FILE] ?? "").replace(
        "  readonly stamp: MetricTruthStamp;\n",
        "",
      );
    });
    expect(problems.some((p) => p.includes("AdminOverviewReading"))).toBe(true);
  });

  it("جعلُ `stamp` **اختياريّاً** في الصفحةِ يُسقِطُ الحاجزَ", () => {
    const problems = judge((repo) => {
      repo.files[OVERVIEW_FILE] =
        `export interface OverviewData {\n  readonly stamp?: MetricTruthStamp;\n}\n`;
    });
    expect(problems.some((p) => p.includes("اختياريٌّ"))).toBe(true);
  });

  it("ردُّ الواجهةِ البرمجيّةِ بلا الوَسمِ يُسقِطُ الحاجزَ", () => {
    const problems = judge((repo) => {
      repo.files[ADMIN_API_FILE] = `const body = { now: observedAt.toISOString() };\n`;
    });
    expect(problems.some((p) => p.includes(ADMIN_API_FILE))).toBe(true);
  });
});

describe("القاعدةُ ٢: النطاقُ لا يقرأُ ساعةً", () => {
  for (const clock of ["new Date(", "Date.now("]) {
    it(`قراءةُ الساعةِ بـ\`${clock}\` في النطاقِ تُسقِطُ الحاجزَ`, () => {
      const problems = judge((repo) => {
        repo.files[DOMAIN_FILE] = `${repo.files[DOMAIN_FILE] ?? ""}const at = ${clock});\n`;
      });
      expect(problems.some((p) => p.includes(clock))).toBe(true);
    });
  }
});

describe("القاعدةُ ٣: النافذةُ مصدرٌ واحدٌ", () => {
  it("رقمٌ مكتوبٌ بدلَ الثابتِ يُسقِطُ الحاجزَ", () => {
    const problems = judge((repo) => {
      repo.files[QUERIES_FILE] = (repo.files[QUERIES_FILE] ?? "").replace(
        "export const DAY_WINDOW_HOURS = ADMIN_METRIC_WINDOW_HOURS;",
        "export const DAY_WINDOW_HOURS = 12;",
      );
    });
    expect(problems.some((p) => p.includes("DAY_WINDOW_HOURS"))).toBe(true);
  });

  it("غيابُ الإسنادِ أصلاً يُسقِطُ الحاجزَ", () => {
    const problems = judge((repo) => {
      repo.files[QUERIES_FILE] = (repo.files[QUERIES_FILE] ?? "").replace(
        "export const DAY_WINDOW_HOURS = ADMIN_METRIC_WINDOW_HOURS;\n",
        "",
      );
    });
    expect(problems.some((p) => p.includes("لا إسنادَ"))).toBe(true);
  });

  it("عاملٌ لا يُمرِّرُ الثابتَ يُسقِطُ الحاجزَ", () => {
    const problems = judge((repo) => {
      repo.files[CONTAINER_FILE] = `const JOB_INTERVALS = { refreshAdminMetrics: 60 };\n`;
    });
    expect(problems.some((p) => p.includes("ADMIN_METRIC_WINDOW_HOURS"))).toBe(true);
  });
});

describe("القاعدةُ ٤: الجدولُ في القوائمِ المغلقةِ الأربعِ", () => {
  const registries = [RETENTION_FILE, ERASURE_FILE, BOUNDARY_REGISTRY_FILE, BOUNDARY_AUDIT_FILE];
  for (const path of registries) {
    it(`نزعُ الجدولِ من \`${path}\` يُسقِطُ الحاجزَ`, () => {
      const problems = judge((repo) => {
        repo.files[path] = "// لا ذكرَ للجدولِ\n";
      });
      expect(problems.some((p) => p.startsWith(path))).toBe(true);
    });
  }

  it("غيابُ مِلفٍّ محكومٍ يُسمّى غياباً لا يُسكَتُ عنه", () => {
    const problems = judge((repo) => {
      delete repo.files[RETENTION_FILE];
    });
    expect(problems.some((p) => p.includes("مِلفٌّ غائبٌ"))).toBe(true);
  });
});

describe("القاعدةُ ٥: الكادةُ في مكانٍ واحدٍ", () => {
  it("نزعُ الشوطِ من `JOB_INTERVALS` يُسقِطُ الحاجزَ", () => {
    const problems = judge((repo) => {
      repo.files[CONTAINER_FILE] =
        `await refreshMetricSnapshots({ port }, { windowHours: ADMIN_METRIC_WINDOW_HOURS });\n`;
    });
    expect(problems.some((p) => p.includes("JOB_INTERVALS"))).toBe(true);
  });

  it("مفتاحُ كادةٍ في القاعدةِ — ولو في مِلفٍّ بعيدٍ — يُسقِطُ الحاجزَ", () => {
    const problems = judge((repo) => {
      repo.repositoryTexts["supabase/migrations/9999_cadence.sql"] =
        `insert into platform_settings (key) values ('admin_metrics_refresh_seconds');\n`;
    });
    expect(problems.some((p) => p.includes("admin_metrics_refresh_seconds"))).toBe(true);
  });
});

describe("القاعدةُ ٦: لا اصطناعَ زمنٍ في المحوّلِ", () => {
  it("سدُّ فراغِ `computed_at` بساعةِ العمليّةِ يُسقِطُ الحاجزَ", () => {
    const problems = judge((repo) => {
      repo.files[STORE_FILE] = `const computedAt = raw.computed_at ?? new Date().toISOString();\n`;
    });
    expect(problems.some((p) => p.includes("يصطنعُ زمناً"))).toBe(true);
  });

  it("شوطٌ لا يُنادي حالةَ الاستخدامِ يُسقِطُ الحاجزَ", () => {
    const problems = judge((repo) => {
      repo.files[JOB_FILE] = `export const run = () => Promise.resolve();\n`;
    });
    expect(problems.some((p) => p.includes(JOB_FILE))).toBe(true);
  });
});

describe("القاعدةُ ٧: السقوطُ الحيُّ مُعلَنٌ ومحروسٌ", () => {
  it("مسحٌ حيٌّ بلا حارسِ إذنٍ يُسقِطُ الحاجزَ", () => {
    const problems = judge((repo) => {
      repo.files[QUERIES_FILE] = (repo.files[QUERIES_FILE] ?? "").replace(
        "admin_overview_live_fallback_enabled",
        "",
      );
    });
    expect(problems.some((p) => p.includes("admin_overview_live_fallback_enabled"))).toBe(true);
  });

  it("قراءةٌ بلا عتبةِ تقادُمٍ تُسقِطُ الحاجزَ", () => {
    const problems = judge((repo) => {
      repo.files[QUERIES_FILE] = (repo.files[QUERIES_FILE] ?? "").replace(
        "admin_metrics_stale_after_seconds",
        "",
      );
    });
    expect(problems.some((p) => p.includes("عتبةَ تقادُمٍ"))).toBe(true);
  });

  it("هجرةٌ لا تبذُرُ مفتاحَي الصدقِ تُسقِطُ الحاجزَ", () => {
    const problems = judge((repo) => {
      repo.files[SNAPSHOT_MIGRATION_FILE] = `create table if not exists ${TABLE_NAME} ();\n`;
    });
    expect(problems.some((p) => p.includes("مفتاحَي الصدقِ"))).toBe(true);
  });
});
