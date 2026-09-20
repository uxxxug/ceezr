/**
 * الغرض: سوالبُ مبذورةٌ لكلِّ قاعدةٍ في حاجزِ عدِّ رسائلِ تيليجرام (`ECO-003`) —
 *   `ح-7`. ويُشغَّلُ **الحاجزُ عينُه** بمدخلاتٍ محقونةٍ لا نسخةٌ من منطقِه ههنا:
 *   حاجزٌ يُختبَرُ بنسخةٍ منه يبرهنُ النسخةَ لا الحاجزَ. ويُثبَّتُ كذلكَ أنَّ
 *   الحاجزَ **أخضرُ على المستودَعِ كما هوَ** — فلا يكونُ برهانُ سقوطِه وحدَه.
 * الحالة: منفّذ فعلياً — `ECO-003`.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import {
  type AuditInputs,
  auditTelegramMessageBudget,
  defaultInputs,
  GUARD_RULE_NAMES,
} from "../../scripts/check-telegram-message-budget.ts";
import { PUSH_CAUSES, RIDE_MESSAGE_PROFILE } from "../../scripts/lib/telegram-message-budget.ts";

const rules = (overrides: Partial<AuditInputs>): readonly string[] =>
  auditTelegramMessageBudget(overrides).map((problem) => problem.rule);

/** نصُّ قياسٍ سليمٌ مُصطنَعٌ: يحملُ كلَّ علامةٍ يطلبُها الحاجزُ ولا شيءَ زائداً. */
const HEALTHY_SOURCE = `
  import { judgeTelegramMessages, pushMessageBudget, RIDE_MESSAGE_PROFILE } from "../../scripts/lib/telegram-message-budget.ts";
  import { SEEDED_NOTIFICATION_CHANNELS, NOTIFICATION_KINDS } from "../../packages/shared/config/notification-kinds.ts";
  import { buildContainer } from "../../apps/gateway/src/container.ts";
  import { createServer } from "../../apps/gateway/src/server.ts";
  import { drainNotificationOutbox } from "../support/drain-notification-outbox.ts";
  const DATABASE_URL = process.env.TEST_DATABASE_URL;
  sendMessage sendPhoto sendLocation
  fetch("http://localhost/webhook/telegram/driver");
  const m = { duringUpdateFrom: null, updateIndex: 1, cause: "${PUSH_CAUSES[0]}" };
  "${PUSH_CAUSES[1]}" "${PUSH_CAUSES[2]}"
  post("driver", "driver", cb("offer:accept:" + id));
  post("driver", "driver", cb("ride:start:" + id));
  post("driver", "driver", cb("ride:complete:" + id));
  post("rider", "rider", cb("rate:5:" + id));
  expect(status).toBe("completed");
  const facts = { measured: true, criticalKindCount: declared };
  expect(violations).toEqual([]);
`;

const healthy = (): Partial<AuditInputs> => ({ measurementSource: HEALTHY_SOURCE });

describe("حاجزُ عدِّ رسائلِ تيليجرام — أخضرُ على المستودَعِ كما هوَ", () => {
  it("لا مشكلةَ على المستودَعِ الحقيقيِّ", () => {
    expect(auditTelegramMessageBudget()).toEqual([]);
  });

  it("نصُّ القياسِ المُصطنَعُ السليمُ لا يُنتِجُ مشكلةً", () => {
    expect(rules(healthy())).toEqual([]);
  });

  it("المدخلاتُ الافتراضيّةُ تقرأُ القرصَ فعلاً", () => {
    const inputs = defaultInputs();
    expect(inputs.measurementSource).not.toBeNull();
    expect(inputs.packageJson).not.toBeNull();
    expect(inputs.budget).toBeGreaterThan(0);
    expect(inputs.criticalKindCount).toBeGreaterThan(0);
  });
});

