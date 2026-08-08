/**
 * الغرض: فحص كل حدث قبل أن يلمسه أي منطق. آخر نقطة يمكن فيها رفض المُدخَل بلا
 *   كلفة، وأوّل نقطة يستحيل بعدها الادّعاء أن المُدخَل «موثوق».
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.6.
 * ينتمي إلى: packages/agent-core/guardrails
 * يُتوقع أن يستخدمه لاحقاً: core.ts (أوّل خطوة على الإطلاق)
 * ملاحظات مستقبلية: عند مليار مستخدم يُضاف كشف الحقن (prompt injection) وتحديد
 *   معدّل لكل مصدر. **العقد `GuardVerdict` هو نفسه** — تُضاف قواعد لا يتغيّر شكل
 *   الحكم.
 *
 * ═══ لماذا هذه الطبقة لا تصغر ═══
 *
 * الأمان لا يُقاس بحجم المشروع بل بما يمكن أن يقع. مشروعٌ صغير بحارسٍ صغير يقع
 * فيه ما يقع في الكبير تماماً — الفرق أن الصغير لا يملك من يكتشفه. ولذلك هذه
 * الطبقة **مكتوبة بحجمها النهائي من اليوم**، ولا تُختصر «لأن الحجم لا يستدعي».
 */

import type { EventPayload } from "../schemas.ts";
import { isEventType } from "../schemas.ts";

export interface GuardVerdict {
  readonly allowed: boolean;
  /** سبب الرفض. `null` عند القبول. */
  readonly reason: string | null;
  /** الحدث بعد التنظيف — قد يختلف عن الداخل حتى مع القبول. */
  readonly sanitized: EventPayload;
  /** ما عُدِّل بلا رفض. يُسجَّل، لأن تنظيفاً صامتاً يُخفي مصدراً يُرسل خطأً باستمرار. */
  readonly adjustments: readonly string[];
}

export interface InputGuardOptions {
  readonly maxTextLength: number;
  readonly maxAttributes: number;
  readonly maxAttributeLength: number;
}

export const DEFAULT_INPUT_GUARD_OPTIONS: InputGuardOptions = {
  maxTextLength: 4000,
  maxAttributes: 32,
  maxAttributeLength: 512,
};

/**
 * محارف تحكّم غير مرئية. تُحذف صامتةً: لا معنى لها في نصّ بشري، ولها معنى في هجوم.
 *
 * قاعدة biome تمنع محارف التحكّم داخل التعابير لأنّ وجودها فيها غالباً سهو. وهذا
 * الموضع هو **الاستثناء الذي من أجله وُجد الحارس**: مطابقتها هي المقصودة لا العرَض.
 * يُكتم هنا وحده بتعليل، ولا تُضعَف القاعدة للمستودع كلّه.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: حذف محارف التحكّم هو عَين وظيفة هذا الحارس
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
/** محارف اتجاه ثنائي تُخفي نصّاً عن قارئه البشري بينما تُبقيه في البيانات. */
const BIDI_OVERRIDES = /[\u202A-\u202E\u2066-\u2069]/g;

function sanitizeText(value: string): { text: string; changed: boolean } {
  const cleaned = value.replace(CONTROL_CHARS, "").replace(BIDI_OVERRIDES, "").trim();
  return { text: cleaned, changed: cleaned !== value };
}

function reject(event: EventPayload, reason: string): GuardVerdict {
  return { allowed: false, reason, sanitized: event, adjustments: [] };
}

/**
 * يفحص ثم ينظّف. **الرفض للبنية، والقصّ للحجم**: حدثٌ بلا معرّف أو بنوع مجهول
 * لا يُصلَح بالتنظيف فيُرفَض؛ ونصٌّ طويل يُقصّ ولا يُرفض، لأن شكوى طويلة شكوى
 * صحيحة، ورفضها يخسر بلاغاً حقيقياً لأجل حدٍّ تقني.
 */
export function inspectInput(
  event: EventPayload,
  overrides: Partial<InputGuardOptions> = {},
): GuardVerdict {
  const options: InputGuardOptions = { ...DEFAULT_INPUT_GUARD_OPTIONS, ...overrides };

  if (typeof event.eventId !== "string" || event.eventId.trim() === "") {
    return reject(event, "حدث بلا معرّف");
  }
  if (!isEventType(event.eventType)) {
    return reject(event, `نوع حدث مجهول: ${String(event.eventType)}`);
  }
  if (typeof event.source !== "string" || event.source.trim() === "") {
    return reject(event, "حدث بلا مصدر");
  }
  if (typeof event.text !== "string") {
    return reject(event, "نصّ الحدث ليس نصّاً");
  }
  if (Number.isNaN(Date.parse(event.occurredAt))) {
    return reject(event, "طابع زمني غير صالح");
  }

  const adjustments: string[] = [];
  const { text: cleaned, changed } = sanitizeText(event.text);
  if (changed) adjustments.push("حُذفت محارف تحكّم أو توجيه من النصّ");

  let text = cleaned;
  if (text.length > options.maxTextLength) {
    text = text.slice(0, options.maxTextLength);
    adjustments.push(`قُصّ النصّ إلى ${options.maxTextLength} محرفاً`);
  }

  // نصٌّ فارغ **ليس رفضاً**: تذكرة بلا نصّ تذكرة صحيحة يفتحها من لا يعرف ما يكتب.
  // الوكيل سيعجز عن تصنيفها فيعود بثقة صفر، وهذا هو التصرّف الصحيح لا الرفض.
  if (text === "") adjustments.push("نصّ فارغ — يُتوقّع عجز الوكيل عن التصنيف");

  const rawAttributes = Object.entries(event.attributes ?? {});

  // كثرة الحقول **رفضٌ لا قصّ**، خلافاً للنصّ. فالنصّ الطويل شكوى إنسان إذا قُصّت
  // بقي معناها؛ أمّا مائة حقل فليست حدثاً كبيراً بل **مستدعٍ يمرّر كائن دومين كاملاً**
  // عبر باب صُمّم لحقول بدائية معدودة — وهو خرقٌ للقيد المعماري لا تجاوزٌ لحجم.
  // قصُّه صامتاً يُخفي الخرق فيستقرّ، ورفضُه يُظهره وثمنُ إظهاره اقتراحٌ لم يُعرَض.
  if (rawAttributes.length > options.maxAttributes) {
    return reject(event, `حقول إضافية أكثر من ${options.maxAttributes} — يُرجّح تمرير كائن دومين`);
  }

  const attributes: Record<string, string> = {};
  let dropped = 0;
  for (const [key, raw] of rawAttributes) {
    // `EventPayload` يسمح بـ string | number | boolean | null. إسقاط غير النصّي
    // كان يبتلع `city_id: null` وأي رقم صامتاً — تُطبَّع البدائية ويُسقَط ما عداها.
    if (raw === null) continue; // غياب قيمة ليس خطأً ولا يُعدّ إسقاطاً
    if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") {
      dropped += 1;
      continue;
    }
    const value = sanitizeText(String(raw)).text;
    attributes[key] =
      value.length > options.maxAttributeLength
        ? value.slice(0, options.maxAttributeLength)
        : value;
  }
  if (dropped > 0) adjustments.push(`أُسقطت ${dropped} خاصية غير بدائية`);

  return {
    allowed: true,
    reason: null,
    sanitized: { ...event, text, attributes },
    adjustments,
  };
}
