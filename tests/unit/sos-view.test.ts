/**
 * الغرض: قياسُ نموذجِ عرضِ الاستغاثةِ — مفاتيحُ الأصلِ والحالِ والعُمرِ والرفضِ،
 *   و**أنَّ «بلا رحلةٍ» له نصُّه لا يُرَدُّ إلى «مجهولٍ»** (البندانِ `F2-10`
 *   و`F12-03` · `SR-14`).
 * الحالة: منفَّذٌ فعليّاً — البند `F12-03`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: CI (الوظيفة `verify`)
 *
 * ولماذا يُقاسُ النموذجُ لا المكوّنُ: `SosCard.tsx` رسمٌ، والحكمُ كلُّه ههنا في
 * دالّاتٍ نقيّةٍ — فيُقاسُ حيثُ هوَ لا حيثُ يُعرَضُ.
 *
 * ═══ وأثقلُ ما يُقاسُ ههنا ═══
 * أصلٌ جديدٌ يصلُ من القاعدةِ ولا يعرفُه النموذجُ يُقالُ «أصلٌ غيرُ معروفٍ»، وذاكَ
 * نصٌّ يُقرأُ **عطلاً** في بطاقةِ استغاثةٍ — فيُحجِمُ عن الضغطِ مَن البابُ مفتوحٌ
 * له. فالمفتاحُ يُقاسُ بعينِه لا بوجودِ دالّةٍ.
 *
 * ═══ وما لا يُقاسُ ههنا عن قصدٍ ═══
 * ــ **لا نصٌّ عربيٌّ**: المقيسُ مفتاحٌ، ووجودُ النصِّ في الألسنةِ الثلاثةِ يقيسُه
 *    `scripts/check-sos-surface-contract.ts` (القاعدة ٢).
 * ــ **لا ساعةَ**: العُمرُ يصلُ مقيساً من القاعدةِ ولا يُحسَبُ ههنا.
 */

import { describe, expect, it } from "bun:test";
import {
  blockReasonKey,
  disclosureKey,
  incidentAgeText,
  incidentStatusKey,
  isIncidentPending,
  isRetryableSosError,
  isSosCardVisible,
  originKey,
  readRefusalKey,
  sosErrorKey,
  triggerRefusalKey,
} from "../../apps/miniapp/src/surfaces/rider/sos/sos-view.ts";

describe("أصلُ الجوازِ ⇒ مفتاحُ نصٍّ", () => {
  const cases: readonly (readonly [string, string])[] = [
    ["ACTIVE_ORDER", "rider.sos.origin.active"],
    ["RECENT_ORDER", "rider.sos.origin.recent"],
    ["NO_ORDER", "rider.sos.origin.noOrder"],
  ];

  for (const [origin, key] of cases) {
    it(`«${origin}» ⇒ «${key}»`, () => {
      expect(originKey(origin)).toBe(key);
    });
  }

  /** والأصلُ الثالثُ **لا يُرَدُّ إلى «مجهولٍ»**: انظرْ رأسَ المِلفِّ. */
  it("«NO_ORDER» لا يُقالُ «أصلاً غيرَ معروفٍ»", () => {
    expect(originKey("NO_ORDER")).not.toBe("rider.sos.origin.unknown");
  });

  it("أصلٌ لا يُعرَفُ يُقالُ مفتاحاً عامّاً لا رمزاً خاماً", () => {
    expect(originKey("SOMEWHERE_ELSE")).toBe("rider.sos.origin.unknown");
    expect(originKey("")).toBe("rider.sos.origin.unknown");
  });
});

describe("بطاقةٌ محكومةٌ — أتُعرَضُ؟", () => {
  it("جوازٌ بلا بلاغٍ ⇒ تُعرَضُ", () => {
    expect(isSosCardVisible(true, null)).toBe(true);
  });

  it("لا جوازَ ولا بلاغَ ⇒ تُخفى، فلا زرَّ يَعِدُ ثمَّ يُخلِفُ", () => {
    expect(isSosCardVisible(false, null)).toBe(false);
    expect(isSosCardVisible(false, undefined)).toBe(false);
  });

  /** ومَن أبلغَ ثمَّ اختفَت بطاقتُه يظنُّ بلاغَه ضاعَ فيُبلِّغُ ثانيةً أو ييأسُ. */
  it("لا جوازَ وبلاغٌ قائمٌ ⇒ تُعرَضُ حتّى يُقرأَ مصيرُ ندائِه", () => {
    expect(isSosCardVisible(false, { id: "i", status: "open", ageSeconds: 3 })).toBe(true);
  });

  it("«closed» وحدَها منتهيةٌ", () => {
    expect(isIncidentPending({ id: "i", status: "open", ageSeconds: 1 })).toBe(true);
    expect(isIncidentPending({ id: "i", status: "received", ageSeconds: 1 })).toBe(true);
    expect(isIncidentPending({ id: "i", status: "closed", ageSeconds: 1 })).toBe(false);
  });
});

/**
 * ودونَ الدقيقةِ يُقالُ بالثواني كي لا يُقرأَ «منذُ ٠ دقيقةٍ» فيُظَنَّ أنَّ شيئاً
 * لم يُرسَلْ — وذاكَ يدفعُ إلى إعادةِ الإرسالِ في أضيقِ لحظةٍ.
 */
