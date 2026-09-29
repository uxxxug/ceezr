/**
 * الغرض: اختباراتُ سلوكٍ لمنطقِ التوجيهِ في `request-by-service.ts` —
 *   يُثبِتُ أنَّ النصَّ يصلُ إلى `/v1/deliveries` بوصفه `parcelDescription`
 *   حينَ الخدمةُ `delivery`.
 * الحالة: منفَّذ — يُكمِّلُ اختباراتِ توجيهِ التوصيل.
 * ينتمي إلى: tests/unit
 *
 * ## لماذا النقلُ غيرُ مُختبَرٍ هنا
 *
 * لأنَّ `requestRide` (مسارَ النقلِ) لا يقبلُ `apiFetch` مُحقناً — فهو
 * يستوردُه مباشرةً. واختبارُه يحتاجُ mockًّا على مستوى الوحدةِ. أمّا
 * `requestDelivery` فقبلَ `apiFetch` مُحقناً، فيُختبَرُ مباشرةً.
 * وتوجيهُ النقلِ إلى `/v1/rides` مُثبَتٌ بالبنيةِ: `requestByService`
 * لا يُعدِّلُ `requestRide` ولا يُمرِّرُ له `parcelDescription`.
 */

import { describe, expect, it } from "bun:test";
import { requestByService } from "../../apps/miniapp/src/surfaces/rider/search/request-by-service.ts";

/** يُلتقطُ به النداءُ الفعليُّ. */
let capturedPath = "";
let capturedBody: Record<string, unknown> | null = null;

/** mockٌّ لـ `apiFetch` يلتقطُ المسارَ والجسمَ. */
function mockApiFetch(path: string, init: Record<string, unknown>): Promise<unknown> {
  capturedPath = path;
  const body = init.body;
  capturedBody =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  return Promise.resolve({
    ok: true,
    accepted: true,
    orderId: "test-order-id",
    createdAt: "2026-09-29T18:00:00.000Z",
    reused: false,
  });
}

describe("requestByService delivery routing", () => {
  it("routes delivery to /v1/deliveries with parcelDescription", async () => {
    capturedPath = "";
    capturedBody = null;

    await requestByService(
      {
        idempotencyKey: "test-key",
        service: "delivery",
        originLat: 21.4225,
        originLng: 39.8262,
        destinationLat: 21.5896,
        destinationLng: 39.8604,
        notes: "صندوقٌ صغيرٌ",
      },
      mockApiFetch,
    );

    expect(capturedPath).toBe("/v1/deliveries");
    expect(capturedBody).not.toBeNull();
    expect((capturedBody as Record<string, unknown>).parcelDescription).toBe("صندوقٌ صغيرٌ");
  });

  it("does not include service field in delivery body (server sets it)", async () => {
    capturedPath = "";
    capturedBody = null;

    await requestByService(
      {
        idempotencyKey: "test-key",
        service: "delivery",
        originLat: 21.4225,
        originLng: 39.8262,
        destinationLat: 21.5896,
        destinationLng: 39.8604,
        notes: "طرد",
      },
      mockApiFetch,
    );

    expect(capturedBody).not.toBeNull();
    expect("service" in (capturedBody as Record<string, unknown>)).toBe(false);
  });

  it("passes notes as parcelDescription, not as notes field", async () => {
    capturedPath = "";
    capturedBody = null;

    await requestByService(
      {
        idempotencyKey: "test-key",
        service: "delivery",
        originLat: 21.4225,
        originLng: 39.8262,
        destinationLat: 21.5896,
        destinationLng: 39.8604,
        notes: "صندوق كبير",
      },
      mockApiFetch,
    );

    expect((capturedBody as Record<string, unknown>).parcelDescription).toBe("صندوق كبير");
    expect("notes" in (capturedBody as Record<string, unknown>)).toBe(false);
  });

  it("passes empty string as parcelDescription when notes are empty", async () => {
    capturedPath = "";
    capturedBody = null;

    await requestByService(
      {
        idempotencyKey: "test-key",
        service: "delivery",
        originLat: 21.4225,
        originLng: 39.8262,
        destinationLat: 21.5896,
        destinationLng: 39.8604,
        notes: "",
      },
      mockApiFetch,
    );

    expect(capturedPath).toBe("/v1/deliveries");
    expect((capturedBody as Record<string, unknown>).parcelDescription).toBe("");
  });
});
