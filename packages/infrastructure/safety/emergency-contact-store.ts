/**
 * الغرض: محوّلُ جهةِ الاتصالِ في الطوارئ على PostgreSQL — نداءُ دالّتَينِ:
 *   `upsert_emergency_contact` و`read_emergency_contact`.
 * الحالة: منفَّذ (DEC-41).
 * ينتمي إلى: infrastructure/safety
 */

import type {
  EmergencyContact,
  EmergencyContactReader,
  EmergencyContactStoreFailure,
  EmergencyContactWriter,
} from "../../application/safety/ports.ts";
import { err, ok } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

const TELEGRAM_ID_PATTERN = /^[0-9]{1,19}$/;

const failed = (reason: EmergencyContactStoreFailure["reason"]): EmergencyContactStoreFailure => ({
  code: "EMERGENCY_CONTACT_STORE_FAILED",
  reason,
});

export function createEmergencyContactReader(sql: Sql): EmergencyContactReader {
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
          readonly name?: string | null;
          readonly phone?: string | null;
        };
      }[];
      try {
        rows = await sql.unsafe<
          {
            readonly result: {
              readonly ok?: boolean;
              readonly error?: string;
              readonly status?: string;
              readonly name?: string | null;
              readonly phone?: string | null;
            };
          }[]
        >("select read_emergency_contact($1) as result", [telegramUserId]);
      } catch {
        return err(failed("STORE_ERROR"));
      }

      const result = rows[0]?.result;
      if (result === undefined) return err(failed("STORE_ERROR"));
      if (result.ok !== true) {
        return err(failed(result.error === "USER_NOT_FOUND" ? "USER_NOT_FOUND" : "STORE_ERROR"));
      }

      return ok({
        name: typeof result.name === "string" ? result.name : null,
        phone: typeof result.phone === "string" ? result.phone : null,
      });
    },
  };
}

export function createEmergencyContactWriter(sql: Sql): EmergencyContactWriter {
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
        >("select upsert_emergency_contact($1, $2, $3) as result", [
          input.telegramUserId,
          input.name,
          input.phone,
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

export type { EmergencyContact };
