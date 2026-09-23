/**
 * الغرض: منفذُ البابِ الموازي للإدارةِ (break-glass) — الدخولُ الإداريُّ بديلًا
 *   عن تيليجرام وقتَ عطبِه. القاعدةُ تملكُ الحالةَ الذرّيّةَ (عدّاداتُ الإقفالِ
 *   · فتحُ الجلسةِ · التدقيقُ) عبرَ دوالِّ `admin_break_glass_*`، والخادمُ يملكُ
 *   التشفيرَ (scrypt · TOTP · AES-GCM في `break-glass-crypto.ts`) — فلا يمرُّ
 *   سرٌّ ناقلًا إلى SQL أصلًا (ADR 0176).
 * الحالة: منفّذ فعلياً — المرحلة `SEC-21`.
 * ينتمي إلى: apps/gateway/src/admin
 * يُتوقع أن يستخدمه لاحقاً: routes/admin-ui.ts (نموذجُ الدخولِ والتسجيلُ)،
 *   tests/integration/admin-break-glass.test.ts.
 * ملاحظات مستقبلية: WebAuthn بديلٌ أقوى (ADR 0176 §٧)؛ هذا المنفذُ عاملٌ ثانٍ
 *   على الهويّةِ الداخليّةِ لا هويّةٌ موازية، فترقيتُهُ لاحقًا لا تهدمُ شيئًا.
 */

import { guard, readEnvelope, type Sql } from "../../../../packages/infrastructure/db/client.ts";
import {
  breakGlassOtpauthUri,
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  hashBreakGlassPassword,
  totpCounterAt,
  verifyBreakGlassPassword,
  verifyTotp,
} from "../../../../packages/infrastructure/identity/break-glass-crypto.ts";
import type { Result } from "../../../../packages/shared/result/index.ts";
import { ADMIN_SESSION_TTL_SECONDS } from "./auth.ts";

/**
 * قيمٌ أمنيّةٌ تقنيّةٌ لا تجاريّةٌ (القاعدةُ 0.3 تخصُّ الأسعارِ والمُهلَ التجاريّةِ):
 * لا مكانَ لها في `platform_settings` لأنَّ من عدّلها من اللوحةِ يملكُ أن يُطيلَ
 * إقفالَ بابِ النجاةِ إلى الأبد. وتُمرَّرُ من الخادمِ إلى القاعدةِ في كلِّ نداءٍ
 * كما يفعلُ شقيقُها الأصغرُ `issue_admin_login_code` بحدودِه.
 */
export const BREAK_GLASS_MAX_ATTEMPTS = 5;
export const BREAK_GLASS_LOCKOUT_SECONDS = 900;

/** الرفضُ العامُّ الموحَّدُ — نصٌّ واحدٌ لكلِّ أسبابِ رفضِ الدخولِ العامةِ. */
export const BREAK_GLASS_INVALID_CREDENTIALS = "INVALID_CREDENTIALS";

/**
 * هضمٌ دائمٌ للفروعِ المجهولةِ الاسمِ: يُهضَمُ أمامَهُ حتّى يكونَ زمنُ الردِّ
 * على اسمٍ غيرِ معروفٍ قريبًا من زمنِ الردِّ على كلمةِ سرٍّ خاطئةٍ — فلا يقيسَ
 * متصلٌ وجودَ الاسمِ من التوقيتِ. يُحسَبُ مرّةً واحدةً لا في كلِّ طلبٍ.
 */
const DUMMY_PASSWORD_HASH = hashBreakGlassPassword("timing-equalizer");

export interface BreakGlassAttempt {
  readonly ok: boolean;
  readonly userId?: string | undefined;
  readonly cityId?: string | undefined;
  readonly passwordHash?: string | undefined;
  readonly totpSecretEncrypted?: string | undefined;
  readonly lastTotpCounter?: bigint | null | undefined;
  readonly failedAttempts?: number | undefined;
  readonly lockedUntil?: string | null | undefined;
  readonly isActive?: boolean | undefined;
}

export interface BreakGlassSession {
  readonly userId: string;
  readonly cityId: string;
}

export type BreakGlassOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

