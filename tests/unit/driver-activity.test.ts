/**
 * الغرض: قياسُ حكمِ حصيلةِ السائقِ — **المقامُ هوَ الفاصلُ**، والغيابُ يُقرأُ
 *   عَدَماً لا صفراً، والهويّةُ من الجلسةِ وحدَها (البند `F3-05`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-05`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test`.
 * الحاكم: docs/adr/0120-transparency-is-a-denominator-not-a-slogan.md
 *
 * ## وما لا يقيسُه هذا المِلفُّ عن قصدٍ — (`ح-5`)
 *
 * - **لا يقيسُ صدقَ رقمٍ في قاعدةٍ**: أنَّ المقامَ هوَ عددُ العروضِ فعلاً يُقاسُ
 *   في `tests/integration/driver-activity.test.ts` على PostgreSQL حقيقيٍّ.
 * - **لا يقيسُ شاشةً ولا مُضيفاً**: المُحوِّلاتُ دوالُّ نقيّةٌ تُقاسُ بقيمٍ.
 */

import { describe, expect, test } from "bun:test";
import {
  activityErrorKey,
  isRetryableActivityError,
  toActivityEntry,
  toActivityLog,
  toActivitySummary,
  toDuration,
  toRatio,
} from "../../apps/miniapp/src/surfaces/driver/activity/activity-view.ts";
import type {
  DriverActivityStore,
  DriverActivityStoreError,
} from "../../packages/application/driver/activity-ports.ts";
import {
  ACTIVITY_ENTRIES_DEFAULT_LIMIT,
  ACTIVITY_ENTRIES_MAX_LIMIT,
  type DriverActivityDeps,
  readDriverActivityEntries,
  readDriverActivitySummary,
  readEntriesLimit,
} from "../../packages/application/driver/driver-activity.ts";
import type {
  MiniAppSessionReader,
  VerifiedViewerSession,
  ViewerSessionRejection,
} from "../../packages/application/identity/ports.ts";
import type {
  ActivityRating,
  ActivityRatio,
  DriverActivityLog,
  DriverActivitySummary,
} from "../../packages/domain/driver/activity.ts";
import {
  isActivityPeriod,
  isDistanceBasis,
  isMoneyBasis,
  ratingVerdict,
  ratioPercent,
  ratioVerdict,
  splitAttendance,
} from "../../packages/domain/driver/activity.ts";
import { err, ok, type Result } from "../../packages/shared/result/index.ts";

/* ————————————————————————————— النطاقُ: دوالٌّ نقيّةٌ ————————————————————————————— */

function ratio(numerator: number, denominator: number, rate: number | null): ActivityRatio {
  return { numerator, denominator, rate };
}

describe("حكمُ الكسرِ: المقامُ لا البَسْطُ", () => {
  test("مقامٌ صفرٌ ⇒ غيرُ مقيسٍ — سائقٌ لم يُعرَضْ عليهِ شيءٌ ليسَ «صفرَ قبولٍ»", () => {
    expect(ratioVerdict(ratio(0, 0, null))).toBe("UNMEASURED");
    expect(ratioPercent(ratio(0, 0, null))).toBeNull();
  });

  test("مقامٌ موجبٌ و`rate` صفرٌ ⇒ مقيسٌ — صفرٌ حقيقيٌّ يُعرَضُ ولا يُخفى", () => {
    expect(ratioVerdict(ratio(0, 7, 0))).toBe("MEASURED");
    expect(ratioPercent(ratio(0, 7, 0))).toBe(0);
  });

  test("`rate` معدومٌ معَ مقامٍ موجبٍ ⇒ غيرُ مقيسٍ — لا يُخترَعُ رقمٌ بالقسمةِ", () => {
    expect(ratioVerdict(ratio(3, 7, null))).toBe("UNMEASURED");
    expect(ratioPercent(ratio(3, 7, null))).toBeNull();
  });

  test("النسبةُ تُدوَّرُ لعُشرِ المِئةِ للعرضِ وحدَه", () => {
    expect(ratioPercent(ratio(1, 3, 1 / 3))).toBe(33.3);
    expect(ratioPercent(ratio(2, 3, 2 / 3))).toBe(66.7);
    expect(ratioPercent(ratio(1, 1, 1))).toBe(100);
  });
});

