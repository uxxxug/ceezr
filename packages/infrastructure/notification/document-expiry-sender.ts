/**
 * الغرض: مُرسِلُ تلغرامَ لإشعارِ انتهاءِ الوثائقِ (DEC-27).
 *   نفسُ `ExpiryWarningSender` للسلعةِ — واجهةٌ واحدةٌ لا نسخةٌ ثانيةٌ.
 * الحالة: منفَّذ — البند DEC-27.
 * ينتمي إلى: packages/infrastructure/notification
 */

import type { DocumentExpiryWarningSender } from "../../application/driver/warn-expiring-documents.ts";
import { PortFailureError } from "../../application/ports/index.ts";

export function createDocumentExpiryTelegramSender(
  send: (chatId: string, text: string) => Promise<void>,
): DocumentExpiryWarningSender {
  return {
    send: async ({ chatId, text }) => {
      try {
        await send(chatId, text);
        return { ok: true, value: undefined };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          error: new PortFailureError("telegram.sendMessage", detail),
        };
      }
    },
  };
}
