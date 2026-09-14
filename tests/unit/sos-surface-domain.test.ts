/**
 * الغرض: قياسُ نطاقِ سطحِ الاستغاثةِ — المجالاتُ المغلقةُ وحُرّاسُها، وحسابا
 *   «بلاغٌ قائمٌ» و«تُعرَضُ البطاقةُ» (البند `F2-10` · `SR-14`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-10`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci`.
 *
 * ولماذا يُقاسُ حسابانِ من سطرَينِ: لأنَّهما **الشرطانِ الوحيدانِ** اللذانِ
 * كانا سيُكتَبانِ في الواجهةِ لو لم يُنشَرا ههنا. وشرطٌ يُكتَبُ في الواجهةِ
 * يُنسَخُ في ثلاثةِ أسطحٍ ثمَّ يفترقُ: فيبقى `closed` «قائماً» في سطحٍ ويُخفيه
 * سطحٌ آخرُ، ولا يكتشفُ الفرقَ إلّا مَن ضغطَ ولم يُجَبْ.
 */

import { describe, expect, it } from "bun:test";
import {
  isIncidentPending,
  isSosBlockReason,
  isSosDisclosureCode,
  isSosIncidentStatus,
  isSosOrigin,
  isSosWindowSource,
  isSurfaceVisible,
  SOS_BLOCK_REASONS,
  SOS_DISCLOSURE_CODES,
  SOS_INCIDENT_STATUSES,
  SOS_ORIGINS,
  SOS_WINDOW_SOURCES,
  type SosIncidentState,
  type SosSurfaceState,
} from "../../packages/domain/safety/sos-surface.ts";

describe("مجالاتُ سطحِ الاستغاثةِ المغلقةُ", () => {
  const domains: readonly (readonly [string, readonly string[], (value: unknown) => boolean])[] = [
    ["مصدرُ الجوازِ", SOS_ORIGINS, isSosOrigin],
    ["سببُ المنعِ", SOS_BLOCK_REASONS, isSosBlockReason],
    ["حالُ البلاغِ", SOS_INCIDENT_STATUSES, isSosIncidentStatus],
    ["رمزُ الإفصاحِ", SOS_DISCLOSURE_CODES, isSosDisclosureCode],
    ["مصدرُ النافذةِ", SOS_WINDOW_SOURCES, isSosWindowSource],
  ];

  for (const [label, values, guard] of domains) {
    it(`${label}: كلُّ قيمةٍ منشورةٍ يقبلُها حارسُها`, () => {
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) expect(guard(value)).toBe(true);
    });

    it(`${label}: ما ليسَ نصّاً أو ليسَ في المجالِ يُرَدُّ`, () => {
      for (const value of [null, undefined, 7, {}, [], "", "NOT_IN_DOMAIN"]) {
        expect(guard(value)).toBe(false);
      }
    });
  }

  /** رموزُ الإفصاحِ ستّةٌ لا تُزادُ بلا نصٍّ — والحاجزُ `UX-024` يقيسُ ذلكَ. */
  it("مجالُ الإفصاحِ بلا تكرارٍ", () => {
    expect(new Set(SOS_DISCLOSURE_CODES).size).toBe(SOS_DISCLOSURE_CODES.length);
  });

  it("نفيُ الاتّصالِ رمزٌ منشورٌ في المجالِ", () => {
    expect(SOS_DISCLOSURE_CODES).toContain("SOS_NO_PHONE_CALL");
  });
});

function incident(status: SosIncidentState["status"]): SosIncidentState {
  return { incidentId: "inc-1", status, ageSeconds: 12 };
}

describe("أَبلاغٌ قائمٌ؟ — حسابٌ واحدٌ في النطاقِ", () => {
  it("«open» و«received» قائمانِ", () => {
    expect(isIncidentPending(incident("open"))).toBe(true);
    expect(isIncidentPending(incident("received"))).toBe(true);
  });

  it("«closed» منتهيةٌ وحدَها", () => {
    expect(isIncidentPending(incident("closed"))).toBe(false);
  });

  it("لا بلاغَ ⇒ لا انتظارَ", () => {
    expect(isIncidentPending(null)).toBe(false);
  });
});

const ELIGIBLE: SosSurfaceState = {
  eligible: true,
  orderId: "3f1c9a02-4b7e-4d21-9f88-0a1b2c3d4e5f",
  origin: "ACTIVE_ORDER",
  postRideWindowMinutes: 30,
  postRideWindowSource: "SETTING",
  incident: null,
  disclosure: ["SOS_NO_PHONE_CALL"],
};

const BLOCKED: SosSurfaceState = {
  eligible: false,
  reason: "NO_ACTIVE_ORDER",
  incident: null,
  disclosure: ["SOS_NO_PHONE_CALL"],
};

/**
 * والقاعدةُ الثانيةُ أدقُّ من ظاهرِها: **بلاغٌ قائمٌ يُبقي البطاقةَ مرئيّةً ولو
 * زالَ الجوازُ**. فمَن نادى يستحقُّ أن يرى مصيرَ ندائِه حتّى يُغلَقَ — ولو
 * اختفَت البطاقةُ بانتهاءِ النافذةِ لَظنَّ أنَّ ندائَه ضاعَ فأعادَه.
 */
describe("أتُعرَضُ البطاقةُ؟ — البطاقةُ تُخفي نفسَها", () => {
  it("جوازٌ قائمٌ ⇒ تُعرَضُ", () => {
    expect(isSurfaceVisible(ELIGIBLE)).toBe(true);
  });

  it("لا جوازَ ولا بلاغَ ⇒ تُخفى، فلا زرَّ رماديَّ في شاشةٍ بلا رحلةٍ", () => {
    expect(isSurfaceVisible(BLOCKED)).toBe(false);
  });

  it("لا جوازَ وبلاغٌ قائمٌ ⇒ تُعرَضُ، فمَن نادى يرى مصيرَ ندائِه", () => {
    expect(isSurfaceVisible({ ...BLOCKED, incident: incident("received") })).toBe(true);
  });

  it("لا جوازَ وبلاغٌ مُغلَقٌ ⇒ تُعرَضُ كذلكَ حتّى يُقرأَ الإغلاقُ", () => {
    expect(isSurfaceVisible({ ...BLOCKED, incident: incident("closed") })).toBe(true);
  });
});
