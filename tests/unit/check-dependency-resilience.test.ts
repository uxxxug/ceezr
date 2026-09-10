/**
 * الغرض: اختبارُ حاجزِ صمودِ الاعتماديّاتِ (`F8-04` · ADR-0079): يُثبِتُ أنَّ
 *    المستودعَ اليومَ نظيفٌ، و**أنَّ الحاجزَ يُخفِقُ فعلاً عندَ كلِّ صورةٍ من صورِ
 *    الخرقِ الخمسِ** — لا أنَّه يُنفَّذُ فحسبُ.
 * الحالة: منفّذ فعلياً — 2026-09-10 · البند `F8-04`.
 * ينتمي إلى: tests/unit
 *
 * ## لماذا الأغلبُ سالبٌ
 *
 * حاجزٌ يُثبَتُ نجاحُه على شيفرةٍ سليمةٍ لم يُثبَتْ منه شيءٌ. والصورةُ السالبةُ
 * الأولى ههنا هيَ **العطبُ الأصليُّ حرفاً**: `new Api(token)` بلا خياراتٍ، وهوَ
 * الذي ورَّثَ سبعةَ مواضعَ مهلةَ خمسِمئةِ ثانيةٍ صامتةً.
 */

import { describe, expect, test } from "bun:test";
import {
  BUDGETS_FILE,
  checkBudgetCoverage,
  checkEgressAdapters,
  checkTelegramFactory,
  EGRESS_ADAPTERS,
  findViolations,
  type Reader,
  repoFiles,
  TELEGRAM_FACTORY,
} from "../../scripts/check-dependency-resilience.ts";

/** قارئٌ من خريطةٍ: كلُّ ملفٍّ غيرِ مذكورٍ يُعَدُّ غيرَ موجودٍ فيُرمى. */
function reader(files: Readonly<Record<string, string>>): Reader {
  return (file) => {
    const text = files[file];
    if (text === undefined) throw new Error(`لا وجودَ لـ${file}`);
    return text;
  };
}

/** ميزانيّاتٌ سليمةٌ مُصغَّرةٌ — أساسُ الحالاتِ السالبةِ. */
const CLEAN_BUDGETS = `
export const DEPENDENCY_NAMES = ["telegram", "redis"] as const;
export const DEPENDENCY_BUDGETS = {
  telegram: { timeoutMs: 10_000, maxConcurrent: 64 },
  redis: { timeoutMs: 2_000, maxConcurrent: 128 },
} as const;
`;

/** محوّلُ خروجٍ سليمٌ مُصغَّرٌ. */
const CLEAN_ADAPTER = `
import { createDependencyGuard, DEPENDENCY_BUDGETS } from "../../shared/resilience/index.ts";
export const REDIS_TIMEOUT_MS = DEPENDENCY_BUDGETS.redis.timeoutMs;
const guard = createDependencyGuard({ dependency: "redis" });
async function call(url: string) {
  return await guard.run(async (signal) => {
    return await fetch(url, {
      method: "POST",
      signal,
    });
  });
}
`;

describe("حاجزُ صمودِ الاعتماديّاتِ — المستودعُ اليومَ (F8-04)", () => {
  test("١) لا خرقَ في المستودعِ الحاضرِ", () => {
    expect(findViolations(repoFiles())).toEqual([]);
  });

  test("٢) القائمةُ المُصرَّحُ بها تشملُ الاعتماديّاتِ الأربعَ ذاتَ الخروجِ", () => {
    expect(EGRESS_ADAPTERS).toContain(TELEGRAM_FACTORY);
    expect(EGRESS_ADAPTERS).toContain("packages/infrastructure/redis/upstash.ts");
    expect(EGRESS_ADAPTERS).toContain("packages/maps/providers/osrm/osrm-provider.ts");
    expect(EGRESS_ADAPTERS).toContain("packages/infrastructure/financial/payment-guard.ts");
  });
});

