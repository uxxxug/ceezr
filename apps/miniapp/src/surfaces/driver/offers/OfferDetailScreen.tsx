/**
 * الغرض: تفاصيلُ عرضٍ واحدٍ وقبولُه — **زرٌّ واحدٌ يكتبُ مرّةً واحدةً**
 *   بتفويضٍ إلى `claim_ride` الذرّيّةِ (البند `F3-02` · `SD-04`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-02`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/offers
 * يُستخدم من: `DriverRoot.tsx`
 * يُتوقع أن يستخدمه لاحقاً: `SD-05` — `order_id` من جوابِ القبولِ مِفصلُ الرحلةِ.
 * الحاكم: docs/adr/0117-a-countdown-is-a-server-fact-and-an-acceptance-has-one-writer.md
 *
 * ## لِمَ «سُبِقتَ إلى الطلبِ» **ليسَ عطلاً** في هذه الشاشةِ
 *
 * جولةُ العرضِ تُرسَلُ إلى عدّةِ سائقينَ معاً (ذاكَ عملُ `open_offer_round`)،
 * فالسبقُ **الحالُ الطبيعيّةُ** لا الاستثناءُ. والقاعدةُ تردُّ
 * `ORDER_NOT_CLAIMABLE` من قيدٍ ذرّيٍّ في `claim_ride`، ويُقالُ ههنا نصّاً هادئاً
 * معَ طريقٍ إلى اللوحِ — لا «حدثَ خطأٌ» يُوهِمُ السائقَ أنَّ التطبيقَ عطبَ.
 *
 * ## ولِمَ لا زرَّ «إعادةِ المحاولةِ» على القبولِ
 *
 * لأنَّ القبولَ **يكتبُ**: إعادتُه بعدَ انقطاعِ شبكةٍ قد تكونُ إعادةً لفعلٍ نجحَ
 * ولم يصلْ جوابُه. والصوابُ العودةُ إلى اللوحِ فقراءةُ الحالِ من القاعدةِ: إن
 * ظفرَ فسيرى طلبَه مُوكَلاً إليهِ، وإن لا فسيرى العرضَ باقياً أو ذاهباً.
 *
 * ## وما لا تفعلُه هذه الشاشةُ عن قصدٍ — وحدودُها مُعلَنةٌ (`ح-5`)
 *
 *   ــ **لا تُظهِرُ راكباً**: لا اسمَ ولا هاتفَ ولا لغةَ — وجوابُ القبولِ نفسُه
 *      لا يحملُها، فقناةُ الاتّصالِ بعدَ الإيكالِ بندٌ آخرُ.
 *   ــ **لا خريطةَ**: إحداثيّتانِ تُعرَضانِ رقمَينِ، والخريطةُ **دَينٌ مُعلَنٌ**.
 *   ــ **لا مدّةَ وصولٍ ولا تقديرَ زمنٍ من مسافةٍ**: `ADR 0024` يمنعُها بقياسٍ.
 *   ــ **لا إلغاءَ بعدَ القبولِ**: الإلغاءُ بندٌ لهُ حكمُه، ولا يُشتَقُّ ههنا.
 */

import { useCallback, useEffect, useId, useState } from "react";
import {
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/index.ts";
import { EmptyState } from "../../../system/EmptyState.tsx";
import {
  type AcceptDriverOfferResponse,
  acceptDriverOffer,
  type DriverOfferDetailResponse,
  readDriverOfferDetail,
  rejectDriverOffer,
} from "./offers-api.ts";
import {
  type CountdownTone,
  canAcceptNow,
  countdownLabel,
  countdownSeconds,
  countdownTone,
  type DistanceLine,
  isRetryableOffersError,
  offersErrorKey,
  toOfferDetail,
} from "./offers-view.ts";

export interface OfferDetailScreenProps {
  readonly offerId: string;
  readonly language?: MiniAppLanguage;
  readonly onBack?: () => void;
  readonly onAccepted?: (orderId: string) => void;
  readonly readDetail?: (offerId: string) => Promise<DriverOfferDetailResponse>;
  readonly accept?: (offerId: string) => Promise<AcceptDriverOfferResponse>;
  readonly reject?: (offerId: string) => Promise<unknown>;
  readonly now?: () => number;
}

const COUNTDOWN_BADGE: Record<CountdownTone, { readonly modifier: string }> = {
  calm: { modifier: "dof__timer--calm" },
  urgent: { modifier: "dof__timer--urgent" },
  elapsed: { modifier: "dof__timer--elapsed" },
};

type DetailState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly detail: DriverOfferDetailResponse;
      readonly readAtMs: number;
    }
  | { readonly kind: "failed"; readonly code: string };

