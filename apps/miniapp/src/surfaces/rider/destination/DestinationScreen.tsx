/**
 * الغرض: شاشةُ اختيارِ الوجهةِ `SR-03` (البند `F2-03`): بحثٌ نصّيٌّ في ثلاثةِ
 *   مصادرَ · «موقعي الحاليُّ» من مُضيفِ تيليجرام · مصادقةُ الدبّوسِ على حدِّ
 *   منطقةِ الخدمةِ · تأكيدُ الوجهةِ.
 * الحالة: منفّذ فعلياً — البند `F2-03`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/destination
 * يُستخدم من: `RiderRoot.tsx` بعدَ `onDestinationChosen` من `HomeScreen`.
 * يُتوقع أن يستخدمه لاحقاً: `F2-04` يُركَّبُ بعدَ `onConfirmed` من ههنا.
 *
 * ═══ حدودٌ معلَنةٌ في هذه الشاشةِ ═══
 *
 *   ١. **لا خريطةَ حقيقيّةً ولا اختيارَ دبّوسٍ بالإصبعِ**: لا مزوّدَ خرائطَ في
 *      حزمةِ التطبيقِ المصغَّرِ اليومَ (ADR 0007)، فالنصفُ البصريُّ من `SR-03`
 *      **غيرُ مُدَّعى** ومُسجَّلٌ دَيناً في ADR 0102 §6. والشاشةُ تُعلِنُ ذاكَ
 *      بـ`rider.destination.map.unavailable` ولا ترسمُ مستطيلاً رمادِيّاً.
 *      والبديلُ المبنيُّ **حقيقيٌّ لا تعويضيٌّ**: بحثٌ في دليلٍ نملكُه، وموقعُ
 *      الجهازِ من المُضيفِ، وإحداثيّةٌ تُصادَقُ على هندسةٍ فعليّةٍ في القاعدةِ.
 *   ٢. **لا مُرمِّزَ جغرافيّاً**: لا تحويلَ نصٍّ حرٍّ إلى إحداثيّةٍ. مَن لم يجدْ
 *      وجهتَه في الدليلِ يُخبَرُ بذاكَ صريحاً (`rider.destination.empty`)، ولا
 *      يُرسَلُ نصُّه إلى مزوّدٍ خارجيٍّ (`O-7`).
 *   ٣. **لا موقعَ مُختلَقٌ عندَ الرفضِ**: إن رفضَ المستخدمُ الإذنَ أو غابَت
 *      الميزةُ يُقالُ السببُ، ولا يُستعاضُ عنه بمركزِ المدينةِ.
 *   ٤. **لم تُفتَح من مستخدمٍ حقيقيٍّ بعد**: لا نشرَ حيَّ لهذه الحزمةِ، فما ههنا
 *      مُختبَرٌ لا مُثبَتٌ عندَ مستخدمٍ (سُلَّمُ القسم 1.3).
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
import { initLocation, openLocationSettings, requestLocation } from "../../../tg/location.ts";
import {
  type AcceptedSummary,
  acceptedSummary,
  destinationErrorKey,
  highlightRange,
  isRetryableDestinationError,
  isSearchable,
  labelFor,
  locationRefusalKey,
  offersLocationSettings,
  type RefusalView,
  refusalView,
  type SuggestionRow,
  suggestionRows,
} from "./destination-view.ts";
import {
  type DestinationResolveResponse,
  type DestinationSearchResponse,
  resolveDestination as resolveViaApi,
  searchDestinations as searchViaApi,
} from "./destinations-api.ts";

export interface ConfirmedDestination {
  readonly label: string;
  readonly lat: number;
  readonly lng: number;
  readonly cityCode: string | null;
}

export interface DestinationScreenProps {
  /** يُحقَنانِ كي تُختبَرَ الشاشةُ بلا شبكةٍ ولا `fetch` مُرقَّعٍ. */
  readonly search?: (query: string) => Promise<DestinationSearchResponse>;
  readonly resolve?: (lat: number, lng: number) => Promise<DestinationResolveResponse>;
  /** ويُحقَنُ جسرُ الموقعِ كي لا يُحتاجَ مُضيفُ تيليجرام في اختبارٍ. */
  readonly readDeviceLocation?: () => Promise<
    | { readonly ok: true; readonly lat: number; readonly lng: number }
    | { readonly ok: false; readonly reason: string }
  >;
  readonly openSettings?: () => void;
  readonly onConfirmed?: (destination: ConfirmedDestination) => void;
  readonly onBack?: () => void;
  readonly initialLanguage?: MiniAppLanguage;
  /** ما كتبَه الراكبُ في شاشةِ `SR-02` — يُبتدأُ به البحثُ بلا إعادةِ كتابةٍ. */
  readonly initialQuery?: string;
  /**
   * وجهةٌ جاءَت **بإحداثيّةٍ** من الشاشةِ السابقةِ (مكانٌ محفوظٌ أو وجهةٌ أخيرةٌ):
   * تُصادَقُ فوراً ولا يُعادُ البحثُ عنها. ومَن اختارَ «المنزلَ» باسمِه لا يُطلَبُ
   * منه أن يكتبَه ثانيةً — ولو طُلِبَ لَكانت الشاشةُ تُعاقِبُ اختياراً صحيحاً.
   *
   * والمصادقةُ تُعادُ ههنا **ولا تُفترَضُ**: مكانٌ حُفِظَ العامَ الماضيَ قد صارَ
   * خارجَ حدٍّ تغيَّرَ، وقبولُه لأنَّه محفوظٌ قبولٌ بلا حكمٍ.
   */
  readonly initialPoint?: { readonly label: string; readonly lat: number; readonly lng: number };
  /** اسمُ المزوّدِ المُهيَّأِ فعلاً؛ `"none"` تعني: قُلِ الحدَّ ولا ترسمْ. */
  readonly mapProvider?: string;
}

