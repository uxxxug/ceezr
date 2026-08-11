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
  // البند 2.4: المنطقة المفضّلة زرٌّ دائم لا خطوةَ تسجيلٍ وحدها — سائقو القاعدة
  // كلّهم سجّلوا قبل وجودها، ومن غيّر حيّه يحتاج تغييرها بعد شهور من تسجيله.
  { key: "menu.driver.area", command: "/area" },
  { key: "menu.language", command: "/language" },
  { key: "menu.support", command: "/support" },
];

/** أزرار بوت العميل — بنفس قاعدة «لا زرّ بلا أمر قائم». */
export const RIDER_MENU_ITEMS: readonly MenuItem[] = [
  { key: "menu.rider.ride", command: "/ride" },
  { key: "menu.rider.delivery", command: "/delivery" },
  { key: "menu.rider.cancel", command: "/cancel" },
  { key: "menu.rider.history", command: "/history" },
  { key: "menu.language", command: "/language" },
  { key: "menu.support", command: "/support" },
];

/**
 * زرّ التتبّع: يُضمّ إلى قائمة العميل متى كان له طلب نشط (البند 2.2).
 *
 * لماذا مشروطاً لا دائماً؟ لأن «أين سائقي؟» معروضاً على من لا طلب له يدعو
 * إلى ضغطة جوابها الوحيد «لا يوجد طلب» — فتصير القائمة مربكة لا مرشدة. ومع ذلك
 * تُطابق نصوصه دائماً في `commandForMenuText`، فلوحة قديمة باقية على جهاز العميل
 * بعد انتهاء طلبه تبقى مفهومة وتردّ بجواب صحيح.
 */
export const RIDER_ORDER_MENU_ITEMS: readonly MenuItem[] = [
  { key: "menu.rider.status", command: "/status" },
];

export type BotAudience = "driver" | "rider";

/** ما يُضاف إلى القائمة تبعاً لحال المستخدم لحظةَ بناء اللوحة. */
export interface MenuContext {
  /** للعميل طلب في searching أو matched أو in_progress. */
  readonly hasActiveOrder?: boolean;
}

export function menuItemsFor(
  audience: BotAudience,
  context: MenuContext = {},
): readonly MenuItem[] {
  if (audience === "driver") return DRIVER_MENU_ITEMS;
  return context.hasActiveOrder === true
    ? [...RIDER_ORDER_MENU_ITEMS, ...RIDER_MENU_ITEMS]
    : RIDER_MENU_ITEMS;
}

/** كل ما يُحتمل أن يكون قد عُرِض زرّاً لهذا الجمهور يوماً — للمطابقة والتسجيل. */
export function allItemsFor(audience: BotAudience): readonly MenuItem[] {
  return audience === "driver"
    ? DRIVER_MENU_ITEMS
    : [...RIDER_ORDER_MENU_ITEMS, ...RIDER_MENU_ITEMS];
}

/**
 * القائمة الدائمة بلغة المستخدم، صفّين لكل صفٍّ زرّان.
 *
 * لماذا زرّان في الصفّ لا واحد؟ لأن لوحة بستّة صفوف تغطّي الشاشة على الهاتف فتخفي
 * المحادثة نفسها، فيغلقها المستخدم — فتضيع الفائدة كلّها. وثلاثة في الصفّ تقطع النصّ
 * العربي في منتصفه على الشاشات الضيّقة.
 */
export function mainMenuKeyboard(
  audience: BotAudience,
  language: string,
  context: MenuContext = {},
): Keyboard {
  return { kind: "reply", rows: menuRowsFor(audience, language, context), persistent: true };
}

/** أزرار القائمة صفوفاً — لتُرفَق تحت زرّ طلب موقع أو رقم أيضاً. */
function menuRowsFor(
  audience: BotAudience,
  language: string,
  context: MenuContext = {},
): readonly (readonly string[])[] {
  const tr = t(language);
  const labels = menuItemsFor(audience, context).map((item) => tr(item.key));
  const rows: string[][] = [];
  for (let index = 0; index < labels.length; index += 2) {
    rows.push(labels.slice(index, index + 2).filter((label) => label !== undefined));
  }
  return rows;
}

