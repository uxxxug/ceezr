/**
 * الغرض: شاشةُ اشتراكِ السائقِ — خطّتُه وسعرُه وتجربتُه وتحذيرُه وتاريخُ دفعاتِه،
 *   وكلُّ سعرٍ من القاعدةِ لا من ثابتٍ (البند `F3-06` · `SD-07`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-06`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/subscription
 * يُستخدم من: `DriverRoot.tsx`
 * يُتوقع أن يستخدمه لاحقاً: `F3-09` — زرُّ التجديدِ يُضافُ، ولا يُوضَعُ هنا
 *   الآنَ لأنَّ مسارَ الدفعِ غيرُ مبنيٍّ بعدُ.
 * يحرسُه: scripts/check-driver-subscription-contract.ts ·
 *   scripts/check-tax-invoice-contract.ts
 * الحاكم: docs/adr/0094-project-independence.md ·
 *   docs/adr/0127-simplified-tax-invoice.md
 *
 * ## تصحيحٌ مُضافٌ (`F3-09` · 2026-09-16 · `ح-8`)
 *
 * مُكتوبٌ في ترويسةِ هذا المِلفِّ أنَّ زرَّ التجديدِ «لا يُوضَعُ هنا الآنَ» — **وقد
 * وُضِعَ فعلاً** في `F3-06` نفسِها؛ والسَّطرُ يُترَكُ كما هوَ مُتجاوَزاً لا يُمحى.
 * وما أُضيفَ في `F3-09` هوَ **مَسلكُ فتحِ الرابطِ**: كانَت صفحةُ الدفعِ تُفتَحُ
 * بـ`<a target="_blank">`، وهوَ في وِعاءِ تلغرامَ **لا يفعلُ شيئاً في أحيانٍ ولا يقولُ**
 * — فيرى السائقُ «بوّابةُ الدفعِ فُتِحَت» ولا تُفتَحُ. ومسارُ الملاحةِ في
 * `JobScreen` كانَ يمرُّ بالمَسلكِ المُقنَّنِ من قبلُ، **فكانَ المالُ وحدَه هوَ
 * الخارجَ عنِ السَّابقةِ**.
 *
 * ## لِمَ السعرُ يُعرَضُ من الجوابِ لا من ثابتٍ
 *
 * لأنَّ السعرَ من `platform_settings`، ونسخُه ثابتاً ههنا يُنشِئُ مصدرَ حقيقةٍ
 * ثانياً يتخلَّفُ عن التفعيلِ. والخادمُ يُرسِلُ الأسعارَ في الجوابِ، فالشاشةُ
 * تُعرَضُها كما وصلَت.
 *
 * ## ولِمَ الأيّامُ الباقيةُ من الخادمِ لا من ساعةِ جهازٍ
 *
 * لأنَّ الساعةَ المحليّةَ قد تكونُ مغلوطةً، والسائقُ يرى «يومينِ» حينَ يكونُ
 * انتهى. فالخادمُ يحسبُ `days_left` والشاشةُ تُعرَضُه.
 *
 * ## وما لا تفعلُه هذه الشاشةُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تُخترِعُ سعراً**: كلُّ رقمٍ من الجوابِ.
 *   ــ **لا تُقارِنُ بسائقٍ آخرَ**: لا رُتبةَ ولا متوسّطَ.
 *   ــ **لا تُظهِرُ هويّةَ راكبٍ**: لا حقلَ ههنا ولا في التاريخِ.
 *   ــ **لا تُفعِّلُ اشتراكاً ولا تُلغي**: التجديدُ يبدأُ معاملةَ دفعٍ ولا يُفعِّلُها.
 *   ــ **لا مؤقّتَ ولا تحديثَ تلقائيَّ**: لوحٌ يُقرأُ بطلبٍ.
 */

