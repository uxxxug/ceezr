/**
 * الغرض: برهانُ سقوطِ حاجزِ تغطيةِ تحديدِ المعدَّلِ — **سالبةٌ مزروعةٌ لكلِّ قاعدةٍ**
 *   (`ح-7`) معَ إيجابيّةِ ضبطٍ على السِجلِّ الحقيقيِّ.
 * الحالة: منفّذ فعلياً — `SEC-07`.
 * ينتمي إلى: tests/unit
 * يُستخدَمُ من: `bun test tests/unit` في `verify`.
 * يحرسُه: نفسُه — حاجزٌ لم يُرَ ساقطاً لم يُقَسْ.
 * الحاكم: `docs/adr/0139-an-unlisted-exposed-route-is-an-unlimited-route.md`
 *
 * ## وما لا يفعلُه هذا الاختبارُ عن قصدٍ
 *
 * - **لا يقيسُ إنفاذاً**: ذاكَ في `rate-limit-enforced.test.ts` بخادمٍ حقيقيٍّ.
 * - **لا يكتبُ ملفّاً مؤقّتاً**: المدخلاتُ مُمرَّرةٌ، فتُزرَعُ السالبةُ في الذاكرةِ
 *   ويبقى المستودعُ سليماً — ولذلكَ كانَ التدقيقُ دالّةً خالصةً.
 */

import { describe, expect, test } from "bun:test";
import {
  EXEMPT_ROUTE_COUNT,
  EXPOSURE_CLASSES,
  KEY_DIMENSIONS,
  LIMIT_REQUIRED_EXPOSURES,
  LIMITED_ROUTE_COUNT,
  PUBLIC_PATH_PREFIXES,
  ROUTE_POLICIES,
  ROUTE_POLICY_COUNT,
  type RoutePolicy,
} from "../../apps/gateway/src/rate-limit/policy.ts";
import { MOUNT_FILES } from "../../scripts/lib/gateway-route-inventory.ts";
import {
  auditRateLimitCoverage,
  MIN_EXEMPTION_REASON_LENGTH,
  type RateLimitAuditInput,
} from "../../scripts/lib/rate-limit-audit.ts";

const OWNER = "منفّذ المستودع";
const LONG_REASON = "ط".repeat(MIN_EXEMPTION_REASON_LENGTH + 10);
const LONG_RATIONALE = "ع".repeat(120);

/**
 * عالمٌ مصغَّرٌ: موجِّهٌ واحدٌ بمسارٍ واحدٍ مُركَّبٍ، وسِجلٌّ يُطابِقُه. تُشوَّهُ منه
 * سِمةٌ واحدةٌ في كلِّ حالةٍ **فيُرى ما تُنتِجُه تلكَ السِمةُ وحدَها**.
 */
const ROUTE_FILE = "apps/gateway/src/routes/toy.ts";
const ROUTE_SOURCE = `
import { Hono } from "hono";
export function createToyRoutes(): Hono {
  const app = new Hono();
  app.post("/v1/toy", async (c) => c.json({ ok: true }));
  return app;
}
`;
const MOUNT_SOURCE = `app.route("/", createToyRoutes());\nconst wired = limiterFor("POST", "/v1/toy", "عنوانُ العميلِ");\n`;

const BASE_POLICY: RoutePolicy = {
  method: "POST",
  path: "/v1/toy",
  file: ROUTE_FILE,
  exposure: "قبلَ المصادقةِ",
  limits: [
    {
      limit: 30,
      windowSeconds: 60,
      keyDimension: "عنوانُ العميلِ",
      wiredIn: `${MOUNT_FILES[0]}:limiterFor("POST", "/v1/toy", "عنوانُ العميلِ")`,
      rationale: LONG_RATIONALE,
    },
  ],
  exemption: null,
};

