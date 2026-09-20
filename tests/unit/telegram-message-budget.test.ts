/**
 * الغرض: سوالبُ مبذورةٌ لكلِّ قاعدةٍ في حَكَمِ ميزانِ رسائلِ تيليجرام (`ECO-003`) —
 *   `ح-7`: قاعدةٌ بلا سالبةٍ مبذورةٍ لا يُعرَفُ أنّها تعملُ، فخضرتُها لا تُقرأُ
 *   إنفاذاً بل صمتاً. ويُثبَّتُ ههنا كذلكَ أنَّ السقفَ **مُشتَقٌّ** من الشكلِ:
 *   تغييرُ الشكلِ يُغيِّرُ السقفَ، فلا يبقى رقمٌ مكتوبٌ في مكانَينِ.
 * الحالة: منفّذ فعلياً — `ECO-003`.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import {
  describeTelegramViolation,
  JUDGE_RULE_NAMES,
  judgeTelegramMessages,
  type MeasuredMessage,
  maxAllowedReplyBurst,
  pushMessageBudget,
  pushMessages,
  RIDE_MESSAGE_PROFILE,
  replyMessageBudget,
  replyMessages,
  rideMessageBudget,
  summarizeTelegramMessages,
  TELEGRAM_FREE_RATE_PER_SECOND,
  type TelegramMessageFacts,
} from "../../scripts/lib/telegram-message-budget.ts";

const CRITICAL_KINDS = 12;

const reply = (party: string, index: number): MeasuredMessage => ({
  party,
  duringUpdateFrom: party,
  updateIndex: index,
  cause: "dialog.reply",
});

const broadcast = (): MeasuredMessage => ({
  party: "driver",
  duringUpdateFrom: null,
  updateIndex: null,
  cause: "offer.broadcast",
});

const transition = (party: string, index: number): MeasuredMessage => ({
  party,
  duringUpdateFrom: party === "rider" ? "driver" : "rider",
  updateIndex: index,
  cause: "lifecycle.transition",
});

const ratingPrompt = (index: number): MeasuredMessage => ({
  party: "rider",
  duringUpdateFrom: "driver",
  updateIndex: index,
  cause: "rating.prompt",
});

/** رحلةٌ نظيفةٌ بشكلِ القياسِ الحقيقيِّ: 5 رسائلِ دفعٍ و4 ردودٍ على 4 تحديثاتٍ. */
function healthyMessages(): MeasuredMessage[] {
  return [
    broadcast(),
    transition("rider", 1),
    transition("rider", 2),
    transition("rider", 3),
    ratingPrompt(3),
    reply("driver", 1),
    reply("driver", 2),
    reply("driver", 3),
    reply("rider", 4),
  ];
}

function factsFrom(messages: readonly MeasuredMessage[]): TelegramMessageFacts {
  return {
    measured: true,
    inboundUpdateCount: 4,
    messages,
    driverMessageCount: messages.filter((m) => m.party === "driver").length,
    riderMessageCount: messages.filter((m) => m.party === "rider").length,
    criticalKindCount: CRITICAL_KINDS,
  };
}

function judge(
  facts: TelegramMessageFacts,
  overrides: Partial<{ budget: number; profile: typeof RIDE_MESSAGE_PROFILE }> = {},
): readonly string[] {
  return judgeTelegramMessages({
    facts,
    profile: overrides.profile ?? RIDE_MESSAGE_PROFILE,
    budget: overrides.budget ?? pushMessageBudget(overrides.profile ?? RIDE_MESSAGE_PROFILE),
    declaredCriticalKindCount: CRITICAL_KINDS,
  }).map((violation) => violation.rule);
}

