/**
 * الغرض: منفذ حفظ وقائع جلسة التتبّع — المرحلة ٦.
 *   المنفذ هنا، وتنفيذه على PostgreSQL في infrastructure/tracking، ومزدوجه في الذاكرة أدناه.
 * الحالة: منفّذ فعلياً — يستهلكه packages/application/tracking/live-tracking.ts.
 * ينتمي إلى: packages/tracking
 * يُتوقع أن يستخدمه لاحقاً: مسار GPS عبر HTTP إن رُكِّب (apps/gateway/src/routes/tracking.ts)
 *
 * ## لماذا منفذ لا استعلام مباشر
 *
 * لأن للجلسة قارئين مختلفَي الطبيعة: المسار الحيّ (بوت السائق) يقرأ جلسةً واحدة
 * بمعرّف سائق مئات المرّات في الدقيقة، والعمليات تقرأ كل الجلسات المفتوحة مرّةً
 * كل بضع ثوانٍ. ودمجهما في نموذج قراءة واحد يُنتج استعلاماً سيّئاً للاثنين.
 *
 * ## ولماذا التوابع تُعيد الوقائع لا `void`
 *
 * لأن الكاتب في القاعدة هو من يحسم السباق (فهرس فريد جزئي على السائق الواحد)،
 * فالوقائع بعد الكتابة قد تخالف ما أُرسل: رسالتا موقعٍ متزامنتان تحاولان فتح
 * جلستين، والفائزة واحدة. ومن يفترض أن ما أرسله هو ما استقرّ يبني على وهم.
 */

import type { SessionEndReason, TrackingSessionFacts } from "../domain/tracking/session.ts";

/**
 * منفذ الجلسات. **يرمي عند عطل** ولا يعيد `Result`: مستهلكه الوحيد اليوم
 * (`live-tracking.ts`) يلفّ كل نداء بحاجزٍ واحد لأنّ سياسته واحدة لكل الأعطال —
 * النقل اللحظي عونٌ لا شرطٌ، وعطله لا يُبطل حفظ الموقع القانوني. فإعادة
 * `Result` هنا كانت ستُنتج تفريعاً في كل سطر ينتهي إلى نفس السطر.
 */
export interface TrackingSessionStore {
  /** الجلسة المفتوحة للسائق (ended_at is null)، أو `null`. */
  openSessionOf(driverId: string): Promise<TrackingSessionFacts | null>;

  /**
   * يفتح جلسة. إن كانت للسائق جلسةٌ مفتوحة أصلاً تُعاد كما هي **ولا تُفتح ثانية**:
   * الفتح فعلٌ متسامح مع التكرار لأن مصدره رسالة موقعٍ قد تتكرّر.
   */
  open(driverId: string, tripId: string | null, startedAtMs: number): Promise<TrackingSessionFacts>;

  /** يربط الجلسة المفتوحة برحلة (أو يفصلها بـ`null`). */
  attachTrip(driverId: string, tripId: string | null): Promise<TrackingSessionFacts | null>;

  /**
   * يقدّم آخر إصلاحة. الوقائع المُعادة هي ما استقرّ في القاعدة: `greatest` تمنع
   * أن تُرجِع إصلاحةٌ وصلت خارج ترتيبها المؤشّرَ إلى الوراء.
   */
  advance(driverId: string, lastFixAtMs: number): Promise<TrackingSessionFacts | null>;

  /** يُغلق جلسة السائق المفتوحة. `null` = لم تكن له جلسة مفتوحة. */
  close(
    driverId: string,
    reason: SessionEndReason,
    endedAtMs: number,
  ): Promise<TrackingSessionFacts | null>;

  /**
   * يُغلق كل الجلسات المفتوحة المرتبطة برحلة. مفتاحه الرحلة لا السائق لأن مُنهي
   * الرحلة (زرّ «أنهيت») يعرف الطلب ولا يعرف معرّف السائق الداخلي.
   */
  closeByTrip(
    tripId: string,
    reason: SessionEndReason,
    endedAtMs: number,
  ): Promise<readonly TrackingSessionFacts[]>;
}

/**
 * مزدوج في الذاكرة — للاختبارات الوحدوية وحدها.
 *
 * صريحٌ في اسمه أنه ذاكرة: كل ما جرى في المرحلة ٤ من لبس كان لأن تنفيذاً في
 * الذاكرة حمل اسماً محايداً، فبدا مرشّحاً للإنتاج.
 */
export function createMemoryTrackingSessionStore(): TrackingSessionStore {
  const open = new Map<string, TrackingSessionFacts>();

  const put = (facts: TrackingSessionFacts): TrackingSessionFacts => {
    open.set(facts.driverId, facts);
    return facts;
  };

  return {
    openSessionOf: async (driverId) => open.get(driverId) ?? null,

    open: async (driverId, tripId, startedAtMs) => {
      const existing = open.get(driverId);
      if (existing !== undefined) return existing;
      return put({
        driverId,
        tripId,
        startedAtMs,
        lastFixAtMs: null,
        endedAtMs: null,
        endReason: null,
      });
    },

    attachTrip: async (driverId, tripId) => {
      const existing = open.get(driverId);
      if (existing === undefined) return null;
      return put({ ...existing, tripId });
    },

    advance: async (driverId, lastFixAtMs) => {
      const existing = open.get(driverId);
      if (existing === undefined) return null;
      return put({
        ...existing,
        lastFixAtMs:
          existing.lastFixAtMs === null ? lastFixAtMs : Math.max(existing.lastFixAtMs, lastFixAtMs),
      });
    },

    close: async (driverId, reason, endedAtMs) => {
      const existing = open.get(driverId);
      if (existing === undefined) return null;
      open.delete(driverId);
      return { ...existing, endedAtMs, endReason: reason };
    },

    closeByTrip: async (tripId, reason, endedAtMs) => {
      const closed: TrackingSessionFacts[] = [];
      for (const [driverId, facts] of [...open.entries()]) {
        if (facts.tripId !== tripId) continue;
        open.delete(driverId);
        closed.push({ ...facts, endedAtMs, endReason: reason });
      }
      return closed;
    },
  };
}
