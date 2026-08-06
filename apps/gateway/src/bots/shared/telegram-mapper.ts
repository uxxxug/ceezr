/**
 * الغرض: تحويل تحديث تلغرام الخام إلى تحديث مُجرَّد يفهمه منطق الحوار — وتجاهل ما لا يخصّنا.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: apps/gateway/src/bots/shared
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/bots/{driver,rider}/index.ts
 * ملاحظات مستقبلية: أنواع التحديثات الأخرى (صور المستندات، الاستفتاءات) تُضاف هنا وحدها.
 */

import type { IncomingUpdate, Sender } from "../../../../../packages/application/bots/types.ts";

/** الشكل الجزئي الذي نعتمد عليه فعلاً من تحديث تلغرام — لا نثق ببقية الحقول. */
export interface RawTelegramUpdate {
  readonly message?: {
    readonly chat?: { readonly id?: number | string };
    readonly from?: { readonly id?: number | string; readonly language_code?: string };
    readonly text?: string;
    readonly location?: { readonly latitude?: number; readonly longitude?: number };
    readonly contact?: { readonly phone_number?: string };
  };
  readonly callback_query?: {
    readonly data?: string;
    readonly from?: { readonly id?: number | string; readonly language_code?: string };
    readonly message?: { readonly chat?: { readonly id?: number | string } };
  };
}

function senderFrom(
  userId: number | string | undefined,
  chatId: number | string | undefined,
  languageCode: string | undefined,
): Sender | null {
  if (userId === undefined || chatId === undefined) return null;
  return {
    telegramUserId: String(userId),
    chatId: String(chatId),
    languageHint: languageCode ?? "ar",
  };
}

/**
 * يعيد null لكل تحديث لا نتعامل معه (انضمام عضو، تعديل رسالة، …) بلا خطأ ولا ردّ.
 * تجاهل صريح أفضل من معالجة نصف مفهومة.
 */
export function toIncomingUpdate(raw: RawTelegramUpdate): IncomingUpdate | null {
  if (raw.callback_query !== undefined) {
    const query = raw.callback_query;
    const sender = senderFrom(query.from?.id, query.message?.chat?.id, query.from?.language_code);
    if (sender === null || query.data === undefined || query.data === "") return null;
    return { kind: "callback", from: sender, data: query.data };
  }

  const message = raw.message;
  if (message === undefined) return null;

  const sender = senderFrom(message.from?.id, message.chat?.id, message.from?.language_code);
  if (sender === null) return null;

  const location = message.location;
  if (location?.latitude !== undefined && location.longitude !== undefined) {
    return {
      kind: "location",
      from: sender,
      location: { latitude: location.latitude, longitude: location.longitude },
    };
  }

  const phone = message.contact?.phone_number;
  if (phone !== undefined && phone !== "") {
    return { kind: "contact", from: sender, phone };
  }

  if (message.text !== undefined && message.text.trim() !== "") {
    return { kind: "text", from: sender, text: message.text };
  }

  return { kind: "unsupported", from: sender };
}
