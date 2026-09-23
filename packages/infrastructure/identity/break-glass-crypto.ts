/**
 * الغرض: أدواتُ البابِ الموازي للإدارة (break-glass) التشفيريّةُ: هضمُ كلمةِ
 *   السرِّ بـscrypt، وتوليدُ رموزِ TOTP (RFC 6238) والتحقّقُ منها بردفضِ
 *   الإعادةِ، وتشفيرُ سرِّ TOTP بـAES-256-GCM، وبناءُ رابطِ otpauth://.
 *   كلُّ هذا في الخادمِ لا في القاعدةِ (ADR 0176): القاعدةُ تملكُ الحالةَ
 *   الذرّيّةَ — العدّاداتِ والإقفالَ والجلسةَ والتدقيقَ — والخادمُ يملكُ
 *   التشفيرَ؛ فلا يمرُّ سرٌّ ناقلًا إلى SQL أصلًا.
 * الحالة: منفّذ فعلياً — المرحلة `SEC-21`.
 * ينتمي إلى: packages/infrastructure/identity
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/admin/break-glass.ts (المنفذ)،
 *   وroutes/admin-ui.ts (نموذجُ الدخولِ والتسجيلُ)، وtests/unit/break-glass-crypto.test.ts.
 * ملاحظات مستقبلية: WebAuthn بديلٌ أقوى (ADR 0176 §٧) — هذه الآليّةُ عامِلٌ
 *   ثانٍ لا مُصادقةً ذاتيّةَ الاكتفاء، فاستبدالُها لاحقًا مسارُ ترقيةٍ لا هدم.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

// ─────────────────────────── scrypt: كلمةُ السرِّ ───────────────────────────

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SCRYPT_SALT_BYTES = 16;

/** هضمٌ نصيٌّ واحدٌ يشرحُ نفسَه: `scrypt:N:r:p:ملح:هضم` — قاعدةٌ64 لكلٍّ من الملحِ والهضمِ. */
export function hashBreakGlassPassword(password: string): string {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const digest = scryptSync(password.normalize("NFKC"), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64"),
    digest.toString("base64"),
  ].join(":");
}

/**
 * تحقّقٌ بزمنٍ ثابتٍ مهما اختلفَ موضعُ الخلافِ: طولُ الهضمِ يُقارَنُ أولًا
 * (علمٌ واحدٌ لا يُسرِّبُ شيئًا — الطولُ معلومٌ من الصيغةِ)، ثمَّ البايتاتُ
 * بمقارنةٍ لا تتأثّرُ بزمنِ أوّلِ اختلافٍ.
 */
