/**
 * DEC-42: قراءةُ وتحديثُ تفضيلاتِ الإشعاراتِ — `GET/PUT /v1/me/notification-preferences`.
 * الإشعاراتُ التشغيليّةُ (الرحلةُ، المَهمّةُ، الاشتراكُ) تصلك في كلِّ الأحوالِ.
 *
 * الحالة: منفَّذ.
 * ينتمي إلى: packages/application/safety
 */

import type { Result } from "../../shared/result/index.ts";
import { err, ok } from "../../shared/result/index.ts";
import type {
  NotificationPrefs,
  NotificationPrefsReader,
  NotificationPrefsStoreFailure,
  NotificationPrefsWriter,
} from "./ports.ts";

export type NotificationPrefsPublicErrorCode =
  | "SESSION_REQUIRED"
  | "SESSION_REJECTED"
  | "MALFORMED"
  | "ACCOUNT_NOT_FOUND"
  | "NOTIFICATION_PREFS_STORE_NOT_AVAILABLE";

export interface NotificationPrefsDeps {
  readonly sessions: import("../identity/ports.ts").MiniAppSessionReader;
  readonly reader: NotificationPrefsReader;
  readonly writer?: NotificationPrefsWriter | undefined;
  readonly now: () => Date;
}

async function authenticate(
  deps: NotificationPrefsDeps,
  accessToken: string | undefined,
): Promise<Result<string, NotificationPrefsPublicErrorCode>> {
  if (accessToken === undefined || accessToken === "") return err("SESSION_REQUIRED");
  const session = await deps.sessions.read(accessToken, deps.now().getTime());
  if (!session.ok) return err("SESSION_REJECTED");
  return ok(session.value.telegramUserId);
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value !== "boolean") return null;
  return value;
}

/** قراءةُ التفضيلاتِ — `GET /v1/me/notification-preferences`. */
export async function readNotificationPrefs(
  deps: NotificationPrefsDeps,
  input: { readonly accessToken: string | undefined },
): Promise<Result<NotificationPrefs | null, NotificationPrefsPublicErrorCode>> {
  const identified = await authenticate(deps, input.accessToken);
  if (!identified.ok) return identified;

  const result = await deps.reader.read(identified.value);
  if (!result.ok) {
    if (result.error.reason === "USER_NOT_FOUND") return err("ACCOUNT_NOT_FOUND");
    return err("NOTIFICATION_PREFS_STORE_NOT_AVAILABLE");
  }
  return ok(result.value);
}

/** تحديثُ التفضيلاتِ — `PUT /v1/me/notification-preferences`. */
export async function upsertNotificationPrefs(
  deps: NotificationPrefsDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly body: unknown;
  },
): Promise<Result<{ readonly status: "saved" }, NotificationPrefsPublicErrorCode>> {
  const identified = await authenticate(deps, input.accessToken);
  if (!identified.ok) return identified;

  if (deps.writer === undefined) return err("NOTIFICATION_PREFS_STORE_NOT_AVAILABLE");

  if (typeof input.body !== "object" || input.body === null) return err("MALFORMED");
  const body = input.body as Record<string, unknown>;

  const offersEnabled = readBoolean(body.offersEnabled);
  if (offersEnabled === null) return err("MALFORMED");

  const updatesEnabled = readBoolean(body.updatesEnabled);
  if (updatesEnabled === null) return err("MALFORMED");

  const saved = await deps.writer.upsert({
    telegramUserId: identified.value,
    offersEnabled,
    updatesEnabled,
  });
  if (!saved.ok) {
    if (saved.error.reason === "USER_NOT_FOUND") return err("ACCOUNT_NOT_FOUND");
    return err("NOTIFICATION_PREFS_STORE_NOT_AVAILABLE");
  }
  return ok({ status: "saved" });
}

export type { NotificationPrefs, NotificationPrefsStoreFailure };
