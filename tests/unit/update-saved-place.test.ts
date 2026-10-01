import { describe, expect, it } from "bun:test";
import { type PlacesDeps, updatePlace } from "../../packages/application/places/manage-places.ts";
import type {
  PlaceStoreFailure,
  SavedPlaceWriter,
} from "../../packages/application/places/ports.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

/**
 * عقدُ تعديلِ مكانٍ محفوظٍ (DEC-40) — اختبارُ السلوكِ:
 *
 * ١. تعديلُ مكانٍ موجودٍ يُرجِعُ `updated`.
 * ٢. معرّفُ UUID غيرُ الصالحِ يُرجِعُ `PLACE_NOT_FOUND`.
 * ٣. نوعٌ غيرُ معروفٍ يُرجِعُ `UNKNOWN_PLACE_KIND`.
 * ٤. غيابُ الجلسةِ يُرجِعُ `SESSION_REQUIRED`.
 */

function makeDeps(overrides: Partial<PlacesDeps> = {}): PlacesDeps {
  const noopWriter: SavedPlaceWriter = {
    save: async () =>
      err({ code: "PLACE_STORE_FAILED", reason: "NOT_CONFIGURED" } as PlaceStoreFailure),
    delete: async () => ok({ status: "deleted" }),
    update: async () =>
      ok({
        status: "updated",
        place: { id: "test", kind: "home", label: "test", lat: 0, lng: 0, updatedAtMs: 0 },
      }),
  };
  return {
    sessions: {
      read: async () =>
        ok({
          telegramUserId: "123456789",
          role: "rider" as const,
          cityId: null,
          language: "ar" as const,
        }),
    },
    reader: { listForTelegramUser: async () => ok([]) },
    writer: noopWriter,
    recent: { listForTelegramUser: async () => ok([]) },
    now: () => new Date(),
    ...overrides,
  } as PlacesDeps;
}

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

describe("DEC-40 update saved place contract", () => {
  it("تعديلُ مكانٍ موجودٍ يُرجِعُ updated", async () => {
    const result = await updatePlace(makeDeps(), {
      accessToken: "token",
      placeId: VALID_UUID,
      body: { kind: "home", label: "البيت الجديد", lat: 24.5, lng: 39.6 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("updated");
      expect(result.value.place.kind).toBe("home");
    }
  });

  it("معرّفُ UUID غيرُ الصالحِ يُرجِعُ PLACE_NOT_FOUND", async () => {
    const result = await updatePlace(makeDeps(), {
      accessToken: "token",
      placeId: "not-a-uuid",
      body: { kind: "home", label: "test", lat: 24.5, lng: 39.6 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("PLACE_NOT_FOUND");
  });

  it("نوعٌ غيرُ معروفٍ يُرجِعُ UNKNOWN_PLACE_KIND", async () => {
    const result = await updatePlace(makeDeps(), {
      accessToken: "token",
      placeId: VALID_UUID,
      body: { kind: "gym", label: "test", lat: 24.5, lng: 39.6 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("UNKNOWN_PLACE_KIND");
  });

  it("غيابُ الجلسةِ يُرجِعُ SESSION_REQUIRED", async () => {
    const result = await updatePlace(makeDeps(), {
      accessToken: undefined,
      placeId: VALID_UUID,
      body: { kind: "home", label: "test", lat: 24.5, lng: 39.6 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("SESSION_REQUIRED");
  });
});