type SearchState =
  | { readonly kind: "idle" }
  | { readonly kind: "searching" }
  | { readonly kind: "ready"; readonly query: string; readonly rows: readonly SuggestionRow[] }
  | { readonly kind: "rejected"; readonly code: string };

type PickState =
  | { readonly kind: "none" }
  | { readonly kind: "resolving" }
  | {
      readonly kind: "accepted";
      readonly label: string;
      readonly summary: AcceptedSummary;
      readonly cityCode: string | null;
    }
  | { readonly kind: "refused"; readonly view: RefusalView }
  | { readonly kind: "location_refused"; readonly reason: string };

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

/**
 * جسرُ الموقعِ الافتراضيُّ: تهيئةٌ ثمَّ قراءةٌ واحدةٌ. والسببُ يُنقَلُ كما أعادَه
 * الغلافُ ولا يُوحَّدُ: «رفَضَ» و«لا يدعمُه المُضيفُ» جوابانِ مختلفانِ لِمَن
 * يقرأُ الشاشةَ.
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

/** مهلةُ تهدئةِ الكتابةِ. والثلاثُ مئةِ مِلّيٍ قيمةُ تجربةٍ لا حدُّ حمايةٍ. */
const SEARCH_DEBOUNCE_MS = 300;

export function DestinationScreen({
  search = searchViaApi,
  resolve = resolveViaApi,
  readDeviceLocation = defaultDeviceLocation,
  openSettings = () => void openLocationSettings(),
  onConfirmed,
  onBack,
  initialLanguage = MINIAPP_DEFAULT_LANGUAGE,
  initialQuery = "",
  initialPoint,
  mapProvider = "none",
}: DestinationScreenProps) {
  const [language] = useState<MiniAppLanguage>(initialLanguage);
  const [typed, setTyped] = useState(initialQuery);
  const [searchState, setSearchState] = useState<SearchState>({ kind: "idle" });
  const [pick, setPick] = useState<PickState>({ kind: "none" });
  const [system, setSystem] = useState<SystemState>(null);
  const mounted = useRef(true);
  /** ترتيبُ النداءاتِ: ردٌّ متأخِّرٌ لاستفهامٍ قديمٍ **يُطرَحُ** ولا يُعرَضُ. */
  const issued = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const t = miniAppTranslator(language);

  const runSearch = useCallback(
    async (query: string) => {
      const ticket = ++issued.current;
      setSearchState({ kind: "searching" });
      try {
        const response = await search(query);
        if (!mounted.current || ticket !== issued.current) return;
        setSearchState({
          kind: "ready",
          query: response.query,
          rows: suggestionRows(response.suggestions),
        });
      } catch (thrown) {
        const screen = await screenFor(thrown);
        if (!mounted.current || ticket !== issued.current) return;
        if (screen !== null) {
          setSystem({ screen });
          return;
        }
        setSearchState({ kind: "rejected", code: codeOf(thrown) ?? "UNKNOWN" });
      }
    },
    [search],
  );

  // تهدئةٌ: حرفٌ واحدٌ لا يُنتِجُ نداءً، ونداءٌ لكلِّ ضغطةٍ يُغرِقُ شبكةً ضعيفةً
  // (`UX-4`). والمؤقِّتُ يُلغى عندَ التفكيكِ فلا يُحدَّثُ سطحٌ مُنفَكٌّ.
  useEffect(() => {
    if (!isSearchable(typed)) {
      issued.current += 1;
      setSearchState({ kind: "idle" });
      return;
    }
    const timer = setTimeout(() => void runSearch(typed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [typed, runSearch]);

  const resolvePoint = useCallback(
    async (label: string, lat: number, lng: number) => {
      setPick({ kind: "resolving" });
      try {
        const response = await resolve(lat, lng);
        if (!mounted.current) return;
        if (response.accepted) {
          setPick({
            kind: "accepted",
            label,
            summary: acceptedSummary(response.destination),
            cityCode: response.destination.city.code,
          });
          return;
        }
        setPick({ kind: "refused", view: refusalView(response) });
      } catch (thrown) {
        const screen = await screenFor(thrown);
        if (!mounted.current) return;
        if (screen !== null) {
          setSystem({ screen });
          return;
        }
        setSearchState({ kind: "rejected", code: codeOf(thrown) ?? "UNKNOWN" });
        setPick({ kind: "none" });
      }
    },
    [resolve],
  );

  // مصادقةٌ واحدةٌ عندَ التركيبِ للوجهةِ القادمةِ بإحداثيّةٍ. و`initialPoint`
  // وحدَه في قائمةِ التبعياتِ: لو أُضيفَ `resolvePoint` لَأُعيدَ النداءُ كلَّما
  // تغيَّرَ الحاقنُ، وذاكَ نداءُ شبكةٍ بلا سببٍ يُقرأُ.
  const resolveRef = useRef(resolvePoint);
  useEffect(() => {
    resolveRef.current = resolvePoint;
  }, [resolvePoint]);
  useEffect(() => {
    if (initialPoint === undefined) return;
    void resolveRef.current(initialPoint.label, initialPoint.lat, initialPoint.lng);
  }, [initialPoint]);

  const pickMyLocation = useCallback(async () => {
    setPick({ kind: "resolving" });
    const read = await readDeviceLocation();
    if (!mounted.current) return;
    if (!read.ok) {
      // لا إحداثيّةَ بديلةً ههنا: الشاشةُ تقولُ السببَ وتبقى قابلةً للبحثِ.
      setPick({ kind: "location_refused", reason: read.reason });
      return;
    }
    await resolvePoint(t("rider.destination.location.label"), read.lat, read.lng);
  }, [readDeviceLocation, resolvePoint, t]);

  if (system !== null) {
    // نصُّ شاشةِ النظامِ عربيٌّ اليومَ (دَينٌ مُعلَنٌ في `ROADMAP.md`)، فيُثبَّتُ
    // اتجاهُها عربيّاً: نصٌّ عربيٌّ في إطارٍ يساريٍّ يُقرأُ مقلوباً.
    return (
      <div dir="rtl">
        <SystemScreen
          state={system.screen}
          onAction={() => {
            setSystem(null);
            if (isSearchable(typed)) void runSearch(typed);
          }}
        />
      </div>
    );
  }

  const title = (
    <h1 id="rd-title" className="rd__title">
      {t("rider.destination.title")}
    </h1>
  );

  const highlighted = (row: SuggestionRow, query: string) => {
    const text = labelFor(row, language);
    const range = highlightRange(text, query);
    if (range === null) return text;
    return (
      <>
        {text.slice(0, range.start)}
        <mark className="rd__mark">{text.slice(range.start, range.end)}</mark>
        {text.slice(range.end)}
      </>
    );
  };

  const results = () => {
    if (searchState.kind === "idle") {
      return <p className="sys__hint">{t("rider.destination.hint")}</p>;
    }
    if (searchState.kind === "searching") return <Skeleton />;
    if (searchState.kind === "rejected") {
      return (
        <div className="sys" role="alert">
          <p className="sys__body">{t(destinationErrorKey(searchState.code))}</p>
          {isRetryableDestinationError(searchState.code) ? (
            <button type="button" className="sys__action" onClick={() => void runSearch(typed)}>
              {t("rider.destination.retry")}
            </button>
          ) : null}
        </div>
      );
    }
    if (searchState.rows.length === 0) {
      // «لا نتيجةَ» يُقالُ صريحاً ولا يُترَكُ بياضاً (`UX-5`)، ويُقالُ معه أنَّ
      // الدليلَ دليلُنا لا الأرضُ كلُّها — فلا يظنُّ الباحثُ أنَّ مكانَه مُنكَرٌ.
      return (
        <div className="rd__empty">
          <p className="sys__body">{t("rider.destination.empty")}</p>
          <p className="sys__hint">{t("rider.destination.empty.hint")}</p>
        </div>
      );
    }
    return (
      <ul className="rd__results">
        {searchState.rows.map((row) => (
          <li key={row.key} className={`rd__row${row.strong ? " rd__row--strong" : ""}`}>
            <button
              type="button"
              className="rd__pick"
              onClick={() => void resolvePoint(labelFor(row, language), row.lat, row.lng)}
            >
              <span className="rd__row-label">{highlighted(row, searchState.query)}</span>
              <span className="rd__row-meta">
                {t(row.sourceKey)}
                {row.kindKey === null ? null : ` · ${t(row.kindKey)}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  };

  const verdict = () => {
    if (pick.kind === "none") return null;
    if (pick.kind === "resolving") {
      return (
        <div className="rd__verdict" aria-busy="true">
          <Skeleton />
        </div>
      );
    }
    if (pick.kind === "location_refused") {
      return (
        <div className="rd__verdict sys" role="alert">
          <p className="sys__body">{t(locationRefusalKey(pick.reason))}</p>
          {offersLocationSettings(pick.reason) ? (
            <button type="button" className="sys__action" onClick={() => openSettings()}>
              {t("rider.destination.location.settings")}
            </button>
          ) : null}
        </div>
      );
    }
    if (pick.kind === "refused") {
      const { view } = pick;
      const city = language === "ar" ? view.cityNameAr : view.cityNameEn;
      return (
        <div className="rd__verdict sys" role="alert">
          <p className="sys__body">{t(view.messageKey)}</p>
          {city === null ? null : (
            <p className="sys__hint">
              {t("rider.destination.refused.city").replace("{city}", city)}
            </p>
          )}
          {view.fixable ? (
            <button type="button" className="sys__action" onClick={() => setPick({ kind: "none" })}>
              {t("rider.destination.refused.again")}
            </button>
          ) : null}
        </div>
      );
    }

    const { summary } = pick;
    return (
      <div className="rd__verdict rd__verdict--ok" role="status">
        <p className="rd__chosen">{pick.label}</p>
        {summary.nearest === null ? null : (
          <p className="sys__hint">
            {t("rider.destination.nearest")
              .replace("{kind}", t(summary.nearest.kindKey))
              .replace(
                "{name}",
                language === "ar" ? summary.nearest.nameAr : summary.nearest.nameEn,
              )
              .replace("{meters}", String(summary.nearest.distanceM))}
          </p>
        )}
        <p className="sys__hint">
          {t("rider.destination.city").replace(
            "{city}",
            language === "ar" ? summary.cityNameAr : summary.cityNameEn,
          )}
        </p>
        <button
          type="button"
          className="sys__action"
          onClick={() =>
            onConfirmed?.({
              label: pick.label,
              lat: summary.lat,
              lng: summary.lng,
              cityCode: pick.cityCode,
            })
          }
        >
          {t("rider.destination.confirm")}
        </button>
      </div>
    );
  };

  return (
    <section className="rd" dir={directionFor(language)} aria-labelledby="rd-title">
      {title}

      {/* الحدُّ الأوّلُ مكتوبٌ حيثُ يُتوقَّعُ الرسمُ — لا فراغٌ ولا رسمٌ كاذبٌ. */}
      {mapProvider === "none" ? (
        <p className="rd__map rd__map--off" role="status">
          {t("rider.destination.map.unavailable")}
        </p>
      ) : (
        <div className="rd__map" data-provider={mapProvider} />
      )}

      <label className="rd__field" htmlFor="rd-query">
        <span className="sys__hint">{t("rider.destination.search.prompt")}</span>
        <input
          id="rd-query"
          className="rd__input"
          type="search"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
      </label>

      <button type="button" className="rd__locate" onClick={() => void pickMyLocation()}>
        {t("rider.destination.location.action")}
      </button>

      {verdict()}
      {results()}

      {onBack === undefined ? null : (
        <button type="button" className="rd__back" onClick={() => onBack()}>
          {t("rider.destination.back")}
        </button>
      )}
    </section>
  );
}
