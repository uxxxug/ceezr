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

/**
 * البند 6.3 — الرموز الدلالية في موضع واحد.
 *
 * الرمز في تلغرام هو ما يقوم مقام اللون: لا نملك تلوين زرّ ولا نصّ، والمستخدم
 * يقرأ الرمز قبل الكلمة. فمعنى واحد برمزين معنيان في نظر القارئ.
 *
 * الفحص الذي أوجب هذا: «الرفض» كان يخرج برمزين مختلفين في نفس الشاشة —
 * `driver.offer_reject_button` بـ❌ و`support.reject_button` بـ⛔، و«إيقاف الاستقبال»
 * بـ⛔ مقابل «بدء الاستقبال» بـ✅ فانفصم الزوج الذي يُقرأ معاً. و📍 كان يحمل معنيين
 * معاً: «أرسل موقعك» و«حالة طلبك» — والأول طلبُ فعلٍ والثاني خبرٌ، فاختلاطهما
 * يجعل المستخدم يبحث عن زرّ موقع في تقرير حالة.
 *
 * ما لم يُوحَّد عن قصد: 🛑 (إنهاء اشتراك قائم) و🚫 (تعذّر إيجاد سائق) ليسا رفضاً:
 * الأول إلغاء حقٍّ ثابت والثاني عجزٌ منّا لا قرارٌ ضدّ أحد، ولو حملا ❌ لاستوى
 * زرّ «رفض الطلب» وزرّ «إنهاء الاشتراك» في بطاقة الدعم الواحدة — وهما لا يستويان.
 */
export const SEMANTIC_MARKS = {
  /** قبول، نجاح، تمّ. */
  accept: "✅",
  /** رفض، منع، إيقاف، إلغاء بقرار. */
  reject: "❌",
  /** تتبّع وإخبار بحالة قائمة. */
  track: "ℹ️",
  /** الدعم والشكوى. */
  support: "🆘",
  /** تنبيه: العمل لم يتمّ أو تمّ ناقصاً. */
  warn: "⚠️",
} as const;

export type SemanticIntent = keyof typeof SEMANTIC_MARKS;

/**
 * مفاتيح الترجمة المرتبطة بمعنى دلالي، ليتحقّق منها اختبار في كل اللغات.
 *
 * لماذا خارطة لا قاعدة على المفتاح؟ لأن الاسم لا يدلّ على المعنى دائماً:
 * `support.not_authorized` رفضٌ لا دعم، و`support.not_registered` تنبيهٌ لا رفض.
 * والخارطة تجعل إضافة مفتاح برمز مخالف خطأَ اختبارٍ لا مفاجأةَ شاشة.
 */
export const SEMANTIC_TEXT_INTENTS: Readonly<Record<string, SemanticIntent>> = {
  "driver.offer_accept_button": "accept",
  "driver.offer_reject_button": "reject",
  "group.unsub_accept_button": "accept",
  "menu.driver.available": "accept",
  "menu.driver.unavailable": "reject",
  "menu.rider.cancel": "reject",
  "menu.rider.status": "track",
  "menu.support": "support",
  "negotiation.rider_agree_button": "accept",
  "rating.complete_button": "accept",
  "rider.status_heading": "track",
  "support.action_done_reject": "reject",
  "support.activate_button": "accept",
  "support.help": "support",
  "support.not_authorized": "reject",
  "support.reject_button": "reject",
};

/** رمزٌ لا يجوز أن يظهر في أي نصّ، لأن معناه صار له رمزٌ موحَّد. */
export const RETIRED_MARKS: readonly string[] = ["⛔"];

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
