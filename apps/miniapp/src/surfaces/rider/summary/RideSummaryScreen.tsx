/**
 * الغرض: شاشةُ إنهاءِ الرحلةِ — ملخَّصٌ (مدّةٌ ووترُ خطٍّ مستقيمٍ وبطاقةُ سائقٍ)
 *   ونموذجُ تقييمٍ بنجومٍ ووسومٍ من مُعجَمٍ محصورٍ وملاحظةٍ اختياريّةٍ
 *   (البند `F2-07` · `SR-07` · `SR-08`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-07`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/summary
 * يُستخدم من: `apps/miniapp/src/surfaces/rider/RiderRoot.tsx` (طورُ `summarized`)
 * يُتوقع أن يستخدمه لاحقاً: `F2-09` (مشاركةُ الرحلةِ) تعرضُ الملخَّصَ نفسَه في
 *   صفحةٍ عامّةٍ **بلا نموذجِ تقييمٍ**.
 *
 * ## لماذا القراءةُ مرّةً واحدةً بلا مؤقّتٍ
 *
 * الرحلةُ **انتهت**: لا حالةَ تتغيَّرُ ولا موقعَ يتحرَّكُ. واستقصاءٌ دوريٌّ ههنا
 * نداءُ شبكةٍ لجوابٍ واحدٍ مُعادٍ (`ADR 0035` §٤). وبعدَ الإرسالِ **تُعادُ
 * القراءةُ مرّةً** كي تُقرأَ حالةُ التقييمِ من القاعدةِ لا من ظنِّ الشاشةِ.
 *
 * ## ولماذا زرُّ الإرسالِ يُرسَمُ بحكمِ القاعدةِ وحدَه
 *
 * `canRate` حكمٌ مقيسٌ بساعةِ القاعدةِ وبقيدِها الفريدِ. وزرٌّ يُرسَمُ بحكمِ
 * الشاشةِ ثمَّ يُرفَضُ نداؤُه **أسوأُ** من زرٍّ لا يُرسَمُ ومعَه سببُه نصّاً.
 * وبعدَ رفضٍ من القاعدةِ (`ALREADY_RATED` مثلاً) **يُخفى النموذجُ** ويُقالُ
 * السببُ: إعادةُ المحاولةِ بلا أملٍ ليسَت خياراً يُعرَضُ.
 *
 * ## وما لا تفعلُه هذه الشاشةُ عن قصدٍ
 *
 *   ــ **لا تعرضُ مبلغاً ولا أجرةً ولا وسيلةَ دفعٍ ولا إكراميّةً ولا خانةً
 *      لها** — مُجمَّدةٌ بـ`ADR 0039` §٤ (`DEC-11` · `م13-7`). والشاشةُ
 *      **ملخَّصُ رحلةٍ لا إيصالٌ**.
 *   ــ **لا تسمّي رقمَ الوترِ «مسافةً مقطوعةً»**: لا أثرَ مسارٍ في القاعدةِ.
 *   ــ **لا ترسمُ زرَّ تذكرةِ دعمٍ ولا «مشكلةً في الرحلةِ»**: لا مسارَ لهما في
 *      هذا البندِ — **غيابٌ مُصرَّحٌ**، وزرٌّ بلا مسارٍ وعدٌ لا عقدٌ.
 *   ــ **لا ترسمُ نجومَ السائقِ للراكبِ** (`SD-09`): سطحٌ آخرُ.
 *   ــ **لا تُرقِّعُ `fetch`**: النداءانِ مُعامَلانِ يُحقَنانِ في القياسِ.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  directionFor,
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/index.ts";
import {
  classifyFailure,
  failureFromThrown,
  shouldProbeReachability,
} from "../../../system/failure.ts";
import { deviceOnline, probeReachability } from "../../../system/health.ts";
import { Skeleton } from "../../../system/Skeleton.tsx";
import { SystemScreen } from "../../../system/SystemScreen.tsx";
import type { ScreenState } from "../../../system/state-text.ts";
import { SosEntry } from "../sos/SosEntry.tsx";
import {
  readRideSummary as readViaApi,
  submitRideRating as submitViaApi,
} from "./ride-summary-api.ts";
import type { RideRatingResponse, RideSummaryResponse } from "./ride-summary-contract.ts";

import {
  canSubmitRating,
  durationLine,
  eligibilityKey,
  MAX_RATING_COMMENT_LENGTH,
  MAX_RATING_TAGS,
  RATING_TAGS,
  ratingRefusalKey,
  straightLineLine,
  summaryErrorKey,
  summaryRefusalKey,
  tagKey,
} from "./ride-summary-view.ts";

export interface RideSummaryScreenProps {
  readonly orderId: string;
  readonly read?: (orderId: string) => Promise<RideSummaryResponse>;
  readonly rate?: (
    orderId: string,
    input: {
      readonly stars: number;
      readonly comment: string | null;
      readonly tags: readonly string[];
    },
  ) => Promise<RideRatingResponse>;
  readonly onBack?: () => void;
  /** مدخلُ الاستغاثةِ (`PD-020` · `ADR 0159`) — اختياريٌّ: يُرسَمُ إذا مُرِّرَ. */
  readonly onOpenSos?: () => void;
  readonly initialLanguage?: MiniAppLanguage;
}

