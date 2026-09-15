/**
 * الغرض: محوّلُ دعمِ السائقِ على PostgreSQL — نداءُ `open_support_ticket`
 *   بأصنافِ السائقِ ونداءُ `driver_support_tickets` (`F3-08` · `SD-10`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-08`.
 * ينتمي إلى: infrastructure/support
 * يُستخدم من: `apps/gateway/src/index.ts` عبرَ حقنِ التبعياتِ.
 * الحاكم: docs/adr/0114-a-support-ticket-is-a-spoken-reference-not-a-uuid.md
 *
 * ## لِمَ دالّةُ فتحٍ واحدةٌ ودالّتا قراءةٍ
 *
 * **الفتحُ** يفحصُ الدورَ من الصنفِ داخلَ القاعدةِ (`NOT_A_DRIVER`)، فبابٌ واحدٌ
 * يكفي ولا يُنسَخُ توليدُ المرجعِ ولا التهدئةُ ولا سجلُّ التدقيقِ. **والقراءةُ**
 * تفترقُ لأنَّ الفرزَ يفترقُ: `where driver_id = …` لا `rider_id`. ولو قرأَ
 * السائقُ بدالّةِ الراكبِ لَظهرَت له تذاكرُ دورِه الآخرِ وحُجِبَت تذاكرُ سياقتِه.
 *
 * ## وما لا يفعلُه عن قصدٍ
 *
 *   ــ **لا يقرأُ حمولةً بيدِه**: الأحكامُ في `ticket-store.ts` مرَّةً واحدةً.
 *   ــ **لا يُركِّبُ SQL نصّاً**: مُعامَلاتٌ، والمعرّفُ يُفحَصُ رقميّاً.
 */

import type { OpenedDriverSupportTicket } from "../../application/support/driver-support.ts";
import type { DriverSupportStore, SupportStoreError } from "../../application/support/ports.ts";
import type { SupportTicketCursor, SupportTicketsPage } from "../../domain/support/ticket-types.ts";
import { err, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";
import {
  asTelegramId,
  failed,
  type ResultRow,
  readOpenedTicket,
  readTicketsPage,
} from "./ticket-store.ts";

export class PostgresDriverSupportStore implements DriverSupportStore {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async openTicket(input: {
    readonly telegramUserId: string;
    readonly category: Parameters<DriverSupportStore["openTicket"]>[0]["category"];
    readonly message: string;
    readonly orderId: string | null;
  }): Promise<Result<OpenedDriverSupportTicket, SupportStoreError>> {
    const telegramId = asTelegramId(input.telegramUserId);
    if (telegramId === null) return err(failed("MALFORMED_RESULT"));

    let rows: ResultRow[];
    try {
      rows = await this.#sql<ResultRow[]>`
        select open_support_ticket(
          ${telegramId}::bigint,
          ${input.category}::support_ticket_type,
          ${input.message}::text,
          null::text,
          ${input.orderId}::uuid
        ) as result`;
    } catch {
      return err(failed("STORE_ERROR"));
    }

    return readOpenedTicket(rows[0]?.result, input.category);
  }

  async listTickets(input: {
    readonly telegramUserId: string;
    readonly limit: number;
    readonly cursor: SupportTicketCursor | null;
  }): Promise<Result<SupportTicketsPage, SupportStoreError>> {
    const telegramId = asTelegramId(input.telegramUserId);
    if (telegramId === null) return err(failed("MALFORMED_RESULT"));

    let rows: ResultRow[];
    try {
      rows = await this.#sql<ResultRow[]>`
        select driver_support_tickets(
          ${telegramId}::bigint,
          ${input.limit}::integer,
          ${input.cursor?.createdAt ?? null}::timestamptz,
          ${input.cursor?.id ?? null}::uuid
        ) as result`;
    } catch {
      return err(failed("STORE_ERROR"));
    }

    return readTicketsPage(rows[0]?.result);
  }
}
