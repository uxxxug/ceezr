/**
 * الغرض: منفذُ PostgreSQL لإشعارِ انتهاءِ الوثائقِ (DEC-27).
 * الحالة: منفَّذ — البند DEC-27.
 * ينتمي إلى: packages/infrastructure/driver
 */

import type { Sql } from "postgres";
import type {
  DocumentExpiryRpcPort,
  ExpiringDocument,
} from "../../application/driver/warn-expiring-documents.ts";
import type { CityId } from "../../shared/kernel/index.ts";
import { guard } from "../db/client.ts";

interface ExpiringDocumentRow {
  document_id: string;
  driver_id: string;
  telegram_id: string;
  language_code: string;
  doc_type: string;
  expires_at: string;
  days_left: number;
}

export function createDocumentExpiryRpcPort(sql: Sql): DocumentExpiryRpcPort {
  return {
    expiringSoon: (input: { readonly cityId: CityId; readonly days: number }) =>
      guard("rpc.driverDocumentsExpiringSoon", async (): Promise<readonly ExpiringDocument[]> => {
        const rows = await sql<ExpiringDocumentRow[]>`
            select * from driver_documents_expiring_soon(
              ${input.cityId}::uuid,
              ${input.days}::integer
            )
          `;
        return rows.map((row) => ({
          documentId: row.document_id,
          driverId: row.driver_id,
          telegramId: row.telegram_id,
          languageCode: row.language_code,
          docType: row.doc_type,
          expiresAt: row.expires_at,
          daysLeft: row.days_left,
        }));
      }),
    recordWarning: (documentId: string) =>
      guard("rpc.recordDocumentExpiryWarning", async (): Promise<void> => {
        await sql`select record_document_expiry_warning(${documentId}::uuid)`;
      }),
  };
}
