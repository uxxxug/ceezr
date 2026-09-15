/**
 * الغرض: حالاتُ استخدامِ اشتراكِ السائقِ — قراءةُ اللوحِ والتاريخِ، وتجديدٌ يبدأُ
 *   الدفعَ عبرَ منفذِ الدفعِ القائمِ (`F3-06` · `SD-07`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-06`.
 * ينتمي إلى: packages/application/driver
 * يُستخدم من: `apps/gateway/src/routes/driver-subscription.ts` عبرَ حقنِ التبعياتِ.
 * يُتوقع أن يستخدمه لاحقاً: `F3-09` — تجديدٌ من واجهةٍ أخرى يُعيدُ استخدامُ
 *   نفسَ حالةِ الاستخدامِ، لا مساراً موازياً.
 * يحرسُه: scripts/check-driver-subscription-contract.ts
 * الحاكم: docs/adr/0094-project-independence.md
 *
 * ## لِمَ التجديدُ حالةُ استخدامٍ مستقلّةٌ لا امتدادٌ للقراءةِ
 *
 * لأنَّ القراءةَ تُفتحُ نافذةً على `platform_settings` والدفعُ يُفتحُ نافذةً على
 * مزوّدِ الدفعِ — وحقُّ العقدِ مختلفٌ: ذاك يُسألُ «ما حالُه؟» وهذا يُسألُ «ابدأْ
 * دفعَه». ودمجُهما يجعلُ كلَّ قراءةٍ لِلوحٍ تُخاطِبُ مزوّداً لا علاقةَ له بالسؤال.
 *
 * ## ولِمَ التجديدُ يُعيدُ استخدامَ `subscribePlan` لا يُنشئُ مساراً موازياً
 *
 * لأنَّ التجديدَ دفعٌ جديدٌ بنفسِ سلسلةِ الخطواتِ: قراءةُ سعرٍ من الإعداداتِ،
 * إنشاءُ معاملةٍ، نداءُ المزوّدِ، حفظُ الرابطِ. وإعادةُ بنائِها تُنشِئُ مصدرَ
 * حقيقةٍ ثانياً للسعرِ وللإيدمبوتنسي وللمعاملةِ. فالتجديدُ يُمرِّرُ مفتاحَ
 * إيدمبوتنسي يُفرِّقُه عن الاشتراكِ الأوّلِ ويُعيدُ استخدامَ ما قامَ.
 *
 * ## وما لا تفعلُه هذه الحالاتُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تقرأُ معرِّفَ سائقٍ من طلبٍ**: من الجلسةِ وحدَها — فلا تقريرَ لغيرِه
 *      بتغييرِ رقمٍ.
 *   ــ **لا تُفعِّلُ اشتراكاً**: التجديدُ يبدأُ الدفعَ، والتفعيلُ ويبهوك.
 *   ــ **لا تحددُ مزوّدَ دفعٍ مُحدَّداً**: المزوّدُ تهيئةٌ تُحقَنُ، وغيابُه
 *      يُعلَنُ بـ`PAYMENT_PROVIDER_NOT_AVAILABLE` لا يُنجَحُ صامتاً.
 *   ــ **لا تُخزِّنُ سعراً في ثابتٍ**: السعرُ من `platform_settings` عبرَ
 *      `priceReader`، ولا رقمٌ تجاريٌّ في الكودِ.
 */

import type {
  DriverSubscriptionDashboard,
  DriverSubscriptionHistory,
  DriverSubscriptionRenewal,
} from "../../domain/driver/driver-subscription.ts";
import type { SubscriptionPlan } from "../../domain/subscription/entity.ts";
import type { CityId, DriverId } from "../../shared/kernel/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { DriverDirectory } from "../bots/types.ts";
import type { PaymentProvider, PaymentRepository } from "../financial/ports.ts";
import { subscribePlan } from "../financial/subscribe-plan.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import type { PortFailureError } from "../ports/index.ts";
import type {
  DriverSubscriptionStore,
  DriverSubscriptionStoreError,
} from "./subscription-ports.ts";
import { isDriverSubscriptionRejection } from "./subscription-ports.ts";

/** الخططُ المسموحُ بها للتجديدِ. */
export const PLANS: readonly SubscriptionPlan[] = ["transport", "delivery", "both"];

/** رموزُ العطبِ المنشورةُ — قائمةٌ تُقرأُ في زمنِ التشغيلِ ليُلزِمَ الحاجزُ نصّاً لكلٍّ. */
export const DRIVER_SUBSCRIPTION_PUBLIC_ERROR_CODES = [
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "SUBSCRIPTION_STORE_NOT_AVAILABLE",
  "NOT_A_DRIVER",
  "PAYMENT_PROVIDER_NOT_AVAILABLE",
  "PLAN_INVALID",
  "RENEWAL_FAILED",
] as const;

export type DriverSubscriptionPublicErrorCode =
  (typeof DRIVER_SUBSCRIPTION_PUBLIC_ERROR_CODES)[number];

export interface DriverSubscriptionRejection {
  readonly code: DriverSubscriptionPublicErrorCode;
}

export interface DriverSubscriptionDeps {
  readonly sessions: MiniAppSessionReader;
  readonly store: DriverSubscriptionStore;
  readonly now: () => Date;
}

/** سقفُ الصفحةِ ومبدؤُها — **مُعلَنانِ رقمانِ** يُقرآنِ في الحاجزِ وفي الاختبارِ. */
export const SUBSCRIPTION_HISTORY_DEFAULT_LIMIT = 20;
export const SUBSCRIPTION_HISTORY_MAX_LIMIT = 50;

