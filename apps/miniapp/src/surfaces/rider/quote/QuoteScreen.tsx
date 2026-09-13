/**
 * الغرض: شاشةُ الاقتباسِ `SR-04` — تقرأُ موقعَ الراكبِ، ثمَّ تسألُ الخادمَ حكماً
 *   واحداً، فتعرضُ مسافةً **موسومةً** ومدّةً صادقةً وبطاقاتَ الخدماتِ المخدومةِ
 *   في مدينتِه، **بلا سعرٍ ولا وسيلةِ دفعٍ** (البند `F2-04` · القسم 9.11).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-04` (نصفُه المشروعُ).
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/quote
 * يُستخدم من: `apps/miniapp/src/surfaces/rider/RiderRoot.tsx` بعدَ تأكيدِ الوجهةِ
 *   في `SR-03`.
 * يُتوقع أن يستخدمه لاحقاً: `F2-05` يُضيفُ فعلَ «اطلُبْ» إلى بطاقةٍ متاحةٍ؛
 *   وحتّى يُبنى **لا زرَّ** ههنا، بل سطرٌ يقولُ إنَّ الطلبَ لم يُبنَ بعدُ.
 * ملاحظات مستقبلية: لا حقلَ سعرٍ ولا وسيلةَ دفعٍ في هذه الشاشةِ قبلَ إغلاقِ
 *   `DEC-11` بسندٍ نظاميٍّ مكتوبٍ (`ADR 0039` §٦ · `م13-7`).
 *
 * ## لماذا يُقرأُ موقعُ الراكبِ ههنا ولا يُورَّثُ من الشاشةِ السابقةِ
 *
 * `SR-03` تقرأُ الموقعَ **اختياراً** («موقعي» بدلاً من البحثِ)، فقد يُصادِقُ راكبٌ
 * وجهتَه بالكتابةِ ولا يُقرأُ له موقعٌ قطُّ. ولو ورَّثناهُ لَكانَ الانطلاقُ
 * أحياناً غائباً وأحياناً قديماً بدقائقَ، والمسافةُ حينَها **تُقاسُ عن موضعٍ
 * غادرَه صاحبُه**. فالقراءةُ ههنا في لحظةِ السؤالِ.
 *
 * ## ولماذا لا يُستعاضُ عن الموقعِ المرفوضِ بمركزِ المدينةِ
 *
 * مركزُ المدينةِ يُنتِجُ مسافةً **تبدو صحيحةً** وليسَت عن أحدٍ. ورفضُ الإذنِ
 * يُعرَضُ سبباً بمفتاحِه ومعَه فعلٌ إن كانَ له فعلٌ — وهذا عينُ ما قرَّرَته
 * `SR-03` في `locationRefusalKey`، ويُعادُ استعمالُه ولا يُكتَبُ ثانياً.
 *
 * ## وما لا تفعلُه هذه الشاشةُ عن قصدٍ
 *
 *   ــ **لا تعرضُ سعراً ولا وسيلةَ دفعٍ ولا موضعاً محفوظاً لهما**: آليّةُ الأجرةِ
 *      محجوبةٌ على قرارٍ نظاميٍّ خارجِ المشروعِ (`ADR 0039` §٤)، والإيرادُ اليومَ
 *      اشتراكُ السائقِ وحدَه (`ADR 0027`) — فالراكبُ لا يدفعُ للمنصّةِ شيئاً.
 *   ــ **لا تُظهِرُ زرَّ طلبٍ لا يفعلُ شيئاً**: زرٌّ صامتٌ يُقرأُ عطباً.
 *   ــ **لا تخترعُ مدّةً**: تعرضُ امتناعَ `packages/domain/eta` بسببِه.
 *   ــ **لا تُخفي خدمةً غيرَ متاحةٍ**: تعرضُها معطَّلةً بسببِها.
 *   ــ **لا تحفظُ الاقتباسَ محلّيّاً**: يُعادُ سؤالُه في كلِّ تركيبٍ.
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
import { initLocation, openLocationSettings, requestLocation } from "../../../tg/index.ts";
import { locationRefusalKey, offersLocationSettings } from "../destination/destination-view.ts";
import { type QuoteRideResponse, quoteRide as quoteViaApi } from "./quote-api.ts";
import {
  distanceLine,
  durationLine,
  isRetryableQuoteError,
  quoteErrorKey,
  quoteRefusalKey,
  refusalRemedy,
  serviceCards,
} from "./quote-view.ts";

export interface QuoteScreenProps {
  /** الوجهةُ كما صادَقَتْها `SR-03` — تُمرَّرُ ولا يُعادُ البحثُ عنها. */
  readonly destination: {
    readonly label: string;
    readonly lat: number;
    readonly lng: number;
  };
  /** يُحقَنُ كي تُختبَرَ الشاشةُ بلا شبكةٍ. */
  readonly quote?: (input: {
    readonly originLat: number;
    readonly originLng: number;
    readonly destinationLat: number;
    readonly destinationLng: number;
  }) => Promise<QuoteRideResponse>;
  /** ويُحقَنُ جسرُ الموقعِ كي لا يُحتاجَ مُضيفُ تيليجرام في اختبارٍ. */
  readonly readDeviceLocation?: () => Promise<
    | { readonly ok: true; readonly lat: number; readonly lng: number }
    | { readonly ok: false; readonly reason: string }
  >;
  readonly openSettings?: () => void;
  readonly onBack?: () => void;
  readonly initialLanguage?: MiniAppLanguage;
}

