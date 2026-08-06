/**
 * الغرض: تحويل لوحة أزرار مُجرَّدة إلى شكل تلغرام — الموضع الوحيد الذي يعرف شكل تلغرام.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: apps/gateway/src/bots/shared
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/bots/{driver,rider}/index.ts
 * ملاحظات مستقبلية: أي منصّة أخرى تحصل على محوّل أزرار خاص بها بلا لمس منطق الحوار.
 */

import type { Keyboard } from "../../../../../packages/application/bots/types.ts";

export interface InlineMarkup {
  readonly inline_keyboard: readonly { readonly text: string; readonly callback_data: string }[][];
}

export interface ReplyMarkup {
  readonly keyboard: readonly {
    readonly text: string;
    readonly request_location?: true;
    readonly request_contact?: true;
  }[][];
  readonly resize_keyboard: true;
  readonly one_time_keyboard: true;
}

export interface RemoveMarkup {
  readonly remove_keyboard: true;
}

export type TelegramMarkup = InlineMarkup | ReplyMarkup | RemoveMarkup;

/** تلغرام يقصر callback_data على 64 بايت، فما زاد يُرفض من الخادم لا من عندنا. */
export const MAX_CALLBACK_DATA_BYTES = 64;

export function isCallbackDataValid(data: string): boolean {
  return new TextEncoder().encode(data).length <= MAX_CALLBACK_DATA_BYTES;
}

export function toTelegramMarkup(keyboard: Keyboard | null): TelegramMarkup | undefined {
  if (keyboard === null) return undefined;

  switch (keyboard.kind) {
    case "inline":
      return {
        inline_keyboard: keyboard.rows.map((row) =>
          row.map((button) => ({ text: button.label, callback_data: button.data })),
        ),
      };
    case "reply":
      return {
        keyboard: keyboard.rows.map((row) => row.map((label) => ({ text: label }))),
        resize_keyboard: true,
        one_time_keyboard: true,
      };
    case "request_location":
      return {
        keyboard: [[{ text: keyboard.label, request_location: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      };
    case "request_contact":
      return {
        keyboard: [[{ text: keyboard.label, request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      };
    case "remove":
      return { remove_keyboard: true };
  }
}
