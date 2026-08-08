/**
 * الغرض: مصادقة لوحة الإدارة الحقيقية: رمز لمرّة واحدة يصل على تلغرام، ثم جلسة
 *   بكعكة HttpOnly. الهوية الوحيدة في هذا النظام هي حساب تلغرام، وصفة «مسؤول»
 *   تُمنح حصراً عبر grant_bootstrap_admin (ADR 0008) — فاللوحة لا تخترع هويةً
 *   موازية ولا كلمة سرّ ثانية تُنسى.
 * الحالة: منفّذ فعلياً — المرحلة 2.7 (القسم د.1).
 * ينتمي إلى: apps/gateway/src/admin
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/admin-ui.ts، routes/admin-api.ts
 * ملاحظات مستقبلية: عند تعدّد المسؤولين تبقى الآلية هي هي؛ يُضاف عرض الجلسات
 *   الحيّة وإبطالها من اللوحة.
 */

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { guard, readEnvelope, type Sql } from "../../../../packages/infrastructure/db/client.ts";
import type { Result } from "../../../../packages/shared/result/index.ts";

/**
 * قيم أمنية تقنية لا تجارية (القاعدة 0.3 تخصّ الأسعار والمهل التجارية):
 * لا مكان لها في platform_settings لأن تعديلها من اللوحة نفسها يعني أن من اخترق
 * جلسة واحدة يستطيع تمديد كل الجلسات إلى الأبد.
 */
export const ADMIN_CODE_TTL_SECONDS = 600;
export const ADMIN_CODE_MAX_PER_WINDOW = 5;
export const ADMIN_CODE_WINDOW_SECONDS = 3600;
export const ADMIN_CODE_MAX_ATTEMPTS = 5;
export const ADMIN_SESSION_TTL_SECONDS = 28800;
export const ADMIN_SESSION_COOKIE = "waslah_admin";

const CODE_MIN = 100000;
const CODE_MAX = 999999;
const TOKEN_BYTES = 32;

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** رمز من ستّ خانات بمولّد تشفيري: Math.random قابل للتنبؤ، ورمز دخول لا يُخمَّن. */
export function generateLoginCode(): string {
  return String(randomInt(CODE_MIN, CODE_MAX + 1));
}

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

/**
 * رمز CSRF مشتقّ من بصمة الجلسة: المهاجم لا يقرأ الكعكة (HttpOnly) فلا يشتقّه،
 * ولا يحتاج الخادم تخزين قيمة ثالثة. المقارنة بزمن ثابت لا بـ === .
 */
export function csrfTokenFor(sessionTokenHash: string): string {
  return sha256Hex(`${sessionTokenHash}:csrf`);
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface IssuedCode {
  readonly userId: string;
  readonly cityId: string;
  readonly telegramId: string;
  readonly languageCode: string;
}

export interface SessionIdentity {
  readonly sessionId: string;
  readonly userId: string;
  readonly cityId: string;
  readonly telegramId: string;
  readonly fullName: string | null;
}

export type AdminAuthOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

/** منفذ المصادقة كما يراه المسار: لا يعرف SQL ولا شكل الردّ. */
export interface AdminAuthPort {
  issueCode(
    telegramId: string,
    codeHash: string,
  ): Promise<Result<AdminAuthOutcome<IssuedCode>, unknown>>;
  consumeCode(
    telegramId: string,
    codeHash: string,
  ): Promise<Result<AdminAuthOutcome<{ userId: string; cityId: string }>, unknown>>;
  openSession(
    userId: string,
    tokenHash: string,
    userAgent: string | null,
  ): Promise<Result<AdminAuthOutcome<{ userId: string }>, unknown>>;
  touchSession(tokenHash: string): Promise<Result<AdminAuthOutcome<SessionIdentity>, unknown>>;
  closeSession(tokenHash: string): Promise<Result<boolean, unknown>>;
}

function outcome<T>(envelope: ReturnType<typeof readEnvelope>, read: () => T): AdminAuthOutcome<T> {
  if (envelope === null) return { ok: false, error: "UNREADABLE_RESPONSE" };
  if (envelope.ok !== true) return { ok: false, error: String(envelope.error ?? "UNKNOWN") };
  return { ok: true, value: read() };
}

function text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function createAdminAuthPort(sql: Sql): AdminAuthPort {
  return {
    issueCode: (telegramId, codeHash) =>
      guard("rpc.issue_admin_login_code", async () => {
        const rows = await sql<{ result: unknown }[]>`
          select issue_admin_login_code(
            ${telegramId}::bigint,
            ${codeHash}::text,
            ${ADMIN_CODE_TTL_SECONDS}::integer,
            ${ADMIN_CODE_MAX_PER_WINDOW}::integer,
            ${ADMIN_CODE_WINDOW_SECONDS}::integer
          ) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        return outcome(envelope, () => ({
          userId: text(envelope?.user_id),
          cityId: text(envelope?.city_id),
          telegramId: text(envelope?.telegram_id),
          languageCode: text(envelope?.language_code),
        }));
      }),

    consumeCode: (telegramId, codeHash) =>
      guard("rpc.consume_admin_login_code", async () => {
        const rows = await sql<{ result: unknown }[]>`
          select consume_admin_login_code(
            ${telegramId}::bigint,
            ${codeHash}::text,
            ${ADMIN_CODE_MAX_ATTEMPTS}::integer
          ) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        return outcome(envelope, () => ({
          userId: text(envelope?.user_id),
          cityId: text(envelope?.city_id),
        }));
      }),

    openSession: (userId, tokenHash, userAgent) =>
      guard("rpc.open_admin_session", async () => {
        const rows = await sql<{ result: unknown }[]>`
          select open_admin_session(
            ${userId}::uuid,
            ${tokenHash}::text,
            ${ADMIN_SESSION_TTL_SECONDS}::integer,
            ${userAgent}::text
          ) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        return outcome(envelope, () => ({ userId: text(envelope?.user_id) }));
      }),

    touchSession: (tokenHash) =>
      guard("rpc.touch_admin_session", async () => {
        const rows = await sql<{ result: unknown }[]>`
          select touch_admin_session(
            ${tokenHash}::text,
            ${ADMIN_SESSION_TTL_SECONDS}::integer
          ) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        return outcome(envelope, () => ({
          sessionId: text(envelope?.session_id),
          userId: text(envelope?.user_id),
          cityId: text(envelope?.city_id),
          telegramId: text(envelope?.telegram_id),
          fullName: nullableText(envelope?.full_name),
        }));
      }),

    closeSession: (tokenHash) =>
      guard("rpc.close_admin_session", async () => {
        const rows = await sql<{ result: unknown }[]>`
          select close_admin_session(${tokenHash}::text) as result
        `;
        return readEnvelope(rows[0]?.result)?.ok === true;
      }),
  };
}

/** منفذ إرسال رمز الدخول: بوت السائق هو القناة، لأن المسؤول مسجَّل عليه أصلاً. */
export interface AdminCodeSender {
  send(telegramId: string, text: string): Promise<boolean>;
}

const MINUTES_PER_HOUR = 60;

export function loginCodeMessage(code: string): string {
  const minutes = Math.round(ADMIN_CODE_TTL_SECONDS / MINUTES_PER_HOUR);
  return [
    "رمز دخول لوحة الإدارة:",
    code,
    `صالح ${minutes} دقائق، ولمرّة واحدة.`,
    "إن لم تطلبه أنت فلا تُدخِله، وأبلِغ فوراً: أحدٌ يعرف معرّفك ويحاول الدخول.",
  ].join("\n");
}
