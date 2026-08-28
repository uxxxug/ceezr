/**
 * الغرض: **مَصرِفُ القياسِ** — الحدُّ الذي تنتهي إليه الأحداثُ. وقرارُ مالكِ
 *   المنتجِ في البند `F1-08` أنّ **القياسَ لا يخرج من الجهاز**: فالتنفيذُ
 *   الافتراضيُّ **لا يفعل شيئاً**، وتنفيذُ الذاكرةِ حَلْقةٌ محدودةُ السعةِ تُقرأ
 *   في الاختبارِ ولا تُرسَل ولا تُحفَظ.
 * الحالة: منفّذ فعلياً — البند `F1-08`.
 * ينتمي إلى: apps/miniapp/src/telemetry (حزمة «القياس» — القسم 9.4)
 * يُتوقع أن يستخدمه لاحقاً: مَصرِفٌ ناقلٌ حين تُقرَّر منصةُ القياسِ (`REQ-05`) —
 *   يُضاف ملفّاً جديداً ينفّذ `TelemetrySink` بلا تغييرِ منادٍ واحد.
 * ملاحظات مستقبلية: **لا يُضاف ههنا مَصرِفٌ يكتب في `localStorage` ولا في التخزينِ
 *   الآمنِ**: حدثٌ محفوظٌ على الجهازِ بعدَ إغلاقِ التطبيقِ بيانٌ مُحتفَظٌ به بلا
 *   سياسةِ احتفاظٍ ولا موافقةٍ (القسم 9.12 · 16.2)، وحاجزُ
 *   `scripts/check-telemetry-policy.ts` يمنعه آلياً.
 *
 * ولماذا مَصرِفٌ لا يفعل شيئاً افتراضاً: لأنّ البديلَ أن يُبنى ناقلٌ بلا مستقبِلٍ،
 * فيصير في الجيبِ كودٌ يرسل إلى العدمِ — أو أسوأُ: إلى مزوّدٍ لم يُقرَّر. والبنيةُ
 * تُبنى الآنَ والمستقبِلُ يُوصَل حين يُقرَّر، وذاك هو «البنيةُ قبلَ الشاشات».
 */

import type { TelemetryEvent } from "./events.ts";

export interface TelemetryRecord {
  /** لحظةُ التسجيلِ بالمللي ثانية — من ساعةٍ محقونةٍ لا من `Date.now` مباشرةً. */
  readonly atMs: number;
  readonly event: TelemetryEvent;
}

export interface TelemetrySink {
  record(record: TelemetryRecord): void;
}

/** المَصرِفُ الافتراضيُّ: يستقبل ويُهمِل. لا شبكةَ ولا تخزينَ ولا سطرَ سجلٍّ. */
export const noopSink: TelemetrySink = {
  record: (): void => undefined,
};

export interface MemorySink extends TelemetrySink {
  /** قراءةٌ بلا إفراغٍ — لأنّ الإفراغَ فعلٌ يخفي أخطاءَ الاختبار. */
  readonly entries: () => readonly TelemetryRecord[];
  readonly size: () => number;
  /** عددُ ما أُسقِط بسببِ السعة — يُقرأ كي لا يُظَنَّ أنّ الحَلْقةَ بلا حدّ. */
  readonly dropped: () => number;
}

/**
 * حَلْقةٌ محدودةٌ: عندَ الامتلاءِ **يُسقَط الأقدمُ** ويُحسَب. والحدُّ لازمٌ لا
 * زينةٌ: مصفوفةٌ بلا حدٍّ في تطبيقٍ يعمل ساعةً في جيبٍ ضعيفِ الذاكرةِ تسريبٌ.
 */
export function createMemorySink(capacity: number): MemorySink {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new RangeError("سعةُ مَصرِفِ الذاكرةِ عددٌ صحيحٌ موجبٌ");
  }
  const buffer: TelemetryRecord[] = [];
  let dropped = 0;
  return {
    record: (record: TelemetryRecord): void => {
      buffer.push(record);
      if (buffer.length > capacity) {
        buffer.shift();
        dropped += 1;
      }
    },
    entries: () => [...buffer],
    size: () => buffer.length,
    dropped: () => dropped,
  };
}
