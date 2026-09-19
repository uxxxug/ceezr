/**
 * # سوالبُ حكمِ بياناتِ الجلسةِ — `F1-09` (`ح-7`)
 *
 * كلُّ قاعدةٍ في `SESSION_RULE_NAMES` لها سالبةٌ مبذورةٌ تُثبِتُ سقوطَها، ومعَها
 * حالةٌ موجبةٌ تُثبِتُ أنَّ الأخضرَ ليسَ صمتاً. والحكمُ **نقيٌّ**: لا قاعدةَ ولا
 * شبكةَ ولا قرصَ — فالحسابُ ههنا يُختبَرُ بالأرقامِ لا بالبنيةِ.
 *
 * وما لا يُقاسُ ههنا: **صدقُ الأرقامِ**. الأرقامُ تُقاسُ في
 * `tests/integration/rider-session-data-budget.test.ts` على بوّابةٍ وقاعدةٍ وقناةٍ
 * حقيقيّةٍ، ووجودُ هذا الملفِّ ليسَ دليلَ التزامٍ بالحدِّ.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  composeHttpCalls,
  describeSessionData,
  judgeSessionData,
  liveFrameCount,
  RIDER_SESSION_PROFILE,
  SESSION_DATA_BUDGET_BYTES,
  SESSION_RULE_NAMES,
  SESSION_WINDOW_MS,
  type SessionDataFacts,
} from "../../scripts/lib/session-data-budget.ts";

/** حقائقُ صحيحةٌ صغيرةٌ — قاعدةُ كلِّ سالبةٍ: يُغيَّرُ منها حقلٌ واحدٌ. */
function healthyFacts(overrides: Partial<SessionDataFacts> = {}): SessionDataFacts {
  return {
    firstLoadBytes: 180 * 1024,
    httpCalls: [
      { label: "GET /v1/me", bytes: 44, callsInWindow: 1 },
      { label: "GET /v1/me/places", bytes: 6174, callsInWindow: 1 },
    ],
    liveFrameBytes: 286,
    liveFrameIntervalMs: 5_000,
    channelOpenBytes: 140,
    ...overrides,
  };
}

/** أسماءُ القواعدِ المخروقةِ في حكمٍ — مرتَّبةً لا مكرَّرةً. */
function brokenRules(facts: SessionDataFacts): string[] {
  return [...new Set(judgeSessionData(facts).violations.map((violation) => violation.rule))].sort();
}

