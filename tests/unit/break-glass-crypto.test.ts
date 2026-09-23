/**
 * الغرض: اختبارُ عدَّةِ البابِ الموازي التشفيريّةِ (`SEC-21`) على الحدودِ
 *   التي تُكسَرُ في الواقعِ لا على الأسطرِ التي تعملُ: متجهاتُ RFC 4226/6238
 *   القياسيّةِ، وثباتُ التوقيتِ في البنيةِ المُرمَّزةِ، ودوّارُ التشفيرِ
 *   AES-256-GCM، ورفضُ إعادةِ استعمالِ رمزِ TOTP، وشكلُ رابطِ otpauth.
 * الحالة: منفّذ فعلياً — المرحلة `SEC-21`.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: لا شيء — هذا طرفُ السلسلةِ.
 */

import { describe, expect, test } from "bun:test";

import {
  base32Decode,
  base32Encode,
  breakGlassOtpauthUri,
  decryptTotpSecret,
  deriveAesKey,
  encryptTotpSecret,
  generateTotpSecret,
  hashBreakGlassPassword,
  totpCode,
  totpCounterAt,
  verifyBreakGlassPassword,
  verifyTotp,
} from "../../packages/infrastructure/identity/break-glass-crypto.ts";

// ── scrypt: الدوّارُ والزمنُ الثابتُ ──────────────────────────────────────

describe("scrypt: كلمةُ السرِّ", () => {
  test("الدوّارُ: الهضمُ يتحقَّقُ بكلمتِهِ ويرفضُ غيرَها", () => {
    const hash = hashBreakGlassPassword("كلمةُ سرٍّ طويلةٌ جدًّا");
    expect(verifyBreakGlassPassword("كلمةُ سرٍّ طويلةٌ جدًّا", hash)).toBe(true);
    expect(verifyBreakGlassPassword("كلمةُ سرٍّ طويلةٌ جدًّا ", hash)).toBe(false);
    expect(verifyBreakGlassPassword("wrong-password", hash)).toBe(false);
  });

  test("ملحٌ جديدٌ في كلِّ هضمٍ: نفسُ كلمةِ السرِّ هضمانِ مختلفانِ", () => {
    const a = hashBreakGlassPassword("same-password-123");
    const b = hashBreakGlassPassword("same-password-123");
    expect(a).not.toBe(b);
    expect(verifyBreakGlassPassword("same-password-123", a)).toBe(true);
    expect(verifyBreakGlassPassword("same-password-123", b)).toBe(true);
  });

  test("الصيغةُ المُرمَّزةُ ذاتُها تشرحُ مُعاملاتِها: scrypt:N:r:p:ملح:هضم", () => {
    const parts = hashBreakGlassPassword("pw").split(":");
    expect(parts[0]).toBe("scrypt");
    expect(parts[1]).toBe("16384");
    expect(parts[2]).toBe("8");
    expect(parts[3]).toBe("1");
    expect(parts[4]?.length ?? 0).toBeGreaterThan(0);
    expect(parts[5]?.length ?? 0).toBeGreaterThan(0);
  });

  test("هضمٌ ممسوسٌ (نسخةٌ أقصرُ) يُرفَضُ ولا يُرمي", () => {
    expect(verifyBreakGlassPassword("pw", "scrypt:16384:8:1:aaaa:bbbb")).toBe(false);
    expect(verifyBreakGlassPassword("pw", "not-scrypt-at-all")).toBe(false);
    expect(verifyBreakGlassPassword("pw", "scrypt:x:8:1:aaaa:bbbb")).toBe(false);
  });
});

// ── TOTP: متجهاتُ RFC 4226 القياسيّةُ ─────────────────────────────────────

const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // "12345678901234567890"

