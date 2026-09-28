/**
 * الغرض: قياسُ **مسافةِ الأثرِ المسجَّلِ** لرحلةٍ منتهيةٍ من نقاطِ
 *   `driver_location_history` المقبولةِ داخلَ نافذةِ الرحلةِ — دالّةٌ صرفةٌ
 *   واحدةٌ لا تقرأُ قاعدةً ولا ساعةً ولا إعداداً (البند `F2-07` · `ADR 0208`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-07` (الشقُّ المملوكُ للمستودَعِ).
 * ينتمي إلى: domain/geo
 * يُستخدم من: `application/transport/read-ride-summary.ts`
 * ملاحظات مستقبلية: لا يُخزَّنُ ناتجُها في هذا القرارِ (لا مخطَّطَ — `ADR 0208`
 *   §٧): يُحسَبُ عندَ القراءةِ، فيصيرُ `history_expired` بعدَ النافذةِ الساخنةِ.
 *   وتثبيتُه لقطةً عندَ الإتمامِ قرارٌ لاحقٌ بمخطَّطٍ لا يُفترَضُ ههنا.
 *
 * ## لماذا دالّةٌ صرفةٌ في النطاقِ لا استعلامُ SQL
 *
 * `ADR 0208` §٣: العتبةُ والمسافةُ مصدرُهما واحدٌ — `haversineKm` هيَ الدالّةُ
 * نفسُها التي يحكمُ بها `assessGpsFix` على القفزةِ، و`DEFAULT_GPS_POLICY`
 * هيَ عتبةُ `ACCURACY_COARSE` نفسُها مقروءةً من الثابتِ لا منسوخةً رقماً. ولو
 * حُسِبَ في SQL لَنُسِخَت العتبةُ في موضعٍ ثانٍ فتباعدَت عن حكمِها عندَ أوّلِ
 * تصحيحٍ. القاعدةُ تُعيدُ الصفوفَ فقط بمنفذِ قراءةٍ ضيّقٍ، والحكمُ ههنا.
 *
 * ## ولماذا غيرُ مقيسٍ **اتّحادٌ مُسمّىً** لا صفرٌ
 *
 * «لم نقِس» و«لم يتحرّك» خبرانِ مختلفانِ: صفرٌ يُقرأُ الثانيةَ وهوُ الأولى.
 * وكلُّ سببٍ مُسمّىً يُقالُ نصّاً في السطحِ لا يُطوى في خانةٍ فارغةٍ.
 *
 * ## وما لا تفعله هذه الدالّةُ عن قصدٍ
 *
 *   ــ **لا تُعيدُ تقييمَ إصلاحةٍ**: الحكمُ مخزَّنٌ مع الصفِّ (`quality` ·
 *      `accuracy_m` · `ADR 0015`) — `ALERT` يُستبعَدُ، و`REJECT` لا يبلغُ الأثرَ
 *      أصلاً (`ADR 0074` §٧). لا مُقيِّمَ ثانياً (`ADR 0053` §٦).
 *   ــ **لا تصلُ فجوةً بوترٍ**: فرقٌ زمنيٌّ فوقَ الحدِّ `G` ⇒ الرحلةُ كلُّها
 *      غيرُ مقيسةٍ بسببِه، ولا مجموعٌ جزئيٌّ يُنشَرُ باسمِ المسافةِ.
 *   ــ **لا تضيفُ قطعاً من حافّةِ النافذةِ**: الموضعُ عندَ الحافّةِ غيرُ معلومٍ؛
 *      لكنَّ الحافّةَ نفسَها تُفحَصُ (`leading_gap` · `trailing_gap`).
 *   ــ **لا تعرفُ مالاً ولا أجرةً** (`DEC-11` · `ADR 0039` §٤): رقمٌ للعرضِ
 *      وحسب، ولا يُشتَقُّ منه مبلغٌ ولا إيصالٌ.
 */

import { DEFAULT_GPS_POLICY } from "./gps-fix.ts";
import { haversineKm } from "./index.ts";
import type { Coordinates } from "./value-objects.ts";

/** نقطةُ أثرٍ كما تُقرأُ من `driver_location_history` — بلا تفسيرٍ. */
export interface TravelledTracePoint {
  readonly recordedAtMs: number;
  readonly latitude: number;
  readonly longitude: number;
  /** حكمُ GPS المخزَّنُ مع الصفِّ: `ACCEPT` · `WARNING` · `ALERT` (· `REJECT` لا يبلغُ الأثرَ). */
  readonly quality: string;
  /** نصفُ قطرِ عدمِ اليقينِ بالأمتارِ — `null` مجهولٌ فلا تُحمَلُ عليه مسافةٌ. */
  readonly accuracyMeters: number | null;
}

