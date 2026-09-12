/**
 * اختباراتُ حاجزِ حدِّ الصادرِ — البندُ `W-6` · القرارُ `ADR 0084`.
 *
 * المنهجُ: لا يُقاسُ نجاحُ الحاجزِ وحدَه، بل **إخفاقُه عندَ الخرقِ**. فلكلِّ فحصٍ
 * اختبارٌ يزرعُ خرقَه في مُدخلاتٍ مُمَرَّرةٍ ويشترطُ ظهورَ مشكلةٍ باسمِ ذلكَ الفحصِ.
 * وحاجزٌ لا يُقاسُ إخفاقُه حاجزٌ مجهولُ الأثرِ.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  countByClass,
  declaredLiteralHosts,
  type EgressPeer,
  HOST_EXEMPTIONS,
  peerById,
  peersByClass,
  WASLA_EGRESS_REGISTRY,
} from "../../packages/shared/wasla/egress-registry.ts";
import {
  DEFAULT_INPUTS,
  type EgressInputs,
  egressProblems,
  type FoundHost,
  renderDoc,
  scanLiteralHosts,
  stripComments,
  withGeneratedBlock,
} from "../../scripts/check-egress-boundary.ts";

const ROADMAP = readFileSync("ROADMAP.md", "utf8");
const DOC = readFileSync("docs/wasla/egress-boundary.md", "utf8");

/** مُدخلاتٌ سليمةٌ مُصطنعةٌ: تُشتقُّ من السجلِّ الحقيقيِّ ثمَّ تُخرَقُ نقطةً واحدةً. */
function baseInputs(overrides: Partial<EgressInputs> = {}): EgressInputs {
  const found: FoundHost[] = declaredLiteralHosts(WASLA_EGRESS_REGISTRY).map((host) => ({
    host,
    files: ["packages/x/y.ts"],
  }));
  return {
    registry: WASLA_EGRESS_REGISTRY,
    exemptions: HOST_EXEMPTIONS,
    foundHosts: found,
    envExampleText: DEFAULT_INPUTS.envExampleText,
    packageJsonText: DEFAULT_INPUTS.packageJsonText,
    callSiteExists: () => true,
    browserFetchSites: DEFAULT_INPUTS.browserFetchSites,
    bareFetchFiles: DEFAULT_INPUTS.browserFetchSites.map((b) => b.path),
    readSource: (path) => {
      if (path === "packages/shared/wasla/egress-registry.ts") return "WASLA_EGRESS_REGISTRY";
      if (path === "packages/shared/wasla/egress-gate.ts") return "createGuardedFetch";
      const peer = WASLA_EGRESS_REGISTRY.find((x) => x.callSite === path);
      if (peer !== undefined)
        return `import "wasla/egress-gate.ts";\ncreateGuardedFetch("${peer.id}")`;
      return "// ملفٌّ مُصطنعٌ في الاختبارِ";
    },
    ...overrides,
  };
}

function checks(problems: readonly { check: string }[]): string[] {
  return problems.map((p) => p.check);
}

/** يُعيدُ السجلَّ وقد بُدِّلَ مُدخلٌ واحدٌ بمعرّفِه. */
function replacePeer(id: string, patch: Partial<EgressPeer>): readonly EgressPeer[] {
  return WASLA_EGRESS_REGISTRY.map((p) => (p.id === id ? { ...p, ...patch } : p));
}

