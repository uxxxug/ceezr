/**
 * DEC-41: قراءةُ وتحديثُ جهةِ الاتصالِ في الطوارئ — `GET/PUT /v1/me/emergency-contact`.
 * الترتيبُ: جلسةٌ، ثمَّ قبولُ الجسمِ (للكتابةِ)، ثمَّ نداءُ المخزنِ.
 *
 * الحالة: منفَّذ.
 * ينتمي إلى: packages/application/safety
 */

import type { Result } from "../../shared/result/index.ts";
import { err, ok } from "../../shared/result/index.ts";
import type {
  EmergencyContact,
  EmergencyContactReader,
  EmergencyContactStoreFailure,
  EmergencyContactWriter,
} from "./ports.ts";

export type EmergencyContactPublicErrorCode =
  | "SESSION_REQUIRED"
  | "SESSION_REJECTED"
  | "MALFORMED"
  | "ACCOUNT_NOT_FOUND"
  | "EMERGENCY_CONTACT_STORE_NOT_AVAILABLE";

const PHONE_PATTERN = /^[0-9]{4,20}$/;
const NAME_MAX_LENGTH = 120;

export function normalizeContactName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > NAME_MAX_LENGTH) return null;
  return trimmed;
}

export function normalizeContactPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!PHONE_PATTERN.test(trimmed)) return null;
  return trimmed;
}

export interface EmergencyContactDeps {
  readonly sessions: import("../identity/ports.ts").MiniAppSessionReader;
  readonly reader: EmergencyContactReader;
  readonly writer?: EmergencyContactWriter | undefined;
  readonly now: () => Date;
}

async function authenticate(
  deps: EmergencyContactDeps,
  accessToken: string | undefined,
): Promise<Result<string, EmergencyContactPublicErrorCode>> {
  if (accessToken === undefined || accessToken === "") return err("SESSION_REQUIRED");
  const session = await deps.sessions.read(accessToken, deps.now().getTime());
  if (!session.ok) return err("SESSION_REJECTED");
  return ok(session.value.telegramUserId);
}

/** قراءةُ جهةِ الاتصالِ — `GET /v1/me/emergency-contact`. */
export async function readEmergencyContact(
  deps: EmergencyContactDeps,
  input: { readonly accessToken: string | undefined },
): Promise<Result<EmergencyContact | null, EmergencyContactPublicErrorCode>> {
  const identified = await authenticate(deps, input.accessToken);
  if (!identified.ok) return identified;

  const result = await deps.reader.read(identified.value);
  if (!result.ok) {
    if (result.error.reason === "USER_NOT_FOUND") return err("ACCOUNT_NOT_FOUND");
    return err("EMERGENCY_CONTACT_STORE_NOT_AVAILABLE");
  }
  return ok(result.value);
}

/** تحديثُ جهةِ الاتصالِ — `PUT /v1/me/emergency-contact`. */
export async function upsertEmergencyContact(
  deps: EmergencyContactDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly body: unknown;
  },
): Promise<Result<{ readonly status: "saved" }, EmergencyContactPublicErrorCode>> {
  const identified = await authenticate(deps, input.accessToken);
  if (!identified.ok) return identified;

  if (deps.writer === undefined) return err("EMERGENCY_CONTACT_STORE_NOT_AVAILABLE");

  if (typeof input.body !== "object" || input.body === null) return err("MALFORMED");
  const body = input.body as Record<string, unknown>;

  const name = normalizeContactName(body.name);
  if (name === null) return err("MALFORMED");

  const phone = normalizeContactPhone(body.phone);
  if (phone === null) return err("MALFORMED");

  const saved = await deps.writer.upsert({
    telegramUserId: identified.value,
    name,
    phone,
  });
  if (!saved.ok) {
    if (saved.error.reason === "USER_NOT_FOUND") return err("ACCOUNT_NOT_FOUND");
    return err("EMERGENCY_CONTACT_STORE_NOT_AVAILABLE");
  }
  return ok({ status: "saved" });
}

export type { EmergencyContact, EmergencyContactStoreFailure };
