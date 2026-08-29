/**
 * الغرض: إثباتُ أنّ حاجزَ ميزانيةِ الأداءِ **يسقط**. وحاجزٌ يُختبَر بالحالةِ
 *   السليمةِ وحدَها لا يُثبِت شيئاً: البناءُ اليومَ داخلَ الميزانيةِ، فمرورُه
 *   متوقَّعٌ ولا يميّز فاحصاً يعمل من فاحصٍ يطبع «✓» ويخرج بصفرٍ أبداً.
 * الحالة: منفّذ فعلياً — البند `F1-09`.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: كلُّ تعديلٍ على حدودِ القسم 9.9 أو على قائمةِ الحزمِ
 *   المأذونِ بها.
 * ملاحظات مستقبلية: الحقائقُ ههنا **مصنوعةٌ** لا مبنيّةٌ — والدالّةُ المفحوصةُ
 *   نقيّةٌ لهذا الغرضِ بعينِه. ويبقى جزءٌ لا يُختبَر بهذا الملفِّ: قراءةُ
 *   `dist/index.html` نفسِها، ويحرسها فحصُ الحضورِ في البوّابةِ (مُخرَجٌ فارغٌ =
 *   سقوطٌ) وتشغيلُ البوّابةِ في CI بعدَ بناءٍ حقيقيّ.
 *
 * وهذا الملفُّ **لا يقيس زمناً**: خمسةُ صفوفٍ من القسم 9.9 خارجَ التغطيةِ تماماً
 * ومُعلَنةٌ في `docs/evidence/architecture/F1-09-20260829.md` §٣، فلا يُقرأ نجاحُ
 * هذا الملفِّ نجاحاً لميزانيةِ الأداءِ كلِّها.
 */

import { describe, expect, it } from "bun:test";
import {
  type AssetSize,
  AUTHORIZED_BUNDLES,
  BUDGET,
  type BuildFacts,
  bundleNameOf,
  evaluate,
} from "../../scripts/lib/performance-budget.ts";

const KB = 1024;

function asset(bundle: string, gzipBytes: number): AssetSize {
  return { file: `assets/${bundle}-AbCdEfGh.js`, bundle, rawBytes: gzipBytes * 3, gzipBytes };
}

/** بناءٌ سليمٌ: ستةُ طلباتٍ بالحدِّ، حملٌ أوّلُ تحتَ الميزانيةِ، حزمٌ مؤجَّلةٌ صغيرة. */
function healthyFacts(): BuildFacts {
  return {
    requests: [
      { kind: "document", target: "index.html", external: false },
      /**
       * سكربتٌ خارجيٌّ في الرأسِ — وهو في الواقعِ سكربتُ تيليجرامَ. وعنوانُه
       * الحقيقيُّ **لا يُكتب ههنا** لأنّ حاجزَ `F1-02` يحصر ورودَه في
       * `apps/miniapp/index.html` وحدَه (القسم 9.2)، والمفحوصُ ههنا **عددُ**
       * الطلباتِ لا نطاقُها. وتطابُقُ العنوانِ مع المُخرَجِ يحرسه حاجزٌ أخر،
       * وإدخالُ نسخةٍ ثانيةٍ من العنوانِ في ملفِّ اختبارٍ يفتح ما أُغلِق.
       */
      { kind: "script", target: "https://external.invalid/host-sdk.js", external: true },
      { kind: "script", target: "/assets/index-AbCdEfGh.js", external: false },
      { kind: "modulepreload", target: "/assets/vendor-react-AbCdEfGh.js", external: false },
      { kind: "modulepreload", target: "/assets/shell-AbCdEfGh.js", external: false },
      { kind: "modulepreload", target: "/assets/identity-AbCdEfGh.js", external: false },
    ],
    eager: [
      asset("index", 1 * KB),
      asset("vendor-react", 60 * KB),
      asset("shell", 9 * KB),
      asset("identity", 2 * KB),
    ],
    lazy: [asset("rider-home", 1 * KB), asset("driver", 1 * KB), asset("admin", 1 * KB)],
    inlineStyleGzipBytes: 2 * KB,
  };
}

function rules(facts: BuildFacts): readonly string[] {
  return evaluate(facts).map((violation) => violation.rule);
}

describe("F1-09: البناءُ السليمُ يمرُّ", () => {
  it("لا مخالفةَ واحدةً على حقائقَ داخلَ كلِّ حدٍّ", () => {
    expect(evaluate(healthyFacts())).toEqual([]);
  });

  it("ستةُ طلباتٍ بالحدِّ تمرُّ — والحدُّ «≤ 6» لا «< 6»", () => {
    const facts = healthyFacts();
    expect(facts.requests).toHaveLength(BUDGET.firstPaintRequests);
    expect(rules(facts)).not.toContain("طلباتُ الشبكةِ لأوّلِ رسمٍ ≤ 6 (9.9)");
  });
});

