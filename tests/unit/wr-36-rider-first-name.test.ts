/**
 * الغرض: `WR-36` — رسالتا البوتِ الموجَّهتانِ للسائقِ (اكتمالُ الرحلةِ وطلبُ تقييمِ
 *   الراكب) تعرضانِ الاسمَ الأوّلَ وحدَه من اسمِ الراكبِ، في اللغاتِ الثلاثِ كلِّها —
 *   قرارُ المالكِ 2026-11-03 (WR-32 §5-ج). الاختبارُ **حارسُ انحدارٍ**: لو عادَ
 *   `summary.rider.fullName` إلى الرسالتينِ سقطَ هنا قبلَ أن يصلَ إلى هاتفِ سائقٍ.
 * الحالة: اختبارُ وحدةٍ لتنسيقِ الحوار.
 * ينتمي إلى: tests/unit
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { createMemorySessionStore } from "../../apps/gateway/src/bots/shared/session.ts";
import {
  handleCompleteRide,
  type RatingDialogDependencies,
} from "../../packages/application/bots/rating-dialog.ts";
import type { Sender } from "../../packages/application/bots/types.ts";
import type {
  CompletionSummary,
  RatingPort,
  RideLifecyclePort,
  StartSummary,
} from "../../packages/application/reputation/index.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import type { OrderId } from "../../packages/shared/kernel/index.ts";
import { fixedClock } from "../support/in-memory-ports.ts";

const NOW = new Date("2026-11-03T12:00:00.000Z");
const SENDER: Sender = { telegramUserId: "500", chatId: "500", languageHint: "ar" };
const ORDER = "order-wr36" as OrderId;

const FULL_NAME = "Mona Khalid Al-Harbi";
const FIRST_NAME = "Mona";

let direct: { telegramId: string; text: string }[];
const counterpart = {
  notify: async (telegramId: string, text: string) => {
    direct.push({ telegramId, text });
  },
};

/** حوارٌ بلغةِ سائقٍ معيَّنةٍ واسمِ راكبٍ كاملٍ من ثلاثِ كلمات. */
function ratingDeps(driverLang: string, riderFullName: string): RatingDialogDependencies {
  const start: StartSummary = {
    orderId: ORDER,
    service: "transport",
    pickupLabel: null,
    dropoffLabel: null,
    driver: { telegramId: "500", languageCode: driverLang, fullName: "خالد المطيري" },
    rider: { telegramId: "600", languageCode: "ar", fullName: riderFullName },
  };
  const done: CompletionSummary = { ...start, durationSeconds: 600 };
  return {
    sessions: createMemorySessionStore(fixedClock(NOW)),
    lifecycle: {
      start: async () => ({ ok: true, value: { ok: true, reason: null, summary: start } }),
      complete: async () => ({ ok: true, value: { ok: true, reason: null, summary: done } }),
    } as unknown as RideLifecyclePort,
    ratings: {} as RatingPort,
    counterpart,
  };
}

/** الرسالتانِ الموجَّهتانِ للسائقِ من ردودِ الإنهاء — الرسائلُ للراكبِ تُجمعُ في `direct`. */
async function driverDirectedTexts(
  driverLang: string,
  riderFullName: string,
): Promise<readonly string[]> {
  const replies = await handleCompleteRide(
    ORDER,
    SENDER,
    driverLang,
    ratingDeps(driverLang, riderFullName),
  );
  return replies.map((r) => r.text);
}

beforeEach(() => {
  direct = [];
});

describe("WR-36 — الاسمُ الأوّلُ وحدَه في رسالَي السائقِ (التقييمُ والاكتمال)", () => {
  for (const lang of ["ar", "en", "ur"] as const) {
    it(`اللغةُ ${lang}: الاسمُ الأوّلُ يظهرُ والكاملُ لا يظهرُ في الرسالتين`, async () => {
      const texts = await driverDirectedTexts(lang, FULL_NAME);
      expect(texts).toHaveLength(2);
      for (const text of texts) {
        expect(text).toContain(FIRST_NAME);
        expect(text).not.toContain(FULL_NAME);
        expect(text).not.toContain("Khalid");
        expect(text).not.toContain("Al-Harbi");
      }
    });

    it(`اللغةُ ${lang}: رسالةُ الاكتمالِ تحملُ الأوّلَ وحدَه في خانةِ العميل`, async () => {
      const texts = await driverDirectedTexts(lang, FULL_NAME);
      const completed = texts.find((t) => t.includes(FIRST_NAME));
      expect(completed).toBeDefined();
      // النصُّ المعروضُ للأوّلِ وحدَه لا للاسمِ الكاملِ
      expect(completed?.includes(FIRST_NAME)).toBe(true);
    });

    it(`اللغةُ ${lang}: اسمٌ من كلمةٍ واحدةٍ يظهرُ كما هو`, async () => {
      const texts = await driverDirectedTexts(lang, "سارة");
      for (const text of texts) {
        expect(text).toContain("سارة");
      }
    });

    it(`اللغةُ ${lang}: اسمٌ فارغٌ يُستبدَلُ بكلمةٍ عامّةٍ لا بنصٍّ فارغ`, async () => {
      const texts = await driverDirectedTexts(lang, "");
      const fallback = translate(lang, "rating.rider_name_fallback");
      expect(fallback).not.toBe("");
      for (const text of texts) {
        expect(text).toContain(fallback);
      }
    });
  }

  it("رسائلُ الراكبِ (الأطرافُ الأخرى) لا تتأثر: اسمُ السائقِ الكاملُ باقٍ", async () => {
    await handleCompleteRide(ORDER, SENDER, "ar", ratingDeps("ar", FULL_NAME));
    const riderTexts = direct.map((d) => d.text);
    expect(riderTexts.length).toBeGreaterThan(0);
    for (const text of riderTexts) {
      // رسائلُ الراكبِ تخاطبُ السائقَ باسمِهِ الكاملِ — نطاقُ هذا البندِ رسائلُ السائقِ وحدَها.
      if (text.includes("خالد")) {
        expect(text).toContain("خالد المطيري");
      }
    }
  });
});