describe("حَكَمُ ميزانِ رسائلِ تيليجرام — السقفُ مُشتَقٌّ لا مكتوبٌ", () => {
  it("سقفُ الدفعِ حاصلُ البثِّ والانتقالاتِ وطلبِ التقييمِ المدفوعِ", () => {
    expect(pushMessageBudget(RIDE_MESSAGE_PROFILE)).toBe(
      RIDE_MESSAGE_PROFILE.offeredDriverCount * RIDE_MESSAGE_PROFILE.broadcastRoundCount +
        RIDE_MESSAGE_PROFILE.crossPartyTransitionCount +
        RIDE_MESSAGE_PROFILE.pushedRatingPromptCount,
    );
  });

  it("سائقانِ مؤهَّلانِ يُضاعِفانِ نصيبَ البثِّ في السقفِ — النموُّ خطّيٌّ لا ثابتٌ", () => {
    const wider = { ...RIDE_MESSAGE_PROFILE, offeredDriverCount: 2 };
    expect(pushMessageBudget(wider)).toBe(pushMessageBudget(RIDE_MESSAGE_PROFILE) + 1);
  });

  it("دورةُ بثٍّ ثانيةٌ تُضاعِفُ نصيبَ البثِّ وحدَه", () => {
    const rebroadcast = { ...RIDE_MESSAGE_PROFILE, broadcastRoundCount: 2 };
    expect(pushMessageBudget(rebroadcast)).toBe(pushMessageBudget(RIDE_MESSAGE_PROFILE) + 1);
  });

  it("سقفُ الردودِ دالّةُ الوارِدِ لا ثابتٌ", () => {
    expect(replyMessageBudget(0)).toBe(0);
    expect(replyMessageBudget(4)).toBe(4 * RIDE_MESSAGE_PROFILE.maxReplyBurst);
    expect(rideMessageBudget(4)).toBe(pushMessageBudget() + replyMessageBudget(4));
  });

  it("حدُّ الدفقةِ المُعلَنُ لا يتجاوزُ أقصى المسموحِ", () => {
    expect(RIDE_MESSAGE_PROFILE.maxReplyBurst).toBeLessThanOrEqual(maxAllowedReplyBurst());
  });

  it("القسمةُ بينَ الدفعِ والردِّ تستوعبُ كلَّ رسالةٍ ولا تُكرِّرُ واحدةً", () => {
    const messages = healthyMessages();
    expect(pushMessages(messages).length + replyMessages(messages).length).toBe(messages.length);
    expect(pushMessages(messages)).toHaveLength(pushMessageBudget());
  });

  it("رحلةٌ سليمةٌ لا تُنتِجُ مخالفةً", () => {
    expect(judge(factsFrom(healthyMessages()))).toEqual([]);
  });
});