describe("F1-09: الحملُ الأوّلُ فوقَ 180 KB يُسقِط البناء", () => {
  it("مجموعُ ما يُنزَّل قبلَ أوّلِ رسمٍ محسوبٌ كلُّه — لا حزمتا `shell`+`identity` وحدَهما", () => {
    const facts: BuildFacts = {
      ...healthyFacts(),
      // كلُّ واحدةٍ تحتَ الحدِّ، والمجموعُ فوقَه: هذه هي الثغرةُ التي تُغلَق.
      eager: [asset("shell", 100 * KB), asset("identity", 40 * KB), asset("vendor-react", 60 * KB)],
      inlineStyleGzipBytes: 0,
    };
    expect(rules(facts)).toContain("الحملُ الأوّل ≤ 180 KB بعدَ الضغط (9.9)");
  });

  it("والأنماطُ المُدمَجةُ في المستندِ محسوبةٌ: الدمجُ يُسقِط طلباً لا بايتاتٍ", () => {
    const facts: BuildFacts = {
      ...healthyFacts(),
      eager: [asset("shell", 170 * KB), asset("identity", 5 * KB)],
      inlineStyleGzipBytes: 10 * KB,
    };
    expect(rules(facts)).toContain("الحملُ الأوّل ≤ 180 KB بعدَ الضغط (9.9)");
  });

  it("والقراءةُ الحرفيّةُ للصفِّ تُبلَّغ على حِدَة", () => {
    const facts: BuildFacts = {
      ...healthyFacts(),
      eager: [asset("shell", 150 * KB), asset("identity", 40 * KB)],
      inlineStyleGzipBytes: 0,
    };
    expect(rules(facts)).toContain("`shell` + `identity` ≤ 180 KB بعدَ الضغط (9.9)");
  });

  it("وحملٌ أوّلٌ عندَ الحدِّ بالضبطِ يمرُّ", () => {
    const facts: BuildFacts = {
      ...healthyFacts(),
      eager: [asset("shell", BUDGET.eagerGzipBytes - 1 * KB), asset("identity", 1 * KB)],
      inlineStyleGzipBytes: 0,
    };
    expect(rules(facts)).not.toContain("الحملُ الأوّل ≤ 180 KB بعدَ الضغط (9.9)");
  });
});

describe("F1-09: حزمةٌ مؤجَّلةٌ فوقَ 120 KB تُسقِط البناء", () => {
  it("كلُّ حزمةٍ على حِدَةٍ لا مجموعُها — حزمةٌ ثقيلةٌ واحدةٌ تكفي", () => {
    const facts: BuildFacts = {
      ...healthyFacts(),
      lazy: [asset("driver", 1 * KB), asset("map", BUDGET.lazyChunkGzipBytes + 1)],
    };
    const violations = evaluate(facts);
    expect(violations.map((violation) => violation.rule)).toContain(
      "حزمةٌ مؤجَّلةٌ ≤ 120 KB بعدَ الضغط (9.9)",
    );
    // ورسالةُ الخطأِ تُسمّي الملفَّ: بوّابةٌ تقول «تجاوزتَ» بلا أن تقول أين تُعطَّل.
    expect(violations.map((violation) => violation.detail).join(" ")).toContain("map");
  });

  it("وحزمةٌ عندَ الحدِّ بالضبطِ تمرُّ", () => {
    const facts: BuildFacts = {
      ...healthyFacts(),
      lazy: [asset("map", BUDGET.lazyChunkGzipBytes)],
    };
    expect(rules(facts)).not.toContain("حزمةٌ مؤجَّلةٌ ≤ 120 KB بعدَ الضغط (9.9)");
  });
});

describe("F1-09: طلبٌ سابعٌ في مسارِ أوّلِ رسمٍ يُسقِط البناء", () => {
  it("ورقةُ أنماطٍ تُطلَب من الشبكةِ بدلَ دمجِها = الطلبُ السابع", () => {
    const facts: BuildFacts = {
      ...healthyFacts(),
      requests: [
        ...healthyFacts().requests,
        { kind: "stylesheet", target: "/assets/shell-AbCdEfGh.css", external: false },
      ],
    };
    expect(rules(facts)).toContain("طلباتُ الشبكةِ لأوّلِ رسمٍ ≤ 6 (9.9)");
  });

  it("والنطاقُ الخارجيُّ يُحسَب طلباً وإن لم تُحسَب بايتاتُه", () => {
    const facts: BuildFacts = {
      ...healthyFacts(),
      requests: [
        ...healthyFacts().requests,
        { kind: "script", target: "https://cdn.example.com/x.js", external: true },
      ],
    };
    expect(rules(facts)).toContain("طلباتُ الشبكةِ لأوّلِ رسمٍ ≤ 6 (9.9)");
  });
});

