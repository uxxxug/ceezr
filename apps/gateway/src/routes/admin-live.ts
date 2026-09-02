/**
 * الغرض: مجرى SSE لخريطة العمليات — لقطةٌ من القاعدة ثم دلتا لحظية، خلف حارس جلسة اللوحة نفسه.
 * الحالة: منفّذ فعلياً — المرحلة ٦. مركَّب في apps/gateway/src/index.ts على /admin/api/live.
 * ينتمي إلى: apps/gateway/src/routes
 * يُتوقع أن يستخدمه لاحقاً: خريطة العمليات الحيّة (المرحلة ١٣) بديلاً عن استطلاع layout.ts
 *
 * ## لماذا SSE لا WebSocket
 *
 * الاتجاه هنا واحد: الخادم يدفع والمشغّل يشاهد. ولا فعل يُرسَل في القناة — أفعال
 * اللوحة نماذجُ POST محميّة بـCSRF، ونقلُها إلى قناةٍ دائمة يعني بناء تصريحٍ
 * وحماية تكرارٍ من الصفر لسطحٍ جديد.
 *
 * وSSE فوق HTTP يعني: نفس الكعكة، ونفس الحارس، ونفس الوسيط العكسي، وإعادةُ اتصالٍ
 * يُنفّذها المتصفّح وحده. وWebSocket كان يعني مصادقةً على ترقيةٍ لا تحمل الكعكة
 * دائماً عبر الوسطاء، ونبضاً نكتبه بأنفسنا.
 *
 * ## ولماذا التصريح في `subscribe` لا في حلقة الكتابة
 *
 * لأن الحلقة تكتب ما وصلها. فلو كان الترشيح فيها لكان الحدث قد **دخل** المجرى
 * قبل الحكم عليه، ولكان سهوٌ في سطرٍ واحد تسريباً لكل ما يمرّ. والعقد الحالي:
 * الناقل لا يُسلِّم حدثاً لمشتركٍ لا يحقّ له — والمسار لا يملك ما يُرشّح.
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { OperationsWatchScope } from "../../../../packages/domain/tracking/visibility.ts";
import type { Sql } from "../../../../packages/infrastructure/db/client.ts";
import type { TrackingEventBus } from "../../../../packages/infrastructure/tracking/event-bus.ts";
import type { TrackingEvent } from "../../../../packages/tracking/index.ts";
import type { AdminAuthPort } from "../admin/auth.ts";
import { type AdminEnv, createAdminGuard } from "../admin/guard.ts";
import { listLiveDriverStatuses } from "../admin/queries.ts";

export interface AdminLiveDependencies {
  readonly sql: Sql;
  readonly auth: AdminAuthPort;
  readonly bus: TrackingEventBus;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/** دورة الحلقة: أقصى تأخّر لدفع حدثٍ وصل الطابور. */
const TICK_MS = 1_000;
/** نبضة تُبقي الوسطاء من قطع مجرى ساكن. */
const HEARTBEAT_MS = 15_000;
/** إعادة قراءة اللقطة — مِرساة الصحّة إن سقط حدث أو تعدّدت النسخ. */
const SNAPSHOT_REFRESH_MS = 20_000;
/** سقف الطابور لكل مشترك. */
const MAX_QUEUE = 500;

function scopeOf(cityQuery: string | undefined): OperationsWatchScope {
  /**
   * غياب `?city` = كل المدن. وهذا ليس توسيعاً للصلاحية بل مطابقةٌ لما تفعله
   * `/admin/api/*` اليوم حرفياً: `cityParam` تعيد `null` فتُقرأ كل المدن. ولو
   * حُصر المجرى بمدينة جلسة المشغّل لصار مصدرين للحقيقة في نفس اللوحة —
   * جدولٌ يعرض كل المدن وخريطةٌ تعرض واحدة. وتضييق النطاق فعلاً قرار المرحلة ١٩
   * (الأدوار)، ويُطبَّق على السطحين معاً أو لا يُطبَّق.
   */
  if (cityQuery === undefined || cityQuery === "" || cityQuery === "all") {
    return { kind: "all_cities" };
  }
  return { kind: "city", cityId: cityQuery };
}

