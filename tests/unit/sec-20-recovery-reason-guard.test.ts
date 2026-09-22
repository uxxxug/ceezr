/**
 * الغرض: اختبارُ وحدةٍ لدوالِ `queries.ts` الخاصةِ بـ`SEC-20` — التحققُ من
 *   `isRecoveryDecisionReason` ورفضِ القيمِ غيرِ الصالحةِ.
 * الحالة: منفّذ فعلياً — 2026-09-23.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";

import { isRecoveryDecisionReason } from "../../apps/gateway/src/admin/queries.ts";

describe("SEC-20 — isRecoveryDecisionReason", () => {
  const validReasons = [
    "identity_verified",
    "identity_not_confirmed",
    "insufficient_evidence",
    "telegram_account_lost",
    "duplicate_account",
    "policy_violation",
    "user_request",
  ];

  for (const reason of validReasons) {
    it(`يقبلُ السببَ الصحيحَ: ${reason}`, () => {
      expect(isRecoveryDecisionReason(reason)).toBe(true);
    });
  }

  const invalidReasons = ["", "unknown", "verified", "test", null as unknown as string];

  for (const reason of invalidReasons) {
    it(`يرفضُ السببَ غيرَ الصحيحِ: ${String(reason)}`, () => {
      expect(isRecoveryDecisionReason(reason as string)).toBe(false);
    });
  }
});
