/**
 * الغرض: تركيب تطبيق Hono الفعلي: المسارات، معالجة الأخطاء، ورفض ما لا يُعرَف.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: apps/gateway
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/index.ts، tests/unit/gateway-*.test.ts
 * ملاحظات مستقبلية: مسارات لوحة الإدارة تُضاف كموجّه منفصل بلا تعديل هذا الملف.
 *
 * `F1-08`: أُضيف وسيطُ معرّفِ الطلبِ **أوّلَ الوسائطِ** (`observability/request-id.ts`)
 * فيلحق `X-Request-Id` كلَّ ردٍّ — ناجحاً كان أو `404` أو استثناءً غيرَ متوقَّعٍ.
 */

import { Hono } from "hono";
import { createRequestIdMiddleware } from "./observability/request-id.ts";
import { type ConsentRouteDependencies, createConsentRoutes } from "./routes/consents.ts";
import {
  type CoreEventIntakeDependencies,
  createCoreEventIntakeRoutes,
} from "./routes/core-event-intake.ts";
import {
  createDestinationsRoutes,
  type DestinationsRouteDependencies,
} from "./routes/destinations.ts";
import {
  createDriverLocationRoutes,
  type DriverLocationDependencies,
} from "./routes/driver-location.ts";
import { createHealthRoutes, type HealthDependencies } from "./routes/health.ts";
import { createMeRoutes, type MeDependencies } from "./routes/me.ts";
import { createPlacesRoutes, type PlacesRouteDependencies } from "./routes/me-places.ts";
import {
  createNotificationRoutes,
  type NotificationsDependencies,
} from "./routes/notifications.ts";
import {
  createPaymentWebhookRoutes,
  type PaymentWebhookDependencies,
} from "./routes/payment-webhook.ts";
import { createQuoteRoutes, type QuoteRouteDependencies } from "./routes/quote.ts";
import { createRidesRoutes, type RidesRouteDependencies } from "./routes/rides.ts";
import { createSafetyRoutes, type SafetyRouteDependencies } from "./routes/safety.ts";
import {
  createSessionRefreshRoutes,
  type SessionRefreshDependencies,
} from "./routes/session-refresh.ts";
import {
  createSessionTelegramRoutes,
  type SessionTelegramDependencies,
} from "./routes/session-telegram.ts";
import {
  createTelegramWebhookRoutes,
  type WebhookDependencies,
} from "./routes/telegram-webhook.ts";