export function createAdminLiveRoutes(deps: AdminLiveDependencies): Hono<AdminEnv> {
  const log = deps.log ?? ((): void => undefined);
  const app = new Hono<AdminEnv>();
  app.use("*", createAdminGuard(deps.auth, "api", log));

  app.get("/drivers", (c) => {
    const cityQuery = c.req.query("city");
    const scope = scopeOf(cityQuery);
    const cityId = scope.kind === "city" ? scope.cityId : null;

    return streamSSE(c, async (stream) => {
      /**
       * طابورٌ ثم كتابة — لا كتابةٌ من داخل `deliver`.
       *
       * السبب أن `publish` في الناقل ينتظر كل مُستقبِل بالتسلسل: لو كتب
       * المُستقبِل في المقبس مباشرةً لصار مشغّلٌ على شبكةٍ بطيئة يُبطئ **نشر كل
       * حدثٍ لكل مشترك** — أي أنّ متصفّحاً واحداً يُعطّل التتبّع للجميع. والطابور
       * يفصل سرعة النشر عن سرعة أبطأ قارئ.
       */
      const queue: TrackingEvent[] = [];
      let dropped = 0;

      const unsubscribe = deps.bus.subscribe(
        { kind: "operations", scope },
        {
          deliver: (event) => {
            if (queue.length >= MAX_QUEUE) {
              /**
               * الطابور ممتلئ ⇒ إسقاطٌ معلوم لا تضخّمٌ بلا حدّ. مجرى لا يُقرأ
               * يجعل الطابور يأكل الذاكرة إلى أن تموت النسخة — وهي طريقة نقلٍ
               * تُسقط النظام كله من أجل لوحةٍ واحدة معلّقة.
               *
               * والإسقاط آمن هنا وحده: اللقطة الدورية تُصحّح ما فُقد بعد ثوانٍ،
               * لأن الحقيقة في القاعدة لا في مجرى الأحداث.
               */
              dropped += 1;
              return;
            }
            queue.push(event);
          },
        },
      );

      stream.onAbort(() => {
        unsubscribe();
      });

      /**
       * اللقطةُ تحمل الحالةَ التشغيلية مُشتقّةً من موضعِ الاشتقاق نفسِه الذي تقرأ
       * منه صفحةُ `/admin/live-map` (المرحلة ١٣). ولو اشتقّ كلُّ سطحٍ حالتَه لأمكن
       * أن يقول المجرى غيرَ ما تقول الصفحةُ للسائق نفسِه في اللحظة نفسها.
       */
      const sendSnapshot = async (): Promise<void> => {
        const rows = await listLiveDriverStatuses(deps.sql, cityId);
        await stream.writeSSE({
          event: "snapshot",
          data: JSON.stringify({ at: new Date().toISOString(), rows }),
        });
      };

      try {
        await sendSnapshot();
        let lastSnapshotMs = Date.now();
        let lastBeatMs = Date.now();

        while (!stream.aborted && !stream.closed) {
          while (queue.length > 0) {
            const event = queue.shift();
            if (event === undefined) break;
            await stream.writeSSE({
              event: "tracking",
              data: JSON.stringify({
                type: event.type,
                driverId: event.driverId,
                tripId: event.tripId,
                /**
                 * `BUG-009` — مرساةُ الترتيبِ تعبُر السلكَ ولا تبقى في العمليةِ.
                 *
                 * وهما نفسُ الحقلَينِ اللذَينِ تحملهما اللقطةُ (`sessionId`
                 * و`sessionSequence` في صفوفِها)، فيملك العميلُ أن يُحاذي
                 * `lastAppliedSeq` من اللقطةِ ثمّ يحكم على كلِّ فرقٍ بعدها بلا استفتاءٍ
                 * ثانٍ (`ADR 0053` §٣-أ/٨). ولا مستهلكَ داخلَ المستودعِ لهذا
                 * المجرى اليومَ (صفحةُ `/admin/live-map` تُصيَّر في الخادمِ وتُحدّث
                 * بـ`meta refresh`)، لكنَّ مجرىً يُرسِل فروقاً بلا مرساةٍ يفرض على
                 * أوّلِ عميلٍ يُكتب أن يخترع ترتيباً من `at` — وهو ساعةٌ لا رتبةٌ.
                 */
                sessionId: event.sessionId,
                sequence: event.sequence,
                cityId: event.cityId ?? null,
                position: event.position,
                at: event.timestamp.toISOString(),
                metadata: event.metadata ?? null,
              }),
            });
          }

          const now = Date.now();
          if (now - lastSnapshotMs >= SNAPSHOT_REFRESH_MS) {
            await sendSnapshot();
            lastSnapshotMs = now;
            lastBeatMs = now;
          } else if (now - lastBeatMs >= HEARTBEAT_MS) {
            await stream.writeSSE({
              event: "heartbeat",
              data: JSON.stringify({ at: new Date().toISOString(), dropped }),
            });
            lastBeatMs = now;
          }

          await stream.sleep(TICK_MS);
        }
      } finally {
        // الفصل في `finally` **و** في `onAbort`: الأولى تُغطّي الخروج بخطأ
        // (عطل قاعدة في اللقطة)، والثانية تُغطّي قطعاً من العميل لا يمرّ بها.
        unsubscribe();
      }
    });
  });

  return app;
}
