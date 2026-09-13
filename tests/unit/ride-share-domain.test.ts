/**
 * الغرض: قياسُ نطاقِ مشاركةِ الرحلةِ — حياةُ الرابطِ، وأطولُ ما بقيَ، وتصنيفُ
 *   الإتاحةِ، وقائمتا الإفصاحِ والكتمانِ (البند `F2-09` · `SR-13`).
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
  isLiveLink,
  isPositionMaxAgeSource,
  isSharedPositionVerdict,
  isSharingNow,
  liveLinks,
  longestRemainingSeconds,
  SHARE_DISCLOSED,
  SHARE_WITHHELD,
  SHARED_POSITION_VERDICTS,
  type ShareLink,
  shareAvailabilityOf,
} from "../../packages/domain/transport/ride-share.ts";

function link(secondsRemaining: number, id = "l1"): ShareLink {
  return { id, createdAtMs: 1_700_000_000_000, secondsRemaining };
}

describe("حياةُ الرابطِ", () => {
  it("الثانيةُ الواحدةُ حياةٌ والصفرُ موتٌ — والحدُّ مقيسٌ لا مُخمَّنٌ", () => {
    expect(isLiveLink(link(1))).toBe(true);
    expect(isLiveLink(link(0))).toBe(false);
  });

  // عددٌ سالبٌ ليسَ فرضاً نظريّاً: ساعةُ القاعدةِ قد تتجاوزُ الانتهاءَ بينَ
  // الحسابِ والنشرِ. والمطلوبُ أن يُقرأَ **ميتاً** لا أن يُقلَبَ حيّاً بمطلقِ قيمةٍ.
  it("باقٍ سالبٌ ميتٌ — لا يُقلَبُ حيّاً بمطلقِ قيمةٍ", () => {
    expect(isLiveLink(link(-30))).toBe(false);
    expect(liveLinks([link(-30, "a"), link(5, "b")]).map((l) => l.id)).toEqual(["b"]);
  });

  it("«أمُشارَكةٌ الآنَ» جوابٌ واحدٌ: رابطٌ منتهٍ لا يجعلُها مُشارَكةً", () => {
    expect(isSharingNow([])).toBe(false);
    expect(isSharingNow([link(0, "a"), link(0, "b")])).toBe(false);
    expect(isSharingNow([link(0, "a"), link(12, "b")])).toBe(true);
  });

  it("أطولُ ما بقيَ يُحسَبُ من الحيِّ وحدَه، و«لا رابطَ» عَدَمٌ لا صفرٌ", () => {
    expect(longestRemainingSeconds([])).toBeNull();
    expect(longestRemainingSeconds([link(0, "a")])).toBeNull();
    expect(longestRemainingSeconds([link(40, "a"), link(900, "b"), link(0, "c")])).toBe(900);
  });

  // الفرقُ بينَ `null` و`0` هوَ الفرقُ بينَ «لا مشاركةَ» و«ينتهي الآنَ»،
  // والشاشةُ تكتبُ لهما جملتَينِ مختلفتَينِ — فلا يُطوى أحدُهما في الآخرِ.
  it("عَدَمُ الرابطِ لا يُساوي صفرَ الثواني", () => {
    expect(longestRemainingSeconds([link(0, "a")])).not.toBe(0);
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