function world(overrides: {
  readonly policies?: readonly RoutePolicy[];
  readonly routeSource?: string;
  readonly mountSource?: string;
  readonly declared?: RateLimitAuditInput["declared"];
  readonly wiredSources?: ReadonlyMap<string, string>;
}): RateLimitAuditInput {
  const policies = overrides.policies ?? [BASE_POLICY];
  const mountSources = new Map<string, string>();
  for (const file of MOUNT_FILES) mountSources.set(file, "");
  mountSources.set(MOUNT_FILES[0] as string, overrides.mountSource ?? MOUNT_SOURCE);
  return {
    routeSources: new Map([[ROUTE_FILE, overrides.routeSource ?? ROUTE_SOURCE]]),
    mountSources,
    policies,
    declared: overrides.declared ?? {
      routes: policies.length,
      limited: policies.filter((policy) => policy.limits.length > 0).length,
      exempt: policies.filter((policy) => policy.exemption !== null).length,
    },
    wiredSources:
      overrides.wiredSources ??
      new Map([[MOUNT_FILES[0] as string, overrides.mountSource ?? MOUNT_SOURCE]]),
    exposureClasses: EXPOSURE_CLASSES,
    limitRequiredExposures: LIMIT_REQUIRED_EXPOSURES,
    keyDimensions: KEY_DIMENSIONS,
    publicPathPrefixes: PUBLIC_PATH_PREFIXES,
  };
}

describe("حاجزُ تغطيةِ تحديدِ المعدَّلِ — إيجابيّةُ الضبطِ", () => {
  test("العالمُ المصغَّرُ السليمُ لا يُنتِجُ خرقاً", () => {
    expect(auditRateLimitCoverage(world({}))).toEqual([]);
  });

  test("السِجلُّ الحقيقيُّ مُطابِقٌ للشيفرةِ — وهذا ما يُبطِلُ حجّةَ «الحاجزُ يقولُ نعم دائماً»", () => {
    // لو كانَ التدقيقُ يُرجِعُ فارغاً على كلِّ مدخلٍ لَما سقطَ في الحالاتِ التاليةِ.
    expect(ROUTE_POLICIES.length).toBe(ROUTE_POLICY_COUNT);
    expect(ROUTE_POLICIES.filter((policy) => policy.limits.length > 0).length).toBe(
      LIMITED_ROUTE_COUNT,
    );
    expect(ROUTE_POLICIES.filter((policy) => policy.exemption !== null).length).toBe(
      EXEMPT_ROUTE_COUNT,
    );
  });
});

