/**
 * الغرض: اختبار مهمة إنهاء مهلة العروض بمزدوجات منافذ، بلا قاعدة بيانات ولا مفاتيح.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: عند وصل المحوّل الحقيقي يُضاف اختبار تكامل على expire_stale_offers نفسها.
 */
import { describe, expect, it } from "bun:test";
import {
  type ExpireOffersRpcPort,
  expireOffers,
  type PendingOfferRepository,
} from "../../apps/workers/src/jobs/expire-offers.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type { Offer } from "../../packages/domain/dispatch/value-objects.ts";
import type { CityId, DriverId, OrderId } from "../../packages/shared/kernel/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";
import {
  failingSettingsRepo,
  fixedClock,
  seededRows,
  settingsRepo,
} from "../support/in-memory-ports.ts";

const CITY = "11111111-1111-1111-1111-111111111111" as CityId;
const NOW = new Date("2026-08-06T12:00:00.000Z");
/** المهلة المبذورة 45 ثانية: عرض أُرسل قبل 60 ثانية منتهٍ، وقبل 10 ثوانٍ ما زال سارياً. */
const SENT_LONG_AGO = new Date(NOW.getTime() - 60_000);
const SENT_RECENTLY = new Date(NOW.getTime() - 10_000);

type StoredOffer = Offer & { readonly id: string };

function offer(id: string, sentAt: Date, status: Offer["status"] = "pending"): StoredOffer {
  return {
    id,
    orderId: `order-${id}` as OrderId,
    driverId: `driver-${id}` as DriverId,
    status,
    sentAt,
    round: 1,
  };
}

function pendingRepo(offers: readonly StoredOffer[]): PendingOfferRepository {
  return {
    findByOrder: async (orderId) => ok(offers.filter((o) => o.orderId === orderId)),
    findPendingInCity: async () => ok(offers),
  };
}

function recordingRpc(result?: number): {
  port: ExpireOffersRpcPort;
  calls: { cityId: CityId; offerIds: readonly string[] }[];
} {
  const calls: { cityId: CityId; offerIds: readonly string[] }[] = [];
  return {
    calls,
    port: {
      expireStaleOffers: async (cityId, offerIds) => {
        calls.push({ cityId, offerIds });
        return ok(result ?? offerIds.length);
      },
    },
  };
}

describe("expireOffers", () => {
  it("ينهي المنتهية فقط ويترك السارية", async () => {
    const rpc = recordingRpc();
    const result = await expireOffers(CITY, {
      offers: pendingRepo([offer("a", SENT_LONG_AGO), offer("b", SENT_RECENTLY)]),
      settings: settingsRepo(seededRows(CITY)),
      rpc: rpc.port,
      clock: fixedClock(NOW),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.examined).toBe(2);
    expect(result.value.expiredIds).toEqual(["a"]);
    expect(result.value.appliedCount).toBe(1);
    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0]?.offerIds).toEqual(["a"]);
  });

  it("لا يستدعي الدالة الذرّية إن لم ينتهِ شيء", async () => {
    const rpc = recordingRpc();
    const result = await expireOffers(CITY, {
      offers: pendingRepo([offer("b", SENT_RECENTLY)]),
      settings: settingsRepo(seededRows(CITY)),
      rpc: rpc.port,
      clock: fixedClock(NOW),
    });
    expect(result.ok).toBe(true);
    expect(rpc.calls).toHaveLength(0);
  });

  it("لا يمسّ عرضاً مقبولاً ولا مرفوضاً مهما طال الزمن", async () => {
    const rpc = recordingRpc();
    const result = await expireOffers(CITY, {
      offers: pendingRepo([
        offer("accepted", SENT_LONG_AGO, "accepted"),
        offer("rejected", SENT_LONG_AGO, "rejected"),
      ]),
      settings: settingsRepo(seededRows(CITY)),
      rpc: rpc.port,
      clock: fixedClock(NOW),
    });
    expect(result.ok && result.value.expiredIds).toEqual([]);
    expect(rpc.calls).toHaveLength(0);
  });

  it("يحترم مهلة المدينة نفسها لا قيمة مرمَّزة", async () => {
    const rpc = recordingRpc();
    // بمهلة 5 ثوانٍ يصبح العرض الحديث (10 ثوانٍ) منتهياً أيضاً
    const result = await expireOffers(CITY, {
      offers: pendingRepo([offer("b", SENT_RECENTLY)]),
      settings: settingsRepo(seededRows(CITY, { offer_timeout_seconds: 5 })),
      rpc: rpc.port,
      clock: fixedClock(NOW),
    });
    expect(result.ok && result.value.expiredIds).toEqual(["b"]);
  });

  it("ينقل فشل قراءة الإعدادات كـ Result لا كاستثناء", async () => {
    const result = await expireOffers(CITY, {
      offers: pendingRepo([]),
      settings: failingSettingsRepo("connection reset"),
      rpc: recordingRpc().port,
      clock: fixedClock(NOW),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PORT_FAILURE");
  });

  it("يفشل بوضوح إن كانت إعدادات المدينة ناقصة", async () => {
    const incomplete = seededRows(CITY).filter((r) => r.key !== "offer_timeout_seconds");
    const result = await expireOffers(CITY, {
      offers: pendingRepo([]),
      settings: settingsRepo(incomplete),
      rpc: recordingRpc().port,
      clock: fixedClock(NOW),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MISSING_SETTING");
  });

  it("ينقل فشل الدالة الذرّية كـ Result", async () => {
    const result = await expireOffers(CITY, {
      offers: pendingRepo([offer("a", SENT_LONG_AGO)]),
      settings: settingsRepo(seededRows(CITY)),
      rpc: {
        expireStaleOffers: async () => err(new PortFailureError("ExpireOffersRpcPort", "deadlock")),
      },
      clock: fixedClock(NOW),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PORT_FAILURE");
  });

  it("يبلّغ العدد الذي طبّقته القاعدة فعلاً لا العدد الذي طلبه", async () => {
    // سائق قبل العرض بين القراءة والكتابة، فالقاعدة أنهت واحداً فقط
    const rpc = recordingRpc(1);
    const result = await expireOffers(CITY, {
      offers: pendingRepo([offer("a", SENT_LONG_AGO), offer("c", SENT_LONG_AGO)]),
      settings: settingsRepo(seededRows(CITY)),
      rpc: rpc.port,
      clock: fixedClock(NOW),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.expiredIds).toHaveLength(2);
    expect(result.value.appliedCount).toBe(1);
  });
});