/** تبعيّاتُ التجديدِ — تُحقَنُ فقط حينَ المزوّدُ مهيّأٌ. */
export interface DriverSubscriptionRenewalDeps {
  readonly sessions: MiniAppSessionReader;
  readonly drivers: DriverDirectory;
  readonly payments: PaymentRepository;
  readonly provider: PaymentProvider;
  readonly priceReader: (
    cityId: CityId,
    plan: SubscriptionPlan,
  ) => Promise<Result<{ amount: number; currency: string }, PortFailureError>>;
  readonly now: () => Date;
}

function rejection(code: DriverSubscriptionPublicErrorCode): DriverSubscriptionRejection {
  return { code };
}

function sessionErrorFrom(reason: string): DriverSubscriptionPublicErrorCode {
  if (reason === "EXPIRED") return "SESSION_EXPIRED";
  if (reason === "NOT_CONFIGURED") return "SESSION_NOT_AVAILABLE";
  return "SESSION_INVALID";
}

function openSession(
  deps: { readonly sessions: MiniAppSessionReader; readonly now: () => Date },
  accessToken: string | undefined,
): Result<string, DriverSubscriptionRejection> {
  if (accessToken === undefined || accessToken.length === 0) {
    return err(rejection("SESSION_REQUIRED"));
  }
  const session = deps.sessions.read(accessToken, deps.now().getTime());
  if (!session.ok) return err(rejection(sessionErrorFrom(session.error.reason)));
  return ok(session.value.telegramUserId);
}

function publicCodeFrom(error: DriverSubscriptionStoreError): DriverSubscriptionRejection {
  if (!isDriverSubscriptionRejection(error)) return rejection("SUBSCRIPTION_STORE_NOT_AVAILABLE");
  switch (error.rejection) {
    case "USER_NOT_FOUND":
    case "NOT_A_DRIVER":
      return rejection("NOT_A_DRIVER");
  }
}

/** سقفُ الصفحةِ من طلبٍ — **يُقصَرُ ولا يُرفَضُ**: رقمٌ خرافيٌّ في استعلامٍ ليسَ
 * عدواناً ولا يستحقُّ `422`، ونصٌّ غيرُ رقمٍ يُقرأُ افتراضاً. */
export function readHistoryLimit(value: unknown): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) return SUBSCRIPTION_HISTORY_DEFAULT_LIMIT;
  return Math.min(Math.max(parsed, 1), SUBSCRIPTION_HISTORY_MAX_LIMIT);
}

/** يتحقّقُ من أنَّ الخطةَ مسموحٌ بها للتجديدِ. */
export function parsePlan(value: unknown): SubscriptionPlan | null {
  if (typeof value !== "string") return null;
  return (PLANS as readonly string[]).includes(value) ? (value as SubscriptionPlan) : null;
}

export async function readDriverSubscriptionDashboard(
  deps: DriverSubscriptionDeps,
  input: { readonly accessToken: string | undefined },
): Promise<Result<DriverSubscriptionDashboard, DriverSubscriptionRejection>> {
  const session = openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  const read = await deps.store.readDashboard({ telegramUserId: session.value });
  if (!read.ok) return err(publicCodeFrom(read.error));
  return ok(read.value);
}

export async function readDriverSubscriptionHistory(
  deps: DriverSubscriptionDeps,
  input: { readonly accessToken: string | undefined; readonly limit: unknown },
): Promise<Result<DriverSubscriptionHistory, DriverSubscriptionRejection>> {
  const session = openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  const read = await deps.store.readHistory({
    telegramUserId: session.value,
    limit: readHistoryLimit(input.limit),
  });
  if (!read.ok) return err(publicCodeFrom(read.error));
  return ok(read.value);
}

/**
 * يبدأُ تجديدَ الاشتراكِ: يقرأُ السائقَ من الجلسةِ، يتحقّقُ من الخطةِ، ثمَّ
 * يُعيدُ استخدامَ `subscribePlan` بمعرِّفِ السائقِ ومدينتِه وسعرٍ مُقاسٍ من
 * `platform_settings`. والمعرِّفُ الذي يُفعِّلُ الويبهوكَ هو معرِّفُ المعاملةِ
 * الذي يُنشِئُه `subscribePlan`، لا معرِّفُ اشتراكٍ — فالتأكيدُ حقُّ الويبهوكِ.
 */
export async function renewDriverSubscription(
  deps: DriverSubscriptionRenewalDeps,
  input: { readonly accessToken: string | undefined; readonly plan: unknown },
): Promise<Result<DriverSubscriptionRenewal, DriverSubscriptionRejection>> {
  const session = openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  const plan = parsePlan(input.plan);
  if (plan === null) return err(rejection("PLAN_INVALID"));

  const driverResult = await deps.drivers.findByTelegramId(session.value);
  if (!driverResult.ok) return err(rejection("NOT_A_DRIVER"));
  const driver = driverResult.value;
  if (driver === null) return err(rejection("NOT_A_DRIVER"));

  const day = deps.now().toISOString().slice(0, 10);
  const idempotencyKey = `driver_subscription:${driver.id}:${plan}:${day}`;

  const outcome = await subscribePlan(
    {
      driverId: driver.id as DriverId,
      cityId: driver.cityId as CityId,
      plan,
      idempotencyKey,
    },
    {
      payments: deps.payments,
      provider: deps.provider,
      priceReader: deps.priceReader,
    },
  );
  if (!outcome.ok) {
    return err(rejection("RENEWAL_FAILED"));
  }

  const price = await deps.priceReader(driver.cityId as CityId, plan);
  const amountMinor = price.ok ? price.value.amount : 0;
  const currency = price.ok ? price.value.currency : "SAR";

  return ok({
    transactionId: outcome.value.transactionId,
    checkoutUrl: outcome.value.checkoutUrl,
    status: outcome.value.status,
    plan,
    amountMinor,
    currency,
  });
}