describe("حكمُ بياناتِ الجلسةِ — كلُّ قاعدةٍ مبذورةٌ سالبةً", () => {
  it("القواعدُ كلُّها مبذورةٌ — لا تُضافُ قاعدةٌ بلا سالبةٍ", () => {
    const source = readFileSync(import.meta.path, "utf8");
    for (const rule of SESSION_RULE_NAMES) {
      expect(source).toContain(rule);
    }
  });

  it("الموجبةُ: حقائقُ سليمةٌ تمرُّ بلا مخالفةٍ واحدةٍ", () => {
    const verdict = judgeSessionData(healthyFacts());
    expect(verdict.violations).toEqual([]);
    expect(verdict.totalBytes).toBeGreaterThan(0);
    expect(verdict.frameCount).toBe(liveFrameCount(SESSION_WINDOW_MS, 5_000));
  });

  it("`session.interval-positive` — مهلةٌ صفرٌ أو سالبةٌ لا يُشتَقُّ منها عددُ إطاراتٍ", () => {
    expect(brokenRules(healthyFacts({ liveFrameIntervalMs: 0 }))).toContain(
      "session.interval-positive",
    );
    expect(brokenRules(healthyFacts({ liveFrameIntervalMs: Number.NaN }))).toContain(
      "session.interval-positive",
    );
  });

  it("`session.interval-within-window` — مهلةٌ أطولُ من النافذةِ تُفرِّغُ القياسَ", () => {
    expect(brokenRules(healthyFacts({ liveFrameIntervalMs: SESSION_WINDOW_MS + 1 }))).toContain(
      "session.interval-within-window",
    );
  });

  it("`session.frames-measured` — إطارٌ بصفرِ بايتٍ غيابُ قياسٍ لا التزامٌ", () => {
    expect(brokenRules(healthyFacts({ liveFrameBytes: 0 }))).toContain("session.frames-measured");
  });

  it("`session.calls-measured` — لا نداءَ، أو نداءٌ بصفرِ بايتٍ، أو بعددٍ غيرِ صالحٍ", () => {
    expect(brokenRules(healthyFacts({ httpCalls: [] }))).toContain("session.calls-measured");
    expect(
      brokenRules(
        healthyFacts({ httpCalls: [{ label: "GET /v1/me", bytes: 0, callsInWindow: 1 }] }),
      ),
    ).toContain("session.calls-measured");
    expect(
      brokenRules(
        healthyFacts({ httpCalls: [{ label: "GET /v1/me", bytes: 44, callsInWindow: 0 }] }),
      ),
    ).toContain("session.calls-measured");
  });

  it("`session.first-load-measured` — جلسةٌ تبدأُ بفتحِ التطبيقِ، فإغفالُه تخفيفٌ بالحذفِ", () => {
    expect(brokenRules(healthyFacts({ firstLoadBytes: 0 }))).toContain(
      "session.first-load-measured",
    );
  });

  it("`session.no-negative` — رقمٌ سالبٌ يُنقِصُ المجموعَ فيُمرِّرُ حدّاً مخروقاً", () => {
    expect(brokenRules(healthyFacts({ channelOpenBytes: -1_000_000 }))).toContain(
      "session.no-negative",
    );
    expect(
      brokenRules(
        healthyFacts({ httpCalls: [{ label: "GET /v1/me", bytes: -5, callsInWindow: 1 }] }),
      ),
    ).toContain("session.no-negative");
  });

  it("`session.within-budget` — تجاوزُ الحدِّ يسقطُ، والمساواةُ تمرُّ («≤» لا «<»)", () => {
    const over = healthyFacts({ firstLoadBytes: SESSION_DATA_BUDGET_BYTES });
    expect(brokenRules(over)).toContain("session.within-budget");

    // المساواةُ بالحدِّ حرفاً: الحملُ الأوّلُ يُضبَطُ ليُكمِلَ المجموعَ إلى الحدِّ.
    const probe = judgeSessionData(healthyFacts({ firstLoadBytes: 1 }));
    const exact = healthyFacts({
      firstLoadBytes: SESSION_DATA_BUDGET_BYTES - (probe.totalBytes - 1),
    });
    const verdict = judgeSessionData(exact);
    expect(verdict.totalBytes).toBe(SESSION_DATA_BUDGET_BYTES);
    expect(verdict.violations).toEqual([]);
  });

  it("عددُ الإطاراتِ سقفٌ لا متوسِّطٌ: أوّلُ إطارٍ يُحسَبُ، ومهلةٌ غيرُ صالحةٍ تُعطي صفراً", () => {
    expect(liveFrameCount(600_000, 5_000)).toBe(121);
    expect(liveFrameCount(600_000, 600_000)).toBe(2);
    expect(liveFrameCount(600_000, 0)).toBe(0);
    expect(liveFrameCount(600_000, -5)).toBe(0);
  });

  it("`composeHttpCalls` يُصفِّرُ وسماً بلا قياسٍ فيُسقِطُه الحكمُ ولا يمرُّ صامتاً", () => {
    const calls = composeHttpCalls({ "GET /v1/me": 44 });
    expect(calls.length).toBe(RIDER_SESSION_PROFILE.length);
    const zeroed = calls.filter((call) => call.bytes === 0);
    expect(zeroed.length).toBe(RIDER_SESSION_PROFILE.length - 1);
    expect(brokenRules(healthyFacts({ httpCalls: calls }))).toContain("session.calls-measured");
  });

  it("التقريرُ يطبعُ الأرقامَ كلَّها: دليلٌ بلا رقمٍ لا يُراجَعُ", () => {
    const facts = healthyFacts();
    const text = describeSessionData(facts, judgeSessionData(facts));
    expect(text).toContain("المجموعُ");
    for (const call of facts.httpCalls) {
      expect(text).toContain(call.label);
    }
  });

  it("شكلُ النافذةِ معلَّلٌ بالكاملِ: كلُّ نداءٍ بعددٍ موجبٍ وسببٍ مكتوبٍ", () => {
    expect(RIDER_SESSION_PROFILE.length).toBeGreaterThan(0);
    for (const entry of RIDER_SESSION_PROFILE) {
      expect(Number.isInteger(entry.callsInWindow)).toBe(true);
      expect(entry.callsInWindow).toBeGreaterThan(0);
      expect(entry.reason.trim().length).toBeGreaterThan(0);
    }
  });
});
