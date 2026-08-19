/**
 * الغرض: وقائع جلسة التتبّع في PostgreSQL — تنفيذ `TrackingSessionStore`.
 * الحالة: منفّذ فعلياً ومُختبَر على قاعدة حقيقية — المرحلة ٦.
 * ينتمي إلى: infrastructure/tracking
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts، ونماذج قراءة خريطة العمليات
 *
 * ## لماذا كل تابع جملة `update ... where ended_at is null` واحدة
 *
 * لأن البديل — قراءةٌ ثم كتابةٌ في التطبيق — يفتح نافذةً بين الاثنين تكفي
 * لرسالتَي موقعٍ متزامنتين من نفس السائق (تلغرام يُرسل تحديثات الموقع الحيّ
 * تباعاً، ولا شيء يضمن تسلسلها في الخادم). فيقرأ النداءان «لا جلسة» ثم يُدرج
 * كلاهما.
 *
 * والفهرس الفريد الجزئي (`tracking_sessions_one_open_per_driver`) يمنع الصفّ
 * الثاني، لكنه يمنعه **بخطأ** لا بصمت — فيجب أن يكون في المسار جوابٌ لذلك
 * الخطأ. ولذلك الفتح `on conflict do nothing` ثم قراءةُ المستقرّ: الفائز واحد،
 * والخاسر يقرأ ما كتبه الفائز ويكمل بلا فشلٍ يظهر للسائق.
 */

import type { SessionEndReason, TrackingSessionFacts } from "../../domain/tracking/session.ts";
import type { TrackingSessionStore } from "../../tracking/session-store.ts";
import type { Sql } from "../db/client.ts";

interface SessionRow {
  readonly driver_id: string;
  readonly trip_id: string | null;
  readonly started_at: string | Date;
  readonly last_fix_at: string | Date | null;
  readonly ended_at: string | Date | null;
  readonly end_reason: string | null;
}

const SELECT_COLUMNS = "driver_id, trip_id, started_at, last_fix_at, ended_at, end_reason";

function ms(value: string | Date): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function toFacts(row: SessionRow): TrackingSessionFacts {
  return {
    driverId: row.driver_id,
    tripId: row.trip_id,
    startedAtMs: ms(row.started_at),
    lastFixAtMs: row.last_fix_at === null ? null : ms(row.last_fix_at),
    endedAtMs: row.ended_at === null ? null : ms(row.ended_at),
    endReason: row.end_reason as SessionEndReason | null,
  };
}

export function createTrackingSessionRepository(sql: Sql): TrackingSessionStore {
  const openOf = async (driverId: string): Promise<TrackingSessionFacts | null> => {
    const rows = await sql<SessionRow[]>`
      select driver_id, trip_id, started_at, last_fix_at, ended_at, end_reason
        from tracking_sessions
       where driver_id = ${driverId}::uuid and ended_at is null
       limit 1
    `;
    const row = rows[0];
    return row === undefined ? null : toFacts(row);
  };

  return {
    openSessionOf: openOf,

    open: async (driverId, tripId, startedAtMs) => {
      /**
       * `on conflict do nothing` على الفهرس الجزئي: من خسر السباق لا يفشل ولا
       * يُنشئ صفّاً ثانياً، بل يقرأ الجلسة التي استقرّت. وهذا يجعل «الفتح» فعلاً
       * متسامحاً مع التكرار كما ينصّ منفذه — والتسامح شرطٌ لا رفاهية: مصدر
       * النداء رسالةُ موقعٍ تصل مرّاتٍ في الثانية.
       */
      /**
       * و`city_id` تُشتقّ من `drivers` في نفس الجملة لا تُمرَّر من النداء:
       * فمدينة الجلسة واقعةٌ تُثبَّت لحظة الفتح (راجع الهجرة)، ومن يفتح الجلسة هو
       * مسار رسالة الموقع الذي لا يعرف المدينة ولا ينبغي أن يعرفها. ولو مُرِّرت
       * لصارت للمدينة كاتبان: `drivers` والنداء — وأوّل اختلافٍ بينهما يُنتج
       * جلسةً لا تظهر في خريطة أي مدينة.
       */
      const inserted = await sql<SessionRow[]>`
        insert into tracking_sessions (driver_id, city_id, trip_id, started_at)
        select d.id, d.city_id,
               ${tripId === null ? null : sql`${tripId}::uuid`},
               ${new Date(startedAtMs)}
          from drivers d
         where d.id = ${driverId}::uuid
        on conflict do nothing
        returning ${sql.unsafe(SELECT_COLUMNS)}
      `;
      const row = inserted[0];
      if (row !== undefined) return toFacts(row);

      const existing = await openOf(driverId);
      if (existing !== null) return existing;
      // لا صفّ أُدرج ولا صفّ مفتوح: تعارضٌ من غير الفهرس الجزئي (سائق محذوف مثلاً).
      throw new Error("تعذّر فتح جلسة تتبّع ولا توجد جلسة مفتوحة");
    },

    attachTrip: async (driverId, tripId) => {
      const rows = await sql<SessionRow[]>`
        update tracking_sessions
           set trip_id = ${tripId === null ? null : sql`${tripId}::uuid`},
               updated_at = now()
         where driver_id = ${driverId}::uuid and ended_at is null
        returning ${sql.unsafe(SELECT_COLUMNS)}
      `;
      const row = rows[0];
      return row === undefined ? null : toFacts(row);
    },

    advance: async (driverId, lastFixAtMs) => {
      /**
       * `greatest` في القاعدة لا `Math.max` في التطبيق: المقارنة يجب أن تجري
       * على القيمة المستقرّة في الصفّ لحظةَ الكتابة، وإلا كتب نداءان متزامنان
       * كلٌّ منهما بناءً على قراءةٍ قديمة، فتُرجِع الأقدمُ المؤشّرَ إلى الوراء
       * ويصير سائقٌ يُرسل باستمرار «منقطعاً» في نظر العمليات.
       */
      const rows = await sql<SessionRow[]>`
        update tracking_sessions
           set last_fix_at = greatest(coalesce(last_fix_at, ${new Date(lastFixAtMs)}),
                                      ${new Date(lastFixAtMs)}),
               updated_at = now()
         where driver_id = ${driverId}::uuid and ended_at is null
        returning ${sql.unsafe(SELECT_COLUMNS)}
      `;
      const row = rows[0];
      return row === undefined ? null : toFacts(row);
    },

    close: async (driverId, reason, endedAtMs) => {
      const rows = await sql<SessionRow[]>`
        update tracking_sessions
           set ended_at = ${new Date(endedAtMs)}, end_reason = ${reason}, updated_at = now()
         where driver_id = ${driverId}::uuid and ended_at is null
        returning ${sql.unsafe(SELECT_COLUMNS)}
      `;
      const row = rows[0];
      return row === undefined ? null : toFacts(row);
    },

    closeByTrip: async (tripId, reason, endedAtMs) => {
      const rows = await sql<SessionRow[]>`
        update tracking_sessions
           set ended_at = ${new Date(endedAtMs)}, end_reason = ${reason}, updated_at = now()
         where trip_id = ${tripId}::uuid and ended_at is null
        returning ${sql.unsafe(SELECT_COLUMNS)}
      `;
      return rows.map(toFacts);
    },
  };
}
