/**
 * الغرض: محوّلُ رسائلِ التذاكرِ على PostgreSQL — نداءُ دالّتَينِ:
 *   `add_ticket_message` و`list_ticket_messages`.
 * الحالة: منفَّذ (DEC-43).
 * ينتمي إلى: infrastructure/dispute
 */

import type {
  TicketMessage,
  TicketThreadReader,
  TicketThreadStoreFailure,
  TicketThreadWriter,
} from "../../application/dispute/ticket-threads.ts";
import { err, ok } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

const TELEGRAM_ID_PATTERN = /^[0-9]{1,19}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const failed = (reason: TicketThreadStoreFailure["reason"]): TicketThreadStoreFailure => ({
  code: "TICKET_THREAD_STORE_FAILED",
  reason,
});

function readMs(value: unknown): number | null {
  if (typeof value === "string" || value instanceof Date) {
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

export function createTicketThreadReader(sql: Sql): TicketThreadReader {
  return {
    list: async (input) => {
      if (!TELEGRAM_ID_PATTERN.test(input.telegramUserId)) {
        return err(failed("USER_NOT_FOUND"));
      }
      if (!UUID_PATTERN.test(input.ticketId)) {
        return err(failed("TICKET_NOT_FOUND"));
      }

      let rows: {
        readonly result: {
          readonly ok?: boolean;
          readonly error?: string;
          readonly status?: string;
          readonly messages?: readonly {
            readonly id?: string;
            readonly sender_type?: string;
            readonly message?: string;
            readonly created_at?: string | Date;
          }[];
        };
      }[];
      try {
        rows = await sql.unsafe<
          {
            readonly result: {
              readonly ok?: boolean;
              readonly error?: string;
              readonly status?: string;
              readonly messages?: readonly {
                readonly id?: string;
                readonly sender_type?: string;
                readonly message?: string;
                readonly created_at?: string | Date;
              }[];
            };
          }[]
        >("select list_ticket_messages($1, $2, $3, $4) as result", [
          input.telegramUserId,
          input.ticketId,
          input.senderType,
          input.limit,
        ]);
      } catch {
        return err(failed("STORE_ERROR"));
      }

      const result = rows[0]?.result;
      if (result === undefined) return err(failed("STORE_ERROR"));
      if (result.ok !== true) {
        return err(
          failed(
            result.error === "USER_NOT_FOUND"
              ? "USER_NOT_FOUND"
              : result.error === "TICKET_NOT_FOUND"
                ? "TICKET_NOT_FOUND"
                : "STORE_ERROR",
          ),
        );
      }

      const messages: TicketMessage[] = (result.messages ?? []).map((m) => {
        const createdAtMs = readMs(m.created_at);
        return {
          id: typeof m.id === "string" ? m.id : "",
          senderType: typeof m.sender_type === "string" ? m.sender_type : "unknown",
          message: typeof m.message === "string" ? m.message : "",
          createdAtMs: createdAtMs ?? 0,
        };
      });

      return ok(messages);
    },
  };
}

export function createTicketThreadWriter(sql: Sql): TicketThreadWriter {
  return {
    add: async (input) => {
      if (!TELEGRAM_ID_PATTERN.test(input.telegramUserId)) {
        return err(failed("USER_NOT_FOUND"));
      }
      if (!UUID_PATTERN.test(input.ticketId)) {
        return err(failed("TICKET_NOT_FOUND"));
      }

      let rows: {
        readonly result: {
          readonly ok?: boolean;
          readonly error?: string;
          readonly status?: string;
          readonly message_id?: string;
          readonly created_at?: string | Date;
        };
      }[];
      try {
        rows = await sql.unsafe<
          {
            readonly result: {
              readonly ok?: boolean;
              readonly error?: string;
              readonly status?: string;
              readonly message_id?: string;
              readonly created_at?: string | Date;
            };
          }[]
        >("select add_ticket_message($1, $2, $3, $4) as result", [
          input.telegramUserId,
          input.ticketId,
          input.message,
          input.senderType,
        ]);
      } catch {
        return err(failed("STORE_ERROR"));
      }

      const result = rows[0]?.result;
      if (result === undefined) return err(failed("STORE_ERROR"));
      if (result.ok !== true) {
        const errorMap: Record<string, TicketThreadStoreFailure["reason"]> = {
          USER_NOT_FOUND: "USER_NOT_FOUND",
          TICKET_NOT_FOUND: "TICKET_NOT_FOUND",
          TICKET_CLOSED: "TICKET_CLOSED",
          MESSAGE_INVALID: "MESSAGE_INVALID",
          SENDER_TYPE_INVALID: "SENDER_TYPE_INVALID",
        };
        return err(failed(errorMap[result.error ?? ""] ?? "STORE_ERROR"));
      }
      if (result.status !== "added") return err(failed("STORE_ERROR"));

      const createdAtMs = readMs(result.created_at);
      if (typeof result.message_id !== "string" || createdAtMs === null) {
        return err(failed("STORE_ERROR"));
      }

      return ok({ status: "added", messageId: result.message_id, createdAtMs });
    },
  };
}
