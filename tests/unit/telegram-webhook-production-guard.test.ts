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

/** معالجٌ يتتبّعُ الاستدعاءاتِ — لإثباتِ أنّ الحارسَ يمنعُ الوصولَ إليه. */
function trackingHandler() {
  const calls: unknown[] = [];
  return {
    calls,
    handler: {
      handle: async (_bot: unknown, update: unknown) => {
        calls.push(update);
        return true;
      },
    },
  };
}

/** إيداعٌ صامدٌ مزيفٌ يتتبّعُ الاستدعاءاتِ — لإثباتِ أنّ الحارسَ يمنعُ الإيداعَ. */
function trackingIntake() {
  const enqueueCalls: unknown[] = [];
  const intake: DurableUpdateIntake & TelegramUpdateEnqueuer = {
    claim: async () => ({ outcome: "claimed", claimToken: "tok" }),
    finish: async () => true,
    claimAndEnqueue: async (_bot: unknown, _id: number | bigint, _update: unknown) => {
      enqueueCalls.push(_id);
      return "enqueued";
    },
  };
  return { enqueueCalls, intake };
}

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

describe("حارسُ رفضِ الحمولةِ بلا update_id في الإنتاج (ADR 0054 §٦)", () => {
  function post(app: ReturnType<typeof createTelegramWebhookRoutes>, body: unknown) {
    return app.request(
      new Request("http://localhost/webhook/telegram/driver", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "test-secret",
        },
        body: JSON.stringify(body),
      }),
    );
  }

  it("الإنتاجُ (intake موصول) يرفضُ 400 حمولةً بلا update_id ولا يصلُ المعالجَ ولا الإيداعَ", async () => {
    const { calls: handlerCalls, handler } = trackingHandler();
    const { enqueueCalls, intake } = trackingIntake();
    const app = createTelegramWebhookRoutes(
      baseDeps({ requireDurableIntake: true, intake, handler }),
    );

    const res = await post(app, { message: { text: "/start" } });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "INVALID_UPDATE" });
    expect(handlerCalls).toHaveLength(0);
    expect(enqueueCalls).toHaveLength(0);
  });

  it("الإنتاجُ يرفضُ 400 حمولةً بـ update_id غيرِ صحيحٍ (نصٌّ/سالبٌ) ولا يصلُ المعالجَ", async () => {
    const { calls: handlerCalls, handler } = trackingHandler();
    const { enqueueCalls, intake } = trackingIntake();
    const app = createTelegramWebhookRoutes(
      baseDeps({ requireDurableIntake: true, intake, handler }),
    );

    const res = await post(app, { update_id: "not-a-number", message: { text: "/start" } });

    expect(res.status).toBe(400);
    expect(handlerCalls).toHaveLength(0);
    expect(enqueueCalls).toHaveLength(0);
  });

  it("مسارُ الاختبارِ (بلا intake) يُعالجُ الحمولةَ بلا update_id بلا رفضٍ — السلوكُ المُعلَنُ", async () => {
    const { calls: handlerCalls, handler } = trackingHandler();
    const app = createTelegramWebhookRoutes(baseDeps({ handler }));

    const res = await post(app, { message: { text: "/start" } });

    expect(res.status).toBe(200);
    expect(handlerCalls).toHaveLength(1);
  });
});