export function verifyBreakGlassPassword(password: string, encoded: string): boolean {
  const parts = encoded.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    if (parts[4] === undefined || parts[5] === undefined) return false;
    salt = Buffer.from(parts[4], "base64");
    expected = Buffer.from(parts[5], "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = scryptSync(password.normalize("NFKC"), salt, expected.length, { N: n, r, p });
  return timingSafeEqual(actual, expected);
}

// ─────────────────────────── TOTP: RFC 6238 ───────────────────────────

/** خطوةٌ 30 ثانيةً (RFC 6238 §5.2) وستُّ خاناتٍ (RFC 4226 §5.3). */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** نافذةُ التسامحِ: ±1 خطوةً — ساعةٌ مشرودةٌ لا تُسكِتِ بابَ نجاةٍ. */
export const TOTP_WINDOW_STEPS = 1;

/**
 * سرٌّ عشوائيٌّ في ترميزِ قاعدةِ 32 بلا حشوٍ (RFC 4648): 20 بايتًا عشوائيّةً
 * كافيةٌ لـHMAC-SHA1، والحروفُ الكبيرةُ هي ما تفهمُهُ تطبيقاتُ المُصادقةِ.
 */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/**
 * رمزُ الخطوةِ: HMAC-SHA1 ثمَّ اقتطاعٌ ديناميكيٌّ (RFC 4226 §5.3) — البتُّ
 * 31 تُحذفُ من الإزاحةِ حتّى لا تنفجرَ القيمةُ في 32 بتًا مُوقَّعةً.
 */
export function totpCode(secretBase32: string, counter: bigint): string {
  const key = base32Decode(secretBase32);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt.asUintN(64, counter));
  const mac = createHmac("sha1", key).update(message).digest();
  const lastByte = mac[mac.length - 1] ?? 0;
  const offset = lastByte & 0x0f;
  const b0 = mac[offset] ?? 0;
  const b1 = mac[offset + 1] ?? 0;
  const b2 = mac[offset + 2] ?? 0;
  const b3 = mac[offset + 3] ?? 0;
  const binary = ((b0 & 0x7f) << 24) | ((b1 & 0xff) << 16) | ((b2 & 0xff) << 8) | (b3 & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/** رقمُ الخطوةِ لِلَّحظةِ المُعطاةِ (ثوانٍ منذُ الحقبةِ). */
export function totpCounterAt(unixSeconds: number): bigint {
  return BigInt(Math.floor(unixSeconds / TOTP_STEP_SECONDS));
}

export interface TotpVerification {
  readonly ok: boolean;
  /** أعلى خطوةٍ قُبِلَ رمزُها — تُخزَّنُ لرفضِ إعادةِ الاستعمالِ لا للتنبّؤِ. */
  readonly counter: bigint;
}

/**
 * التحقّقُ معَ رفضِ الإعادةِ: يُقبَلُ الرمزُ في النافذةِ `[خطوة-1، خطوة+1]`
 * فقطَ للخطواتِ الأحدثِ من `lastCounter` المُخزَّنةِ. الرمزُ المُستهلَكُ لا
 * يُعادُ استعمالُهُ ولو أعادَهُ المتصلُ في الثانيةِ نفسِها.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  currentCounter: bigint,
  lastCounter: bigint | null,
): TotpVerification {
  if (!/^\d{6}$/.test(code)) return { ok: false, counter: currentCounter };
  for (let drift = -TOTP_WINDOW_STEPS; drift <= TOTP_WINDOW_STEPS; drift += 1) {
    const candidate = currentCounter + BigInt(drift);
    if (lastCounter !== null && candidate <= lastCounter) continue;
    if (totpCode(secretBase32, candidate) === code) {
      return { ok: true, counter: candidate };
    }
  }
  return { ok: false, counter: currentCounter };
}

// ─────────────────────────── AES-256-GCM: سرُّ TOTP في القاعدةِ ───────────────────────────

/**
 * مفتاحُ التشفيرِ من قيمةِ البيئةِ: القيمةُ نصٌّ (قاعدةُ 64 عادةً)، والاشتقاقُ
 * بـSHA-256 يضمنُ مفتاحًا بطولِ الخوارزميّةِ بالضبطِ (32 بايتًا) مهما كانَ
 * طولُ النصِّ — لا كلُّ طولٍ يصلحُ مفتاحًا لـAES-256. المفتاحُ **لا يُخزَّنُ
 * في القاعدةِ** ولا في أيِّ ملفٍّ: فِلفِلُ التجزئةِ (`ADR 0113`) أداةٌ أخرى
 * لوظيفةٍ أخرى ولا يُعادُ استعمالُهُ.
 */
export function deriveAesKey(envKeyValue: string): Buffer {
  return createHash("sha256").update(envKeyValue, "utf8").digest();
}

/** تشفيرٌ نصيٌّ واحدٌ يشرحُ نفسَه: `v1:iv:وسم:شيفرة` — قاعدةٌ 64 للأجزاءِ الثلاثةِ. */
export function encryptTotpSecret(plainBase32: string, envKeyValue: string): string {
  const key = deriveAesKey(envKeyValue);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainBase32, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(
    ":",
  );
}

/** فكُّ التشفيرِ — يفشلُ إن حُرِّفَ بايتٌ واحدٌ (وسمُ GCM): لا فكَّ صامتًا لبياناتٍ ممسوسةٍ. */
export function decryptTotpSecret(encoded: string, envKeyValue: string): string | null {
  const parts = encoded.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    if (parts[1] === undefined || parts[2] === undefined || parts[3] === undefined) return null;
    const key = deriveAesKey(envKeyValue);
    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const data = Buffer.from(parts[3], "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ─────────────────────────── otpauth وbase32 ───────────────────────────

/**
 * رابطُ التسجيلِ في تطبيقاتِ المُصادقةِ (otpauth:// من معيارِ Key URI Format).
 * بلا مُولِّدِ رمزٍ QR في الإصدارِ الأولِ (ADR 0176 §٥): النصُّ يُنسخُ
 * يدويًّا، وإضافةُ الصورةِ لاحقًا لا تُغيّرُ شيئًا من هذا العقدِ.
 */
export function breakGlassOtpauthUri(
  secretBase32: string,
  loginName: string,
  issuer: string,
): string {
  const label = encodeURIComponent(`${issuer}:${loginName}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** ترميزُ قاعدةِ 32 بلا حشوٍ (RFC 4648) — كما تفهمُهُ تطبيقاتُ المُصادقةِ. */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

/** فكُّ الترميزِ متسامحٌ مع الحشوِ وحالةِ الأحرفِ — والتخلطُ بالحرفِ 1/I يُرفَضُ لا يُخمَّنُ. */
export function base32Decode(text: string): Buffer {
  const clean = text.replace(/=+$/, "").toUpperCase().replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`BASE32_INVALID_CHARACTER:${char}`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
