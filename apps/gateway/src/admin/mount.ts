/**
 * الغرض: الموضعُ **الوحيدُ** الذي يُركِّبُ سطحَ لوحةِ الإدارةِ الثلاثيَّ على تطبيقِ
 *   Hono — بترتيبِهِ الحرجِ. يستدعيه طرفانِ: البوّابةُ حين تُعلِنُ إدماجَ اللوحةِ،
 *   وعمليةُ `apps/admin` المستقلّةُ.
 * الحالة: منفّذ فعلياً — `F5-08` / `ARCH-011` · ADR 0064.
 * ينتمي إلى: apps/gateway/src/admin
 * يستخدمه: apps/gateway/src/index.ts · apps/admin/src/index.ts
 *
 * ## لِمَ دالّةٌ واحدةٌ لا ثلاثةُ `app.route` في كلِّ نقطةِ تشغيلٍ
 *
 * لأنّ ترتيبَ التركيبِ ههنا **ليس تفصيلاً أسلوبيّاً بل شرطُ صحّةٍ**: Hono يُطابِقُ
 * أوّلَ موجِّهٍ تُطابِقُ بادئتُهُ ولا يعودُ إلى ما بعدَه. فلو رُكِّبَ `/admin` قبلَ
 * `/admin/api` لالتقطَ حارسُ الصفحاتِ نداءاتِ JSON فأجابَ صفحةَ تسجيلِ دخولٍ
 * بترميزِ HTML على طلبٍ يتوقّعُ JSON، ولو رُكِّبَ `/admin/api` قبلَ
 * `/admin/api/live` لأجابَ موجِّهُ الـJSON بـ404 على مجرى SSE.
 *
 * وهذا الترتيبُ كان مكتوباً في `apps/gateway/src/index.ts` وحدَها ومُعلَّلاً في
 * تعليقَينِ طويلَين. فلمّا صارَ للّوحةِ **نقطةُ تشغيلٍ ثانيةٌ** (`apps/admin`) صارَ
 * نسخُ الثلاثةِ إليها يعني موضعَي حقيقةٍ لترتيبٍ حرجٍ: يُصحَّحُ في أحدِهما ويُنسى
 * الآخرُ، فتعملُ اللوحةُ في البوّابةِ وتُخفِقُ في خدمتِها — أو أسوأ: تعملُ في
 * الاثنَينِ بسلوكَينِ مختلفَين. فالترتيبُ ههنا مرّةً واحدةً، ومحروسٌ باختبارٍ يقرأُ
 * `ADMIN_MOUNT_PATHS` ويُطابِقُ التسلسل.
 *
 * ## ولِمَ لم تُنقَل ملفّاتُ الموجِّهاتِ إلى `apps/admin`
 *
 * لأنّ النقلَ يُحرِّكُ `routes/admin-*.ts` و`admin/*.ts` وكلَّ ما تستوردُهُ
 * اختباراتُها — عشراتُ ملفّاتٍ تتغيّرُ مساراتُ استيرادِها بلا سطرِ سلوكٍ واحدٍ
 * يتغيّر. والمطلوبُ في `ARCH-011` **فصلُ العمليّاتِ** لا إعادةُ ترتيبِ المجلّدات:
 * الحدُّ الذي يهمُّ هو حدُّ العمليةِ ومَن يسحبُ من بِركةِ اتّصالاتِها. فالموجِّهاتُ
 * تبقى حيثُ اختباراتُها، والتركيبُ يُستورَدُ من ههنا.
 *
 * ## وما لا تفعلُهُ هذه الدالّةُ
 *
 * لا تبني تبعيّةً ولا تقرأُ ضبطاً ولا تُنشئُ اتّصالاً. كلُّ ما تحتاجُهُ يُمرَّرُ —
 * لأنّ الطرفَينِ يبنيانِ تبعيّاتِهما بطريقتَينِ مختلفتَينِ اختلافاً أصيلاً:
 * البوّابةُ لها حاويةٌ كاملةٌ فيها بوتانِ وطابورٌ وصندوقُ صادرٍ، وعمليةُ اللوحةِ
 * لها حاويةٌ ضيّقةٌ لا تعرفُ من ذلك شيئاً. ودالّةُ تركيبٍ تبني بنفسِها كانت ستجرَّ
 * الأولى إلى الثانية.
 */

