/** LOAD-01 §5.8 — قواعدُ الحكمِ المسجَّلةُ مسبقًا كما تُطبَّقُ حرفيّاً، لا قاعدةَ تُخترَعُ. */
import { describe, expect, test } from "bun:test";
import {
  computeVerdict,
  type ReadWave,
  readWave,
  type WaveIn,
} from "../../deploy/capacity-run/monitor/single-trip-verdict";

/** موجةٌ بمقاديرَ قابلةٍ للتخصيصِ — الأرقامُ الافتراضيّةُ «نظيفةٌ». */
const w = (
  p: Partial<WaveIn> & Pick<WaveIn, "slot" | "arm">,
  over: Partial<ReadWave> = {},
): ReadWave => ({
  slot: p.slot,
  arm: p.arm,
  valid: p.valid ?? true,
  dir: "",
  p7Sec: 100,
  g1Pct: 54,
  failedGates: [],
  deadRiderNotice: 0,
  deliveredRiderNotice: 20000,
  kindSumsOk: true,
  violations: 0,
  mismatches: 0,
  engagedDuplicates: 0,
  duplicateReceipts: 0,
  sendMessage: 15000,
  claimed: 24000,
  withoutRequestId: 0,
  inventory: {
    arm: p.arm,
    claims: 24000,
    correlation: p.arm === "ST" ? 0 : 24000,
    queriesPerClaim: p.arm === "ST" ? 0 : 1,
  },
  ...over,
});

/** ثلاثةُ أزواجٍ متكاملةٍ: ST أسرعُ بـ30 ثانيةً من CUR في كلِّ زوجٍ. */
const threePairs = (stP7: number, curP7: number, patch: Record<string, Partial<ReadWave>> = {}) =>
  [1, 2, 3].flatMap((i) => [
    w({ slot: `ST${i}`, arm: "ST" }, { p7Sec: stP7, ...patch[`ST${i}`] }),
    w({ slot: `CUR${i}`, arm: "CUR" }, { p7Sec: curP7, ...patch[`CUR${i}`] }),
  ]);

describe("readWave", () => {
  test("يقرأُ P7 وG1 وأزواجَ بوّاباتِ الموجةِ من ملفّاتِها", () => {
    const r = readWave({ slot: "ST1", arm: "ST", valid: true, dir: "tests/unit/__st_fixture" });
    expect(r.p7Sec).toBeNull(); // الدليلُ غائبٌ ⇒ لا رقمَ لا افتراضَ
  });
});