import { useCallback, useEffect, useId, useState } from "react";
import { minorUnitsToMajorText } from "../../../../../../packages/domain/financial/minor-units.ts";
import {
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/index.ts";
import { EmptyState } from "../../../system/EmptyState.tsx";
import { openExternalLink } from "../../../tg/app.ts";
import type { TgOutcome } from "../../../tg/outcome.ts";
import {
  type ApiDriverSubscriptionDashboardResponse,
  type ApiDriverSubscriptionHistoryResponse,
  type ApiDriverSubscriptionRenewalResponse,
  readDriverSubscriptionDashboard,
  readDriverSubscriptionHistory,
  renewDriverSubscription,
} from "./subscription-api.ts";
import {
  isRetryableSubscriptionError,
  type SubscriptionDashboardModel,
  type SubscriptionHistoryModel,
  type SubscriptionRenewalModel,
  subscriptionErrorKey,
  toSubscriptionDashboard,
  toSubscriptionHistory,
  toSubscriptionRenewal,
} from "./subscription-view.ts";

/** سقفُ التاريخِ المطلوبُ — والمُنفَذُ يُقرأُ من الجوابِ. */
const HISTORY_LIMIT = 20;

export interface SubscriptionScreenProps {
  readonly language?: MiniAppLanguage;
  readonly onBack?: () => void;
  readonly readDashboard?: () => Promise<ApiDriverSubscriptionDashboardResponse>;
  readonly readHistory?: (limit: number) => Promise<ApiDriverSubscriptionHistoryResponse>;
  readonly renewSubscription?: (plan: string) => Promise<ApiDriverSubscriptionRenewalResponse>;
  /**
   * فتحُ رابطٍ خارجيٍّ — **المَسلكُ المُقنَّنُ وحدَه** (`ADR 0031` · `ARCH-014`).
   * يُحقَنُ في الاختبارِ ليُقاسَ مسارُ الإخفاقِ لا ليُتجاوَزَ.
   */
  readonly openLink?: (url: string) => TgOutcome<true>;
}

type RenewalState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly renewal: SubscriptionRenewalModel }
  | { readonly kind: "failed"; readonly code: string };

/**
 * حالُ فتحِ بوّابةِ الدفعِ. **`opened` لا يُعرَضُ نصّاً**: من فُتِحَت له رأى
 * الصفحةَ بعينِه، وقولُ «فُتِحَت» فوقَ ذلكَ حشوٌ. والإخفاقُ وحدَه يستحقُّ نصّاً
 * لأنَّه **غيرُ مرئيٍّ بغيرِه**.
 */
type CheckoutState =
  | { readonly kind: "idle" }
  | { readonly kind: "opened" }
  | { readonly kind: "failed"; readonly url: string };

type DashboardState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly dashboard: SubscriptionDashboardModel }
  | { readonly kind: "failed"; readonly code: string };

type HistoryState =
  | { readonly kind: "closed" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly history: SubscriptionHistoryModel }
  | { readonly kind: "failed"; readonly code: string };