import type { Hono } from "hono";
import type { SessionRevocationStore } from "../../../../packages/application/identity/ports.ts";
import type { Sql } from "../../../../packages/infrastructure/db/client.ts";
import type { TrackingEventBus } from "../../../../packages/infrastructure/tracking/event-bus.ts";
import type { ResolvedMapStyle } from "../../../../packages/maps/index.ts";
import { createAdminApiRoutes } from "../routes/admin-api.ts";
import { createAdminLiveRoutes } from "../routes/admin-live.ts";
import { createAdminUiRoutes } from "../routes/admin-ui.ts";
import type { AdminAuthPort, AdminCodeSender } from "./auth.ts";

export interface AdminSurfaceDependencies {
  readonly sql: Sql;
  readonly auth: AdminAuthPort;
  /**
   * ناقلُ أحداثِ التتبّعِ لمجرى SSE. وفي عمليةِ اللوحةِ المستقلّةِ **يجبُ أن يكونَ
   * مغلَّفاً بـRedis Streams** وإلّا اشتركَ المجرى في ناقلٍ محلّيٍّ لا يصلُهُ حدثٌ
   * أبداً: الأحداثُ تُنشَرُ في عمليةِ البوّابةِ حيثُ يصلُ ويبهوكُ الموقعِ. وهذا هو
   * السببُ الذي جعلَ `SCL-004` شرطاً سابقاً لهذه المرحلةِ لا تحسيناً جانبيّاً.
   */
  readonly bus: TrackingEventBus;
  readonly codeSender: AdminCodeSender;
  readonly mapOrigins?: readonly string[];
  readonly mapStyle?: ResolvedMapStyle;
  readonly maplibreSri?: string | null;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
  /**
   * مخزنُ إبطالِ جلساتِ Mini App (`SEC-18-ب`) — يُمرَّرُ ولا يُبنى ههنا، كسائرِ
   * تبعيّاتِ هذا السطحِ. وغيابُهُ يُعطِّلُ مسلكَ الإبطالِ ردَّ ٥٠٣ ولا يُسكِتُهُ.
   */
  readonly revocation?: SessionRevocationStore;
}

/**
 * بادئاتُ التركيبِ **بترتيبِها المُلزِمِ**: الأخصُّ أوّلاً. مُصدَّرةٌ لا لتُقرأَ في
 * التشغيلِ بل ليُطابِقَها اختبارٌ — فادّعاءُ «الترتيبُ في موضعٍ واحدٍ» لا يصيرُ
 * وعداً محقَّقاً إلّا بشيءٍ يفشلُ إن اختلَّ.
 */
export const ADMIN_MOUNT_PATHS = ["/admin/api/live", "/admin/api", "/admin"] as const;

/**
 * يُركِّبُ السطحَ الثلاثيَّ على `app` ويُعيدُهُ. لا يرمي ولا يقرأُ بيئةً.
 *
 * والترتيبُ أدناه يُطابِقُ `ADMIN_MOUNT_PATHS` حرفاً — ومَن أرادَ تغييرَهُ يُغيِّرُ
 * الاثنَينِ فيسقطُ الاختبارُ إن غيَّرَ واحداً.
 */
export function mountAdminSurface(app: Hono, deps: AdminSurfaceDependencies): Hono {
  app.route(
    "/admin/api/live",
    createAdminLiveRoutes({
      sql: deps.sql,
      auth: deps.auth,
      bus: deps.bus,
      ...(deps.log === undefined ? {} : { log: deps.log }),
    }),
  );

  app.route("/admin/api", createAdminApiRoutes({ sql: deps.sql, auth: deps.auth }));

  app.route(
    "/admin",
    createAdminUiRoutes({
      sql: deps.sql,
      auth: deps.auth,
      codeSender: deps.codeSender,
      ...(deps.mapOrigins === undefined ? {} : { mapOrigins: deps.mapOrigins }),
      ...(deps.mapStyle === undefined ? {} : { mapStyle: deps.mapStyle }),
      ...(deps.maplibreSri === undefined ? {} : { maplibreSri: deps.maplibreSri }),
      ...(deps.log === undefined ? {} : { log: deps.log }),
      ...(deps.revocation === undefined ? {} : { revocation: deps.revocation }),
    }),
  );

  return app;
}
