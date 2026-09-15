/**
 * الغرض: محوّلُ اشتراكِ السائقِ على PostgreSQL — نداءُ دالّتَي `F3-06` وقراءةُ
 *   حمولتِهما **بلا افتراضٍ ولا حسابٍ** (`F3-06` · `SD-07`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-06`.
 * ينتمي إلى: infrastructure/driver
 * يُستخدم من: `apps/gateway/src/index.ts` عبرَ حقنِ التبعياتِ.
 * يُتوقع أن يستخدمه لاحقاً: `F3-09` — تجديدُ الاشتراكِ محوِّلٌ يُضافُ، ولا
 *   تُوسَّعُ هاتانِ الطريقتانِ لتُبدِئا الدفعَ.
 * يحرسُه: tests/integration/driver-subscription.test.ts ·
 *   scripts/check-driver-subscription-contract.ts
 * الحاكم: docs/adr/0094-project-independence.md
 *
 * ## لِمَ السعرُ يُقبَلُ من القاعدةِ ولا يُفحَصُ نطاقُه
 *
 * لأنَّ السعرَ من `platform_settings` — فإن كانَ سالباً فالعيبُ في الإعداداتِ
 * لا في القراءةِ. والتحقّقُ من النطاقِ ههنا يُنشِئُ مصدرَ حقيقةٍ ثانياً للسعرِ.
 * و`activate_subscription` نفسُها تثقُ بالإعداداتِ، فالمحوّلُ يثقُ بها مثله.
 *
 * ## وما لا يفعلُه هذا المحوّلُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يكتبُ ألبتّةَ**: لا `insert` ولا `update` ولا `delete`.
 *   ــ **لا يحسبُ سعراً ولا يُحدِّدُ مزوّداً**: القاعدةُ تقرأُ، والمحوّلُ ينقلُ.
 *   ــ **لا يُركِّبُ SQL نصّاً**: مُعامَلاتٌ مُمرَّرةٌ.
 *   ــ **لا يُصنِّفُ عطبَ شبكةٍ رفضاً**: استثناءٌ = `STORE_ERROR` = `503`.
 *   ــ **لا يقرأُ هويّةَ راكبٍ**: لا حقلَ ههنا ولا في التاريخِ.
 */

import type {
  DriverSubscriptionStore,
  DriverSubscriptionStoreError,
  DriverSubscriptionStoreRejection,
} from "../../application/driver/subscription-ports.ts";
import type {
  DriverSubscriptionDashboard,
  DriverSubscriptionHistory,
  SubscriptionPaymentEntry,
  SubscriptionPlanPrices,
} from "../../domain/driver/driver-subscription.ts";
import type { SubscriptionPlan } from "../../domain/subscription/entity.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

const REJECTIONS: readonly DriverSubscriptionStoreRejection[] = ["USER_NOT_FOUND", "NOT_A_DRIVER"];