/**
 * أسبابُ عدمِ القياسِ — قائمةٌ مغلقةٌ كما في `ADR 0208` §٦، وسببٌ سابعٌ
 * تُلزِمُه الجملةُ نفسُها: «ويُقرأُ من `platform_settings` وغيابُه عطلٌ مُسمّىً
 * لا افتراضٌ» — فغيابُ سقفِ الفجوةِ يُقالُ باسمِه ولا يُفترَضُ رقمٌ.
 */
export type TravelledDistanceReason =
  | "no_history"
  | "insufficient_points"
  | "gap_exceeded"
  | "leading_gap"
  | "trailing_gap"
  | "history_expired"
  | "gap_limit_setting_missing";

/** ما استُبعِدَ من الحسابِ ولماذا — يُنشَرُ مع القياسِ لا يُخفى. */
export interface TravelledDistanceExclusions {
  /** إصلاحاتٌ حكمُها `ALERT` (أو حكمٌ لا يُعرفُ) — قفزةٌ أو سرعةٌ غيرُ معقولةٍ. */
  readonly alert: number;
  /** دقّتُها أخشنُ من عتبةِ `ACCURACY_COARSE` نفسِها. */
  readonly coarse: number;
  /** دقّتُها غائبةٌ — نصفُ قطرِ الارتعاشِ مجهولٌ. */
  readonly noAccuracy: number;
}

export type TravelledDistance =
  | {
      readonly kind: "measured";
      /** أمتارٌ — مجموعُ Haversine بينَ النقاطِ الصالحةِ المتتابعةِ بعدَ قاعدةِ الارتعاشِ. */
      readonly meters: number;
      /** النقاطُ التي دخلَت الحسابَ (المراسي وما حُسِبَ بعدَها). */
      readonly usablePoints: number;
      readonly excluded: TravelledDistanceExclusions;
    }
  | {
      readonly kind: "unmeasured";
      readonly reason: TravelledDistanceReason;
      /** معَ `gap_exceeded`: طولُ أكبرِ فجوةٍ بالثواني — الدليلُ يُنشَرُ لا يُكتَمَ. */
      readonly largestGapSeconds?: number;
    };

/** مُدخلاتُ القياسِ — النافذةُ والحدُّ والآنَ من خارجَ الدالّةِ الصرفةِ. */
export interface TravelledDistanceInput {
  /**
   * نقاطُ الأثرِ كما قُرئَت — الدالّةُ نفسُها تُخرِجُ ما خارجَ النافذةِ، فلا
   * يعتمدَ صدقُها على دقّةِ الاستعلامِ الذي جاءَ بها.
   */
  readonly points: readonly TravelledTracePoint[];
  readonly startedAtMs: number;
  readonly completedAtMs: number;
  /** الحدُّ `G` — `driver_location_hot_ttl_seconds` لمدينةِ الرحلةِ (`ADR 0208` §٥). */
  readonly gapLimitSeconds: number | null;
  /** «الآنَ» لفحصِ انقضاءِ النافذةِ الساخنةِ (`history_expired`). */
  readonly nowMs: number;
  /** عمرُ الأثرِ الساخنِ بالأيامِ — `DEC_15.locationHotDays`. */
  readonly hotWindowDays: number;
}

/** هل الحكمُ المخزَّنُ يُدخِلُ النقطةَ حسابَ المسافةِ؟ `REJECT` لا يبلغُ الأثرَ أصلاً. */
function isAcceptableQuality(quality: string): boolean {
  return quality === "ACCEPT" || quality === "WARNING";
}

/**
 * قياسُ مسافةِ الأثرِ المسجَّلِ داخلَ نافذةِ الرحلةِ (`ADR 0208` §١–§٦).
 *
 * ترتيبُ الأحكامِ مقصودٌ ومُعلَنٌ: سقفُ الفجوةِ غائبٌ عطلٌ مُسمّىً أوّلاً، ثمَّ
 * الانقضاءُ، ثمَّ الغيابُ، ثمَّ عدمُ الكفايةِ، ثمَّ الفجواتُ (الداخليّةُ أوّلاً
 * لأنَّها تحملُ الدليلَ، فالحافّتانِ)، ثمَّ القياسُ بقاعدةِ المرساةِ.
 */