describe("computeVerdict — §5.8", () => {
  test("ACCEPT: ST أسرعُ بـ≥10 ثوانٍ في كلِّ زوجٍ صالحٍ، وبوّاباتٌ وسلامةٌ خضراءٌ", () => {
    const v = computeVerdict(threePairs(100, 130));
    expect(v.verdict).toBe("ACCEPT");
    expect(v.gates.find((g) => g.rule === "p7_st_mean_le_cur_minus_10s")?.pass).toBe(true);
    expect(v.gates.every((g) => g.pass)).toBe(true);
  });

  test("حدُّ الـ10 ثوانٍ حرفيٌّ: فرقُ 10 بالضبطِ يُقبلُ (≤) و9 ثوانٍ لا تكفي", () => {
    // ≤ CUR − 10: الفرقُ 10 بالضبطِ يُحقّقُ الشرطَ حرفيّاً.
    const exact = computeVerdict(threePairs(120, 130));
    expect(exact.verdict).toBe("ACCEPT");
    // أقلُّ من ذلك (فرقٌ 9) لا يكفي.
    const short = computeVerdict(threePairs(121, 130));
    expect(short.verdict).toBe("REJECT");
    expect(short.reasons).toContain("p7_st_mean_le_cur_minus_10s");
  });

  test("زوجٌ واحدٌ غيرُ صالحٍ يُسقطُ من الحكمِ لا يُبطلُ التجربةَ (≥2 صالحانِ)", () => {
    const waves = threePairs(100, 130, { ST3: { valid: false } });
    const v = computeVerdict(waves);
    expect(v.verdict).toBe("ACCEPT");
    expect(v.pairs.filter((p) => p.valid)).toHaveLength(2);
  });

  test("أقلُّ من زوجينِ صالحينِ = INCONCLUSIVE لا REJECT", () => {
    const waves = threePairs(100, 130, { ST2: { valid: false }, ST3: { valid: false } });
    const v = computeVerdict(waves);
    expect(v.verdict).toBe("INCONCLUSIVE");
    expect(v.reasons).toContain("undecidable_preconditions");
  });

  test("ST أبطأُ من CUR في زوجٍ صالحٍ = REJECT وإن سائرُ الأزواجِ خضراءٌ", () => {
    const v = computeVerdict(threePairs(100, 130, { ST2: { p7Sec: 140 } }));
    expect(v.verdict).toBe("REJECT");
    expect(v.reasons).toContain("p7_st_lt_cur_every_valid_pair");
  });

  test("جردٌ فاسدٌ في ST (استعلامُ ارتباطٍ لم يسقطْ) = INCONCLUSIVE لا ACCEPT", () => {
    const v = computeVerdict(
      threePairs(100, 130, {
        ST1: { inventory: { arm: "ST", claims: 24000, correlation: 24000, queriesPerClaim: 1 } },
      }),
    );
    expect(v.verdict).toBe("INCONCLUSIVE");
    expect(v.reasons).toContain("st_inventory_broken");
  });

  test("بوّاباتٌ: فشلٌ في ST أكثرَ من CUR = REJECT", () => {
    const v = computeVerdict(
      threePairs(100, 130, { ST1: { failedGates: ["G4"] }, ST2: { failedGates: ["G4"] } }),
    );
    expect(v.verdict).toBe("REJECT");
    expect(v.reasons).toContain("gates_no_more_failures_in_st");
  });

  test("G1: هبوطٌ أكثرَ من نقطةٍ واحدةٍ في ST = REJECT", () => {
    const v = computeVerdict(
      threePairs(100, 130, { ST1: { g1Pct: 52.5 }, ST2: { g1Pct: 52.5 }, ST3: { g1Pct: 52.5 } }),
    );
    expect(v.verdict).toBe("REJECT");
    expect(v.reasons).toContain("g1_st_ge_cur_minus_1");
  });

  test("سلامةٌ: تكرارُ تسليمٍ في موجةِ ST واحدةٍ يُسقطُ القبولَ", () => {
    const v = computeVerdict(threePairs(100, 130, { ST2: { duplicateReceipts: 3 } }));
    expect(v.verdict).toBe("REJECT");
    expect(v.reasons).toContain("safety_ST2_no_duplicates");
  });

  test("سلامةٌ: dead(rider_trip_notice) في ST فوقَ أقصى CUR = REJECT", () => {
    const v = computeVerdict(threePairs(100, 130, { ST2: { deadRiderNotice: 5 } }));
    expect(v.verdict).toBe("REJECT");
    expect(v.reasons).toContain("safety_ST2_dead_le_cur_max");
  });

  test("سلامةٌ: مخالفةُ تدقيقٍ واحدةٌ في ST = REJECT", () => {
    const v = computeVerdict(threePairs(100, 130, { ST1: { violations: 1 } }));
    expect(v.verdict).toBe("REJECT");
    expect(v.reasons).toContain("safety_ST1_clean");
  });

  test("سلامةٌ: نسبةُ إرسالٍ في ST فوقَ أقصى CUR + 1 نقطةٍ مئويّةٍ = REJECT", () => {
    // CUR: 15000/20000 = 75%؛ أقصى ST المسموحُ 76% — 15500/20000 = 77.5% ⇒ رفضٌ.
    const v = computeVerdict(threePairs(100, 130, { ST3: { sendMessage: 15500 } }));
    expect(v.verdict).toBe("REJECT");
    expect(v.reasons).toContain("safety_ST3_send_ratio_le_cur_plus_1pp");
  });

  test("سلامةٌ: التقاطاتٌ بلا request_id في ST فوقَ أقصى CUR = REJECT", () => {
    const v = computeVerdict(threePairs(100, 130, { ST2: { withoutRequestId: 120 } }));
    expect(v.verdict).toBe("REJECT");
    expect(v.reasons).toContain("safety_ST2_no_request_id_le_cur");
  });

  test("سلامةٌ: عدمُ تطابقِ مجموعِ النوعِ (delivered+pending+dead≠total) = REJECT", () => {
    const v = computeVerdict(threePairs(100, 130, { ST1: { kindSumsOk: false } }));
    expect(v.verdict).toBe("REJECT");
    expect(v.reasons).toContain("safety_ST1_clean");
  });

  test("الحكمُ وصفيٌّ دائماً: لا يرفعُ LOAD-01 ولا يدمجُ — الملاحظةُ الختاميّةُ", () => {
    const v = computeVerdict(threePairs(100, 130));
    expect(v.note).toContain("لا يرفعُ LOAD-01");
  });
});