describe("F1-09: اسمُ حزمةٍ ليس في القسم 9.4 يُسقِط البناء", () => {
  it("حزمةُ `tg` — وهي الانحرافُ الحقيقيُّ الذي كشفه هذا الحاجز", () => {
    const facts: BuildFacts = {
      ...healthyFacts(),
      eager: [...healthyFacts().eager, asset("tg", 3 * KB)],
    };
    const violations = evaluate(facts);
    expect(violations.map((violation) => violation.rule)).toContain(
      "أسماءُ الحزمِ من القسم 9.4 وحدَه",
    );
    expect(violations.map((violation) => violation.detail).join(" ")).toContain("tg");
  });

  it("واسمٌ مخترعٌ في الحزمِ المؤجَّلةِ يُسقِط البناءَ كذلك", () => {
    const facts: BuildFacts = { ...healthyFacts(), lazy: [asset("analytics-vendor", 5 * KB)] };
    expect(rules(facts)).toContain("أسماءُ الحزمِ من القسم 9.4 وحدَه");
  });

  it("وكلُّ اسمٍ في القسم 9.4 مقبولٌ بلا استثناء", () => {
    for (const bundle of AUTHORIZED_BUNDLES) {
      const facts: BuildFacts = { ...healthyFacts(), lazy: [asset(bundle, 1 * KB)] };
      expect(rules(facts)).not.toContain("أسماءُ الحزمِ من القسم 9.4 وحدَه");
    }
  });
});

describe("F1-09: حواجزُ الحضورِ — مُخرَجٌ ناقصٌ لا يمرُّ صامتاً", () => {
  it("لا أصلَ في الحملِ الأوّل", () => {
    expect(rules({ ...healthyFacts(), eager: [] })).toContain("حضورُ الحملِ الأوّل");
  });

  it("لا طلبَ واحدَ — والمستندُ نفسُه طلبٌ فالصفرُ يعني فشلَ قراءةٍ لا بناءً خفيفاً", () => {
    expect(rules({ ...healthyFacts(), requests: [] })).toContain("حضورُ الطلبات");
  });

  it("لا حزمةَ مؤجَّلةً: تقسيمُ الكودِ إلزاميٌّ في القسم 9.4", () => {
    expect(rules({ ...healthyFacts(), lazy: [] })).toContain("تقسيمُ الكودِ إلزاميٌّ (9.4)");
  });

  it("غيابُ `identity` من الحملِ الأوّلِ يُسقِط البناءَ — الفصلُ لا يعني التأجيل", () => {
    const facts: BuildFacts = {
      ...healthyFacts(),
      eager: healthyFacts().eager.filter((item) => item.bundle !== "identity"),
    };
    expect(rules(facts)).toContain("حزمتا `shell` و`identity` تُحمَّلان فوراً (9.4)");
  });

  it("وغيابُ `shell` كذلك", () => {
    const facts: BuildFacts = {
      ...healthyFacts(),
      eager: healthyFacts().eager.filter((item) => item.bundle !== "shell"),
    };
    expect(rules(facts)).toContain("حزمتا `shell` و`identity` تُحمَّلان فوراً (9.4)");
  });
});

describe("F1-09: الأرقامُ هي أرقامُ القسم 9.9 حرفياً", () => {
  it("180 KB · 120 KB · 6 — كي لا تُخفَّف في سطرٍ لا يقرأه أحد", () => {
    expect(BUDGET.eagerGzipBytes).toBe(180 * 1024);
    expect(BUDGET.lazyChunkGzipBytes).toBe(120 * 1024);
    expect(BUDGET.firstPaintRequests).toBe(6);
  });
});

describe("F1-09: نزعُ البصمةِ من اسمِ الملفّ", () => {
  it("لا يأكل من الاسمِ نفسِه — والخطأُ ههنا يُنتِج مخالفةً كاذبة", () => {
    expect(bundleNameOf("assets/shell-DjHgntGc.js")).toBe("shell");
    expect(bundleNameOf("assets/rider-home-CyeAoQpm.js")).toBe("rider-home");
    expect(bundleNameOf("assets/vendor-react-DGj8QgOs.js")).toBe("vendor-react");
    expect(bundleNameOf("assets/shell-DjHgntGc.css")).toBe("shell");
    expect(bundleNameOf("assets/identity-CMhQ8trW.js")).toBe("identity");
  });

  it("وبصمةٌ تحمل `-` أو `_` لا تخدعه", () => {
    expect(bundleNameOf("assets/rider-ride-A_b-C1d2.js")).toBe("rider-ride");
  });
});
