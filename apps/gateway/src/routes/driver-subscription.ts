/**
 * الغرض: مساراتُ اشتراكِ السائقِ — `GET /v1/driver/subscription` و
 *   `GET /v1/driver/subscription/history` و`POST /v1/driver/subscription/renew`
 *   (`F3-06` · `SD-07`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-06`.
 * ينتمي إلى: apps/gateway/src/routes
 * يُستخدم من: `apps/gateway/src/server.ts` عبرَ تركيبٍ اختياريٍّ.
 * يُتوقع أن يستخدمه لاحقاً: `F3-09` — تجديدٌ من واجهةٍ أخرى يُمرَّرُ عبرَ
 *   نفسِ حالةِ الاستخدامِ لا مسارٍ موازيٍ.
 * يحرسُه: scripts/check-driver-subscription-contract.ts
 * الحاكم: docs/adr/0094-project-independence.md
 *
 * ## لِمَ التجديدُ `POST` على مَورِدِ الاشتراكِ ولا `PATCH`
 *
 * لأنَّ السائقَ **لا يملكُ الاشتراكَ ككائنٍ يُعدَّلُه**: يملكُ فعلَ تجديدٍ
 * يبدأُ دفعَه. و`PATCH` يُوهِمُ أنَّ للسائقِ سلطاناً مباشراً على صفِّ الاشتراكِ،
 * وهيَ سلطةٌ لا يملكُها إلّا `activate_subscription` بالويبهوكِ.
 *
 * ## ولِمَ غيابُ المزوّدِ `503` لا `501`
 *
 * `501` يقولُ «لا أُتقنُ هذا الفعلَ أصلاً»، والمزوّدُ مهيّأٌ لكنَّهُ معطَّلٌ.
 * و`503` يقولُ «الخدمةُ معطَّلةٌ مؤقّتاً» — وهوَ ما يُريدُ السائقُ أن يعرفَه:
 * جرِّبْ لاحقاً. والرمزُ `PAYMENT_PROVIDER_NOT_AVAILABLE` يُعرَضُ نصّاً للسائقِ.
 *
 * ## وما لا تفعلُه هذه المساراتُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تقرأُ معرِّفَ سائقٍ من الطلبِ**: من الرمزِ الموقَّعِ وحدَه — ومعرِّفٌ
 *      في الجسمِ أو في ترويسةٍ **لا يُقرأُ ألبتّةَ**.
 *   ــ **لا تُفعِّلُ اشتراكاً**: التجديدُ يبدأُ الدفعَ، والتفعيلُ ويبهوك.
 *   ــ **لا تعرفُ سعراً مرمَّزاً**: السعرُ من `platform_settings` عبرَ
 *      `priceReader` في حالةِ الاستخدامِ، لا في المسارِ.
 *   ــ **لا تُحدِّدُ مزوّدَ دفعٍ مُحدَّداً**: المزوّدُ تبعيّةٌ تُحقَنُ أو تغيبُ.
 */

import { type Context, Hono } from "hono";
import {
  type DriverSubscriptionDeps,
  type DriverSubscriptionPublicErrorCode,
  type DriverSubscriptionRejection,
  type DriverSubscriptionRenewalDeps,
  readDriverSubscriptionDashboard,
  readDriverSubscriptionHistory,
  renewDriverSubscription,
} from "../../../../packages/application/driver/driver-subscription.ts";

