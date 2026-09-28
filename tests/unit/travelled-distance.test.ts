/**
 * قياسُ مسافةِ الأثرِ المسجَّلِ من النقاطِ المقبولةِ داخلَ نافذةِ الرحلةِ —
 * دالّةٌ صرفةٌ، والحالاتُ هنا هيَ جدولُ `ADR 0208` «الاختباراتُ أوّلاً»
 * بحرفِهِ، وسالباتٌ مبذورةٌ (`ح-7`).
 */

import { describe, expect, it } from "bun:test";
import {
  type TravelledTracePoint,
  travelledDistanceFromTrace,
} from "../../packages/domain/geo/travelled-distance.ts";

const START = 1_700_000_000_000;
const G = 120; // driver_location_hot_ttl_seconds كما يُبذَرُ اليومَ.
const NOW = START + 60 * 60 * 1000; // رحلةُ الساعةِ — داخلَ النافذةِ الساخنةِ.
const DAYS = 14; // DEC_15.locationHotDays.

const base = { quality: "ACCEPT", accuracyMeters: 10 } as const;

function point(
  recordedAtMs: number,
  overrides: Partial<TravelledTracePoint> = {},
): TravelledTracePoint {
  return { recordedAtMs, latitude: 21.4, longitude: 39.8, ...base, ...overrides };
}

function measure(
  points: readonly TravelledTracePoint[],
  overrides: Partial<Parameters<typeof travelledDistanceFromTrace>[0]> = {},
) {
  return travelledDistanceFromTrace({
    points,
    startedAtMs: START,
    completedAtMs: START + 60_000,
    gapLimitSeconds: G,
    nowMs: NOW,
    hotWindowDays: DAYS,
    ...overrides,
  });
}

