/**
 * الغرض: شاشةُ الراكبِ الرئيسةُ `SR-02` (البند `F2-02`): خريطةٌ مصغَّرةٌ أو إعلانُ
 *   تعذّرِها · حقلُ «إلى أين؟» · الأماكنُ المحفوظةُ · آخرُ الوجهاتِ · شرائحُ
 *   الخدماتِ · شريطُ حالةِ المدينةِ — كما ينصُّ القسم 9.5 حرفاً.
 * الحالة: منفّذ فعلياً — البند `F2-02`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/home
 * يُتوقع أن يستخدمه لاحقاً: `RiderRoot.tsx`، وشاشةُ طلبِ المشوارِ `F2-03` تُركَّبُ
 *   بعدَ اختيارِ وجهةٍ من ههنا.
 * ملاحظات مستقبلية: الشريطُ السفليُّ بأربعِ علاماتٍ (القسم 9.3) بندُ `F1-07` ولا
 *   يُدَّعى ههنا.
 *
 * ═══ حدودٌ معلَنةٌ في هذه الشاشةِ ═══
 *
 *   ١. **لا خريطةَ حقيقيّةً**: لا مزوّدَ خرائطَ في حزمةِ التطبيقِ المصغَّرِ اليومَ
 *      (مزوّدُ `packages/maps` يُصيِّرُ صفحاتَ اللوحةِ في الخادمِ — ADR 0007).
 *      فالشاشةُ تُعلِنُ `rider.home.map.unavailable` ولا ترسمُ مستطيلاً رمادِيّاً
 *      يُوهِمُ موقعاً. ويُمرَّرُ `mapProvider` وسيطاً كي يصيرَ التركيبُ تبديلَ
 *      وسيطٍ حينَ يُهيَّأُ مزوّدٌ فعليٌّ، لا إعادةَ كتابةٍ للشاشةِ.
 *   ٢. **لا موقعَ للجهازِ**: طلبُ الإذنِ الجغرافيِّ وقراءتُه بندٌ لاحقٌ، فـ«موقعي»
 *      غيرُ مزعومٍ ههنا.
 *   ٣. **لا انتقالَ بعدَ الاختيارِ**: اختيارُ وجهةٍ أو خدمةٍ يُبلَّغُ للأعلى عبرَ
 *      `onDestinationChosen`؛ وشاشةُ ما بعدَه بندُ `F2-03`.
 *   ٤. **لم تُفتَح من مستخدمٍ حقيقيٍّ بعد**: لا نشرَ حيَّ لهذه الحزمةِ، فما ههنا
 *      مُختبَرٌ لا مُثبَتٌ عندَ مستخدمٍ (سُلَّمُ القسم 1.3).
 *
 * ## إضافةُ البند `F2-08` (2026-09-14)
 *
 * صارَ للشاشةِ **مدخلُ سجلٍّ** واحدٌ (`onOpenHistory`) يفتحُ `SR-09`. وما قبلَه
 * **باقٍ كما هوَ** (القاعدة ح-1) ولا سطرَ حُذِفَ؛ والحدُّ الثالثُ أعلاه القائلُ
 * إنَّ الاختيارَ يُبلَّغُ للأعلى **باقٍ على حالِه**: هذا المدخلُ كذلكَ لا ينتقلُ
 * بنفسِه بل يُبلِّغُ `RiderRoot.tsx`.
 *
 * ولماذا زرٌّ **لا شريحةٌ رابعةٌ في `rh__services`**: الشرائحُ تختارُ خدمةَ طلبٍ
 * جديدٍ، والسجلُّ قراءةُ ماضٍ — وضمُّهما يجعلُ «السجلَّ» يُقرأُ خدمةً تُطلَبُ.
 *
 * وهوَ مرسومٌ في فرعِ **الرفضِ** أيضاً: تعذُّرُ قراءةِ الأماكنِ لا علاقةَ له
 * بسجلِّ الرحلاتِ، وحجبُه هناكَ يحبسُ الراكبَ عن ماضيه بسببِ عطبٍ في حاضرِه.
 *
 * وما لا يفعلُه: لا يعرضُ عدداً ولا آخرَ رحلةٍ ههنا — ذاكَ نداءٌ ثانٍ لِيُرسَمَ
 * رقمٌ في زرٍّ، والقائمةُ نفسُها تقولُه بعدَ فتحِها.
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
  HOME_SERVICES,
  type HomeService,
  isRetryablePlacesError,
  isSubmittableDestination,
  type PlaceRow,
  placeRows,
  placesErrorKey,
  type RecentRow,
  recentRows,
  serviceKey,
} from "./home-view.ts";
import {
  type ApiRecentDestination,
  type ApiSavedPlace,
  fetchRecentDestinations,
  fetchSavedPlaces,
} from "./places-api.ts";

export interface ChosenDestination {
  readonly label: string;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly service: HomeService;
}

export interface HomeScreenProps {
  /** يُحقَنانِ كي تُختبَرَ الشاشةُ بلا شبكةٍ ولا `fetch` مُرقَّعٍ. */
  readonly loadPlaces?: () => Promise<{ readonly places: readonly ApiSavedPlace[] }>;
  readonly loadRecent?: () => Promise<{
    readonly destinations: readonly ApiRecentDestination[];
  }>;
  readonly onDestinationChosen?: (chosen: ChosenDestination) => void;
  /**
   * مدخلُ سجلِّ الرحلاتِ (`SR-09` · البند `F2-08`). وغيابُه **لا يرسمُ زرّاً
   * مُعطَّلاً**: مدخلٌ لا يُفتَحُ أسوأُ من غيابِ مدخلٍ.
   */
  readonly onOpenHistory?: () => void;
  /** مدخلُ شاشةِ الحسابِ (`SR-12`) — **اختياريٌّ** كأختِه: غيابُه لا يُبيِّضُ الرئيسةَ. */
  readonly onOpenAccount?: () => void;
  /** مدخلُ الاستغاثةِ (`PD-020` · `ADR 0159`) — اختياريٌّ كأخوتَيهِ. */
  readonly onOpenSos?: () => void;
  readonly initialLanguage?: MiniAppLanguage;
  /** اسمُ المزوّدِ المُهيَّأِ فعلاً؛ `"none"` تعني: قُلِ الحدَّ ولا ترسمْ. */
  readonly mapProvider?: string;
  /** اسمُ المدينةِ كما يُعيدُه الخادمُ — يُعرَضُ بجانبِ حالتِها لا بدلاً منها. */
  readonly cityName?: string;
}

