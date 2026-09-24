/**
 * الغرض: لوحُ دفعةٍ واحدةٍ — حالُها، وإصدارُ فاتورتِها الضريبيّةِ المبسَّطةِ،
 *   وعرضُها بحقولِها الواجبةِ وحِمْلِ رمزِ استجابتِها (البند `F3-09` · `SD-08`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-09`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/subscription
 * يُستخدم من: `SubscriptionScreen.tsx` — بعدَ التجديدِ، ولكلِّ دفعةٍ في التاريخِ.
 * يُتوقع أن يستخدمه لاحقاً: لوحُ محفظةٍ إن صارَ لعمولةٍ فاتورةٌ — **ولا يُوسَّعُ
 *   هذا اللوحُ ليخدمَ سطحَينِ**، إذ لوحٌ يخدمُ اثنَينِ يُخفي شرطَ أحدِهما.
 * يحرسُه: scripts/check-tax-invoice-contract.ts ·
 *   scripts/check-telegram-wrapper-isolation.ts
 * الحاكم: docs/adr/0127-simplified-tax-invoice.md · docs/adr/0031-telegram-wrapper.md
 *
 * ## لِمَ الإصدارُ **بزرٍّ** لا تلقائيّاً عندَ ظهورِ «مدفوعةٌ»
 *
 * لأنَّ الإصدارَ **كتابةٌ لا رجعةَ فيها**: الفاتورةُ ثابتةٌ بزنادٍ في القاعدةِ،
 * فمتى صدرَت لا تُصحَّحُ ولا تُمحى. وفعلٌ كهذا لا يُشَنُّ من أثرٍ جانبيٍّ لعرضٍ.
 * والقاعدةُ تحميه بمفتاحٍ فريدٍ فلا يُصدَرُ رقمانِ لدفعةٍ، **وذاكَ الأمانُ لا
 * يُبرِّرُ فعلاً لم يطلبْه أحدٌ**.
 *
 * ## ولِمَ **لا دُوّارَ استقصاءٍ** لحالِ الدفعةِ
 *
 * لأنَّ الحالَ يتغيَّرُ بويبهوكِ المزوِّدِ، وسؤالُنا لا يُعجِّلُه. والدُّوّارُ
 * يُوحي بأنَّ التطبيقَ يُفعِّلُ الاشتراكَ — وهوَ لا يفعلُ، والتفعيلُ حقُّ الويبهوكِ.
 *
 * ## ولِمَ يُعرَضُ حِمْلُ رمزِ الاستجابةِ **نصّاً**
 *
 * لأنَّ **الحِمْلَ هوَ الوثيقةُ**، ورسمُه صورةً يقتضي مُرمِّزاً ثانياً في العميلِ
 * يُمكِنُ أن يُخالِفَ ما خزنَتْهُ القاعدةُ بلا أن يُقاسَ. فالنصُّ يُعرَضُ صريحاً
 * قابلاً للنسخِ، **ولا يُوعَدُ بصورةٍ لم تُبنَ** (`ح-5`). ورسمُ الصورةِ فوقَ هذا
 * النصِّ عملٌ لاحقٌ مُعلَنٌ لا نقصٌ مُخفىً.
 *
 * ## وما لا يفعلُه هذا اللوحُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يُفعِّلُ اشتراكاً**: لا ههنا ولا في نداءٍ من نداءاتِه.
 *   ــ **لا يحسبُ ضريبةً**: كلُّ رقمٍ من الوثيقةِ، ونسبتُها منها لا من إعدادٍ.
 *   ــ **لا يُعيدُ نداءَ الإصدارِ تلقائيّاً**: كاتبٌ لا يُعادُ بلا إنسانٍ.
 *   ــ **لا يفتحُ رابطاً بـ`<a target>`**: المَسلكُ المُقنَّنُ وحدَه (`ARCH-014`).
 *   ــ **لا يُخزِّنُ الوثيقةَ في الجهازِ**: تُقرأُ حينَ تُطلَبُ.
 *   ــ **لا يقولُ «أُرسِلَت بالبريدِ»**: لا مُرسِلَ بريدٍ في هذا المسارِ.
 */

