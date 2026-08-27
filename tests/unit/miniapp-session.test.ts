/**
 * الغرض: اختبارُ إصدارِ الجلسةِ الداخليةِ وقراءتِها — الانتهاءُ الصريح، ورفضُ
 *   العبثِ بالحِمل، ورفضُ سرٍّ ناقصٍ أو قصير، وألّا يحمل الرمزُ سرَّ التوقيع.
 * الحالة: اختبار فعلي — لا شبكةَ ولا قاعدة: توقيعٌ متماثلٌ في العملية نفسها.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI، ثم البند `F1-04` عند بناءِ التجديدِ والإبطال.
 * ملاحظات مستقبلية: الاستمرارُ والإبطالُ ليسا مُختبَرين ههنا لأنّهما غيرُ منفَّذين
 *   ولا هما من نطاقِ `F1-03`.
 */

import { describe, expect, it } from "bun:test";
import type { TelegramIdentityProof } from "../../packages/application/identity/ports.ts";
import {
  createMiniAppSessionIssuer,
  MINIAPP_SESSION_SECRET_MIN_LENGTH,
  MINIAPP_SESSION_TTL_SECONDS,
  readMiniAppSession,
  type SessionReadRejection,
} from "../../packages/infrastructure/identity/miniapp-session.ts";

const SECRET = "test-only-session-signing-secret-0123456789";
const NOW_MS = 1_800_000_000_000;

const PROOF: TelegramIdentityProof = {
  telegramUserId: "8100200300",
  bot: "driver",
  authDateSeconds: Math.floor(NOW_MS / 1000) - 5,
  username: "noura_test",
  firstName: "نورة",
};

function issuer(options: { ttlSeconds?: number; secret?: string } = {}) {
  return createMiniAppSessionIssuer({
    secret: options.secret ?? SECRET,
    ...(options.ttlSeconds === undefined ? {} : { ttlSeconds: options.ttlSeconds }),
    newSessionId: () => "0123456789abcdef0123456789abcdef",
  });
}

function issued(options: { ttlSeconds?: number } = {}) {
  const result = issuer(options).issue(PROOF, NOW_MS);
  if (!result.ok) throw new Error("توقّعنا إصداراً");
  return result.value;
}

describe("إصدار الجلسة", () => {
  it("يُصدِر رمزاً بانتهاءٍ صريحٍ مطابقٍ للعمرِ المعلَن", () => {
    const session = issued();
    expect(session.tokenType).toBe("Bearer");
    expect(session.expiresInSeconds).toBe(MINIAPP_SESSION_TTL_SECONDS);
    expect(session.expiresAtMs).toBe(NOW_MS + MINIAPP_SESSION_TTL_SECONDS * 1000);
    expect(session.accessToken.split(".").length).toBe(3);
  });

  it("العمرُ الافتراضيُّ قصيرٌ — عشرُ دقائقَ لا أكثر", () => {
    expect(MINIAPP_SESSION_TTL_SECONDS).toBeLessThanOrEqual(600);
  });

  it("لا يُصدِر بسرٍّ غائبٍ أو أقصرَ من الحدّ — يرفض ولا يوقّع بضعيف", () => {
    for (const weak of ["", "قصير", "x".repeat(MINIAPP_SESSION_SECRET_MIN_LENGTH - 1)]) {
      const result = issuer({ secret: weak }).issue(PROOF, NOW_MS);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("توقّعنا رفضاً");
      expect(result.error.reason).toBe("NOT_CONFIGURED");
    }
  });

  it("الرمزُ لا يحمل سرَّ التوقيعِ ولا اسمَ المستخدمِ ولا لغتَه", () => {
    const token = issued().accessToken;
    expect(token).not.toContain(SECRET);
    const payload = Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8");
    expect(payload).not.toContain(SECRET);
    expect(payload).not.toContain("noura_test");
    expect(payload).not.toContain("نورة");
    expect(JSON.parse(payload)).toEqual({
      v: 1,
      sub: "8100200300",
      bot: "driver",
      iat: Math.floor(NOW_MS / 1000),
      exp: Math.floor(NOW_MS / 1000) + MINIAPP_SESSION_TTL_SECONDS,
      jti: "0123456789abcdef0123456789abcdef",
    });
  });
});

