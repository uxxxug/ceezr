/**
 * الغرض: اختبارُ إطارِ سيناريوهات العمل نفسِه — العقد، والحكم، وقراءةِ العدّادات، وحرسِ الهويّة.
 * الحالة: منفّذ فعلياً — وحدة 2-5.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: كلُّ توسيعٍ للإطار — أيُّ بندٍ جديدٍ في العقد يُختبَر هنا.
 * ملاحظات مستقبلية: عند إتاحةِ قاعدةِ قياس في CI يُضاف اختبارُ تشغيلٍ فعليٍّ لسيناريو واحد.
 *
 * ولماذا يُختبَر الحاكمُ لا المحكومُ عليه فقط: مشغّلٌ يحكم بالنجاح خطأً أخطرُ من
 * سيناريو يفشل — الثاني يُرى، والأوّلُ يُصدَّق. وهذا الملفُّ بلا قاعدةِ بيانات عن
 * قصد، كي يجري في CI حيث لا قاعدةَ قياس.
 */

import { describe, expect, test } from "bun:test";
import {
  type ActorRun,
  type CheckResult,
  check,
  expectEqual,
  type ScenarioDefinition,
  validateScenario,
} from "../bench/scenarios/contract.ts";
import { sumMetric } from "../bench/scenarios/metrics-text.ts";
import {
  decideVerdict,
  findUnownedTelegramIds,
  summarizeHttp,
  summarizeLatency,
} from "../bench/scenarios/runner.ts";

/** سيناريو صحيحٌ أدنى — تُشتقّ منه الحالاتُ الناقصةُ بالحذفِ لا بالكتابةِ من جديد. */
function validDefinition(): ScenarioDefinition {
  return {
    id: "probe",
    title: "سيناريو فحصِ العقد",
    service: "transport",
    initialState: ["قاعدةٌ نظيفة"],
    userInputs: ["/start"],
    steps: ["خطوةٌ واحدة"],
    expectedSystemResponse: ["ردٌّ واحد"],
    expectedBusinessOutcome: ["نتيجةٌ واحدة"],
    concurrency: { count: 2, mode: "independent", rationale: "اثنان يكفيان للفحص" },
    mocks: [
      {
        what: "مُرسِلٌ ملتقِط",
        why: "لا تُصاب مجموعاتٌ حقيقية",
        proves: "بناءَ الرسالة",
        doesNotProve: "تسليمَها عبر تلغرام",
      },
    ],
    proves: ["شيئاً"],
    doesNotProve: ["شيئاً آخر"],
    metrics: ["waslah_probe_total"],
    failureConditions: [{ code: "NEVER", description: "لا يقع", detect: async () => null }],
    preconditions: async () => [],
    runActor: async (_context, actor) => ({
      index: actor.index,
      telegramIds: [],
      produced: {},
      httpStatuses: [],
    }),
    systemResponse: async () => [],
    businessOutcome: async () => [],
    databaseState: async () => [],
    transitions: async () => [],
    invariants: async () => [],
    idempotency: {
      description: "إعادةُ نفسِ المُدخَل",
      replay: async () => {},
      expectation: async () => [],
    },
  };
}

const actorRun = (index: number, telegramIds: readonly number[], statuses: number[]): ActorRun => ({
  index,
  telegramIds,
  produced: {},
  httpStatuses: statuses,
  durationMs: 1,
  error: null,
});

describe("عقدُ السيناريو: ما يُرفَض قبل التشغيل", () => {
  test("السيناريوُ المكتملُ يمرّ بلا مخالفات", () => {
    expect(validateScenario(validDefinition())).toEqual([]);
  });

  test("قائمةٌ فارغةٌ في بندٍ واجبٍ مخالفة — الإعلانُ الفارغُ ليس إعلاناً", () => {
    const violations = validateScenario({ ...validDefinition(), initialState: [] });
    expect(violations.map((entry) => entry.field)).toContain("initialState");
  });

  test("«ما لا يُثبته» الغائبُ في مزدوجٍ مخالفة (§7)", () => {
    const violations = validateScenario({
      ...validDefinition(),
      mocks: [{ what: "مزدوج", why: "سبب", proves: "شيء", doesNotProve: "   " }],
    });
    expect(violations.some((entry) => entry.field.includes("doesNotProve"))).toBe(true);
  });

  test("عددُ فاعلين أقلُّ من واحدٍ مخالفة", () => {
    const violations = validateScenario({
      ...validDefinition(),
      concurrency: { count: 0, mode: "independent", rationale: "سبب" },
    });
    expect(violations.map((entry) => entry.field)).toContain("concurrency.count");
  });

  test("رقمُ التزامنِ بلا سببٍ مخالفة — الرقمُ بلا سببٍ اعتباطيّ (§8)", () => {
    const violations = validateScenario({
      ...validDefinition(),
      concurrency: { count: 5, mode: "contended", rationale: "" },
    });
    expect(violations.map((entry) => entry.field)).toContain("concurrency.rationale");
  });

  test("شروطُ الفشلِ الفارغةُ مخالفة — سيناريو لا يُعلِن كيف يفشل لا يُصدَّق نجاحُه", () => {
    const violations = validateScenario({ ...validDefinition(), failureConditions: [] });
    expect(violations.map((entry) => entry.field)).toContain("failureConditions");
  });

  test("«ما لا يُثبته» على مستوى السيناريو واجبٌ كـ«ما يُثبته»", () => {
    const violations = validateScenario({ ...validDefinition(), doesNotProve: [] });
    expect(violations.map((entry) => entry.field)).toContain("doesNotProve");
  });
});

