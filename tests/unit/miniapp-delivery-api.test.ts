/**
 * الغرض: اختباراتُ وحدةٍ لعميلِ `POST /v1/deliveries` في التطبيقِ المصغَّر —
 *   يُثبِّتُ أنَّ النداءَ يذهبُ إلى المسارِ الصحيحِ ويحملُ الحقولِ الخاصّةَ بالتوصيل.
 * الحالة: منفَّذ — يُكمِّلُ اختباراتِ `F2-05` لخدمةِ التوصيل.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/search
 */

import { describe, expect, it, beforeEach } from "bun:test";
import { requestDelivery } from "../../apps/miniapp/src/surfaces/rider/search/delivery-api.ts";
import { setSession } from "../../apps/miniapp/src/identity/session.ts";

/** يُلتقطُ به النداءُ الفعليُّ إلى fetch. */
let capturedUrl = "";
let capturedMethod = "";
let capturedBody: Record<string, unknown> | null = null;

const successResponse = {
  ok: true,
  accepted: true,
  orderId: "test-order-id",
  createdAt: "2026-09-29T18:00:00.000Z",
  reused: false,
};

function mockFetch(): typeof fetch {
  return ((url: URL | string, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    capturedUrl = u;
    capturedMethod = init?.method ?? "";
    capturedBody = init?.body ? JSON.parse(init.body as string) : null;
    return Promise.resolve(
      new Response(JSON.stringify(successResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
}

describe("Mini App delivery API", () => {
  beforeEach(() => {
    capturedUrl = "";
    capturedMethod = "";
    capturedBody = null;
    globalThis.fetch = mockFetch();
    setSession({
      accessToken: "test-access-token",
      expiresAt: Date.now() + 3600_000,
    });
  });

  it("sends POST to /v1/deliveries", async () => {
    await requestDelivery({
      idempotencyKey: "test-key",
      originLat: 21.4225,
      originLng: 39.8262,
      destinationLat: 21.5896,
      destinationLng: 39.8604,
      parcelDescription: "صندوقٌ صغيرٌ",
    });

    expect(capturedUrl).toContain("/v1/deliveries");
    expect(capturedMethod).toBe("POST");
  });

  it("includes parcelDescription in body", async () => {
    await requestDelivery({
      idempotencyKey: "test-key",
      originLat: 21.4225,
      originLng: 39.8262,
      destinationLat: 21.5896,
      destinationLng: 39.8604,
      parcelDescription: "صندوقٌ صغيرٌ",
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.parcelDescription).toBe("صندوقٌ صغيرٌ");
    expect(capturedBody!.originLat).toBe(21.4225);
    expect(capturedBody!.destinationLat).toBe(21.5896);
  });

  it("omits notes when not provided", async () => {
    await requestDelivery({
      idempotencyKey: "test-key",
      originLat: 21.4225,
      originLng: 39.8262,
      destinationLat: 21.5896,
      destinationLng: 39.8604,
      parcelDescription: "صندوقٌ صغيرٌ",
    });

    expect(capturedBody).not.toBeNull();
    expect("notes" in capturedBody!).toBe(false);
  });

  it("includes notes when provided", async () => {
    await requestDelivery({
      idempotencyKey: "test-key",
      originLat: 21.4225,
      originLng: 39.8262,
      destinationLat: 21.5896,
      destinationLng: 39.8604,
      parcelDescription: "صندوقٌ صغيرٌ",
      notes: "اتركه عند الباب",
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.notes).toBe("اتركه عند الباب");
  });

  it("does not include service field (server sets it)", async () => {
    await requestDelivery({
      idempotencyKey: "test-key",
      originLat: 21.4225,
      originLng: 39.8262,
      destinationLat: 21.5896,
      destinationLng: 39.8604,
      parcelDescription: "صندوقٌ صغيرٌ",
    });

    expect(capturedBody).not.toBeNull();
    expect("service" in capturedBody!).toBe(false);
  });
});