describe("TOTP: متجهاتُ المعيارِ", () => {
  test('رموزُ RFC 4226 (سرُّ "12345678901234567890" بترميزِ base32)', () => {
    expect(base32Decode(RFC_SECRET).toString("utf8")).toBe("12345678901234567890");
    // متجهاتُ RFC 4226 §D (العدّادُ = الوقتُ/30):
    expect(totpCode(RFC_SECRET, 0n)).toBe("755224");
    expect(totpCode(RFC_SECRET, 1n)).toBe("287082");
    expect(totpCode(RFC_SECRET, 2n)).toBe("359152");
    expect(totpCode(RFC_SECRET, 3n)).toBe("969429");
    expect(totpCode(RFC_SECRET, 5n)).toBe("254676");
    expect(totpCode(RFC_SECRET, 9n)).toBe("520489");
  });

  test("رموزُ RFC 6238 §B (الوقتُ الحقيقيُّ بثوانيه لا عدّادٌ مجرَّدٌ)", () => {
    // متجهاتُ الملحقِ ب منَ المعيارِ نفسِهِ: الوقتُ بالثواني يُشتَقُّ منهُ العدّادُ
    // بخطوةِ الثلاثينَ، والرمزُ ستُّ خاناتٍ (الخاناتُ الستُّ الأخيرةُ من رمزِ
    // المعيارِ الثماني). وسرُّها السرُّ نفسُهُ الذي فوقَ — فاختلافُ النتيجةِ كاشفٌ.
    expect(totpCode(RFC_SECRET, totpCounterAt(59))).toBe("287082");
    expect(totpCode(RFC_SECRET, totpCounterAt(1111111109))).toBe("081804");
    expect(totpCode(RFC_SECRET, totpCounterAt(1111111111))).toBe("050471");
    expect(totpCode(RFC_SECRET, totpCounterAt(1234567890))).toBe("005924");
    expect(totpCode(RFC_SECRET, totpCounterAt(2000000000))).toBe("279037");
    expect(totpCode(RFC_SECRET, totpCounterAt(20000000000))).toBe("353130");
  });

  test("العدّادُ مشتقٌّ من الوقتِ: 59 ثانيةً = خطوةٌ 1، و61 = خطوةٌ 2", () => {
    expect(totpCounterAt(59)).toBe(1n);
    expect(totpCounterAt(61)).toBe(2n);
    expect(totpCounterAt(30)).toBe(1n);
    expect(totpCounterAt(29)).toBe(0n);
  });

  test("رمزُ الخطوةِ نفسِها لا يُقبَلُ مرّتَينِ (رفضُ الإعادةِ)", () => {
    const code = totpCode(RFC_SECRET, 10n);
    expect(verifyTotp(RFC_SECRET, code, 10n, null).ok).toBe(true);
    const first = verifyTotp(RFC_SECRET, code, 10n, null);
    expect(first.ok).toBe(true);
    // الإعادةُ بعدَ الاستهلاكِ: مرفوضةٌ
    const replay = verifyTotp(RFC_SECRET, code, 10n, first.counter);
    expect(replay.ok).toBe(false);
    // وحتّى في خطوةٍ لاحقةٍ يبقى رمزُ الخطوةِ المُستهلَكةِ مرفوضًا
    const later = verifyTotp(RFC_SECRET, code, 11n, first.counter);
    expect(later.ok).toBe(false);
  });

  test("نافذةُ التسامحِ ±1: رمزُ الخطوةِ المجاورةِ يُقبَلُ ويلتقطُ عدّادَها", () => {
    const prevCode = totpCode(RFC_SECRET, 9n);
    const nextCode = totpCode(RFC_SECRET, 11n);
    const r1 = verifyTotp(RFC_SECRET, prevCode, 10n, null);
    const r2 = verifyTotp(RFC_SECRET, nextCode, 10n, null);
    expect(r1.ok).toBe(true);
    expect(r1.counter).toBe(9n);
    expect(r2.ok).toBe(true);
    expect(r2.counter).toBe(11n);
  });

  test("رمزٌ غيرُ ستِّ خاناتٍ يُرفَضُ شكلًا قبلَ أيِّ حسابٍ", () => {
    expect(verifyTotp(RFC_SECRET, "12345", 10n, null).ok).toBe(false);
    expect(verifyTotp(RFC_SECRET, "1234567", 10n, null).ok).toBe(false);
    expect(verifyTotp(RFC_SECRET, "abcdef", 10n, null).ok).toBe(false);
  });

  test("السرُّ المُولَّدُ 20 بايتًا (32 محرفًا base32) ويُفكُّ بلا خطأٍ", () => {
    const secret = generateTotpSecret();
    expect(secret.length).toBe(32);
    expect(base32Decode(secret).length).toBe(20);
  });
});

