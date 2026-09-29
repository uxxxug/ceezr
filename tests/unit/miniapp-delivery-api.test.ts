/**
 * الغرض: اختباراتُ وحدةٍ لعميلِ `POST /v1/deliveries` في التطبيقِ المصغَّر —
 *   يُثبِّتُ أنَّ النداءَ يذهبُ إلى المسارِ الصحيحِ ويحملُ الحقولِ الخاصّةَ بالتوصيل.
 * الحالة: منفَّذ — يُكمِّلُ اختباراتِ `F2-05` لخدمةِ التوصيل.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/search
 */

import { beforeEach, describe, expect, it } from "bun:test";
import {
  type ApiFetchFn,
  requestDelivery,
} from "../../apps/miniapp/src/surfaces/rider/search/delivery-api.ts";

/** يُلتقطُ به النداءُ الفعليُّ. */
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

/** mockٌّ لـ `apiFetch` يلتقطُ النداءَ ويعيدُ ردّاً ناجحاً. */
const mockApiFetch: ApiFetchFn = (path, init) => {
  capturedUrl = path;
  capturedMethod = (init.method as string) ?? "GET";
  const body = init.body;
  capturedBody =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  return Promise.resolve(successResponse);
};

describe("Mini App delivery API", () => {
  beforeEach(() => {
    capturedUrl = "";
    capturedMethod = "";
    capturedBody = null;
  });

  it("sends POST to /v1/deliveries", async () => {
    await requestDelivery(
      {
        idempotencyKey: "test-key",
        originLat: 21.4225,
        originLng: 39.8262,
        destinationLat: 21.5896,
        destinationLng: 39.8604,
        parcelDescription: "صندوقٌ صغيرٌ",
      },
      mockApiFetch,
    );

    expect(capturedUrl).toContain("/v1/deliveries");
    expect(capturedMethod).toBe("POST");
  });

  it("includes parcelDescription in body", async () => {
    await requestDelivery(
      {
        idempotencyKey: "test-key",
        originLat: 21.4225,
        originLng: 39.8262,
        destinationLat: 21.5896,
        destinationLng: 39.8604,
        parcelDescription: "صندوقٌ صغيرٌ",
      },
      mockApiFetch,
    );

    expect(capturedBody).not.toBeNull();
    const body = capturedBody as Record<string, unknown>;
    expect(body.parcelDescription).toBe("صندوقٌ صغيرٌ");
    expect(body.originLat).toBe(21.4225);
    expect(body.destinationLat).toBe(21.5896);
  });

  it("omits notes when not provided", async () => {
    await requestDelivery(
      {
        idempotencyKey: "test-key",
        originLat: 21.4225,
        originLng: 39.8262,
        destinationLat: 21.5896,
        destinationLng: 39.8604,
        parcelDescription: "صندوقٌ صغيرٌ",
      },
      mockApiFetch,
    );

    expect(capturedBody).not.toBeNull();
    expect("notes" in (capturedBody as Record<string, unknown>)).toBe(false);
  });

  it("includes notes when provided", async () => {
    await requestDelivery(
      {
        idempotencyKey: "test-key",
        originLat: 21.4225,
        originLng: 39.8262,
        destinationLat: 21.5896,
        destinationLng: 39.8604,
        parcelDescription: "صندوقٌ صغيرٌ",
        notes: "اتركه عند الباب",
      },
      mockApiFetch,
    );

    expect(capturedBody).not.toBeNull();
    expect((capturedBody as Record<string, unknown>).notes).toBe("اتركه عند الباب");
  });

  it("does not include service field (server sets it)", async () => {
    await requestDelivery(
      {
        idempotencyKey: "test-key",
        originLat: 21.4225,
        originLng: 39.8262,
        destinationLat: 21.5896,
        destinationLng: 39.8604,
        parcelDescription: "صندوقٌ صغيرٌ",
      },
      mockApiFetch,
    );

    expect(capturedBody).not.toBeNull();
    expect("service" in (capturedBody as Record<string, unknown>)).toBe(false);
  });
});