describe("سوالبُ مبذورةٌ — لكلِّ قاعدةِ حاجزٍ واحدةٌ", () => {
  it("guard.measurement-present — ملفُّ القياسِ غائبٌ", () => {
    const problems = rules({ measurementSource: null });
    expect(problems).toContain("guard.measurement-present");
    // وغيابُه يُنهي الفحصَ: لا تُكدَّسُ مشاكلُ ما بعدَه على غيابٍ واحدٍ.
    expect(problems.filter((rule) => rule.startsWith("guard.judge"))).toEqual([]);
  });

  it("guard.judge-imported — القياسُ لا يستوردُ الحَكَمَ", () => {
    expect(
      rules({ measurementSource: HEALTHY_SOURCE.replace(/telegram-message-budget/g, "x") }),
    ).toContain("guard.judge-imported");
    expect(
      rules({ measurementSource: HEALTHY_SOURCE.replace("judgeTelegramMessages", "x") }),
    ).toContain("guard.judge-imported");
  });

  it("guard.wire-counted — نوعُ إرسالٍ غيرُ معدودٍ، أو قياسٌ لا يمرُّ من الـwebhook", () => {
    expect(rules({ measurementSource: HEALTHY_SOURCE.replace("sendLocation", "x") })).toContain(
      "guard.wire-counted",
    );
    expect(
      rules({ measurementSource: HEALTHY_SOURCE.replace("webhook/telegram/", "x/") }),
    ).toContain("guard.wire-counted");
  });

  it("guard.container-wired — بلا حاويةٍ إنتاجيّةٍ أو بلا قاعدةٍ حقيقيّةٍ", () => {
    expect(rules({ measurementSource: HEALTHY_SOURCE.replace("buildContainer", "x") })).toContain(
      "guard.container-wired",
    );
    expect(
      rules({ measurementSource: HEALTHY_SOURCE.replace("TEST_DATABASE_URL", "x") }),
    ).toContain("guard.container-wired");
  });

  it("guard.attribution-intact — الإسنادُ مطموسٌ، أو سببُ دفعٍ غيرُ مقيسٍ", () => {
    expect(rules({ measurementSource: HEALTHY_SOURCE.replace("duringUpdateFrom", "x") })).toContain(
      "guard.attribution-intact",
    );
    expect(rules({ measurementSource: HEALTHY_SOURCE.replace(PUSH_CAUSES[1], "x") })).toContain(
      "guard.attribution-intact",
    );
  });

  it("guard.lifecycle-driven — دورةُ الحياةِ مقطوعةٌ", () => {
    expect(rules({ measurementSource: HEALTHY_SOURCE.replace("ride:complete:", "x") })).toContain(
      "guard.lifecycle-driven",
    );
    expect(rules({ measurementSource: HEALTHY_SOURCE.replace('"completed"', '"x"') })).toContain(
      "guard.lifecycle-driven",
    );
  });

  it("guard.assertion-intact — التأكيدُ مفرَّغٌ أو القياسُ لا يُعلِنُ أنّه جرى", () => {
    expect(
      rules({ measurementSource: HEALTHY_SOURCE.replace("expect(violations).toEqual([]);", "") }),
    ).toContain("guard.assertion-intact");
    expect(
      rules({ measurementSource: HEALTHY_SOURCE.replace("measured: true", "measured: x") }),
    ).toContain("guard.assertion-intact");
  });

  it("guard.kinds-imported — القائمةُ منسوخةٌ لا مستوردةٌ، والعددُ مكتوبٌ", () => {
    expect(
      rules({ measurementSource: HEALTHY_SOURCE.replace("SEEDED_NOTIFICATION_CHANNELS", "x") }),
    ).toContain("guard.kinds-imported");
    expect(
      rules({ measurementSource: HEALTHY_SOURCE.replace(/notification-kinds/g, "x") }),
    ).toContain("guard.kinds-imported");
    const written = HEALTHY_SOURCE.replace(
      "criticalKindCount: declared",
      `criticalKindCount: ${String(defaultInputs().criticalKindCount)}`,
    );
    expect(rules({ measurementSource: written })).toContain("guard.kinds-imported");
  });

  it("guard.classification-guard — سندُ القائمةِ المغلقةِ خارجَ سلسلةِ ci", () => {
    expect(
      rules({ ...healthy(), packageJson: '{"scripts":{"ci":"check-telegram-message-budget"}}' }),
    ).toContain("guard.classification-guard");
  });

  it("guard.self-enforced — الحاجزُ نفسُه خارجَ سلسلةِ ci", () => {
    expect(
      rules({
        ...healthy(),
        packageJson: '{"scripts":{"ci":"check-notification-classification"}}',
      }),
    ).toContain("guard.self-enforced");
    expect(rules({ ...healthy(), packageJson: null })).toContain("guard.self-enforced");
  });

  it("guard.budget-sane — سقفٌ أو شكلٌ أو حدٌّ غيرُ صالحٍ", () => {
    expect(rules({ ...healthy(), budget: 0 })).toContain("guard.budget-sane");
    expect(rules({ ...healthy(), judgeRuleCount: 0 })).toContain("guard.budget-sane");
    expect(rules({ ...healthy(), pushCauseCount: 0 })).toContain("guard.budget-sane");
    expect(rules({ ...healthy(), criticalKindCount: 0 })).toContain("guard.budget-sane");
    expect(rules({ ...healthy(), freeRatePerSecond: 0 })).toContain("guard.budget-sane");
    expect(
      rules({ ...healthy(), profile: { ...RIDE_MESSAGE_PROFILE, offeredDriverCount: 0 } }),
    ).toContain("guard.budget-sane");
    expect(
      rules({ ...healthy(), profile: { ...RIDE_MESSAGE_PROFILE, maxReplyBurst: 9 } }),
    ).toContain("guard.budget-sane");
  });

  it("لكلِّ قاعدةِ حاجزٍ مُعلَنةٍ سالبةٌ في هذا الملفِّ — لا اسمَ ميّتٌ", async () => {
    const source = await Bun.file(new URL(import.meta.url)).text();
    for (const rule of GUARD_RULE_NAMES) {
      expect(source.includes(`"${rule}"`)).toBe(true);
    }
  });
});
