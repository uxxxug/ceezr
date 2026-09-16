/**
 * الغرض: قراءةُ ذاكرةِ العمليّةِ وعمرِها لحظةَ المسحِ (`F8-02` — «ذاكرة»)، بلا
 *   مؤقِّتٍ دوريٍّ وبلا حالةٍ محفوظةٍ: قيمةٌ لحظيّةٌ تُقرأُ عندَ الطلبِ.
 * الحالة: منفّذ فعلياً — طبقة المراقبة التشغيلية.
 * ينتمي إلى: packages/infrastructure/observability
 * يُتوقع أن يستخدمه لاحقاً: `apps/gateway/src/routes/metrics.ts` وعاملُ المهامّ.
 * ملاحظات مستقبلية: عند الحاجةِ إلى تأخُّرِ حلقةِ الأحداثِ يُضافُ مقياسٌ مستقلٌّ لا يُبدَّلُ هذا.
 *
 * ## لماذا **عندَ المسحِ** لا بمؤقِّتٍ
 *
 * مقياسُ الذاكرةِ قيمةٌ لحظيّةٌ (`gauge`): قراءتُها كلَّ ثانيةٍ في مؤقِّتٍ تُنفِقُ
 * عملاً لا يقرأُه أحدٌ بينَ مسحَينِ، وتُدخِلُ خيطَ تشغيلٍ دائماً في عمليّةٍ
 * الغرضُ منها خدمةُ الطلباتِ. فالقراءةُ **عندَ المسحِ** أصدقُ: ما يُنشَرُ هوَ
 * حالُ العمليّةِ لحظةَ سألَ السائلُ.
 *
 * ولا تُقرأُ من `/proc` ولا بأمرٍ خارجيٍّ: `process.memoryUsage.rss()` و
 * `process.memoryUsage()` واجهةُ المُنفِّذِ نفسِه، فلا تفشلُ باختلافِ نظامِ
 * التشغيلِ ولا تفتحُ ملفّاً في مسارِ خدمةٍ.
 */

export interface ProcessMemorySnapshot {
  /** الذاكرةُ المقيمةُ فعلاً بالبايتِ — ما يحاسبُ عليهِ المُشغِّلُ ويقتلُ عندَه. */
  readonly residentBytes: number;
  /** الكومةُ المستعملةُ بالبايتِ — يكشفُ تسريبَ كائناتٍ قبلَ أن يبلغَ الحدَّ. */
  readonly heapUsedBytes: number;
  /** الكومةُ المحجوزةُ كلُّها بالبايتِ. */
  readonly heapTotalBytes: number;
  /** ذاكرةٌ خارجَ الكومةِ (مخازنُ ثنائيّةٌ ومقابسُ) بالبايتِ. */
  readonly externalBytes: number;
  /** عمرُ العمليّةِ بالثواني — يفرِّقُ بينَ نموٍّ في الذاكرةِ وبينَ إعادةِ تشغيلٍ. */
  readonly uptimeSeconds: number;
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * `memoryUsage` و`uptime` يُحقنانِ للاختبارِ وحدَه؛ وللإنتاجِ مصدرٌ واحدٌ هوَ
 * المُنفِّذُ. وقيمةٌ غيرُ محدودةٍ أو سالبةٌ **تصيرُ صفراً** لا `NaN`: نصُّ
 * Prometheus لا يحملُ `NaN` إلّا للـ`summary`، ورقمٌ فاسدٌ في سلسلةٍ يُفسِدُ
 * الاستعلامَ كلَّه على المُجمِّعِ.
 */
export function readProcessMemory(
  memoryUsage: () => NodeJS.MemoryUsage = process.memoryUsage,
  uptime: () => number = process.uptime,
): ProcessMemorySnapshot {
  const usage = memoryUsage();
  return {
    residentBytes: finiteNonNegative(usage.rss),
    heapUsedBytes: finiteNonNegative(usage.heapUsed),
    heapTotalBytes: finiteNonNegative(usage.heapTotal),
    externalBytes: finiteNonNegative(usage.external),
    uptimeSeconds: finiteNonNegative(uptime()),
  };
}
