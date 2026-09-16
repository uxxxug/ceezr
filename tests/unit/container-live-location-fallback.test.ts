/**
 * اختباراتُ بوّابةِ الحاويةِ مع إسقاطِ Live Location كمسارٍ رئيسيٍّ (`F4-07`).
 *
 * يُثبِتُ أنَّ المُرحِّلَ (CustomerLiveRelay) لا يُنشَأُ ولا يُشترِكُ افتراضيًّا،
 * وأنَّ خريطةَ `tripId→messageId` (مخزنُ البثِّ) لا تُنشَأُ إلّا معه.
 */

import { describe, expect, it } from "bun:test";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { testConfig } from "../support/config.ts";

describe("F4-07 — إسقاط Live Location كمسارٍ رئيسيٍّ", () => {
  it("المُرحِّلُ `null` حين يكون الاحتياطُ مُعطَّلًا", () => {
    const config = testConfig({
      port: 3991,
      telegramWebhookSecret: "test-secret",
      bootstrapAdminTelegramId: "900000",
    });
    const container = buildContainer(config);
    expect(container.tracking.relay).toBeNull();
  });

  it("المُرحِّلُ يُنشَأُ حين يُفعَّلُ الاحتياطُ", () => {
    const config = testConfig({
      port: 3992,
      telegramWebhookSecret: "test-secret",
      bootstrapAdminTelegramId: "900000",
      liveLocationFallbackEnabled: true,
    });
    const container = buildContainer(config);
    expect(container.tracking.relay).not.toBeNull();
  });

  it("المُرحِّلُ يُنشَأُ حين يُمرَّرُ منفذُ القناةِ في التجاوزاتِ", () => {
    const config = testConfig({
      port: 3993,
      telegramWebhookSecret: "test-secret",
      bootstrapAdminTelegramId: "900000",
    });
    const container = buildContainer(config, {
      liveLocationChannel: {
        start: async () => "msg-test",
        update: async () => true,
        stop: async () => true,
      },
    });
    expect(container.tracking.relay).not.toBeNull();
  });
});