// ── AES-256-GCM: سرُّ TOTP في القاعدةِ ────────────────────────────────────

describe("AES-256-GCM: تشفيرُ سرِّ TOTP", () => {
  const key = "dGVzdC1icmVhay1nbGFzcy10b3RwLWtleS0zMi1ieXRlcy1sb25n";

  test("الدوّارُ: ما يُشفَّرُ بمفتاحٍ يُفكُّ بِمفتاحِهِ", () => {
    const secret = generateTotpSecret();
    const encrypted = encryptTotpSecret(secret, key);
    expect(encrypted.startsWith("v1:")).toBe(true);
    expect(encrypted).not.toContain(secret);
    expect(decryptTotpSecret(encrypted, key)).toBe(secret);
  });

  test("الوسمُ: بايتٌ واحدٌ ممسوسٌ يُسقِطُ الفكَّ كلَّه (null لا نصٌّ فاسدٌ)", () => {
    const encrypted = encryptTotpSecret(RFC_SECRET, key);
    const parts = encrypted.split(":");
    if (parts[3] === undefined || parts[1] === undefined || parts[2] === undefined) {
      throw new Error("صيغةُ الشيفرةِ مكسورةٌ قبلَ المساسِ");
    }
    const tamperedData = Buffer.from(parts[3], "base64");
    tamperedData[0] = (tamperedData[0] ?? 0) ^ 0xff;
    const tampered = ["v1", parts[1], parts[2], tamperedData.toString("base64")].join(":");
    expect(decryptTotpSecret(tampered, key)).toBeNull();
  });

  test("مفتاحٌ آخرُ لا يفكُّ ما شُفِّرَ بمفتاحِهِ الأوّلِ", () => {
    const encrypted = encryptTotpSecret(RFC_SECRET, key);
    expect(decryptTotpSecret(encrypted, "another-entirely-different-key-value")).toBeNull();
  });

  test("الاشتقاقُ من النصِّ: 32 بايتًا مهما اختلفَ طولُ النصِّ", () => {
    expect(deriveAesKey(key).length).toBe(32);
    expect(deriveAesKey("short").length).toBe(32);
  });

  test("نصٌّ ليسَ بالصيغةِ يُرفَضُ لا يُفكُّ", () => {
    expect(decryptTotpSecret("v0:a:b:c", key)).toBeNull();
    expect(decryptTotpSecret("garbage", key)).toBeNull();
  });
});

// ── otpauth وbase32 ────────────────────────────────────────────────────────

describe("رابطُ otpauth", () => {
  test("شكلُ الرابطِ: تسميةٌ مُرمَّزةٌ ومعاملاتٌ كاملةٌ", () => {
    const uri = breakGlassOtpauthUri(RFC_SECRET, "ops-admin", "Waslah");
    expect(uri.startsWith("otpauth://totp/Waslah%3Aops-admin?")).toBe(true);
    expect(uri).toContain(`secret=${RFC_SECRET}`);
    expect(uri).toContain("issuer=Waslah");
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });

  test("base32: الدوّارُ على بايتاتٍ عشوائيّةٍ", () => {
    for (let length = 1; length <= 40; length += 1) {
      const bytes = Buffer.from(Array.from({ length }, () => Math.floor(Math.random() * 256)));
      const encoded = base32Encode(bytes);
      expect(base32Decode(encoded).length).toBe(length);
      expect(Buffer.compare(base32Decode(encoded), Buffer.from(bytes))).toBe(0);
    }
  });

  test("base32: حرفٌ غريبٌ يُرفَضُ لا يُخمَّنُ (1/I التباسٌ مشهورٌ)", () => {
    expect(() => base32Decode("AB1CD")).toThrow();
    expect(() => base32Decode("AB!CD")).toThrow();
  });

  test("base32: الحالةُ والحشوُ يُتسامَحُ معهما", () => {
    expect(base32Decode("gezdgnbvgy3tqojqgezdgnbvgy3tqojq").toString("utf8")).toBe(
      "12345678901234567890",
    );
    expect(base32Decode(`${RFC_SECRET}===`).toString("utf8")).toBe("12345678901234567890");
  });
});