/**
 * جسرُ الموقعِ الافتراضيُّ — نفسُ جسرِ `SR-03` حرفاً: تهيئةٌ ثمَّ قراءةٌ واحدةٌ،
 * والسببُ يُنقَلُ كما أعادَه الغلافُ ولا يُوحَّدُ. وكلُّ وصولٍ إلى تلغرام من
 * البرزخِ `../../../tg/index.ts` وحدَه (القسم 9.2 · حاجزُ
 * `check-telegram-wrapper-isolation`).
 */
async function defaultDeviceLocation(): Promise<
  | { readonly ok: true; readonly lat: number; readonly lng: number }
  | { readonly ok: false; readonly reason: string }
> {
  const inited = await initLocation();
  if (!inited.ok) return { ok: false, reason: inited.reason };
  const read = await requestLocation();
  if (!read.ok) return { ok: false, reason: read.reason };
  return { ok: true, lat: read.value.latitude, lng: read.value.longitude };
}

type QuoteState =
  | { readonly kind: "locating" }
  | { readonly kind: "asking" }
  | { readonly kind: "location_refused"; readonly reason: string }
  | { readonly kind: "accepted"; readonly response: Extract<QuoteRideResponse, { accepted: true }> }
  | {
      readonly kind: "refused";
      readonly refusal: string;
      readonly cityName: { readonly ar: string; readonly en: string } | null;
    }
  | { readonly kind: "rejected"; readonly code: string };

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

