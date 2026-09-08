/**
 * الغرض: إثباتُ حاجزِ الإقلاعِ للإنتاجِ في `createTelegramWebhookRoutes` (SCL-001).
 * الحالة: اختبار وحدة — لا يتطلّبُ قاعدةً.
 * ينتمي إلى: tests/unit
 * يُتوقّع أن يستخدمه لاحقاً: أيُّ تعديلٍ على شرطِ `requireDurableIntake`.
 *
 * يُثبتُ أنَّ الإنتاجَ لا يُقلعُ بلا إيداعٍ صامدٍ، فلا يصيرَ `dedup` الذاكرةُ
 * مساراً صامتاً (ADR 0054 §٣-أ، ADR 0059).
 */

import { describe, expect, it } from "bun:test";
import {
  createTelegramWebhookRoutes,
  type WebhookDependencies,
} from "../../apps/gateway/src/routes/telegram-webhook.ts";
import type {
  DurableUpdateIntake,
  TelegramUpdateEnqueuer,
} from "../../apps/gateway/src/routes/update-intake.ts";

/** معالجٌ لا يفعلُ شيئاً — يكفي لتعديلِ الاعتماديات. */
const noopHandler = { handle: async () => true };

function baseDeps(overrides: Partial<WebhookDependencies> = {}): WebhookDependencies {
  return {
    webhookSecret: "test-secret",
    handler: noopHandler,
    ...overrides,
  };
}

/** إيداعٌ صامدٌ مزيفٌ — يكفي ليثبتَ أنَّ المصنعَ لا يرمي عند وجوده. */
const fakeIntake: DurableUpdateIntake & TelegramUpdateEnqueuer = {
  claim: async () => ({ outcome: "claimed", claimToken: "tok" }),
  finish: async () => true,
  claimAndEnqueue: async () => "enqueued",
};

describe("createTelegramWebhookRoutes — حاجز الإقلاع للإنتاج (SCL-001)", () => {
  it("يرمي في الإنتاجِ إن غابَ الإيداعُ الصامدُ", () => {
    // requireDurableIntake=true بلا intake: يجب أن يرمي المصنعُ فوراً.
    expect(() => createTelegramWebhookRoutes(baseDeps({ requireDurableIntake: true }))).toThrow(
      /claim_telegram_update/,
    );
  });

  it("لا يرمي في الإنتاجِ متى وُجِدَ الإيداعُ الصامدُ", () => {
    // requireDurableIntake=true مع intake: المصنعُ يُنتجُ التطبيقَ بلا رمي.
    expect(() =>
      createTelegramWebhookRoutes(baseDeps({ requireDurableIntake: true, intake: fakeIntake })),
    ).not.toThrow();
  });

  it("يبقى مسارُ الاختبارِ بلا قاعدةٍ يعملَ بلا رميٍ (توافقٌ مع القائم)", () => {
    // requireDurableIntake غير مضبوطٍ (افتراضي): لا يرمي ولو غابَ intake.
    expect(() => createTelegramWebhookRoutes(baseDeps())).not.toThrow();
  });

  it("لا يكفي تعطيلُ الحاجزِ لتمريرِ الإنتاجِ بلا إيداعٍ — القيمةُ يجب أن تكون true صراحةً", () => {
    // requireDurableIntake=false (ليس الإنتاجَ): لا يرمي حتى لو غابَ intake.
    expect(() =>
      createTelegramWebhookRoutes(baseDeps({ requireDurableIntake: false })),
    ).not.toThrow();
  });
});