function attemptFrom(envelope: ReturnType<typeof readEnvelope>): BreakGlassAttempt {
  if (envelope === null || envelope.ok !== true) {
    return { ok: false };
  }
  const rawCounter = envelope.last_totp_counter;
  const lastCounter =
    typeof rawCounter === "bigint"
      ? rawCounter
      : typeof rawCounter === "string"
        ? BigInt(rawCounter)
        : null;
  return {
    ok: true,
    userId: typeof envelope.user_id === "string" ? envelope.user_id : undefined,
    cityId: typeof envelope.city_id === "string" ? envelope.city_id : undefined,
    passwordHash: typeof envelope.password_hash === "string" ? envelope.password_hash : undefined,
    totpSecretEncrypted:
      typeof envelope.totp_secret_encrypted === "string"
        ? envelope.totp_secret_encrypted
        : undefined,
    lastTotpCounter: lastCounter,
    failedAttempts: typeof envelope.failed_attempts === "number" ? envelope.failed_attempts : 0,
    lockedUntil: typeof envelope.locked_until === "string" ? envelope.locked_until : null,
    isActive: envelope.is_active === true,
  };
}

export interface AdminBreakGlassPort {
  /**
   * محاولةُ دخولٍ كاملةٌ بخطوةٍ واحدةٍ من منظورِ المسارِ: تحميلُ الاعتمادِ،
   * التحقّقُ التشفيريُّ في الخادمِ، ثمَّ الإتمامُ الذرّيُّ (نجاحًا أو فشلًا) في
   * القاعدةِ. الردُّ للمسارِ موحَّدٌ: جلسةٌ أو الرفضُ العامُّ.
   */
  login(
    loginName: string,
    password: string,
    totpCode: string,
    tokenHash: string,
    userAgent: string | null,
  ): Promise<Result<BreakGlassOutcome<BreakGlassSession>, unknown>>;
  /**
   * التسجيلُ/التدويرُ من داخلِ جلسةِ مسؤولٍ قائمةٍ (إثباتُ الهويّةِ الأولُ
   * يبقى تيليجرام). يُعيدُ السرَّ واضحًا مرّةً واحدةً مع رابطِ otpauth لكي
   * يُضبطَ التطبيقُ — لا يُقرأُ بعدَها من أيِّ مكانٍ.
   */
  enroll(
    sessionTokenHash: string,
    loginName: string,
    password: string,
  ): Promise<Result<BreakGlassOutcome<{ otpauthUri: string }>, unknown>>;
  /** التعطيلُ الذاتيُّ — لا حذفَ: البابُ يُطفأ والأثرُ التدقيقيُّ يبقى. */
  disable(sessionTokenHash: string): Promise<Result<BreakGlassOutcome<true>, unknown>>;
}

export interface CreateAdminBreakGlassPortOptions {
  /** مفتاحُ AES-256-GCM من البيئةِ (`ADMIN_BREAK_GLASS_TOTP_KEY`). `null` = البابُ مُعطَّلٌ. */
  readonly totpKey: string | null;
  /** اسمُ المُصدِرِ في رابطِ otpauth. */
  readonly issuer: string;
}

