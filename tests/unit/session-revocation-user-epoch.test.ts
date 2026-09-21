/**
 * الغرض: قياسُ **عتبةِ إبطالِ المستخدمِ** (`SEC-18-ب`) في الموضعَينِ اللذَينِ
 *   بلا أحدِهما يصيرُ الإبطالُ تأخيرَ دقائقَ: قارئُ رمزِ الوصولِ، **ومسارُ
 *   التجديدِ**. وقياسُ أنَّ معجمَ الأسبابِ لا ينحرفُ عن نصِّ الهجرةِ.
 * الحالة: اختبارٌ فعليٌّ — مُصدِراتٌ ومخزنٌ حقيقيّانِ، ونصُّ الهجرةِ يُقرأُ من القرصِ.
 * ينتمي إلى: tests/unit
 * يُتوقَّعُ أن يستخدمَهُ: CI
 * الحاكم: ADR 0174
 *
 * ## وما تُبرهِنُهُ الحالةُ الرابعةُ خاصّةً
 *
 * لو فُحِصَت العتبةُ في القارئِ وحدَهُ لبقِيَ الإبطالُ **قابلاً للتخطّي بتجديدٍ
 * واحدٍ**: التجديدُ يسكُّ رمزاً بـ`iat` لحظيٍّ فيصيرُ أحدثَ منَ العتبةِ ويمرُّ.
 * فهذه الحالةُ ليست تحسيناً بل شرطُ صحّةِ البندِ.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  type MiniAppSessionGrantIssuer,
  renewMiniAppSession,
  type TelegramIdentityProof,
  type VerifiedViewerSession,
} from "../../packages/application/identity/index.ts";
import type { MiniAppSessionReader } from "../../packages/application/identity/ports.ts";
import { SESSION_REVOCATION_REASONS } from "../../packages/application/identity/session-revocation-reasons.ts";
import { createMemorySessionRevocationStore } from "../../packages/infrastructure/identity/memory-session-revocation-store.ts";
import {
  createMiniAppRefreshTokens,
  MINIAPP_SESSION_ABSOLUTE_TTL_SECONDS,
} from "../../packages/infrastructure/identity/miniapp-refresh.ts";
import { createMiniAppSessionIssuer } from "../../packages/infrastructure/identity/miniapp-session.ts";
import { createRevocableSessionReader } from "../../packages/infrastructure/identity/revocable-session-reader.ts";
import { ok, type Result } from "../../packages/shared/result/index.ts";

const SECRET = "test-only-session-signing-secret-0123456789";
const NOW_MS = Date.UTC(2027, 0, 15, 10, 0, 0);
const USER = "5550001";

const PROOF: TelegramIdentityProof = {
  telegramUserId: USER,
  bot: "driver",
  authDateSeconds: Math.floor(NOW_MS / 1000) - 1,
};

/** قارئٌ يُعيدُ جلسةً بلحظةِ إصدارٍ مُعيَّنةٍ — فتُقاسَ العتبةُ وحدَها. */
function readerIssuedAt(issuedAtMs: number): MiniAppSessionReader {
  const session: VerifiedViewerSession = {
    telegramUserId: USER,
    bot: "driver",
    sessionId: "session-abc",
    issuedAtSeconds: Math.floor(issuedAtMs / 1000),
    expiresAtSeconds: Math.floor(issuedAtMs / 1000) + 600,
  };
  const outcome: Result<VerifiedViewerSession, never> = ok(session);
  return {
    read: async () => outcome,
    readSync: () => outcome,
  };
}