describe("سوالبُ مبذورةٌ — لكلِّ قاعدةٍ واحدةٌ", () => {
  it("facts.measured — قياسٌ لم يجرِ لا يُقرأُ صفرَ رسائلَ", () => {
    expect(judge({ ...factsFrom(healthyMessages()), measured: false })).toContain("facts.measured");
    expect(judge({ ...factsFrom([]), measured: true })).toContain("facts.measured");
  });

  it("counts.sane — عددٌ سالبٌ أو كسريٌّ يُبطِلُ ما بعدَه", () => {
    expect(judge({ ...factsFrom(healthyMessages()), inboundUpdateCount: -1 })).toContain(
      "counts.sane",
    );
    expect(judge({ ...factsFrom(healthyMessages()), criticalKindCount: 1.5 })).toContain(
      "counts.sane",
    );
  });

  it("parties.consistent — عدّادٌ يُخالِفُ السجلَّ معطوبٌ", () => {
    const facts = factsFrom(healthyMessages());
    expect(judge({ ...facts, driverMessageCount: facts.driverMessageCount + 1 })).toContain(
      "parties.consistent",
    );
  });

  it("push.cause-declared — رسالةٌ بلا سببٍ لا تُصنَّفُ", () => {
    const messages = [
      ...healthyMessages(),
      { party: "rider", duringUpdateFrom: "rider", updateIndex: 4, cause: "" },
    ];
    expect(judge(factsFrom(messages))).toContain("push.cause-declared");
  });

  it("push.unsolicited-only — دفعٌ إلى مَن أرسلَ التحديثَ نفسَه ردٌّ لا دفعٌ", () => {
    const messages = healthyMessages().map((m) =>
      m.cause === "lifecycle.transition" && m.updateIndex === 1
        ? { ...m, duringUpdateFrom: "rider" }
        : m,
    );
    expect(judge(factsFrom(messages))).toContain("push.unsolicited-only");
  });

  it("push.within-budget — بثٌّ زائدٌ يتجاوزُ سقفَ الدفعِ", () => {
    const messages = [...healthyMessages(), broadcast(), broadcast()];
    expect(judge(factsFrom(messages))).toContain("push.within-budget");
  });

  it("reply.attributed — ردٌّ بلا تحديثٍ، وردٌّ إلى غيرِ المُرسِلِ", () => {
    const orphan = [
      ...healthyMessages(),
      { party: "rider", duringUpdateFrom: null, updateIndex: null, cause: "dialog.reply" },
    ];
    expect(judge(factsFrom(orphan))).toContain("reply.attributed");
    const crossed = [
      ...healthyMessages(),
      { party: "rider", duringUpdateFrom: "driver", updateIndex: 2, cause: "dialog.reply" },
    ];
    expect(judge(factsFrom(crossed))).toContain("reply.attributed");
  });

  it("reply.burst-bounded — دفقةٌ فوقَ الحدِّ المُعلَنِ إغراقٌ", () => {
    const flood = [
      ...healthyMessages(),
      reply("driver", 1),
      reply("driver", 1),
      reply("driver", 1),
    ];
    expect(judge(factsFrom(flood))).toContain("reply.burst-bounded");
  });

  it("ride.within-budget — إجماليٌّ فوقَ سقفِ الرحلةِ المُشتَقِّ", () => {
    const facts = { ...factsFrom(healthyMessages()), inboundUpdateCount: 1 };
    expect(judge(facts)).toContain("ride.within-budget");
  });

  it("budget.derived — سقفٌ مكتوبٌ يُخالِفُ المُشتَقَّ، وحدُّ دفقةٍ مُلَيَّنٌ", () => {
    expect(judge(factsFrom(healthyMessages()), { budget: 99 })).toContain("budget.derived");
    const loosened = { ...RIDE_MESSAGE_PROFILE, maxReplyBurst: maxAllowedReplyBurst() + 1 };
    expect(judge(factsFrom(healthyMessages()), { profile: loosened })).toContain("budget.derived");
  });

  it("rate-limit.headroom — رحلةٌ وحدَها تبلغُ حدَّ TG-001", () => {
    const flooded = [...healthyMessages()];
    // ردودٌ موزَّعةٌ على تحديثاتٍ مختلفةٍ: الإغراقُ في الإجماليِّ لا في دفقةٍ.
    for (let i = 0; i <= TELEGRAM_FREE_RATE_PER_SECOND; i += 1) {
      flooded.push(reply("rider", 100 + i));
    }
    const rules = judge({
      ...factsFrom(flooded),
      inboundUpdateCount: TELEGRAM_FREE_RATE_PER_SECOND + 10,
    });
    expect(rules).toContain("rate-limit.headroom");
  });

  it("kinds.single-source — عددٌ مكتوبٌ في القياسِ يُخالِفُ مصدرَه الواحدَ", () => {
    expect(
      judge({ ...factsFrom(healthyMessages()), criticalKindCount: CRITICAL_KINDS - 1 }),
    ).toContain("kinds.single-source");
  });

  it("لكلِّ قاعدةٍ مُعلَنةٍ سالبةٌ في هذا الملفِّ — لا اسمَ ميّتٌ ولا قاعدةَ بلا برهانٍ", () => {
    const file = Bun.file(new URL(import.meta.url)).text();
    return file.then((source) => {
      for (const rule of JUDGE_RULE_NAMES) {
        expect(source.includes(`"${rule}"`)).toBe(true);
      }
    });
  });
});

describe("الوصفُ يقولُ ما لا يُدَّعى", () => {
  it("الملخَّصُ يذكرُ العددَ والقسمةَ وينفي أنَّه تكلفةٌ", () => {
    const facts = factsFrom(healthyMessages());
    const summary = summarizeTelegramMessages(facts, pushMessageBudget());
    expect(summary).toContain(String(facts.messages.length));
    expect(summary).toContain("DEC-04");
    expect(summary).not.toContain("نجمة");
  });

  it("وصفُ المخالفةِ يحملُ اسمَ القاعدةِ وتفصيلَها", () => {
    expect(describeTelegramViolation({ rule: "push.within-budget", detail: "تفصيلٌ" })).toBe(
      "push.within-budget: تفصيلٌ",
    );
  });
});
