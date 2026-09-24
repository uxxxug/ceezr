/**
 * الغرض: شاشةُ ملخَّصِ الرحلةِ المنتهيةِ للسائقِ — بطاقةُ الراكبِ ونجومٌ وملاحظةٌ
 *   بلا وسومٍ (البند `F12-05`).
 * الحالة: منفَّذٌ فعليّاً — البند `F12-05`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/summary
 * يُستخدم من: `DriverRoot.tsx`.
 *
 * ## ولماذا لا وسومَ للسائقِ
 *
 * تقييمُ السائقِ للراكبِ نجومٌ وملاحظةٌ وحدَها — لا وسومَ. فالسائقُ يقيِّمُ
 * الراكبَ بالنجومِ والملاحظةِ، ولا يصفُه بوسومِ السائقِ (النظافةُ والأدبُ…).
 * والقاعدةُ تقبلُ الوسومَ في الاتّجاهَينِ لكنَّ عقدَ السائقِ يُرسِلُها فارغةً.
 */

import { useEffect, useRef, useState } from "react";
import {
  directionFor,
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/core.ts";
import { durationLine, straightLineLine } from "../../rider/summary/ride-summary-view.ts";
import {
  type RideSummaryResponse,
  readDriverRideSummary,
  submitDriverRideRating,
} from "./driver-ride-summary-api.ts";
import { riderCard } from "./driver-ride-summary-view.ts";

export interface DriverRideSummaryScreenProps {
  readonly orderId: string;
  readonly initialLanguage?: MiniAppLanguage;
  readonly readSummary?: typeof readDriverRideSummary;
  readonly submitRating?: typeof submitDriverRideRating;
}

export function DriverRideSummaryScreen({
  orderId,
  initialLanguage = MINIAPP_DEFAULT_LANGUAGE,
  readSummary = readDriverRideSummary,
  submitRating = submitDriverRideRating,
}: DriverRideSummaryScreenProps): React.ReactNode {
  const [language] = useState<MiniAppLanguage>(initialLanguage);
  const t = miniAppTranslator(language);
  const [summary, setSummary] = useState<RideSummaryResponse | null>(null);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    readSummary(orderId)
      .then((res) => setSummary(res))
      .catch(() => setError("network"));
  }, [orderId, readSummary]);

  if (error !== null) {
    return (
      <section dir={directionFor(language)} aria-labelledby="dsm-err">
        <h1 id="dsm-err">{t("common.error")}</h1>
      </section>
    );
  }
  if (summary === null) {
    return (
      <section dir={directionFor(language)} aria-labelledby="dsm-load">
        <h1 id="dsm-load">{t("common.loading")}</h1>
      </section>
    );
  }
  if (!summary.ok || !summary.found) {
    return (
      <section dir={directionFor(language)} aria-labelledby="dsm-nf">
        <h1 id="dsm-nf">{t("driver.summary.notFound")}</h1>
      </section>
    );
  }

  const dur = durationLine(summary.duration);
  const dist = straightLineLine(summary.straightLine);
  const card = riderCard(summary.rider);
  const canRate = summary.rating.canRate && !summary.rating.alreadyRated;

  function handleSubmit(): void {
    if (stars === 0 || busyRef.current) return;
    busyRef.current = true;
    setSubmitting(true);
    submitRating(orderId, { stars, comment: comment.trim() })
      .then(() => readSummary(orderId))
      .then((res) => {
        setSummary(res);
        setStars(0);
        setComment("");
      })
      .catch(() => setError("network"))
      .finally(() => {
        busyRef.current = false;
        setSubmitting(false);
      });
  }

  return (
    <section className="dsm" dir={directionFor(language)} aria-labelledby="dsm-title">
      <h1 className="dsm__title" id="dsm-title">
        {t("driver.summary.title")}
      </h1>

      {card !== null && (
        <div className="dsm__rider-card">
          <h2>{t("driver.summary.riderCard")}</h2>
          <p className="dsm__rider-name">
            {t("driver.summary.riderName")}: {card.firstName ?? "—"}
          </p>
          {card.ratingAverage !== null && (
            <p className="dsm__rider-rating">
              {t("driver.summary.riderRating")}: {card.ratingAverage} ({card.ratingCount})
            </p>
          )}
        </div>
      )}

      {dur.known ? (
        <p className="dsm__duration">
          {t(dur.key)
            .replace("{minutes}", String(dur.minutes))
            .replace("{seconds}", String(dur.seconds))}
        </p>
      ) : (
        <p className="dsm__duration">{t(dur.key)}</p>
      )}

      {dist.known ? (
        <p className="dsm__distance">
          {t(dist.key)
            .replace("{meters}", String(dist.meters))
            .replace("{kilometers}", String(dist.kilometers))}
        </p>
      ) : (
        <p className="dsm__distance">{t(dist.key)}</p>
      )}

      {canRate && (
        <div className="dsm__rate-form">
          <h2>{t("driver.summary.rateRider")}</h2>
          <fieldset className="dsm__stars">
            <legend>{t("driver.summary.stars.label")}</legend>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={n === stars}
                aria-label={t("driver.summary.stars.one").replace("{stars}", String(n))}
                onClick={() => setStars(n)}
              >
                {n <= stars ? "★" : "☆"}
              </button>
            ))}
          </fieldset>
          <textarea
            className="dsm__comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t("driver.summary.commentPlaceholder")}
            maxLength={500}
          />
          <button
            type="button"
            className="dsm__submit"
            onClick={handleSubmit}
            disabled={stars === 0 || submitting}
          >
            {submitting ? t("common.submitting") : t("driver.summary.submitRating")}
          </button>
        </div>
      )}

      {summary.rating.alreadyRated && (
        <p className="dsm__already-rated">{t("driver.summary.alreadyRated")}</p>
      )}
    </section>
  );
}