export function QuoteScreen({
  destination,
  quote = quoteViaApi,
  readDeviceLocation = defaultDeviceLocation,
  openSettings = () => void openLocationSettings(),
  onBack,
  initialLanguage = MINIAPP_DEFAULT_LANGUAGE,
}: QuoteScreenProps) {
  const [language] = useState<MiniAppLanguage>(initialLanguage);
  const [state, setState] = useState<QuoteState>({ kind: "locating" });
  const [system, setSystem] = useState<SystemState>(null);
  const mounted = useRef(true);
  /** ردٌّ متأخِّرٌ لسؤالٍ قديمٍ **يُطرَحُ** ولا يُعرَضُ (عينُ حكمِ `SR-03`). */
  const issued = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const t = miniAppTranslator(language);

  const ask = useCallback(async () => {
    const ticket = ++issued.current;
    setSystem(null);
    setState({ kind: "locating" });
    const here = await readDeviceLocation();
    if (!mounted.current || ticket !== issued.current) return;
    if (!here.ok) {
      setState({ kind: "location_refused", reason: here.reason });
      return;
    }
    setState({ kind: "asking" });
    try {
      const response = await quote({
        originLat: here.lat,
        originLng: here.lng,
        destinationLat: destination.lat,
        destinationLng: destination.lng,
      });
      if (!mounted.current || ticket !== issued.current) return;
      if (response.accepted) {
        setState({ kind: "accepted", response });
        return;
      }
      setState({
        kind: "refused",
        refusal: response.refusal,
        cityName:
          response.city === null ? null : { ar: response.city.nameAr, en: response.city.nameEn },
      });
    } catch (thrown) {
      const screen = await screenFor(thrown);
      if (!mounted.current || ticket !== issued.current) return;
      if (screen !== null) {
        setSystem({ screen });
        return;
      }
      setState({ kind: "rejected", code: codeOf(thrown) ?? "UNKNOWN" });
    }
  }, [quote, readDeviceLocation, destination.lat, destination.lng]);

  useEffect(() => {
    void ask();
  }, [ask]);

  if (system !== null) {
    return <SystemScreen state={system.screen} onAction={() => void ask()} />;
  }

  const cityLine = (name: { readonly ar: string; readonly en: string } | null) =>
    name === null ? null : (
      <p className="qt__city">
        {t("rider.quote.city").replace("{city}", language === "ar" ? name.ar : name.en)}
      </p>
    );

  const body = () => {
    if (state.kind === "locating" || state.kind === "asking") {
      return (
        <div className="qt__pending" aria-busy="true">
          <p className="sys__hint">
            {t(state.kind === "locating" ? "rider.quote.locating" : "rider.quote.asking")}
          </p>
          <Skeleton />
        </div>
      );
    }

    if (state.kind === "location_refused") {
      return (
        <div className="sys" role="alert">
          <p className="sys__body">{t(locationRefusalKey(state.reason))}</p>
          <button type="button" className="sys__action" onClick={() => void ask()}>
            {t("rider.quote.retry")}
          </button>
          {offersLocationSettings(state.reason) && (
            <button type="button" className="sys__action" onClick={() => openSettings()}>
              {t("rider.destination.location.settings")}
            </button>
          )}
        </div>
      );
    }

    if (state.kind === "rejected") {
      return (
        <div className="sys" role="alert">
          <p className="sys__body">{t(quoteErrorKey(state.code))}</p>
          {isRetryableQuoteError(state.code) && (
            <button type="button" className="sys__action" onClick={() => void ask()}>
              {t("rider.quote.retry")}
            </button>
          )}
        </div>
      );
    }

    if (state.kind === "refused") {
      const remedy = refusalRemedy(state.refusal);
      return (
        <div className="sys" role="alert">
          <p className="sys__body">{t(quoteRefusalKey(state.refusal))}</p>
          {cityLine(state.cityName)}
          {remedy === "RELOCATE" && (
            <button type="button" className="sys__action" onClick={() => void ask()}>
              {t("rider.quote.remedy.relocate")}
            </button>
          )}
          {remedy === "PICK_ANOTHER_DESTINATION" && (
            <button type="button" className="sys__action" onClick={() => onBack?.()}>
              {t("rider.quote.remedy.pickAnother")}
            </button>
          )}
          {/* `NONE`: لا زرَّ — «مدينتُك بلا حدٍّ مرسومٍ» لا يُصلِحُه الراكبُ. */}
        </div>
      );
    }

    const { response } = state;
    const distance = distanceLine(response.distance);
    const duration = durationLine(response.eta);
    const cards = serviceCards(response.services);
    return (
      <div className="qt__result">
        {cityLine({ ar: response.city.nameAr, en: response.city.nameEn })}

        <section className="qt__measures" aria-label={t("rider.quote.measures")}>
          {distance === null ? (
            // وسمٌ مجهولٌ أو قيمةٌ لا تُقاسُ: يُقالُ ولا يُعرَضُ رقمٌ بلا وسمٍ.
            <p className="qt__measure qt__measure--off">{t("rider.quote.distance.unavailable")}</p>
          ) : (
            <p className="qt__measure">
              <span className="qt__value">
                {t(distance.key).replace("{value}", String(distance.value))}
              </span>
              {/* الوسمُ يُعرَضُ دائماً مُلاصِقاً للقيمةِ (`ADR 0024`). */}
              <span className="qt__tag">{t(distance.kindKey)}</span>
            </p>
          )}

          {duration.kind === "ROUTED" ? (
            <p className="qt__measure">
              <span className="qt__value">
                {t("rider.quote.durationMinutes").replace("{value}", String(duration.minutes))}
              </span>
            </p>
          ) : (
            <p className="qt__measure qt__measure--off">{t(duration.reasonKey)}</p>
          )}
        </section>

        <section className="qt__services" aria-label={t("rider.quote.services")}>
          <h2 className="qt__subtitle">{t("rider.quote.services")}</h2>
          <ul className="qt__list">
            {cards.map((card) => (
              <li
                key={card.service}
                className={`qt__card${card.available ? "" : " qt__card--off"}`}
              >
                <span className="qt__card-label">{t(card.labelKey)}</span>
                {card.reasonKey !== null && (
                  <span className="qt__card-reason">{t(card.reasonKey)}</span>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/*
         * ما لم يُبنَ يُقالُ صريحاً: `F2-05` هوَ إنشاءُ الطلبِ، ولا زرَّ ههنا
         * يُوهِمُ الراكبَ أنَّ الطلبَ ممكنٌ الآنَ.
         */}
        <p className="qt__pending-item">{t("rider.quote.next.notBuilt")}</p>
      </div>
    );
  };

  return (
    <section className="qt" dir={directionFor(language)} aria-labelledby="qt-title">
      <h1 className="qt__title" id="qt-title">
        {t("rider.quote.title")}
      </h1>
      <p className="qt__destination">
        {t("rider.quote.destination").replace("{label}", destination.label)}
      </p>
      {body()}
      <button type="button" className="qt__back" onClick={() => onBack?.()}>
        {t("rider.quote.back")}
      </button>
    </section>
  );
}