describe("مسافةُ الأثرِ المسجَّلِ — جدولُ ADR 0208", () => {
  it("نقطتانِ صالحتانِ متباعدتانِ فوقَ الدقّةِ ⇒ measured بمسافةٍ موجبةٍ = Haversine بينَهما", () => {
    const verdict = measure([
      point(START, { latitude: 21.4, longitude: 39.8 }),
      point(START + 60_000, { latitude: 21.401, longitude: 39.8 }),
    ]);
    expect(verdict.kind).toBe("measured");
    if (verdict.kind !== "measured") return;
    // ~111 متراً لفرقِ 0.001 درجةِ عرضٍ — موجبةٌ لا صفرٌ ولا وترُ البدايةِ والنهايةِ المُجمَّدُ.
    expect(verdict.meters).toBeGreaterThan(100);
    expect(verdict.meters).toBeLessThan(120);
    expect(verdict.usablePoints).toBe(2);
    expect(verdict.excluded).toEqual({ alert: 0, coarse: 0, noAccuracy: 0 });
  });

  it("نقطةٌ صالحةٌ واحدةٌ ⇒ unmeasured · insufficient_points — لا صفر", () => {
    const verdict = measure([point(START)]);
    expect(verdict).toEqual({ kind: "unmeasured", reason: "insufficient_points" });
  });

  it("نقاطٌ متطابقةٌ صالحةٌ متّصلةٌ بلا فجوةٍ ⇒ measured · 0", () => {
    const verdict = measure([point(START), point(START + 10_000), point(START + 20_000)]);
    expect(verdict.kind).toBe("measured");
    if (verdict.kind !== "measured") return;
    expect(verdict.meters).toBe(0);
    expect(verdict.usablePoints).toBe(1); // المرساةُ وحدَها: الباقي ارتعاشٌ داخلَ الدقّةِ.
  });

  it("فرقٌ زمنيٌّ > G بينَ نقطتينِ ⇒ unmeasured · gap_exceeded — لا وصلَ ولا مجموعٌ جزئيٌّ", () => {
    const verdict = measure(
      [point(START, { latitude: 21.4 }), point(START + (G + 1) * 1000, { latitude: 21.401 })],
      { completedAtMs: START + (G + 1) * 1000 },
    );
    expect(verdict).toEqual({
      kind: "unmeasured",
      reason: "gap_exceeded",
      largestGapSeconds: G + 1,
    });
  });

  it("الفرقُ = G بالضبطِ لا فجوةَ — الحدُّ يمنعُ ما فوقَه لا عندَه", () => {
    const verdict = measure(
      [point(START, { latitude: 21.4 }), point(START + G * 1000, { latitude: 21.401 })],
      { completedAtMs: START + G * 1000 },
    );
    expect(verdict.kind).toBe("measured");
  });

  it("نقطةٌ ALERT بينَ نقطتينِ صالحتينِ ⇒ لا تدخلُ المجموعَ ويُعَدُّ استبعادُها", () => {
    const verdict = measure([
      point(START, { latitude: 21.4 }),
      point(START + 10_000, { latitude: 21.401, quality: "ALERT" }),
      point(START + 20_000, { latitude: 21.402 }),
    ]);
    expect(verdict.kind).toBe("measured");
    if (verdict.kind !== "measured") return;
    expect(verdict.excluded.alert).toBe(1);
    // المسافةُ مجموعُ الوترَينِ حولَ المُنبَتَّةِ لا وترًا واحدًا عبرَها.
    expect(verdict.meters).toBeGreaterThan(200);
  });

  it("نقطةٌ قبلَ started_at أو بعدَ completed_at ⇒ لا تدخلُ", () => {
    const before = measure([
      point(START - 60_000, { latitude: 21.401 }),
      point(START, { latitude: 21.4 }),
    ]);
    expect(before).toEqual({ kind: "unmeasured", reason: "insufficient_points" });

    const after = measure([
      point(START, { latitude: 21.4 }),
      point(START + 31 * 60_000, { latitude: 21.401 }),
    ]);
    expect(after).toEqual({ kind: "unmeasured", reason: "insufficient_points" });
  });

  it("رحلةٌ بلا أثرٍ ⇒ unmeasured · no_history", () => {
    expect(measure([])).toEqual({ kind: "unmeasured", reason: "no_history" });
  });

  it("ارتعاشٌ داخلَ الدقّةِ حولَ نقطةٍ ثابتةٍ ⇒ measured · 0 لا أمتاراً متراكمةً", () => {
    const jittered = Array.from({ length: 30 }, (_, index) =>
      point(START + index * 5_000, {
        latitude: 21.4 + Math.sin(index) * 0.00001, // ~1 مترٌ حولَ النقطةِ.
      }),
    );
    const verdict = measure(jittered, { completedAtMs: START + 145_000 });
    expect(verdict.kind).toBe("measured");
    if (verdict.kind !== "measured") return;
    expect(verdict.meters).toBe(0);
  });

  it("حافّةٌ > G في البدءِ أو الإتمامِ ⇒ leading_gap / trailing_gap", () => {
    const leading = measure(
      [
        point(START + (G + 1) * 1000, { latitude: 21.4 }),
        point(START + (G + 2) * 1000, { latitude: 21.401 }),
      ],
      { completedAtMs: START + (G + 2) * 1000 },
    );
    expect(leading).toEqual({ kind: "unmeasured", reason: "leading_gap" });

    const trailing = measure(
      [point(START, { latitude: 21.4 }), point(START + 10_000, { latitude: 21.401 })],
      // نافذةُ الرحلةِ ٣٠ دقيقةً وآخرُ نقطةٍ في الثانيةِ العاشرةِ ⇒ حافّةُ إتمامٍ.
      { completedAtMs: START + 30 * 60 * 1000 },
    );
    expect(trailing).toEqual({ kind: "unmeasured", reason: "trailing_gap" });
  });

  it("على قاعدةٍ حقيقيّةٍ (محاكاةُ التكوينِ): سائقٌ آخرُ ورحلةٌ أخرى للسائقِ نفسِه في النافذةِ المجاورةِ ⇒ لا تدخلُ — النافذةُ تُخرِجُها", () => {
    // نقاطُ سائقٍ آخرَ ورحلةٍ سابقةٍ للسائقِ نفسِه تمرُّ من القارئِ الضيّقِ،
    // والدالّةُ الصرفةُ تُخرِجُ ما خارجَ نافذةِ **هذه** الرحلةِ.
    const foreign = measure([
      point(START - 24 * 60 * 60 * 1000, { latitude: 21.4 }), // رحلةُ أمسِ.
      point(START - 24 * 60 * 60 * 1000 + 10_000, { latitude: 21.401 }),
    ]);
    expect(foreign).toEqual({ kind: "unmeasured", reason: "no_history" });
  });
});

