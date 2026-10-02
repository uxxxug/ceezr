import { describe, expect, it } from "bun:test";
import type { MiniAppSessionReader } from "../../packages/application/identity/ports.ts";
import {
  type NotificationPrefsDeps,
  readNotificationPrefs,
  upsertNotificationPrefs,
} from "../../packages/application/safety/notification-prefs.ts";
import type {
  NotificationPrefsReader,
  NotificationPrefsStoreFailure,
  NotificationPrefsWriter,
} from "../../packages/application/safety/ports.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

function makeDeps(overrides: Partial<NotificationPrefsDeps> = {}): NotificationPrefsDeps {
  const noopReader: NotificationPrefsReader = {
    read: async () => ok({ offersEnabled: true, updatesEnabled: true }),
  };
  const noopWriter: NotificationPrefsWriter = {
    upsert: async () => ok({ status: "saved" }),
  };
  const noopSessions = {
    read: async () =>
      ok({
        telegramUserId: "123456789",
        bot: "rider",
        sessionId: "s1",
        issuedAtSeconds: 0,
        expiresAtSeconds: 9999999999,
      }),
  } as unknown as MiniAppSessionReader;
  return {
    sessions: noopSessions,
    reader: noopReader,
    writer: noopWriter,
    now: () => new Date(),
    ...overrides,
  } as NotificationPrefsDeps;
}

describe("DEC-42 read notification prefs", () => {
  it("قراءةُ التفضيلاتِ تُرجِعُها", async () => {
    const reader: NotificationPrefsReader = {
      read: async () => ok({ offersEnabled: false, updatesEnabled: true }),
    };
    const result = await readNotificationPrefs(makeDeps({ reader }), { accessToken: "token" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value?.offersEnabled).toBe(false);
      expect(result.value?.updatesEnabled).toBe(true);
    }
  });

  it("غيابُ الجلسةِ يُرجِعُ SESSION_REQUIRED", async () => {
    const result = await readNotificationPrefs(makeDeps(), { accessToken: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("SESSION_REQUIRED");
  });
});

describe("DEC-42 upsert notification prefs", () => {
  it("حفظُ التفضيلاتِ يُرجِعُ saved", async () => {
    const result = await upsertNotificationPrefs(makeDeps(), {
      accessToken: "token",
      body: { offersEnabled: false, updatesEnabled: true },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("saved");
  });

  it("قيمةٌ غيرُ منطقيّةٍ لِoffersEnabled تُرجِعُ MALFORMED", async () => {
    const result = await upsertNotificationPrefs(makeDeps(), {
      accessToken: "token",
      body: { offersEnabled: "yes", updatesEnabled: true },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("MALFORMED");
  });

  it("قيمةٌ غيرُ منطقيّةٍ لِupdatesEnabled تُرجِعُ MALFORMED", async () => {
    const result = await upsertNotificationPrefs(makeDeps(), {
      accessToken: "token",
      body: { offersEnabled: true, updatesEnabled: "no" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("MALFORMED");
  });

  it("غيابُ الجلسةِ يُرجِعُ SESSION_REQUIRED", async () => {
    const result = await upsertNotificationPrefs(makeDeps(), {
      accessToken: undefined,
      body: { offersEnabled: true, updatesEnabled: true },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("SESSION_REQUIRED");
  });

  it("فشلُ المخزنِ يُرجِعُ NOTIFICATION_PREFS_STORE_NOT_AVAILABLE", async () => {
    const writer: NotificationPrefsWriter = {
      upsert: async () =>
        err({
          code: "NOTIFICATION_PREFS_STORE_FAILED",
          reason: "STORE_ERROR",
        } as NotificationPrefsStoreFailure),
    };
    const result = await upsertNotificationPrefs(makeDeps({ writer }), {
      accessToken: "token",
      body: { offersEnabled: true, updatesEnabled: false },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("NOTIFICATION_PREFS_STORE_NOT_AVAILABLE");
  });
});
