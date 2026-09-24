/**
 * الغرض: اختباراتُ تقسيمِ القاموسِ العربيِّ (`F1-09` · `D-33` · `ADR 0188`) — القاعدةُ والملحقُ والحاجزُ.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import { partitionForImporter } from "../../apps/miniapp/vite/arabic-partitions.ts";
import {
  dictionaryPartitionViolations,
  type PartitionChunk,
} from "../../apps/miniapp/vite/assert-dictionary-partitions.ts";
import ar from "../../packages/shared/i18n/miniapp/ar.json" with { type: "json" };
import {
  ARABIC_DEFERRED_PARTITIONS,
  ARABIC_PARTITION_NAMES,
  arabicPartitionOf,
  arabicPartitionOfLiteral,
  pickArabicPartition,
} from "../../packages/shared/i18n/miniapp/partitions.ts";

const dictionary = ar as Record<string, string>;
const I18N = "/repo/packages/shared/i18n/miniapp";

describe("قاعدةُ التقسيمِ", () => {
  it("كلُّ مفتاحٍ في جزءٍ واحدٍ بالضبطِ، والأجزاءُ تستوعبُ القاموسَ كلَّه", () => {
    const sizes = ARABIC_PARTITION_NAMES.map(
      (p) => Object.keys(pickArabicPartition(dictionary, p)).length,
    );
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(Object.keys(dictionary).length);
    for (const size of sizes) expect(size).toBeGreaterThan(0);
  });

  it("لا بادئةَ تحتوي أخرى — فالترتيبُ لا يُغيِّرُ النسبةَ", () => {
    const all = Object.values(ARABIC_DEFERRED_PARTITIONS).flat() as string[];
    for (const a of all) for (const b of all) if (a !== b) expect(a.startsWith(b)).toBe(false);
  });

  it("نصوصُ السطحِ الأوّلِ والإطارِ في `core`", () => {
    for (const key of Object.keys(dictionary)) {
      if (/^(?:welcome|consent|rider\.(?:home|quote|destination|sos|search|summary))\./.test(key)) {
        expect(arabicPartitionOf(key)).toBe("core");
      }
    }
    expect(arabicPartitionOf("driver.offers.title")).toBe("driver");
    expect(arabicPartitionOf("rider.history.title")).toBe("rider-history");
  });

  it("الحرفُ الثابتُ يُنسَبُ ببادئتِه، والأقصرُ من بادئةِ جزءٍ ملتبسٌ", () => {
    expect(arabicPartitionOfLiteral("rider.support.category.")).toBe("support");
    expect(arabicPartitionOfLiteral("rider.home.title")).toBe("core");
    expect(arabicPartitionOfLiteral("rider.")).toBe("ambiguous");
    expect(arabicPartitionOfLiteral("rider.acc")).toBe("ambiguous");
  });
});

describe("الملحقُ: الجزءُ بحسبِ المستورِدِ", () => {
  it("`core.ts` ← core · `ar-parts/<x>.ts` ← x · غيرُهما لا يُمَسُّ", () => {
    expect(partitionForImporter("./ar.json", `${I18N}/core.ts`)).toBe("core");
    expect(partitionForImporter("../ar.json", `${I18N}/ar-parts/driver.ts`)).toBe("driver");
    expect(partitionForImporter("./ar.json", `${I18N}/index.ts`)).toBeNull();
    expect(partitionForImporter("./en.json", `${I18N}/core.ts`)).toBeNull();
  });

  it("وحدةُ تسجيلٍ بلا جزءٍ مُعلَنٍ تُسقِطُ البناءَ لا تمرُّ", () => {
    expect(() => partitionForImporter("../ar.json", `${I18N}/ar-parts/ghost.ts`)).toThrow("D-33");
  });
});

describe("الحاجزُ", () => {
  const shell: PartitionChunk = {
    fileName: "shell.js",
    imports: [],
    modules: {
      "\0waslah-ar-part:core": 'var a={"rider.home.title":"x"}',
      "/src/Shell.tsx": 't("rider.home.title")',
    },
  };
  const driver = (withRegistration: boolean): PartitionChunk => ({
    fileName: "driver.js",
    imports: ["shell.js"],
    modules: {
      ...(withRegistration
        ? {
            [`${I18N}/ar-parts/driver.ts`]: "extend(a)",
            "\0waslah-ar-part:driver": 'var a={"driver.x":"y"}',
          }
        : {}),
      "/src/surfaces/driver/Board.tsx": `t(\`driver.offers.\${"k"}\`)`,
    },
  });

  it("يقبلُ حزمةً تُسجِّلُ جزأَها، ولا يقرأُ بياناتِ الأجزاءِ استعمالاً", () => {
    expect(dictionaryPartitionViolations([shell, driver(true)])).toEqual([]);
  });

  it("يرفضُ مفتاحاً مؤجَّلاً في حزمةٍ لا تَبلُغُ تسجيلَه", () => {
    const v = dictionaryPartitionViolations([shell, driver(false)]);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("driver.offers.");
  });

  it("تسجيلٌ في حزمةٍ مستورَدةٍ ثابتاً يكفي، ولا يكفي المستورِدُ", () => {
    const child: PartitionChunk = {
      fileName: "c.js",
      imports: ["driver.js"],
      modules: { "/x.ts": '"driver.job.title"' },
    };
    expect(dictionaryPartitionViolations([shell, driver(true), child])).toEqual([]);
    const parentUse: PartitionChunk = {
      ...shell,
      modules: { ...shell.modules, "/y.ts": '"driver.job.title"' },
    };
    expect(dictionaryPartitionViolations([parentUse, driver(true)]).length).toBe(1);
  });

  it("يرفضُ `ar.json` كاملاً وحرفاً ملتبساً", () => {
    const leaked: PartitionChunk = {
      fileName: "s.js",
      imports: [],
      modules: { [`${I18N}/ar.json`]: "{}", "/z.ts": '"rider."' },
    };
    const v = dictionaryPartitionViolations([leaked]);
    expect(v.some((m) => m.includes("كاملاً"))).toBe(true);
    expect(v.some((m) => m.includes("rider."))).toBe(true);
  });
});