describe("الحكم: نتيجةُ العمل لا كودُ HTTP", () => {
  const passing: CheckResult[] = [check("business_outcome", "أ", true, "تفصيل")];

  test("توكيداتٌ كلُّها ناجحةٌ بلا شروطِ فشلٍ ولا أخطاءٍ ⇒ business_success", () => {
    expect(decideVerdict(passing, [], []).verdict).toBe("business_success");
  });

  test("توكيدٌ واحدٌ فاشلٌ يُسقِط الحكمَ وإن كان كلُّ HTTP = 200", () => {
    const checks = [...passing, expectEqual("invariant", "ب", 2, 1)];
    const decision = decideVerdict(checks, [], []);
    expect(decision.verdict).toBe("business_failure");
    expect(decision.reasons.join(" ")).toContain("ب");
  });

  test("شرطُ فشلٍ مُعلَنٌ وقع يُسقِط الحكمَ وإن نجحت كلُّ التوكيدات", () => {
    expect(decideVerdict(passing, ["DOUBLE_ASSIGNMENT: عرضان مقبولان"], []).verdict).toBe(
      "business_failure",
    );
  });

  test("خطأُ فاعلٍ يُسقِط الحكم", () => {
    expect(decideVerdict(passing, [], ["الفاعل 3: انقطاع"]).verdict).toBe("business_failure");
  });

  test("لا توكيداتَ ⇒ فشل: تشغيلٌ بلا حكمٍ ليس نجاحاً", () => {
    const decision = decideVerdict([], [], []);
    expect(decision.verdict).toBe("business_failure");
    expect(decision.reasons.join(" ")).toContain("لا توكيدات");
  });
});

describe("HTTP معلوماتيٌّ لا حَكَمٌ", () => {
  test("يُجمَع بالحالة، ومعه تصريحٌ بأنّه لا يدخل الحكم", () => {
    const summary = summarizeHttp([actorRun(0, [], [200, 200]), actorRun(1, [], [500])]);
    expect(summary.requests).toBe(3);
    expect(summary.byStatus["200"]).toBe(2);
    expect(summary.byStatus["500"]).toBe(1);
    expect(summary.note.length).toBeGreaterThan(0);
  });
});

describe("قراءةُ العدّادات من نصِّ Prometheus", () => {
  const rendered = [
    "# HELP waslah_dispatch_offers_accepted_total عروضٌ مقبولة",
    "# TYPE waslah_dispatch_offers_accepted_total counter",
    'waslah_dispatch_offers_accepted_total{city="JED"} 1',
    'waslah_dispatch_offers_accepted_total{city="RUH"} 2',
    'waslah_dispatch_offers_accepted_total_extra{city="JED"} 99',
    "waslah_dispatch_requests_total 7",
    "",
  ].join("\n");

  test("يجمع كلَّ سلاسلِ العدّاد الموسومة", () => {
    expect(sumMetric(rendered, "waslah_dispatch_offers_accepted_total")).toBe(3);
  });

  test("لا يخلط عدّاداً باسمٍ يبدأ بنفسِ البادئة", () => {
    expect(sumMetric(rendered, "waslah_dispatch_offers_accepted")).toBe(0);
  });

  test("يقرأ العدّادَ بلا وسوم", () => {
    expect(sumMetric(rendered, "waslah_dispatch_requests_total")).toBe(7);
  });

  test("عدّادٌ غائبٌ يُقرأ صفراً لا يُلقي", () => {
    expect(sumMetric(rendered, "waslah_absent_total")).toBe(0);
  });

  test("التعليقاتُ لا تُحسَب", () => {
    expect(sumMetric("# waslah_x_total 5", "waslah_x_total")).toBe(0);
  });
});

describe("ملخّصُ الأزمنة", () => {
  test("عيّنةٌ فارغةٌ تُلخَّص أصفاراً لا تُلقي", () => {
    expect(summarizeLatency([])).toEqual({ count: 0, meanMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 });
  });

  test("المئينات تُقرأ من العيّنةِ مرتَّبةً", () => {
    const summary = summarizeLatency([100, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
    expect(summary.count).toBe(10);
    expect(summary.maxMs).toBe(100);
    expect(summary.p50Ms).toBeGreaterThanOrEqual(50);
    expect(summary.p95Ms).toBeGreaterThanOrEqual(summary.p50Ms);
    expect(summary.p95Ms).toBeLessThanOrEqual(100);
  });

  test("عيّنةٌ واحدةٌ: كلُّ المئيناتِ هي هي", () => {
    const summary = summarizeLatency([42]);
    expect(summary.p50Ms).toBe(42);
    expect(summary.p95Ms).toBe(42);
    expect(summary.maxMs).toBe(42);
  });
});

describe("حرسُ الهويّة: القياسُ لا يمسّ معرّفاً لا يملكه", () => {
  test("معرّفٌ دون حدِّ القياس يُرفَع", () => {
    expect(
      findUnownedTelegramIds([actorRun(0, [900_001], []), actorRun(1, [700_000], [])]),
    ).toEqual([]);
    expect(findUnownedTelegramIds([actorRun(0, [123456], [])])).toEqual([123456]);
  });

  test("لا معرّفاتٍ ⇒ لا مخالفة", () => {
    expect(findUnownedTelegramIds([actorRun(0, [], [])])).toEqual([]);
  });
});
