/**
 * الغرض: ملتقطُ الرسائلِ الصادرة — يقوم مقامَ ناقلِ تلغرام في القياس، ويُفهرِس
 *        بالمحادثة كي لا يصير كلُّ توكيدٍ بحثاً خطّياً في مصفوفةٍ واحدة.
 * الحالة: منفّذ فعلياً — انتُزع في وحدة 2-6 من `harness.ts` كما هو.
 * ينتمي إلى: bench/scenarios
 * يُتوقع أن يستخدمه لاحقاً: `harness.ts` (عمليةٌ واحدة)، و`bench/topology/gateway-process.ts`
 *                   (كلُّ نسخةِ بوّابةٍ تلتقط رسائلَها ثم تُجمَع عبر HTTP).
 *
 * ولماذا انتُزع: البوّابةُ في العنقود عمليةٌ أخرى لا تستورد بيئةَ الاختبار، ونسخُ
 * الملتقط هناك كان سيجعل رسالةً تُقاس بمقياسين مختلفين في بيئتين.
 */

import type { TelegramSender } from "../../../../apps/gateway/src/bots/driver/index.ts";
import type { RecordedMessage } from "./contract.ts";

export interface MessageRecorder {
  readonly sender: TelegramSender;
  readonly to: (chatId: number) => readonly RecordedMessage[];
  readonly all: () => readonly RecordedMessage[];
  readonly clear: () => void;
}

export function createRecorder(): MessageRecorder {
  const ordered: RecordedMessage[] = [];
  const byChat = new Map<string, RecordedMessage[]>();

  const record = (message: RecordedMessage): string => {
    ordered.push(message);
    const bucket = byChat.get(message.chatId);
    if (bucket === undefined) byChat.set(message.chatId, [message]);
    else bucket.push(message);
    return String(ordered.length);
  };

  return {
    sender: {
      sendMessage: async (chatId, text, markup) => record({ chatId, text, markup }),
      sendPhoto: async (chatId, _fileId, caption, markup) =>
        record({ chatId, text: caption, markup }),
      sendLocation: async (chatId, latitude, longitude) =>
        record({ chatId, text: "", markup: undefined, location: { latitude, longitude } }),
    },
    to: (chatId) => byChat.get(String(chatId)) ?? [],
    all: () => ordered,
    clear: () => {
      ordered.length = 0;
      byChat.clear();
    },
  };
}