export interface ServerDependencies {
  readonly health: HealthDependencies;
  readonly webhook: WebhookDependencies;
  /** منفذ ويبهوك الدفع — اختياري: يُفعَّل فقط عند توفّر أسرار الدفع (البند 8). */
  readonly paymentWebhook?: PaymentWebhookDependencies;
  /**
   * مسارُ جلسةِ التطبيقِ المصغَّر (`F1-03`) — اختياريٌّ: يُركَّب فقط عند توفّرِ سرِّ
   * التوقيعِ ورمزِ بوتٍ موقِّع. وغيابُه هنا يعني أنّ المسارَ غيرُ موجودٍ أصلاً
   * (`404`)، وحضورُه بلا تبعياتِ تحقّقٍ يعني تعطيلاً معلَناً (`503`).
   */
  readonly sessionTelegram?: SessionTelegramDependencies;
  /**
   * مسارُ تجديدِ الجلسة (`F1-04`) — اختياريٌ بنفسِ منطقِ مسارِ الإنشاء:
   * غيابُه هنا = لا مسار (`404`)، وحضورُه بلا تبعياتٍ = تعطيلٌ معلَن (`503`).
   */
  readonly sessionRefresh?: SessionRefreshDependencies;
  /**
   * مسارُ قراءةِ الدورِ والحالة (`F1-05`) — اختياريٌّ بنفسِ منطقِ مسارَي الجلسة:
   * غيابُه هنا = لا مسار (`404`)، وحضورُه بلا تبعياتٍ = تعطيلٌ معلَن (`503`).
   */
  readonly me?: MeDependencies;
  /**
   * مسارا الموافقاتِ (`F2-01`) — اختياريّانِ بنفسِ المنطقِ: غيابُهما هنا = لا
   * مسارَ (`404`)، وحضورُهما بلا تبعياتٍ = تعطيلٌ معلَنٌ (`503`). ولا يُركَّبانِ
   * مع سرِّ الجلسةِ وحدَه: يحتاجانِ سجلَّ الموافقاتِ في القاعدةِ أيضاً، فلا
   * يُعلَنُ مسارٌ يقبلُ إقراراً لا موضعَ لكتابتِه.
   */
  readonly consents?: ConsentRouteDependencies;
  /**
   * مساراتُ الأماكنِ المحفوظةِ وآخرِ الوجهاتِ (`F2-02` / `SR-02`) — كأخواتِها:
   * غيابُ الحقلِ = لا مسارَ (`404`)، وحضورُه بلا تبعياتٍ = تعطيلٌ معلَنٌ (`503`).
   */
  readonly places?: PlacesRouteDependencies;
  /**
   * مساراتُ اختيارِ الوجهةِ (`F2-03` / `SR-03`) — كأخواتِها: غيابُ الحقلِ = لا
   * مسارَ (`404`)، وحضورُه بلا تبعياتٍ = تعطيلٌ معلَنٌ (`503`). وهيَ **مفصولةٌ**
   * عن `places` وإن تشاركَتا سرَّ الجلسةِ: مصدرُ صفوفِها ثلاثةٌ لا واحدٌ، ودالّةُ
   * المصادقةِ تقرأُ حدَّ المدينةِ لا جدولَ الأماكنِ.
   */
  readonly destinations?: DestinationsRouteDependencies;
  /** غيابُها يُسقِطُ مسارَ الاقتباسِ من التركيبِ أصلاً (`F2-04`). */
  readonly quote?: QuoteRouteDependencies;
  /**
   * مساراتُ الرحلةِ (`F2-05` / `SR-05`): الإنشاءُ بمفتاحِ تكرارٍ إلزاميٍّ،
   * وقراءةُ حالةِ البحثِ، والإلغاءُ قبلَ الإسنادِ. وغيابُها يُسقِطُها من التركيبِ
   * أصلاً — **ولا يُنشَأُ مسارٌ يُجيبُ بلا كتابةٍ**: إنشاءٌ يعودُ `200` بلا صفٍّ
   * أسوأُ من مسارٍ غائبٍ، لأنَّ الشاشةَ تنتقلُ إلى بحثٍ عن رحلةٍ لا وجودَ لها.
   */
  readonly rides?: RidesRouteDependencies;
  /**
   * سطحُ الاستغاثةِ في التطبيقِ المصغَّرِ (`F2-10` / `SR-14`) — يُركَّبُ معَ سرِّ
   * الجلسةِ. وغيابُه **لا يُعطِّلُ الاستغاثةَ**: مسارُ البوتِ قائمٌ ومستقلٌّ،
   * وهذا سطحٌ ثانٍ على الحاكمِ نفسِه لا بديلٌ عنه.
   */
  readonly safety?: SafetyRouteDependencies;
  /**
   * مركزُ الإشعاراتِ داخلَ التطبيقِ (`F6-05` / `SS-07`) — يُركَّبُ مع سرِّ الجلسةِ
   * وحدَه. وغيابُه **لا يعطّلُ تصنيفَ الإشعاراتِ**: التصنيفُ في القاعدةِ يعملُ
   * سواءٌ رُكِّبَ هذا السطحُ أم لا، لأنَّ القرارَ الحرجَ لا يُترَكُ لسطحِ قراءةٍ
   * اختياريٍّ في خدمةٍ قد لا تُشغَّل.
   */
  readonly notifications?: NotificationsDependencies;
  /**
   * استقبالُ موقعِ السائقِ (`F4-01`) — يُركَّبُ مع سرِّ الجلسةِ والقاعدةِ. وغيابُه
   * **لا يُوقِفُ استقبالَ المواقعِ**: مسارُ البوتِ يكتبُ في المصدرِ القانونيِّ
   * نفسِه عبرَ حالةِ الاستخدامِ عينِها، فهذا سطحٌ ثانٍ لا مصدرُ حقيقةٍ ثانٍ.
   */
  readonly driverLocation?: DriverLocationDependencies;
  /**
   * `W-5`: بابُ أحداثِ CORE الواردةِ — اختياريٌّ: يُركَّبُ عندَ توفّرِ سرِّ توقيعِ
   * الاشتراكِ والقاعدةِ. وغيابُه هنا يعني `404` لا قبولاً صامتاً؛ وحضورُه بلا
   * سرٍّ سليمٍ يعني تعطيلاً معلَناً (`503`) لا تحقّقاً مُخفَّفاً.
   */
  readonly coreEventIntake?: CoreEventIntakeDependencies;
  /**
   * `F1-08`: مولّدُ معرّفِ الطلب — يُحقَن للاختبارِ وحدَه، وغيابُه يعني
   * `crypto.randomUUID`. ولا يُقرأ رأسُ `X-Request-Id` الوارِدُ من العميلِ في
   * أيِّ حالٍ (ADR 0043).
   */
  readonly newRequestId?: () => string;
}

