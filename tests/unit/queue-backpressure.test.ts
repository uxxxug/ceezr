/**
 * الغرض: حكمُ الضغطِ العكسيِّ — `evaluateQueueBackpressure` و`decideAdmission`
 *    و`runBatchLimit`. الشطرُ الحاسمُ ههنا أنَّ **الحدَّ المفقودَ خرقٌ لا إذنٌ**،
 *    وأنَّ الحرجَ لا يُؤجَّلُ ولو أُشبِعَ الطابورُ، وأنَّ سقفَ الشوطِ يُقرأُ من
 *    تزامنِ المستهلِكِ لا من سقفِ محاولاتِ الصفِّ (F6-06 / ADR-0066).
 * الحالة: مُختبَر.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, test } from "bun:test";
import {
  BACKPRESSURE_DIMENSIONS,
  decideAdmission,
  evaluateQueueBackpressure,
  type QueueLimits,
  type QueueLoad,
  runBatchLimit,
  SATURATION_REASONS,
} from "../../packages/application/scheduling/queue-backpressure.ts";

/** حِمْلٌ ساكنٌ تحتَ كلِّ حدٍّ — نقطةُ الانطلاقِ التي يُغيَّرُ منها بُعدٌ واحدٌ. */
const calmLoad: QueueLoad = {
  depth: 10,
  oldestDueAgeSeconds: 5,
  deadInWindow: 0,
  claimed: 2,
};

const limits: QueueLimits = {
  depthLimit: 100,
  oldestAgeLimitSeconds: 60,
  retryLimit: 5,
  deadLimit: 10,
  deadWindowSeconds: 3600,
  producerLimit: 50,
  consumerConcurrency: 8,
};

describe("حكمُ الضغطِ العكسيِّ لكلِّ طابورٍ", () => {
  test("الأبعادُ الستّةُ مُعلَنةٌ بأسمائِها، والأسبابُ ثلاثةٌ لا أكثر", () => {
    // البنودُ الستّةُ في نصِّ F6-06 حرفاً: سعةٌ، عمرُ أقدمِ حدثٍ، حدُّ إعادةِ
    // المحاولةِ، حدُّ DLQ، حدُّ المنتِجِ، تزامنُ المستهلِكِ.
    expect([...BACKPRESSURE_DIMENSIONS]).toEqual([
      "capacity",
      "oldest_age",
      "retry",
      "dead_letter",
      "producer",
      "consumer_concurrency",
    ]);
    // والإشباعُ وصفٌ لحالةِ الطابورِ، فلا يدخلُه ما يُنفَّذُ على صفٍّ أو حاجزٍ.
    expect([...SATURATION_REASONS]).toEqual(["DEPTH", "OLDEST_AGE", "DEAD_LETTER"]);
  });

  test("حِمْلٌ تحتَ كلِّ حدٍّ: لا إشباعَ ولا امتلاءَ للمستهلِكِ", () => {
    const verdict = evaluateQueueBackpressure(calmLoad, limits);
    expect(verdict.saturated).toBe(false);
    expect(verdict.reasons).toEqual([]);
    expect(verdict.consumerAtCapacity).toBe(false);
  });

  test("بلوغُ الحدِّ خرقٌ — لا تجاوزُه وحدَه", () => {
    // `>=` لا `>`: الحدُّ سقفٌ يُبلَغُ فيُمنَعُ، لا عتبةٌ تُتجاوَزُ ثمَّ يُمنَعُ.
    expect(evaluateQueueBackpressure({ ...calmLoad, depth: 100 }, limits).reasons).toEqual([
      "DEPTH",
    ]);
    expect(evaluateQueueBackpressure({ ...calmLoad, depth: 99 }, limits).saturated).toBe(false);
  });

  test("كلُّ سببٍ يُشبِعُ وحدَه، والثلاثةُ تجتمعُ بترتيبٍ حتميٍّ", () => {
    expect(
      evaluateQueueBackpressure({ ...calmLoad, oldestDueAgeSeconds: 60 }, limits).reasons,
    ).toEqual(["OLDEST_AGE"]);
    expect(evaluateQueueBackpressure({ ...calmLoad, deadInWindow: 10 }, limits).reasons).toEqual([
      "DEAD_LETTER",
    ]);
    const all = evaluateQueueBackpressure(
      { depth: 500, oldestDueAgeSeconds: 900, deadInWindow: 99, claimed: 0 },
      limits,
    );
    expect(all.saturated).toBe(true);
    expect(all.reasons).toEqual(["DEPTH", "OLDEST_AGE", "DEAD_LETTER"]);
  });

  test("امتلاءُ المستهلِكِ يُقرأُ منفصلاً: يمنعُ التقاطاً ولا يُشبِعُ طابوراً", () => {
    const verdict = evaluateQueueBackpressure({ ...calmLoad, claimed: 8 }, limits);
    expect(verdict.consumerAtCapacity).toBe(true);
    expect(verdict.saturated).toBe(false);
    expect(verdict.reasons).toEqual([]);
  });

  test("حدٌّ مفقودٌ أو غيرُ موجَبٍ **خرقٌ** لا سعةٌ لا نهائيّةٌ", () => {
    // صمتُ الإعدادِ لا يُقرأُ إذناً: مفتاحٌ ناقصٌ أو صفرٌ أو سالبٌ أو غيرُ
    // منتهٍ — كلُّها تُشبِعُ الطابورَ صراحةً كي يُصلَحَ الإعدادُ لا كي يُتجاوَزَ.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const verdict = evaluateQueueBackpressure(calmLoad, { ...limits, depthLimit: bad });
      expect(verdict.saturated).toBe(true);
      expect(verdict.reasons).toEqual(["DEPTH"]);
    }
    expect(
      evaluateQueueBackpressure(calmLoad, { ...limits, consumerConcurrency: 0 }).consumerAtCapacity,
    ).toBe(true);
  });

  test("طابورٌ فارغٌ وحدودٌ سويّةٌ: لا خرقَ", () => {
    const verdict = evaluateQueueBackpressure(
      { depth: 0, oldestDueAgeSeconds: 0, deadInWindow: 0, claimed: 0 },
      limits,
    );
    expect(verdict.saturated).toBe(false);
    expect(verdict.consumerAtCapacity).toBe(false);
  });
});