type ClaimState =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "won"; readonly orderId: string }
  | { readonly kind: "lost"; readonly key: string }
  | { readonly kind: "failed"; readonly key: string };

function codeOf(thrown: unknown): string {
  if (thrown !== null && typeof thrown === "object" && "code" in thrown) {
    const code = (thrown as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

/** رفضُ القاعدةِ ينقسمُ قسمَينِ: **سبقٌ متوقَّعٌ** وعطلٌ يُقالُ عطلاً. */
const EXPECTED_REFUSALS: ReadonlySet<string> = new Set([
  "OFFER_TAKEN",
  "OFFER_EXPIRED",
  "OFFER_ALREADY_ANSWERED",
  "OFFER_NOT_FOUND",
  "CITY_MISMATCH",
]);

function DistanceRow({
  line,
  labelKey,
  t,
}: {
  readonly line: DistanceLine | null;
  readonly labelKey: string;
  readonly t: (key: string) => string;
}) {
  if (line === null) {
    return (
      <p className="dof__distance dof__distance--absent">
        {t(labelKey)}: {t("rider.quote.distance.unavailable")}
      </p>
    );
  }
  return (
    <p className="dof__distance">
      {t(labelKey)}: {t(line.key).replace("{value}", String(line.value))} ·{" "}
      <span className="dof__distance-kind">{t(line.kindKey)}</span>
    </p>
  );
}

export function OfferDetailScreen({
  offerId,
  language = MINIAPP_DEFAULT_LANGUAGE,
  onBack,
  onAccepted,
  readDetail = readDriverOfferDetail,
  accept = acceptDriverOffer,
  reject = rejectDriverOffer,
  now = () => Date.now(),
}: OfferDetailScreenProps) {
  const t = miniAppTranslator(language);
  const formId = useId();
  const [state, setState] = useState<DetailState>({ kind: "loading" });
  const [claim, setClaim] = useState<ClaimState>({ kind: "idle" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const detail = await readDetail(offerId);
      const readAtMs = now();
      setState({ kind: "ready", detail, readAtMs });
    } catch (thrown) {
      setState({ kind: "failed", code: codeOf(thrown) });
    }
  }, [now, offerId, readDetail]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAccept = useCallback(async () => {
    setClaim({ kind: "busy" });
    try {
      const result = await accept(offerId);
      setClaim({ kind: "won", orderId: result.order_id });
      onAccepted?.(result.order_id);
    } catch (thrown) {
      const code = codeOf(thrown);
      // **السبقُ يُقالُ حالاً لا عطلاً**، وما سواه يُقالُ عطلاً بنصِّه.
      setClaim(
        EXPECTED_REFUSALS.has(code)
          ? { kind: "lost", key: offersErrorKey(code) }
          : { kind: "failed", key: offersErrorKey(code) },
      );
    }
  }, [accept, offerId, onAccepted]);

  const handleReject = useCallback(async () => {
    setClaim({ kind: "busy" });
    try {
      await reject(offerId);
      setClaim({ kind: "idle" });
      onBack?.();
    } catch (thrown) {
      setClaim({ kind: "failed", key: offersErrorKey(codeOf(thrown)) });
    }
  }, [onBack, offerId, reject]);

  if (state.kind === "loading") {
    return (
      <section className="dof" aria-labelledby={`${formId}-title`} aria-busy="true">
        <h1 id={`${formId}-title`} className="dof__title">
          {t("driver.offers.detail.title")}
        </h1>
        <p className="dof__loading">{t("driver.offers.loading")}</p>
      </section>
    );
  }

  if (state.kind === "failed") {
    return (
      <section className="dof" aria-labelledby={`${formId}-title`}>
        <h1 id={`${formId}-title`} className="dof__title">
          {t("driver.offers.detail.title")}
        </h1>
        <EmptyState title={t("driver.offers.failed")} body={t(offersErrorKey(state.code))} />
        {isRetryableOffersError(state.code) ? (
          <button type="button" className="dof__retry" onClick={() => void load()}>
            {t("driver.offers.retry")}
          </button>
        ) : null}
        {onBack === undefined ? null : (
          <button type="button" className="dof__back" onClick={onBack}>
            {t("driver.offers.backToBoard")}
          </button>
        )}
      </section>
    );
  }

  const detail = toOfferDetail(state.detail);
  // **الباقي يُقرأُ لحظةَ الرسمِ** لا بعقربٍ يدقُّ (`F1-07` · `ADR 0035` §٤):
  // فارقٌ محليٌّ بينَ قراءتَينِ من ساعةٍ واحدةٍ، والصلاحيّةُ حكمُ خادمٍ.
  const secondsRemaining = countdownSeconds({
    secondsLeftAtRead: detail.secondsLeftAtRead,
    elapsedMs: now() - state.readAtMs,
  });
  const badge = COUNTDOWN_BADGE[countdownTone(secondsRemaining)];
  const acceptable = canAcceptNow({ isClaimable: detail.isClaimable, secondsRemaining });

  return (
    <section className="dof" aria-labelledby={`${formId}-title`}>
      <h1 id={`${formId}-title`} className="dof__title">
        {t("driver.offers.detail.title")}
      </h1>

      <div className="dof__item-head">
        <span className="dof__service">{t(detail.serviceKey)}</span>
        <span className={`dof__timer ${badge.modifier}`} role="status">
          {secondsRemaining > 0
            ? countdownLabel(secondsRemaining)
            : t("driver.offers.timer.elapsed")}
        </span>
      </div>

      <p className="dof__status">
        {t("driver.offers.detail.offerStatus")}: {t(detail.offerStatusKey)} ·{" "}
        {t("driver.offers.detail.orderStatus")}: {t(detail.orderStatusKey)}
      </p>
      <p className="dof__round">
        {t("driver.offers.detail.round")}: {detail.round}
      </p>

      <p className="dof__place">
        {t("driver.offers.pickup")}: {detail.pickupLabel ?? t("driver.offers.place.unnamed")}
      </p>
      <p className="dof__coords">
        {detail.pickupLatitude} , {detail.pickupLongitude}
      </p>
      <p className="dof__place">
        {t("driver.offers.dropoff")}:{" "}
        {detail.hasDropoff
          ? (detail.dropoffLabel ?? t("driver.offers.place.unnamed"))
          : t("driver.offers.place.none")}
      </p>

      <DistanceRow line={detail.riderDistance} labelKey="driver.offers.riderDistance" t={t} />
      <DistanceRow line={detail.tripDistance} labelKey="driver.offers.tripDistance" t={t} />

      <p className="dof__notes">
        {t("driver.offers.detail.notes")}:{" "}
        {detail.notes === null || detail.notes === ""
          ? t("driver.offers.detail.noNotes")
          : detail.notes}
      </p>

      <div className="dof__actions">
        {acceptable && claim.kind !== "won" ? (
          <button
            type="button"
            className="dof__accept"
            disabled={claim.kind === "busy"}
            onClick={() => void handleAccept()}
          >
            {t("driver.offers.accept")}
          </button>
        ) : null}
        {claim.kind === "won" ? null : (
          <button
            type="button"
            className="dof__reject"
            disabled={claim.kind === "busy"}
            onClick={() => void handleReject()}
          >
            {t("driver.offers.reject")}
          </button>
        )}
      </div>

      {acceptable ? null : (
        <p className="dof__closed" role="status">
          {t("driver.offers.detail.notClaimable")}
        </p>
      )}

      {claim.kind === "won" ? (
        <p className="dof__won" role="status">
          {t("driver.offers.claimed")} · {claim.orderId}
        </p>
      ) : null}
      {claim.kind === "lost" ? (
        <p className="dof__lost" role="status">
          {t(claim.key)}
        </p>
      ) : null}
      {claim.kind === "failed" ? (
        <p className="dof__error" role="status">
          {t(claim.key)}
        </p>
      ) : null}

      {onBack === undefined ? null : (
        <button type="button" className="dof__back" onClick={onBack}>
          {t("driver.offers.backToBoard")}
        </button>
      )}
    </section>
  );
}
