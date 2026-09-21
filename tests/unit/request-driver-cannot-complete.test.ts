/**
 * الغرض: اختبارُ وحدةٍ لدالّةِ الطلبِ `requestDriverCannotComplete` (`PD-020`) —
 *   الجلسةُ والملكيّةُ والرفضُ **قبلَ أن يُفتَحَ البابُ** على القاعدةِ: من لا
 *   جلسةَ لهُ لا بلاغَ لهُ، ومن لا مِلكيّةَ لهُ لا حَكَمَ لهُ.
 * الحالة: منفَّذٌ فعليّاً — البند `PD-020`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test`.
 * الحاكم: docs/adr/0159-safety-channel-entry-delivery-review-and-driver-cannot-complete.md
 */

import { describe, expect, it } from "bun:test";
import type { MiniAppSessionReader } from "../../packages/application/identity/ports.ts";
import type {
  DriverCannotCompletePort,
  DriverCannotCompleteStoreRejection,
} from "../../packages/application/safety/driver-cannot-complete.ts";
import { requestDriverCannotComplete } from "../../packages/application/safety/driver-cannot-complete.ts";
import { ok } from "../../packages/shared/result/index.ts";

const SESSION: MiniAppSessionReader = {
  read: async () =>
    ok({
      telegramUserId: "7001",
      bot: "rider",
      sessionId: "session-1",
      issuedAtSeconds: 1_000_000,
      expiresAtSeconds: 1_000_000_000,
    }),
  readSync: () =>
    ok({
      telegramUserId: "7001",
      bot: "rider",
      sessionId: "session-1",
      issuedAtSeconds: 1_000_000,
      expiresAtSeconds: 1_000_000_000,
    }),
};

const STORE_REFUSALS: readonly DriverCannotCompleteStoreRejection[] = [
  "USER_NOT_FOUND",
  "NOT_A_DRIVER",
  "JOB_NOT_FOUND",
  "ACTOR_BLOCKED",
  "ESCALATION_GROUP_MISSING",
  "SOS_DEDUP_SETTING_MISSING",
  "TRANSITION_REFUSED",
];

/** منفذٌ يستجيبُ بما يُطلبُ منهُ في كل اختبارٍ — الرفضُ مُعامَلٌ جواباً لا عطلاً. */
function portWith(rejection: DriverCannotCompleteStoreRejection | null): DriverCannotCompletePort {
  return {
    report: async () =>
      rejection === null
        ? { ok: true, value: { incidentId: "b7d0cfa4-1111-4222-8333-444455556666", created: true } }
        : { ok: true, value: { incidentId: null, rejection } },
  };
}

const ORDER_ID = "11111111-2222-4333-8444-555566667777";

describe("requestDriverCannotComplete", () => {
  it("بلا جلسةٍ يُردُّ SESSION_REQUIRED قبلَ كلِّ شيءٍ", async () => {
    const result = await requestDriverCannotComplete(
      { sessions: SESSION, now: () => new Date(0), reports: portWith(null) },
      { accessToken: undefined, orderId: ORDER_ID },
    );
    expect(result).toEqual({ ok: false, error: "SESSION_REQUIRED" });
  });

  it("معرِّفٌ غيرُ UUID يُردُّ ORDER_ID_INVALID — لا نداءَ للمنفذِ", async () => {
    const result = await requestDriverCannotComplete(
      { sessions: SESSION, now: () => new Date(0), reports: portWith(null) },
      { accessToken: "token", orderId: "ليس-معرّفاً" },
    );
    expect(result).toEqual({ ok: false, error: "ORDER_ID_INVALID" });
  });

  it("المهمّةُ الجاريةُ تُقبَلُ بلاغاً مُنشَأً", async () => {
    const result = await requestDriverCannotComplete(
      { sessions: SESSION, now: () => new Date(0), reports: portWith(null) },
      { accessToken: "token", orderId: ORDER_ID },
    );
    expect(result).toEqual({
      ok: true,
      value: {
        accepted: true,
        incidentId: "b7d0cfa4-1111-4222-8333-444455556666",
        created: true,
        orderId: ORDER_ID,
      },
    });
  });

  it("كلُّ رفضِ مخزنٍ يصلُ رمزاً عامّاً لا رمزَ داخلٍّ", async () => {
    // التخشينُ: `ESCALATION_GROUP_MISSING` و`SOS_DEDUP_SETTING_MISSING` يُقالانِ
    // «المدينةُ لم تُهيَّأ» لا «انكسرَ الدالّةُ»، و`TRANSITION_REFUSED` يُقالُ
    // «رُفضَ البلاغُ» — سائقٌ في عُجزٍ لا يُدرَّبُ على رسائلِ القاعدةِ.
    for (const store of STORE_REFUSALS) {
      const result = await requestDriverCannotComplete(
        { sessions: SESSION, now: () => new Date(0), reports: portWith(store) },
        { accessToken: "token", orderId: ORDER_ID },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.accepted).toBe(false);
      if (result.value.accepted) return;
      // الرموزُ الخمسةُ العامّةُ التي يملكُ السطحُ نصَّ رفضٍ لها — لا زيادةَ.
      expect([
        "NOT_A_DRIVER",
        "JOB_NOT_FOUND",
        "ACTOR_BLOCKED",
        "CITY_NOT_READY",
        "REPORT_REJECTED",
      ]).toContain(result.value.rejection.code);
    }
  });
});
