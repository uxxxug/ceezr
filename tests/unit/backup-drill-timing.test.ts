/**
 * الغرض: سالباتٌ مبذورةٌ لكلِّ قاعدةٍ من قواعدِ حَكَمِ زمنِ تمرينِ الاستعادةِ
 *   (`ح-7`): كلُّ قاعدةٍ لها كسرٌ مزروعٌ يُثبِتُ أنَّها تُمسِكُهُ، وموجبةٌ تُثبِتُ
 *   أنَّها لا تعضُّ البريءَ.
 * الحالة: مُنفَّذ · مُختبَر.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import { judgeDrillTimings } from "../../scripts/lib/backup-drill-timing.ts";

const healthy = {
  timings: {
    sourceFingerprintMs: 41.2,
    restoreMs: 1803.7,
    restoredFingerprintMs: 39.9,
  },
  dumpMs: 512.5,
  totalMs: 2450.1,
  detail: {
    timings: {
      sourceFingerprintMs: 41.2,
      restoreMs: 1803.7,
      restoredFingerprintMs: 39.9,
    },
  },
};

describe("حَكَمُ زمنِ تمرينِ الاستعادة (F11-10 · ADR 0201)", () => {
  it("الموجبةُ الكاملةُ: أطوارٌ موجبةٌ، كلٌّيٌّ يغطّي، وسجلٌّ يطابقُ", () => {
    const verdict = judgeDrillTimings(healthy);
    expect(verdict.verdict).toBe("ok");
    expect(verdict.violations).toEqual([]);
    expect(verdict.rules).toHaveLength(8);
  });

  it("الحدُّ الأدنى الشرعيُّ: أطوارُ الاستعادةِ وحدَها بلا تفريغٍ ولا كلّيٍّ ولا سجلٍّ", () => {
    const verdict = judgeDrillTimings({
      timings: { sourceFingerprintMs: 1.4, restoreMs: 900.2, restoredFingerprintMs: 1.1 },
    });
    expect(verdict.verdict).toBe("ok");
  });

  it("ح-7: `timing.recorded` — غيابُ طورٍ واحدٍ يُدينُ التمرينَ كلَّهُ", () => {
    const verdict = judgeDrillTimings({
      timings: { sourceFingerprintMs: 41.2, restoredFingerprintMs: 39.9 },
    });
    expect(verdict.violations).toContain("timing.recorded");
    expect(verdict.violations).toContain("timing.restore-positive");
  });

  it("ح-7: غيابُ الأزمنةِ كلِّها — نجاحٌ بلا زمنٍ — مُدانٌ لا مقبولٌ", () => {
    const verdict = judgeDrillTimings({});
    expect(verdict.verdict).toBe("violation");
    expect(verdict.violations).toContain("timing.recorded");
  });

  it("ح-7: `timing.source-fingerprint-positive` — صفرٌ يُدينُ", () => {
    const verdict = judgeDrillTimings({
      timings: { sourceFingerprintMs: 0, restoreMs: 900.2, restoredFingerprintMs: 1.1 },
    });
    expect(verdict.violations).toContain("timing.source-fingerprint-positive");
  });

  it("ح-7: `timing.restore-positive` — سالبٌ يُدينُ (ساعةٌ مقلوبةٌ أو مُختلَقةٌ)", () => {
    const verdict = judgeDrillTimings({
      timings: { sourceFingerprintMs: 41.2, restoreMs: -3, restoredFingerprintMs: 1.1 },
    });
    expect(verdict.violations).toContain("timing.restore-positive");
  });

  it("ح-7: `timing.restored-fingerprint-positive` — `NaN` يُدينُ", () => {
    const verdict = judgeDrillTimings({
      timings: { sourceFingerprintMs: 41.2, restoreMs: 900.2, restoredFingerprintMs: Number.NaN },
    });
    expect(verdict.violations).toContain("timing.restored-fingerprint-positive");
  });

  it("ح-7: `Infinity` في طورِ الاستعادةِ يُدينُ (قسمةٌ على صفرٍ لا قياسٌ)", () => {
    const verdict = judgeDrillTimings({
      timings: {
        sourceFingerprintMs: 41.2,
        restoreMs: Number.POSITIVE_INFINITY,
        restoredFingerprintMs: 1.1,
      },
    });
    expect(verdict.violations).toContain("timing.restore-positive");
  });

  it("ح-7: `timing.dump-positive` — تفريغٌ صفرٌ وُثِّقَ يُدينُ", () => {
    const verdict = judgeDrillTimings({ ...healthy, dumpMs: 0 });
    expect(verdict.violations).toContain("timing.dump-positive");
  });

  it("ح-7: من لم يُوثِّقْ تفريغاً لا يُدانْ عليهِ (شرطيّةٌ لا إلزامٌ)", () => {
    const { dumpMs: _dumpMs, ...withoutDump } = healthy;
    const verdict = judgeDrillTimings(withoutDump);
    expect(verdict.verdict).toBe("ok");
    expect(verdict.rules.some((rule) => rule.id === "timing.dump-positive")).toBe(false);
  });

  it("ح-7: `timing.total-positive` — كلّيٌّ صفرٌ يُدينُ", () => {
    const verdict = judgeDrillTimings({ ...healthy, totalMs: 0 });
    expect(verdict.violations).toContain("timing.total-positive");
  });

  it("ح-7: `timing.total-covers-phases` — كلّيٌّ أصغرُ من مجموعِ أطوارِهِ مُختلَقٌ", () => {
    const verdict = judgeDrillTimings({
      ...healthy,
      totalMs: 100, // المجموعُ الحقيقيُّ ≈ 2397.3
    });
    expect(verdict.violations).toContain("timing.total-covers-phases");
  });

  it("ح-7: الكلّيُّ يغطّي الأطوارَ فلا يُدانْ (حدُّ نصفِ المليّ ثانيةٍ لتقريبِ العومِ)", () => {
    const verdict = judgeDrillTimings({
      ...healthy,
      totalMs:
        healthy.dumpMs +
        healthy.timings.sourceFingerprintMs +
        healthy.timings.restoreMs +
        healthy.timings.restoredFingerprintMs -
        0.3,
    });
    expect(verdict.verdict).toBe("ok");
  });

  it("ح-7: `timing.detail-persisted` — سجلٌّ يخالفُ أزمنةَ النتيجةِ توثيقٌ كاذبٌ", () => {
    const verdict = judgeDrillTimings({
      ...healthy,
      detail: {
        timings: {
          sourceFingerprintMs: 41.2,
          restoreMs: 999999, // لا يطابقُ النتيجةَ
          restoredFingerprintMs: 39.9,
        },
      },
    });
    expect(verdict.violations).toContain("timing.detail-persisted");
  });

  it("ح-7: سجلٌّ بلا أزمنةٍ البتّةَ يُدينُ قاعدةَ السجلِّ", () => {
    const verdict = judgeDrillTimings({ ...healthy, detail: {} });
    expect(verdict.violations).toContain("timing.detail-persisted");
  });

  it("ح-7: من لم يُقدِّمْ سجلاً لا يُدانْ عليهِ (السجلُّ شرطيٌّ في الحَكَمِ وحدهُ)", () => {
    const { detail: _detail, ...withoutDetail } = healthy;
    const verdict = judgeDrillTimings(withoutDetail);
    expect(verdict.verdict).toBe("ok");
  });
});
