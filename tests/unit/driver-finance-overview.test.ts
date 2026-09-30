/**
 * الغرض: إثباتُ أنَّ نموذجَ القراءةِ الماليّةِ للسائقِ (`driverFinanceOverview`)
 *   مُختبَرٌ فعلاً — وأنَّ بطاقةَ `/finance` في البوتِ تَعرضُ المحفظةَ والاعتراضَ
 *   القائمَ لا الاشتراكَ وحدَه.
 *
 *   وهذا الاختبار كُتبَ لأنّ مسحَ المستودعِ كشفَ أنَّ الملفَّ (`PD-041`) كانَ
 *   مرفوعاً بلا اختبارٍ واحدٍ لصالحِهِ (وعدُ الأدلةِ ذكرَ `tests/unit/driver-finance-overview.test.ts`
 *   ولم يُرفَعْ قطُّ)، وأنَّ وصفَ القائمةِ الدائمِ يعدُ «الاشتراك والمحفظة
 *   والاعتراض والاسترداد في موضع واحد» بينما البطاقةُ لا تعرضُ محفظةً ولا
 *   اعتراضًا ولا استردادًا — نموذجُ القراءةِ الذي يجمعُها مبنيٌّ وغيرَ موصولٍ
 *   بالبطاقةِ.
 *
 * الحالة: اختبار وحدة فعلي — لا يحتاج قاعدة ولا شبكة (مزدوجات في الذاكرة).
 * ينتمي إلى: tests/unit
 * الحاكم: ADR 0161 · PD-041
 */

import { describe, expect, it } from "bun:test";
import { driverFinanceOverview } from "../../packages/application/financial/driver-finance-overview.ts";
import type { CitySettings } from "../../packages/domain/policy/entity.ts";
import type { Subscription } from "../../packages/domain/subscription/entity.ts";
import type { CityId, DriverId } from "../../packages/shared/kernel/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const DRIVER: DriverId = "11111111-2222-3333-4444-555555555555" as DriverId;
const CITY: CityId = "99999999-8888-7777-6666-555555555555" as CityId;

function liveSubscription(): Subscription {
  const now = new Date("2026-09-30T00:00:00Z");
  return {
    driverId: DRIVER,
    plan: "both",
    status: "active",
    currentPeriodStart: now,
    currentPeriodEnd: new Date("2026-10-30T00:00:00Z"),
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
  } as unknown as Subscription;
}

function citySettings(): CitySettings {
  return {
    currency: "SAR",
    subscriptionPriceTransport: 30000,
    subscriptionPriceDelivery: 25000,
    subscriptionPriceBoth: 50000,
  } as unknown as CitySettings;
}

describe("PD-041 — نموذجُ القراءةِ الماليّةِ للسائقِ", () => {
  it("يجمعُ الاشتراكَ والعملةَ والمحفظةَ والاعتراضَ القائمَ في بطاقةٍ واحدةٍ", async () => {
    const overview = await driverFinanceOverview(DRIVER, CITY, {
      findLiveSubscription: async () => ok(liveSubscription()),
      citySettings: async () => ok(citySettings()),
      walletBalance: async () =>
        ok({ ok: true, error: null, walletId: "w-1", currency: "SAR", balanceMinor: 4200 }),
      openObjections: async () =>
        ok([{ reference: "DED-7", status: "open", createdAt: "2026-09-29T10:00:00Z" }]),
    });

    expect(overview.ok).toBe(true);
    if (!overview.ok) return;
    const card = overview.value;

    // الاشتراكُ بحالِهِ وخطةٍ ونهايةِ دورةٍ.
    expect(card.subscription?.plan).toBe("both");
    expect(card.subscription?.currentPeriodEnd).toBe("2026-10-30T00:00:00.000Z");

    // سياسةُ الكسبِ من إعداداتِ المدينةِ.
    expect(card.earnings?.currency).toBe("SAR");
    expect(card.earnings?.subscriptionPriceBoth).toBe(50000);

    // المحفظةُ: الرصيدُ الذي وعدتْ به القائمةُ الدائمةُ.
    expect(card.walletBalance?.balanceMinor).toBe(4200);

    // الاعتراضُ القائمُ: تذكرةُ الخصمِ المفتوحةُ.
    expect(card.openObjections).toHaveLength(1);
    expect(card.openObjections[0]?.reference).toBe("DED-7");

    // الاستردادُ: أهليّةٌ مشتقّةٌ من الرصيدِ لا وعدٌ مطلقٌ (ADR 0161: «إن لم
    // يدعم المزودُ الاستردادَ يُسكَت عنه» — فالصمتُ غيابُ المنفذِ لا بيانٌ).
    expect(card.refund?.eligible).toBe(true);
    expect(card.refund?.reason).toBeNull();
  });

  it("غيابُ منفذِ المحفظةِ سكوتٌ لا خطأٌ — والاستردادُ يسكتُ معهُ", async () => {
    const overview = await driverFinanceOverview(DRIVER, CITY, {
      findLiveSubscription: async () => ok(null),
      citySettings: async () => ok(citySettings()),
    });

    expect(overview.ok).toBe(true);
    if (!overview.ok) return;
    expect(overview.value.walletBalance).toBeNull();
    expect(overview.value.refund).toBeNull();
    expect(overview.value.openObjections).toHaveLength(0);
  });

  it("رصيدٌ صفريٌّ يعني استردادًا غيرَ أهلٍ بسببٍ مُسمّى لا وعدًا كاذبًا", async () => {
    const overview = await driverFinanceOverview(DRIVER, CITY, {
      findLiveSubscription: async () => ok(null),
      citySettings: async () => ok(citySettings()),
      walletBalance: async () =>
        ok({ ok: true, error: null, walletId: "w-1", currency: "SAR", balanceMinor: 0 }),
    });

    expect(overview.ok).toBe(true);
    if (!overview.ok) return;
    expect(overview.value.refund?.eligible).toBe(false);
    expect(overview.value.refund?.reason).toBe("no_balance");
  });

  it("فشلُ منفذِ الاشتراكِ يُعادُ صريحًا — لا بطاقةَ نصفَ ماليةٍ", async () => {
    const overview = await driverFinanceOverview(DRIVER, CITY, {
      findLiveSubscription: async () => err(new Error("rpc down")),
      citySettings: async () => ok(citySettings()),
    });
    expect(overview.ok).toBe(false);
  });
});
