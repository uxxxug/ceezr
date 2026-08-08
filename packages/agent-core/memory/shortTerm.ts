/**
 * الغرض: سياق الحدث الواحد — يُنشأ معه ويُفنى بانتهاء معالجته. لا يُخزَّن، ولا
 *   يُقرأ من حدث آخر، ولا يعبر حدود الطلب إطلاقاً.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.4.
 * ينتمي إلى: packages/agent-core/memory
 * يُتوقع أن يستخدمه لاحقاً: الوكلاء، والمخطِّط، وسجلّ القرار
 * ملاحظات مستقبلية: عند مليار مستخدم يبقى هذا **كما هو تماماً** — سياق الطلب في
 *   ذاكرة العملية التي تعالجه. الطبقة الوحيدة في المعمارية التي لا يغيّرها الحجم،
 *   لأن ما لا يُخزَّن لا يحتاج مخزناً موزَّعاً.
 *
 * ═══ لماذا طبقة مستقلّة رغم بساطتها ═══
 *
 * دمجها في «ملف ذاكرة واحد» — وهو أسهل — يُلغي الفارق الذي وُجدت لأجله: هذه
 * الطبقة **يجب أن تُفقَد**، والطبقتان الأخريان يجب أن تبقيا. ملفٌ واحد يحمل
 * الثلاث يجعل النسيان قراراً في كل سطر بدل أن يكون خاصيةً في البنية، وأول سهو
 * يُسرِّب سياق شكوى مستخدم إلى ذاكرة دائمة.
 */

/** ما يُكتب في السياق: قيم بدائية فقط، كي لا يُحمَل فيه كائن حيّ يعيش بعده. */
export type ShortTermValue = string | number | boolean | null;

export interface ShortTermMemory {
  set(key: string, value: ShortTermValue): void;
  get(key: string): ShortTermValue | undefined;
  /** ملاحظات مرتَّبة زمنياً عمّا جرى في هذه المعالجة — تُقرأ في سجلّ القرار. */
  note(message: string): void;
  readonly notes: () => readonly string[];
  readonly entries: () => Readonly<Record<string, ShortTermValue>>;
  /** يُستدعى في `finally` عند انتهاء المعالجة. بعده الكائن فارغ ولا يُعاد استخدامه. */
  dispose(): void;
}

/**
 * ذاكرة قصيرة لحدث واحد. **لا وسيطة تخزين ولا مسار ملف** — وغيابهما هو التصميم:
 * دالّةٌ لا تستطيع الكتابة على القرص لا يمكن أن تُسرِّب إليه بالسهو.
 */
export function createShortTermMemory(): ShortTermMemory {
  let values = new Map<string, ShortTermValue>();
  let log: string[] = [];
  let disposed = false;

  return {
    set: (key, value) => {
      if (disposed) return;
      values.set(key, value);
    },
    get: (key) => (disposed ? undefined : values.get(key)),
    note: (message) => {
      if (disposed) return;
      log.push(message);
    },
    notes: () => (disposed ? [] : [...log]),
    entries: () => (disposed ? {} : Object.fromEntries(values)),
    dispose: () => {
      disposed = true;
      // إفراغٌ صريح لا اتّكالٌ على جامع القمامة: المرجع قد يبقى محفوظاً في مكانٍ
      // ما، والمطلوب ألّا يبقى **المحتوى** لا ألّا يبقى الكائن.
      values = new Map();
      log = [];
    },
  };
}