type LoadState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly places: readonly PlaceRow[];
      readonly recent: readonly RecentRow[];
    }
  | { readonly kind: "screen"; readonly screen: ScreenState }
  | { readonly kind: "rejected"; readonly code: string };

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

export function HomeScreen({
  loadPlaces = fetchSavedPlaces,
  loadRecent = fetchRecentDestinations,
  onDestinationChosen,
  onOpenHistory,
  onOpenAccount,
  onOpenSos,
  initialLanguage = MINIAPP_DEFAULT_LANGUAGE,
  mapProvider = "none",
  cityName,
}: HomeScreenProps) {
  const [language] = useState<MiniAppLanguage>(initialLanguage);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [typed, setTyped] = useState("");
  const [service, setService] = useState<HomeService>("transport");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const t = miniAppTranslator(language);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      // النداءانِ متوازيانِ: لا أحدَهما شرطٌ للآخرِ، وتسلسلُهما يُضاعِفُ زمنَ
      // أوّلِ رسمٍ على شبكةٍ ضعيفةٍ (`UX-4`).
      const [placesResponse, recentResponse] = await Promise.all([loadPlaces(), loadRecent()]);
      if (!mounted.current) return;
      setState({
        kind: "ready",
        places: placeRows(placesResponse.places),
        recent: recentRows(recentResponse.destinations),
      });
    } catch (thrown) {
      const screen = await screenFor(thrown);
      if (!mounted.current) return;
      if (screen !== null) {
        setState({ kind: "screen", screen });
        return;
      }
      setState({ kind: "rejected", code: codeOf(thrown) ?? "UNKNOWN" });
    }
  }, [loadPlaces, loadRecent]);

  useEffect(() => {
    void load();
  }, [load]);

  const choose = (label: string, lat: number | null, lng: number | null) => {
    onDestinationChosen?.({ label, lat, lng, service });
  };

  const cityBar = (
    <p className="rh__city" role="status">
      {cityName === undefined
        ? t("rider.home.city.status")
        : `${cityName} — ${t("rider.home.city.status")}`}
    </p>
  );

  const services = (
    <fieldset className="rh__services">
      <legend className="sys__hint">{t("rider.home.destination.prompt")}</legend>
      {HOME_SERVICES.map((name) => (
        <button
          key={name}
          type="button"
          className={`rh__service${name === service ? " rh__service--on" : ""}`}
          aria-pressed={name === service}
          onClick={() => setService(name)}
        >
          {t(serviceKey(name))}
        </button>
      ))}
    </fieldset>
  );

  const title = (
    <h1 id="rh-title" className="rh__title">
      {t("rider.home.title")}
    </h1>
  );

  const historyEntry =
    onOpenHistory === undefined ? null : (
      <button type="button" className="rh__history" onClick={() => onOpenHistory()}>
        {t("rider.home.history.open")}
      </button>
    );

  // مدخلُ الحسابِ (`SR-12`). **زرٌّ لا أيقونةٌ عاريةٌ**: أيقونةُ تروسٍ بلا نصٍّ
  // لا يقرؤها قارئُ الشاشةِ، وفيها بابُ حذفِ الحسابِ (`UX-10`).
  const accountEntry =
    onOpenAccount === undefined ? null : (
      <button type="button" className="rh__account" onClick={() => onOpenAccount()}>
        {t("rider.home.account.open")}
      </button>
    );

  // مدخلُ الاستغاثةِ (`PD-020`) — مدخلٌ موحَّدٌ لا زرٌّ يكتبُه كلُّ سطحٍ بيدِه.
  const sosEntry =
    onOpenSos === undefined ? null : <SosEntry onOpen={onOpenSos} language={language} />;

  if (state.kind === "loading") {
    return (
      <section
        className="rh"
        dir={directionFor(language)}
        aria-busy="true"
        aria-labelledby="rh-title"
      >
        {title}
        <Skeleton />
      </section>
    );
  }

  if (state.kind === "screen") {
    // نصُّ شاشةِ النظامِ عربيٌّ اليومَ (دَينٌ مُعلَنٌ في `ROADMAP.md`)، فيُثبَّتُ
    // اتجاهُها عربيّاً: نصٌّ عربيٌّ في إطارٍ يساريٍّ يُقرأُ مقلوباً.
    return (
      <div dir="rtl">
        <SystemScreen state={state.screen} onAction={() => void load()} />
      </div>
    );
  }

  if (state.kind === "rejected") {
    return (
      <section className="rh" dir={directionFor(language)} aria-labelledby="rh-title">
        {title}
        {historyEntry}
        {accountEntry}
        {sosEntry}
        <div className="sys" role="alert">
          <p className="sys__body">{t(placesErrorKey(state.code))}</p>
          {isRetryablePlacesError(state.code) ? (
            <button type="button" className="sys__action" onClick={() => void load()}>
              {t("rider.home.retry")}
            </button>
          ) : null}
        </div>
        {cityBar}
      </section>
    );
  }

  return (
    <section className="rh" dir={directionFor(language)} aria-labelledby="rh-title">
      {title}
      {historyEntry}
      {accountEntry}
      {sosEntry}

      {/* الحدُّ الأوّلُ مكتوبٌ حيثُ يُتوقَّعُ الرسمُ — لا فراغٌ ولا رسمٌ كاذبٌ. */}
      {mapProvider === "none" ? (
        <p className="rh__map rh__map--off" role="status">
          {t("rider.home.map.unavailable")}
        </p>
      ) : (
        <div className="rh__map" data-provider={mapProvider} />
      )}

      <label className="rh__field" htmlFor="rh-destination">
        <span className="sys__hint">{t("rider.home.destination.prompt")}</span>
        <input
          id="rh-destination"
          className="rh__input"
          type="text"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="sys__action"
        disabled={!isSubmittableDestination(typed)}
        onClick={() => choose(typed.trim(), null, null)}
      >
        {t("rider.home.destination.action")}
      </button>

      {services}

      <h2 className="rh__heading">{t("rider.home.places.title")}</h2>
      {state.places.length === 0 ? (
        <p className="sys__hint">{t("rider.home.places.empty")}</p>
      ) : (
        <ul className="rh__places">
          {state.places.map((place) => (
            <li key={place.id} className="rh__place">
              <button
                type="button"
                className="rh__pick"
                onClick={() => choose(place.label, place.lat, place.lng)}
              >
                <span className="rh__place-kind">{t(place.kindKey)}</span>
                <span className="rh__place-label">{place.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2 className="rh__heading">{t("rider.home.recent.title")}</h2>
      {state.recent.length === 0 ? (
        <p className="sys__hint">{t("rider.home.recent.empty")}</p>
      ) : (
        <ul className="rh__recent">
          {state.recent.map((row) => (
            <li key={`${row.label}:${row.lastUsedAt}`} className="rh__recent-row">
              <button
                type="button"
                className="rh__pick"
                onClick={() => choose(row.label, row.lat, row.lng)}
              >
                {row.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {cityBar}
    </section>
  );
}
