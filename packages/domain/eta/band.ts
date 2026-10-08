/**
 * الغرض: مدى التنبؤِ الصادق (§10.8 · ADR 0243) — دالّةٌ نقيّةٌ تحوِّلُ تقديرَ محرّكِ الطرقِ
 *   ومقياسَ خطئِه **المرصودَ في رحلاتٍ سابقةٍ في المدينةِ نفسِها** إلى مدىً بنسبةِ تغطيةٍ
 *   معلَنة، أو إلى امتناعٍ مُصنَّف. لا نموذجَ مفترَضاً ولا معاملاً مكتوباً باليد.
 * الحالة: منفّذ فعلياً — إغلاقُ فجوةِ UI-8 [C] الثانية.
 * ينتمي إلى: packages/domain/eta
 *
 * ## ما يُقاسُ بالضبط
 *
 * لكلِّ رحلةٍ ولكلِّ ساقٍ (`pickup` حتى ضغطِ السائقِ «وصلت» · `dropoff` حتى إنهاءِ الرحلة)
 * يُحفَظُ **أوّلُ** تقديرٍ عُرِضَ (`predicted_seconds`) ووقتُ عرضِه. وعندَ انتهاءِ الساقِ تُقاسُ
 * النسبةُ: `(لحظةُ الانتهاء − لحظةُ التقدير) / التقدير`. ويُحسَبُ في القاعدةِ على آخرِ
 * الساقاتِ المنتهيةِ في المدينة: عددُها، والمئينُ العاشرُ والتسعون للنسبة.
 *
 * فالمدى = التقديرُ الحاليّ × [م10، م90] — «في 80٪ من الرحلاتِ المرصودةِ وقعَ الانتهاءُ داخلَ
 * مثلِ هذا المدى». وهذا **افتراضٌ معلَنٌ**: أنَّ خطأَ المحرّكِ النسبيَّ في المدينةِ متقاربٌ عبرَ
 * لحظاتِ الرحلة. ودونَ `ETA_BAND_MIN_SAMPLES` ساقاً منتهيةً لا مدى: يُقالُ العددُ المرصودُ والمطلوب.
 */

/** أقلُّ عددِ ساقاتٍ منتهيةٍ يُحسَبُ عليه مدى. دونَه المئينانِ ضجيج. */
export const ETA_BAND_MIN_SAMPLES = 30;

/** نسبةُ التغطيةِ بين المئينِ العاشرِ والتسعين — تُعلَنُ للراكبِ كما هي. */
export const ETA_BAND_COVERAGE_PERCENT = 80;

export type EtaLeg = "pickup" | "dropoff";

/** ما تُعيدُه القاعدةُ عن خطأِ المحرّكِ المرصود. */
export interface EtaErrorStats {
  readonly samples: number;
  readonly lowRatio: number | null;
  readonly highRatio: number | null;
}

export type EtaBandUnavailableReason = "NOT_CONFIGURED" | "STORE_DOWN" | "INVALID_STATS";

export type EtaBand =
  | {
      readonly kind: "MEASURED";
      readonly lowMinutes: number;
      readonly highMinutes: number;
      readonly samples: number;
      readonly coveragePercent: number;
    }
  | { readonly kind: "INSUFFICIENT"; readonly samples: number; readonly required: number }
  | { readonly kind: "UNAVAILABLE"; readonly reason: EtaBandUnavailableReason };

function validCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function validRatio(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

/**
 * التقديرُ بالثواني + الإحصاءُ ⇒ مدىً بالدقائق. الطرفُ الأدنى يُقرَّبُ نزولاً والأعلى صعوداً
 * (المدى لا يضيقُ بالتقريب)، والأدنى دقيقةٌ على الأقلّ.
 */
export function etaBandFrom(predictedSeconds: number, stats: EtaErrorStats): EtaBand {
  if (!Number.isFinite(predictedSeconds) || predictedSeconds <= 0 || !validCount(stats.samples)) {
    return { kind: "UNAVAILABLE", reason: "INVALID_STATS" };
  }
  if (stats.samples < ETA_BAND_MIN_SAMPLES) {
    return { kind: "INSUFFICIENT", samples: stats.samples, required: ETA_BAND_MIN_SAMPLES };
  }
  const { lowRatio, highRatio } = stats;
  if (!validRatio(lowRatio) || !validRatio(highRatio) || lowRatio > highRatio) {
    return { kind: "UNAVAILABLE", reason: "INVALID_STATS" };
  }
  const lowMinutes = Math.max(1, Math.floor((predictedSeconds * lowRatio) / 60));
  const highMinutes = Math.max(lowMinutes, Math.ceil((predictedSeconds * highRatio) / 60));
  return {
    kind: "MEASURED",
    lowMinutes,
    highMinutes,
    samples: stats.samples,
    coveragePercent: ETA_BAND_COVERAGE_PERCENT,
  };
}
