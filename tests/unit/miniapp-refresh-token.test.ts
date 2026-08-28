/**
 * الغرض: اختبارُ رمزِ التجديدِ نفسِه (`F1-04`): إصدارُه عندَ إنشاءِ الجلسةِ وعندَ
 *   التجديد، وقراءتُه، وكلُّ صنفِ رفض — انتهاءٌ، وسقفٌ مطلق، وتشويهٌ، وتوقيعٌ لا
 *   يطابق، وعبثٌ بكلِّ ادّعاءٍ على حِدَة (`sid` · `iat` · `exp` · `abs` · `gen`).
 *   ويشهد على أنّ **السقفَ المطلقَ لا يمتدُّ بالتجديد** وأنّ الرمزَ لا يحمل بياناً
 *   شخصياً.
 * الحالة: اختبار فعلي — توقيعٌ حقيقيٌّ في العملية، بلا شبكةٍ ولا قاعدة.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: كشفُ إعادةِ الاستخدامِ (`reuse detection`) وإبطالُ رمزٍ بعينِه
 *   يحتاجان حالةً على الخادم، وهي غيرُ موجودةٍ بقرارِ `F1-04` — فلا اختبارَ ههنا
 *   يزعمهما، ولا يُقاس ما لم يُبنَ.
 *
 * الحدُّ المعرفيُّ: المُتحقَّقُ منه هو التشغيلُ — أنّ المُصدِرَ يفعل ما وُصِف. أمّا
 * صلابةُ HMAC-SHA256 فمفترضةٌ لا مُقاسةٌ ههنا.
 */

import { describe, expect, it } from "bun:test";
import type { TelegramIdentityProof } from "../../packages/application/identity/ports.ts";
import {
  createMiniAppRefreshTokens,
  MINIAPP_REFRESH_TTL_SECONDS,
  MINIAPP_SESSION_ABSOLUTE_TTL_SECONDS,
} from "../../packages/infrastructure/identity/miniapp-refresh.ts";

const SECRET = "test-only-session-signing-secret-0123456789";
const OTHER_SECRET = "another-test-only-session-secret-9876543210";
const NOW_MS = Date.UTC(2027, 0, 15, 10, 0, 0);
const NOW_SECONDS = Math.floor(NOW_MS / 1000);

const PROOF: TelegramIdentityProof = {
  telegramUserId: "5550001",
  bot: "rider",
  authDateSeconds: Math.floor(NOW_MS / 1000) - 1,
  username: "sample_user",
  languageCode: "ar",
};

function issuer(overrides: { ttlSeconds?: number; absoluteTtlSeconds?: number } = {}) {
  return createMiniAppRefreshTokens({
    secret: SECRET,
    newSessionId: () => "sid-fixed-0001",
    ...overrides,
  });
}