export interface DriverSubscriptionRouteDependencies {
  /** غيابُها **يُعطّلُ المساراتِ بـ503** ولا يجعلها تُجيبُ بلا قاعدةٍ. */
  readonly subscription?: DriverSubscriptionDeps;
  /** غيابُها **يُسقِطُ التجديدَ بـ503** — والمزوّدُ غيرُ مهيّأٍ. */
  readonly renewal?: DriverSubscriptionRenewalDeps;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/** خريطةُ الحالاتِ — **شاملةٌ حرفاً** لاتّحادِ رموزِ الطبقةِ. */
const STATUS_BY_ERROR: Readonly<
  Record<DriverSubscriptionPublicErrorCode, 401 | 403 | 404 | 422 | 503>
> = {
  SESSION_REQUIRED: 401,
  SESSION_EXPIRED: 401,
  SESSION_INVALID: 401,
  SESSION_NOT_AVAILABLE: 503,
  SUBSCRIPTION_STORE_NOT_AVAILABLE: 503,
  NOT_A_DRIVER: 403,
  PAYMENT_PROVIDER_NOT_AVAILABLE: 503,
  PLAN_INVALID: 422,
  RENEWAL_FAILED: 503,
};

function rejected(c: Context, rejection: DriverSubscriptionRejection) {
  return c.json({ ok: false, error: rejection.code }, STATUS_BY_ERROR[rejection.code]);
}

function unavailable(code: DriverSubscriptionPublicErrorCode): DriverSubscriptionRejection {
  return { code };
}

function bearerTokenFrom(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const trimmed = header.trim();
  if (trimmed.length === 0) return undefined;
  const prefix = "Bearer ";
  if (trimmed.length < prefix.length) return undefined;
  if (trimmed.slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase()) return undefined;
  const token = trimmed.slice(prefix.length).trim();
  return token.length > 0 ? token : undefined;
}

async function readJsonBody(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const text = await c.req.text();
    if (text.length === 0) return null;
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function createDriverSubscriptionRoutes(deps: DriverSubscriptionRouteDependencies): Hono {
  const app = new Hono();

  /** «اشتراكي» — لوحُ الاشتراكِ بأسعارِه وتجربتِه وتحذيرِه. */
  app.get("/v1/driver/subscription", async (c) => {
    if (deps.subscription === undefined) {
      deps.log?.("driver_subscription.dashboard_disabled", {});
      return rejected(c, unavailable("SUBSCRIPTION_STORE_NOT_AVAILABLE"));
    }

    const result = await readDriverSubscriptionDashboard(deps.subscription, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
    });
    if (!result.ok) return rejected(c, result.error);

    const d = result.value;
    return c.json({
      ok: true,
      server_time: d.serverTime,
      has_subscription: d.hasSubscription,
      plan_prices: d.planPrices,
      currency: d.currency,
      trial_days: d.trialDays,
      period_days: d.periodDays,
      subscription_id: d.subscriptionId,
      plan: d.plan,
      status: d.status,
      is_trial: d.isTrial,
      price: d.price,
      trial_ends_at: d.trialEndsAt,
      current_period_end: d.currentPeriodEnd,
      ends_at: d.endsAt,
      days_left: d.daysLeft,
      expires_soon: d.expiresSoon,
      cancel_at_period_end: d.cancelAtPeriodEnd,
      cancellation_requested_at: d.cancellationRequestedAt,
      warning_days: d.warningDays,
    });
  });

  /** «تاريخُ الدفعاتِ» — سقفٌ خادميٌّ، والهويّةُ من الرمزِ الموقَّعِ. */
  app.get("/v1/driver/subscription/history", async (c) => {
    if (deps.subscription === undefined) {
      deps.log?.("driver_subscription.history_disabled", {});
      return rejected(c, unavailable("SUBSCRIPTION_STORE_NOT_AVAILABLE"));
    }

    const result = await readDriverSubscriptionHistory(deps.subscription, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      limit: c.req.query("limit"),
    });
    if (!result.ok) return rejected(c, result.error);

    const h = result.value;
    return c.json({
      ok: true,
      server_time: h.serverTime,
      limit: h.limit,
      entries: h.entries.map((entry) => ({
        transaction_id: entry.transactionId,
        amount_minor: entry.amountMinor,
        currency: entry.currency,
        provider: entry.provider,
        status: entry.status,
        created_at: entry.createdAt,
        updated_at: entry.updatedAt,
        plan: entry.plan,
        checkout_url: entry.checkoutUrl,
      })),
    });
  });

  /**
   * «جدِّد الآن» — يبدأُ دفعَ تجديدٍ عبرَ منفذِ الدفعِ القائمِ، ولا يُفعِّلُ
   * الاشتراكَ. وغيابُ مزوّدِ الدفعِ يُسقِطُ المسارَ بـ`503` لا يُنجَحُ صامتاً.
   */
  app.post("/v1/driver/subscription/renew", async (c) => {
    if (deps.renewal === undefined) {
      deps.log?.("driver_subscription.renewal_disabled", {});
      return rejected(c, unavailable("PAYMENT_PROVIDER_NOT_AVAILABLE"));
    }

    const body = await readJsonBody(c);
    const plan = body?.plan;

    const result = await renewDriverSubscription(deps.renewal, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      plan,
    });
    if (!result.ok) return rejected(c, result.error);

    const r = result.value;
    return c.json({
      ok: true,
      transaction_id: r.transactionId,
      checkout_url: r.checkoutUrl,
      status: r.status,
      plan: r.plan,
      amount_minor: r.amountMinor,
      currency: r.currency,
    });
  });

  return app;
}
