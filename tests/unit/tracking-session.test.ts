/**
 * الغرض: اختبارات آلة حالة جلسة التتبّع — المرحلة ٥.
 * الحالة: منفّذ فعلياً.
 */

import { describe, expect, it } from "bun:test";
import {
  acceptsFixes,
  DEFAULT_SESSION_POLICY,
  endSession,
  recordFix,
  type SessionPolicy,
  sessionStateAt,
  startSession,
  type TrackingSessionFacts,
} from "../../packages/domain/tracking/session.ts";

const T0 = 1_770_000_000_000;
const SEC = 1000;
const DRIVER = "11111111-1111-4111-8111-111111111111";

function facts(over: Partial<TrackingSessionFacts> = {}): TrackingSessionFacts {
  return { ...startSession(DRIVER, null, T0), ...over };
}

describe("آلة حالة جلسة التتبّع: الاشتقاق", () => {
  it("جلسة بُدئت للتو ولم تُرسل إصلاحة: CREATED", () => {
    expect(sessionStateAt(facts(), T0 + 5 * SEC)).toBe("CREATED");
  });

  it("جلسة بإصلاحة حديثة: ACTIVE", () => {
    expect(sessionStateAt(facts({ lastFixAtMs: T0 + 20 * SEC }), T0 + 25 * SEC)).toBe("ACTIVE");
  });

  it("انقطاع الإصلاحات يُنتج STALE بلا أي كتابة", () => {
    const f = facts({ lastFixAtMs: T0 + 10 * SEC });
    expect(sessionStateAt(f, T0 + 39 * SEC)).toBe("ACTIVE");
    expect(sessionStateAt(f, T0 + 40 * SEC)).toBe("STALE");
    // نفس الصفّ المخزَّن، حكمان مختلفان باختلاف الزمن وحده. وهذا هو البرهان
    // على أن STALE لا يمكن أن تكون عموداً: لا شيء تغيّر ليُكتب.
  });

  it("جلسة بُدئت ولم تصل إصلاحة قط تصير STALE بعد المهلة", () => {
    expect(sessionStateAt(facts(), T0 + 31 * SEC)).toBe("STALE");
  });

  it("STALE تعود ACTIVE بمجرّد وصول إصلاحة — الانقطاع ليس نهاية", () => {
    const stale = facts({ lastFixAtMs: T0 + 10 * SEC });
    expect(sessionStateAt(stale, T0 + 120 * SEC)).toBe("STALE");
    const resumed = recordFix(stale, T0 + 120 * SEC, T0 + 120 * SEC);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(sessionStateAt(resumed.value, T0 + 121 * SEC)).toBe("ACTIVE");
  });

  it("الإنهاء يغلب كل شيء: إصلاحة حديثة على جلسة منتهية تبقى ENDED", () => {
    const ended = endSession(
      facts({ lastFixAtMs: T0 + 100 * SEC }),
      "TRIP_COMPLETED",
      T0 + 101 * SEC,
    );
    expect(sessionStateAt(ended, T0 + 102 * SEC)).toBe("ENDED");
  });

  it("السقف الزمني يُنهي جلسةً نشطةً بلا حدث إنهاء", () => {
    // السيناريو الحقيقي: قُتل الخادم في منتصف رحلة فضاع حدث الإنهاء، والجهاز
    // بقي يُرسل. بلا سقف تبقى الجلسة مفتوحة إلى الأبد.
    const long = facts({ lastFixAtMs: T0 + 12 * 60 * 60 * SEC });
    expect(sessionStateAt(long, T0 + 12 * 60 * 60 * SEC + SEC)).toBe("ENDED");
  });
});

describe("آلة حالة جلسة التتبّع: الانتقالات", () => {
  it("إصلاحة متأخّرة في الشبكة لا تُحيي جلسةً منتهية", () => {
    const ended = endSession(facts(), "DRIVER_STOPPED", T0 + 60 * SEC);
    const late = recordFix(ended, T0 + 59 * SEC, T0 + 61 * SEC);
    expect(late.ok).toBe(false);
    if (late.ok) return;
    expect(late.error.reason).toBe("SESSION_ALREADY_ENDED");
  });

  it("إصلاحة أقدم من بداية الجلسة تُرفض", () => {
    const r = recordFix(facts(), T0 - SEC, T0 + SEC);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.reason).toBe("FIX_BEFORE_SESSION_START");
  });

  it("إصلاحة خارج الترتيب لا تُرجِع المؤشّر إلى الوراء", () => {
    const a = recordFix(facts(), T0 + 20 * SEC, T0 + 20 * SEC);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const b = recordFix(a.value, T0 + 5 * SEC, T0 + 21 * SEC);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.value.lastFixAtMs).toBe(T0 + 20 * SEC);
    // ولولا هذا لأعادت إصلاحةٌ من طابورٍ متأخّر جلسةً حيّةً إلى STALE.
    expect(sessionStateAt(b.value, T0 + 25 * SEC)).toBe("ACTIVE");
  });

  it("الإنهاء مُتسامِح مع التكرار ولا يُعيد كتابة السبب ولا الوقت", () => {
    const first = endSession(facts(), "TRIP_COMPLETED", T0 + 10 * SEC);
    const second = endSession(first, "ADMIN_TERMINATED", T0 + 99 * SEC);
    expect(second.endedAtMs).toBe(T0 + 10 * SEC);
    expect(second.endReason).toBe("TRIP_COMPLETED");
  });

  it("سبب الإنهاء يُحفظ — «انتهت» وحدها لا تُفسّر شيئاً لاحقاً", () => {
    expect(endSession(facts(), "TRIP_CANCELLED", T0).endReason).toBe("TRIP_CANCELLED");
  });

  it("acceptsFixes يقبل في STALE ويرفض في ENDED", () => {
    const f = facts({ lastFixAtMs: T0 });
    expect(acceptsFixes(f, T0 + 600 * SEC)).toBe(true);
    expect(acceptsFixes(endSession(f, "EXPIRED", T0 + SEC), T0 + 2 * SEC)).toBe(false);
  });

  it("الدالة نقيّة: نفس المُدخلات تُعطي نفس المُخرجات دائماً", () => {
    const f = facts({ lastFixAtMs: T0 + 5 * SEC });
    expect(sessionStateAt(f, T0 + 6 * SEC)).toBe(sessionStateAt(f, T0 + 6 * SEC));
    expect(recordFix(f, T0 + 7 * SEC, T0 + 7 * SEC)).toEqual(
      recordFix(f, T0 + 7 * SEC, T0 + 7 * SEC),
    );
  });

  it("السياسة قابلة للحقن ولا تُقرأ من ثابت عام", () => {
    const strict: SessionPolicy = { staleAfterSeconds: 5, maxSessionSeconds: 60 };
    const f = facts({ lastFixAtMs: T0 });
    expect(sessionStateAt(f, T0 + 6 * SEC, strict)).toBe("STALE");
    expect(sessionStateAt(f, T0 + 6 * SEC, DEFAULT_SESSION_POLICY)).toBe("ACTIVE");
  });
});