type Found = Extract<RideSummaryResponse, { found: true }>;

type SummaryState =
  | { readonly kind: "reading" }
  | { readonly kind: "refused"; readonly refusal: string }
  | { readonly kind: "rejected"; readonly code: string }
  | { readonly kind: "ready"; readonly view: Found }
  | { readonly kind: "rate_refused"; readonly view: Found; readonly refusal: string }
  | { readonly kind: "rated"; readonly view: Found };

type SystemState = { readonly screen: ScreenState } | null;

function codeOf(thrown: unknown): string | null {
  if (thrown !== null && typeof thrown === "object" && "code" in thrown) {
    const code = (thrown as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

async function screenFor(thrown: unknown): Promise<ScreenState | null> {
  const failure = failureFromThrown(thrown);
  if (failure === null) return null;
  const online = deviceOnline();
  const probe = shouldProbeReachability(failure, online) ? await probeReachability() : "not_probed";
  return classifyFailure(failure, probe, online);
}

export function RideSummaryScreen({
  orderId,
  read = readViaApi,
  rate = submitViaApi,
  onBack,
  onOpenSos,
  initialLanguage = MINIAPP_DEFAULT_LANGUAGE,
}: RideSummaryScreenProps) {
  const [language] = useState<MiniAppLanguage>(initialLanguage);
  const [state, setState] = useState<SummaryState>({ kind: "reading" });
  const [system, setSystem] = useState<SystemState>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [stars, setStars] = useState<number | null>(null);
  const [tags, setTags] = useState<readonly string[]>([]);
  const [comment, setComment] = useState("");
  const mounted = useRef(true);
  /** حاجزا تزامنٍ **مرجعانِ**: قراءةٌ واحدةٌ وإرسالٌ واحدٌ، بلا تغييرِ هويّةِ دالّةٍ. */
  const readingRef = useRef(false);
  const busyRef = useRef(false);
  /** ردٌّ متأخِّرٌ لسؤالٍ قديمٍ **يُطرَحُ** ولا يُعرَضُ (عينُ حكمِ `SR-05`). */
  const issued = useRef(0);
  const t = miniAppTranslator(language);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(
    async (id: string) => {
      if (readingRef.current) return;
      readingRef.current = true;
      setReading(true);
      const question = ++issued.current;
      try {
        const response = await read(id);
        if (!mounted.current || question !== issued.current) return;
        if (!response.found) {
          setState({ kind: "refused", refusal: response.refusal });
          return;
        }
        setState({ kind: "ready", view: response });
      } catch (thrown) {
        if (!mounted.current || question !== issued.current) return;
        const screen = await screenFor(thrown);
        if (!mounted.current) return;
        if (screen !== null) setSystem({ screen });
        else setState({ kind: "rejected", code: codeOf(thrown) ?? "HTTP_ERROR" });
      } finally {
        readingRef.current = false;
        if (mounted.current) setReading(false);
      }
    },
    [read],
  );

  /** نداءٌ واحدٌ عندَ الدخولِ — الرحلةُ انتهت فلا شيءَ يُستقصى. */
  useEffect(() => {
    void refresh(orderId);
  }, [orderId, refresh]);

  const toggleTag = useCallback((tag: string) => {
    setTags((current) => {
      if (current.includes(tag)) return current.filter((entry) => entry !== tag);
      // السقفُ يُحرَسُ في الشاشةِ **وفي النطاقِ وفي القاعدةِ**: الرابعُ لا
      // يُستبدَلُ بالثالثِ صامتاً، بل لا يُضافُ ويبقى الاختيارُ كما تركَه الراكبُ.
      if (current.length >= MAX_RATING_TAGS) return current;
      return [...current, tag];
    });
  }, []);

  const askRate = useCallback(
    async (view: Found) => {
      if (busyRef.current || stars === null) return;
      busyRef.current = true;
      setBusy(true);
      try {
        const response = await rate(orderId, {
          stars,
          comment: comment.trim().length === 0 ? null : comment,
          tags,
        });
        if (!mounted.current) return;
        if (!response.accepted) {
          setState({ kind: "rate_refused", view, refusal: response.refusal });
          return;
        }
        setState({ kind: "rated", view });
        // تُعادُ القراءةُ كي تُقرأَ حالةُ التقييمِ من القاعدةِ لا من ظنِّ الشاشةِ.
        void refresh(orderId);
      } catch (thrown) {
        if (!mounted.current) return;
        const screen = await screenFor(thrown);
        if (!mounted.current) return;
        if (screen !== null) setSystem({ screen });
        else setState({ kind: "rejected", code: codeOf(thrown) ?? "HTTP_ERROR" });
      } finally {
        busyRef.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [comment, orderId, rate, refresh, stars, tags],
  );

  if (system !== null) {
    return (
      <SystemScreen state={system.screen} onAction={() => void refresh(orderId)} busy={reading} />
    );
  }

  const ratingForm = (view: Found) => {
    if (!view.rating.canRate) {
      return <p className="sm__rating-state">{t(eligibilityKey(view.rating.eligibility))}</p>;
    }
    return (
      <div className="sm__rating">
        <p className="sm__rating-state">{t(eligibilityKey(view.rating.eligibility))}</p>

        {/* النجومُ **إلزاميّةٌ**: لا إرسالَ بلا اختيارٍ، ولا قيمةَ مبدئيّةً
            تُرسَلُ عن راكبٍ لم يخترْ. */}
        {/* `fieldset` لا `div role="group"`: العنصرُ الأصليُّ يحملُ المعنى في
            كلِّ قارئِ شاشةٍ، والدورُ المُلصَقُ يحملُه في بعضِها. */}
        <fieldset className="sm__stars" aria-label={t("rider.summary.stars.label")}>
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              type="button"
              key={value}
              className={stars === value ? "sm__star sm__star--chosen" : "sm__star"}
              aria-pressed={stars === value}
              disabled={busy}
              onClick={() => setStars(value)}
            >
              {t("rider.summary.stars.one").replace("{stars}", String(value))}
            </button>
          ))}
        </fieldset>

        {/* الوسومُ من المُعجَمِ المحصورِ وحدَه، وسقفُها معروضٌ نصّاً. */}
        <p className="sm__tags-hint">
          {t("rider.summary.tags.hint").replace("{max}", String(MAX_RATING_TAGS))}
        </p>
        <fieldset className="sm__tags" aria-label={t("rider.summary.tags.label")}>
          {RATING_TAGS.map((tag) => (
            <button
              type="button"
              key={tag}
              className={tags.includes(tag) ? "sm__tag sm__tag--chosen" : "sm__tag"}
              aria-pressed={tags.includes(tag)}
              disabled={busy}
              onClick={() => toggleTag(tag)}
            >
              {t(tagKey(tag))}
            </button>
          ))}
        </fieldset>

        <label className="sm__comment-label" htmlFor="sm-comment">
          {t("rider.summary.comment.label")}
        </label>
        <textarea
          className="sm__comment"
          id="sm-comment"
          maxLength={MAX_RATING_COMMENT_LENGTH}
          value={comment}
          disabled={busy}
          onChange={(event) => setComment(event.target.value)}
        />

        <button
          type="button"
          className="sm__submit"
          disabled={busy || !canSubmitRating({ stars, tags, comment })}
          onClick={() => void askRate(view)}
        >
          {t(busy ? "rider.summary.submitting" : "rider.summary.submit")}
        </button>
      </div>
    );
  };

  const summaryBody = (view: Found) => {
    const duration = durationLine(view.duration);
    const straight = straightLineLine(view.straightLine);
    const driver = view.driver;

    return (
      <div className="sm__body">
        <p className="sm__route">
          {t("rider.summary.route")
            .replace("{pickup}", view.pickupLabel ?? t("rider.summary.point.unlabeled"))
            .replace("{dropoff}", view.dropoffLabel ?? t("rider.summary.point.unlabeled"))}
        </p>

        {/* المدّةُ حكمٌ: دقائقُ وثوانٍ، أو سببُ غيابِها — **ولا صفرَ**. */}
        <p className="sm__duration">
          {duration.known
            ? t(duration.key)
                .replace("{minutes}", String(duration.minutes))
                .replace("{seconds}", String(duration.seconds))
            : t(duration.key)}
        </p>

        {/* الوترُ **بمفتاحٍ يُصرِّحُ بأنَّه خطٌّ مستقيمٌ** لا مقطوعٌ. */}
        <p className="sm__straight-line">
          {straight.known
            ? t(straight.key)
                .replace("{meters}", String(straight.meters))
                .replace("{kilometers}", straight.kilometers)
            : t(straight.key)}
        </p>

        {driver === null ? (
          <p className="sm__no-driver">{t("rider.summary.driver.none")}</p>
        ) : (
          <div className="sm__driver">
            <p className="sm__driver-name">
              {t("rider.summary.driver.name").replace(
                "{name}",
                driver.firstName ?? t("rider.summary.driver.unnamed"),
              )}
            </p>
            <p className="sm__driver-vehicle">
              {t("rider.summary.driver.vehicle")
                .replace("{vehicle}", driver.vehicleType ?? t("rider.summary.driver.noVehicle"))
                .replace("{plate}", driver.plateNumber ?? t("rider.summary.driver.noPlate"))}
            </p>
            {/* `null` = لا تقييمَ بعدُ: يُقالُ نصّاً ولا يُعرَضُ صفرٌ. */}
            <p className="sm__driver-rating">
              {driver.ratingAverage === null
                ? t("rider.summary.driver.unrated")
                : t("rider.summary.driver.rating")
                    .replace("{average}", driver.ratingAverage.toFixed(1))
                    .replace("{count}", String(driver.ratingCount))}
            </p>
          </div>
        )}
      </div>
    );
  };

  const body = () => {
    if (state.kind === "reading") {
      return (
        <div className="sm__pending" aria-busy="true">
          <p className="sys__hint">{t("rider.summary.reading")}</p>
          <Skeleton />
        </div>
      );
    }

    if (state.kind === "refused") {
      return (
        <div className="sys" role="alert">
          <p className="sys__body">{t(summaryRefusalKey(state.refusal))}</p>
          <button type="button" className="sys__action" onClick={() => onBack?.()}>
            {t("rider.summary.back")}
          </button>
        </div>
      );
    }

    if (state.kind === "rejected") {
      return (
        <div className="sys" role="alert">
          <p className="sys__body">{t(summaryErrorKey(state.code))}</p>
          <button type="button" className="sys__action" onClick={() => void refresh(orderId)}>
            {t("rider.summary.retry")}
          </button>
          <button type="button" className="sys__action" onClick={() => onBack?.()}>
            {t("rider.summary.back")}
          </button>
        </div>
      );
    }

    if (state.kind === "rate_refused") {
      // رفضُ القاعدةِ **يُقالُ ولا يُعادُ النموذجُ**: «قيَّمتَ سلفاً» لا يُصلَحُ
      // بضغطةٍ ثانيةٍ، وإعادةُ الزرِّ تُوهِمُ أنَّ المحاولةَ تُجدي.
      return (
        <>
          {summaryBody(state.view)}
          <div className="sys" role="alert">
            <p className="sys__body">{t(ratingRefusalKey(state.refusal))}</p>
            <button type="button" className="sys__action" onClick={() => void refresh(orderId)}>
              {t("rider.summary.refresh")}
            </button>
          </div>
        </>
      );
    }

    if (state.kind === "rated") {
      return (
        <>
          {summaryBody(state.view)}
          <div className="sys" role="status">
            <p className="sys__body">{t("rider.summary.thanks")}</p>
            <button type="button" className="sys__action" onClick={() => onBack?.()}>
              {t("rider.summary.back")}
            </button>
          </div>
        </>
      );
    }

    return (
      <>
        {summaryBody(state.view)}
        {ratingForm(state.view)}
        <button type="button" className="sm__back" onClick={() => onBack?.()}>
          {t("rider.summary.back")}
        </button>

        {/* مدخلُ الاستغاثةِ (`PD-020`) — نافذةُ ما بعدَ الرحلةِ مفتوحةٌ فالبابُ كذلك. */}
        {onOpenSos === undefined ? null : <SosEntry onOpen={onOpenSos} language={language} />}
      </>
    );
  };

  return (
    <section className="sm" dir={directionFor(language)} aria-labelledby="sm-title">
      <h1 className="sm__title" id="sm-title">
        {t("rider.summary.title")}
      </h1>
      {body()}
    </section>
  );
}
