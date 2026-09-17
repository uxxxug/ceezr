/**
 * الغرض: قياسُ نطاقِ مشاركةِ الرحلةِ — حكمُ الحياةِ (`F12-04`)، وأقربُ سقفٍ،
 *   وتصنيفُ الإتاحةِ، وقائمتا الإفصاحِ والكتمانِ (البند `F2-09` · `SR-13`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-09`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: CI (الوظيفة `verify`)
 * يُتوقع أن يستخدمه لاحقاً: `F2-10` إذ يُصدِرُ نداءَ استغاثةٍ على الرحلةِ نفسِها.
 *
 * ولماذا يُقاسُ ههنا بلا قاعدةٍ: هذا المِلفُّ **حسابٌ خالصٌ على ما قالَته
 * القاعدةُ** — لا ساعةَ فيه ولا استعلامَ. وأمّا أنَّ الثانيةَ الباقيةَ صادقةٌ
 * فذاكَ حكمُ `tests/integration/ride-share.test.ts` على قاعدةٍ حقيقيّةٍ.
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ ═══
 * ــ **لا يُقاسُ انقضاءُ الرابطِ بمرورِ الزمنِ**: لا ساعةَ في هذا المِلفِّ أصلاً،
 *    والباقي رقمٌ تحسبُه القاعدةُ — ولو حُسِبَ ههنا لَاختلفَ جهازانِ في حكمِهما.
 * ــ **لا يُقاسُ أنَّ المكتومَ مكتومٌ فعلاً**: القائمةُ إعلانٌ، وإنفاذُه في
 *    `scripts/check-ride-share-contract.ts` على حمولةِ الصفحةِ العامّةِ نفسِها.
 */

import { describe, expect, it } from "bun:test";
import {
  isPositionMaxAgeSource,
  isSharedPositionVerdict,
  isShareLifetimeLive,
  isShareLifetimeVerdict,
  isSharingNow,
  SHARE_DISCLOSED,
  SHARE_LIFETIME_VERDICTS,
  SHARE_WITHHELD,
  SHARED_POSITION_VERDICTS,
  type ShareLifetime,
  type ShareLink,
  shareAvailabilityOf,
  shareCountdownSeconds,
  soonestCeilingSeconds,
  TRACKING_LINK_GRACE_MINUTES,
} from "../../packages/domain/transport/ride-share.ts";

function link(ceilingSecondsRemaining: number, id = "l1"): ShareLink {
  return { id, createdAtMs: 1_700_000_000_000, ceilingSecondsRemaining };
}

const RIDING: ShareLifetime = {
  verdict: "LIVE_RIDE_ACTIVE",
  graceMinutes: TRACKING_LINK_GRACE_MINUTES,
  graceSource: "SETTING",
};
const GRACE: ShareLifetime = {
  verdict: "LIVE_GRACE",
  secondsRemaining: 240,
  graceMinutes: TRACKING_LINK_GRACE_MINUTES,
  graceSource: "SETTING",
};
const DEAD: ShareLifetime = {
  verdict: "EXPIRED_RIDE_ENDED",
  graceMinutes: TRACKING_LINK_GRACE_MINUTES,
  graceSource: "FALLBACK_DEFAULT",
};

/**
 * **`F12-04`** — والحياةُ صفةُ **الرحلةِ** لا صفةُ الرابطِ. وكانَ ههنا قياسٌ
 * على `isLiveLink`/`liveLinks`/`longestRemainingSeconds`: ثلاثُ دالّاتٍ تحكمُ
 * بالحياةِ من **بقيّةِ السقفِ** (`expires_at - now()`). **ولم يُلَيَّنْ توكيدٌ
 * ولم يُحذَفْ**: الدعوى التي كانت تحملُها — «رابطٌ منتهٍ لا يجعلُها مُشارَكةً»
 * و«العدَمُ لا يُساوي الصفرَ» — باقيةٌ بحرفِها أدناهُ وقد صارت أقوى، إذ تُقاسُ
 * على الحكمِ الصادقِ (`EXPIRED_RIDE_ENDED`) لا على سقفٍ ليسَ هوَ الموعدَ. وذاكَ
 * السقفُ هوَ عينُ العطبِ: رابطٌ أمامَه إحدى عشرةَ ساعةً من سقفِه كانَ يُقرأُ
 * «حيّاً» وقد ماتَ بانتهاءِ الرحلةِ ومهلتِها (`ADR 0146`).
 */
