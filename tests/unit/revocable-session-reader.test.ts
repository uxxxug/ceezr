/**
 * اختبارُ دخانٍ لقارئِ الجلسةِ القابلِ للإبطالِ (`SEC-18`).
 *
 * الغرض: إثباتٌ سلوكيٌّ لا وجوديٌّ — القارئُ يفحصُ الإبطالَ بعدَ التحقّقِ
 * التشفيريِّ، ويرفضُ الجلسةَ المُبطَلَة، ويفشلُ مُغلقًا حينَ يتعذّرُ المخزن.
 *
 * ينتمي إلى: SEC-18 · ADR 0173
 */

import { describe, expect, it } from "bun:test";
import type {
  MiniAppSessionReader,
  SessionRevocationStore,
  VerifiedViewerSession,
  ViewerSessionRejection,
} from "../../packages/application/identity/ports.ts";
import { createRevocableSessionReader } from "../../packages/infrastructure/identity/revocable-session-reader.ts";
import type { Result } from "../../packages/shared/result/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";
import { createTestRevocationStore } from "../helpers/revocation-store.ts";

const VALID_SESSION: VerifiedViewerSession = {
  telegramUserId: "12345",
  bot: "rider",
  sessionId: "session-abc",
  expiresAtSeconds: 1_000_000,
};

function fakeReader(
  outcome: Result<VerifiedViewerSession, ViewerSessionRejection>,
): MiniAppSessionReader {
  return {
    read: async () => outcome,
    readSync: () => outcome,
  };
}

describe("createRevocableSessionReader", () => {
  it("يقبلُ الجلسةَ الصحيحةَ حينَ لا تكونُ مُبطَلَة", async () => {
    const reader = createRevocableSessionReader(
      fakeReader(ok(VALID_SESSION)),
      createTestRevocationStore(),
    );
    const result = await reader.read("token", Date.now());
    expect(result.ok).toBe(true);
  });

  it("يرفضُ الجلسةَ المُبطَلَة بـ REVOKED", async () => {
    const store = createTestRevocationStore();
    await store.revoke("session-abc", 3600, "security");
    const reader = createRevocableSessionReader(fakeReader(ok(VALID_SESSION)), store);
    const result = await reader.read("token", Date.now());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("REVOKED");
    }
  });

  it("يفشلُ مُغلقًا حينَ يتعذّرُ المخزن", async () => {
    const failingStore: SessionRevocationStore = {
      isRevoked: async () =>
        err({ kind: "STORE_UNAVAILABLE" as const, detail: "connection refused" }),
      revoke: async () => err({ kind: "STORE_UNAVAILABLE" as const, detail: "connection refused" }),
    };
    const reader = createRevocableSessionReader(fakeReader(ok(VALID_SESSION)), failingStore);
    const result = await reader.read("token", Date.now());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("NOT_CONFIGURED");
    }
  });

  it("يمرّر رفضَ التوقيعِ دونَ فحصِ الإبطال", async () => {
    const store = createTestRevocationStore();
    const reader = createRevocableSessionReader(
      fakeReader(err({ code: "SESSION_REJECTED" as const, reason: "SIGNATURE_MISMATCH" as const })),
      store,
    );
    const result = await reader.read("bad-token", Date.now());
    expect(result.ok).toBe(false);
  });

  it("readSync لا يفحصُ الإبطالَ — لمسارِ الاستغاثة", () => {
    const store = createTestRevocationStore();
    // حتى لو أُبطِلَت الجلسة، يفترضُ readSync أنَّها صحيحة
    store.revoke("session-abc", 3600, "security");
    const reader = createRevocableSessionReader(fakeReader(ok(VALID_SESSION)), store);
    const result = reader.readSync("token", Date.now());
    expect(result.ok).toBe(true);
  });
});