export function travelledDistanceFromTrace(input: TravelledDistanceInput): TravelledDistance {
  const { startedAtMs, completedAtMs, nowMs, hotWindowDays } = input;
  const gapLimitMs = input.gapLimitSeconds === null ? null : input.gapLimitSeconds * 1000;

  // غيابُ سقفِ الفجوةِ عطلٌ مُسمّىً لا افتراضٌ (`ADR 0208` §٥): لا يُخترَعُ
  // رقمٌ ثانٍ، ولا تُقاسَ مسافةٌ بلا حدٍّ يَحكُمُ وصلَ النقاطِ.
  if (gapLimitMs === null || gapLimitMs <= 0) {
    return { kind: "unmeasured", reason: "gap_limit_setting_missing" };
  }

  // النافذةُ من بدءِ الرحلةِ إلى إتمامِها وحدَها — لا تاريخُ السائقِ (`§١`).
  const inWindow = input.points.filter(
    (point) => point.recordedAtMs >= startedAtMs && point.recordedAtMs <= completedAtMs,
  );

  const hotWindowMs = hotWindowDays * 24 * 60 * 60 * 1000;
  const expired = completedAtMs < nowMs - hotWindowMs;

  if (inWindow.length === 0) {
    // القولُ «لا تاريخَ» عن رحلةٍ أقدمَ من النافذةِ الساخنةِ كذبٌ: الأثرُ
    // أُرشِفَ (`ADR 0075` · `DEC_15`) — يُقالَ الانقضاءُ لا الغيابُ.
    return { kind: "unmeasured", reason: expired ? "history_expired" : "no_history" };
  }

  // الصلاحيّةُ حكمُ GPS المخزَّنُ لا مُقيِّمٌ ثانٍ (`§٣`): `ALERT` يُستبعَدُ،
  // والخشنُ فوقَ عتبةِ `ACCURACY_COARSE` نفسِها يُستبعَدُ، وبلا دقّةٍ لا تُحمَلُ
  // مسافةٌ على نصفِ قطرٍ مجهولٍ.
  const excluded: { alert: number; coarse: number; noAccuracy: number } = {
    alert: 0,
    coarse: 0,
    noAccuracy: 0,
  };
  const usable: TravelledTracePoint[] = [];
  for (const point of inWindow) {
    if (!isAcceptableQuality(point.quality)) {
      excluded.alert += 1;
      continue;
    }
    if (point.accuracyMeters === null) {
      excluded.noAccuracy += 1;
      continue;
    }
    if (point.accuracyMeters > DEFAULT_GPS_POLICY.maxAccuracyMeters) {
      excluded.coarse += 1;
      continue;
    }
    usable.push(point);
  }

  if (usable.length < 2) {
    return { kind: "unmeasured", reason: "insufficient_points" };
  }

  // الفجواتُ — لا وصلَ صامتاً (`§٥`): الداخليّةُ أوّلاً ومعَها الدليلُ، ثمَّ
  // حافّتا البدءِ والإتمامِ. وكلُّ واحدٍ منها يُسقِطُ الرحلةَ كلَّها لا جزءاً منها.
  let largestInternalGapMs = 0;
  for (let index = 1; index < usable.length; index += 1) {
    const gap = (usable[index]?.recordedAtMs ?? 0) - (usable[index - 1]?.recordedAtMs ?? 0);
    if (gap > largestInternalGapMs) largestInternalGapMs = gap;
  }
  if (largestInternalGapMs > gapLimitMs) {
    return {
      kind: "unmeasured",
      reason: "gap_exceeded",
      largestGapSeconds: largestInternalGapMs / 1000,
    };
  }
  const firstUsableMs = usable[0]?.recordedAtMs ?? 0;
  const lastUsableMs = usable[usable.length - 1]?.recordedAtMs ?? 0;
  if (firstUsableMs - startedAtMs > gapLimitMs) {
    return { kind: "unmeasured", reason: "leading_gap" };
  }
  if (completedAtMs - lastUsableMs > gapLimitMs) {
    return { kind: "unmeasured", reason: "trailing_gap" };
  }

  // قاعدةُ المرساةِ (`§٤`): تبدأُ بأوّلِ نقطةٍ صالحةٍ، والتاليةُ تُحتسَبُ إذا
  // تجاوزَ بعدُها عن المرساةِ نصفَ قطرِ عدمِ اليقينِ الأكبرَ للنقطتَينِ — فتُضافُ
  // المسافةُ وتصيرُ هيَ المرساةَ؛ وإلّا فهيَ ارتعاشٌ لا يُحرِّكُ المرساةَ ولا
  // يُراكِمُ أمتاراً. والسائقُ الواقفُ يقيسُ صفراً لا ضجيجاً.
  let meters = 0;
  let anchor: TravelledTracePoint | undefined = usable[0];
  let anchorCoords: Coordinates | undefined =
    anchor === undefined ? undefined : { latitude: anchor.latitude, longitude: anchor.longitude };
  let usablePoints = 1;
  for (let index = 1; index < usable.length; index += 1) {
    const point = usable[index];
    if (point === undefined || anchor === undefined || anchorCoords === undefined) continue;
    const pointCoords: Coordinates = { latitude: point.latitude, longitude: point.longitude };
    const distanceMeters = haversineKm(anchorCoords, pointCoords) * 1000;
    const jitterRadiusMeters = Math.max(anchor.accuracyMeters ?? 0, point.accuracyMeters ?? 0);
    if (distanceMeters > jitterRadiusMeters) {
      meters += distanceMeters;
      anchor = point;
      anchorCoords = pointCoords;
      usablePoints += 1;
    }
  }

  return { kind: "measured", meters, usablePoints, excluded };
}