describe("مسافةُ الأثرِ المسجَّلِ — أحكامٌ مُكمِّلةٌ (`ADR 0208` §٣–§٦)", () => {
  it("دقّةٌ أخشنُ من عتبةِ ACCURACY_COARSE نفسِها (100م) ⇒ استبعادٌ coarse", () => {
    const verdict = measure([
      point(START, { latitude: 21.4 }),
      point(START + 10_000, { latitude: 21.401, accuracyMeters: 101 }),
    ]);
    expect(verdict).toEqual({ kind: "unmeasured", reason: "insufficient_points" });
  });

  it("دقّةٌ غائبةٌ ⇒ استبعادٌ noAccuracy — لا مسافةَ على نصفِ قطرٍ مجهولٍ", () => {
    const verdict = measure([
      point(START, { latitude: 21.4 }),
      point(START + 10_000, { latitude: 21.401, accuracyMeters: null }),
    ]);
    expect(verdict).toEqual({ kind: "unmeasured", reason: "insufficient_points" });
  });

  it("رحلةٌ أقدمَ من النافذةِ الساخنةِ بلا أثرٍ ⇒ history_expired لا no_history", () => {
    const verdict = measure([], { nowMs: START + (DAYS + 1) * 24 * 60 * 60 * 1000 });
    expect(verdict).toEqual({ kind: "unmeasured", reason: "history_expired" });
  });

  it("رحلةٌ أقدمُ من النافذةِ الساخنةِ **معَ أثرٍ باقٍ** ⇒ تُقاس — الانقضاءُ غيابٌ لا محوٌ", () => {
    const verdict = measure([point(START), point(START + 10_000, { latitude: 21.401 })], {
      nowMs: START + (DAYS + 1) * 24 * 60 * 60 * 1000,
    });
    expect(verdict.kind).toBe("measured");
  });

  it("غيابُ سقفِ الفجوةِ من الإعدادِ ⇒ عطلٌ مُسمّىً لا افتراضٌ (§٥)", () => {
    const verdict = measure([point(START), point(START + 10_000)], {
      gapLimitSeconds: null,
    });
    expect(verdict).toEqual({ kind: "unmeasured", reason: "gap_limit_setting_missing" });
  });

  it("قاعدةُ المرساةِ: النقطةُ داخلَ دائرةِ عدمِ اليقينِ لا تُحرِّكُ المرساةَ — فمسافةٌ لاحقةٌ من المرساةِ الأصلِ", () => {
    // نقطةٌ بعيدةٌ 50م (داخلَ دقّةِ 100م) ثمَّ نقطةٌ بعيدةٌ 150م عن الأولى:
    // الثانيةُ تُقاسُ من المرساةِ الأصلِ (150م) لا من الوسيطةِ (100م).
    const verdict = measure([
      point(START, { latitude: 21.4, accuracyMeters: 100 }),
      point(START + 10_000, { latitude: 21.40045, accuracyMeters: 100 }), // ~50م
      point(START + 20_000, { latitude: 21.40135, accuracyMeters: 100 }), // ~150م عن الأولى
    ]);
    expect(verdict.kind).toBe("measured");
    if (verdict.kind !== "measured") return;
    expect(verdict.meters).toBeGreaterThan(145);
    expect(verdict.meters).toBeLessThan(155);
  });

  it("WARNING مقبولةٌ كما ACCEPT — الحكمَ المخزَّنُ هوَ الفيصلُ لا إعادةُ تقييمٍ", () => {
    const verdict = measure([
      point(START, { latitude: 21.4, quality: "WARNING" }),
      point(START + 10_000, { latitude: 21.401, quality: "WARNING" }),
    ]);
    expect(verdict.kind).toBe("measured");
  });
});