describe("قرارُ القبولِ عندَ بابِ الإيداعِ", () => {
  const saturated: QueueLoad = { ...calmLoad, depth: 1000 };

  test("الحرجُ يُقبَلُ ولو أُشبِعَ الطابورُ من كلِّ وجهٍ", () => {
    // تأجيلُ بلاغِ استغاثةٍ لأنَّ حملةَ بثٍّ ملأتِ الطابورَ قتلٌ بالحسابِ.
    expect(
      decideAdmission({
        deferrable: false,
        producerPending: 10_000,
        load: { depth: 99_999, oldestDueAgeSeconds: 99_999, deadInWindow: 999, claimed: 999 },
        limits,
      }),
    ).toBe("admit");
  });

  test("القابلُ للتأجيلِ يُؤجَّلُ عندَ الإشباعِ ويُقبَلُ في السَّعَةِ", () => {
    expect(decideAdmission({ deferrable: true, producerPending: 0, load: saturated, limits })).toBe(
      "defer",
    );
    expect(decideAdmission({ deferrable: true, producerPending: 0, load: calmLoad, limits })).toBe(
      "admit",
    );
  });

  test("حدُّ المنتِجِ يُؤجِّلُ وحدَه ولو كانَ الطابورُ كلُّه في سَعَةٍ", () => {
    // بُعدٌ مستقلٌّ: منتِجٌ واحدٌ لا يبتلعُ الطابورَ ولو لم يُشبِعْه بعدُ.
    expect(decideAdmission({ deferrable: true, producerPending: 50, load: calmLoad, limits })).toBe(
      "defer",
    );
    expect(decideAdmission({ deferrable: true, producerPending: 49, load: calmLoad, limits })).toBe(
      "admit",
    );
  });

  test("حدُّ منتِجٍ مفقودٌ يُؤجِّلُ القابلَ للتأجيلِ — ولا يمسُّ الحرجَ", () => {
    const broken = { ...limits, producerLimit: 0 };
    expect(
      decideAdmission({ deferrable: true, producerPending: 0, load: calmLoad, limits: broken }),
    ).toBe("defer");
    expect(
      decideAdmission({ deferrable: false, producerPending: 0, load: calmLoad, limits: broken }),
    ).toBe("admit");
  });
});

describe("سقفُ الشوطِ يُقرأُ من تزامنِ المستهلِكِ", () => {
  test("السقفُ هوَ التزامنُ نفسُه لا سقفُ محاولاتِ الصفِّ", () => {
    // تصحيحُ عطبٍ قائمٍ: `deliverNotificationBatch` كانت تضبطُ شوطَها من
    // `notification_delivery_max_attempts` — وهوَ سقفُ محاولاتِ **الصفِّ**.
    expect(runBatchLimit({ consumerConcurrency: 8 })).toBe(8);
    expect(runBatchLimit({ consumerConcurrency: 1 })).toBe(1);
  });

  test("تزامنٌ غيرُ سويٍّ يهبطُ إلى صفٍّ واحدٍ لا إلى صفرٍ ولا إلى لا نهايةٍ", () => {
    // صفرٌ يُوقِفُ التسليمَ كلَّه صمتاً، ولا نهايةَ تُلغي الحدَّ — فالواحدُ
    // أضعفُ تقدُّمٍ يُبقي النظامَ حيّاً حتّى يُصحَّحَ الإعدادُ.
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(runBatchLimit({ consumerConcurrency: bad })).toBe(1);
    }
    expect(runBatchLimit({ consumerConcurrency: 7.9 })).toBe(7);
  });
});
