/**
 * الغرض: §4.3 — دمج تجاوزات البيئة، وإغلاق ثغرة القفزة بلا زمنٍ منقضٍ.
 *
 *   (أ) `resolveGpsPolicy` / `resolveTrackingConfig`: كلّ متغيّرٍ يصل إلى الحدّ
 *       المقصود لا إلى حدٍّ مجاور، والافتراض يبقى مصدرَه الوحيد في المجال.
 *   (ب) `TRACKING_TELEPORT_THRESHOLD_METERS` لم يكن له معنًى: حكمُ الإزاحة كلّه
 *       كان معلَّقاً على `elapsedSeconds > 0`، فإصلاحتان بنفس الطابع الزمني على
 *       بعد خمسة كيلومترات كانتا تمرّان `ACCEPT` نظيفاً — مسلكُ تهرّبٍ كامل من
 *       فحص السرعة يكفي فيه تثبيتُ الطابع الزمني.
 *
 * الحالة: اختبار وحدة فعلي.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import { assessGpsFix, DEFAULT_GPS_POLICY, hasFinding } from "../../packages/domain/geo/gps-fix.ts";
import { NO_TRACKING_OVERRIDES } from "../../packages/shared/config/index.ts";
import { resolveGpsPolicy } from "../../packages/tracking/config.ts";

const JEDDAH = { latitude: 21.5471, longitude: 39.1751 };
/** على بعد ≈٢٤ كم شمالاً — قفزةٌ لا تُبلَغ لحظيّاً بأي وسيلة. */
const FAR = { latitude: 21.7671, longitude: 39.1751 };

describe("دمج تجاوزات البيئة مع افتراض المجال", () => {
  it("بلا تجاوزات يكون الناتج افتراضَ المجال حرفاً بحرف", () => {
    expect(resolveGpsPolicy(NO_TRACKING_OVERRIDES)).toEqual(DEFAULT_GPS_POLICY);
  });

  it("كلّ متغيّر يصل إلى حدّه المقصود ولا يُزحزح غيره", () => {
    const policy = resolveGpsPolicy({
      ...NO_TRACKING_OVERRIDES,
      maxAccuracyMeters: 42,
      maxReasonableSpeedKmh: 90,
      maxTimeDriftSeconds: 11,
      teleportThresholdMeters: 777,
    });
    expect(policy.maxAccuracyMeters).toBe(42);
    expect(policy.maxPlausibleSpeedKmh).toBe(90);
    expect(policy.maxFutureSkewSeconds).toBe(11);
    expect(policy.maxJumpMeters).toBe(777);
    // ما لم يُضبَط يبقى على افتراض المجال — لا صفراً ولا `undefined`.
    expect(policy.staleAfterSeconds).toBe(DEFAULT_GPS_POLICY.staleAfterSeconds);
    expect(policy.rejectOlderThanSeconds).toBe(DEFAULT_GPS_POLICY.rejectOlderThanSeconds);
  });

  /**
   * وكان ههنا اختبارٌ ثالثٌ لـ`resolveTrackingConfig` — فواصلُ التتبّع والمُقيِّم
   * داخلها — وسقط بـADR-0052 مع `TrackingService`: الدالةُ نفسُها حُذفت لأنّها لم تكن
   * تدمج إلا حدوداً لا يقرؤها إلا مسارٌ غيرُ موصول.
   *
   * وما كان يحرسُه ذاك الاختبار فعلاً — ألّا يبقى المُقيِّم على الافتراض بينما
   * البيئة ضبطت حدّ السرعة — محروسٌ في الاختبار الذي قبله على `resolveGpsPolicy`
   * مباشرةً، وهو الدالة النافذة فعلاً في `container.ts`. فلم تُفقَد تغطيةٌ.
   */
});

describe("القفزة حين يتعذّر قياس السرعة — ثغرة الطابع الزمني الثابت", () => {
  const previous = { coordinates: JEDDAH, recordedAtMs: 1_700_000_000_000 };

  it("٢٤ كم بنفس الطابع الزمني تُرفَع ملحوظةً — وكانت تمرّ ACCEPT", () => {
    const assessment = assessGpsFix(
      { latitude: FAR.latitude, longitude: FAR.longitude, recordedAtMs: previous.recordedAtMs },
      previous,
      previous.recordedAtMs,
      DEFAULT_GPS_POLICY,
    );
    expect(hasFinding(assessment, "DISPLACEMENT_IMPLAUSIBLE")).toBe(true);
    // تنبيهٌ لا طرح: الموضع الأحدث يُعتمد كي لا يتجمّد التتبّع، والحكمُ للبشر.
    expect(assessment.fix).not.toBeNull();
  });

  it("طابعٌ متقهقر بمسافةٍ بعيدة يُرفَع كذلك — الزمن السالب لا يُبرّئ", () => {
    const assessment = assessGpsFix(
      {
        latitude: FAR.latitude,
        longitude: FAR.longitude,
        recordedAtMs: previous.recordedAtMs - 5_000,
      },
      previous,
      previous.recordedAtMs,
      DEFAULT_GPS_POLICY,
    );
    expect(hasFinding(assessment, "DISPLACEMENT_IMPLAUSIBLE")).toBe(true);
  });

  it("حركةٌ قصيرة بنفس الطابع الزمني لا تُنبَّه — الدقّة تُنتج تذبذباً مشروعاً", () => {
    const assessment = assessGpsFix(
      { latitude: 21.5473, longitude: 39.1751, recordedAtMs: previous.recordedAtMs },
      previous,
      previous.recordedAtMs,
      DEFAULT_GPS_POLICY,
    );
    expect(hasFinding(assessment, "DISPLACEMENT_IMPLAUSIBLE")).toBe(false);
  });

  it("بوجود زمنٍ منقضٍ حقيقيّ لا يسري الحدّ المسافيّ — الحكم للسرعة وحدها", () => {
    // ٢٤ كم في ساعة = ٢٤ كم/س، سرعةٌ مشروعةٌ تماماً. ولو طُبّق الحدّ المسافيّ
    // هنا لصار كلّ سائقٍ على طريقٍ سريعٍ متّهماً بعد كلّ فترةِ سكون.
    const assessment = assessGpsFix(
      {
        latitude: FAR.latitude,
        longitude: FAR.longitude,
        recordedAtMs: previous.recordedAtMs + 3_600_000,
      },
      previous,
      previous.recordedAtMs + 3_600_000,
      DEFAULT_GPS_POLICY,
    );
    expect(hasFinding(assessment, "DISPLACEMENT_IMPLAUSIBLE")).toBe(false);
  });

  it("الحدّ المسافيّ يُتبع البيئة لا الرقم المرمَّز", () => {
    const strict = resolveGpsPolicy({ ...NO_TRACKING_OVERRIDES, teleportThresholdMeters: 50 });
    const assessment = assessGpsFix(
      { latitude: 21.5493, longitude: 39.1751, recordedAtMs: previous.recordedAtMs },
      previous,
      previous.recordedAtMs,
      strict,
    );
    // ٢٥٠ متراً تمرّ عند الافتراض (٥ كم) وتُنبَّه عند حدٍّ ٥٠ متراً.
    expect(hasFinding(assessment, "DISPLACEMENT_IMPLAUSIBLE")).toBe(true);
  });
});
