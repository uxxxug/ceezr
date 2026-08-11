/**
 * الغرض: القائمة الرئيسية الدائمة للبوتين، وترجمة نصّ الزرّ المضغوط إلى أمر.
 *   لوحة الأزرار الدائمة في تلغرام (Reply Keyboard) لا تُرسل بيانات كأزرار inline:
 *   تُرسل **نصّ الزرّ حرفياً** كأنّ المستخدم كتبه. فالزرّ بلا مُترجِم نصٍّ إلى أمر
 *   يعطي «لم أفهم هذه الرسالة» — وهو أسوأ من غياب الزرّ لأنه يبدو عطباً.
 * الحالة: منفّذ فعلياً — البند 2.1 و2.2 و4.3.
 * ينتمي إلى: application/bots
 * يُتوقع أن يستخدمه لاحقاً: driver-dialog، rider-dialog، setMyCommands في البوابة
 * ملاحظات مستقبلية: أي زرّ جديد يُضاف في MENU_ITEMS وحده، فيصير مترجَماً ومفهوماً معاً.
 */

import { t } from "../../shared/i18n/index.ts";
import { getSupportedLanguages } from "../i18n-translation/index.ts";
import type { Keyboard } from "./types.ts";

/**
 * بند قائمة واحد: مفتاح ترجمة نصّه، والأمر الذي يكافئه.
 * الربط في مكان واحد هو الضمانة: زرٌّ يُضاف بلا أمر يصير خطأ ترجمة لا مفاجأة إنتاج.
 */
export interface MenuItem {
  readonly key: string;
  readonly command: string;
}

/**
 * أزرار بوت السائق. الترتيب مقصود: الأكثر استعمالاً أعلى، والدعم أخيراً.
 * ولا يُدرج هنا أمر لا وجود له في الحوار بعد: زرّ يُردّ عليه «لم أفهم» أسوأ
 * من غياب الزرّ، لأنه يبدو عطباً لا ميزةً غير مكتملة. ما يُضاف في بند لاحق
 * يُدرج مع تنفيذه لا قبله.
 */
export const DRIVER_MENU_ITEMS: readonly MenuItem[] = [
  { key: "menu.driver.available", command: "/available" },
  { key: "menu.driver.unavailable", command: "/unavailable" },
  { key: "menu.driver.subscription", command: "/subscription" },
  { key: "menu.language", command: "/language" },
  { key: "menu.support", command: "/support" },
];

/** أزرار بوت العميل — بنفس قاعدة «لا زرّ بلا أمر قائم». */
export const RIDER_MENU_ITEMS: readonly MenuItem[] = [
  { key: "menu.rider.ride", command: "/ride" },
  { key: "menu.rider.delivery", command: "/delivery" },
  { key: "menu.rider.cancel", command: "/cancel" },
  { key: "menu.language", command: "/language" },
  { key: "menu.support", command: "/support" },
];

export type BotAudience = "driver" | "rider";

export function menuItemsFor(audience: BotAudience): readonly MenuItem[] {
  return audience === "driver" ? DRIVER_MENU_ITEMS : RIDER_MENU_ITEMS;
}

/**
 * القائمة الدائمة بلغة المستخدم، صفّين لكل صفٍّ زرّان.
 *
 * لماذا زرّان في الصفّ لا واحد؟ لأن لوحة بستّة صفوف تغطّي الشاشة على الهاتف فتخفي
 * المحادثة نفسها، فيغلقها المستخدم — فتضيع الفائدة كلّها. وثلاثة في الصفّ تقطع النصّ
 * العربي في منتصفه على الشاشات الضيّقة.
 */
export function mainMenuKeyboard(audience: BotAudience, language: string): Keyboard {
  const tr = t(language);
  const labels = menuItemsFor(audience).map((item) => tr(item.key));
  const rows: string[][] = [];
  for (let index = 0; index < labels.length; index += 2) {
    rows.push(labels.slice(index, index + 2).filter((label) => label !== undefined));
  }
  return { kind: "reply", rows, persistent: true };
}

/**
 * يترجم نصّاً وصل من المستخدم إلى أمر، إن كان نصّ زرّ قائمة **بأي لغة مدعومة**.
 *
 * لماذا كل اللغات لا لغة الجلسة وحدها؟ لأن الحالة الحقيقية التي تكسر غير ذلك: مستخدم
 * تظهر عنده القائمة بالعربية، ثم يغيّر لغته إلى الإنجليزية، فتبقى اللوحة القديمة معروضة
 * على جهازه حتى تُستبدل برسالة تالية تحمل لوحة جديدة. فإن ضغط زرّاً عربياً وجلسته
 * إنجليزية ولم نفهمه إلا بلغة الجلسة، رأى «لم أفهم هذه الرسالة» بعد تغيير اللغة مباشرة —
 * فيظنّ أن تغيير اللغة أعطب البوت. المطابقة على كل اللغات تجعل كل زرٍّ سبق عرضه صالحاً.
 */
export function commandForMenuText(audience: BotAudience, text: string): string | null {
  const needle = text.trim();
  if (needle.length === 0) return null;

  for (const item of menuItemsFor(audience)) {
    for (const option of getSupportedLanguages()) {
      if (t(option.code)(item.key) === needle) return item.command;
    }
  }
  return null;
}

/**
 * أوامر البوت لتسجيلها في `setMyCommands`، فتظهر في قائمة تلغرام الرسمية أيضاً.
 * الوصف يُقرأ من نفس مفاتيح الترجمة، فلا يتباعد نصّ الزرّ عن وصف الأمر.
 */
export function botCommandsFor(
  audience: BotAudience,
  language: string,
): readonly { readonly command: string; readonly description: string }[] {
  const tr = t(language);
  const fromMenu = menuItemsFor(audience).map((item) => ({
    // تلغرام يرفض الشرطة المائلة في اسم الأمر المُسجَّل
    command: item.command.slice(1),
    description: tr(`${item.key}.description`),
  }));
  return [
    { command: "start", description: tr("menu.start.description") },
    ...fromMenu,
    { command: "help", description: tr("menu.help.description") },
  ];
}