export function createServer(deps: ServerDependencies): Hono {
  const app = new Hono();

  // `F1-08`: أوّلُ وسيطٍ قبلَ أيِّ مسارٍ — فمعرّفُ الطلبِ يلحق ردَّ المسارِ
  // وردَّ `404` وردَّ الاستثناءِ سواءً، لا الردودَ الناجحةَ وحدَها.
  app.use(
    "*",
    deps.newRequestId === undefined
      ? createRequestIdMiddleware()
      : createRequestIdMiddleware(deps.newRequestId),
  );

  app.route("/", createHealthRoutes(deps.health));
  app.route("/", createTelegramWebhookRoutes(deps.webhook));
  if (deps.paymentWebhook !== undefined) {
    app.route("/", createPaymentWebhookRoutes(deps.paymentWebhook));
  }
  if (deps.sessionTelegram !== undefined) {
    app.route("/", createSessionTelegramRoutes(deps.sessionTelegram));
  }
  if (deps.sessionRefresh !== undefined) {
    app.route("/", createSessionRefreshRoutes(deps.sessionRefresh));
  }
  if (deps.me !== undefined) {
    app.route("/", createMeRoutes(deps.me));
  }
  if (deps.consents !== undefined) {
    app.route("/", createConsentRoutes(deps.consents));
  }
  if (deps.places !== undefined) {
    app.route("/", createPlacesRoutes(deps.places));
  }
  if (deps.quote !== undefined) {
    app.route("/", createQuoteRoutes(deps.quote));
  }
  if (deps.rides !== undefined) {
    app.route("/", createRidesRoutes(deps.rides));
  }
  if (deps.safety !== undefined) {
    app.route("/", createSafetyRoutes(deps.safety));
  }

  if (deps.destinations !== undefined) {
    app.route("/", createDestinationsRoutes(deps.destinations));
  }
  if (deps.notifications !== undefined) {
    app.route("/", createNotificationRoutes(deps.notifications));
  }
  if (deps.driverLocation !== undefined) {
    app.route("/", createDriverLocationRoutes(deps.driverLocation));
  }
  if (deps.coreEventIntake !== undefined) {
    app.route("/", createCoreEventIntakeRoutes(deps.coreEventIntake));
  }

  app.notFound((c) => c.json({ ok: false, error: "NOT_FOUND" }, 404));

  // أي استثناء غير متوقَّع لا يكشف تفاصيل داخلية للمُرسِل
  app.onError((error, c) => {
    deps.webhook.log?.("gateway.webhook_unexpected_error", { message: String(error) });
    return c.json({ ok: false, error: "INTERNAL_ERROR" }, 500);
  });

  return app;
}
