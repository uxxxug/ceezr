/**
 * ADR 0243 — مدى التنبؤِ الصادق (فجوةُ UI-8 [C] الثانية) ولحظةُ القراءة (الأولى):
 * النطاقُ النقيّ، وقارئُ غلافِ القاعدة، وسطرا العرضِ في التطبيقِ المصغَّر.
 */
import { describe, expect, it } from "bun:test";
import {
  etaBandLine,
  observedLine,
} from "../../apps/miniapp/src/surfaces/rider/active/active-ride-view.ts";
import {
  ETA_BAND_COVERAGE_PERCENT,
  ETA_BAND_MIN_SAMPLES,
  etaBandFrom,
} from "../../packages/domain/eta/band.ts";
import { readEtaBandEnvelope } from "../../packages/infrastructure/tracking/eta-band-store.ts";

describe("النطاق — etaBandFrom", () => {
  it("الحدُّ 30 ساقاً والتغطيةُ 80٪ معلَنانِ ثابتَين", () => {
    expect(ETA_BAND_MIN_SAMPLES).toBe(30);
    expect(ETA_BAND_COVERAGE_PERCENT).toBe(80);
  });

  it("المدى = التقدير × [م10، م90]، الأدنى نزولاً والأعلى صعوداً", () => {
    expect(etaBandFrom(600, { samples: 30, lowRatio: 0.85, highRatio: 1.45 })).toEqual({
      kind: "MEASURED",
      lowMinutes: 8,
      highMinutes: 15,
      samples: 30,
      coveragePercent: 80,
    });
  });

  it("دونَ الحدِّ: العددُ المرصودُ والمطلوب — ولو كانت النسبُ موجودة", () => {
    expect(etaBandFrom(600, { samples: 29, lowRatio: 0.9, highRatio: 1.1 })).toEqual({
      kind: "INSUFFICIENT",
      samples: 29,
      required: 30,
    });
    expect(etaBandFrom(600, { samples: 0, lowRatio: null, highRatio: null }).kind).toBe(
      "INSUFFICIENT",
    );
  });

  it("الأدنى دقيقةٌ على الأقلّ، والأعلى لا يقلُّ عن الأدنى", () => {
    expect(etaBandFrom(30, { samples: 40, lowRatio: 0.5, highRatio: 0.6 })).toMatchObject({
      lowMinutes: 1,
      highMinutes: 1,
    });
  });

  it("إحصاءٌ مخالفٌ ⇒ غائبٌ بسببِه لا مدىً مُرقَّع", () => {
    for (const stats of [
      { samples: 40, lowRatio: null, highRatio: 1.2 },
      { samples: 40, lowRatio: 1.3, highRatio: 1.2 },
      { samples: 40, lowRatio: 0, highRatio: 1.2 },
      { samples: 40, lowRatio: Number.NaN, highRatio: 1.2 },
      { samples: 2.5, lowRatio: 1, highRatio: 1.2 },
    ]) {
      expect(etaBandFrom(600, stats)).toEqual({ kind: "UNAVAILABLE", reason: "INVALID_STATS" });
    }
    expect(etaBandFrom(0, { samples: 40, lowRatio: 1, highRatio: 1 }).kind).toBe("UNAVAILABLE");
  });
});

describe("المُنفِّذ — readEtaBandEnvelope", () => {
  it("يقرأُ الغلافَ الناجحَ — والمئينانِ نصّاً أو رقماً أو عدماً", () => {
    expect(
      readEtaBandEnvelope({ ok: true, samples: 31, low_ratio: 0.9, high_ratio: "1.4" }),
    ).toEqual({ samples: 31, lowRatio: 0.9, highRatio: 1.4 });
    expect(
      readEtaBandEnvelope({ ok: true, samples: 0, low_ratio: null, high_ratio: null }),
    ).toEqual({
      samples: 0,
      lowRatio: null,
      highRatio: null,
    });
  });

  it("رفضُ القاعدةِ أو شكلٌ مخالفٌ ⇒ `null` (عطلٌ) لا صفرُ عيّناتٍ مختلَق", () => {
    expect(readEtaBandEnvelope({ ok: false, error: "ORDER_NOT_FOUND" })).toBeNull();
    expect(readEtaBandEnvelope({ ok: true, samples: -1 })).toBeNull();
    expect(readEtaBandEnvelope({ ok: true })).toBeNull();
    expect(readEtaBandEnvelope(null)).toBeNull();
    expect(readEtaBandEnvelope([1])).toBeNull();
  });
});

describe("العرض — etaBandLine و observedLine", () => {
  it("مرصودٌ بأرقامِه، و«لا مدى بعد» بعددِه، وغيرُ ذلك غائب", () => {
    expect(
      etaBandLine({
        kind: "MEASURED",
        lowMinutes: 6,
        highMinutes: 12,
        samples: 42,
        coveragePercent: 80,
      }),
    ).toEqual({
      kind: "MEASURED",
      key: "rider.active.eta.band.measured",
      lowMinutes: 6,
      highMinutes: 12,
      samples: 42,
      coveragePercent: 80,
    });
    expect(etaBandLine({ kind: "INSUFFICIENT", samples: 4, required: 30 })).toEqual({
      kind: "INSUFFICIENT",
      key: "rider.active.eta.band.insufficient",
      samples: 4,
      required: 30,
    });
    for (const band of [
      undefined,
      null,
      { kind: "UNAVAILABLE", reason: "STORE_DOWN" },
      { kind: "MEASURED", lowMinutes: 9, highMinutes: 3, samples: 40, coveragePercent: 80 },
      { kind: "MEASURED", lowMinutes: 1.5, highMinutes: 3, samples: 40, coveragePercent: 80 },
      { kind: "GUESS" },
    ]) {
      expect(etaBandLine(band)).toEqual({
        kind: "UNAVAILABLE",
        key: "rider.active.eta.band.unavailable",
      });
    }
  });

  it("لحظةُ الخادمِ تُنسَّقُ ساعةً بأرقامٍ غربيّة — والغائبُ «غير معروف» لا ساعةَ الجهاز", () => {
    const line = observedLine("2027-03-01T09:05:07.000Z", "ar", "Asia/Riyadh");
    expect(line.kind).toBe("KNOWN");
    if (line.kind !== "KNOWN") return;
    expect(line.key).toBe("rider.active.observed.at");
    expect(line.iso).toBe("2027-03-01T09:05:07.000Z");
    expect(line.time).toContain("12:05:07");
    for (const value of [undefined, null, "", "not-a-date", 1_700_000_000_000]) {
      expect(observedLine(value, "ar", "Asia/Riyadh")).toEqual({
        kind: "UNKNOWN",
        key: "rider.active.observed.unknown",
      });
    }
  });
});