describe("قراءة الجلسة", () => {
  it("تقرأ رمزاً صحيحاً وتُعيد موضوعَه ومُعرِّفَه", () => {
    const session = issued();
    const read = readMiniAppSession(session.accessToken, SECRET, NOW_MS);
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error("توقّعنا قبولاً");
    expect(read.value.telegramUserId).toBe("8100200300");
    expect(read.value.bot).toBe("driver");
    expect(read.value.sessionId).toBe("0123456789abcdef0123456789abcdef");
    expect(read.value.expiresAtSeconds).toBe(session.expiresAtMs / 1000);
  });

  it("تقبل قبلَ لحظةِ الانتهاءِ بمقدارِ ثانيةٍ وترفض عندها وبعدها", () => {
    const session = issued({ ttlSeconds: 60 });
    const expiryMs = session.expiresAtMs;
    expect(readMiniAppSession(session.accessToken, SECRET, expiryMs - 1000).ok).toBe(true);
    const atExpiry = readMiniAppSession(session.accessToken, SECRET, expiryMs);
    expect(atExpiry.ok).toBe(false);
    if (atExpiry.ok) throw new Error("توقّعنا رفضاً");
    expect(atExpiry.error).toBe("EXPIRED");
    const after = readMiniAppSession(session.accessToken, SECRET, expiryMs + 3_600_000);
    if (after.ok) throw new Error("توقّعنا رفضاً");
    expect(after.error).toBe("EXPIRED");
  });

  it("ترفض العبثَ بالحِملِ — تمديدُ الانتهاءِ لا يمرّ", () => {
    const session = issued();
    const [prefix, payloadPart, signature] = session.accessToken.split(".") as [
      string,
      string,
      string,
    ];
    const claims = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
    claims.exp += 86_400;
    claims.sub = "999";
    const forged = `${prefix}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${signature}`;
    const read = readMiniAppSession(forged, SECRET, NOW_MS);
    expect(read.ok).toBe(false);
    if (read.ok) throw new Error("توقّعنا رفضاً");
    expect(read.error).toBe("SIGNATURE_MISMATCH");
  });

  it("ترفض توقيعاً بسرٍّ آخر", () => {
    const session = issued();
    const other = readMiniAppSession(session.accessToken, `${SECRET}-different`, NOW_MS);
    if (other.ok) throw new Error("توقّعنا رفضاً");
    expect(other.error).toBe("SIGNATURE_MISMATCH");
  });

  it("ترفض المشوَّهَ والفارغَ وبادئةً غيرَ مدعومة", () => {
    const cases: readonly [string, SessionReadRejection][] = [
      ["", "MALFORMED"],
      ["wsl1", "MALFORMED"],
      ["wsl1.payload", "MALFORMED"],
      ["wsl1..sig", "MALFORMED"],
      ["wsl9.payload.sig", "UNSUPPORTED_VERSION"],
    ];
    for (const [token, expected] of cases) {
      const read = readMiniAppSession(token, SECRET, NOW_MS);
      expect(read.ok).toBe(false);
      if (read.ok) throw new Error("توقّعنا رفضاً");
      expect(read.error).toBe(expected);
    }
  });

  it("ترفض بلا سرٍّ مُهيَّأ ولا تقرأ الحِملَ أصلاً", () => {
    const session = issued();
    const read = readMiniAppSession(session.accessToken, "قصير", NOW_MS);
    if (read.ok) throw new Error("توقّعنا رفضاً");
    expect(read.error).toBe("NOT_CONFIGURED");
  });

  it("سببُ الرفضِ نصٌّ مصنَّفٌ لا يحمل السرَّ ولا الرمز", () => {
    const read = readMiniAppSession(
      `wsl1.${Buffer.from("{}").toString("base64url")}.zzz`,
      SECRET,
      NOW_MS,
    );
    expect(JSON.stringify(read)).not.toContain(SECRET);
    expect(JSON.stringify(read)).not.toContain("zzz");
  });
});