describe("عتبةُ إبطالِ المستخدمِ (SEC-18-ب)", () => {
  it("١) رمزٌ أُصدِرَ قبلَ العتبةِ يُرفَضُ REVOKED", async () => {
    const store = createMemorySessionRevocationStore();
    const issuedAt = NOW_MS - 60_000;
    const revoked = await store.revokeAllForUser(USER, NOW_MS, 43_200, "stolen_device");
    expect(revoked.ok).toBe(true);

    const reader = createRevocableSessionReader(readerIssuedAt(issuedAt), store);
    const result = await reader.read("token", NOW_MS);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("REVOKED");
  });

  it("٢) رمزٌ أُصدِرَ بعدَ العتبةِ يُقبَلُ — فالإبطالُ لا يمنعُ دخولاً جديداً", async () => {
    const store = createMemorySessionRevocationStore();
    await store.revokeAllForUser(USER, NOW_MS, 43_200, "stolen_device");

    const reader = createRevocableSessionReader(readerIssuedAt(NOW_MS + 5_000), store);
    const result = await reader.read("token", NOW_MS + 5_000);

    expect(result.ok).toBe(true);
  });

  it("٣) مستخدمٌ آخرُ لا تمسُّهُ عتبةُ غيرِه", async () => {
    const store = createMemorySessionRevocationStore();
    await store.revokeAllForUser("9999999", NOW_MS, 43_200, "stolen_device");

    const reader = createRevocableSessionReader(readerIssuedAt(NOW_MS - 60_000), store);
    const result = await reader.read("token", NOW_MS);

    expect(result.ok).toBe(true);
  });

  it("٤) التجديدُ بعدَ العتبةِ يُرفَضُ — ولا يُنادى المُصدِرُ أصلاً", async () => {
    const store = createMemorySessionRevocationStore();
    const refresh = createMiniAppRefreshTokens({ secret: SECRET });
    const real = createMiniAppSessionIssuer({ secret: SECRET });
    const issuedGrants: unknown[] = [];
    const spy: MiniAppSessionGrantIssuer = {
      issueForGrant(grant, at) {
        issuedGrants.push(grant);
        return real.issueForGrant(grant, at);
      },
    };

    const opened = refresh.issueForNewSession(PROOF, NOW_MS);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    // العتبةُ تُضرَبُ بعدَ بدءِ الجلسةِ — فسلسلةُ تجديدِها كلُّها ميّتةٌ.
    await store.revokeAllForUser(USER, NOW_MS + 10_000, 43_200, "credential_compromise");

    const at = NOW_MS + 300_000;
    const result = await renewMiniAppSession(
      { refreshToken: opened.value.refresh.refreshToken },
      {
        refresh,
        issuer: spy,
        revocation: store,
        now: () => new Date(at),
      },
    );

    expect(result.ok).toBe(false);
    // لا إصدارَ: لو نُودِيَ المُصدِرُ لكانَ الإبطالُ تأخيرَ دقائقَ لا إبطالاً.
    expect(issuedGrants).toHaveLength(0);
  });

  it("٥) جلسةٌ بدأت بعدَ العتبةِ تُجدَّدُ بلا مانعٍ", async () => {
    const store = createMemorySessionRevocationStore();
    const refresh = createMiniAppRefreshTokens({ secret: SECRET });
    const issuer = createMiniAppSessionIssuer({ secret: SECRET });

    await store.revokeAllForUser(USER, NOW_MS, 43_200, "user_request");

    const startedAfter = NOW_MS + 60_000;
    const opened = refresh.issueForNewSession(PROOF, startedAfter);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const result = await renewMiniAppSession(
      { refreshToken: opened.value.refresh.refreshToken },
      {
        refresh,
        issuer,
        revocation: store,
        now: () => new Date(startedAfter + 300_000),
      },
    );

    expect(result.ok).toBe(true);
  });

  it("٦) بدءُ الجلسةِ يُحسَبُ من السقفِ المطلقِ لا من رمزِ التجديدِ المُدوَّرِ", () => {
    const refresh = createMiniAppRefreshTokens({ secret: SECRET });
    const opened = refresh.issueForNewSession(PROOF, NOW_MS);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const grant = opened.value.grant;
    expect(grant.absoluteExpiresAtSeconds - grant.startedAtSeconds).toBe(
      MINIAPP_SESSION_ABSOLUTE_TTL_SECONDS,
    );
    expect(grant.startedAtSeconds).toBe(Math.floor(NOW_MS / 1000));
  });

  it("٧) معجمُ الأسبابِ في الشيفرةِ يُطابِقُ نصَّ الهجرةِ حرفاً", () => {
    const sql = readFileSync(
      "supabase/migrations/20260922010000_sec_18_admin_revoke_miniapp_sessions.sql",
      "utf8",
    );
    /*
     * يُقرأُ نطاقُ `not in (…)` من الهجرةِ نفسِها: الفحصُ في موضعَينِ (المسلكِ
     * والقاعدةِ) والانحرافُ بينَهما **محروسٌ لا مأمولٌ**.
     */
    const clause = sql.slice(sql.indexOf("p_reason not in ("));
    const body = clause.slice(0, clause.indexOf(")"));
    const inMigration = [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();

    expect(inMigration).toEqual([...SESSION_REVOCATION_REASONS].sort());
    expect(inMigration.length).toBeGreaterThan(0);
  });
});
