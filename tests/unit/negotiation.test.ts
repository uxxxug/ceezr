/**
 * الغرض: اختبار قواعد دورة غير المشتركين نقيّةً: قرار التدوير، حجب الأرقام، إخفاء الموقع،
 *   وأهلية التسجيل. كل حالة هنا حالة نصّ عليها القسم 3.4 من الأمر الحاكم.
 * الحالة: منفّذ فعلياً — المرحلة 2.3.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: بوابة CI (bun test)
 * ملاحظات مستقبلية: عند إضافة سعر متفَق عليه تُضاف حالة «اتفاق بسعر خارج النطاق».
 */

import { describe, expect, test } from "bun:test";
import {
  approximateArea,
  decideRotation,
  hasFreeSlot,
  isEligibleToClaim,
  type NegotiationSnapshot,
  redactPhoneNumbers,
} from "../../packages/domain/dispatch/negotiation.ts";
import { makeCoordinates } from "../../packages/domain/geo/value-objects.ts";
import type { CityId, DriverId, OrderId } from "../../packages/shared/kernel/index.ts";

const NOW = new Date("2026-08-07T10:00:00.000Z");
const PAST = new Date("2026-08-07T09:59:00.000Z");
const FUTURE = new Date("2026-08-07T10:05:00.000Z");

function snapshot(overrides: Partial<NegotiationSnapshot> = {}): NegotiationSnapshot {
  return {
    negotiationId: "neg-1",
    orderId: "order-1" as OrderId,
    cityId: "city-1" as CityId,
    cycle: 1,
    status: "collecting",
    activeClaimId: null,
    activeDriverId: null,
    collectDeadline: FUTURE,
    negotiateDeadline: null,
    ...overrides,
  };
}

const MAX_CYCLES = 3;

describe("decideRotation — قرار العامل لدورة واحدة", () => {
  test("تفاوض جارٍ ومهلته لم تنتهِ: ينتظر ولا يقطع على السائق دوره", () => {
    const decision = decideRotation(
      snapshot({ status: "negotiating", negotiateDeadline: FUTURE, activeClaimId: "c1" }),
      MAX_CYCLES,
      NOW,
    );
    expect(decision.action.kind).toBe("wait");
  });

  test("انتهت مهلة التفاوض بلا اتفاق صريح: ينتقل للسائق التالي", () => {
    const decision = decideRotation(
      snapshot({ status: "negotiating", negotiateDeadline: PAST, activeClaimId: "c1" }),
      MAX_CYCLES,
      NOW,
    );
    expect(decision.action).toEqual({ kind: "advance", reason: "expired" });
  });

  test("نافذة الجمع مفتوحة ولم يضغط أحد: ينتظر", () => {
    const decision = decideRotation(snapshot({ collectDeadline: FUTURE }), MAX_CYCLES, NOW);
    expect(decision.action.kind).toBe("wait");
  });

  test("انتهت نافذة الجمع بلا ضغطة واحدة: يُعاد النشر بدورة تالية", () => {
    const decision = decideRotation(snapshot({ collectDeadline: PAST }), MAX_CYCLES, NOW);
    expect(decision.action).toEqual({ kind: "republish", nextCycle: 2 });
  });

  test("نفد الثلاثة والدورات باقية: يُعاد النشر لا يُصعَّد", () => {
    const decision = decideRotation(snapshot({ status: "exhausted", cycle: 2 }), MAX_CYCLES, NOW);
    expect(decision.action).toEqual({ kind: "republish", nextCycle: 3 });
  });

  test("نفدت الدورة الأخيرة: يُصعَّد لقروب الإسناد", () => {
    const decision = decideRotation(
      snapshot({ status: "exhausted", cycle: MAX_CYCLES }),
      MAX_CYCLES,
      NOW,
    );
    expect(decision.action).toEqual({
      kind: "escalate",
      reason: "unsubscribed_cycles_exhausted",
    });
  });

  test("الاتفاق والإلغاء لا يمسّهما العامل مهما مرّ الوقت", () => {
    for (const status of ["agreed", "cancelled"] as const) {
      const decision = decideRotation(
        snapshot({ status, collectDeadline: PAST, negotiateDeadline: PAST }),
        MAX_CYCLES,
        NOW,
      );
      expect(decision.action.kind).toBe("wait");
    }
  });

  test("المهلة المنتهية تماماً في اللحظة نفسها تُعدّ منتهية لا منتظِرة", () => {
    const decision = decideRotation(
      snapshot({ status: "negotiating", negotiateDeadline: NOW, activeClaimId: "c1" }),
      MAX_CYCLES,
      NOW,
    );
    expect(decision.action.kind).toBe("advance");
  });
});

describe("hasFreeSlot و isEligibleToClaim", () => {
  test("المقعد الثالث متاح والرابع لا", () => {
    expect(hasFreeSlot(2, 3)).toBe(true);
    expect(hasFreeSlot(3, 3)).toBe(false);
  });

  test("من سجّل في هذه الدورة لا يسجّل مرّتين", () => {
    const driver = "d1" as DriverId;
    expect(isEligibleToClaim(driver, [driver], [])).toBe(false);
  });

  test("سائقو الدورة السابقة مباشرةً مستبعدون من التي تليها", () => {
    const driver = "d1" as DriverId;
    expect(isEligibleToClaim(driver, [], [driver])).toBe(false);
    expect(isEligibleToClaim(driver, [], ["d2" as DriverId])).toBe(true);
  });
});

describe("approximateArea — بطاقة القروب لا تكشف باب البيت", () => {
  test("يقرّب الإحداثيات لمنزلتين لا أكثر", () => {
    const point = makeCoordinates(21.42251234, 39.82617891);
    expect(point.ok).toBe(true);
    if (!point.ok) return;
    expect(approximateArea(point.value)).toBe("21.42, 39.83");
  });

  test("نقطتان متجاورتان جداً تعطيان المنطقة نفسها — وهذا هو الغرض", () => {
    const a = makeCoordinates(21.4225, 39.8261);
    const b = makeCoordinates(21.4229, 39.8264);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(approximateArea(a.value)).toBe(approximateArea(b.value));
  });
});

describe("redactPhoneNumbers — منع الالتفاف على قناة التمرير", () => {
  test("يحجب رقم جوال سعودي متّصلاً", () => {
    const out = redactPhoneNumbers("كلمني على 0501234567");
    expect(out.redacted).toBe(1);
    expect(out.text).not.toContain("0501234567");
  });

  test("يحجب الرقم بصيغته الدولية وبفواصل ومسافات", () => {
    const out = redactPhoneNumbers("رقمي +966 50 123 4567 تواصل معي");
    expect(out.redacted).toBe(1);
    expect(out.text).not.toContain("4567");
  });

  test("لا يحجب سعراً ولا وقتاً: الرسائل المشروعة تمرّ كما هي", () => {
    const out = redactPhoneNumbers("السعر 45 ريال وأنا عندك خلال 10 دقائق");
    expect(out.redacted).toBe(0);
    expect(out.text).toBe("السعر 45 ريال وأنا عندك خلال 10 دقائق");
  });

  test("يحجب رقمين في رسالة واحدة ويعدّهما اثنين", () => {
    const out = redactPhoneNumbers("0501234567 أو 0559876543");
    expect(out.redacted).toBe(2);
  });

  test("ثماني خانات تمرّ وتسع تُحجب — الحدّ يُختبر عند حافّته", () => {
    expect(redactPhoneNumbers("12345678").redacted).toBe(0);
    expect(redactPhoneNumbers("123456789").redacted).toBe(1);
  });
});