export function createAdminBreakGlassPort(
  sql: Sql,
  options: CreateAdminBreakGlassPortOptions,
): AdminBreakGlassPort {
  return {
    login: (loginName, password, totpCode, tokenHash, userAgent) =>
      guard("rpc.admin_break_glass_login", async () => {
        // البابُ مُعطَّلٌ بلا مفتاحِ تشفيرٍ: رفضٌ موحَّدٌ لا 500 — فمن أضبطَ البابَ
        // ولم يُضبطِ المفتاحُ لا يستحقُّ كشفَ الفرقِ، ولا تسقطُ الخدمةُ كلُّها.
        if (options.totpKey === null) {
          return { ok: false, error: BREAK_GLASS_INVALID_CREDENTIALS } as const;
        }

        const rows = await sql<{ result: unknown }[]>`
          select admin_break_glass_load_attempt(${loginName}::text) as result
        `;
        const attempt = attemptFrom(readEnvelope(rows[0]?.result));

        // التوقيتُ شبهُ الثابتِ: كلُّ فروعِ الرفضِ تدفعُ الكلفةَ التشفيريّةَ
        // نفسَها (scrypt + TOTP) فلا يقيسَ متصلٌ عامٌّ وجودَ الاسمِ من زمنِ الردِّ.
        const unknownName = !attempt.ok || attempt.passwordHash === undefined;
        const passwordOk = unknownName
          ? verifyBreakGlassPassword(password, DUMMY_PASSWORD_HASH)
          : verifyBreakGlassPassword(password, attempt.passwordHash ?? "");

        const secret =
          unknownName || options.totpKey === null || attempt.totpSecretEncrypted === undefined
            ? null
            : decryptTotpSecret(attempt.totpSecretEncrypted, options.totpKey);
        const counter = totpCounterAt(Math.floor(Date.now() / 1000));
        const totpOk =
          secret !== null
            ? verifyTotp(secret, totpCode, counter, attempt.lastTotpCounter ?? null)
            : verifyTotp("AAAAAAAAAAAAAAAAAAAAAAAA", totpCode, counter, null);

        const locked =
          attempt.ok &&
          attempt.lockedUntil !== undefined &&
          attempt.lockedUntil !== null &&
          new Date(attempt.lockedUntil).getTime() > Date.now();
        const active = attempt.ok && attempt.isActive === true;

        if (!passwordOk || !totpOk.ok || locked || !active || unknownName) {
          // فشلٌ معروفُ الاسمِ: تُكلفُ القاعدةَ العدَّ والإقفالَ والتدقيقَ.
          // فشلٌ مجهولُ الاسمِ: لا صفَّ لهُ ولا أثرَ تدقيقٍ منتحَلًا (audit_log.city_id
          // ليس فارغًا) — عدُّهُ وتقييدُهُ على البوّابةِ (حدُّ المعدّلِ).
          await sql<{ result: unknown }[]>`
            select admin_break_glass_finish_failure(
              ${loginName}::text,
              ${BREAK_GLASS_MAX_ATTEMPTS}::integer,
              ${BREAK_GLASS_LOCKOUT_SECONDS}::integer
            ) as result
          `;
          return { ok: false, error: BREAK_GLASS_INVALID_CREDENTIALS } as const;
        }

        const successRows = await sql<{ result: unknown }[]>`
          select admin_break_glass_finish_success(
            ${loginName}::text,
            ${totpOk.counter.toString()}::bigint,
            ${tokenHash}::text,
            ${ADMIN_SESSION_TTL_SECONDS}::integer,
            ${userAgent}::text
          ) as result
        `;
        const success = readEnvelope(successRows[0]?.result);
        if (success === null || success.ok !== true) {
          return { ok: false, error: BREAK_GLASS_INVALID_CREDENTIALS } as const;
        }
        return {
          ok: true,
          value: {
            userId: String(success.user_id ?? ""),
            cityId: String(success.city_id ?? ""),
          },
        } as const;
      }),

    enroll: (sessionTokenHash, loginName, password) =>
      guard("rpc.admin_break_glass_enroll", async () => {
        if (options.totpKey === null) {
          return { ok: false, error: "TOTP_KEY_NOT_CONFIGURED" } as const;
        }
        const secret = generateTotpSecret();
        const rows = await sql<{ result: unknown }[]>`
          select admin_break_glass_enroll(
            ${sessionTokenHash}::text,
            ${loginName}::text,
            ${hashBreakGlassPassword(password)}::text,
            ${encryptTotpSecret(secret, options.totpKey)}::text
          ) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null || envelope.ok !== true) {
          return { ok: false, error: String(envelope?.error ?? "UNKNOWN") } as const;
        }
        return {
          ok: true,
          value: {
            otpauthUri: breakGlassOtpauthUri(secret, loginName, options.issuer),
          },
        } as const;
      }),

    disable: (sessionTokenHash) =>
      guard("rpc.admin_break_glass_disable", async () => {
        const rows = await sql<{ result: unknown }[]>`
          select admin_break_glass_disable(${sessionTokenHash}::text) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null || envelope.ok !== true) {
          return { ok: false, error: String(envelope?.error ?? "UNKNOWN") } as const;
        }
        return { ok: true, value: true } as const;
      }),
  };
}