/**
 * طلب موقع أو رقم **مع** القائمة الرئيسية تحته — البند 4.3.
 *
 * لوحة الردّ في تلغرام واحدة لا تتراكم: لوحة فيها زرّ «أرسل موقعي» وحده تمحو
 * القائمة الدائمة من أسفل الشاشة. وخطوات الطلب والتسجيل هي أطول ما يمرّ به
 * المستخدم وأكثر مواضع تعثّره — فكان زرّ الدعم يغيب في اللحظة التي يُطلب فيها.
 */
export function requestWithMenuKeyboard(
  request: { readonly kind: "request_location" | "request_contact"; readonly label: string },
  audience: BotAudience,
  language: string,
  context: MenuContext = {},
): Keyboard {
  return {
    kind: request.kind,
    label: request.label,
    menuRows: menuRowsFor(audience, language, context),
  };
}

/**
 * بادئة زرّ أمرٍ inline — البند 6.3.
 *
 * لوحة الردّ الدائمة تُرسل نصّ الزرّ، ولوحة inline تُرسل `callback_data`. فلوحتان
 * لمعنى واحد تحتاجان مدخلين، وهما لا يجوز أن يتفرّقا: من هنا تُبنى لوحة
 * inline من نفس `allItemsFor` التي تبني الدائمة وتسجّل `setMyCommands`.
 */
export const COMMAND_CALLBACK_PREFIX = "cmd";

/**
 * لوحة inline بكلّ أوامر البوت — تُستعمل في `/help`.
 *
 * العطب الذي أوجبها: نصّ `driver.help` و`rider.help` كان قائمة أوامر مكتوبة
 * يداً في القاموس، فصار لقائمة الأوامر مصدران. وقد تباعدا فعلاً: «الدعم / شكوى»
 * أُضيف في البند 2.1 و«أين طلبي؟» في البند 2.2، ولم يذكرهما نصّ `/help` في أي لغة —
 * فمن لجأ إلى `/help` يسأل «كيف أشتكي؟» خرج منه ولم يعلم أنّ للشكوى زرّاً.
 * ونسخة الأردية من `driver.help` كانت إنجليزية غير مترجمة أصلاً.
 *
 * ولماذا inline لا نصّ؟ لأن قائمة الأوامر نصّاً تطلب من المستخدم أن يكتب أمراً
 * له زرّ أصلاً — وهو ما تعطّل فيه من لا يقرأ الإنجليزية ولا يعرف معنى «/available».
 */
export function helpKeyboard(
  audience: BotAudience,
  language: string,
  context: MenuContext = {},
): Keyboard {
  const tr = t(language);
  const items = menuItemsFor(audience, context);
  const rows: { readonly label: string; readonly data: string }[][] = [];
  for (let index = 0; index < items.length; index += 2) {
    rows.push(
      items.slice(index, index + 2).map((item) => ({
        label: tr(item.key),
        data: `${COMMAND_CALLBACK_PREFIX}:${item.command}`,
      })),
    );
  }
  return { kind: "inline", rows };
}

/**
 * أمرٌ قادم من زرّ `cmd:` لا يُنفّذ حتّى يُعرف أنّه من أوامر هذا الجمهور.
 *
 * `callback_data` يأتي من جهاز المستخدم لا منّا، فتمريره إلى موجّه الأوامر بلا تدقيق
 * يعني أنّ من يصنع زرّاً بيده ينادي أي أمر، ومنها أوامر الجمهور الآخر.
 */
export function isMenuCommand(audience: BotAudience, command: string): boolean {
  return allItemsFor(audience).some((item) => item.command === command);
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

  for (const item of allItemsFor(audience)) {
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
  // قائمة تلغرام الرسمية تُسجّل مرّة للبوت كلّه لا لكل مستخدم بحاله، فتضمّ المشروط أيضاً
  const fromMenu = allItemsFor(audience).map((item) => ({
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
