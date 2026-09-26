/**
 * الغرض: السالباتُ المبذورةُ لحَكَمِ عزلِ عطلِ Bot API عن مساراتِ Mini App (`ح-7`).
 *   كلُّ قاعدةٍ تُختبَرُ بنجاحٍ وبفشلٍ: الحَكَمُ الأخضرُ قد يكونُ معطوبًا، فالسالبُ
 *   يكشفُ الكذبةَ.
 * الحالة: منفّذ فعلياً — `ح-7`.
 * ينتمي إلى: tests/unit
 * الحاكم: docs/adr/0198-telegram-bot-api-outage-does-not-block-miniapp.md
 */

import { describe, expect, it } from "bun:test";
import {
  type CommercialSnapshot,
  judgeTelegramOutage,
  type MiniAppCallFacts,
  type TelegramOutageFacts,
  type TelegramSenderState,
} from "../../scripts/lib/telegram-outage.ts";

const HEALTHY_CALL: MiniAppCallFacts = {
  endpoint: "GET /v1/me",
  httpStatus: 200,
  sessionValid: true,
};

const BASELINE: readonly MiniAppCallFacts[] = [
  { ...HEALTHY_CALL, endpoint: "GET /v1/me" },
  { ...HEALTHY_CALL, endpoint: "GET /v1/rides/active" },
  { ...HEALTHY_CALL, endpoint: "POST /v1/safety/sos" },
  { ...HEALTHY_CALL, endpoint: "GET /v1/rides/history" },
];

const DURING_OUTAGE: readonly MiniAppCallFacts[] = [
  { ...HEALTHY_CALL, endpoint: "GET /v1/me" },
  { ...HEALTHY_CALL, endpoint: "GET /v1/rides/active" },
  { ...HEALTHY_CALL, endpoint: "POST /v1/safety/sos" },
  { ...HEALTHY_CALL, endpoint: "GET /v1/rides/history" },
];

const COMMERCIAL: CommercialSnapshot = {
  ordersCount: 1,
  activeRideExists: true,
  pendingOffersCount: 0,
};

const SENDER_OPEN: TelegramSenderState = {
  breakerState: "open",
  failedAttempts: 5,
  guardRejected: true,
  failureReason: "Connection refused",
};

function facts(overrides: Partial<TelegramOutageFacts> = {}): TelegramOutageFacts {
  return {
    baseline: BASELINE,
    duringOutage: DURING_OUTAGE,
    senderState: SENDER_OPEN,
    commercialBefore: COMMERCIAL,
    commercialAfter: COMMERCIAL,
    ...overrides,
  };
}

describe("judgeTelegramOutage", () => {
  describe("النجاحُ الكاملُ", () => {
    it("لا يُدينُ حينَ كلُّ المساراتِ ناجحةٌ والقاطعُ مفتوحٌ والحالةُ سليمةٌ", () => {
      const violations = judgeTelegramOutage(facts());
      expect(violations).toEqual([]);
    });
  });

  describe("miniapp.api-reachable", () => {
    it("يُدينَ مسارًا ردَّ 503 أثناءَ العطلِ", () => {
      const broken: MiniAppCallFacts = {
        endpoint: "GET /v1/rides/active",
        httpStatus: 503,
        sessionValid: true,
      };
      const violations = judgeTelegramOutage(
        facts({ duringOutage: [...BASELINE.slice(0, 1), broken, ...BASELINE.slice(2)] }),
      );
      expect(violations.some((v) => v.rule === "miniapp.api-reachable")).toBe(true);
    });

    it("يُدينَ مسارًا ردَّ 500 أثناءَ العطلِ", () => {
      const broken: MiniAppCallFacts = {
        endpoint: "POST /v1/safety/sos",
        httpStatus: 500,
        sessionValid: true,
      };
      const violations = judgeTelegramOutage(
        facts({ duringOutage: [...BASELINE.slice(0, 2), broken, ...BASELINE.slice(3)] }),
      );
      expect(violations.some((v) => v.rule === "miniapp.api-reachable")).toBe(true);
    });
  });

  describe("miniapp.session-valid", () => {
    it("يُدينَ جلسةً سقطَت أثناءَ العطلِ", () => {
      const broken: MiniAppCallFacts = {
        endpoint: "GET /v1/me",
        httpStatus: 200,
        sessionValid: false,
      };
      const violations = judgeTelegramOutage(
        facts({ duringOutage: [broken, ...BASELINE.slice(1)] }),
      );
      expect(violations.some((v) => v.rule === "miniapp.session-valid")).toBe(true);
    });
  });

  describe("miniapp.baseline-healthy", () => {
    it("يُدينَ خطًّا أساسَ معطوبًا قبلَ العطلِ", () => {
      const broken: MiniAppCallFacts = {
        endpoint: "GET /v1/me",
        httpStatus: 500,
        sessionValid: true,
      };
      const violations = judgeTelegramOutage(facts({ baseline: [broken, ...BASELINE.slice(1)] }));
      expect(violations.some((v) => v.rule === "miniapp.baseline-healthy")).toBe(true);
    });
  });

  describe("commercial.state-intact", () => {
    it("يُدينَ تغيُّرَ عددِ الطلباتِ", () => {
      const violations = judgeTelegramOutage(
        facts({
          commercialAfter: { ...COMMERCIAL, ordersCount: 2 },
        }),
      );
      expect(violations.some((v) => v.rule === "commercial.state-intact")).toBe(true);
    });

    it("يُدينَ زوالَ الرحلةِ النشطةِ", () => {
      const violations = judgeTelegramOutage(
        facts({
          commercialAfter: { ...COMMERCIAL, activeRideExists: false },
        }),
      );
      expect(violations.some((v) => v.rule === "commercial.state-intact")).toBe(true);
    });

    it("يُدينَ تغيُّرَ عددِ العروضِ", () => {
      const violations = judgeTelegramOutage(
        facts({
          commercialAfter: { ...COMMERCIAL, pendingOffersCount: 3 },
        }),
      );
      expect(violations.some((v) => v.rule === "commercial.state-intact")).toBe(true);
    });
  });

  describe("sender.actually-failed", () => {
    it("يُدينَ غيابَ الفشلِ في المُرسِلِ", () => {
      const violations = judgeTelegramOutage(
        facts({
          senderState: {
            ...SENDER_OPEN,
            failedAttempts: 0,
            guardRejected: false,
          },
        }),
      );
      expect(violations.some((v) => v.rule === "sender.actually-failed")).toBe(true);
    });
  });

  describe("breaker.opened", () => {
    it("يُدينَ قاطعًا مغلقًا أثناءَ العطلِ", () => {
      const violations = judgeTelegramOutage(
        facts({
          senderState: { ...SENDER_OPEN, breakerState: "closed" },
        }),
      );
      expect(violations.some((v) => v.rule === "breaker.opened")).toBe(true);
    });

    it("لا يُدينَ قاطعًا نصفَ مفتوحٍ (التعافي قيدُ التجرِبةِ)", () => {
      const violations = judgeTelegramOutage(
        facts({
          senderState: { ...SENDER_OPEN, breakerState: "half-open" },
        }),
      );
      expect(violations.some((v) => v.rule === "breaker.opened")).toBe(true);
    });
  });

  describe("sender.failure-visible", () => {
    it("يُدينَ سببًا غيرَ موثَّقٍ", () => {
      const violations = judgeTelegramOutage(
        facts({
          senderState: { ...SENDER_OPEN, failureReason: null },
        }),
      );
      expect(violations.some((v) => v.rule === "sender.failure-visible")).toBe(true);
    });
  });
});