describe("التواجدُ: ساعاتٌ ودقائقُ بلا تدويرٍ إلى أعلى", () => {
  test("١١٠ دقيقةً ⇒ ساعةٌ و٥٠ دقيقةً لا ساعتانِ", () => {
    expect(splitAttendance(6600)).toEqual({ hours: 1, minutes: 50 });
  });

  test("٥٩ دقيقةً و٥٩ ثانيةً ⇒ صفرُ ساعةٍ و٥٩ دقيقةً", () => {
    expect(splitAttendance(3599)).toEqual({ hours: 0, minutes: 59 });
  });

  test("سالبٌ أو غيرُ منتهٍ ⇒ صفرٌ لا رقمٌ ناقصٌ يُفسَّرُ عطباً", () => {
    expect(splitAttendance(-1)).toEqual({ hours: 0, minutes: 0 });
    expect(splitAttendance(Number.NaN)).toEqual({ hours: 0, minutes: 0 });
  });
});

describe("حكمُ التقييمِ: ثلاثُ حالاتٍ مُسمّاةٌ", () => {
  function rating(patch: Partial<ActivityRating>): ActivityRating {
    return { average: 4.5, count: 9, trustMinCount: 5, belowTrust: false, ...patch };
  }

  test("لا تقييمَ بعدُ ⇒ `NONE` لا «صفرُ نجومٍ»", () => {
    expect(ratingVerdict(rating({ average: null, count: 0, belowTrust: null }))).toBe("NONE");
  });

  test("متوسّطٌ دونَ حدِّ الثقةِ ⇒ يُعرَضُ ويُقالُ إنَّه لم يستقرَّ", () => {
    expect(ratingVerdict(rating({ count: 2, belowTrust: true }))).toBe("BELOW_TRUST");
  });

  test("حدٌّ غيرُ مضبوطٍ ⇒ لا يُخترَعُ حكمٌ في العميلِ", () => {
    expect(ratingVerdict(rating({ trustMinCount: null, belowTrust: null }))).toBe("TRUSTED");
  });
});

describe("مجالاتٌ مغلقةٌ: نصٌّ غريبٌ لا يمرُّ", () => {
  test("المُدَدُ ثلاثٌ فحسب", () => {
    expect(isActivityPeriod("day")).toBe(true);
    expect(isActivityPeriod("year")).toBe(false);
    expect(isActivityPeriod(7)).toBe(false);
  });

  test("أساسُ المالِ واحدٌ وأساسُ المسافةِ واحدٌ", () => {
    expect(isMoneyBasis("NOT_INTERMEDIATED")).toBe(true);
    expect(isMoneyBasis("CASH")).toBe(false);
    expect(isDistanceBasis("STRAIGHT_LINE")).toBe(true);
    expect(isDistanceBasis("ROAD")).toBe(false);
  });
});

/* ——————————————————————— حالاتُ الاستخدامِ: هويّةٌ وحدودٌ ——————————————————————— */

const SESSION: VerifiedViewerSession = {
  telegramUserId: "900000501",
  bot: "driver",
  sessionId: "s-1",
  expiresAtSeconds: 4_000_000_000,
};

const WINDOW = {
  period: "day",
  timezone: "Asia/Riyadh",
  from: "2026-09-15T21:00:00.000Z",
  to: "2026-09-16T21:00:00.000Z",
} as const;

const SUMMARY: DriverActivitySummary = {
  serverTime: "2026-09-16T08:00:00.000Z",
  window: WINDOW,
  ridesCompleted: 3,
  attendance: { availableSeconds: 6600, open: true },
  acceptance: ratio(3, 4, 0.75),
  cancellation: ratio(0, 0, null),
  rating: { average: 4.8, count: 6, trustMinCount: 5, belowTrust: false },
  rankingFactors: [
    { key: "PROXIMITY", weight: 0.5 },
    { key: "RATING", weight: 0.3 },
    { key: "PREFERRED_AREA", weight: null },
  ],
  behaviourAffectsRanking: false,
  money: { amount: null, basis: "NOT_INTERMEDIATED" },
};