describe("حاجزُ صمودِ الاعتماديّاتِ — صورُ الخرقِ (F8-04)", () => {
  test("٣) `new Api(` خارجَ المصنعِ يُخفِقُ — العطبُ الأصليُّ حرفاً", () => {
    const read = reader({
      "apps/gateway/src/container.ts": "const api = new Api(token);\n",
    });
    const violations = checkTelegramFactory(["apps/gateway/src/container.ts"], read);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(1);
    expect(violations[0]?.why).toContain("500");
  });

  test("٤) `new Api(` داخلَ المصنعِ لا يُخفِقُ", () => {
    const read = reader({ [TELEGRAM_FACTORY]: "const api = new Api(token, {});\n" });
    expect(checkTelegramFactory([TELEGRAM_FACTORY], read)).toEqual([]);
  });

  test("٥) اسمُ اعتماديّةٍ بلا ميزانيّةٍ يُخفِقُ", () => {
    const read = reader({
      [BUDGETS_FILE]: `
export const DEPENDENCY_NAMES = ["telegram", "redis", "maps"] as const;
export const DEPENDENCY_BUDGETS = {
  telegram: { timeoutMs: 10_000 },
  redis: { timeoutMs: 2_000 },
} as const;
`,
    });
    const violations = checkBudgetCoverage(read);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.why).toContain("maps");
  });

  test("٦) ميزانيّةٌ بلا اسمٍ يُخفِقُ كذلكَ — لا رقمٌ يُقرأُ حمايةً غيرَ قائمةٍ", () => {
    const read = reader({
      [BUDGETS_FILE]: `
export const DEPENDENCY_NAMES = ["telegram"] as const;
export const DEPENDENCY_BUDGETS = {
  telegram: { timeoutMs: 10_000 },
  ghost: { timeoutMs: 1_000 },
} as const;
`,
    });
    const violations = checkBudgetCoverage(read);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.why).toContain("ghost");
  });

  test("٧) ميزانيّاتٌ سليمةٌ لا تُخفِقُ", () => {
    expect(checkBudgetCoverage(reader({ [BUDGETS_FILE]: CLEAN_BUDGETS }))).toEqual([]);
  });

  test("٨) تعذُّرُ قراءةِ `DEPENDENCY_NAMES` يُخفِقُ صراحةً ولا يُمرِّرُ صمتاً", () => {
    const violations = checkBudgetCoverage(reader({ [BUDGETS_FILE]: "// لا شيءَ ههنا\n" }));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.why).toContain("ح-٥");
  });

  test("٩) محوّلُ خروجٍ بلا حاجزٍ يُخفِقُ", () => {
    const read = reader({
      "x/adapter.ts": `
export const X_TIMEOUT_MS = DEPENDENCY_BUDGETS.redis.timeoutMs;
async function call(url: string) {
  return await fetch(url, { signal: AbortSignal.timeout(1) });
}
`,
    });
    const violations = checkEgressAdapters(read, ["x/adapter.ts"]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.why).toContain("CAP-006");
  });

  test("١٠) حاجزٌ مَحقونٌ يكفي عن حاجزٍ مبنيٍّ", () => {
    const read = reader({
      "x/adapter.ts": `
export interface Options { readonly guard?: DependencyGuard }
async function call(url: string, signal: AbortSignal) {
  return await fetch(url, { signal });
}
`,
    });
    expect(checkEgressAdapters(read, ["x/adapter.ts"])).toEqual([]);
  });

  test("١١) مهلةٌ مكتوبةٌ رقماً في محوّلِ خروجٍ يُخفِقُ", () => {
    const read = reader({
      "x/adapter.ts": `
const guard = createDependencyGuard({ dependency: "redis" });
export const X_TIMEOUT_MS = 2000;
async function call(url: string, signal: AbortSignal) {
  return await fetch(url, { signal });
}
`,
    });
    const violations = checkEgressAdapters(read, ["x/adapter.ts"]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.why).toContain("X_TIMEOUT_MS");
  });

  test("١٢) `fetch(` بلا إشارةٍ يُخفِقُ", () => {
    const read = reader({
      "x/adapter.ts": `
const guard = createDependencyGuard({ dependency: "redis" });
async function call(url: string) {
  return await fetch(url, {
    method: "POST",
  });
}
`,
    });
    const violations = checkEgressAdapters(read, ["x/adapter.ts"]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.why).toContain("المقبسَ");
  });

  test("١٣) محوّلٌ مُصرَّحٌ به لا وجودَ له يُخفِقُ ولا يتخطّى", () => {
    const violations = checkEgressAdapters(reader({}), ["x/moved.ts"]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.why).toContain("ح-٥");
  });

  test("١٤) محوّلٌ سليمٌ كاملاً لا يُخفِقُ", () => {
    const read = reader({ "x/adapter.ts": CLEAN_ADAPTER });
    expect(checkEgressAdapters(read, ["x/adapter.ts"])).toEqual([]);
  });
});