/** يفكّ الحِمْلَ للفحصِ وحدَه — لا شيءَ في الإنتاجِ يقرأ رمزاً بلا تحقّقٍ من توقيعه. */
function decodePayload(token: string): Record<string, unknown> {
  const part = token.split(".")[1] as string;
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

/** يعيد توقيعَ حِمْلٍ معبوثٍ به بمفتاحٍ صحيح — كي يكون الرفضُ عن الادّعاءِ لا عن التوقيع. */
function resignTampered(
  token: string,
  mutate: (claims: Record<string, unknown>) => void,
  secret = SECRET,
): string {
  const claims = decodePayload(token);
  mutate(claims);
  const payloadPart = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  // نُنتِج توقيعاً صحيحاً بإصدارِ رمزٍ من مُصدِرٍ حقيقيٍّ ثمّ أخذِ مفتاحِه: لا
  // يمكن ذلك من خارج، فنستعمل بدلاً منه مُصدِراً بالسرِّ نفسِه عبرَ طريقٍ داخليّ.
  const { createHmac } = require("node:crypto") as typeof import("node:crypto");
  const key = createHmac("sha256", secret).update("waslah/miniapp/refresh/v1").digest("hex");
  const signature = createHmac("sha256", key).update(`wslr1.${payloadPart}`).digest("base64url");
  return `wslr1.${payloadPart}.${signature}`;
}

describe("رمز تجديد الجلسة (F1-04)", () => {
  it("١) يُصدِر رمزاً صالحاً عند إنشاء الجلسة ويقرؤه", () => {
    const refresh = issuer();
    const issued = refresh.issueForNewSession(PROOF, NOW_MS);
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    expect(issued.value.refresh.refreshExpiresInSeconds).toBe(MINIAPP_REFRESH_TTL_SECONDS);
    expect(issued.value.refresh.absoluteExpiresAtMs).toBe(
      (NOW_SECONDS + MINIAPP_SESSION_ABSOLUTE_TTL_SECONDS) * 1000,
    );
    expect(issued.value.grant.generation).toBe(0);

    const read = refresh.read(issued.value.refresh.refreshToken, NOW_MS);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.telegramUserId).toBe("5550001");
    expect(read.value.sessionId).toBe("sid-fixed-0001");
  });

  it("لا يحمل الرمزُ اسماً ولا لغةً ولا دوراً ولا بياناً شخصياً", () => {
    const issued = issuer().issueForNewSession(PROOF, NOW_MS);
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    const claims = decodePayload(issued.value.refresh.refreshToken);
    expect(Object.keys(claims).sort()).toEqual([
      "abs",
      "bot",
      "exp",
      "gen",
      "iat",
      "sid",
      "sub",
      "v",
    ]);
    const serialized = JSON.stringify(claims);
    expect(serialized).not.toContain("sample_user");
    expect(serialized).not.toContain("ar");
    expect(serialized).not.toContain("role");
  });

  it("٣) رمزُ تجديدٍ منتهٍ يُرفَض", () => {
    const refresh = issuer();
    const issued = refresh.issueForNewSession(PROOF, NOW_MS);
    if (!issued.ok) throw new Error("إصدار فاشل");
    const afterTtl = NOW_MS + (MINIAPP_REFRESH_TTL_SECONDS + 1) * 1000;
    const read = refresh.read(issued.value.refresh.refreshToken, afterTtl);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.error.reason).toBe("EXPIRED");
  });

  it("٤) بلوغُ السقفِ المطلقِ يُرفَض قبلَ النظرِ في انتهاءِ الرمز", () => {
    // مدّةُ رمزٍ أطولُ من السقفِ: القصُّ يجعل `exp === abs`، فالرفضُ عن السقف.
    const refresh = issuer({ ttlSeconds: 200, absoluteTtlSeconds: 100 });
    const issued = refresh.issueForNewSession(PROOF, NOW_MS);
    if (!issued.ok) throw new Error("إصدار فاشل");
    const read = refresh.read(issued.value.refresh.refreshToken, NOW_MS + 101_000);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.error.reason).toBe("ABSOLUTE_EXPIRED");
  });

  it("٥) الرمزُ المشوَّهُ شكلاً يُرفَض", () => {
    const refresh = issuer();
    for (const token of [
      "",
      "wslr1",
      "wslr1.only-two",
      "a.b.c.d",
      "wslr1..sig",
      "wslr1.payload.",
    ]) {
      const read = refresh.read(token, NOW_MS);
      expect(read.ok).toBe(false);
    }
    // بادئةُ رمزِ الوصولِ ليست بادئةَ تجديد: رمزُ وصولٍ لا يُجدِّد جلسةً.
    const wrongPrefix = refresh.read("wsl1.payload.signature", NOW_MS);
    expect(wrongPrefix.ok).toBe(false);
    if (wrongPrefix.ok) return;
    expect(wrongPrefix.error.reason).toBe("UNSUPPORTED_VERSION");
  });

  it("٦) توقيعٌ لا يطابق يُرفَض — ورمزُ سرٍّ آخرَ لا يُقبَل", () => {
    const issued = issuer().issueForNewSession(PROOF, NOW_MS);
    if (!issued.ok) throw new Error("إصدار فاشل");
    const foreign = createMiniAppRefreshTokens({ secret: OTHER_SECRET });
    const read = foreign.read(issued.value.refresh.refreshToken, NOW_MS);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.error.reason).toBe("SIGNATURE_MISMATCH");
  });

  it("٦ب) قلبُ محرفٍ في التوقيعِ يُرفَض", () => {
    const refresh = issuer();
    const issued = refresh.issueForNewSession(PROOF, NOW_MS);
    if (!issued.ok) throw new Error("إصدار فاشل");
    const [prefix, payload, signature] = issued.value.refresh.refreshToken.split(".") as [
      string,
      string,
      string,
    ];
    const flipped = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
    const read = refresh.read(`${prefix}.${payload}.${flipped}`, NOW_MS);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.error.reason).toBe("SIGNATURE_MISMATCH");
  });

  it("٧) العبثُ بالحِمْلِ بلا توقيعٍ صحيحٍ يُرفَض بالتوقيع", () => {
    const refresh = issuer();
    const issued = refresh.issueForNewSession(PROOF, NOW_MS);
    if (!issued.ok) throw new Error("إصدار فاشل");
    const claims = decodePayload(issued.value.refresh.refreshToken);
    claims.abs = (claims.abs as number) + 100_000;
    const forged = `wslr1.${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}.${
      issued.value.refresh.refreshToken.split(".")[2]
    }`;
    const read = refresh.read(forged, NOW_MS);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.error.reason).toBe("SIGNATURE_MISMATCH");
  });

  it("٧ب) العبثُ الموقَّعُ توقيعاً صحيحاً بادّعاءاتٍ متناقضةٍ يُرفَض بالبنية", () => {
    // فرضٌ أقسى: مهاجمٌ يملك السرَّ لا يستفيد من ادّعاءٍ متناقض. والغرضُ إثباتُ
    // أنّ الفحصَ على الادّعاءِ نفسِه لا على التوقيعِ وحدَه.
    const refresh = issuer();
    const issued = refresh.issueForNewSession(PROOF, NOW_MS);
    if (!issued.ok) throw new Error("إصدار فاشل");
    const base = issued.value.refresh.refreshToken;

    const cases: readonly [string, (c: Record<string, unknown>) => void][] = [
      ["exp بعد abs", (c) => (c.exp = (c.abs as number) + 10)],
      ["iat بعد exp", (c) => (c.iat = (c.exp as number) + 10)],
      ["gen سالب", (c) => (c.gen = -1)],
      ["sid فارغ", (c) => (c.sid = "")],
      ["sid غير نصّ", (c) => (c.sid = 12)],
      ["sub فارغ", (c) => (c.sub = "")],
      ["exp غير رقم", (c) => (c.exp = "9999999999")],
      ["abs كسريّ", (c) => (c.abs = 1.5)],
    ];
    for (const [name, mutate] of cases) {
      const read = refresh.read(resignTampered(base, mutate), NOW_MS);
      expect(read.ok, name).toBe(false);
      if (read.ok) continue;
      expect(read.error.reason, name).toBe("MALFORMED");
    }

    // إصدارٌ بنسخةٍ أخرى: لا يُقبَل ولا يُفسَّر.
    const version = refresh.read(
      resignTampered(base, (c) => (c.v = 2)),
      NOW_MS,
    );
    expect(version.ok).toBe(false);
    if (version.ok) return;
    expect(version.error.reason).toBe("UNSUPPORTED_VERSION");
  });

  it("٧ج) تغييرُ `sid` توقيعاً صحيحاً يُنتِج جلسةً أخرى لا امتيازاً", () => {
    // `sid` معرّفٌ لا سلطة: لا يمنح تغييرُه شيئاً، ولا يُدَّعى أنّه يُبطِل الأصل.
    const refresh = issuer();
    const issued = refresh.issueForNewSession(PROOF, NOW_MS);
    if (!issued.ok) throw new Error("إصدار فاشل");
    const swapped = resignTampered(issued.value.refresh.refreshToken, (c) => (c.sid = "sid-other"));
    const read = refresh.read(swapped, NOW_MS);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.sessionId).toBe("sid-other");
    expect(read.value.absoluteExpiresAtSeconds).toBe(
      NOW_SECONDS + MINIAPP_SESSION_ABSOLUTE_TTL_SECONDS,
    );
  });

  it("١٤) تجديدٌ متكرِّرٌ لا يمدّ السقفَ المطلق", () => {
    const refresh = issuer();
    const first = refresh.issueForNewSession(PROOF, NOW_MS);
    if (!first.ok) throw new Error("إصدار فاشل");
    const absolute = first.value.refresh.absoluteExpiresAtMs;

    let grant = first.value.grant;
    let token = first.value.refresh.refreshToken;
    // أحدَ عشرَ تجديداً على مدى ١١ ساعة: مجموعُ مُدَدِ الرموزِ يتجاوز السقفَ
    // بكثير، والسقفُ لا يتزحزح.
    for (let step = 1; step <= 11; step += 1) {
      const at = NOW_MS + step * 3_500_000;
      const read = refresh.read(token, at);
      expect(read.ok, `قراءة ${step}`).toBe(true);
      if (!read.ok) return;
      const next = refresh.issueForRenewal(read.value, at);
      expect(next.ok, `تجديد ${step}`).toBe(true);
      if (!next.ok) return;
      expect(next.value.refresh.absoluteExpiresAtMs, `سقف ${step}`).toBe(absolute);
      expect(next.value.grant.sessionId).toBe(grant.sessionId);
      expect(next.value.grant.generation).toBe(grant.generation + 1);
      grant = next.value.grant;
      token = next.value.refresh.refreshToken;
    }
    expect(decodePayload(token).exp as number).toBeLessThanOrEqual(Math.floor(absolute / 1000));

    // وتجديدٌ في الدقائقِ الأخيرةِ قبلَ السقفِ: الرمزُ يُقَصُّ عندَ السقفِ ولا
    // يتجاوزه — فمدّةُ الساعةِ لا تُمنَح على حسابِ السقف.
    const nearCap = NOW_MS + (MINIAPP_SESSION_ABSOLUTE_TTL_SECONDS - 100) * 1000;
    const clamped = refresh.issueForRenewal(grant, nearCap);
    expect(clamped.ok).toBe(true);
    if (!clamped.ok) return;
    expect(clamped.value.refresh.absoluteExpiresAtMs).toBe(absolute);
    expect(clamped.value.refresh.refreshExpiresInSeconds).toBe(100);
    expect(decodePayload(clamped.value.refresh.refreshToken).exp).toBe(Math.floor(absolute / 1000));
  });

  it("١٥) بعدَ السقفِ المطلق لا يُصدَر رمزٌ جديدٌ برمزِ تجديدٍ فقط", () => {
    const refresh = issuer();
    const first = refresh.issueForNewSession(PROOF, NOW_MS);
    if (!first.ok) throw new Error("إصدار فاشل");
    const past = NOW_MS + (MINIAPP_SESSION_ABSOLUTE_TTL_SECONDS + 1) * 1000;

    // البابُ الأوّل: القراءة.
    const read = refresh.read(first.value.refresh.refreshToken, past);
    expect(read.ok).toBe(false);

    // والبابُ الثاني: الإصدارُ نفسُه، حتى لو نُودي بإذنٍ سليمِ الشكلِ (دفاعٌ مضاعف).
    const forced = refresh.issueForRenewal(first.value.grant, past);
    expect(forced.ok).toBe(false);
    if (forced.ok) return;
    expect(forced.error.reason).toBe("ISSUER_ERROR");
  });

  it("١٦) التجديدُ يُصدِر رمزاً جديداً مختلفاً — والقديمُ يبقى مقروءاً حتى انتهائه", () => {
    // **حدٌّ معلَن**: هذا وصفُ ما يحدث لا ادّعاءُ إبطال. التصميمُ بلا حالةٍ على
    // الخادم، فلا كشفَ لإعادةِ الاستخدامِ ولا إبطالَ فوريّ. والقديمُ يسقط بانتهاءِ
    // مدّتِه أو بالسقفِ المطلقِ، لا بإصدارِ الجديد.
    const refresh = issuer();
    const first = refresh.issueForNewSession(PROOF, NOW_MS);
    if (!first.ok) throw new Error("إصدار فاشل");
    const at = NOW_MS + 60_000;
    const second = refresh.issueForRenewal(first.value.grant, at);
    if (!second.ok) throw new Error("تجديد فاشل");

    expect(second.value.refresh.refreshToken).not.toBe(first.value.refresh.refreshToken);
    const oldStillReadable = refresh.read(first.value.refresh.refreshToken, at);
    expect(oldStillReadable.ok).toBe(true);
    const newReadable = refresh.read(second.value.refresh.refreshToken, at);
    expect(newReadable.ok).toBe(true);
  });

  it("سرٌّ قصيرٌ = تعطيلٌ معلَن لا توقيعٌ ضعيف", () => {
    const weak = createMiniAppRefreshTokens({ secret: "short" });
    const issued = weak.issueForNewSession(PROOF, NOW_MS);
    expect(issued.ok).toBe(false);
    if (issued.ok) return;
    expect(issued.error.reason).toBe("NOT_CONFIGURED");
    const read = weak.read("wslr1.a.b", NOW_MS);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.error.reason).toBe("NOT_CONFIGURED");
  });

  it("مفتاحُ التجديدِ مفصولُ النطاقِ عن مفتاحِ رمزِ الوصول", () => {
    // فصلُ نطاقٍ لا استقلالٌ: المصدرُ سرٌّ واحد، فتسريبُه يُسقِط الاثنين. وما
    // يمنعه الفصلُ هو أن يمرَّ رمزٌ من أحدِ النوعَين مكانَ الآخر.
    const refresh = issuer();
    const issued = refresh.issueForNewSession(PROOF, NOW_MS);
    if (!issued.ok) throw new Error("إصدار فاشل");
    const payloadPart = issued.value.refresh.refreshToken.split(".")[1] as string;
    const { createHmac } = require("node:crypto") as typeof import("node:crypto");
    const naive = createHmac("sha256", SECRET).update(`wslr1.${payloadPart}`).digest("base64url");
    expect(issued.value.refresh.refreshToken.split(".")[2]).not.toBe(naive);
  });
});
