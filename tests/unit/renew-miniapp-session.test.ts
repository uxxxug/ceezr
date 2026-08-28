/**
 * الغرض: اختبارُ حالةِ استخدامِ تجديدِ الجلسة (`F1-04`): الترتيبُ «اقرأْ ثمّ
 *   أَصدِرْ»، وأنّه **لا تُنشَأ جلسةٌ من رمزِ تجديدٍ غيرِ صالح** إطلاقاً، وأنّ
 *   الرموزَ العامّةَ للرفضِ محدودةٌ وحتميّة، وأنّ الرمزَ الخامَّ لا يظهر في سجلٍّ
 *   ولا في رسالةِ خطأ، وأنّ رمزَ الوصولِ يبقى ٦٠٠ ثانيةً بمعرّفِ الجلسةِ نفسِه.
 * الحالة: اختبار فعلي — مُصدِراتٌ حقيقيّةٌ ومُزدوجٌ يشهد على الترتيب.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: تحديدُ الدورِ (`role`) وحدُّ المعدّلِ ليسا في هذه الحالةِ ولا
 *   يُدَّعى تنفيذُهما.
 */

import { describe, expect, it } from "bun:test";
import {
  exchangeTelegramSession,
  type MiniAppSessionGrantIssuer,
  type MiniAppSessionRenewalGrant,
  type PublicRenewRejectionCode,
  renewMiniAppSession,
  type TelegramIdentityProof,
} from "../../packages/application/identity/index.ts";
import {
  createMiniAppRefreshTokens,
  MINIAPP_SESSION_ABSOLUTE_TTL_SECONDS,
} from "../../packages/infrastructure/identity/miniapp-refresh.ts";
import {
  createMiniAppSessionIssuer,
  MINIAPP_SESSION_TTL_SECONDS,
  readMiniAppSession,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import { createTelegramInitDataVerifier } from "../../packages/infrastructure/identity/telegram-init-data.ts";
import {
  buildInitData,
  FAKE_DRIVER_BOT_TOKEN,
  SAMPLE_USER,
} from "../support/telegram-init-data.ts";

const SECRET = "test-only-session-signing-secret-0123456789";
const NOW_MS = Date.UTC(2027, 0, 15, 10, 0, 0);

const PROOF: TelegramIdentityProof = {
  telegramUserId: "5550001",
  bot: "driver",
  authDateSeconds: Math.floor(NOW_MS / 1000) - 1,
};

interface Harness {
  readonly logs: { message: string; meta: Record<string, unknown> }[];
  readonly grants: MiniAppSessionRenewalGrant[];
  readonly deps: Parameters<typeof renewMiniAppSession>[1];
  readonly refresh: ReturnType<typeof createMiniAppRefreshTokens>;
}

function harness(nowMs: number): Harness {
  const logs: { message: string; meta: Record<string, unknown> }[] = [];
  const grants: MiniAppSessionRenewalGrant[] = [];
  const refresh = createMiniAppRefreshTokens({ secret: SECRET });
  const real = createMiniAppSessionIssuer({ secret: SECRET });
  // مُزدوجٌ يشهد على الترتيب: كلُّ نداءِ إصدارٍ يُسجَّل، فإن سُجِّل نداءٌ في حالةِ
  // رفضٍ فقد أُصدِرت جلسةٌ من رمزٍ لم يُقبَل — وهو ما يمنعه البند نصّاً.
  const spy: MiniAppSessionGrantIssuer = {
    issueForGrant(grant, at) {
      grants.push(grant);
      return real.issueForGrant(grant, at);
    },
  };
  return {
    logs,
    grants,
    refresh,
    deps: {
      refresh,
      issuer: spy,
      now: () => new Date(nowMs),
      log: (message, meta) => logs.push({ message, meta }),
    },
  };
}

function newSessionToken(nowMs = NOW_MS): { token: string; sessionId: string } {
  const refresh = createMiniAppRefreshTokens({ secret: SECRET });
  const issued = refresh.issueForNewSession(PROOF, nowMs);
  if (!issued.ok) throw new Error("إصدار فاشل");
  return { token: issued.value.refresh.refreshToken, sessionId: issued.value.grant.sessionId };
}

describe("تجديد جلسة التطبيق المصغَّر (F1-04)", () => {
  it("١) رمزُ تجديدٍ صالحٍ يُنتِج رمزَ وصولٍ جديداً ورمزَ تجديدٍ جديداً", async () => {
    const at = NOW_MS + 300_000;
    const h = harness(at);
    const { token, sessionId } = newSessionToken();

    const result = await renewMiniAppSession({ refreshToken: token }, h.deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.session.expiresInSeconds).toBe(MINIAPP_SESSION_TTL_SECONDS);
    expect(result.value.session.tokenType).toBe("Bearer");
    expect(result.value.sessionId).toBe(sessionId);
    expect(result.value.refresh.refreshToken).not.toBe(token);

    // رمزُ الوصولِ الجديدُ يُقرأ بالمفتاحِ نفسِه، ومعرّفُ الجلسةِ محفوظٌ فيه.
    const read = readMiniAppSession(result.value.session.accessToken, SECRET, at);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.telegramUserId).toBe("5550001");
    expect(read.value.bot).toBe("driver");
    expect(read.value.sessionId).toBe(sessionId);
  });

  it("٢) التجديدُ بعدَ انتهاءِ رمزِ الوصولِ ينجح", async () => {
    // بعدَ ٧٠٠ ثانيةٍ رمزُ الوصولِ (٦٠٠ث) منتهٍ ورمزُ التجديدِ (٣٦٠٠ث) قائم:
    // هذه هي الحالةُ العاديّةُ التي وُجِد التجديدُ لها، لا حالةٌ استثنائيّة.
    const at = NOW_MS + 700_000;
    const h = harness(at);
    const { token } = newSessionToken();

    const expiredAccess = createMiniAppSessionIssuer({ secret: SECRET }).issue(PROOF, NOW_MS);
    if (!expiredAccess.ok) throw new Error("إصدار فاشل");
    expect(readMiniAppSession(expiredAccess.value.accessToken, SECRET, at).ok).toBe(false);

    const result = await renewMiniAppSession({ refreshToken: token }, h.deps);
    expect(result.ok).toBe(true);
  });

  it("١٢) لا تُنشَأ جلسةٌ من رمزِ تجديدٍ غيرِ صالح — ولا يُنادى المُصدِر", async () => {
    const at = NOW_MS + 1000;
    const cases: readonly [string, PublicRenewRejectionCode][] = [
      ["", "REFRESH_TOKEN_MISSING"],
      ["not-a-token", "REFRESH_TOKEN_MALFORMED"],
      ["wslr1.eyJ2IjoxfQ.bad-signature", "REFRESH_TOKEN_REJECTED"],
      ["wsl1.eyJ2IjoxfQ.sig", "REFRESH_TOKEN_REJECTED"],
    ];
    for (const [token, expected] of cases) {
      const h = harness(at);
      const result = await renewMiniAppSession({ refreshToken: token }, h.deps);
      expect(result.ok, token).toBe(false);
      if (result.ok) continue;
      expect(result.error.publicCode, token).toBe(expected);
      // الشهادةُ الحقيقيّة: لم يُنادَ الإصدارُ قَطُّ.
      expect(h.grants.length, token).toBe(0);
    }
  });

  it("٣) رمزُ تجديدٍ منتهٍ = `SESSION_EXPIRED` بلا إصدار", async () => {
    const at = NOW_MS + 3_601_000;
    const h = harness(at);
    const { token } = newSessionToken();
    const result = await renewMiniAppSession({ refreshToken: token }, h.deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.publicCode).toBe("SESSION_EXPIRED");
    expect(h.grants.length).toBe(0);
  });

  it("١٥) بعدَ السقفِ المطلق = `SESSION_EXPIRED` والعلاجُ تحقّقٌ جديدٌ من تيليجرام", async () => {
    const at = NOW_MS + (MINIAPP_SESSION_ABSOLUTE_TTL_SECONDS + 1) * 1000;
    const h = harness(at);
    // رمزٌ جُدّد قبلَ عشرِ دقائقَ من السقف: مدّتُه قُصَّت عندَ السقف، فلم يبقَ
    // له بعدَه شيءٌ — وهذا معنى أنَّ السقفَ سقفٌ لا مجردُ اسم.
    const original = newSessionToken();
    const originalRead = h.refresh.read(original.token, NOW_MS);
    if (!originalRead.ok) throw new Error("قراءة فاشلة");
    const fresh = h.refresh.issueForRenewal(
      originalRead.value,
      NOW_MS + (MINIAPP_SESSION_ABSOLUTE_TTL_SECONDS - 600) * 1000,
    );
    if (!fresh.ok) throw new Error("تجديد فاشل");

    // ولا يمكن أن يُنشَأ رمزُ وصولٍ بهذا الرمز: بابانِ مغلقانِ لا بابٌ واحد.
    const result = await renewMiniAppSession(
      { refreshToken: fresh.value.refresh.refreshToken },
      h.deps,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.publicCode).toBe("SESSION_EXPIRED");
    expect(h.grants.length).toBe(0);
  });

  it("١٤) التجديدُ المتكرّرُ عبرَ الحالةِ لا يمدّ السقفَ", async () => {
    const first = newSessionToken();
    const firstAbsolute = (() => {
      const read = createMiniAppRefreshTokens({ secret: SECRET }).read(first.token, NOW_MS);
      if (!read.ok) throw new Error("قراءة فاشلة");
      return read.value.absoluteExpiresAtSeconds;
    })();

    let token = first.token;
    for (let step = 1; step <= 5; step += 1) {
      const at = NOW_MS + step * 3_000_000;
      const h = harness(at);
      const result = await renewMiniAppSession({ refreshToken: token }, h.deps);
      expect(result.ok, `خطوة ${step}`).toBe(true);
      if (!result.ok) return;
      expect(result.value.refresh.absoluteExpiresAtMs, `سقف ${step}`).toBe(firstAbsolute * 1000);
      // ومعرّفُ الجلسةِ ثابتٌ: التجديدُ استمرارٌ لجلسةٍ لا إنشاءُ أخرى.
      expect(result.value.sessionId).toBe(first.sessionId);
      token = result.value.refresh.refreshToken;
    }
  });

  it("١٣) لا رمزَ خامّاً في السجلّاتِ ولا في الأخطاء", async () => {
    const at = NOW_MS + 1000;
    const { token } = newSessionToken();
    const forged = `${token.slice(0, -3)}xyz`;

    for (const candidate of [token, forged, "wslr1.tampered.signature"]) {
      const h = harness(at);
      const result = await renewMiniAppSession({ refreshToken: candidate }, h.deps);
      const serializedLogs = JSON.stringify(h.logs);
      expect(serializedLogs).not.toContain(candidate);
      // ولا جزءاً منه: قطعةُ توقيعٍ في سجلٍّ تكفي لتضييقِ التخمين.
      expect(serializedLogs).not.toContain(candidate.slice(0, 24));
      expect(JSON.stringify(result)).not.toContain(candidate);
      // السجلُّ يذكر سبباً مصنَّفاً — وهذا ما يُفيد التشخيصَ بلا كشف.
      expect(h.logs.length).toBeGreaterThan(0);
    }
  });

  it("سرٌّ ناقصٌ على الخادم = تعطيلٌ معلَن لا رفضٌ للعميل", async () => {
    const weak = createMiniAppRefreshTokens({ secret: "short" });
    const logs: { message: string; meta: Record<string, unknown> }[] = [];
    const result = await renewMiniAppSession(
      { refreshToken: "wslr1.a.b" },
      {
        refresh: weak,
        issuer: createMiniAppSessionIssuer({ secret: SECRET }),
        now: () => new Date(NOW_MS),
        log: (message, meta) => logs.push({ message, meta }),
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("SESSION_ISSUE_FAILED");
    expect(result.error.publicCode).toBe("SESSION_NOT_AVAILABLE");
  });

  it("١٦) الرمزُ الجديدُ يعمل، والقديمُ لم يُبطَل — حدٌّ معلَنٌ للتصميمِ بلا حالة", async () => {
    // وصفٌ لا ادّعاء: لا مخزنَ جلساتٍ على الخادم، فلا إبطالَ فوريّ ولا كشفَ
    // لإعادةِ الاستخدام. ما يحدُّ الخطرَ هو ساعةُ الرمزِ و١٢ ساعةُ السقف.
    const at = NOW_MS + 60_000;
    const h = harness(at);
    const { token } = newSessionToken();

    const first = await renewMiniAppSession({ refreshToken: token }, h.deps);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const again = await renewMiniAppSession({ refreshToken: token }, harness(at).deps);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.sessionId).toBe(first.value.sessionId);
    expect(again.value.refresh.absoluteExpiresAtMs).toBe(first.value.refresh.absoluteExpiresAtMs);
  });
});

describe("إنشاء الجلسة يُصدِر رمزَ تجديدٍ عند وصلِ السلسلة (F1-04)", () => {
  it("دورةٌ كاملة: تحقّقٌ من تيليجرام ← جلسةٌ ورمزُ تجديدٍ ← تجديدٌ بلا تيليجرام", async () => {
    // هذا ما يجعل البندَ متكاملاً: رمزُ التجديدِ لا يُصنَع من فراغٍ بل يُولَد مع
    // الجلسةِ بعدَ تحقّقٍ حقيقيٍّ واحدٍ، ثمّ لا يُلمَس تيليجرامُ بعدَه ١٢ ساعة.
    const at = new Date(NOW_MS);
    const refresh = createMiniAppRefreshTokens({ secret: SECRET });
    const issuer = createMiniAppSessionIssuer({ secret: SECRET });
    const initData = buildInitData({
      botToken: FAKE_DRIVER_BOT_TOKEN,
      authDateSeconds: Math.floor(NOW_MS / 1000) - 10,
      user: SAMPLE_USER,
      queryId: "AAH-renew-cycle",
    });

    const created = await exchangeTelegramSession(
      { initData },
      {
        verifier: createTelegramInitDataVerifier({
          bots: [{ name: "driver", token: FAKE_DRIVER_BOT_TOKEN }],
        }),
        issuer,
        refreshChain: { refresh, grantIssuer: issuer },
        now: () => at,
      },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.refresh).toBeDefined();
    const refreshToken = created.value.refresh?.refreshToken;
    if (refreshToken === undefined) return;

    // معرّفُ الجلسةِ واحدٌ في الرمزَين المُصدَرَين معاً.
    const accessRead = readMiniAppSession(created.value.session.accessToken, SECRET, NOW_MS);
    const refreshRead = refresh.read(refreshToken, NOW_MS);
    expect(accessRead.ok && refreshRead.ok).toBe(true);
    if (!accessRead.ok || !refreshRead.ok) return;
    expect(accessRead.value.sessionId).toBe(refreshRead.value.sessionId);
    expect(refreshRead.value.telegramUserId).toBe(String(SAMPLE_USER.id));

    // ثمّ تجديدٌ بعدَ انتهاءِ رمزِ الوصولِ — بلا `initData` ولا نداءِ تيليجرام.
    const later = NOW_MS + 700_000;
    const renewed = await renewMiniAppSession({ refreshToken }, harness(later).deps);
    expect(renewed.ok).toBe(true);
    if (!renewed.ok) return;
    expect(renewed.value.sessionId).toBe(refreshRead.value.sessionId);
    expect(renewed.value.refresh.absoluteExpiresAtMs).toBe(
      refreshRead.value.absoluteExpiresAtSeconds * 1000,
    );
  });

  it("بلا سلسلةِ تجديدٍ يبقى سلوكُ `F1-03` كما هو: جلسةٌ بلا رمزِ تجديد", async () => {
    const at = new Date(NOW_MS);
    const issuer = createMiniAppSessionIssuer({ secret: SECRET });
    const created = await exchangeTelegramSession(
      {
        initData: buildInitData({
          botToken: FAKE_DRIVER_BOT_TOKEN,
          authDateSeconds: Math.floor(NOW_MS / 1000) - 10,
          user: SAMPLE_USER,
          queryId: "AAH-no-chain",
        }),
      },
      {
        verifier: createTelegramInitDataVerifier({
          bots: [{ name: "driver", token: FAKE_DRIVER_BOT_TOKEN }],
        }),
        issuer,
        now: () => at,
      },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.refresh).toBeUndefined();
  });
});
