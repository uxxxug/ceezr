/**
 * الغرض: سالباتٌ مبذورةٌ لكلِّ قاعدةٍ من قواعدِ حَكَمِ تبديلِ النسخةِ (`ح-7` ·
 *   `F11-08` · ADR 0203): كلُّ قاعدةٍ لها كسرٌ مزروعٌ يُثبِتُ أنَّها تُمسِكُهُ،
 *   وموجبةٌ تُثبِتُ أنَّها لا تعضُّ البريءَ.
 * الحالة: مُنفَّذ · مُختبَر.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import { judgeDeploySwap, swapDowntimeMs } from "../../scripts/lib/deploy-swap.ts";

const healthy = {
  signal: { name: "SIGTERM", exitCode: 0 },
  announce: { readyStatus: 503, statusBody: "draining", stillAccepting: true },
  durableUpdate: {
    statusObservedBeforeSignal: "pending",
    statusAtExit: "pending",
    statusAfterReplacement: "done",
    jobRows: 1,
  },
  acceptedUpdates: { count: 3, doneAfterSwap: 3, exactlyOnce: 3 },
  session: { existedBeforeSignal: true, existsAfterReplacement: true, resetToInitialState: false },
  ride: { orderRows: 1, finalStatus: "completed", driverAvailableAgain: true },
  replacement: { readyStatus: 200, startedAfterOldExit: true },
};

describe("حَكَمُ تبديلِ النسخةِ (F11-08 · ADR 0203)", () => {
  it("الموجبةُ الكاملةُ: نشرٌ رشيقٌ وإعلانٌ مرئيٌّ وتحديثٌ صامدٌ وكنسٌ كاملٌ ورحلةٌ اكتملت", () => {
    const verdict = judgeDeploySwap(healthy);
    expect(verdict.verdict).toBe("ok");
    expect(verdict.violations).toEqual([]);
    expect(verdict.rules).toHaveLength(11);
  });

  it("الحدُّ الأدنى الشرعيُّ: الإشارةُ والتحديثُ والجلسةُ والرحلةُ والبديلُ بلا قياسِ نافذةِ الإعلانِ", () => {
    const { announce: _announce, ...withoutAnnounce } = healthy;
    const verdict = judgeDeploySwap(withoutAnnounce);
    expect(verdict.verdict).toBe("ok");
    expect(verdict.rules.some((rule) => rule.id === "announce.seen-by-router")).toBe(false);
  });

  it("ح-7: `signal.graceful` — قتلٌ قاسٍ (SIGKILL) لا نشرٌ مُعلَنٌ — يُدانُ", () => {
    const verdict = judgeDeploySwap({ ...healthy, signal: { name: "SIGKILL", exitCode: 137 } });
    expect(verdict.violations).toContain("signal.graceful");
  });

  it("ح-7: خروجٌ برمزٍ غيرِ الصفرِ (انهيارٌ لا تصريفٌ) — يُدانُ", () => {
    const verdict = judgeDeploySwap({ ...healthy, signal: { name: "SIGTERM", exitCode: 1 } });
    expect(verdict.violations).toContain("signal.graceful");
  });

  it("ح-7: `announce.seen-by-router` — إشارةٌ بلا إعلانٍ (`/ready` بقيَ 200) — إعلانٌ لم يُشاهَدْ — يُدانُ", () => {
    const verdict = judgeDeploySwap({
      ...healthy,
      announce: { readyStatus: 200, statusBody: "ok", stillAccepting: true },
    });
    expect(verdict.violations).toContain("announce.seen-by-router");
  });

  it("ح-7: إعلانٌ بجسمٍ آخرَ (ليسَ draining) — حالةٌ لم يقرأها المُوجّهُ — يُدانُ", () => {
    const verdict = judgeDeploySwap({
      ...healthy,
      announce: { readyStatus: 503, statusBody: "degraded", stillAccepting: true },
    });
    expect(verdict.violations).toContain("announce.seen-by-router");
  });

  it("ح-7: إعلانٌ مرئيٌّ لكنَّ الخادمَ صمتَ (رفضُ اتصالٍ لا جوابَ HTTP) — إعلانٌ لا يراهُ أحدٌ — يُدانُ", () => {
    const verdict = judgeDeploySwap({
      ...healthy,
      announce: { readyStatus: 503, statusBody: "draining", stillAccepting: false },
    });
    expect(verdict.violations).toContain("announce.seen-by-router");
  });

  it("ح-7: `update.pending-observed-before-signal` — تحديثٌ عولجَ قبلَ الإشارةِ (`done`) لا يقيسُ عبورَ التبديلِ فيُدانُ", () => {
    const verdict = judgeDeploySwap({
      ...healthy,
      durableUpdate: { ...healthy.durableUpdate, statusObservedBeforeSignal: "done" },
    });
    expect(verdict.violations).toContain("update.pending-observed-before-signal");
  });

  it("ح-7: `update.not-claimed-at-exit` — وظيفةٌ حُجِزَتْ ولم تُختمْ عندَ الخروجِ (`claimed`) — انتظارُ الشوطِ الجاري كذِبٌ — يُدانُ", () => {
    const verdict = judgeDeploySwap({
      ...healthy,
      durableUpdate: { ...healthy.durableUpdate, statusAtExit: "claimed" },
    });
    expect(verdict.violations).toContain("update.not-claimed-at-exit");
  });

  it("ح-7: `update.survives-swap` — تحديثٌ مودَعٌ قبلَ الإشارةِ بقيَ معلَّقاً (`pending`) بعدَ البديلِ — ابتلاعٌ يُدانُ", () => {
    const verdict = judgeDeploySwap({
      ...healthy,
      durableUpdate: { ...healthy.durableUpdate, statusAfterReplacement: "pending" },
    });
    expect(verdict.violations).toContain("update.survives-swap");
  });

  it("ح-7: تحديثٌ ميتٌ (`dead`) بعدَ البديلِ — فُقدِدَ لا عولِجَ — يُدانُ", () => {
    const verdict = judgeDeploySwap({
      ...healthy,
      durableUpdate: { ...healthy.durableUpdate, statusAfterReplacement: "dead" },
    });
    expect(verdict.violations).toContain("update.survives-swap");
  });

  it("ح-7: `update.exactly-once` — وظيفتانِ لتحديثٍ واحدٍ (ازدواجٌ عبرَ التبديلِ) تُدانانِ", () => {
    const verdict = judgeDeploySwap({
      ...healthy,
      durableUpdate: { ...healthy.durableUpdate, jobRows: 2 },
    });
    expect(verdict.violations).toContain("update.exactly-once");
  });

  it("ح-7: `updates.all-accepted-survive` — واحدٌ من ثلاثةٍ مقبولاتٍ ضاعَ — الفقدُ على المجموعةِ يُدانُ", () => {
    const verdict = judgeDeploySwap({
      ...healthy,
      acceptedUpdates: { count: 3, doneAfterSwap: 2, exactlyOnce: 3 },
    });
    expect(verdict.violations).toContain("updates.all-accepted-survive");
  });

  it("ح-7: واحدٌ من ثلاثةٍ ازدوجَ (صفّانِ) — ازدواجٌ على المجموعةِ يُدانُ", () => {
    const verdict = judgeDeploySwap({
      ...healthy,
      acceptedUpdates: { count: 3, doneAfterSwap: 3, exactlyOnce: 2 },
    });
    expect(verdict.violations).toContain("updates.all-accepted-survive");
  });

  it("ح-7: كنسٌ فارغٌ (لا مقبولاتٍ) — نجاحٌ بلا قياسٍ — يُدانُ", () => {
    const verdict = judgeDeploySwap({
      ...healthy,
      acceptedUpdates: { count: 0, doneAfterSwap: 0, exactlyOnce: 0 },
    });
    expect(verdict.violations).toContain("updates.all-accepted-survive");
  });

  it("ح-7: `session.survives-swap` — جلسةٌ اختفتْ بعدَ البديلِ — مفتاحٌ مُحِيَ — يُدانُ", () => {
    const verdict = judgeDeploySwap({
      ...healthy,
      session: { ...healthy.session, existedBeforeSignal: false },
    });
    expect(verdict.violations).toContain("session.survives-swap");
  });

  it("ح-7: جلسةٌ أُعيدتْ إلى الحالةِ الابتدائيّةِ (idle) بعدَ البديلِ — حوارٌ بُنيَ من الصفرِ — يُدانُ", () => {
    const verdict = judgeDeploySwap({
      ...healthy,
      session: { ...healthy.session, resetToInitialState: true },
    });
    expect(verdict.violations).toContain("session.survives-swap");
  });

  it("ح-7: `ride.completes-via-replacement` — طلبانِ لراكبٍ واحدٍ (ازدواجٌ عبرَ التبديلِ) يُدانانِ", () => {
    const verdict = judgeDeploySwap({ ...healthy, ride: { ...healthy.ride, orderRows: 2 } });
    expect(verdict.violations).toContain("ride.completes-via-replacement");
  });

  it("ح-7: رحلةٌ بقيتْ `in_progress` بعدَ البديلِ — تعطُّلٌ لا اكتمالٌ — يُدانُ", () => {
    const verdict = judgeDeploySwap({
      ...healthy,
      ride: { ...healthy.ride, finalStatus: "in_progress" },
    });
    expect(verdict.violations).toContain("ride.completes-via-replacement");
  });

  it("ح-7: رحلةٌ اكتملتْ لكنَّ السائقَ لم يعدْ متاحاً — أثرٌ ناقصٌ — يُدانُ", () => {
    const verdict = judgeDeploySwap({
      ...healthy,
      ride: { ...healthy.ride, driverAvailableAgain: false },
    });
    expect(verdict.violations).toContain("ride.completes-via-replacement");
  });

  it("ح-7: `replacement.ready` — بديلٌ أجابَ 503 (لم يُقلِعْ صحّيحاً) يُدانُ", () => {
    const verdict = judgeDeploySwap({
      ...healthy,
      replacement: { readyStatus: 503, startedAfterOldExit: true },
    });
    expect(verdict.violations).toContain("replacement.ready");
  });

  it("ح-7: `replacement.after-old-exit` — بديلٌ أُقلِعَ معَ الأُولى لا بعدَها (تعدُّدُ مثيلاتٍ — R-17) يُدانُ", () => {
    const verdict = judgeDeploySwap({
      ...healthy,
      replacement: { readyStatus: 200, startedAfterOldExit: false },
    });
    expect(verdict.violations).toContain("replacement.after-old-exit");
  });

  it("ح-7: مدخلٌ خالٍ — اختبارٌ «نجحَ» ولم يقِسْ شيئاً — يُدانُ لا يُقبَلُ", () => {
    const verdict = judgeDeploySwap({});
    expect(verdict.verdict).toBe("violation");
    expect(verdict.violations).toContain("signal.graceful");
  });

  it("زمنُ التعطُّلِ للتوثيقِ: موجبٌ ومرتَّبٌ، والسالبُ يُقصُّ على صفرٍ", () => {
    expect(swapDowntimeMs(1_000, 4_250)).toBe(3_250);
    expect(swapDowntimeMs(2_000, 1_000)).toBe(0);
  });
});
