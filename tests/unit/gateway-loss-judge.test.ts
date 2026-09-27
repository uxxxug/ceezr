/**
 * الغرض: سالباتٌ مبذورةٌ لكلِّ قاعدةٍ من قواعدِ حَكَمِ فقدانِ البوّابةِ (`ح-7` ·
 *   `F11-01` · ADR 0202): كلُّ قاعدةٍ لها كسرٌ مزروعٌ يُثبِتُ أنَّها تُمسِكُهُ،
 *   وموجبةٌ تُثبِتُ أنَّها لا تعضُّ البريءَ.
 * الحالة: مُنفَّذ · مُختبَر.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import { downtimeMs, judgeGatewayLoss } from "../../scripts/lib/gateway-loss.ts";

const healthy = {
  kill: { signal: "SIGKILL", exited: true },
  downtime: { refusedAtNetworkLevel: true, answeredOk: false },
  replacement: { readyStatus: 200 },
  durableUpdate: { statusAtDeath: "pending", statusAfterReplacement: "done", jobRows: 1 },
  session: { existedBeforeDeath: true, existsAfterReplacement: true, resetToInitialState: false },
  ride: { orderRows: 1, finalStatus: "completed", driverAvailableAgain: true },
};

describe("حَكَمُ فقدانِ البوّابةِ (F11-01 · ADR 0202)", () => {
  it("الموجبةُ الكاملةُ: موتٌ حقيقيٌّ ورفضٌ صادقٌ وبديلٌ جاهزٌ وتحديثٌ صامدٌ ورحلةٌ اكتملت", () => {
    const verdict = judgeGatewayLoss(healthy);
    expect(verdict.verdict).toBe("ok");
    expect(verdict.violations).toEqual([]);
    expect(verdict.rules).toHaveLength(8);
  });

  it("الحدُّ الأدنى الشرعيُّ: الموتُ والبديلُ والتحديثُ والجلسةُ والرحلةُ بلا قياسِ وقتِ الموتِ", () => {
    const { downtime: _downtime, ...withoutDowntime } = healthy;
    const verdict = judgeGatewayLoss(withoutDowntime);
    expect(verdict.verdict).toBe("ok");
    expect(verdict.rules.some((rule) => rule.id === "gateway.downtime-honest")).toBe(false);
  });

  it("ح-7: `gateway.really-killed` — موتٌ مُدَّعى (SIGTERM تصريفٌ لا فقداناً) يُدانُ", () => {
    const verdict = judgeGatewayLoss({ ...healthy, kill: { signal: "SIGTERM", exited: true } });
    expect(verdict.violations).toContain("gateway.really-killed");
  });

  it("ح-7: عمليةٌ لم تخرجْ بعدَ القتلِ — الحكمُ على موتٍ لم يقعْ — يُدانُ", () => {
    const verdict = judgeGatewayLoss({ ...healthy, kill: { signal: "SIGKILL", exited: false } });
    expect(verdict.violations).toContain("gateway.really-killed");
  });

  it("ح-7: `gateway.downtime-honest` — طلبٌ في أثناءِ الموتِ أُجيبَ 200 — كذبٌ يُدانُ", () => {
    const verdict = judgeGatewayLoss({
      ...healthy,
      downtime: { refusedAtNetworkLevel: false, answeredOk: true },
    });
    expect(verdict.violations).toContain("gateway.downtime-honest");
  });

  it("ح-7: طلبُ وقتِ الموتِ «نجحَ» شبكيّاً بلا رفضِ اتصالٍ — شيءٌ حيٌّ يسمعُ — يُدانُ", () => {
    const verdict = judgeGatewayLoss({
      ...healthy,
      downtime: { refusedAtNetworkLevel: false, answeredOk: false },
    });
    expect(verdict.violations).toContain("gateway.downtime-honest");
  });

  it("ح-7: `gateway.replacement-ready` — بديلٌ أجابَ 503 (لم يُقلِعْ صحّيحاً) يُدانُ", () => {
    const verdict = judgeGatewayLoss({ ...healthy, replacement: { readyStatus: 503 } });
    expect(verdict.violations).toContain("gateway.replacement-ready");
  });

  it("ح-7: `update.pending-at-death` — تحديثٌ عولجَ قبلَ الموتِ (`done`) لا يقيسُ عبورَ الموتِ فيُدانُ", () => {
    const verdict = judgeGatewayLoss({
      ...healthy,
      durableUpdate: { ...healthy.durableUpdate, statusAtDeath: "done" },
    });
    expect(verdict.violations).toContain("update.pending-at-death");
  });

  it("ح-7: `update.survives-death` — تحديثٌ مودَعٌ قبلَ الموتِ بقيَ معلَّقاً (`pending`) بعدَ البديلِ — ابتلاعٌ يُدانُ", () => {
    const verdict = judgeGatewayLoss({
      ...healthy,
      durableUpdate: { ...healthy.durableUpdate, statusAfterReplacement: "pending" },
    });
    expect(verdict.violations).toContain("update.survives-death");
  });

  it("ح-7: تحديثٌ ميتٌ (`dead`) بعدَ البديلِ — فُقدِدَ لا عولِجَ — يُدانُ", () => {
    const verdict = judgeGatewayLoss({
      ...healthy,
      durableUpdate: { ...healthy.durableUpdate, statusAfterReplacement: "dead" },
    });
    expect(verdict.violations).toContain("update.survives-death");
  });

  it("ح-7: `update.exactly-once` — وظيفتانِ لتحديثٍ واحدٍ (ازدواجٌ عبرَ الموتِ) تُدانانِ", () => {
    const verdict = judgeGatewayLoss({
      ...healthy,
      durableUpdate: { ...healthy.durableUpdate, jobRows: 2 },
    });
    expect(verdict.violations).toContain("update.exactly-once");
  });

  it("ح-7: `session.survives-in-redis` — جلسةٌ اختفتْ بعدَ البديلِ — مفتاحٌ مُحِيَ — يُدانُ", () => {
    const verdict = judgeGatewayLoss({
      ...healthy,
      session: { ...healthy.session, existedBeforeDeath: false },
    });
    expect(verdict.violations).toContain("session.survives-in-redis");
  });

  it("ح-7: جلسةٌ أُعيدتْ إلى الحالةِ الابتدائيّةِ (idle) بعدَ البديلِ — حوارٌ بُنيَ من الصفرِ — يُدانُ", () => {
    const verdict = judgeGatewayLoss({
      ...healthy,
      session: { ...healthy.session, resetToInitialState: true },
    });
    expect(verdict.violations).toContain("session.survives-in-redis");
  });

  it("ح-7: `ride.completes-via-replacement` — طلبانِ لراكبٍ واحدٍ (ازدواجٌ عبرَ الموتِ) يُدانانِ", () => {
    const verdict = judgeGatewayLoss({ ...healthy, ride: { ...healthy.ride, orderRows: 2 } });
    expect(verdict.violations).toContain("ride.completes-via-replacement");
  });

  it("ح-7: رحلةٌ بقيتْ `in_progress` بعدَ البديلِ — تعطُّلٌ لا اكتمالٌ — يُدانُ", () => {
    const verdict = judgeGatewayLoss({
      ...healthy,
      ride: { ...healthy.ride, finalStatus: "in_progress" },
    });
    expect(verdict.violations).toContain("ride.completes-via-replacement");
  });

  it("ح-7: رحلةٌ اكتملتْ لكنَّ السائقَ لم يعدْ متاحاً — أثرٌ ناقصٌ — يُدانُ", () => {
    const verdict = judgeGatewayLoss({
      ...healthy,
      ride: { ...healthy.ride, driverAvailableAgain: false },
    });
    expect(verdict.violations).toContain("ride.completes-via-replacement");
  });

  it("ح-7: مدخلٌ خالٍ — اختبارٌ «نجحَ» ولم يقِسْ شيئاً — يُدانُ لا يُقبَلُ", () => {
    const verdict = judgeGatewayLoss({});
    expect(verdict.verdict).toBe("violation");
    expect(verdict.violations).toContain("gateway.really-killed");
  });

  it("زمنُ التعطُّلِ للتوثيقِ: موجبٌ ومرتَّبٌ، والسالبُ يُقصُّ على صفرٍ", () => {
    expect(downtimeMs(1_000, 4_250)).toBe(3_250);
    expect(downtimeMs(2_000, 1_000)).toBe(0);
  });
});