import { useCallback, useId, useState } from "react";
import {
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/core.ts";
import { openExternalLink, type TgOutcome } from "../../../tg/index.ts";
import {
  type ApiDriverInvoiceIssueResponse,
  type ApiDriverInvoiceReadResponse,
  type ApiDriverPaymentStatusResponse,
  issueDriverTaxInvoice,
  readDriverPaymentStatus,
  readDriverTaxInvoice,
} from "./invoice-api.ts";
import {
  type InvoiceIssueModel,
  invoiceErrorKey,
  isRetryableInvoiceError,
  isStatusRecheckError,
  type PaymentStatusModel,
  type TaxInvoiceModel,
  toInvoiceIssue,
  toInvoiceRead,
  toPaymentStatus,
} from "./invoice-view.ts";

export interface PaymentInvoicePanelProps {
  readonly transactionId: string;
  readonly language?: MiniAppLanguage;
  readonly readStatus?: (transactionId: string) => Promise<ApiDriverPaymentStatusResponse>;
  readonly issueInvoice?: (transactionId: string) => Promise<ApiDriverInvoiceIssueResponse>;
  readonly readInvoice?: (transactionId: string) => Promise<ApiDriverInvoiceReadResponse>;
  /** فتحُ رابطٍ خارجيٍّ — **المَسلكُ المُقنَّنُ وحدَه** (`ADR 0031` · `ARCH-014`). */
  readonly openLink?: (url: string) => TgOutcome<true>;
}

/**
 * حالُ اللوحِ — **اتّحادٌ مُوسومٌ** لا رايةٌ منفصلةٌ لكلِّ شيءٍ: رايةٌ لِتحميلٍ
 * ورايةٌ لِعطبٍ ورايةٌ لِوثيقةٍ تُنتِجُ حالاتٍ مستحيلةً («يُحمِّلُ ومعطوبٌ ومعروضٌ»)،
 * والاتّحادُ يجعلُ المستحيلَ **غيرَ قابلٍ للتمثيلِ**.
 */
type PanelState =
  | { readonly kind: "idle" }
  | { readonly kind: "status_loading" }
  | { readonly kind: "status_ready"; readonly status: PaymentStatusModel }
  | { readonly kind: "status_failed"; readonly code: string }
  | { readonly kind: "issuing"; readonly status: PaymentStatusModel }
  | {
      readonly kind: "invoice";
      readonly invoice: TaxInvoiceModel;
      /** `null` في القراءةِ المحضةِ — **لا يُقالُ «صدرَت الآنَ» لِوثيقةٍ قُرِئَت**. */
      readonly alreadyIssued: boolean | null;
    }
  | { readonly kind: "invoice_failed"; readonly code: string };

/** حالُ فتحِ بوّابةِ الدفعِ — و`opened` لا نصَّ له: من فُتِحَت له رآها بعينِه. */
type CheckoutState = { readonly kind: "idle" } | { readonly kind: "failed"; readonly url: string };

function codeOf(thrown: unknown): string {
  if (thrown !== null && typeof thrown === "object" && "code" in thrown) {
    const code = (thrown as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

export function PaymentInvoicePanel({
  transactionId,
  language = MINIAPP_DEFAULT_LANGUAGE,
  readStatus = readDriverPaymentStatus,
  issueInvoice = issueDriverTaxInvoice,
  readInvoice = readDriverTaxInvoice,
  openLink = (url: string) => openExternalLink(url),
}: PaymentInvoicePanelProps) {
  const t = miniAppTranslator(language);
  const panelId = useId();
  const [state, setState] = useState<PanelState>({ kind: "idle" });
  const [checkout, setCheckout] = useState<CheckoutState>({ kind: "idle" });

  const loadStatus = useCallback(async () => {
    setState({ kind: "status_loading" });
    try {
      setState({ kind: "status_ready", status: toPaymentStatus(await readStatus(transactionId)) });
    } catch (thrown) {
      setState({ kind: "status_failed", code: codeOf(thrown) });
    }
  }, [readStatus, transactionId]);

  const issue = useCallback(
    async (status: PaymentStatusModel) => {
      setState({ kind: "issuing", status });
      try {
        const issued: InvoiceIssueModel = toInvoiceIssue(await issueInvoice(transactionId));
        setState({ kind: "invoice", invoice: issued.invoice, alreadyIssued: issued.alreadyIssued });
      } catch (thrown) {
        setState({ kind: "invoice_failed", code: codeOf(thrown) });
      }
    },
    [issueInvoice, transactionId],
  );

  const showInvoice = useCallback(async () => {
    setState({ kind: "status_loading" });
    try {
      setState({
        kind: "invoice",
        invoice: toInvoiceRead(await readInvoice(transactionId)),
        alreadyIssued: null,
      });
    } catch (thrown) {
      setState({ kind: "invoice_failed", code: codeOf(thrown) });
    }
  }, [readInvoice, transactionId]);

  return (
    <section className="dinv" aria-labelledby={`${panelId}-title`}>
      <h3 id={`${panelId}-title`} className="dinv__title">
        {t("driver.subscription.invoice.title")}
      </h3>

      {state.kind === "idle" ? (
        <button type="button" className="dinv__check" onClick={() => void loadStatus()}>
          {t("driver.subscription.invoice.check_status")}
        </button>
      ) : null}

      {state.kind === "status_loading" ? (
        <p className="dinv__loading" aria-busy="true">
          {t("driver.subscription.invoice.checking")}
        </p>
      ) : null}

      {state.kind === "status_failed" ? (
        <>
          <p className="dinv__error" role="status">
            {t(invoiceErrorKey(state.code))}
          </p>
          {isRetryableInvoiceError(state.code) || isStatusRecheckError(state.code) ? (
            <button type="button" className="dinv__check" onClick={() => void loadStatus()}>
              {t("driver.subscription.invoice.recheck")}
            </button>
          ) : null}
        </>
      ) : null}

      {state.kind === "status_ready" || state.kind === "issuing" ? (
        <>
          <p className="dinv__status">
            <span className="dinv__status-label">
              {t("driver.subscription.invoice.status.label")}
            </span>
            <span className="dinv__status-value">{t(state.status.statusLabelKey)}</span>
          </p>
          <p className="dinv__amount">
            <span className="dinv__amount-label">
              {t("driver.subscription.invoice.amount.label")}
            </span>
            <span className="dinv__amount-value">
              {t("driver.subscription.price.value")
                .replace("{amount}", state.status.amountText)
                .replace("{currency}", state.status.currency)}
            </span>
          </p>

          {state.status.canIssueInvoice ? (
            <button
              type="button"
              className="dinv__issue"
              disabled={state.kind === "issuing"}
              onClick={() => void issue(state.status)}
            >
              {state.kind === "issuing"
                ? t("driver.subscription.invoice.issuing")
                : t("driver.subscription.invoice.issue_cta")}
            </button>
          ) : null}

          {state.status.invoiceIssued ? (
            <button type="button" className="dinv__show" onClick={() => void showInvoice()}>
              {t("driver.subscription.invoice.show_cta")}
            </button>
          ) : null}

          {/* غيرُ مدفوعةٍ: **يُقالُ السببُ ويُعطى مخرجٌ** لا زرُّ إصدارٍ لا يعملُ. */}
          {!state.status.canIssueInvoice && !state.status.invoiceIssued ? (
            <>
              <p className="dinv__not-payable" role="status">
                {t("driver.subscription.invoice.not_payable")}
              </p>
              {state.status.checkoutUrl === null ? null : (
                <button
                  type="button"
                  className="dinv__checkout-open"
                  onClick={() => {
                    const url = state.status.checkoutUrl;
                    if (url === null) return;
                    const outcome = openLink(url);
                    setCheckout(outcome.ok ? { kind: "idle" } : { kind: "failed", url });
                  }}
                >
                  {t("driver.subscription.invoice.checkout_reopen")}
                </button>
              )}
              <button type="button" className="dinv__check" onClick={() => void loadStatus()}>
                {t("driver.subscription.invoice.recheck")}
              </button>
            </>
          ) : null}

          {checkout.kind === "failed" ? (
            <p className="dinv__checkout-fallback" role="status">
              {t("driver.subscription.invoice.checkout_failed")}
              <span className="dinv__checkout-url">{checkout.url}</span>
            </p>
          ) : null}
        </>
      ) : null}

      {state.kind === "invoice_failed" ? (
        <>
          <p className="dinv__error" role="status">
            {t(invoiceErrorKey(state.code))}
          </p>
          {/* عطبُ إصدارٍ **لا يُعادُ بزرِّ إصدارٍ** بل بقراءةِ حالٍ: الكاتبُ لا يُكرَّرُ بلا علمٍ. */}
          <button type="button" className="dinv__check" onClick={() => void loadStatus()}>
            {t("driver.subscription.invoice.recheck")}
          </button>
        </>
      ) : null}

      {state.kind === "invoice" ? (
        <dl className="dinv__doc">
          {state.alreadyIssued === true ? (
            <p className="dinv__already" role="status">
              {t("driver.subscription.invoice.already_issued")}
            </p>
          ) : null}

          <dt className="dinv__k">{t("driver.subscription.invoice.number.label")}</dt>
          <dd className="dinv__v">{state.invoice.invoiceNumber}</dd>

          <dt className="dinv__k">{t("driver.subscription.invoice.document_type.label")}</dt>
          <dd className="dinv__v">{t(state.invoice.documentTypeLabelKey)}</dd>

          <dt className="dinv__k">{t("driver.subscription.invoice.issued_at.label")}</dt>
          <dd className="dinv__v">{state.invoice.issuedAt}</dd>

          <dt className="dinv__k">{t("driver.subscription.invoice.seller.label")}</dt>
          <dd className="dinv__v">{state.invoice.sellerName}</dd>

          <dt className="dinv__k">{t("driver.subscription.invoice.seller_vat.label")}</dt>
          <dd className="dinv__v">{state.invoice.sellerVatNumber}</dd>

          <dt className="dinv__k">{t("driver.subscription.invoice.vat_rate.label")}</dt>
          <dd className="dinv__v">
            {t("driver.subscription.invoice.vat_rate.value").replace(
              "{percent}",
              state.invoice.vatRatePercentText,
            )}
          </dd>

          <dt className="dinv__k">{t("driver.subscription.invoice.total_excl.label")}</dt>
          <dd className="dinv__v">
            {t("driver.subscription.price.value")
              .replace("{amount}", state.invoice.totalExclVatText)
              .replace("{currency}", state.invoice.currency)}
          </dd>

          <dt className="dinv__k">{t("driver.subscription.invoice.vat_amount.label")}</dt>
          <dd className="dinv__v">
            {t("driver.subscription.price.value")
              .replace("{amount}", state.invoice.vatAmountText)
              .replace("{currency}", state.invoice.currency)}
          </dd>

          <dt className="dinv__k">{t("driver.subscription.invoice.total_incl.label")}</dt>
          <dd className="dinv__v dinv__v--total">
            {t("driver.subscription.price.value")
              .replace("{amount}", state.invoice.totalInclVatText)
              .replace("{currency}", state.invoice.currency)}
          </dd>

          <dt className="dinv__k">{t("driver.subscription.invoice.qr.label")}</dt>
          <dd className="dinv__v dinv__v--qr">
            <code className="dinv__qr">{state.invoice.qrTlvBase64}</code>
            <span className="dinv__qr-hint">{t("driver.subscription.invoice.qr.hint")}</span>
          </dd>
        </dl>
      ) : null}
    </section>
  );
}