const LOG: DriverActivityLog = {
  serverTime: SUMMARY.serverTime,
  window: WINDOW,
  limit: ACTIVITY_ENTRIES_DEFAULT_LIMIT,
  entries: [],
};

interface StoreCall {
  readonly telegramUserId: string;
  readonly period: string;
  readonly limit?: number;
}

function deps(patch: {
  readonly session?: Result<VerifiedViewerSession, ViewerSessionRejection>;
  readonly summary?: Result<DriverActivitySummary, DriverActivityStoreError>;
  readonly entries?: Result<DriverActivityLog, DriverActivityStoreError>;
  readonly calls?: StoreCall[];
}): DriverActivityDeps {
  const sessions: MiniAppSessionReader = {
    read: async () => patch.session ?? ok(SESSION),
    readSync: () => patch.session ?? ok(SESSION),
  };
  const store: DriverActivityStore = {
    readSummary: async (input) => {
      patch.calls?.push({ telegramUserId: input.telegramUserId, period: input.period });
      return patch.summary ?? ok(SUMMARY);
    },
    readEntries: async (input) => {
      patch.calls?.push({
        telegramUserId: input.telegramUserId,
        period: input.period,
        limit: input.limit,
      });
      return patch.entries ?? ok(LOG);
    },
  };
  return { sessions, store, now: () => new Date("2026-09-16T08:00:00.000Z") };
}

describe("سقفُ الصفحةِ: يُقصَرُ ولا يُرفَضُ", () => {
  test("غيابٌ أو نصٌّ غيرُ رقمٍ ⇒ الافتراضُ", () => {
    expect(readEntriesLimit(undefined)).toBe(ACTIVITY_ENTRIES_DEFAULT_LIMIT);
    expect(readEntriesLimit("كثيرٌ")).toBe(ACTIVITY_ENTRIES_DEFAULT_LIMIT);
  });

  test("رقمٌ فوقَ السقفِ يُقصَرُ، ودونَ الواحدِ يُرفَعُ", () => {
    expect(readEntriesLimit("5000")).toBe(ACTIVITY_ENTRIES_MAX_LIMIT);
    expect(readEntriesLimit("0")).toBe(1);
    expect(readEntriesLimit("-9")).toBe(1);
  });

  test("رقمٌ سليمٌ يمرُّ كما هوَ", () => {
    expect(readEntriesLimit("7")).toBe(7);
  });
});