describe("حكمُ حياةِ المشاركةِ", () => {
  it("الأحكامُ ثلاثةٌ بأسماءِ القاعدةِ نفسِها — وما سواها يُرفَضُ", () => {
    expect([...SHARE_LIFETIME_VERDICTS]).toEqual([
      "LIVE_RIDE_ACTIVE",
      "LIVE_GRACE",
      "EXPIRED_RIDE_ENDED",
    ]);
    for (const verdict of SHARE_LIFETIME_VERDICTS) {
      expect(isShareLifetimeVerdict(verdict)).toBe(true);
    }
    for (const bad of ["LIVE", "live_grace", "EXPIRED", "", 1, null, undefined]) {
      expect(isShareLifetimeVerdict(bad)).toBe(false);
    }
  });

  it("رحلةٌ جاريةٌ حياةٌ، ومهلةٌ جاريةٌ حياةٌ، والانقضاءُ موتٌ", () => {
    expect(isShareLifetimeLive(RIDING)).toBe(true);
    expect(isShareLifetimeLive(GRACE)).toBe(true);
    expect(isShareLifetimeLive(DEAD)).toBe(false);
  });

  // **لا عدَّ تنازليّاً لرحلةٍ جاريةٍ**: موعدُها غيرُ معلومٍ، وأيُّ رقمٍ كذبٌ.
  // وهذا هوَ العطبُ الثاني الذي أُغلِقَ: عدٌّ نحوَ سقفٍ ليسَ هوَ الموعدَ.
  it("العدُّ التنازليُّ للمهلةِ وحدَها — ورحلةٌ جاريةٌ بلا رقمٍ ألبتّةَ", () => {
    expect(shareCountdownSeconds(RIDING)).toBeNull();
    expect(shareCountdownSeconds(GRACE)).toBe(240);
    expect(shareCountdownSeconds(DEAD)).toBeNull();
  });

  it("«أمُشارَكةٌ الآنَ» شرطانِ: رابطٌ قائمٌ وحياةٌ لم تنقضِ", () => {
    expect(isSharingNow(RIDING, [])).toBe(false);
    expect(isSharingNow(RIDING, [link(9000)])).toBe(true);
    expect(isSharingNow(GRACE, [link(9000)])).toBe(true);
    // **السقفُ لا يُنقِذُ رابطاً ماتَ سببُه**: أمامَه ساعاتٌ ومعَ ذلكَ لا مشاركةَ.
    expect(isSharingNow(DEAD, [link(40_000)])).toBe(false);
  });

  it("أقربُ سقفٍ يُقرأُ سقفاً، و«لا رابطَ» عَدَمٌ لا صفرٌ", () => {
    expect(soonestCeilingSeconds([])).toBeNull();
    expect(soonestCeilingSeconds([])).not.toBe(0);
    expect(soonestCeilingSeconds([link(900, "a"), link(40, "b"), link(9000, "c")])).toBe(40);
  });

  it("مهلةُ ما بعدَ الرحلةِ حكمٌ واحدٌ يُقاسُ ببذرةِ الهجرةِ", () => {
    expect(TRACKING_LINK_GRACE_MINUTES).toBe(15);
  });
});

describe("إتاحةُ المشاركةِ", () => {
  it("الحكمُ تصنيفُ جوابِ القاعدةِ لا شرطٌ يُعادُ كتابتُه ههنا", () => {
    expect(shareAvailabilityOf(true)).toBe("CAN_SHARE");
    expect(shareAvailabilityOf(false)).toBe("RIDE_NOT_ACTIVE");
  });
});

describe("أحكامُ النقطةِ ومصدرُ الحدِّ", () => {
  it("الأحكامُ أربعةٌ بأسماءِ القاعدةِ نفسِها — وما سواها يُرفَضُ", () => {
    expect([...SHARED_POSITION_VERDICTS]).toEqual([
      "LOCATED",
      "NEVER_REPORTED",
      "NO_TIMESTAMP",
      "TOO_OLD",
    ]);
    for (const verdict of SHARED_POSITION_VERDICTS) {
      expect(isSharedPositionVerdict(verdict)).toBe(true);
    }
    for (const bad of ["located", "OK", "", 3, null, undefined]) {
      expect(isSharedPositionVerdict(bad)).toBe(false);
    }
  });

  it("مصدرُ الحدِّ يُقرأُ «إعداداً» أو «افتراضاً» ولا ثالثَ لهما", () => {
    expect(isPositionMaxAgeSource("SETTING")).toBe(true);
    expect(isPositionMaxAgeSource("FALLBACK_DEFAULT")).toBe(true);
    expect(isPositionMaxAgeSource("DEFAULT")).toBe(false);
    expect(isPositionMaxAgeSource(90)).toBe(false);
  });
});

describe("الإفصاحُ والكتمانُ", () => {
  it("لا رمزَ في القائمتَينِ معاً — لا يُقالُ عن حقلٍ يُكشَفُ إنَّه مكتومٌ", () => {
    const overlap = SHARE_DISCLOSED.filter((code) => SHARE_WITHHELD.includes(code));
    expect(overlap).toEqual([]);
  });

  it("لا تكرارَ داخلَ قائمةٍ — الرمزُ يُقالُ مرّةً فلا يُعَدُّ إفصاحانِ", () => {
    expect(new Set(SHARE_DISCLOSED).size).toBe(SHARE_DISCLOSED.length);
    expect(new Set(SHARE_WITHHELD).size).toBe(SHARE_WITHHELD.length);
  });

  // الهويّةُ هيَ الخطرُ: مَن ملكَ النصَّ ملكَ الجوابَ، فاسمُ الراكبةِ ورقمُها
  // ولوحةُ المركبةِ والمقصدُ **مكتومةٌ بالاسمِ** لا بالسكوتِ عنها.
  it("أسماءُ الهويّةِ والمقصدِ مكتومةٌ بالاسمِ لا بالسكوتِ", () => {
    for (const code of [
      "RIDER_NAME",
      "RIDER_PHONE",
      "DRIVER_NAME",
      "DRIVER_PHONE",
      "PLATE_NUMBER",
      "PICKUP_AND_DROPOFF",
      "ORDER_ID",
    ]) {
      expect(SHARE_WITHHELD).toContain(code);
    }
  });

  it("المكشوفُ ثلاثةٌ لا رابعَ — والزيادةُ قرارٌ يُكتَبُ لا يُنسَى", () => {
    expect([...SHARE_DISCLOSED]).toEqual(["DRIVER_POSITION", "POSITION_AGE", "RIDE_ACTIVE_FLAG"]);
  });

  it("لا قائمةَ فارغةً — الفراغُ يُقرأُ «لا شيءَ يُكشَفُ» وهوَ كذبٌ", () => {
    expect(SHARE_DISCLOSED.length).toBeGreaterThan(0);
    expect(SHARE_WITHHELD.length).toBeGreaterThan(0);
  });
});
