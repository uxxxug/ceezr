/**
 * الغرض: نموذجُ قراءةٍ يَجمعُ في بطاقةٍ واحدةٍ كلَّ ما يَعرفُهُ السائقُ عن وضعِهِ
 *   الماليّ: الاشتراكَ، رصيدَ المحفظةِ، سياسةَ العمولةِ، الاعتراضَ الماليَّ القائمَ،
 *   وأهلّيّةَ الاستردادِ. لا منطقَ كتابةٍ هنا — القراءةُ وحدَها تُجمعُ من المنافذِ
 *   القائمةِ، والكتابةُ في مساراتِها الأصليّةِ.
 * الحالة: يُنفَّذُ ضمنَ PD-041 — مسارٌ ماليٌّ واحدٌ للسائق.
 * ينتمي إلى: application/financial
 * ملاحظات مستقبلية: لا يُضافُ حسابُ عمولاتٍ هنا — السياسةُ تُقرأُ من الإعداداتِ.
 */

import type { CitySettings } from "../../domain/policy/entity.ts";
import type { Subscription } from "../../domain/subscription/entity.ts";
import type { CityId, DriverId } from "../../shared/kernel/index.ts";
import type { Result } from "../../shared/result/index.ts";
import { ok } from "../../shared/result/index.ts";
import type { WalletBalance } from "./ports.ts";

/** حالُ الاشتراكِ كما يُقرأُ للسطحِ الماليِّ. */
export interface FinanceSubscriptionView {
  readonly plan: string;
  readonly status: string;
  readonly currentPeriodEnd: string | null;
  readonly trialEndsAt: string | null;
  readonly cancelAtPeriodEnd: boolean;
}

/** سياسةُ الكسبِ كما يُقرأُ من إعداداتِ المدينةِ. */
export interface FinanceEarningsView {
  readonly currency: string;
  readonly subscriptionPriceTransport: number;
  readonly subscriptionPriceDelivery: number;
  readonly subscriptionPriceBoth: number;
}

/** الاعتراضُ الماليُّ القائمُ — تذكرةُ `deduction` مفتوحةٌ أو في انتظارٍ. */
export interface FinanceObjectionView {
  readonly reference: string;
  readonly status: string;
  readonly createdAt: string;
}

/** أهلّيّةُ الاستردادِ كما يُقرأُ من المحفظةِ. */
export interface FinanceRefundView {
  readonly eligible: boolean;
  readonly reason: string | null;
}

/** البطاقةُ الماليّةُ الكاملةُ — كلُّ ما يَعرفُهُ السائقُ عن وضعِهِ في موضعٍ واحد. */
export interface DriverFinanceOverview {
  readonly subscription: FinanceSubscriptionView | null;
  readonly earnings: FinanceEarningsView | null;
  readonly walletBalance: WalletBalance | null;
  readonly openObjections: readonly FinanceObjectionView[];
  readonly refund: FinanceRefundView | null;
}

/** منافذُ القراءةِ — كلُّها اختياريّةٌ: غيابُ المنفذِ يعني سكوتًا لا خطأً. */
export interface DriverFinanceOverviewDeps {
  readonly findLiveSubscription: (
    driverId: DriverId,
  ) => Promise<Result<Subscription | null, Error>>;
  readonly citySettings: (cityId: CityId) => Promise<Result<CitySettings | null, Error>>;
  readonly walletBalance?: (driverId: DriverId) => Promise<Result<WalletBalance | null, Error>>;
  readonly openObjections?: (
    driverId: DriverId,
  ) => Promise<Result<readonly FinanceObjectionView[], Error>>;
}

/**
 * يَجمعُ كلَّ البياناتِ الماليّةِ للسائقِ في بطاقةٍ واحدةٍ.
 * كلُّ منفذٍ اختياريٌّ: غيابُهُ يعني سكوتًا عن ذلك الجزءِ لا خطأً.
 * والخطأُ في أيِّ منفذٍ يُرجَعُ كفشلٍ صريحٍ — لا يُبتلَعُ صامتًا.
 */
export async function driverFinanceOverview(
  driverId: DriverId,
  cityId: CityId,
  deps: DriverFinanceOverviewDeps,
): Promise<Result<DriverFinanceOverview, Error>> {
  const [subscriptionResult, settingsResult] = await Promise.all([
    deps.findLiveSubscription(driverId),
    deps.citySettings(cityId),
  ]);

  if (!subscriptionResult.ok) return subscriptionResult;
  if (!settingsResult.ok) return settingsResult;

  const subscription = subscriptionResult.value;
  const settings = settingsResult.value;

  let walletBalance: WalletBalance | null = null;
  if (deps.walletBalance !== undefined) {
    const walletResult = await deps.walletBalance(driverId);
    if (!walletResult.ok) return walletResult;
    walletBalance = walletResult.value;
  }

  let openObjections: readonly FinanceObjectionView[] = [];
  if (deps.openObjections !== undefined) {
    const objectionsResult = await deps.openObjections(driverId);
    if (!objectionsResult.ok) return objectionsResult;
    openObjections = objectionsResult.value;
  }

  const refund: FinanceRefundView | null =
    walletBalance !== null && walletBalance.balanceMinor !== null
      ? {
          eligible: walletBalance.balanceMinor > 0,
          reason: walletBalance.balanceMinor > 0 ? null : "no_balance",
        }
      : null;

  return ok({
    subscription:
      subscription !== null
        ? {
            plan: subscription.plan,
            status: subscription.status,
            currentPeriodEnd:
              subscription.currentPeriodEnd !== null
                ? subscription.currentPeriodEnd.toISOString()
                : null,
            trialEndsAt:
              subscription.trialEndsAt !== null ? subscription.trialEndsAt.toISOString() : null,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          }
        : null,
    earnings:
      settings !== null
        ? {
            currency: settings.currency,
            subscriptionPriceTransport: settings.subscriptionPriceTransport,
            subscriptionPriceDelivery: settings.subscriptionPriceDelivery,
            subscriptionPriceBoth: settings.subscriptionPriceBoth,
          }
        : null,
    walletBalance,
    openObjections,
    refund,
  });
}
