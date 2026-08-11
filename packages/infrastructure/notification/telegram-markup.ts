/**
 * الغرض: تحويل لوحة أزرار مُجرَّدة إلى شكل تلغرام — الموضع الوحيد الذي يعرف شكل تلغرام.
 * الحالة: منفّذ فعلياً — المرحلة 2.1. نُقِل من apps/gateway في المرحلة 2.6 الخطوة 02
 *   لأن العامل الخلفي ينشر بطاقات قروب أيضاً، ولا يجوز أن يستورد من app آخر.
 * ينتمي إلى: infrastructure/notification
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway، apps/workers
 * ملاحظات مستقبلية: أي منصّة أخرى تحصل على محوّل أزرار خاص بها بلا لمس منطق الحوار.
 */

import type { Keyboard } from "../../application/bots/types.ts";

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
  readonly one_time_keyboard: boolean;
  /**
   * تلغرام يميّز بين حقلين: `one_time_keyboard` يطوي اللوحة بعد الضغطة،
   * و`is_persistent` يمنع إخفاءها أصلاً. وضع الأول `false` وحده لا يكفي:
   * يبقى للمستخدم زرّ طيّ يخفي القائمة فلا يراها بعدها، والمطلوب قائمة لا تغيب.
   */
  readonly is_persistent?: true;
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

/** زرّ طلبٍ (موقع أو رقم) أوّلاً، ثمّ أزرار القائمة الرئيسية تحته إن أُرفقت. */
function requestMarkup(
  button: {
    readonly text: string;
    readonly request_location?: true;
    readonly request_contact?: true;
  },
  menuRows: readonly (readonly string[])[] | undefined,
): ReplyMarkup {
  if (menuRows === undefined || menuRows.length === 0) {
    return { keyboard: [[button]], resize_keyboard: true, one_time_keyboard: true };
  }
  return {
    keyboard: [[button], ...menuRows.map((row) => row.map((label) => ({ text: label })))],
    resize_keyboard: true,
    one_time_keyboard: false,
    is_persistent: true,
  };
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
      return keyboard.persistent === true
        ? {
            keyboard: keyboard.rows.map((row) => row.map((label) => ({ text: label }))),
            resize_keyboard: true,
            one_time_keyboard: false,
            is_persistent: true,
          }
        : {
            keyboard: keyboard.rows.map((row) => row.map((label) => ({ text: label }))),
            resize_keyboard: true,
            one_time_keyboard: true,
          };
    // البند 4.3: القائمة المرفقة تجعل اللوحة دائمةً لا لمرّة: زرّ الدعم لا يجوز
    // أن يطويه إرسال موقع، وإرسال الموقع نفسه قد يُعاد (موقع خارج المدينة يُرفض).
    case "request_location":
      return requestMarkup({ text: keyboard.label, request_location: true }, keyboard.menuRows);
    case "request_contact":
      return requestMarkup({ text: keyboard.label, request_contact: true }, keyboard.menuRows);
    case "remove":
      return { remove_keyboard: true };
  }
}