function failed(reason: "STORE_ERROR" | "MALFORMED_RESULT"): DriverSubscriptionStoreError {
  return { reason } as const;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function readCount(value: unknown): number | null {
  const parsed = readNumber(value);
  if (parsed === null || !Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function readInstant(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const text = readText(value);
  if (text === null) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function asTelegramId(value: string): string | null {
  return /^[0-9]{1,19}$/.test(value) ? value : null;
}

function rejectionFrom(payload: Record<string, unknown>): DriverSubscriptionStoreError {
  const code = readText(payload.error);
  if (code === null || !(REJECTIONS as readonly string[]).includes(code)) {
    return failed("MALFORMED_RESULT");
  }
  return { rejection: code as DriverSubscriptionStoreRejection };
}

function readPlanPrices(value: unknown): SubscriptionPlanPrices | null {
  if (!isRecord(value)) return null;
  const transport = readNumber(value.transport);
  const delivery = readNumber(value.delivery);
  const both = readNumber(value.both);
  if (transport === null || delivery === null || both === null) return null;
  return { transport, delivery, both };
}

function isSubscriptionPlan(value: unknown): value is SubscriptionPlan {
  return value === "transport" || value === "delivery" || value === "both";
}

function readDashboardPayload(payload: unknown): DriverSubscriptionDashboard | null {
  if (!isRecord(payload)) return null;
  const serverTime = readInstant(payload.server_time);
  if (serverTime === null) return null;

  const currency = readText(payload.currency);
  if (currency === null) return null;

  const planPrices = readPlanPrices(payload.plan_prices);
  if (planPrices === null) return null;

  const trialDays = readCount(payload.trial_days);
  const periodDays = readCount(payload.period_days);
  if (trialDays === null || periodDays === null) return null;

  if (payload.has_subscription !== true) {
    return {
      serverTime,
      hasSubscription: false,
      planPrices,
      currency,
      trialDays,
      periodDays,
      subscriptionId: null,
      plan: null,
      status: null,
      isTrial: null,
      price: null,
      trialEndsAt: null,
      currentPeriodEnd: null,
      endsAt: null,
      daysLeft: null,
      expiresSoon: null,
      cancelAtPeriodEnd: null,
      cancellationRequestedAt: null,
      warningDays: null,
    };
  }

  const subscriptionId = readText(payload.subscription_id);
  const plan = isSubscriptionPlan(payload.plan) ? payload.plan : null;
  const status = readText(payload.status);
  const isTrial = typeof payload.is_trial === "boolean" ? payload.is_trial : null;
  const price = readNumber(payload.price);
  const trialEndsAt = readInstant(payload.trial_ends_at);
  const currentPeriodEnd = readInstant(payload.current_period_end);
  const endsAt = readInstant(payload.ends_at);
  const daysLeft =
    payload.days_left === null || payload.days_left === undefined
      ? null
      : readCount(payload.days_left);
  const expiresSoon = typeof payload.expires_soon === "boolean" ? payload.expires_soon : null;
  const cancelAtPeriodEnd =
    typeof payload.cancel_at_period_end === "boolean" ? payload.cancel_at_period_end : null;
  const cancellationRequestedAt = readInstant(payload.cancellation_requested_at);
  const warningDays = readCount(payload.warning_days);

  if (
    subscriptionId === null ||
    plan === null ||
    status === null ||
    isTrial === null ||
    price === null ||
    warningDays === null
  ) {
    return null;
  }

  return {
    serverTime,
    hasSubscription: true,
    planPrices,
    currency,
    trialDays,
    periodDays,
    subscriptionId,
    plan,
    status: status as DriverSubscriptionDashboard["status"],
    isTrial,
    price,
    trialEndsAt,
    currentPeriodEnd,
    endsAt,
    daysLeft,
    expiresSoon,
    cancelAtPeriodEnd,
    cancellationRequestedAt,
    warningDays,
  };
}

function readEntry(value: unknown): SubscriptionPaymentEntry | null {
  if (!isRecord(value)) return null;
  const transactionId = readText(value.transaction_id);
  const amountMinor = readCount(value.amount_minor);
  const currency = readText(value.currency);
  const provider = readText(value.provider);
  const status = readText(value.status);
  const createdAt = readInstant(value.created_at);
  const updatedAt = readInstant(value.updated_at);
  const plan = readText(value.plan);
  const checkoutUrl = readText(value.checkout_url);

  if (
    transactionId === null ||
    amountMinor === null ||
    currency === null ||
    provider === null ||
    status === null ||
    createdAt === null
  ) {
    return null;
  }

  return {
    transactionId,
    amountMinor,
    currency,
    provider,
    status,
    createdAt,
    updatedAt,
    plan,
    checkoutUrl,
  };
}

interface ResultRow {
  readonly result: unknown;
}

export class PostgresDriverSubscriptionStore implements DriverSubscriptionStore {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async readDashboard(input: {
    readonly telegramUserId: string;
  }): Promise<Result<DriverSubscriptionDashboard, DriverSubscriptionStoreError>> {
    const telegramId = asTelegramId(input.telegramUserId);
    if (telegramId === null) return err(failed("MALFORMED_RESULT"));

    let rows: ResultRow[];
    try {
      rows = await this.#sql<ResultRow[]>`
        select driver_subscription_dashboard(${telegramId}::bigint) as result`;
    } catch {
      return err(failed("STORE_ERROR"));
    }

    const payload = rows[0]?.result;
    if (!isRecord(payload)) return err(failed("MALFORMED_RESULT"));
    if (payload.ok !== true) return err(rejectionFrom(payload));

    const dashboard = readDashboardPayload(payload);
    if (dashboard === null) return err(failed("MALFORMED_RESULT"));

    return ok(dashboard);
  }

  async readHistory(input: {
    readonly telegramUserId: string;
    readonly limit: number;
  }): Promise<Result<DriverSubscriptionHistory, DriverSubscriptionStoreError>> {
    const telegramId = asTelegramId(input.telegramUserId);
    if (telegramId === null) return err(failed("MALFORMED_RESULT"));

    let rows: ResultRow[];
    try {
      rows = await this.#sql<ResultRow[]>`
        select driver_subscription_history(${telegramId}::bigint, ${input.limit}::int) as result`;
    } catch {
      return err(failed("STORE_ERROR"));
    }

    const payload = rows[0]?.result;
    if (!isRecord(payload)) return err(failed("MALFORMED_RESULT"));
    if (payload.ok !== true) return err(rejectionFrom(payload));

    const serverTime = readInstant(payload.server_time);
    const limit = readCount(payload.limit);
    if (serverTime === null || limit === null || limit <= 0 || !Array.isArray(payload.entries)) {
      return err(failed("MALFORMED_RESULT"));
    }

    const entries: SubscriptionPaymentEntry[] = [];
    for (const raw of payload.entries) {
      const entry = readEntry(raw);
      if (entry === null) return err(failed("MALFORMED_RESULT"));
      entries.push(entry);
    }
    if (entries.length > limit) return err(failed("MALFORMED_RESULT"));

    return ok({ serverTime, limit, entries });
  }
}
