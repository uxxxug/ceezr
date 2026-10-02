import { describe, expect, it } from "bun:test";
import { deletePlace, type PlacesDeps } from "../../packages/application/places/manage-places.ts";
import type {
  PlaceStoreFailure,
  SavedPlaceWriter,
} from "../../packages/application/places/ports.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

/**
 * عقدُ حذفِ مكانٍ محفوظٍ (DEC-39) — اختبارُ السلوكِ:
 *
 * ١. حذفُ مكانٍ موجودٍ يُرجِعُ `deleted`.
 * ٢. معرّفُ UUID غيرُ الصالحِ يُرجِعُ `PLACE_NOT_FOUND`.
 * ٣. غيابُ الجلسةِ يُرجِعُ `SESSION_REQUIRED`.
 * ٤. فشلُ المخزنِ يُرجِعُ `PLACE_STORE_NOT_AVAILABLE`.
 */

function makeDeps(overrides: Partial<PlacesDeps> = {}): PlacesDeps {
  const noopWriter: SavedPlaceWriter = {
    save: async () =>
      err({ code: "PLACE_STORE_FAILED", reason: "NOT_CONFIGURED" } as PlaceStoreFailure),
    delete: async () => ok({ status: "deleted" }),
    update: async () =>
      ok({
        status: "updated",
        place: { id: "test", kind: "home" as const, label: "test", lat: 0, lng: 0, updatedAtMs: 0 },
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

describe("DEC-39 delete saved place contract", () => {
  it("حذفُ مكانٍ موجودٍ يُرجِعُ deleted", async () => {
    const result = await deletePlace(makeDeps(), {
      accessToken: "token",
      placeId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("deleted");
  });

  it("معرّفُ UUID غيرُ الصالحِ يُرجِعُ PLACE_NOT_FOUND", async () => {
    const result = await deletePlace(makeDeps(), {
      accessToken: "token",
      placeId: "not-a-uuid",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("PLACE_NOT_FOUND");
  });

  it("غيابُ الجلسةِ يُرجِعُ SESSION_REQUIRED", async () => {
    const result = await deletePlace(makeDeps(), {
      accessToken: undefined,
      placeId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("SESSION_REQUIRED");
  });

  it("فشلُ المخزنِ يُرجِعُ PLACE_STORE_NOT_AVAILABLE", async () => {
    const failingWriter: SavedPlaceWriter = {
      save: async () =>
        err({ code: "PLACE_STORE_FAILED", reason: "STORE_ERROR" } as PlaceStoreFailure),
      delete: async () =>
        err({ code: "PLACE_STORE_FAILED", reason: "STORE_ERROR" } as PlaceStoreFailure),
      update: async () =>
        err({ code: "PLACE_STORE_FAILED", reason: "STORE_ERROR" } as PlaceStoreFailure),
    };
    const deps = makeDeps({ writer: failingWriter });
    const result = await deletePlace(deps, {
      accessToken: "token",
      placeId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("PLACE_STORE_NOT_AVAILABLE");
  });
});
