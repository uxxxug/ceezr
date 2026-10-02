/**
 * الغرض: محوّلُ تفضيلاتِ الإشعاراتِ على PostgreSQL — نداءُ دالّتَينِ:
 *   `upsert_notification_prefs` و`read_notification_prefs`.
 * الحالة: منفَّذ (DEC-42).
 * ينتمي إلى: infrastructure/safety
 */

import type {
  NotificationPrefs,
  NotificationPrefsReader,
  NotificationPrefsStoreFailure,
  NotificationPrefsWriter,
} from "../../application/safety/ports.ts";
import { err, ok } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

const TELEGRAM_ID_PATTERN = /^[0-9]{1,19}$/;

const failed = (
  reason: NotificationPrefsStoreFailure["reason"],
): NotificationPrefsStoreFailure => ({
  code: "NOTIFICATION_PREFS_STORE_FAILED",
  reason,
});

export function createNotificationPrefsReader(sql: Sql): NotificationPrefsReader {
  return {
    read: async (telegramUserId: string) => {
      if (!TELEGRAM_ID_PATTERN.test(telegramUserId)) {
        return err(failed("USER_NOT_FOUND"));
      }

      let rows: {
        readonly result: {
          readonly ok?: boolean;
          readonly error?: string;
          readonly status?: string;
          readonly offers_enabled?: boolean;
          readonly updates_enabled?: boolean;
        };
      }[];
      try {
        rows = await sql.unsafe<
          {
            readonly result: {
              readonly ok?: boolean;
              readonly error?: string;
              readonly status?: string;
              readonly offers_enabled?: boolean;
              readonly updates_enabled?: boolean;
            };
          }[]
        >("select read_notification_prefs($1) as result", [telegramUserId]);
      } catch {
        return err(failed("STORE_ERROR"));
      }

      const result = rows[0]?.result;
      if (result === undefined) return err(failed("STORE_ERROR"));
      if (result.ok !== true) {
        return err(failed(result.error === "USER_NOT_FOUND" ? "USER_NOT_FOUND" : "STORE_ERROR"));
      }

      return ok({
        offersEnabled: result.offers_enabled === true,
        updatesEnabled: result.updates_enabled === true,
      });
    },
  };
}

export function createNotificationPrefsWriter(sql: Sql): NotificationPrefsWriter {
  return {
    upsert: async (input) => {
      if (!TELEGRAM_ID_PATTERN.test(input.telegramUserId)) {
        return err(failed("USER_NOT_FOUND"));
      }

      let rows: {
        readonly result: {
          readonly ok?: boolean;
          readonly error?: string;
          readonly status?: string;
        };
      }[];
      try {
        rows = await sql.unsafe<
          {
            readonly result: {
              readonly ok?: boolean;
              readonly error?: string;
              readonly status?: string;
            };
          }[]
        >("select upsert_notification_prefs($1, $2, $3) as result", [
          input.telegramUserId,
          input.offersEnabled,
          input.updatesEnabled,
        ]);
      } catch {
        return err(failed("STORE_ERROR"));
      }

      const result = rows[0]?.result;
      if (result === undefined) return err(failed("STORE_ERROR"));
      if (result.ok !== true) {
        return err(failed(result.error === "USER_NOT_FOUND" ? "USER_NOT_FOUND" : "STORE_ERROR"));
      }
      if (result.status !== "saved") return err(failed("STORE_ERROR"));
      return ok({ status: "saved" });
    },
  };
}

export type { NotificationPrefs };