describe("حدُّ الصادرِ — الحالةُ الراهنةُ مقيسةٌ", () => {
  test("السجلُّ والوثيقةُ والشيفرةُ متوافقةٌ الآنَ فلا مشكلةَ واحدةً", () => {
    expect(egressProblems(ROADMAP, DOC, DEFAULT_INPUTS)).toEqual([]);
  });

  test("لا مقصدَ واحدَ في MARKET في السجلِّ كلِّه", () => {
    expect(WASLA_EGRESS_REGISTRY.filter((p) => p.system === "MARKET")).toEqual([]);
  });

  test("بابُ CORE واحدٌ لا اثنانِ", () => {
    expect(peersByClass("CORE").map((p) => p.id)).toEqual(["core-events-ingress"]);
  });

  test("قائمةُ الإعفاءاتِ فارغةٌ — لا ثقبَ مفتوحاً", () => {
    expect(HOST_EXEMPTIONS).toEqual([]);
  });

  test("كلُّ موضعِ نداءٍ مُعلَنٍ موجودٌ فعلاً على القرصِ", () => {
    const missing = WASLA_EGRESS_REGISTRY.filter((p) => !DEFAULT_INPUTS.callSiteExists(p.callSite));
    expect(missing.map((p) => p.callSite)).toEqual([]);
  });

  test("المسحُ الحقيقيُّ لا يجدُ مضيفاً غيرَ مُعلَنٍ", () => {
    const declared = new Set(declaredLiteralHosts());
    const undeclared = scanLiteralHosts()
      .map((f) => f.host)
      .filter((h) => !declared.has(h));
    expect(undeclared).toEqual([]);
  });

  test("العدُّ بالصنفِ مطابقٌ لطولِ السجلِّ", () => {
    const total = [...countByClass().values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(WASLA_EGRESS_REGISTRY.length);
  });

  test("`peerById` يجدُ المُعلَنَ ولا يختلقُ غيرَه", () => {
    expect(peerById("core-events-ingress")?.peerClass).toBe("CORE");
    expect(peerById("لا-وجودَ-له")).toBeUndefined();
  });
});

describe("١ — المعرّفُ والغرضُ", () => {
  test("معرّفٌ مكرَّرٌ يُسقِطُ الحاجزَ", () => {
    const dup = WASLA_EGRESS_REGISTRY[0] as EgressPeer;
    const problems = egressProblems(
      ROADMAP,
      DOC,
      baseInputs({ registry: [...WASLA_EGRESS_REGISTRY, dup] }),
    );
    expect(checks(problems).some((c) => c.startsWith("١"))).toBe(true);
  });

  test("مُدخلٌ بلا غرضٍ مكتوبٍ يُسقِطُ الحاجزَ", () => {
    const problems = egressProblems(
      ROADMAP,
      DOC,
      baseInputs({ registry: replacePeer("moyasar-payments", { purpose: "  " }) }),
    );
    expect(checks(problems).some((c) => c.startsWith("١"))).toBe(true);
  });
});

describe("٢ — الحاكمُ: لا مقصدَ في MARKET", () => {
  test('إعلانُ `system: "MARKET"` يُسقِطُ الحاجزَ ولو كانَ الصنفُ CORE', () => {
    const problems = egressProblems(
      ROADMAP,
      DOC,
      baseInputs({ registry: replacePeer("core-events-ingress", { system: "MARKET" }) }),
    );
    const two = problems.filter((p) => p.check.startsWith("٢"));
    expect(two.length).toBeGreaterThan(0);
    expect(two[0]?.detail).toContain("MARKET");
  });

  test("مقصدٌ جديدٌ في MARKET بصنفِ قناةٍ يُسقِطُ الحاجزَ مرّتينِ: النظامُ والبابُ", () => {
    const intruder: EgressPeer = {
      id: "market-direct-orders",
      purpose: "نداءٌ مباشرٌ إلى MARKET — ممنوعٌ",
      peerClass: "CHANNEL",
      system: "MARKET",
      source: { kind: "literal", hosts: ["market.invalid"] },
      callSite: "packages/x/y.ts",
      runtimeGate: {
        kind: "not-applicable",
        reason: "مُدخلٌ مزروعٌ في الاختبارِ لقياسِ رفضِ MARKET — لا نداءَ له في الشيفرةِ",
      },
      removed: false,
    };
    const problems = egressProblems(
      ROADMAP,
      DOC,
      baseInputs({
        registry: [...WASLA_EGRESS_REGISTRY, intruder],
        foundHosts: [
          ...baseInputs().foundHosts,
          { host: "market.invalid", files: ["packages/x/y.ts"] },
        ],
      }),
    );
    expect(checks(problems).some((c) => c.startsWith("٢"))).toBe(true);
    expect(checks(problems).some((c) => c.startsWith("٣"))).toBe(true);
  });
});

describe("٣ — الحاكمُ: بابٌ واحدٌ بينَ الأنظمةِ", () => {
  test("نظامٌ شقيقٌ بصنفٍ غيرِ CORE يُسقِطُ الحاجزَ", () => {
    const problems = egressProblems(
      ROADMAP,
      DOC,
      baseInputs({ registry: replacePeer("supabase-postgres", { system: "CORE" }) }),
    );
    expect(checks(problems).some((c) => c.startsWith("٣"))).toBe(true);
  });

  test("صنفُ CORE بنظامٍ غيرِ CORE يُسقِطُ الحاجزَ", () => {
    const problems = egressProblems(
      ROADMAP,
      DOC,
      baseInputs({ registry: replacePeer("core-events-ingress", { system: "NONE" }) }),
    );
    expect(checks(problems).some((c) => c.startsWith("٣"))).toBe(true);
  });

  test("صنفٌ لا يحملُ نظاماً شقيقاً إن حملَه يُسقِطُ الحاجزَ", () => {
    const problems = egressProblems(
      ROADMAP,
      DOC,
      baseInputs({ registry: replacePeer("unpkg-maplibre", { system: "CORE" }) }),
    );
    expect(checks(problems).some((c) => c.startsWith("٣"))).toBe(true);
  });
});

describe("٤ — القائمةُ مغلقةٌ", () => {
  test("مضيفٌ في الشيفرةِ غيرُ مُعلَنٍ يُسقِطُ الحاجزَ ويُسمّي ملفَّه", () => {
    const problems = egressProblems(
      ROADMAP,
      DOC,
      baseInputs({
        foundHosts: [
          ...baseInputs().foundHosts,
          { host: "silent.example.net", files: ["packages/a/b.ts"] },
        ],
      }),
    );
    const four = problems.filter((p) => p.check.startsWith("٤"));
    expect(four.length).toBe(1);
    expect(four[0]?.detail).toContain("silent.example.net");
    expect(four[0]?.detail).toContain("packages/a/b.ts");
  });

  test("سجلٌّ فارغٌ مع مضيفاتٍ في الشيفرةِ يُسقِطُ الحاجزَ لكلِّ مضيفٍ", () => {
    const found = baseInputs().foundHosts;
    const problems = egressProblems(ROADMAP, DOC, baseInputs({ registry: [] }));
    expect(problems.filter((p) => p.check.startsWith("٤")).length).toBe(found.length);
  });
});

describe("٥ — لا مُدخلَ ميّتاً", () => {
  test("مضيفٌ مُعلَنٌ حرفاً ولا وجودَ له في الشيفرةِ يُسقِطُ الحاجزَ", () => {
    const problems = egressProblems(
      ROADMAP,
      DOC,
      baseInputs({
        foundHosts: baseInputs().foundHosts.filter((f) => f.host !== "api.tap.company"),
      }),
    );
    expect(problems.filter((p) => p.check.startsWith("٥")).length).toBe(1);
  });
});

describe("٦ — الحاكمُ: صدقُ الإزالةِ", () => {
  test("`removed: true` ومضيفُه ما زالَ في الشيفرةِ يُسقِطُ الحاجزَ", () => {
    const problems = egressProblems(
      ROADMAP,
      DOC,
      baseInputs({ registry: replacePeer("moyasar-payments", { removed: true }) }),
    );
    const six = problems.filter((p) => p.check.startsWith("٦"));
    expect(six.length).toBe(1);
    expect(six[0]?.detail).toContain("api.moyasar.com");
  });

  test("`removed: true` ومفتاحُ بيئتِه ما زالَ موثَّقاً يُسقِطُ الحاجزَ", () => {
    const problems = egressProblems(
      ROADMAP,
      DOC,
      baseInputs({
        registry: replacePeer("osrm-routing", { removed: true }),
        envExampleText: "OSRM_BASE_URL=\n",
      }),
    );
    expect(problems.filter((p) => p.check.startsWith("٦")).length).toBeGreaterThan(0);
  });
});

describe("٧ — الدَّينُ التجاريُّ مُعلَنٌ", () => {
  test("تكاملٌ تجاريٌّ بلا `handover` يُسقِطُ الحاجزَ", () => {
    const registry = WASLA_EGRESS_REGISTRY.map((p) => {
      if (p.id !== "moyasar-payments") return p;
      const { handover: _drop, ...rest } = p;
      return rest as EgressPeer;
    });
    const problems = egressProblems(ROADMAP, DOC, baseInputs({ registry }));
    expect(problems.filter((p) => p.check.startsWith("٧")).length).toBe(1);
  });

  test("إحالةُ `handover` إلى معرّفٍ غيرِ مُعلَنٍ في الخارطةِ يُسقِطُ الحاجزَ", () => {
    const problems = egressProblems(
      ROADMAP,
      DOC,
      baseInputs({
        registry: replacePeer("tap-payments", {
          handover: { removedByItem: "W-999", blockedBy: "DEP-CORE-999" },
        }),
      }),
    );
    const seven = problems.filter((p) => p.check.startsWith("٧"));
    expect(seven.length).toBe(2);
    expect(seven.map((p) => p.detail).join(" ")).toContain("W-999");
  });

  test("`handover` على مُدخلٍ غيرِ تجاريٍّ يُسقِطُ الحاجزَ", () => {
    const problems = egressProblems(
      ROADMAP,
      DOC,
      baseInputs({
        registry: replacePeer("map-tiles", {
          handover: { removedByItem: "W-7", blockedBy: "DEP-CORE-002" },
        }),
      }),
    );
    expect(problems.filter((p) => p.check.startsWith("٧")).length).toBe(1);
  });

  test("كلُّ إحالةٍ تجاريّةٍ راهنةٍ مُعلَنةٌ فعلاً في `ROADMAP.md`", () => {
    for (const peer of peersByClass("COMMERCIAL_PENDING_HANDOVER")) {
      expect(peer.handover).toBeDefined();
      expect(ROADMAP).toContain(peer.handover?.removedByItem ?? "");
      expect(ROADMAP).toContain(peer.handover?.blockedBy ?? "");
    }
  });
});

describe("٨ — المصدرُ مقيسٌ", () => {
  test("موضعُ نداءٍ لا وجودَ له يُسقِطُ الحاجزَ", () => {
    const problems = egressProblems(ROADMAP, DOC, baseInputs({ callSiteExists: () => false }));
    expect(problems.filter((p) => p.check.startsWith("٨")).length).toBe(
      WASLA_EGRESS_REGISTRY.length,
    );
  });

  test("مفتاحُ بيئةٍ غيرُ موثَّقٍ في `.env.example` يُسقِطُ الحاجزَ", () => {
    const problems = egressProblems(ROADMAP, DOC, baseInputs({ envExampleText: "" }));
    expect(problems.filter((p) => p.check.startsWith("٨")).length).toBeGreaterThan(0);
  });

  test("حزمةٌ غيرُ مُعلَنةٍ في `package.json` تُسقِطُ الحاجزَ", () => {
    const problems = egressProblems(ROADMAP, DOC, baseInputs({ packageJsonText: "{}" }));
    expect(problems.filter((p) => p.check.startsWith("٨")).length).toBeGreaterThan(0);
  });

  test("مصدرٌ حرفيٌّ بلا مضيفٍ يُسقِطُ الحاجزَ", () => {
    const problems = egressProblems(
      ROADMAP,
      DOC,
      baseInputs({
        registry: replacePeer("unpkg-maplibre", { source: { kind: "literal", hosts: [] } }),
      }),
    );
    expect(problems.filter((p) => p.check.startsWith("٨")).length).toBeGreaterThan(0);
  });
});

describe("٩ — الإعفاءُ ليسَ باباً خلفيّاً", () => {
  test("إعفاءُ مضيفٍ حقيقيٍّ يُسقِطُ الحاجزَ", () => {
    const problems = egressProblems(
      ROADMAP,
      DOC,
      baseInputs({
        exemptions: [{ host: "market.wasla.sa", reason: "تمريرٌ" }],
        foundHosts: [
          ...baseInputs().foundHosts,
          { host: "market.wasla.sa", files: ["packages/a/b.ts"] },
        ],
      }),
    );
    expect(problems.filter((p) => p.check.startsWith("٩")).length).toBe(1);
  });

  test("إعفاءٌ ميّتٌ لا يظهرُ في المسحِ يُسقِطُ الحاجزَ", () => {
    const problems = egressProblems(
      ROADMAP,
      DOC,
      baseInputs({ exemptions: [{ host: "example.com", reason: "نائبٌ محفوظٌ" }] }),
    );
    expect(problems.filter((p) => p.check.startsWith("٩")).length).toBe(1);
  });

  test("إعفاءٌ بلا سببٍ مكتوبٍ يُسقِطُ الحاجزَ", () => {
    const problems = egressProblems(
      ROADMAP,
      DOC,
      baseInputs({
        exemptions: [{ host: "example.com", reason: "" }],
        foundHosts: [
          ...baseInputs().foundHosts,
          { host: "example.com", files: ["packages/a/b.ts"] },
        ],
      }),
    );
    expect(problems.filter((p) => p.check.startsWith("٩")).length).toBe(1);
  });
});

describe("١٠ — الوثيقةُ مُولَّدةٌ لا مكتوبةٌ بيدٍ", () => {
  test("علامتا التوليدِ مفقودتانِ تُسقِطُ الحاجزَ", () => {
    const problems = egressProblems(ROADMAP, "# وثيقةٌ بلا علامتَينِ\n", baseInputs());
    expect(problems.filter((p) => p.check.startsWith("١٠")).length).toBe(1);
  });

  test("تحريرُ الوثيقةِ بيدٍ يُسقِطُ الحاجزَ", () => {
    const tampered = DOC.replace("`core-events-ingress`", "`core-events-ingress-تحريرٌ-يدويٌّ`");
    expect(tampered).not.toBe(DOC);
    const problems = egressProblems(ROADMAP, tampered, baseInputs());
    expect(problems.filter((p) => p.check.startsWith("١٠")).length).toBe(1);
  });

  test("الكتلةُ المُولَّدةُ تُعلِنُ صفرَ مقصدٍ في MARKET", () => {
    expect(renderDoc()).toContain("صفرَ مقصدٍ في MARKET");
  });

  test("`withGeneratedBlock` يرفضُ نصّاً بلا علامتَينِ", () => {
    expect(() => withGeneratedBlock("لا علاماتَ", "x")).toThrow();
  });
});

describe("نزعُ التعليقاتِ — رابطٌ في تعليقٍ ليسَ صادراً", () => {
  test("الرابطُ في تعليقِ سطرٍ لا يُقرأُ مقصداً", () => {
    expect(stripComments("// https://docs.example.org/a\nconst a = 1;")).not.toContain(
      "docs.example.org",
    );
  });

  test("الرابطُ في تعليقِ كتلةٍ لا يُقرأُ مقصداً وتُحفَظُ الأسطرُ", () => {
    const out = stripComments("/*\n https://docs.example.org/a\n*/\nconst a = 1;");
    expect(out).not.toContain("docs.example.org");
    expect(out.split("\n").length).toBe(4);
  });

  test("الرابطُ في نصٍّ حرفيٍّ يُحفَظُ فيُقرأُ مقصداً", () => {
    expect(stripComments('const u = "https://api.real.example/v1";')).toContain("api.real.example");
  });

  test("`//` داخلَ نصٍّ حرفيٍّ لا يُعَدُّ بدايةَ تعليقٍ", () => {
    expect(stripComments('const u = "https://api.real.example/v1"; const b = 2;')).toContain(
      "const b = 2",
    );
  });

  test("مِحرافُ الهروبِ داخلَ النصِّ لا يُخرِجُ من النصِّ", () => {
    expect(stripComments('const s = "a\\"b"; // تعليقٌ\nconst c = 3;')).not.toContain("تعليقٌ");
  });
});

describe("بوّابةُ التشغيلِ — الفحوصُ ١١ و١٢ و١٣ تُخفِقُ عندَ الخرقِ", () => {
  test("١١ — استثناءُ المسحِ متقادمٌ: ملفُّ السجلِّ غائبٌ", () => {
    const problems = egressProblems(
      ROADMAP,
      DOC,
      baseInputs({
        readSource: (path) =>
          path === "packages/shared/wasla/egress-registry.ts" ? undefined : "createGuardedFetch",
      }),
    );
    expect(checks(problems).some((c) => c.startsWith("١١"))).toBe(true);
  });

  test("١١ — المُستثنى ليسَ ملفَّ السجلِّ: استثناءٌ مُوسَّعٌ إلى شيفرةٍ تُنادي", () => {
    const problems = egressProblems(
      ROADMAP,
      DOC,
      baseInputs({ readSource: () => "// شيفرةٌ ما بلا سجلٍّ" }),
    );
    expect(checks(problems).some((c) => c.startsWith("١١"))).toBe(true);
  });

  test("١١ — بوّابةُ التشغيلِ مفقودةٌ: إعفاءٌ بلا مُعفًى", () => {
    const problems = egressProblems(
      ROADMAP,
      DOC,
      baseInputs({
        readSource: (path) => {
          if (path === "packages/shared/wasla/egress-gate.ts") return undefined;
          if (path === "packages/shared/wasla/egress-registry.ts") return "WASLA_EGRESS_REGISTRY";
          const peer = WASLA_EGRESS_REGISTRY.find((x) => x.callSite === path);
          return peer === undefined
            ? "//"
            : `import "wasla/egress-gate.ts";\ncreateGuardedFetch("${peer.id}")`;
        },
      }),
    );
    expect(checks(problems).some((c) => c.startsWith("١١"))).toBe(true);
  });

  test("١٢ — `fetch` عارياً في ملفِّ خادمٍ غيرِ مُعلَنٍ يُرفَضُ", () => {
    const problems = egressProblems(
      ROADMAP,
      DOC,
      baseInputs({
        bareFetchFiles: [
          ...DEFAULT_INPUTS.browserFetchSites.map((b) => b.path),
          "packages/infrastructure/x/rogue-client.ts",
        ],
      }),
    );
    const twelve = problems.filter((p) => p.check.startsWith("١٢"));
    expect(twelve.length).toBe(1);
    expect(twelve[0]?.detail).toContain("rogue-client.ts");
  });

  test("١٢ — إعفاءُ متصفّحٍ ميّتٌ: مُعلَنٌ ولا `fetch` فيه", () => {
    const problems = egressProblems(ROADMAP, DOC, baseInputs({ bareFetchFiles: [] }));
    expect(problems.filter((p) => p.check.startsWith("١٢")).length).toBe(
      DEFAULT_INPUTS.browserFetchSites.length,
    );
  });

  test("١٢ — إعفاءُ متصفّحٍ بلا سببٍ مكتوبٍ يُرفَضُ", () => {
    const problems = egressProblems(
      ROADMAP,
      DOC,
      baseInputs({
        browserFetchSites: [{ path: "apps/admin-dashboard/src/layout.ts", reason: "  " }],
        bareFetchFiles: ["apps/admin-dashboard/src/layout.ts"],
      }),
    );
    expect(checks(problems).some((c) => c.startsWith("١٢"))).toBe(true);
  });

  test("١٣ — مقصدٌ مُلزَمٌ بالبوّابةِ وملفُّه لا يستوردُها", () => {
    const problems = egressProblems(
      ROADMAP,
      DOC,
      baseInputs({
        readSource: (path) => {
          if (path === "packages/shared/wasla/egress-registry.ts") return "WASLA_EGRESS_REGISTRY";
          if (path === "packages/shared/wasla/egress-gate.ts") return "createGuardedFetch";
          return "// نداءٌ بلا بوّابةٍ";
        },
      }),
    );
    const thirteen = problems.filter((p) => p.check.startsWith("١٣"));
    expect(thirteen.length).toBeGreaterThan(0);
    expect(thirteen.some((p) => p.detail.includes("لا يستوردُ البوّابةَ"))).toBe(true);
  });

  test("١٣ — البوّابةُ في الملفِّ لكن لمقصدٍ آخرَ: خلطُ معرّفاتٍ", () => {
    const problems = egressProblems(
      ROADMAP,
      DOC,
      baseInputs({
        readSource: (path) => {
          if (path === "packages/shared/wasla/egress-registry.ts") return "WASLA_EGRESS_REGISTRY";
          if (path === "packages/shared/wasla/egress-gate.ts") return "createGuardedFetch";
          return 'import "wasla/egress-gate.ts";\ncreateGuardedFetch("some-other-peer")';
        },
      }),
    );
    expect(
      problems.some((p) => p.check.startsWith("١٣") && p.detail.includes("لا يذكرُ معرّفَه حرفاً")),
    ).toBe(true);
  });

  test("١٣ — «لا تنطبقُ» بلا سببٍ مكتوبٍ إعفاءٌ بلا مقابلٍ", () => {
    const problems = egressProblems(
      ROADMAP,
      DOC,
      baseInputs({
        registry: replacePeer("supabase-postgres", {
          runtimeGate: { kind: "not-applicable", reason: "" },
        }),
      }),
    );
    expect(checks(problems).some((c) => c.startsWith("١٣"))).toBe(true);
  });

  test("المُدخلاتُ الحقيقيّةُ نظيفةٌ في هذه الفحوصِ الثلاثةِ", () => {
    const problems = egressProblems(ROADMAP, DOC, DEFAULT_INPUTS);
    expect(
      problems.filter(
        (p) => p.check.startsWith("١١") || p.check.startsWith("١٢") || p.check.startsWith("١٣"),
      ),
    ).toEqual([]);
  });
});