describe("الهويّةُ من الجلسةِ وحدَها", () => {
  test("لا رمزَ ⇒ `SESSION_REQUIRED` ولا نداءَ للقاعدةِ", async () => {
    const calls: StoreCall[] = [];
    const result = await readDriverActivitySummary(deps({ calls }), {
      accessToken: undefined,
      period: "day",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SESSION_REQUIRED");
    expect(calls).toEqual([]);
  });

  test("رمزٌ منتهٍ يُميَّزُ عن رمزٍ فاسدٍ", async () => {
    const expired = await readDriverActivitySummary(
      deps({ session: err({ code: "SESSION_REJECTED", reason: "EXPIRED" }) }),
      {
        accessToken: "t",
        period: "day",
      },
    );
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.error.code).toBe("SESSION_EXPIRED");

    const invalid = await readDriverActivitySummary(
      deps({ session: err({ code: "SESSION_REJECTED", reason: "SIGNATURE_MISMATCH" }) }),
      { accessToken: "t", period: "day" },
    );
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe("SESSION_INVALID");
  });

  test("سرٌّ غيرُ مُهيَّأٍ ⇒ غيابُ خدمةٍ لا رمزٌ فاسدٌ", async () => {
    const result = await readDriverActivitySummary(
      deps({ session: err({ code: "SESSION_REJECTED", reason: "NOT_CONFIGURED" }) }),
      { accessToken: "t", period: "day" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SESSION_NOT_AVAILABLE");
  });

  test("المعرِّفُ المُمرَّرُ للقاعدةِ هوَ معرِّفُ الجلسةِ", async () => {
    const calls: StoreCall[] = [];
    const result = await readDriverActivitySummary(deps({ calls }), {
      accessToken: "t",
      period: "week",
    });
    expect(result.ok).toBe(true);
    expect(calls).toEqual([{ telegramUserId: SESSION.telegramUserId, period: "week" }]);
  });
});

describe("المُدّةُ تُفحَصُ في الطبقةِ فتصدُقُ رسالةُ الخطأِ", () => {
  test("مُدّةٌ خارجَ المجالِ ⇒ `PERIOD_INVALID` بلا نداءٍ", async () => {
    const calls: StoreCall[] = [];
    const result = await readDriverActivityEntries(deps({ calls }), {
      accessToken: "t",
      period: "decade",
      limit: "5",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PERIOD_INVALID");
    expect(calls).toEqual([]);
  });
});

describe("رفضُ القاعدةِ يُترجَمُ رمزاً منشوراً", () => {
  test("حسابٌ لا صفَّ له و«ليسَ سائقاً» يُقالانِ رمزاً واحداً", async () => {
    for (const rejection of ["USER_NOT_FOUND", "NOT_A_DRIVER"] as const) {
      const result = await readDriverActivitySummary(deps({ summary: err({ rejection }) }), {
        accessToken: "t",
        period: "day",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("NOT_A_DRIVER");
    }
  });

  test("نافذةٌ لا تُحسَبُ ⇒ رمزُها لا حصيلةٌ فارغةٌ", async () => {
    const result = await readDriverActivitySummary(
      deps({ summary: err({ rejection: "WINDOW_UNRESOLVED" }) }),
      { accessToken: "t", period: "month" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WINDOW_UNRESOLVED");
  });

  test("عطبُ مخزَنٍ أو صفٌّ مُشوَّهٌ ⇒ غيابُ خدمةٍ لا رقمٌ مُخترَعٌ", async () => {
    for (const reason of ["STORE_ERROR", "MALFORMED_RESULT"] as const) {
      const result = await readDriverActivityEntries(deps({ entries: err({ reason }) }), {
        accessToken: "t",
        period: "day",
        limit: "20",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("ACTIVITY_STORE_NOT_AVAILABLE");
    }
  });

  test("السقفُ يُقصَرُ قبلَ أن يبلُغَ القاعدةَ", async () => {
    const calls: StoreCall[] = [];
    await readDriverActivityEntries(deps({ calls }), {
      accessToken: "t",
      period: "day",
      limit: "999",
    });
    expect(calls[0]?.limit).toBe(ACTIVITY_ENTRIES_MAX_LIMIT);
  });
});

/* ————————————————————————— مُحوِّلُ العرضِ: نقيٌّ ويُقاسُ ————————————————————————— */

describe("مُحوِّلُ العرضِ: المقامُ يُنقَلُ ولو لم تُقَسْ نسبةٌ", () => {
  test("مقامٌ صفرٌ ⇒ حكمٌ غيرُ مقيسٍ والمقامُ يبقى منشوراً", () => {
    expect(toRatio({ numerator: 0, denominator: 0, rate: null })).toEqual({
      verdict: "UNMEASURED",
      numerator: 0,
      denominator: 0,
      percent: null,
    });
  });

  test("`rate: 0` معَ مقامٍ موجبٍ ⇒ صفرٌ مقيسٌ يُعرَضُ", () => {
    expect(toRatio({ numerator: 0, denominator: 5, rate: 0 })).toEqual({
      verdict: "MEASURED",
      numerator: 0,
      denominator: 5,
      percent: 0,
    });
  });

  test("مُدّةٌ تُقسَمُ بلا تدويرٍ إلى أعلى", () => {
    expect(toDuration(3599)).toEqual({ hours: 0, minutes: 59 });
    expect(toDuration(-5)).toEqual({ hours: 0, minutes: 0 });
  });

  test("رمزٌ مجهولٌ يُقرأُ نصّاً عامّاً لا مفتاحاً خاماً", () => {
    expect(activityErrorKey("NOT_A_DRIVER")).toBe("driver.activity.error.NOT_A_DRIVER");
    expect(activityErrorKey("مجهولٌ")).toBe("driver.activity.error.UNKNOWN");
  });

  test("إعادةُ المحاولةِ لِما قد يُصلَحُ وحدَه، ولا لرفضٍ أبديٍّ", () => {
    expect(isRetryableActivityError("WINDOW_UNRESOLVED")).toBe(true);
    expect(isRetryableActivityError("ACTIVITY_STORE_NOT_AVAILABLE")).toBe(true);
    expect(isRetryableActivityError("NOT_A_DRIVER")).toBe(false);
    expect(isRetryableActivityError("PERIOD_INVALID")).toBe(false);
  });
});

describe("مُحوِّلُ العرضِ: مفاتيحُ نصٍّ لا أرقامٌ ولا فراغٌ", () => {
  const RESPONSE = {
    ok: true as const,
    server_time: "2026-09-16T08:00:00.000Z",
    window: WINDOW,
    rides: { completed: 3 },
    attendance: { available_seconds: 6600, open: true },
    acceptance: { numerator: 3, denominator: 4, rate: 0.75 },
    cancellation: { numerator: 0, denominator: 0, rate: null },
    rating: { average: 4.8, count: 6, trust_min_count: 5, below_trust: false },
    ranking: {
      factors: [
        { key: "PROXIMITY" as const, weight: 0.5 },
        { key: "PREFERRED_AREA" as const, weight: null },
      ],
      behaviour_affects_ranking: false,
    },
    money: { amount: null, basis: "NOT_INTERMEDIATED" as const },
  };

  test("غيابُ المبلغِ يُقرأُ مفتاحَ سببٍ", () => {
    const model = toActivitySummary(RESPONSE);
    expect(model.moneyBasisKey).toBe("driver.activity.money.basis.NOT_INTERMEDIATED");
  });

  test("حُكمُ السلوكِ يُنقَلُ من الخادمِ ولا يُكتَبُ نصّاً", () => {
    expect(toActivitySummary(RESPONSE).behaviourAffectsRanking).toBe(false);
  });

  test("وزنٌ غيرُ مضبوطٍ يبقى معدوماً ولا يصيرُ صفراً", () => {
    const factors = toActivitySummary(RESPONSE).rankingFactors;
    expect(factors[1]).toEqual({
      key: "PREFERRED_AREA",
      labelKey: "driver.activity.ranking.factor.PREFERRED_AREA",
      weight: null,
    });
  });

  test("صفٌّ بلا ختمِ بدءٍ ⇒ مُدّةٌ معدومةٌ لا صفرُ ثوانٍ", () => {
    const model = toActivityEntry({
      order_id: "o-1",
      service: "transport",
      matched_at: null,
      started_at: null,
      completed_at: "2026-09-16T07:00:00.000Z",
      duration_seconds: null,
      distance: null,
    });
    expect(model.duration).toBeNull();
    expect(model.distanceKm).toBeNull();
    expect(model.distanceBasisKey).toBeNull();
    expect(model.serviceKey).toBe("driver.activity.service.transport");
  });

  test("مسافةٌ تُوسَمُ بأساسِها فلا تُوهَمُ طريقاً مقطوعاً", () => {
    const model = toActivityEntry({
      order_id: "o-2",
      service: "delivery",
      matched_at: "2026-09-16T06:00:00.000Z",
      started_at: "2026-09-16T06:05:00.000Z",
      completed_at: "2026-09-16T06:30:00.000Z",
      duration_seconds: 1500,
      distance: { km: 4.2, basis: "STRAIGHT_LINE" },
    });
    expect(model.distanceBasisKey).toBe("driver.activity.distance.basis.STRAIGHT_LINE");
    expect(model.duration).toEqual({ hours: 0, minutes: 25 });
  });

  test("سقفُ الجدولِ يُنقَلُ كما قالَه الخادمُ", () => {
    const log = toActivityLog({
      ok: true,
      server_time: RESPONSE.server_time,
      window: WINDOW,
      limit: 7,
      entries: [],
    });
    expect(log).toEqual({ limit: 7, entries: [] });
  });
});