function codeOf(thrown: unknown): string {
  if (thrown !== null && typeof thrown === "object" && "code" in thrown) {
    const code = (thrown as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

export function SubscriptionScreen({
  language = MINIAPP_DEFAULT_LANGUAGE,
  onBack,
  readDashboard = readDriverSubscriptionDashboard,
  readHistory = readDriverSubscriptionHistory,
  renewSubscription = renewDriverSubscription,
  openLink = (url: string) => openExternalLink(url),
}: SubscriptionScreenProps) {
  const t = miniAppTranslator(language);
  const formId = useId();
  const [dashboard, setDashboard] = useState<DashboardState>({ kind: "loading" });
  const [history, setHistory] = useState<HistoryState>({ kind: "closed" });
  const [renewal, setRenewal] = useState<RenewalState>({ kind: "idle" });
  const [selectedPlan, setSelectedPlan] = useState<string>("transport");
  const [checkout, setCheckout] = useState<CheckoutState>({ kind: "idle" });

  const load = useCallback(async () => {
    setDashboard({ kind: "loading" });
    setHistory({ kind: "closed" });
    try {
      setDashboard({
        kind: "ready",
        dashboard: toSubscriptionDashboard(await readDashboard()),
      });
    } catch (thrown) {
      setDashboard({ kind: "failed", code: codeOf(thrown) });
    }
  }, [readDashboard]);

  useEffect(() => {
    void load();
  }, [load]);

  const openHistory = useCallback(async () => {
    setHistory({ kind: "loading" });
    try {
      setHistory({
        kind: "ready",
        history: toSubscriptionHistory(await readHistory(HISTORY_LIMIT)),
      });
    } catch (thrown) {
      setHistory({ kind: "failed", code: codeOf(thrown) });
    }
  }, [readHistory]);

  const renew = useCallback(
    async (plan: string) => {
      setRenewal({ kind: "loading" });
      try {
        const renewal = toSubscriptionRenewal(await renewSubscription(plan));
        setRenewal({ kind: "ready", renewal });
      } catch (thrown) {
        setRenewal({ kind: "failed", code: codeOf(thrown) });
      }
    },
    [renewSubscription],
  );

  if (dashboard.kind === "loading") {
    return (
      <section className="dsub" aria-labelledby={`${formId}-title`} aria-busy="true">
        <h1 id={`${formId}-title`} className="dsub__title">
          {t("driver.subscription.title")}
        </h1>
        <p className="dsub__loading">{t("driver.subscription.loading")}</p>
      </section>
    );
  }

  if (dashboard.kind === "failed") {
    return (
      <section className="dsub" aria-labelledby={`${formId}-title`}>
        <h1 id={`${formId}-title`} className="dsub__title">
          {t("driver.subscription.title")}
        </h1>
        <EmptyState
          title={t("driver.subscription.failed")}
          body={t(subscriptionErrorKey(dashboard.code))}
        />
        {isRetryableSubscriptionError(dashboard.code) ? (
          <button type="button" className="dsub__retry" onClick={() => void load()}>
            {t("driver.subscription.retry")}
          </button>
        ) : null}
        {onBack === undefined ? null : (
          <button type="button" className="dsub__back" onClick={onBack}>
            {t("driver.subscription.backToBoard")}
          </button>
        )}
      </section>
    );
  }

  const board = dashboard.dashboard;

  return (
    <section className="dsub" aria-labelledby={`${formId}-title`}>
      <h1 id={`${formId}-title`} className="dsub__title">
        {t("driver.subscription.title")}
      </h1>

      {board.hasSubscription ? (
        <>
          {/* الحالُ والخطةُ */}
          <div className="dsub__status">
            <p className="dsub__plan">
              <span className="dsub__plan-label">{t("driver.subscription.plan.label")}</span>
              <span className="dsub__plan-value">
                {board.planLabelKey === null
                  ? t("driver.subscription.unknown")
                  : t(board.planLabelKey)}
              </span>
            </p>
            <p className="dsub__status-line">
              <span className="dsub__status-label">{t("driver.subscription.status.label")}</span>
              <span className="dsub__status-value">
                {board.statusLabelKey === null
                  ? t("driver.subscription.unknown")
                  : t(board.statusLabelKey)}
              </span>
            </p>
            {board.isTrial === true ? (
              <p className="dsub__trial-badge">{t("driver.subscription.trial.active")}</p>
            ) : null}
          </div>

          {/* السعرُ من القاعدةِ */}
          {board.price !== null ? (
            <p className="dsub__price">
              <span className="dsub__price-label">{t("driver.subscription.price.label")}</span>
              <span className="dsub__price-value">
                {t("driver.subscription.price.value")
                  .replace("{amount}", String(board.price))
                  .replace("{currency}", board.currency)}
              </span>
            </p>
          ) : null}

          {/* تاريخُ الانتهاءِ والأيّامُ الباقيةُ */}
          {board.endsAt !== null ? (
            <p className="dsub__ends">
              <span className="dsub__ends-label">{t("driver.subscription.ends.label")}</span>
              <span className="dsub__ends-value">{board.endsAt}</span>
            </p>
          ) : null}
          {board.daysLeft !== null ? (
            <p className="dsub__days-left">
              {board.daysLeftLabelKey === null
                ? null
                : t(board.daysLeftLabelKey).replace("{days}", String(board.daysLeft))}
            </p>
          ) : null}

          {/* التحذيرُ قبلَ الانتهاءِ */}
          {board.expiresSoon === true ? (
            <p className="dsub__warning" role="status">
              {t("driver.subscription.warning.expiring").replace(
                "{days}",
                String(board.warningDays ?? 0),
              )}
            </p>
          ) : null}

          {/* طلبُ الإلغاءِ */}
          {board.cancelAtPeriodEnd === true ? (
            <p className="dsub__cancellation">
              {t("driver.subscription.cancellation.requested").replace(
                "{date}",
                board.cancellationRequestedAt ?? "",
              )}
            </p>
          ) : null}

          {/* التجربةُ */}
          {board.isTrial === true && board.trialEndsAt !== null ? (
            <p className="dsub__trial-ends">
              {t("driver.subscription.trial.ends").replace("{date}", board.trialEndsAt)}
            </p>
          ) : null}
        </>
      ) : (
        <>
          {/* سائقٌ بلا اشتراكٍ: يُعرَضُ الأسعارُ ليختارَ */}
          <p className="dsub__no-subscription">{t("driver.subscription.noSubscription")}</p>
          <ul className="dsub__plan-prices">
            {board.planPrices.map((plan) => (
              <li key={plan.key} className="dsub__plan-price">
                <span className="dsub__plan-price-label">{t(plan.labelKey)}</span>
                <span className="dsub__plan-price-value">
                  {t("driver.subscription.price.value")
                    .replace("{amount}", String(plan.price))
                    .replace("{currency}", plan.currency)}
                </span>
              </li>
            ))}
          </ul>
          <p className="dsub__trial-info">
            {t("driver.subscription.trial.info").replace("{days}", String(board.trialDays))}
          </p>

          {/* تجديدُ الاشتراكِ */}
          <div className="dsub__renew">
            <label className="dsub__renew-label" htmlFor={`${formId}-plan`}>
              {t("driver.subscription.renew.choose_plan")}
            </label>
            <select
              id={`${formId}-plan`}
              className="dsub__renew-select"
              value={selectedPlan}
              onChange={(e) => setSelectedPlan(e.target.value)}
            >
              {board.planPrices.map((plan) => (
                <option key={plan.key} value={plan.key}>
                  {t(plan.labelKey)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="dsub__renew-cta"
              onClick={() => void renew(selectedPlan)}
              disabled={renewal.kind === "loading"}
            >
              {renewal.kind === "loading"
                ? t("driver.subscription.renew.loading")
                : t("driver.subscription.renew.cta")}
            </button>
            {renewal.kind === "ready" ? (
              <p className="dsub__renew-success" role="status">
                {t("driver.subscription.renew.success")}
                {renewal.renewal.checkoutUrl !== null ? (
                  <button
                    type="button"
                    className="dsub__checkout-open"
                    onClick={() => {
                      const url = renewal.renewal.checkoutUrl;
                      if (url === null) return;
                      const outcome = openLink(url);
                      // **الإخفاقُ يُقالُ ويُعطى مخرجاً**: رابطٌ لا يُفتَحُ في
                      // وِعاءٍ قديمٍ يبقى ممكنَ النقلِ بيدٍ — فالمالُ لا يُترَكُ لزرٍّ صامتٍ.
                      setCheckout(outcome.ok ? { kind: "opened" } : { kind: "failed", url });
                    }}
                  >
                    {t("driver.subscription.renew.checkout_open")}
                  </button>
                ) : null}
              </p>
            ) : null}
            {checkout.kind === "failed" ? (
              <p className="dsub__checkout-fallback" role="status">
                {t("driver.subscription.renew.checkout_failed")}
                <span className="dsub__checkout-url">{checkout.url}</span>
              </p>
            ) : null}
            {renewal.kind === "failed" ? (
              <p className="dsub__renew-error" role="status">
                {t(subscriptionErrorKey(renewal.code))}
              </p>
            ) : null}
          </div>
        </>
      )}

      {/* تاريخُ الدفعاتِ */}
      <h2 className="dsub__section">{t("driver.subscription.history.title")}</h2>
      {history.kind === "closed" ? (
        <button type="button" className="dsub__open-history" onClick={() => void openHistory()}>
          {t("driver.subscription.history.open")}
        </button>
      ) : null}
      {history.kind === "loading" ? (
        <p className="dsub__loading">{t("driver.subscription.loading")}</p>
      ) : null}
      {history.kind === "failed" ? (
        <>
          <p className="dsub__error" role="status">
            {t(subscriptionErrorKey(history.code))}
          </p>
          <button type="button" className="dsub__open-history" onClick={() => void openHistory()}>
            {t("driver.subscription.retry")}
          </button>
        </>
      ) : null}
      {history.kind === "ready" ? (
        history.history.entries.length === 0 ? (
          <EmptyState
            title={t("driver.subscription.history.empty.title")}
            body={t("driver.subscription.history.empty.body")}
          />
        ) : (
          <ul className="dsub__payments">
            {history.history.entries.map((entry) => (
              <li key={entry.transactionId} className="dsub__payment">
                <span className="dsub__payment-status">{t(entry.statusLabelKey)}</span>
                <span className="dsub__payment-amount">
                  {t("driver.subscription.price.value")
                    .replace("{amount}", minorUnitsToMajorText(entry.amountMinor))
                    .replace("{currency}", entry.currency)}
                </span>
                <span className="dsub__payment-provider">{entry.provider}</span>
                <span className="dsub__payment-date">{entry.createdAt}</span>
                {entry.planLabelKey === null ? null : (
                  <span className="dsub__payment-plan">{t(entry.planLabelKey)}</span>
                )}
              </li>
            ))}
          </ul>
        )
      ) : null}

      <button type="button" className="dsub__retry" onClick={() => void load()}>
        {t("driver.subscription.refresh")}
      </button>
      {onBack === undefined ? null : (
        <button type="button" className="dsub__back" onClick={onBack}>
          {t("driver.subscription.backToBoard")}
        </button>
      )}
    </section>
  );
}