describe("حاجزُ تغطيةِ تحديدِ المعدَّلِ — سالبةٌ مزروعةٌ لكلِّ قاعدةٍ", () => {
  test("(١) مسارٌ في الشيفرةِ بلا مدخلٍ في السِجلِّ", () => {
    const violations = auditRateLimitCoverage(world({ policies: [] }));
    expect(violations.some((line) => line.includes("بلا مدخلٍ في السِجلِّ"))).toBe(true);
  });

  test("(٢) مدخلٌ في السِجلِّ بلا مسارٍ في الشيفرةِ", () => {
    const violations = auditRateLimitCoverage(
      world({ policies: [{ ...BASE_POLICY, path: "/v1/ghost" }] }),
    );
    expect(violations.some((line) => line.includes("بلا مسارٍ في الشيفرةِ"))).toBe(true);
  });

  test("(٣) صنفُ كشفٍ خارجَ المعجمِ المغلقِ", () => {
    const violations = auditRateLimitCoverage(
      world({
        policies: [{ ...BASE_POLICY, exposure: "صنفٌ مخترعٌ" as RoutePolicy["exposure"] }],
      }),
    );
    expect(violations.some((line) => line.includes("صنفُ كشفٍ غيرُ معروفٍ"))).toBe(true);
  });

  test("(٤) صنفٌ يُوجِبُ حدّاً بلا حدٍّ ولا إعفاءٍ", () => {
    const violations = auditRateLimitCoverage(
      world({ policies: [{ ...BASE_POLICY, limits: [] }] }),
    );
    expect(violations.some((line) => line.includes("يُوجِبُ حدّاً مُركَّباً أو إعفاءً"))).toBe(true);
  });

  test("(٤) حدٌّ وإعفاءٌ معاً — قولانِ متناقضانِ في مدخلٍ واحدٍ", () => {
    const violations = auditRateLimitCoverage(
      world({
        policies: [{ ...BASE_POLICY, exemption: { reason: LONG_REASON, owner: OWNER } }],
      }),
    );
    expect(violations.some((line) => line.includes("حدٌّ وإعفاءٌ معاً"))).toBe(true);
  });

  test("(٤-ب) إعفاءٌ في صنفٍ لا يُوجَبُ فيه حدٌّ", () => {
    const violations = auditRateLimitCoverage(
      world({
        policies: [
          {
            ...BASE_POLICY,
            exposure: "مُصادَقٌ بجلسةٍ",
            limits: [],
            exemption: { reason: LONG_REASON, owner: OWNER },
          },
        ],
      }),
    );
    expect(violations.some((line) => line.includes("إعفاءٌ في صنفٍ لا يُوجَبُ"))).toBe(true);
  });

  test("(٥) سببُ إعفاءٍ أقصرُ من الحدِّ الأدنى، ومالكٌ فارغٌ", () => {
    const violations = auditRateLimitCoverage(
      world({
        policies: [{ ...BASE_POLICY, limits: [], exemption: { reason: "لأنَّه آمنٌ", owner: "  " } }],
      }),
    );
    expect(violations.some((line) => line.includes("سببُ الإعفاءِ أقصرُ"))).toBe(true);
    expect(violations.some((line) => line.includes("إعفاءٌ بلا مالكٍ"))).toBe(true);
  });

  test("(٦) قيمُ حدٍّ غيرُ صالحةٍ وبُعدُ مفتاحٍ مخترعٌ وتعليلٌ أجوفُ", () => {
    const violations = auditRateLimitCoverage(
      world({
        policies: [
          {
            ...BASE_POLICY,
            limits: [
              {
                limit: 0,
                windowSeconds: 100_000,
                keyDimension: "بُعدٌ مخترعٌ" as never,
                wiredIn: BASE_POLICY.limits[0]?.wiredIn ?? "",
                rationale: "حدٌّ معقولٌ",
              },
            ],
          },
        ],
      }),
    );
    expect(violations.some((line) => line.includes("حدٌّ غيرُ صحيحٍ"))).toBe(true);
    expect(violations.some((line) => line.includes("نافذةٌ أطولُ"))).toBe(true);
    expect(violations.some((line) => line.includes("بُعدُ مفتاحٍ غيرُ معروفٍ"))).toBe(true);
    expect(violations.some((line) => line.includes("تعليلُ الرقمِ أقصرُ"))).toBe(true);
  });

  test("(٧) حدٌّ مُعلَنٌ بلا تركيبٍ — وهذا ما يجعلُ السِجلَّ عهداً لا زينةً", () => {
    const violations = auditRateLimitCoverage(
      world({ mountSource: 'app.route("/", createToyRoutes());\n' }),
    );
    expect(violations.some((line) => line.includes("حدٌّ مُعلَنٌ بلا تركيبٍ"))).toBe(true);
  });

  test("(٧) ملفُّ تركيبٍ غيرُ مقروءٍ", () => {
    const violations = auditRateLimitCoverage(world({ wiredSources: new Map() }));
    expect(violations.some((line) => line.includes("غيرُ مقروءٍ"))).toBe(true);
  });

  test("(٨) مسارٌ لا يبدأُ ببادئةٍ عامّةٍ — عينُ عيبِ مركبةِ السائقِ", () => {
    const routeSource = ROUTE_SOURCE.replace('"/v1/toy"', '"/assets"');
    const violations = auditRateLimitCoverage(
      world({
        routeSource,
        policies: [{ ...BASE_POLICY, path: "/assets" }],
        mountSource: MOUNT_SOURCE.replace("/v1/toy", "/assets"),
      }),
    );
    expect(violations.some((line) => line.includes("لا يبدأُ ببادئةٍ عامّةٍ"))).toBe(true);
  });

  test("(٩) عددٌ مُعلَنٌ يُخالِفُ المقيسَ", () => {
    const violations = auditRateLimitCoverage(
      world({ declared: { routes: 99, limited: 99, exempt: 99 } }),
    );
    expect(violations.some((line) => line.includes("العددُ المُعلَنُ للمساراتِ"))).toBe(true);
    expect(violations.some((line) => line.includes("العددُ المُعلَنُ للمحدودةِ"))).toBe(true);
    expect(violations.some((line) => line.includes("العددُ المُعلَنُ للمُعفاةِ"))).toBe(true);
  });

  test("(١٠) مدخلانِ لمسارٍ واحدٍ", () => {
    const violations = auditRateLimitCoverage(
      world({
        policies: [BASE_POLICY, BASE_POLICY],
        declared: { routes: 2, limited: 2, exempt: 0 },
      }),
    );
    expect(violations.some((line) => line.includes("مدخلٌ مُكرَّرٌ"))).toBe(true);
  });

  test("موجِّهٌ غيرُ مُركَّبٍ يُبلَّغُ خرقاً — لا يُعَدُّ مساراً محميّاً بالغيابِ", () => {
    const violations = auditRateLimitCoverage(
      world({ policies: [], mountSource: "// لا تركيبَ ههنا\n" }),
    );
    expect(violations.some((line) => line.includes("UNMOUNTED_ROUTER"))).toBe(true);
  });
});