describe("عُمرُ البلاغِ ⇒ مفتاحٌ وأعدادٌ", () => {
  it("ما دونَ الدقيقةِ يُقالُ بالثواني", () => {
    expect(incidentAgeText(42)).toEqual({
      key: "rider.sos.incident.ageSeconds",
      minutes: 0,
      seconds: 42,
    });
  });

  it("ما فوقَ الدقيقةِ يُقالُ بالدقائقِ وبقيّتِها", () => {
    expect(incidentAgeText(125)).toEqual({
      key: "rider.sos.incident.ageMinutes",
      minutes: 2,
      seconds: 5,
    });
  });

  it("عددٌ سالبٌ أو غيرُ منتهٍ يُقرأُ صفراً لا يُكسِرُ السطرَ", () => {
    expect(incidentAgeText(-9).seconds).toBe(0);
    expect(incidentAgeText(Number.NaN).seconds).toBe(0);
    expect(incidentAgeText(Number.POSITIVE_INFINITY).seconds).toBe(0);
  });
});

describe("حالُ البلاغِ ومفاتيحُ الرفضِ والخطأِ", () => {
  it("حالٌ معروفةٌ لها مفتاحُها وما سواها «قيدَ المتابعةِ» لا فراغٌ", () => {
    expect(incidentStatusKey("open")).toBe("rider.sos.incident.status.open");
    expect(incidentStatusKey("received")).toBe("rider.sos.incident.status.received");
    expect(incidentStatusKey("closed")).toBe("rider.sos.incident.status.closed");
    expect(incidentStatusKey("archived")).toBe("rider.sos.incident.status.unknown");
  });

  /** وعطلُ التهيئةِ لا يُقالُ للراكبِ «لا رحلةَ لكَ»: الأوّلُ عيبٌ فينا. */
  it("عطلُ تهيئةٍ يُقالُ «غيرُ متاحٍ» لا «لا رحلةَ لكَ»", () => {
    expect(blockReasonKey("ESCALATION_GROUP_MISSING")).toBe("rider.sos.blocked.unavailable");
    expect(blockReasonKey("SOS_DEDUP_SETTING_MISSING")).toBe("rider.sos.blocked.unavailable");
    expect(blockReasonKey("NO_ACTIVE_ORDER")).toBe("rider.sos.blocked.noRide");
    expect(blockReasonKey("BECAUSE")).toBe("rider.sos.blocked.unknown");
  });

  it("رمزُ إفصاحٍ يُقالُ مفتاحاً بالبادئةِ عينِها", () => {
    expect(disclosureKey("SOS_NO_ORDER_REFERENCE")).toBe(
      "rider.sos.disclosure.SOS_NO_ORDER_REFERENCE",
    );
  });

  it("رفضُ الضغطةِ ورفضُ القراءةِ لكلٍّ مفاتيحُه", () => {
    expect(triggerRefusalKey("NO_ACTIVE_ORDER")).toBe("rider.sos.refusal.noRide");
    expect(triggerRefusalKey("NOT_ALLOWED")).toBe("rider.sos.refusal.notAllowed");
    expect(triggerRefusalKey("WHAT")).toBe("rider.sos.refusal.unknown");
    expect(readRefusalKey("ACCOUNT_BLOCKED")).toBe("rider.sos.refusal.notAllowed");
    expect(readRefusalKey("INVALID_ROLE")).toBe("rider.sos.refusal.unknown");
    expect(readRefusalKey("ACCOUNT_NOT_FOUND")).toBe("rider.sos.refusal.notFound");
  });

  /**
   * و`SAFETY_STORE_NOT_AVAILABLE` له نصُّه الخاصُّ: «لم يصلْ بلاغُكَ — اتّصلْ
   * بالطوارئِ العامّةِ». وصمتٌ ههنا يتركُ إنساناً يظنُّ نداءَه في طريقِه.
   */
  it("عطلُ مخزنِ السلامةِ يُقالُ «غيرُ متاحٍ» ويُعادُ السؤالُ بزرٍّ", () => {
    expect(sosErrorKey("SAFETY_STORE_NOT_AVAILABLE")).toBe("rider.sos.error.unavailable");
    expect(isRetryableSosError("SAFETY_STORE_NOT_AVAILABLE")).toBe(true);
  });

  it("جلسةٌ منتهيةٌ تُقالُ جلسةً ولا يُعادُ السؤالُ بزرٍّ", () => {
    for (const code of ["SESSION_REQUIRED", "SESSION_EXPIRED", "SESSION_INVALID"]) {
      expect(sosErrorKey(code)).toBe("rider.sos.error.session");
      expect(isRetryableSosError(code)).toBe(false);
    }
  });

  it("رمزٌ مجهولٌ يُقالُ «غيرَ معروفٍ» ولا يُطوى صمتاً", () => {
    expect(sosErrorKey("SOMETHING_NEW")).toBe("rider.sos.error.unknown");
    expect(isRetryableSosError("SOMETHING_NEW")).toBe(false);
  });
});
